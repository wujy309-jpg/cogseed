/**
 * 探针 r8（边界测试员 · 本遍循环第 3 轮，编号顺延 r6/r7）→ 主题：契约对齐
 * （locale key × 数据字段 × 界面展示三方互相缺漏）。
 *
 * 疑点（读码推演）：资产审批卡的字段标签矩阵三方分裂——
 * - AI 工具层白名单 SUBSTANTIAL_FIELDS（asset-steward-tools.ts:784）=
 *   statement/scope/applicableWhen/forbiddenWhen/tags，**无 sensitivity、无 title**；
 * - 渲染层 FIELD_LABELS（chat-asset-approval.js:22-28）= statement/title/scope/
 *   applicableWhen/forbiddenWhen/tags，**多 title（白名单外，行不可达）缺
 *   sensitivity**——fieldLabel 落到 String(key) 兜底裸显英文键名（与上轮
 *   F-r2-13「tags 裸显」同款病，修复只补了 tags 一行）；
 * - main/locales 四语备有 `recall.asset_approval.field_sensitivity` 词条而主进程
 *   代码零引用（audit-i18n-refs dead_main 亲跑实证），renderer/locales 无此键
 *   ——曾经的 sensitivity 提议设计从白名单撤下后，词条与标签行两头脱节。
 *
 * 现状危害评估：白名单挡住 sensitivity/title → 两处缺口当前均不可达，属
 * 防御缺口 + 死词条 + 死行的口径分裂（待拍板：删死键 vs 补齐三方），故
 * proposal=pending。对照组（tags 行）兼作 F-r2-13 的渲染回归。
 *
 * 手法：对齐 test/renderer/chat-asset-approval-card.test.ts 的真实装载
 * （require 真模块 + 真 zh 词条），直接渲染 cardHtml 断言输出。
 *
 * 收尾状态（2026-10-01 记账员）：对应待议 **P-r3-32（删 main 四语死键收口（推荐）/ 补渲染行复活僵尸接口 / 仅删 title 三选一待拍板；随敏感级下线决策收口）**——
 * 断言漏洞/分裂现状的用例 it.skip 注明编号，拍板修复后反转/改写断言启用；
 * 对照组（合法路径/既有契约在）不依赖漏洞，保留 active。
 *
 * 启用记录（2026-10-02 执行员 wo-b9，P-r3-32 已修）：拍板取推荐案「随敏感级
 * 下线收口」——main 四语 `recall.asset_approval.field_sensitivity` 死键四语全删
 * （死键批次门禁 MAIN_DEAD_KEYS 防回流）、渲染层 FIELD_LABELS 的 title 死行同批
 * 删（title 走分级③直接处理，白名单 SUBSTANTIAL_FIELDS 无 title/sensitivity，
 * 行不可达）。两个 it.skip 按映射表反转/改写为「收口契约」断言启用：主靶 1 改写
 * 为 sensitivity 三方收口（无行/无键/裸显兜底仅剩防御语义）；契约矩阵用例的
 * ②「死键在场」反转为「四语已删」。
 *
 * P-r3-34 关联登记（2026-10-01 工单 b5，决策卡组 11）：本探针与 r8-skills 同为
 * 「整跑期间静态读取仓库源文件」的暴露面（本文件更在模块加载期 require 真渲染
 * 模块 + 顶层读 zh.json——并行修复写盘中间态同样可致 transform/require 假红，
 * 但该读取由模块系统执行，探针内无法加稳定读防御；同族 r8-skills 已改
 * readStable 稳定读，本文件登记为已知残余暴露面，主待议 P-r3-32 不变）。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const rendererRoot = path.join(__dirname, '../../src/renderer');
const repoRoot = path.join(__dirname, '../..');
const locale: Record<string, string> = JSON.parse(
  fs.readFileSync(path.join(rendererRoot, 'locales/zh.json'), 'utf8'),
);

const root = globalThis as any;
root.t = (key: string, vars?: Record<string, unknown>): string => {
  const raw = typeof locale[key] === 'string' ? locale[key] : key;
  return Object.entries(vars || {}).reduce(
    (acc, [name, value]) => acc.split(`{${name}}`).join(String(value)),
    raw,
  );
};
root.uiIconHtml = () => '';
root.createLogger = () => ({ warn: () => {} });

// eslint-disable-next-line @typescript-eslint/no-var-requires
const loadRendererModule = (name: string): any => require(path.join(rendererRoot, 'modules', name));
loadRendererModule('ui-button.js');
loadRendererModule('ui-status.js');
loadRendererModule('ui-form.js');
const card = loadRendererModule('chat-asset-approval.js') as {
  cardHtml: (payload: any, view: any) => string;
};

const PROPOSAL_ID = 'ap-r8probe0000000000abcdef';

function payloadWithFields(fields: string[]) {
  return {
    kind: 'asset_change_approval',
    proposalId: PROPOSAL_ID,
    assetId: 'aa-r8-probe',
    assetTitle: '探针资产',
    baselineVersion: '2',
    diff: { before: 'statement=…', after: 'statement=…', fields },
    reason: '探针：字段标签渲染',
    actions: ['confirm', 'defer', 'reject'],
  };
}

describe('probe r8 › 审批卡字段标签三方契约分裂（白名单 / FIELD_LABELS / locale 死键）', () => {
  beforeEach(() => { delete root.__probeLoaded; });

  it('对照组（F-r2-13 回归）：tags 字段渲染本地化「标签」而非裸键名', () => {
    const html = card.cardHtml(payloadWithFields(['tags']), {});
    expect(html).toContain('标签');
    expect(locale['cognition.asset_edit_field_tags']).toBe('标签'); // 词条在场（四语上轮补齐，此处 zh 侧回归）
  });

  it('【P-r3-32 已修·启用】sensitivity 随敏感级下线三方收口：FIELD_LABELS 无行、四语无死键、不复活', () => {
    // 下线收口（2026-10-02 wo-b9）：不补渲染行（复活僵尸接口被否）。若异常
    // 数据把 sensitivity 带进 diff.fields，fieldLabel 落到 String(key) 兜底——
    // 这是纯防御语义（生产端白名单挡住，缺口不可达），保持钉住防回流。
    const html = card.cardHtml(payloadWithFields(['sensitivity']), {});
    expect(html).toContain('sensitivity'); // 裸键名兜底（防御行为不变）
    expect(html).not.toContain('敏感'); // renderer zh 表无任何 sensitivity 语义词条命中
    // 渲染层源码不得再补 sensitivity 标签行（补行=复活已下线的敏感级接口）。
    const rendererSrc = fs.readFileSync(
      path.join(rendererRoot, 'modules/chat-asset-approval.js'), 'utf8',
    );
    expect(rendererSrc).not.toMatch(/sensitivity:\s*\[/);
  });

  it('【P-r3-32 已修·启用】契约矩阵断言：白名单无 sensitivity/title；main 四语死键已删；renderer 表无键', () => {
    // ① 工具层白名单（asset-steward-tools.ts SUBSTANTIAL_FIELDS，源码级断言防 import 主进程模块）
    const tools = fs.readFileSync(
      path.join(repoRoot, 'src/main/model/core-agent/asset-steward-tools.ts'), 'utf8',
    );
    const m = tools.match(/SUBSTANTIAL_FIELDS = (\[[^\]]*\])/);
    expect(m).toBeTruthy();
    expect(m![1]).toContain("'tags'");
    expect(m![1]).not.toContain('sensitivity'); // 白名单挡住 → 渲染缺口当前不可达
    expect(m![1]).not.toContain("'title'");
    // ② main 四语死键已随下线收口删除（原断言反转；防回流兜底在
    //    cognition-i18n-deadkeys-batch.test.ts 的 MAIN_DEAD_KEYS）
    for (const lang of ['zh', 'en', 'ja', 'pt']) {
      const main = JSON.parse(fs.readFileSync(path.join(repoRoot, `src/main/locales/${lang}.json`), 'utf8'));
      expect(main['recall.asset_approval.field_sensitivity']).toBeUndefined(); // 死键已删
    }
    // ③ renderer 表无此键（三方从未对齐，收口后也不得出现）
    expect(locale['recall.asset_approval.field_sensitivity']).toBeUndefined();
  });
});
