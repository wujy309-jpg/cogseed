/** 模板卸载归档不被资产清除级联扫描；重装恢复时须重新判断带 assetId
 * 标记的值是否仍可投影，防止已清除的资产正文从归档复活。
 * 无资产所有权标记的用户内容与模板组本身仍按原恢复契约保留。 */
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

describe('模板卸载归档：已清资产投影借重装复活（复活族第三面）', () => {
  it('卸载归档→资产投影级联清（归档不扫，保持「卸载=数据保留」）→重装恢复→已清资产的投影值被过滤，不复活', async () => {
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
