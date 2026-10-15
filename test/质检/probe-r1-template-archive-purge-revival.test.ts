/**
 * 探针（本轮红队-越权与状态）：purge 级联对「模板卸载归档目录」零覆盖——
 * 已清资产的投影值可借「重装模板+恢复原数据」复活（复活族第三存储面）。
 *
 * 读码链路：
 *  - 资产侧投影级联 removeTemplateFieldValuesForRecallAsset
 *    （personal_ontology_template_files.ts:784-809）只扫 `doc.groups` 里
 *    kind==='template' 的**活组**（:792/:799-800）——文件内 grep "archive"
 *    零命中，`_backup_<ts>/` 归档目录不在扫描面；
 *  - 卸载 uninstallTemplateFile（:404-453）把模板组整组渲染成方言 md 归档到
 *    `_backup_<ts>/<templateId>.md`（:414-420，renderTemplateGroupMarkdown 的
 *    值行携带 recallAssetId 标记，:112）再把组从 doc.groups 移除（:441-445）；
 *  - 重装 installTemplateFile(uid, templateId, restoreData=true)（:239-277）
 *    经 readTemplateArchive + templateGroupFromArchiveText 整组复活，归档里的
 *    recallAssetId 映射回 assetId（:143），**无任何资产存活检查**；
 *  - 与待议 P-r1-14（活普通组孤儿）/ P-r3-6（回收站 trash 面）同一族，但存储面
 *    是第三个：归档目录。拍板级联范围时若只扫活组+trash，本面仍漏。
 *
 * 预言：模板组装投影值 → 卸载归档 → 资产 purge 级联 removed=0（扫不到归档）
 * → 重装恢复 → 已清资产的投影值带 assetId 原样复活（且按只读守卫锁死）。
 *
 * seed 用真实通道 appendExistingTemplateFieldValueToRef(recallAssetId=...)（:722，
 * 投影同步的生产写入路径），不经 writeGroupContent 伪造。
 *
 * 收尾状态（2026-10-01 记账员）：对应待议 **P-r1-90**——已拍板「恢复侧过滤
 * 已清资产」（决策卡 A-数据保真组）：级联保持只扫活组（「卸载=数据保留」
 * 设计不破），恢复入口（installTemplateFile restoreData）对带 assetId 所有权
 * 标记的值按资产存活+可投影（type=personal + status=active）过滤。主用例
 * 2026-10-02 反转断言启用：已清资产的投影值不再随重装恢复复活；对照组保留。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

let CATALOG: any[] = [];

vi.mock('../../src/main/features/role_templates', () => ({
  listRoleTemplates: () => JSON.parse(JSON.stringify(CATALOG)),
  getRoleTemplate: (id: string) => {
    const found = CATALOG.find((t) => t.template_id === id);
    return found ? JSON.parse(JSON.stringify(found)) : undefined;
  },
  listScenarios: () => [],
  getScenario: () => undefined,
}));
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
const UID = 'probe-user-arch-r1';
const ASSET = 'ast_probe_arch';

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cogseed-probe-arch-r1-'));
  prevWs = process.env.COGSEED_WORKSPACE_ROOT;
  process.env.COGSEED_WORKSPACE_ROOT = tmpDir;
  CATALOG = [{
    template_id: 'probe',
    name: '探针角色',
    description: '',
    version: '1.0.0',
    preset_groups: [{ id: 'background', title: '学习背景', fields: [{ id: 'major', name: '专业' }] }],
    bundle: { skill_ids: [], agent_ids: [] },
  }];
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

async function loadTemplates() {
  return import('../../src/main/features/personal_ontology_template_files');
}

describe('探针 r1 › 模板卸载归档：已清资产投影借重装复活（复活族第三面）', () => {
  it('【P-r1-90 已修·恢复侧过滤】卸载归档→资产投影级联清（归档不扫，保持「卸载=数据保留」）→重装恢复→已清资产的投影值被过滤，不复活', async () => {
    const t = await loadTemplates();

    // ① 装模板，经生产投影通道写入带资产所有权标记的模板值。
    expect((await t.installTemplateFile(UID, 'probe')).ok).toBe(true);
    let group = readDoc().groups.find((g: any) => g.kind === 'template');
    const groupId = group.id;
    const ref = t.buildContentRef(groupId, '学习背景');
    expect((await t.appendExistingTemplateFieldValueToRef(
      UID, ref, '专业', '资产维护的原文-探针归档面', '手动', undefined, ASSET)).ok).toBe(true);
    group = readDoc().groups.find((g: any) => g.id === groupId);
    expect(group.values.some((v: any) => v.assetId === ASSET)).toBe(true);

    // ② 卸载：整组方言 md 归档进 _backup_<ts>/，组从 doc.groups 移除。
    const un = await t.uninstallTemplateFile(UID, 'probe');
    expect(un.ok).toBe(true);
    expect(readDoc().groups.some((g: any) => g.id === groupId)).toBe(false);
    expect(String(un.archive_dir || '')).toContain('_backup_');
    const archivedMd = fs.readFileSync(
      path.join(un.archive_dir!, 'probe.md'), 'utf8');
    // 归档 md 携带正文与资产标记（renderTemplateGroupMarkdown :112）。
    expect(archivedMd).toContain('资产维护的原文-探针归档面');
    expect(archivedMd).toContain(`@asset:${ASSET}`);

    // ③ 资产侧投影级联：只扫活组——归档目录零覆盖（设计如此，本修法不改级联面）。
    const purge = await t.removeTemplateFieldValuesForRecallAsset(UID, ASSET);
    expect(purge.ok).toBe(true);
    expect(purge.removed).toBe(0); // 级联对归档面零覆盖
    expect(fs.readFileSync(path.join(un.archive_dir!, 'probe.md'), 'utf8')).toContain('资产维护的原文-探针归档面');

    // ④ 重装 + 恢复原数据（po.install 通道 restoreData 语义）。
    const re = await t.installTemplateFile(UID, 'probe', true);
    expect(re.ok).toBe(true);

    // ⑤ 修复后断言（原探针断言复活为漏洞，已反转）：ASSET 的记录已不在
    // ability-assets（从未存在=purge/物理删除同构），恢复侧过滤生效——投影
    // 值不随重装回到文档；模板组本身正常恢复。
    const doc = readDoc();
    const restored = doc.groups.find((g: any) => g.kind === 'template');
    expect(restored).toBeTruthy();
    expect(restored!.values.some((v: any) => v.assetId === ASSET)).toBe(false);
    expect(restored!.values.some((v: any) => v.text === '资产维护的原文-探针归档面')).toBe(false);
    // 无所有权标记的手写值不受过滤影响（本用例没有手写值，断言组恢复即可）。
  });

  it('对照组：活模板组的投影值在级联范围内（removed=1，级联本身有效）', async () => {
    const t = await loadTemplates();
    expect((await t.installTemplateFile(UID, 'probe')).ok).toBe(true);
    const group = readDoc().groups.find((g: any) => g.kind === 'template');
    const ref = t.buildContentRef(group.id, '学习背景');
    expect((await t.appendExistingTemplateFieldValueToRef(
      UID, ref, '专业', '活组投影原文', '手动', undefined, ASSET)).ok).toBe(true);

    const purge = await t.removeTemplateFieldValuesForRecallAsset(UID, ASSET);
    expect(purge.ok).toBe(true);
    expect(purge.removed).toBe(1);
    const after = readDoc().groups.find((g: any) => g.kind === 'template');
    expect(after.values.some((v: any) => v.assetId === ASSET)).toBe(false);
  });
});
