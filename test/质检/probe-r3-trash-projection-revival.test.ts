/** 资产清除、普通组及回收站恢复之间的投影引用一致性。 */

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
const UID = 'probe-user-r3';
const ASSET = 'ast_probe_r3';

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cogseed-probe-r3-'));
  prevWs = process.env.COGSEED_WORKSPACE_ROOT;
  process.env.COGSEED_WORKSPACE_ROOT = tmpDir;
  vi.resetModules();
});

afterEach(() => {
  process.env.COGSEED_WORKSPACE_ROOT = prevWs;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function readDoc(): any {
  return JSON.parse(fs.readFileSync(
    path.join(tmpDir, UID, 'cloud', 'cognition', 'personal-ontology.json'), 'utf8'));
}

async function loadGroups() {
  return import('../../src/main/features/personal_ontology_groups');
}
async function loadTemplates() {
  return import('../../src/main/features/personal_ontology_template_files');
}
async function loadApi() {
  return import('../../src/main/features/po/api');
}

function dialect(lines: string[]): string {
  return ['## 字段区', '', '### 常用工具', ...lines, '', '---', '', '## 流水区', ''].join('\n');
}

describe('已删资产投影借分组回收站恢复复活', () => {
  // 清除资产后恢复分组，观察回收站中的投影值是否重新出现。
  it.skip('组删除→资产级联清（trash 不扫）→组恢复→投影值复活且只读锁死', async () => {
    const groups = await loadGroups();
    const templates = await loadTemplates();
    const api = await loadApi();

    // 存量数据：普通组里带 v1 迁移来的资产投影值（writeGroupContent 伪造通道，
    // r1 已证实；这里只作为数据构造手段）。
    const created = await groups.createGroup(UID, '探针组');
    const groupId = created.group!.group_id;
    await groups.writeGroupContent(UID, groupId, dialect([
      `- 资产维护的原文 [手动] @asset:${ASSET}`,
    ]));
    expect(readDoc().groups[0].values[0].assetId).toBe(ASSET);

    // 用户删除分组：投影值随组进 trash（用户意图 = 不再保留这组内容）。
    const del = await groups.deleteGroup(UID, groupId);
    expect(del.ok).toBe(true);
    expect(readDoc().groups).toHaveLength(0);
    expect(readDoc().trash).toHaveLength(1);

    // 资产侧 purge 的投影级联：只扫活组，trash 里的投影值不被清。
    const purge = await templates.removeTemplateFieldValuesForRecallAsset(UID, ASSET);
    expect(purge.ok).toBe(true);
    expect(purge.removed).toBe(0); // 关键断言：级联对 trash 零覆盖
    expect(readDoc().trash[0].group.values[0].assetId).toBe(ASSET);

    // 用户从回收站恢复分组（po.groups.restore 通道语义）。
    const restore = await groups.restoreDeletedGroup(UID, groupId);
    expect(restore.ok).toBe(true);

    // 复活实锤：资产已删，投影值原样回来。
    const doc = readDoc();
    const revived = doc.groups.find((g: any) => g.id === groupId);
    expect(revived.values).toHaveLength(1);
    expect(revived.values[0].assetId).toBe(ASSET);
    expect(revived.values[0].text).toBe('资产维护的原文');

    // 锁死实证：复活的投影值在单值通道被只读守卫拦住，用户删不掉。
    const valueId = revived.values[0].id;
    const delValue = await api.poDeleteValue(UID, groupId, valueId);
    expect(delValue.ok).toBe(false);
    expect(delValue.error).toBe('asset_projection_read_only');
  });

  // 普通活组中的投影值作为对照，区分模板组与普通组的清理范围。
  it.skip('对照组：普通活组中的投影值不被级联清理', async () => {
    const groups = await loadGroups();
    const templates = await loadTemplates();

    const created = await groups.createGroup(UID, '活组');
    const groupId = created.group!.group_id;
    await groups.writeGroupContent(UID, groupId, dialect([
      `- 资产维护的原文 [手动] @asset:${ASSET}`,
    ]));

    const purge = await templates.removeTemplateFieldValuesForRecallAsset(UID, ASSET);
    expect(purge.ok).toBe(true);
    // 核对普通组中的投影值是否仍保留，不将模板组清理推断为全组清理。
    const after = readDoc().groups.find((g: any) => g.id === groupId);
    expect(after.values.some((v: any) => v.assetId === ASSET)).toBe(true);
    expect(purge.removed).toBe(0);
  });
});
