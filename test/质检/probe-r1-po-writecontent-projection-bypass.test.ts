/** 分组全文覆写和历史恢复入口的资产投影只读边界；单值入口作为对照。 */

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
const UID = 'probe-user-001';

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

function readDoc(): any {
  return JSON.parse(fs.readFileSync(poDocFile(), 'utf8'));
}

async function loadGroups() {
  return import('../../src/main/features/personal_ontology_groups');
}
async function loadApi() {
  return import('../../src/main/features/po/api');
}

function dialect(lines: string[]): string {
  return ['## 字段区', '', '### 常用工具', ...lines, '', '---', '', '## 流水区', ''].join('\n');
}

describe('普通组原文覆写绕过资产投影只读', () => {
  // 全文覆写入口的投影伪造、篡改与删除边界。
  it.skip('writeGroupContent 能伪造 @asset: 投影值（正常 add 通道造不出来）', async () => {
    const groups = await loadGroups();
    const created = await groups.createGroup(UID, '探针组');
    expect(created.ok).toBe(true);
    const groupId = created.group!.group_id;

    // 攻击面：提交文本里直接带 @asset:<id> 标记。
    const r = await groups.writeGroupContent(UID, groupId, dialect([
      '- 伪装成资产投影的值 [手动] @asset:ast_probe_1',
    ]));
    expect(r.ok).toBe(true);

    const doc = readDoc();
    const group = doc.groups.find((g: any) => g.id === groupId);
    expect(group.values).toHaveLength(1);
    // 若守卫存在，这里应当失败或 assetId 不落盘；实际断言它落了盘：
    expect(group.values[0].assetId).toBe('ast_probe_1');
  });

  // 对照单值通道的只读守卫；当前 fixture 通过全文覆写构造投影值，
  // 恢复该探针时应同时核对 fixture 的构造入口仍然有效。
  it('对照组：po.values.update / po.values.delete 对投影值拒绝（守卫本身在）', async () => {
    const groups = await loadGroups();
    const api = await loadApi();
    const created = await groups.createGroup(UID, '探针组');
    const groupId = created.group!.group_id;

    // 先经伪造路径造出投影值。
    await groups.writeGroupContent(UID, groupId, dialect([
      '- 资产维护的原文 [手动] @asset:ast_probe_1',
    ]));
    const valueId = readDoc().groups.find((g: any) => g.id === groupId).values[0].id;

    const upd = await api.poUpdateValue(UID, groupId, valueId, { text: '直接改' });
    expect(upd.ok).toBe(false);
    expect(upd.error).toBe('asset_projection_read_only');

    const del = await api.poDeleteValue(UID, groupId, valueId);
    expect(del.ok).toBe(false);
    expect(del.error).toBe('asset_projection_read_only');
  });

  // 覆写入口对既有投影值的修改与删除。
  it.skip('writeGroupContent 能篡改投影值文本（assetId 保留）与删除投影值', async () => {
    const groups = await loadGroups();
    const created = await groups.createGroup(UID, '探针组');
    const groupId = created.group!.group_id;

    await groups.writeGroupContent(UID, groupId, dialect([
      '- 资产维护的原文 [手动] @asset:ast_probe_1',
    ]));

    // 篡改：换文本但保留 @asset 标记 → 投影内容与来源资产脱钩。
    const tamper = await groups.writeGroupContent(UID, groupId, dialect([
      '- 被篡改的投影文本 [手动] @asset:ast_probe_1',
    ]));
    expect(tamper.ok).toBe(true);
    let value = readDoc().groups.find((g: any) => g.id === groupId).values[0];
    expect(value.text).toBe('被篡改的投影文本');
    expect(value.assetId).toBe('ast_probe_1');

    // 删除：直接不提交该行 → 投影值消失，无任何拒绝。
    const wipe = await groups.writeGroupContent(UID, groupId, dialect([]));
    expect(wipe.ok).toBe(true);
    const after = readDoc().groups.find((g: any) => g.id === groupId);
    expect(after.values).toHaveLength(0);
  });

  // 历史快照恢复入口也须维持资产投影身份与只读约束。
  it.skip('restoreGroupSnapshot 能把投影值回滚成旧文本（旧投影复活，无守卫）', async () => {
    const groups = await loadGroups();
    const api = await loadApi();
    const created = await groups.createGroup(UID, '探针组');
    const groupId = created.group!.group_id;

    // 第一版：投影值文本 A（改前组为空 → 不留快照）。
    await groups.writeGroupContent(UID, groupId, dialect([
      '- 投影旧文本 [手动] @asset:ast_probe_1',
    ]));
    // 第二版：模拟资产侧把投影更新成文本 B（改前非空 → 留下 A 的快照）。
    await groups.writeGroupContent(UID, groupId, dialect([
      '- 投影新文本 [手动] @asset:ast_probe_1',
    ]));

    const history = await api.poListHistory(UID, groupId);
    expect(history.length).toBeGreaterThanOrEqual(1);
    const snapId = history[0].id; // 最新一版快照 = 旧文本 A 的改前状态

    const restored = await groups.restoreGroupSnapshot(UID, groupId, snapId);
    expect(restored.ok).toBe(true);

    const value = readDoc().groups.find((g: any) => g.id === groupId).values[0];
    // 旧投影文本复活，且仍顶着资产所有权标记：
    expect(value.text).toBe('投影旧文本');
    expect(value.assetId).toBe('ast_probe_1');
  });

  // 重复覆写相同文本时的值 id 稳定性。
  it.skip('附带观察：writeGroupContent 的值 id 保全逻辑是死代码（每次覆写 id 全换）', async () => {
    const groups = await loadGroups();
    const created = await groups.createGroup(UID, '探针组');
    const groupId = created.group!.group_id;

    await groups.writeGroupContent(UID, groupId, dialect(['- 同文本值 [手动]']));
    const idBefore = readDoc().groups.find((g: any) => g.id === groupId).values[0].id;
    // 同文本再覆写一次：源码里算了 prior id 却没把它接到 poLineToValue 的产物上。
    await groups.writeGroupContent(UID, groupId, dialect(['- 同文本值 [手动]']));
    const idAfter = readDoc().groups.find((g: any) => g.id === groupId).values[0].id;
    // 断言 id 变了（保全失效）；若将来修好，此断言翻绿即为修复证据。
    expect(idAfter).not.toBe(idBefore);
  });
});
