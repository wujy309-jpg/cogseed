import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-require-imports
require('../../src/renderer/modules/icons.js');
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('../../src/renderer/modules/ui-button.js');
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('../../src/renderer/modules/ui-form.js');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pages = require('../../src/renderer/modules/cognition/pages.js') as {
  renderCognitionCapture: (input: {
    state?: 'loading' | 'ready' | 'error';
    title: string;
    summary: string;
    value?: string;
    sourceLabel: string;
    suggestedType?: string;
    conversationId: string;
    messageId?: string;
    error?: string;
  }) => string;
  escapeHtml: (value: string) => string;
};

describe('cognition pages', () => {
  it('shows generation progress before exposing editable model output', () => {
    const loading = pages.renderCognitionCapture({
      state: 'loading', title: '', summary: '', value: '', sourceLabel: '', conversationId: 'conv_1',
    });
    expect(loading).toContain('data-cognition-capture-status');
    expect(loading).toContain('正在从会话中提炼可复用认知');
    expect(loading).not.toContain('data-cognition-capture-submit');

    const ready = pages.renderCognitionCapture({
      state: 'ready', title: '模型生成名称', summary: '模型生成方法', value: '模型生成价值',
      sourceLabel: '当前会话', conversationId: 'conv_1',
    });
    expect(ready).toContain('模型生成名称');
    expect(ready).toContain('模型生成方法');
    expect(ready).toContain('模型生成价值');
    expect(ready).toContain('当前会话');
    expect(ready).toContain('data-cognition-capture-submit');
  });

  it('五类分类是必填项，模型预判只作默认值', () => {
    // 气泡沉淀产出的是 recall 候选，saveRecallCandidate 会 requireAssetType，
    // 所以分类必须在面板上收齐——不能靠后端兜底猜一个。
    const withGuess = pages.renderCognitionCapture({
      state: 'ready', title: 't', summary: 's', value: 'v',
      sourceLabel: '当前会话', suggestedType: 'rule',
      conversationId: 'conv_1', messageId: 'msg_1',
    });
    expect(withGuess).toContain('data-cognition-capture-type');
    expect(withGuess).toContain('<option value="rule" selected>');
    // P-r1-50：锚点消息 id 不再进表单隐藏域（渲染后全仓零读取的死 DOM）。
    // 溯源走 draft.sourceRefs/evidenceRefs（主进程解析的真实来源 ID），
    // 表单不冒充来源引用。
    expect(withGuess).not.toContain('data-cognition-capture-message');
    expect(withGuess).not.toContain('data-cognition-capture-conversation');
    expect(withGuess).not.toContain('<input type="hidden"');

    // 模型给不出合法五类时留空占位，强制用户自己选，不替他猜一个默认分类。
    const noGuess = pages.renderCognitionCapture({
      state: 'ready', title: 't', summary: 's', value: 'v',
      sourceLabel: '当前会话', suggestedType: 'not_a_type',
      conversationId: 'conv_1', messageId: 'msg_1',
    });
    expect(noGuess).toContain('<option value="" selected>');
    expect(noGuess).not.toContain('<option value="skill_method" selected>');
  });

  it('从对话沉淀的候选保留可编辑正文、价值和来源', () => {
    const html = pages.renderCognitionCapture({
      title: '先确认边界再执行',
      summary: '先确认边界，再安排执行顺序。',
      value: '后续任务可沿用这套执行顺序。',
      sourceLabel: '任务：方案设计',
      conversationId: 'c_capture',
    });
    expect(html).toContain('data-cognition-capture-form');
    expect(html).toContain('任务：方案设计');
    expect(html).toContain('先确认边界，再安排执行顺序。');
    expect(html).toContain('后续任务可沿用这套执行顺序。');
  });

  it('转义资产和属性内容', () => {
    const html = pages.renderCognitionCapture({
      state: 'ready',
      title: '<script>alert(1)</script>',
      summary: '方法',
      sourceLabel: '当前会话',
      conversationId: 'c_xss',
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(pages.escapeHtml('"<>&\'')).toBe('&quot;&lt;&gt;&amp;&#39;');
  });

  it('死页族已删：成长页视图入口零导出（P-r3-9 守卫）', () => {
    // 「认知成长页」死页族（成长树/阶段轨/生命周期/分页模板）随 P-r3-9
    // 拍板删除，capture 弹窗模板是本模块唯一保留面。
    const pageKeys = Object.keys(pages);
    expect(pageKeys).toEqual(['escapeHtml', 'renderCognitionCapture']);
    const source = readFileSync(
      resolve(__dirname, '../../src/renderer/modules/cognition/pages.js'),
      'utf8',
    );
    expect(source).not.toContain('function renderCognitionPage');
    expect(source).not.toContain('function renderGrowthVisual');
    expect(source).not.toContain('data-cognition-view');
    expect(source).not.toContain('data-cognition-page');
  });

  it('四套 renderer locale 都包含 capture 弹窗文案', () => {
    for (const locale of ['zh', 'en', 'ja', 'pt']) {
      const strings = JSON.parse(readFileSync(
        resolve(__dirname, `../../src/renderer/locales/${locale}.json`),
        'utf8',
      )) as Record<string, string>;
      for (const key of [
        'cognition.capture.generating',
        'cognition.capture.generated',
        'cognition.capture.generation_failed',
        'cognition.capture.title',
        'cognition.capture.subtitle',
        'cognition.capture.subtitle_generating',
        'cognition.capture.name',
        'cognition.capture.summary',
        'cognition.capture.submit',
        'cognition.capture.source',
        'cognition.capture.type',
        'cognition.capture.note',
        'cognition.capture.saved',
        'cognition.action.cancel',
        'cognition.error.generic',
        'cognition.error.action_failed',
      ]) expect(strings[key], `${locale}:${key}`).toBeTruthy();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2026-09-21 认知资产迁移:HTML 原型 v7 的页签结构守护(源码级契约)。
// 2026-10-07 旧模块 personal-ontology.js 随停驻页退役删除——同名懒加载组只余
// cognition/pages.js + cognition.js + personal-context-review.js。
// ─────────────────────────────────────────────────────────────────────────────
describe('cognition-assets 五页签结构(迁移终态)', () => {
  const core2 = readFileSync(resolve(__dirname, '../../src/renderer/modules/cognition-assets/core.js'), 'utf8');
  const views2 = readFileSync(resolve(__dirname, '../../src/renderer/modules/cognition-assets/views.js'), 'utf8');
  const html2 = readFileSync(resolve(__dirname, '../../src/renderer/index.html'), 'utf8');

  /** 解析 core.js 的 TABS 数组为 [{id, titleKey}]。 */
  function parseTabs(source: string): Array<{ id: string, titleKey: string }> {
    const start = source.indexOf('const TABS = [');
    const end = source.indexOf('];', start);
    const block = source.slice(start, end);
    const tabs: Array<{ id: string, titleKey: string }> = [];
    for (const m of block.matchAll(/\{ id: '([a-z-]+)', titleKey: '([A-Za-z_.]+)'/g)) {
      tabs.push({ id: m[1], titleKey: m[2] });
    }
    return tabs;
  }

  it('TABS 保留五个位置但认知树禁用，顺序固定', () => {
    // 认知树暂禁用并由旧路由归一到「我的认知」。2026-10-08 U04:独立「待我处理」页签
    // 下线,治理动作收敛到系统活动(需要关注/已处理),旧 review 路由归一。
    // 2026-09-27 子安定序:「我的认知」提到「个人本体(关于我)」之前。
    const tabs = parseTabs(core2);
    expect(tabs.map((t) => t.id)).toEqual(['tree', 'overview', 'ontology', 'activity', 'settings']);
    expect(tabs.map((t) => t.titleKey)).toEqual([
      'cognition.tab_tree', 'cognition.tab_overview', 'cognition.tab_ontology',
      'cognition.tab_activity', 'cognition.tab_settings',
    ]);
    expect(core2).toContain("{ id: 'tree', titleKey: 'cognition.tab_tree', title: '认知树', disabled: true }");
  });

  it('默认路由是我的认知，旧树深链归一且详情键保留', () => {
    expect(core2).toContain("route: { name: 'overview'");
    expect(core2).toContain("Object.assign({ name: 'overview'");
    expect(core2).toContain("if (legacyName === 'tree') target = Object.assign({}, target, { name: 'overview' })");
    // 深链兼容:既有详情路由键一个都不能少(资产/候选/整理/版本/KSTAR)。
    for (const key of ['assetId', 'candidateId', 'captureId', 'assetVersionId', 'kstarEpisodeId', 'assetEdit']) {
      expect(core2).toContain(`${key}: ''`);
    }
    // 旧路由名在 router.go 入栈前归一(organize/organize-settings/experiences)。
    expect(core2).toContain("legacyName === 'organize-settings'");
  });

  it('认知树是独立页面,overview 列表不内嵌树图', () => {
    expect(views2).toContain('function viewTree(');
    expect(views2).toContain("route.name === 'tree'");
    expect(views2).toContain('function viewOntology(');
    // viewOverview 函数体内不调用 treeBlocks——树整卡是独立页。
    const start = views2.indexOf('function viewOverview');
    const end = views2.indexOf('\n  function ', start + 10);
    const overviewBlock = views2.slice(start, end);
    expect(overviewBlock).not.toContain('treeBlocks(');
  });

  it('页面壳只建一次:持久壳 + 内容区局部重绘(旧停驻页已退役)', () => {
    expect(views2).toContain('ca-ontology-mount');
    expect(views2).toContain('unmountPersonalOntology');
    expect(views2).toContain('ca-banner-slot');
    // 2026-10-07 退役:HTML 不再有停车区壳,core 不再有归还逻辑。
    expect(html2).not.toContain('ca-ontology-parking');
    expect(html2).not.toContain('id="panel-personal-ontology"');
    expect(core2).not.toContain('ca-ontology-parking');
    expect(core2).toContain("await load('cognition-ontology')");
    expect(core2).toContain('mountCognitionOntology(mount, options)');
    expect(core2).not.toContain('renderPersonalOntology()');
    expect(core2).not.toContain('refreshPersonalOntology');
  });

  it('五页签标题四语齐全', () => {
    for (const locale of ['zh', 'en', 'ja', 'pt'] as const) {
      const table = JSON.parse(readFileSync(resolve(__dirname, `../../src/renderer/locales/${locale}.json`), 'utf8'));
      for (const key of ['cognition.tab_tree', 'cognition.tab_ontology', 'cognition.tab_overview', 'cognition.tab_review', 'cognition.tab_activity', 'cognition.tab_settings']) {
        expect(table[key], `${locale}:${key}`).toBeTruthy();
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2026-09-21 Phase 10 a11y:tab 方向键漫游与重绘焦点保持(源码级契约)。
// ─────────────────────────────────────────────────────────────────────────────
describe('cognition-assets a11y(Phase 10)', () => {
  const app3 = readFileSync(resolve(__dirname, '../../src/renderer/modules/cognition-assets/app.js'), 'utf8');

  it('tab 行支持 ←/→/Home/End 方向键漫游(委托到 root)', () => {
    expect(app3).toContain('ArrowLeft');
    expect(app3).toContain("event.target.closest('.ca-tabs')");
    expect(app3).toContain("event.target.closest('.ca-tab')");
  });

  it('内容区重绘后焦点不落 body:按特征找回或回落首个可聚焦控件', () => {
    expect(app3).toContain('#ca-scroll');
    expect(app3).toMatch(/preventScroll/);
    expect(app3).toContain('data-go-asset="${CSS.escape');
    expect(app3).toContain('scroll.querySelector(\'button, [role="button"]\')');
  });
});
