/** 旧布局首次持久化的写入失败恢复，覆盖台账、活组、回收站及快照的一致性。 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const state = vi.hoisted(() => ({ failWrites: 0 }));
vi.mock('../../src/main/storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/main/storage')>();
  return {
    ...actual,
    writeJson: async (filePath: string, data: unknown) => {
      if (state.failWrites > 0) {
        state.failWrites -= 1;
        throw new Error('probe: simulated disk full');
      }
      return actual.writeJsonSync(filePath, data);
    },
  };
});
vi.mock('../../src/main/features/kb_indexer', () => ({
  enqueue: () => {},
  kbEvents: { on: () => {}, off: () => {}, emit: () => {} },
}));
vi.mock('../../src/main/features/search', () => ({
  upsertContext: () => {},
  dropContext: () => {},
}));

let tmpDir: string;
let prevWs: string | undefined;
const UID = 'probe-r2-txn';

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cogseed-probe-r2-txn-'));
  prevWs = process.env.COGSEED_WORKSPACE_ROOT;
  process.env.COGSEED_WORKSPACE_ROOT = tmpDir;
  state.failWrites = 0;
  vi.resetModules();
});

afterEach(() => {
  process.env.COGSEED_WORKSPACE_ROOT = prevWs;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function v1Dir(): string {
  return path.join(tmpDir, UID, 'cloud', 'contexts', '.personal_ontology_groups');
}
function ledgerFile(): string {
  return path.join(v1Dir(), 'groups.md');
}
function poDocFile(): string {
  return path.join(tmpDir, UID, 'cloud', 'cognition', 'personal-ontology.json');
}

/** v1 现场：1 个活组（台账 + 内容文件 + 一版历史快照）。 */
function seedV1(): void {
  const dir = v1Dir();
  fs.mkdirSync(path.join(dir, '.history', 'grp001'), { recursive: true });
  fs.writeFileSync(ledgerFile(), [
    '# 记忆分组', '',
    '### grp001',
    '- 标题: 工作偏好',
    '- 文件: .personal_ontology_groups/grp001.md',
    '- 创建时间: 2026-09-01T10:00:00',
    '- 更新时间: 2026-09-02T10:00:00',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(dir, 'grp001.md'), [
    '## 字段区', '',
    '### 常用工具',
    '- ZCode [手动]',
    '',
    '---', '',
    '## 流水区', '',
    '周五提交周报',
  ].join('\n'));
  fs.writeFileSync(path.join(dir, '.history', 'grp001', '2026-09-01T10-05-00-000Z-00.md'), [
    '## 字段区', '',
    '### 常用工具',
    '- ZCode [手动]',
    '',
    '---', '',
    '## 流水区', '',
    '旧快照条目',
  ].join('\n'));
}

async function loadGroups() {
  return import('../../src/main/features/personal_ontology_groups');
}
async function loadStore() {
  return import('../../src/main/features/po/store');
}

describe('迁移结清的非事务时序', () => {
  it.skip('firstPersist 时 writeJson 失败：台账已删，活组全体降格为回收站条目', async () => {
    seedV1();
    const groups = await loadGroups();

    // 迁移前正常读一次（活组可见）
    expect(groups.readGroups(UID).length).toBe(1);

    // 第一次写：writeJson 被探针模拟为失败（磁盘满等）
    state.failWrites = 1;
    await expect(groups.createGroup(UID, '新组')).rejects.toThrow('probe: simulated disk full');

    // 断言 1：v1 台账在 writeJson 之前已被删除（backupV1Dir 先删后写）
    expect(fs.existsSync(ledgerFile())).toBe(false);
    // 备份已生成（cpSync 成功在 rmSync 之前）
    const backups = fs.readdirSync(path.join(tmpDir, UID, 'local'))
      .filter((n) => n.startsWith('ontology-v1-backup-'));
    expect(backups.length).toBe(1);
    expect(fs.existsSync(path.join(tmpDir, UID, 'local', backups[0], 'groups.md'))).toBe(true);

    // 断言 2：写失败后重新读——活组消失，.history 孤儿被当「已删除分组」复活进 trash
    const store = await loadStore();
    const doc = store.loadPoDocSync(UID);
    expect(doc.groups.length).toBe(0);
    expect(doc.trash.length).toBe(1);
    expect(doc.trash[0].group.id).toBe('grp001');
    // v2 JSON 仍未落盘（失败的写没有留下半成品）
    expect(fs.existsSync(poDocFile())).toBe(false);

    // 断言 3：再次成功写 → 又一次 backupV1Dir（local/ 堆积第二份备份），
    // 落盘文档里活组区为空、原活组只以 trash 形式存在
    const created = await groups.createGroup(UID, '重试组');
    expect(created.ok).toBe(true);
    const backupsAfter = fs.readdirSync(path.join(tmpDir, UID, 'local'))
      .filter((n) => n.startsWith('ontology-v1-backup-'));
    expect(backupsAfter.length).toBe(2);
    const persisted = JSON.parse(fs.readFileSync(poDocFile(), 'utf8'));
    expect(persisted.groups.map((g: any) => g.title)).toEqual(['重试组']);
    expect(persisted.trash.length).toBe(1);
    expect(persisted.trash[0].group.id).toBe('grp001');
  });
});
