/** 迁移未提交时的重复读取身份稳定性与读路径副作用。 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

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
const UID = 'probe-r2-ghost';

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cogseed-probe-r2-ghost-'));
  prevWs = process.env.COGSEED_WORKSPACE_ROOT;
  process.env.COGSEED_WORKSPACE_ROOT = tmpDir;
  vi.resetModules();
});

afterEach(() => {
  process.env.COGSEED_WORKSPACE_ROOT = prevWs;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function v1Dir(): string {
  return path.join(tmpDir, UID, 'cloud', 'contexts', '.personal_ontology_groups');
}
function poDocFile(): string {
  return path.join(tmpDir, UID, 'cloud', 'cognition', 'personal-ontology.json');
}
function poHistoryDir(): string {
  return path.join(tmpDir, UID, 'cloud', 'cognition', 'po-history', 'grp001');
}

/** v1 现场：1 个组（1 字段 1 值）+ 一版历史快照。 */
function seedV1(): void {
  const dir = v1Dir();
  fs.mkdirSync(path.join(dir, '.history', 'grp001'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'groups.md'), [
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
    '- ZCode [手动] @asof:2026-09',
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

async function loadStore() {
  return import('../../src/main/features/po/store');
}
async function loadApi() {
  return import('../../src/main/features/po/api');
}

function valueIdsOf(doc: { groups: any[] }): string[] {
  return doc.groups[0].values.map((v: any) => v.id);
}
function snapshotValueIds(file: string): string[] {
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  return parsed.group.values.map((v: any) => v.id);
}

describe('迁移未结清窗口的幽灵 id 与读路径写盘', () => {
  it.skip('两次只读 load 生成两套值 id；UI 持第一次 id 编辑必 not found；po-history 冻结的又是另一套', async () => {
    seedV1();
    const store = await loadStore();

    // 第一次读（对应 IPC po.snapshot 首次返回给 UI 的 id 集）
    const doc1 = store.loadPoDocSync(UID);
    expect(doc1.groups.length).toBe(1);
    expect(doc1.groups[0].id).toBe('grp001'); // 组 id 稳定（台账保留）
    const ids1 = valueIdsOf(doc1);

    // 断言 1：读路径真的写了盘（store.ts:61 注释承诺「永不写盘」被破）
    expect(fs.existsSync(poHistoryDir())).toBe(true);
    const historyJsons = fs.readdirSync(poHistoryDir()).filter((n) => n.endsWith('.json'));
    expect(historyJsons.length).toBeGreaterThanOrEqual(1);
    const frozenIds = snapshotValueIds(path.join(poHistoryDir(), historyJsons[0]));

    // 第二次读（页面刷新 / 下一个 IPC）：又一套全新 id
    const doc2 = store.loadPoDocSync(UID);
    const ids2 = valueIdsOf(doc2);
    expect(ids2[0]).not.toBe(ids1[0]);

    // 断言 2（如实记录）：po-history 快照源自 .history/*.md 的独立解析，
    // 与活文档 id 无关；文件第一次读后冻结（existsSync 跳过），此后活文档
    // 每次导入换 id——磁盘历史与内存活文档 id 体系分离
    expect(frozenIds[0]).not.toBe(ids1[0]);
    expect(frozenIds[0]).not.toBe(ids2[0]);

    // 断言 3：UI 拿第一次的 valueId 走编辑（editPoDoc 锁内第三次导入）→ not found
    const api = await loadApi();
    const patched = await api.poUpdateValue(UID, 'grp001', ids1[0], { text: '改不动' });
    expect(patched.ok).toBe(false);
    expect(patched.error).toBe('field value not found');
    // JSON 文档此时仍未落盘（编辑失败不落盘；迁移结清只靠成功写）
    expect(fs.existsSync(poDocFile())).toBe(false);

    // 对照：同一 valueId 第二次尝试仍失败（窗口不随尝试关闭）
    const retry = await api.poUpdateValue(UID, 'grp001', ids2[0], { text: '也改不动' });
    expect(retry.ok).toBe(false);
    expect(retry.error).toBe('field value not found');
  });
});
