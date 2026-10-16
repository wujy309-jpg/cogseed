/** 保留标题分组的导出、再导入与相邻分组隔离。 */
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
const UID = 'probe-r3-roundtrip';

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cogseed-probe-r3-rt-'));
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

async function loadApi() {
  return import('../../src/main/features/po/api');
}

describe('导入 round-trip 保留词丢组', () => {
  it.skip('唯一组叫「字段区」时，导出再导入整组消失；跟在别组后则被前组吞并', async () => {
    const api = await loadApi();

    // 场景 1：保留词组是唯一组
    const g1 = await api.poCreateGroup(UID, '字段区');
    expect(g1.ok).toBe(true);
    const gid1 = g1.group!.group_id;
    const f1 = await api.poCreateField(UID, gid1, '工具');
    await api.poAddValue(UID, gid1, f1.field!.id, { text: 'ZCode' });

    const exported1 = api.poExportMarkdown(UID);
    expect(exported1).toContain('## 字段区');

    // 模拟换机：清掉文档再预览导入
    fs.rmSync(poDocFile(), { force: true });
    const preview1 = api.poImportPreview(UID, exported1);
    // 唯一组整体消失（数据丢失实锤）
    expect(preview1.items.length).toBe(0);

    // 场景 2：保留词组跟在正常组后
    fs.rmSync(poDocFile(), { force: true });
    const normal = await api.poCreateGroup(UID, '正常组');
    const gidN = normal.group!.group_id;
    const fN = await api.poCreateField(UID, gidN, '字段N');
    await api.poAddValue(UID, gidN, fN.field!.id, { text: '值N' });
    const g2 = await api.poCreateGroup(UID, '流水区');
    const gid2 = g2.group!.group_id;
    const f2 = await api.poCreateField(UID, gid2, '字段F');
    await api.poAddValue(UID, gid2, f2.field!.id, { text: '值F' });

    const exported2 = api.poExportMarkdown(UID);
    fs.rmSync(poDocFile(), { force: true });
    const preview2 = api.poImportPreview(UID, exported2);
    // 「流水区」组不再作为独立组出现
    expect(preview2.items.map((i) => i.title)).toEqual(['正常组']);
    // 它的内容被并入「正常组」的解析（串组实锤——preview 第一组的字段里
    // 出现本属于「流水区」的字段F/值F，或进了流水条目）
    const normalItem = preview2.items[0];
    const flattened = JSON.stringify(normalItem);
    expect(flattened).toContain('值F');
  });
});
