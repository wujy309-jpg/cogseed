/** 本体 JSON 损坏时的写入拒绝与原始字节保留边界。 */
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
const UID = 'probe-r1-user';

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cogseed-probe-r1-'));
  prevWs = process.env.COGSEED_WORKSPACE_ROOT;
  process.env.COGSEED_WORKSPACE_ROOT = tmpDir;
  vi.resetModules();
});

afterEach(() => {
  process.env.COGSEED_WORKSPACE_ROOT = prevWs;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function poDocFile(): string {
  return path.join(tmpDir, UID, 'cloud', 'cognition', 'personal-ontology.json');
}

async function loadGroups() {
  return import('../../src/main/features/personal_ontology_groups');
}

describe('坏 JSON 覆盖', () => {
  it.skip('磁盘 JSON 损坏后，下一次成功写入把旧文档静默替换（无坏档备份）', async () => {
    // 1) seed：一个带字段值的真实组
    const groups = await loadGroups();
    const created = await groups.createGroup(UID, '珍藏组');
    expect(created.ok).toBe(true);
    const gid = created.group!.group_id;
    await groups.appendFieldValue(UID, gid, '重要事实', '不可丢的数据', '手动');
    const before = fs.readFileSync(poDocFile(), 'utf8');
    expect(before).toContain('珍藏组');
    expect(before).toContain('不可丢的数据');

    // 2) 破坏：模拟云同步冲突 / 截断写（半截 JSON）
    fs.writeFileSync(poDocFile(), '{"schemaVersion":2,"groups":[{"id":"g1","ti');

    // 3) 触发：一次会成功的写（新建组是最常见操作）
    const second = await groups.createGroup(UID, '后来组');
    expect(second.ok).toBe(true);

    // 4) 断言：旧文档被替换——珍藏组与它的值从磁盘上消失
    const after = JSON.parse(fs.readFileSync(poDocFile(), 'utf8'));
    const titles = (after.groups || []).map((g: any) => g.title);
    expect(titles).toContain('后来组');
    expect(titles).not.toContain('珍藏组');
    expect(JSON.stringify(after)).not.toContain('不可丢的数据');
    expect((after.trash || []).length).toBe(0);

    // 5) 断言：坏档没有任何备份副本（local/ 下无 backup/corrupt；cognition/
    //    下除正常 po-history 快照目录与正文外没有别的）
    const localDir = path.join(tmpDir, UID, 'local');
    const backups: string[] = fs.existsSync(localDir)
      ? fs.readdirSync(localDir).filter((n) => n.includes('backup') || n.includes('corrupt'))
      : [];
    const cognitionDir = path.join(tmpDir, UID, 'cloud', 'cognition');
    const cognitionFiles = fs.readdirSync(cognitionDir)
      .filter((n) => n !== 'personal-ontology.json' && n !== 'po-history');
    expect(backups.length).toBe(0);
    expect(cognitionFiles.length).toBe(0);
  });
});
