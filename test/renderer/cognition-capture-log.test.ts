/**
 * 认知资产重构后的页面级用例：我的认知 / 本体 / 系统活动 / 设置。
 *
 * 我的认知统一列表与同区详情；系统活动处理候选和来源异常；设置呈现真实能力。
 * 这里把**真实的 views.js + vocabulary.js + ui-button.js** require 进来跑
 * （与 cognition-pages.test.ts 同一模式）：stub 只负责 window 契约，断言
 * 落在渲染产出的 HTML 上。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const rootDir = resolve(__dirname, '../..');
// 2026-09-29 views.js 机械拆分：sourceIssuesSection 等异常下钻组件随候选族迁入
// review-candidate.js / review-views.js；我的认知列表由 library.js 提供。
const viewsSource = ['views.js', 'review-candidate.js', 'review-views.js', 'library.js']
  .map((file) => readFileSync(resolve(rootDir, `src/renderer/modules/cognition-assets/${file}`), 'utf8'))
  .join('\n');
const appSource = readFileSync(resolve(rootDir, 'src/renderer/modules/cognition-assets/app.js'), 'utf8');
const coreSource = readFileSync(resolve(rootDir, 'src/renderer/modules/cognition-assets/core.js'), 'utf8');

const esc = (value: string) => String(value == null ? '' : value)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const T = (key: string, fallback: string, vars?: Record<string, string>) => {
  let text = fallback != null ? fallback : key;
  if (vars) for (const [k, v] of Object.entries(vars)) text = text.replace(`{${k}}`, String(v));
  return text;
};

const globalScope = globalThis as unknown as Record<string, unknown>;

/** 模块级装配：views.js 是 IIFE，require 只执行一次并把 render 挂在
 *  window.CogAssets 上；此后每次断言只改 store 再重画（与真实页面同构）。 */
let cogAssets: Record<string, unknown> | null = null;
let domRoot: { innerHTML: string } | null = null;
function ensureModule(): { cogAssets: Record<string, unknown>; domRoot: { innerHTML: string } } {
  if (cogAssets && domRoot) return { cogAssets, domRoot };
  cogAssets = {
    T, esc, fmtDate: () => '2026/09/15 10:00',
    TABS: [
      { id: 'tree', titleKey: 'cognition.tab_tree', title: '认知树', disabled: true },
      { id: 'overview', titleKey: 'cognition.tab_overview', title: '我的认知' },
      { id: 'ontology', titleKey: 'cognition.tab_ontology', title: '本体' },
      { id: 'activity', titleKey: 'cognition.tab_activity', title: '系统活动' },
      { id: 'settings', titleKey: 'cognition.tab_settings', title: '整理设置' },
    ],
    // stats 从 store 动态算（口径同 core.js）：attention 行的断言依赖它。
    stats: () => {
      const store = (cogAssets as Record<string, unknown>).store as Record<string, unknown>;
      const sourceIssues = ((store.sources as Array<{ items?: Array<{ kind?: string; status?: string; statusReason?: string }> }> | undefined) || [])
        .flatMap((group) => (Array.isArray(group.items) ? group.items : []))
        .filter((item) => String(item.kind || '') !== 'execution_evaluation'
          && (item.status === 'failed'
            || (item.status === 'paused' && String(item.statusReason || '') !== 'source_paused'))).length;
      const failedTasks = Number(((store.captureCounts as { failed?: number } | undefined) || {}).failed || 0);
      // G1（承接表 01）：与 core.js 的 stats 同口径——任务执行失败单独计数。
      const captureConvIds = new Set(((store.captures as Array<{ conversationId?: string }> | undefined) || [])
        .map((capture) => String(capture.conversationId || '')).filter(Boolean));
      const taskFailed = ((store.sources as Array<{ items?: Array<{ id?: string; lastTurnFailed?: boolean }> }> | undefined) || [])
        .flatMap((group) => (Array.isArray(group.items) ? group.items : []))
        .filter((item) => item && item.lastTurnFailed === true
          && !captureConvIds.has(String(item.id || ''))).length;
      return {
        confirmed: 0, pending: 0, validated: 0, transferOk: 0,
        sourceIssues, failedTasks, taskFailed, coveredAssets: 0, proofCount: 0, attention: 0,
      };
    },
    store: {
      loaded: true, loading: false, errors: [],
      route: { name: 'overview', category: '', assetId: '', candidateId: '', proofEventId: '', captureBucket: '', captureId: '', sourceIssueOpen: '' },
      captures: [], captureSettings: null,
      sources: [], proofs: [], assets: [], assetCapabilities: { versionedUpdate: true }, candidates: [],
      organizeSettingsOpen: false, organizeListExpanded: true,
    },
  };
  domRoot = { innerHTML: '' };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { uiInput, uiSwitch, uiTextarea, uiCheckbox, uiSelect } = require('../../src/renderer/modules/ui-form.js');
  const { uiEmptyState } = require('../../src/renderer/modules/ui-empty.js');
  globalScope.window = {
    CogAssets: cogAssets,
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    uiButton: require('../../src/renderer/modules/ui-button.js').uiButton,
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    uiIconButton: require('../../src/renderer/modules/ui-button.js').uiIconButton,
    // icons.js 是 IIFE 挂全局（无 CJS 导出）：先 require 触发挂载到 globalThis，
    // 再取引用给 window stub（views.js 运行时读 window.uiIconHtml）。
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    uiIconHtml: (() => { require('../../src/renderer/modules/icons.js'); return (globalThis as unknown as Record<string, unknown>).uiIconHtml; })(),
    uiInput,
    uiSwitch,
    uiTextarea,
    uiSelect,
    uiCheckbox,
    uiEmptyState,
  };
  globalScope.document = { getElementById: () => domRoot };
  // ui-status.js 是 IIFE，把 uiTag 等共享标签组件挂到 window：真机由 index.html
  // 在 lazy 加载 cognition-assets 之前先加载它（views.js 的版本行读 window.uiTag）。
  // 夹具的 window 必须和真机一样有这一层，否则测试环境比真机少东西。
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../../src/renderer/modules/ui-status.js');
  // ui-segmented-control.js 同为 index.html 静态共享层（资产编辑表单的敏感级
  // 三档控件用它，specs/010 T026）——夹具的 window 必须和真机一样有这一层。
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../../src/renderer/modules/ui-segmented-control.js');
  // ui-page-header.js 同样是 index.html 里的静态共享层（整理报告页头用它）。
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../../src/renderer/modules/ui-page-header.js');
  // ui-structure.js 提供 uiAccordion；整理设置页使用共享手风琴结构，
  // 测试装配需与 index.html 的共享 UI 加载顺序一致。
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../../src/renderer/modules/ui-structure.js');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../../src/renderer/modules/cognition-assets/vocabulary.js');
  require('../../src/renderer/modules/cognition-assets/settings.js');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../../src/renderer/modules/cognition-assets/views.js');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../../src/renderer/modules/cognition-assets/review-candidate.js');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../../src/renderer/modules/cognition-assets/review-views.js');
  require('../../src/renderer/modules/cognition-assets/library.js');
  return { cogAssets, domRoot };
}

function renderPage(routeName: string, storePatch: Record<string, unknown>, routePatch: Record<string, unknown> = {}): string {
  const { cogAssets: NS, domRoot: rootEl } = ensureModule();
  const store = NS.store as Record<string, unknown>;
  // 「真实使用」白名单由主进程随 recall.timeline.list 下发（2026-09-25 US-602）：
  // 这里给与真实载荷一致的默认值；用例要考「缺失时 fail-closed」就显式传 []。
  Object.assign(store, { realUsageKinds: ['usage_recorded', 'projection_confirmed'] }, storePatch);
  const library = NS.library as { state: Record<string, unknown> };
  Object.assign(library.state, { query: '', type: ['personal', 'rule', 'template', 'skill_method', 'fact'].includes(String(routePatch.category)) ? routePatch.category : '', status: routePatch.category === 'deleted' ? 'deleted' : 'library', scope: '', sort: 'recent', page: 1, drawer: false, closed: false, dirty: false });
  store.route = { name: routeName, category: '', assetId: '', candidateId: '', proofEventId: '', captureBucket: '', captureId: '', sourceIssueOpen: '', ...routePatch };
  rootEl.innerHTML = '';
  (NS.render as () => void)();
  const route = store.route as Record<string, unknown>;
  const dialogBodies = ['sources', 'versions', 'records'].map(kind => (NS.renderLibraryDialog as (kind: string, assetId: string, selected: unknown) => string)(kind, String(route.assetId || ''), route.assetVersionId)).join('');
  return rootEl.innerHTML + dialogBodies;
}

const selectedVersionPane = (html: string) => {
  const start = html.indexOf('class="ca-prototype-pair"');
  const end = html.indexOf('<div><strong>当前在用', start);
  return html.slice(start, end < 0 ? undefined : end);
};

const conversationSources = [{
  kind: 'conversation',
  items: [
    { id: 'conv-1', kind: 'conversation', title: 'Saying hello', updatedAt: '2026-09-15T02:00:00.000Z' },
    { id: 'conv-2', kind: 'conversation', title: 'design-review 技能用途', updatedAt: '2026-09-14T02:00:00.000Z' },
    { id: 'conv-3', kind: 'conversation', title: '查询可用的skills列表', updatedAt: '2026-09-13T02:00:00.000Z' },
    { id: 'conv-4', kind: 'conversation', title: '会议纪要模板讨论', updatedAt: '2026-09-12T02:00:00.000Z' },
    { id: 'conv-5', kind: 'conversation', title: '季度目标对齐', updatedAt: '2026-09-11T02:00:00.000Z' },
  ],
}];

const organizingCapture = {
  id: 'rcap-org', conversationId: 'conv-2', visibility: 'visible',
  conversationTitle: 'design-review 技能用途',
  status: 'extracting', bucket: 'active', displayStatus: 'extracting',
  displayReason: 'extracting', stage: 'model_extraction',
  actions: ['pause', 'cancel', 'open_conversation'],
  reviewSummary: { total: 0, pending: 0, deferred: 0, promoted: 0, rejected: 0, missing: 0 },
  updatedAt: '2026-09-15T03:00:00.000Z',
};
const failedCapture = {
  ...organizingCapture,
  id: 'rcap-fail', conversationId: 'conv-3', conversationTitle: '查询可用的skills列表',
  status: 'failed', bucket: 'attention', displayStatus: 'failed',
  displayReason: 'capture_failed', actions: ['retry', 'cancel', 'open_conversation'],
};
const silentCapture = {
  ...organizingCapture,
  id: 'rcap-silent', conversationId: 'conv-1', visibility: 'internal',
  conversationTitle: 'Saying hello',
  status: 'no_candidate', bucket: 'done', displayStatus: 'completed',
  displayReason: 'no_candidate', actions: ['open_conversation'],
};
const waitingCapture = {
  ...organizingCapture,
  id: 'rcap-wait', conversationId: 'conv-4', conversationTitle: '会议纪要模板讨论',
  status: 'waiting_manual', bucket: 'attention', displayStatus: 'waiting',
  displayReason: 'manual_start_required', actions: ['run_now', 'pause', 'cancel', 'open_conversation'],
};

const detailCapture = {
  ...organizingCapture,
  id: 'rcap-x', conversationId: 'conv-1', conversationTitle: 'Saying hello',
  attempt: 2, durationMs: 65_000,
  modelUsage: { totalTokens: 1234 },
  createdAt: '2026-09-15T01:00:00.000Z',
  startedAt: '2026-09-15T01:00:05.000Z',
  reviewSummary: { total: 3, pending: 2, deferred: 0, promoted: 1, rejected: 0, missing: 0 },
  confirmedAssetReceipts: [{ assetId: 'aa-1', assetType: 'rule', version: '1', scope: 'general', sourceRefCount: 2, reviewDecisionId: 'rd_1' }],
};

describe('信息架构：六个顶级入口与深链归一', () => {
  it('旧六视图已删净，新视图（系统活动双视角）+ 设置页 + 异常下钻组件存在', () => {
    // specs/018 + 2026-10-08 U04：独立待我处理页下线，五页签；
    // 治理动作收敛进系统活动（viewActivity：需要关注/已处理）。
    expect(coreSource).toContain("{ id: 'tree', titleKey: 'cognition.tab_tree', title: '认知树', disabled: true }");
    expect(coreSource).toContain("{ id: 'activity', titleKey: 'cognition.tab_activity'");
    expect(coreSource).toContain("{ id: 'settings', titleKey: 'cognition.tab_settings'");
    expect(coreSource).not.toContain("{ id: 'review', titleKey: 'cognition.tab_review'");
    expect(coreSource).toContain("route: { name: 'overview'");
    expect(coreSource).not.toContain("id: 'kstar-assets'");
    expect(coreSource.match(/id: '(evidence|organize-history|capture-log|manage)'/g)).toBeNull();
    for (const gone of ['function viewManage', 'function viewSourcesOverview', 'function viewSourceDetail', 'function viewOrganizeHistory', 'function viewCaptureLog', 'function organizeSettingsDrawer', 'function viewOrganizeTasks']) {
      expect(viewsSource, gone).not.toContain(gone);
    }
    expect(viewsSource).toContain('function viewActivity');
    expect(viewsSource).toContain('function viewOrganizeSettingsPage');
    expect(viewsSource).toContain('sourceIssuesSection');
    expect(viewsSource).toContain("'activity-view'");
  });

  it('旧路由/委托 case 已收敛，齿轮入口与设置页分流存在', () => {
    expect(appSource).not.toContain("case 'manage-tab'");
    expect(appSource).not.toContain("case 'go-sources'");
    expect(appSource).not.toContain("case 'open-evidence'");
    expect(appSource).not.toContain("case 'toggle-organize-settings'");
    expect(appSource).toContain("case 'toggle-source-issues'");
    // data-act 名保留（go-organize-settings），落点改新路由名 settings（specs/018）。
    expect(appSource).toContain("case 'go-organize-settings'");
    expect(appSource).toContain("router.go({ name: 'settings' })");
    expect(viewsSource).toContain('data-cognition-page-link="captures"');
  });

  it('认知树入口禁用，旧树路由回到我的认知', () => {
    expect(viewsSource).not.toContain('go-experiences');
    expect(viewsSource).not.toContain('tree_soil_experience');
    expect(coreSource).toContain("if (legacyName === 'tree') target = Object.assign({}, target, { name: 'overview' })");
    const html = renderPage('overview', { sources: [], assets: [], proofs: [], candidates: [], captures: [] });
    expect(viewsSource).toContain("tab.disabled ? ' is-disabled' : ''");
    expect(viewsSource).toContain('aria-disabled="true"');
    expect(html).not.toContain('tree-stage');
  });
});

describe('系统活动与认知设置', () => {
  const baseStore = {
    sources: conversationSources,
    captures: [organizingCapture, failedCapture, silentCapture, waitingCapture],
    captureSettings: { enabled: true, executionPolicy: 'smart', reviewPolicy: 'auto' },
  };

  it('页首整理设置按钮已删（2026-09-27 子安）：页签「整理设置」是唯一入口', () => {
    const html = renderPage('organize', baseStore);
    // 2026-09-27 保留现有六入口：设置继续在页签中，页头右侧不重复摆入口。
    expect(html).not.toContain('data-act="go-organize-settings"');
    expect(html).not.toContain('is-settings');
    expect(html).not.toContain('<svg width="18"');
    expect(html).not.toContain('ca-drawer');
    expect(html).not.toContain('toggle-organize-settings');
    // 大扫除按钮已收进整理设置页（specs/017 整改三）：页首不再有第二颗按钮。
    expect(html).not.toContain('data-act="open-cleanup"');
  });

  it('四语页签名与整理设置页标题同名，避免两处叫法漂移', () => {
    for (const locale of ['zh', 'en', 'ja', 'pt'] as const) {
      const messages = JSON.parse(
        readFileSync(resolve(rootDir, `src/renderer/locales/${locale}.json`), 'utf8'),
      ) as Record<string, string>;
      expect(messages['cognition.tab_settings']).toBe(messages['cognition.organize_settings_title']);
    }
  });

  it('列表行尾用原型 chevron、空态用共享图标（icons.js 真渲染）', () => {
    const list = renderPage('overview', { assets: [{ id: 'aa-1', title: '上线前确认', type: 'rule', status: 'active' }], sources: [], proofs: [] });
    // 行尾使用原型的 › 字符；空态仍走共享 uiEmptyState。
    expect(list).toContain('<span aria-hidden="true">›</span>');
    const emptyHtml = renderPage('overview', { assets: [], sources: [], proofs: [], candidates: [] });
    expect(emptyHtml).toContain('is-circle');
  });

  it('禁用认知树时不呈现树教学内容，资产页空态仍可去处理', () => {
    const html = renderPage('overview', { assets: [], sources: [], proofs: [], candidates: [] });
    expect(html).toContain('data-act="go-review"');
    expect(html).not.toContain('枝端光斑');
    expect(html).not.toContain('新芽（待确认）');
  });

  it('资产设置以两个独立策略开关呈现，夜间发现不联动巡检', () => {
    const off = renderPage('organize-settings', { captureSettings: { enabled: true, executionPolicy: 'manual', autoApproval: false }, captureCapabilities: { autoApproval: false } });
    expect(off).toContain('资产设置');
    expect(off).toContain('夜间发现');
    expect(off).toContain('自动批准低风险建议');
    expect(off).toContain('已暂停');
    expect(off).toContain('当前运行版本尚不支持自动批准');
    expect(off).toContain('disabled data-act="auto-approval-toggle"');
    expect(off).toContain('data-act="nightly-toggle"');
    expect(off).toContain('data-act="auto-approval-toggle"');
    expect(off).toContain('data-act="auto-approval-boundary"');
    expect(off).not.toContain('type="time"');
    expect(off).not.toContain('data-act="inspection-toggle"');
    expect(off).not.toContain('data-act="run-maintenance"');
    const on = renderPage('organize-settings', { captureSettings: { enabled: true, executionPolicy: 'nightly', autoApproval: true }, captureCapabilities: { autoApproval: true } });
    expect(on).toContain('class="ui-switch is-on" role="switch" aria-checked="true"');
    expect(on).toContain('aria-checked="true" data-act="auto-approval-toggle"');
    expect(on).toContain('默认关闭。开启不会处理当前积压');
    expect(on).not.toContain('disabled data-act="auto-approval-toggle"');
    expect(on).toContain('暂停夜间发现不改变已有认知的使用状态，也不切换资产巡检');
    expect(on).toContain('data-act="settings-open-assets"');
    expect(on).toContain('data-act="open-cleanup"');
    expect(on).not.toContain('高级：隐私与暂停夜间发现');
    expect(on).not.toContain('data-act="capture-review-toggle"');
  });

  it('资产页不再提供标签库，资产设置说明增量窗口与真实通道', () => {
    const html = renderPage('settings', {
      captureSettings: {
        enabled: true, executionPolicy: 'nightly', reviewPolicy: 'manual',
        nightlyStart: '02:30', quietMinutes: 17,
      },
      captureModel: { channel: 'api', available: true, configured: true, authorizationRequired: false },
    });
    expect(html).toContain('默认 02:00–06:00');
    expect(html).toContain('首次开启不回扫全部历史');
    expect(html).not.toContain('ca-settings-model');
    expect(html).not.toContain('如有新消息，会重新计时');
    expect(html).not.toContain('ca-settings-model');
    const assets = renderPage('overview', { assets: [] });
    expect(assets).not.toContain('data-act="tag-manage"');
    expect(assets).not.toContain('data-act="tag-add"');
    expect(appSource).not.toContain("case 'tag-manage'");
    expect(coreSource).toContain("for (const key of ['tagFilter', 'tagMode', 'tagUntagged', 'tagSelect', 'tagOverlay']) delete target[key]");
  });

  it('整理设置页大扫除 section：有报告时给摘要与完整报告入口（specs/017 整改三）', () => {
    const html = renderPage('organize-settings', {
      captureSettings: { enabled: true, executionPolicy: 'manual', reviewPolicy: 'auto', nightlyStart: '02:00' },
      cleanupReports: {
        loading: false,
        reports: [{ id: 'cl-1', createdAt: '2026-09-25T02:00:00.000Z', scanned: 30, items: [{ status: 'applied' }, { status: 'skipped' }], uncertain: [{ assetId: 'aa-1' }] }],
      },
    });
    expect(html).toContain('最近整理报告');
    expect(html).toContain('data-act="open-cleanup"');
    expect(html).toContain('查看整理报告');
  });

  it('寒暄与无回复会话不进系统活动两列表（C-05：已跳过不灌入）', () => {
    const store = {
      sources: [{ kind: 'conversation', items: [
        { id: 'conv-failed', kind: 'conversation', title: '没等到回复的会话', updatedAt: '2026-09-15T04:00:00.000Z', lastTurnFailed: true },
        { id: 'conv-chat', kind: 'conversation', title: '打个招呼', updatedAt: '2026-09-15T03:00:00.000Z', chatLike: true },
        { id: 'conv-real', kind: 'conversation', title: '正经工作', updatedAt: '2026-09-15T02:00:00.000Z' },
      ] }],
      captures: [], captureSettings: baseStore.captureSettings,
    };
    for (const page of [renderPage('organize', store), renderPage('organize', store, { activityDone: '1' })]) {
      expect(page).not.toContain('没等到回复的会话');
      expect(page).not.toContain('打个招呼');
      expect(page).not.toContain('正经工作');
      expect(page).not.toContain('纯寒暄');
    }
  });

  it('消息级溯源项（subtype:message）不进系统活动', () => {
    const store = {
      ...baseStore,
      sources: [{ kind: 'conversation', items: [
        { id: 'conv-a', kind: 'conversation', subtype: 'session', title: '真实会话', updatedAt: '2026-09-15T02:00:00.000Z' },
        { id: 'msg-de01145145dc9f9b355a73b6', kind: 'conversation', subtype: 'message', sourceVersion: '2026-09-15T01:00:00.000Z' },
      ] }],
      captures: [],
    };
    const html = renderPage('organize', store);
    expect(html).not.toContain('msg-de0114');
    expect(html).not.toContain('真实会话');
  });

  it('来源拉取上限守卫保留（limit:100 供证据解析；全量会话清单已退役）', () => {
    expect(coreSource).toContain("'recall.sources.list', { limit: 100 }");
    const html = renderPage('organize', { ...baseStore, sources: [{ kind: 'conversation', items: [] }] });
    expect(html).not.toContain('仅显示最近');
  });

  it('夜间等待、暂停和失败记录不得显示已经整理完成', () => {
    for (const status of ['waiting_manual', 'waiting_quiet', 'scheduled', 'paused', 'failed', 'configuration_required']) {
      const html = renderPage('activity', { ...baseStore, captures: [{
        id: 'rcap-waiting', conversationId: 'conv-1', conversationTitle: '等待中的验收任务',
        status, displayStatus: 'waiting', displayReason: 'manual_policy', bucket: 'attention',
        executionPolicy: 'nightly', actions: [], reviewSummary: { pending: 0, total: 0 },
      }] });
      expect(html).not.toContain('夜间整理完成');
    }
  });

  it('旧目录深链进入统一列表工作台，不再出现管理模式入口', () => {
    const deepLink = renderPage('overview', { assets: [], proofs: [], sources: [] }, { assetView: 'catalog' });
    expect(deepLink).toContain('ca-library-page');
    expect(deepLink).toContain('data-library-filter="type"');
    expect(deepLink).toContain('data-library-filter="status"');
    expect(deepLink).not.toContain('退出管理');
    expect(deepLink).not.toContain('data-act="overview-manage-toggle"');
  });

  it('静默筛掉的会话不进两列表（C-05：已跳过不灌入已处理）', () => {
    const html = renderPage('organize', baseStore);
    const done = renderPage('organize', baseStore, { activityDone: '1' });
    for (const page of [html, done]) {
      expect(page).not.toContain('Saying hello');
      expect(page).not.toContain('整理完成，没有发现需要保存的内容');
    }
  });

  it('全量会话清单退役：普通会话（无论标记）不再逐行出现，需要关注只收可操作捕获', () => {
    const store = {
      ...baseStore,
      sources: [{ kind: 'conversation', items: [
        { id: 'conv-full', kind: 'conversation', title: '完整的多轮会话', updatedAt: '2026-09-15T02:00:00.000Z', messageCount: 8 },
        { id: 'conv-tiny', kind: 'conversation', title: '打个招呼而已', updatedAt: '2026-09-14T02:00:00.000Z', messageCount: 2, chatLike: true },
      ] }],
      captures: [], candidates: [], inbox: [], inboxGroups: null, poCandidates: [],
    };
    const html = renderPage('organize', store);
    expect(html).not.toContain('完整的多轮会话');
    expect(html).not.toContain('打个招呼而已');
    expect(html).toContain('需要关注 0');
  });
});

describe('整理详情页', () => {
  it('展示状态、当前步骤、时间与用量，动作与打开会话/返回齐备', () => {
    const html = renderPage('organize', { captures: [detailCapture], sources: [] }, { captureId: 'rcap-x' });
    expect(html).toContain('Saying hello');
    expect(html).toContain('正在提炼候选');
    expect(html).toContain('模型提炼中');
    expect(html).toContain('1 分 5 秒');
    // 模型用量白话（2026-09-28 两页重整）：单位进标签，值只出数字。
    expect(html).toContain('模型用量（token）');
    expect(html).toContain('1234');
    expect(html).toContain('data-action="pause"');
    expect(html).toContain('data-act="open-conversation" data-id="conv-1"');
    expect(html).toContain('data-act="go-back"');
  });

  it('页头与建议详情同款（2026-09-29 版式统一）：固定标题+说明，会话标题降为卡内 h2，统计卡撤', () => {
    const html = renderPage('organize', { captures: [detailCapture], sources: [] }, { captureId: 'rcap-x' });
    // 页头 = 返回行 + 固定标题「整理任务详情」+ 一行说明（与建议详情同构，
    // 不再把会话标题/原因/统计卡塞进页头）。
    expect(html).toContain('整理任务详情');
    expect(html).toContain('查看这场对话的整理任务、进度和结果。');
    // 会话标题降为卡片内 h2（同候选详情的 cand-title 标题位）。
    expect(html).toContain('<h2 class="cand-title">Saying hello</h2>');
    // 尝试次数并入元信息行（原统计卡第三格的信息保留）。
    expect(html).toContain('尝试次数');
    // 统计卡带不再出现在任务详情页（「待确认/已保存资产」计数看下方分区）。
    expect(html).not.toContain('class="stats"');
    // 单卡文档式（2026-09-29 第二步，同建议详情）：整理结果/对话上下文是
    // 主体卡内的分节（分隔线区隔），不再是散在外面的独立卡片。
    expect(html).toContain('ca-capture-sections');
    expect(html).not.toContain('ca-detail-duo');
    expect(html).not.toContain('ca-result-card');
    expect(html).toContain('整理结果');
    expect(html).toContain('对话上下文');
    // 卡底一行（2026-09-29 子安拍板）：进度条从标题下方挪到卡底、靠左，
    // 按钮靠右——顺序=分节之后先进度条、后按钮。
    const stepsAt = html.indexOf('ca-steps-bar');
    const footBtnAt = html.indexOf('data-act="open-conversation"');
    expect(stepsAt).toBeGreaterThan(html.indexOf('整理结果'));
    expect(footBtnAt).toBeGreaterThan(stepsAt);
    // 标题正下方不再挂进度条（此前搞反的位置）。
    const titleAt = html.indexOf('<h2 class="cand-title">');
    expect(html.slice(titleAt, titleAt + 400)).not.toContain('ca-steps-bar');
  });

  it('整理过程五步进度条：stage 高亮当前步、已过步打勾', () => {
    const html = renderPage('organize', { captures: [detailCapture], sources: [] }, { captureId: 'rcap-x' });
    expect(html).toContain('ca-steps-bar');
    expect(html).toContain('ca-step is-current">模型提炼中');
    expect(html).toContain('ca-step is-done">读取会话内容');
    expect((html.match(/ca-step(?!s)/g) || []).length).toBeGreaterThanOrEqual(5);
    // 非提炼期（无 stage）不显示进度条。
    const idle = renderPage('organize', {
      captures: [{ ...detailCapture, stage: undefined, status: 'waiting_manual', displayStatus: 'waiting' }],
      sources: [],
    }, { captureId: 'rcap-x' });
    expect(idle).not.toContain('ca-steps-bar');
  });

  it('已保存资产并入整合卡并内联完整正文：不靠跳转就能看到保存了什么', () => {
    const html = renderPage(
      'organize',
      { captures: [detailCapture], sources: [], assets: [{ id: 'aa-1', title: '上线前必须确认影响范围', type: 'rule', status: 'active', statement: '上线前必须确认影响范围：用真实日志分层归因，不允许拍脑袋给结论。' }] },
      { captureId: 'rcap-x' },
    );
    expect(html).toContain('已保存资产');
    expect(html).toContain('上线前必须确认影响范围');
    // 沉淀的具体内容直接展示（statement 内联），而非只有跳转按钮。
    expect(html).toContain('用真实日志分层归因，不允许拍脑袋给结论。');
    expect(html).toContain('data-act="open-asset" data-id="aa-1"');
    // 合并：资产区随整合卡渲染，不再有独立的资产卡；2026-09-29 单卡统一后
    // 结果/上下文也并入主体卡——整页只有 1 张内容卡（同建议详情）。
    expect((html.match(/class="card[ ">]/g) || []).length).toBe(1);
    // 卡头不再出「查看资产」主按钮（明细已在卡内，与 review_candidates 同规则过滤）。
    expect(html).not.toContain('data-action="view_assets"');
  });

  it('快照缺该资产（已删除）时退回类型·版本，不裸出内部 id', () => {
    const html = renderPage('organize', { captures: [detailCapture], sources: [], assets: [] }, { captureId: 'rcap-x' });
    expect(html).toContain('规则与偏好 · v1');
  });

  it('任务不存在时给兜底文案，不白屏', () => {
    const html = renderPage('organize', { captures: [], sources: [] }, { captureId: 'rcap-gone' });
    expect(html).toContain('这条整理任务不存在或已被清理');
  });

  // ── 2026-09-15 详情页改造：结果三态 + 对话上下文 + 证据映射 ──

  const contextData = {
    captureId: 'rcap-x',
    conversationId: 'conv-1',
    conversationTitle: 'Saying hello',
    participants: [
      { id: 'user', name: 'user', kind: 'user' },
      { id: 'commander', name: 'commander', kind: 'commander' },
      { id: 'worker-a', name: '代码评审员', kind: 'agent' },
    ],
    messages: [
      { id: 'msg-1', label: 'm1', ts: '2026-09-15T01:00:00.000Z', role: 'user', from: 'user', to: [], text: '帮我把上线前的检查做成清单。', truncated: false, artifacts: [], sourceId: 'msg-aaa' },
      { id: 'msg-2', label: 'm2', ts: '2026-09-15T01:01:00.000Z', role: 'assistant', from: 'commander', to: ['user'], text: '已生成上线检查清单，包含 12 项。', truncated: false, artifacts: [{ id: 'art-1', title: '上线检查清单' }], sourceId: 'msg-bbb' },
      { id: 'msg-3', label: 'm3', ts: '2026-09-15T01:02:00.000Z', role: 'assistant', from: 'worker-a', to: ['user'], text: '第二条也补上了。', truncated: false, artifacts: [], sourceId: 'msg-ccc' },
    ],
  };
  const contextStore = { captureContext: { captureId: 'rcap-x', data: contextData } };

  it('未保存候选：完整内容块（判断全文 + 类型/作用域 + 证据映射），不再只剩一行标题', () => {
    const candidate = {
      id: 'rcand-1', status: 'rejected',
      judgment: '上线前必须确认影响范围再发布。', value: '', summary: '上线前确认影响范围',
      suggestedType: 'rule', suggestedScope: 'general',
      evidenceRefs: [{ id: 'msg-aaa' }, { id: 'msg-bbb' }],
    };
    const html = renderPage('organize', {
      captures: [{ ...detailCapture, candidateIds: ['rcand-1'], status: 'completed', displayStatus: 'completed', displayReason: 'review_completed', confirmedAssetReceipts: [], reviewSummary: { total: 1, pending: 0, deferred: 0, promoted: 0, rejected: 1, missing: 0 } }],
      sources: [], candidates: [candidate],
      ...contextStore,
    }, { captureId: 'rcap-x' });
    expect(html).toContain('整理结果');
    // 完整内容块：判断全文（非截断标题）+ 类型 + 作用域 + 未保存标记。
    expect(html).toContain('ca-result-item');
    expect(html).toContain('上线前必须确认影响范围再发布。');
    expect(html).toContain('规则与偏好');
    expect(html).toContain('未保存');
    expect(html).toContain('来自消息 m1');
    // 卡头三态：已完成 · 未保存。
    expect(html).toContain('已完成 · 未保存');
    // 内容已内联，行级跳转入口移除。
    expect(html).not.toContain('data-act="open-candidate"');
  });

  it('P-r1-55：队列窗口外的旧任务读 candidateOutcomes 内联投影，不误报「没有发现值得留存的内容」', () => {
    // 生产条件复现：review-queue 视图只含最近 5 条处理记录（core.js
    // BLOCK_FETCHERS.candidates），旧任务的候选不在 S.candidates 里——
    // 此前详情页 join 队列全落空，「整理结果」被误报成空态，与同页
    // 「已保存资产」区自相矛盾。数据层修（P-r1-55）：投影由主进程
    // summarize 全量读池后内联进 workflow 记录，详情页直接读记录。
    const html = renderPage('organize', {
      captures: [{
        ...detailCapture,
        candidateIds: ['rcand-old-1'],
        status: 'completed', displayStatus: 'completed', displayReason: 'review_completed',
        confirmedAssetReceipts: [],
        reviewSummary: { total: 1, pending: 0, deferred: 0, promoted: 0, rejected: 1, missing: 0 },
        candidateOutcomes: [{
          id: 'rcand-old-1', status: 'rejected',
          judgment: '旧任务产出的判断全文，队列窗口已裁掉但记录仍在。', value: '',
          summary: '旧任务的候选', suggestedType: 'rule', suggestedScope: 'general',
          sourceRefs: [], evidenceRefs: [{ id: 'msg-aaa' }],
          capabilities: { canEdit: false, canPromote: false, countsAsPending: false, isTerminal: true },
        }],
      }],
      sources: [], candidates: [], // 队列为空 = join 全落空（bug 触发条件）
      ...contextStore,
    }, { captureId: 'rcap-x' });
    // 结果区出完整内容块（投影驱动），不再误报空态。
    expect(html).toContain('ca-result-item');
    expect(html).toContain('旧任务产出的判断全文，队列窗口已裁掉但记录仍在。');
    expect(html).not.toContain('没有发现值得留存的内容');
    // 卡头三态同步受益：队列外的被拒候选不再丢失「已完成 · 未保存」徽标。
    expect(html).toContain('已完成 · 未保存');
  });

  it('已保存：卡头「已完成 · 已保存」，成果由已保存资产区代表', () => {
    const confirmed = {
      id: 'rcand-4', status: 'confirmed', promotedAssetId: 'aa-1',
      judgment: '接口变更要同步更新文档。', value: '', summary: '',
      suggestedType: 'template', suggestedScope: 'general',
      capabilities: { canEdit: false, canPromote: false, countsAsPending: false, isTerminal: true },
    };
    const html = renderPage('organize', {
      captures: [{ ...detailCapture, candidateIds: ['rcand-4'], status: 'completed', displayStatus: 'completed', displayReason: 'review_completed', reviewSummary: { total: 1, pending: 0, deferred: 0, promoted: 1, rejected: 0, missing: 0 } }],
      sources: [], candidates: [confirmed],
      assets: [{ id: 'aa-1', title: '接口变更文档同步', type: 'template', status: 'active', statement: '接口变更后必须同步更新对应文档。' }],
      ...contextStore,
    }, { captureId: 'rcap-x' });
    expect(html).toContain('已完成 · 已保存');
    // 成果在已保存资产区（完整 statement 内联）。
    expect(html).toContain('已保存资产');
    expect(html).toContain('接口变更后必须同步更新对应文档。');
    // 结果区不重复列已保存候选。
    expect(html).not.toContain('接口变更要同步更新文档。');
  });

  it('待确认候选出完整内容块（可点直达确认页）+「去待我处理」总览出口：确认动作收敛到待我处理，不在整理详情就地编辑', () => {
    const pending = {
      id: 'rcand-2', status: 'pending_review',
      judgment: '发布前先跑一遍冒烟清单。', value: '', summary: '发布前冒烟',
      suggestedType: 'skill_method', suggestedScope: 'general',
      evidenceRefs: [{ id: 'msg-aaa' }],
      capabilities: { canEdit: true, canPromote: true, canReject: true, countsAsPending: true, isSnoozed: false },
    };
    const html = renderPage('organize', {
      captures: [{ ...detailCapture, candidateIds: ['rcand-2'], status: 'review_ready', displayStatus: 'review_ready', displayReason: 'review_pending' }],
      sources: [], candidates: [pending],
      ...contextStore,
    }, { captureId: 'rcap-x' });
    // 内嵌确认表单已删（审计 R1③）：不再有任何表单控件与就地确认动作。
    expect(html).not.toContain('ca-pending-embed');
    expect(html).not.toContain('ca-card ca-candidate-detail');
    expect(html).not.toContain('data-f="judgment"');
    expect(html).not.toContain('data-act="cand-type"');
    expect(html).not.toContain('data-act="cand-adopt-with-form" data-id="rcand-2"');
    expect(html).not.toContain('data-act="cand-decide"');
    expect(html).not.toContain('ca-cand-judgment-rcand-2');
    // 整理结果区：数量行 + 待确认完整内容块（可点直达确认页）+ 总览出口。
    expect(html).toContain('发现 1 条待确认内容');
    // 2026-09-29 子安：具体内容必须在本页可见——块含标题与全文，整块
    // open-candidate 深链直达该条的确认页；不再只给一行摘要让人去大队列翻。
    expect(html).toContain('ca-result-item is-clickable');
    expect(html).toContain('data-act="open-candidate" data-id="rcand-2"');
    expect(html).toContain('待确认');
    expect(html).toContain('发布前冒烟');
    expect(html).toContain('data-act="go-review"');
    // 卡头=状态与元信息一行；动作按钮已沉卡尾（2026-09-29 子安拍板，同建议
    // 详情的卡尾 actions-right）——卡头不再有按钮排。
    const headAt = html.indexOf('ca-capture-head');
    expect(headAt).toBeGreaterThan(-1);
    const headSection = html.slice(headAt, html.indexOf('ca-capture-head') + 2000);
    expect(headSection).toContain('模型用量');
    expect(headSection).toContain('meta-row');
    expect(headSection).not.toContain('ca-head-actions');
    expect(headSection).not.toContain('data-act="open-conversation"');
    // 动作行在卡尾：位置在对话上下文分节之后。
    const footAt = html.indexOf('data-act="open-conversation"');
    expect(footAt).toBeGreaterThan(html.indexOf('消息时间线'));
    expect(html).toContain('meta-item');
    expect(html).not.toContain('ca-kv');
  });

  it('混合候选：待确认与未保存都出完整内容块（待确认可点直达），页面无表单控件', () => {
    const pending = {
      id: 'rcand-2', status: 'pending_review',
      judgment: '发布前先跑一遍冒烟清单。', value: '', summary: '',
      suggestedType: 'rule', suggestedScope: 'general',
      capabilities: { canEdit: true, canPromote: true, countsAsPending: true, isSnoozed: false },
    };
    const rejected = {
      id: 'rcand-3', status: 'rejected',
      judgment: '接口变更要同步更新文档。', value: '', summary: '',
      suggestedType: 'template', suggestedScope: 'general',
      capabilities: { canEdit: false, canPromote: false, countsAsPending: false, isTerminal: true },
    };
    const html = renderPage('organize', {
      captures: [{ ...detailCapture, candidateIds: ['rcand-2', 'rcand-3'], status: 'review_ready', displayStatus: 'review_ready' }],
      sources: [], candidates: [pending, rejected],
      ...contextStore,
    }, { captureId: 'rcap-x' });
    expect(html).toContain('发现 1 条待确认内容');
    expect(html).toContain('data-act="go-review"');
    // 未保存候选：完整内容块（全文可见）。
    expect(html).toContain('接口变更要同步更新文档。');
    expect(html).toContain('ca-result-item');
    // 待确认块可点直达确认页；未保存块不挂深链（终态无确认页可去）。
    expect(html).toContain('data-act="open-candidate" data-id="rcand-2"');
    expect(html).not.toContain('data-act="open-candidate" data-id="rcand-3"');
    expect(html).not.toContain('ca-cand-judgment-rcand-3');
    // 内嵌表单删除后，整页没有任何候选编辑控件。
    expect(html).not.toContain('data-f="judgment"');
  });

  it('候选卡标题优先用模型生成的 summary（2026-09-16：此前 judgment 截断优先，名字成了内容前缀）', () => {
    const mk = (over) => ({
      id: 'rcand-t', status: 'pending_review', suggestedType: 'rule', suggestedScope: 'general',
      capabilities: { canEdit: true, canPromote: true, countsAsPending: true, isSnoozed: false },
      ...over,
    });
    const review = (cands) => renderPage('review', { sources: [conversationSources[0]], candidates: cands });
    // summary 优先：列表行标题=模型短标题。
    const withSummary = review([mk({ judgment: '接口变更后必须同步更新文档，并在群里同步告知，同时留档到 wiki。', summary: '接口变更同步文档' })]);
    expect(withSummary).toContain('接口变更同步文档');
    // 无 summary 的存量候选：类别 + 判断前 12 字的克制兜底，不再裸截 60 字。
    const noSummary = review([mk({ judgment: '发布前先跑一遍冒烟清单，确认核心链路无回归再上线。', summary: '' })]);
    expect(noSummary).toContain('规则与偏好 · 发布前先跑一遍冒烟清');
    // 标题行不再包含判断的后半段（旧口径截 60 字会整段露出；内容区全文属正常）。
    expect(noSummary).not.toMatch(/ca-row-title[^>]*>[^<]*确认核心链路无回归/);
    // 两者皆空：未命名兜底。
    const empty = review([mk({ judgment: '', summary: '' })]);
    expect(empty).toContain('未命名候选');
  });

  it('稍后处理使用独立活动标记，旧静音与恢复生命周期不重启', () => {
    expect(viewsSource).toContain("'recall.candidates.defer'");
    expect(viewsSource).toContain('activityDeferredAt');
    expect(coreSource).not.toContain("'recall.candidates.resume'");
  });

  it('更新候选的差异确认卡：旧版对照 + 版本核对提示（2026-09-16 版本组）', () => {
    const target = {
      id: 'aa-t1', title: '接口变更同步文档', type: 'rule', status: 'active',
      scope: 'general', statement: '接口变更后必须同步更新对应文档，并在群里告知。', version: '2', activeVersion: '2',
    };
    const update = {
      id: 'rcand-u', status: 'pending_review',
      judgment: '接口变更后必须同步更新对应文档与 wiki，并在群里告知；紧急变更可先口头同步。', value: '', summary: '接口变更同步文档修订',
      suggestedType: 'rule', suggestedScope: 'general',
      suggestedAction: 'update', targetAssetId: 'aa-t1', targetVersionUsed: '1',
      capabilities: { canEdit: true, canPromote: true, countsAsPending: true, isSnoozed: false },
    };
    const review = renderPage('review', { sources: [conversationSources[0]], candidates: [update], assets: [target] }, { candidateId: 'rcand-u' });
    // 差异卡：旧版全文可见（对照新内容可编辑区）。
    expect(review).toContain('当前版本（v2）');
    expect(review).toContain('接口变更后必须同步更新对应文档，并在群里告知。');
    // 版本核对：任务用的是 v1、当前在用 v2 → 提示核对改进对象。
    expect(review).toContain('任务当时使用的是 v1');
    expect(review).toContain('当前在用 v2');
    // 版本一致时不出核对提示。
    const aligned = { ...update, targetVersionUsed: '2' };
    const reviewAligned = renderPage('review', { sources: [conversationSources[0]], candidates: [aligned], assets: [target] }, { candidateId: 'rcand-u' });
    expect(reviewAligned).not.toContain('任务当时使用的是');
  });

  it('版本块溯源行（2026-09-16/17 下沉改）：快照带 learningProvenance 时标来源，无信号不出该行', () => {
    const asset = {
      id: 'aa-src', title: '性能类提问需用真实日志做分层归因', type: 'rule', status: 'active',
      scope: 'general', version: '2', activeVersion: '1', updatedAt: '2026-09-15T00:00:00.000Z',
    };
    const versions = {
      assetId: 'aa-src', usage: [],
      versions: [
        { assetId: 'aa-src', version: '1', at: '2026-09-14T01:00:00.000Z', snapshot: { title: 'T', statement: 'S', evidenceRefs: [], learningProvenance: { projectionId: 'proj-x', episodeId: 'kse-y', attribution: 'execution_gap' } } },
        { assetId: 'aa-src', version: '2', at: '2026-09-15T01:00:00.000Z', snapshot: { title: 'T', statement: 'S', evidenceRefs: [] } },
      ],
    };
    // 有 provenance 的 v1 展开：来源行在版本块内。
    const open = renderPage('overview', { assets: [asset], proofs: [], sources: [], assetVersions: versions }, { assetId: 'aa-src', assetVersionId: '1' });
    expect(open).toContain('来自那次任务的复盘');
    // 无信号快照（v2）展开：不出该行。
    const plain = renderPage('overview', { assets: [asset], proofs: [], sources: [], assetVersions: versions }, { assetId: 'aa-src', assetVersionId: '2' });
    expect(selectedVersionPane(plain)).not.toContain('来自那次任务的复盘');
  });

  it('KSTAR 证据与来源按版本显示（2026-09-17 下沉）：版本展开块内出证据 chips、KSTAR 来源行，点开「这次任务的经过」', () => {
    // 快照级的证据与信号：evidenceRefs/learningSignal 都冻在版本快照里——
    // 顶部不再显示资产级副本，全部进版本展开块。
    const asset = {
      id: 'aa-k1', title: '不用比喻回答', type: 'personal', status: 'active',
      scope: 'general', version: '2', activeVersion: '1', updatedAt: '2026-09-16T00:00:00.000Z',
    };
    const versions = {
      assetId: 'aa-k1', usage: [],
      versions: [
        { assetId: 'aa-k1', version: '1', at: '2026-09-10T01:00:00.000Z', reason: 'review_decision:rd_x', snapshot: { title: '不用比喻回答', statement: 'S1', scope: 'general', evidenceRefs: [{ id: 'kse-abc123', kind: 'execution', title: 'KSTAR requirement episode' }], learningSignal: { deltaR: 'unknown', deltaA: 'unknown', outcome: 'met_expected', confidence: 0.9, source: 'preference_scan' } } },
        { assetId: 'aa-k1', version: '2', at: '2026-09-15T01:00:00.000Z', reason: 'user manual edit', snapshot: { title: '不用比喻回答', statement: 'S2', scope: 'general', evidenceRefs: [] } },
      ],
    };
    // ① 展开带 KSTAR 信号的 v1：证据 chips + 来源行都在版本块里；顶部无两折叠区。
    const open = renderPage('overview', {
      assets: [asset], proofs: [], sources: [], assetVersions: versions,
      kstarSummaries: { 'kse-abc123': { id: 'kse-abc123', goal: '我想知道你的认知资产是怎么存的？', status: 'completed', at: '' } },
    }, { assetId: 'aa-k1', assetVersionId: '1' });
    expect(open).not.toContain('详细信息');
    expect(open).toContain('来自偏好扫描');
    expect(open).toContain('data-act="open-kstar-episode" data-id="kse-abc123"');
    expect(open).toContain('任务复盘：我想知道你的认知资产是怎么存的');
    // ② 点开态（route.kstarEpisodeId）：「这次任务的经过」就地出现在版本块内，
    // 白话化（标题/行标签/归因枚举翻译）。
    const episode = renderPage('overview', {
      assets: [asset], proofs: [], sources: [], assetVersions: versions, kstarSummaries: null,
      kstarEpisode: { episodeId: 'kse-abc123', episode: { id: 'kse-abc123', goal: '我想知道你的认知资产是怎么存的？' }, review: { expectedResult: '给出技术结论', actualResult: '调用失败', outcome: 'worse_than_expected', attribution: 'execution_gap', lesson: '查模型配置类问题时，应从运行日志交叉验证，不要依赖模型自述。' } },
    }, { assetId: 'aa-k1', assetVersionId: '1', kstarEpisodeId: 'kse-abc123' });
    expect(episode).toContain('这次任务的经过');
    expect(episode).toContain('当时的任务');
    expect(episode).toContain('给出技术结论');
    expect(episode).toContain('比预期差');
    expect(episode).toContain('执行环节没做到位');
    expect(episode).not.toContain('execution_gap');
    expect(episode).toContain('沉淀的经验');
    expect(episode).toContain('查模型配置类问题时，应从运行日志交叉验证');
    expect(episode).toContain('ca-episode-detail');
    // ③ 展开无证据的 v2：不渲染证据 chips，也无来源行。
    const openV2 = renderPage('overview', {
      assets: [asset], proofs: [], sources: [], assetVersions: versions,
    }, { assetId: 'aa-k1', assetVersionId: '2' });
    expect(selectedVersionPane(openV2)).not.toContain('open-kstar-episode');
    expect(openV2).not.toContain('来自 KSTAR');
  });

  it('两线真实归边判定保留，统一列表按正式类型展示，来源在详情查看', () => {
    const { cogAssets: NS } = ensureModule();
    const isKstarAsset = NS.isKstarAsset as (a: Record<string, unknown>) => boolean;
    const isKstarCandidate = NS.isKstarCandidate as (c: Record<string, unknown>) => boolean;
    // 归边口径=证据法：kse- 执行证据或 KSTAR 学习信号；reason=review_decision
    // 不是判据（对话线确认也写它，两线共用确认队列）。
    expect(isKstarAsset({ evidenceRefs: [{ kind: 'execution', id: 'kse-1' }] })).toBe(true);
    expect(isKstarAsset({ learningSignal: { source: 'preference_scan' } })).toBe(true);
    expect(isKstarAsset({ learningProvenance: { episodeId: 'kse-1' } })).toBe(true);
    expect(isKstarAsset({ evidenceRefs: [{ kind: 'conversation', id: 'conv-1', subtype: 'session' }] })).toBe(false);
    // kse- id 但 kind 非 execution（防误判）。
    expect(isKstarAsset({ evidenceRefs: [{ kind: 'conversation', id: 'kse-1' }] })).toBe(false);
    expect(isKstarCandidate({ learningSignal: { source: 'review' } })).toBe(true);
    expect(isKstarCandidate({ sourceRefs: [{ id: 'kse-1' }] })).toBe(true);
    expect(isKstarCandidate({ sourceRefs: [{ id: 'msg-1' }] })).toBe(false);

    const chatAsset = { id: 'aa-chat', title: '对话沉淀资产', type: 'rule', status: 'active', version: '1', updatedAt: '2026-09-15T00:00:00.000Z', evidenceRefs: [{ kind: 'conversation', id: 'conv-1', subtype: 'session' }] };
    const kstarAsset = { id: 'aa-kstar', title: 'KSTAR 沉淀资产', type: 'personal', status: 'active', version: '1', updatedAt: '2026-09-16T00:00:00.000Z', evidenceRefs: [{ kind: 'execution', id: 'kse-9' }] };
    // 单列表两线混排（2026-09-17 二次定调）：不分区，出身靠徽章。
    const html = renderPage('overview', { assets: [chatAsset, kstarAsset], proofs: [], sources: [], kstarEpisodes: [] });
    expect(html).toContain('对话沉淀资产');
    expect(html).toContain('KSTAR 沉淀资产');
    // 新列表按内容类型与使用范围浏览，来源细节保留在右侧下钻。
    expect(html).toContain('ca-library-table');
    expect(html).toContain('library-show-sources');
    expect(html).not.toContain('data-act="filter-cat" data-id="kstar"');
    expect(html).not.toContain('data-act="filter-cat" data-id="experiences"');
    // 旧 category:'kstar' 深链归一化到「全部」：两线同列，不再互斥过滤。
    const legacy = renderPage('overview', { assets: [chatAsset, kstarAsset], proofs: [], sources: [], kstarEpisodes: [] }, { category: 'kstar' });
    expect(legacy).toContain('KSTAR 沉淀资产');
    expect(legacy).toContain('对话沉淀资产');
  });

  it('版本号显示在用版（2026-09-17 子安实测）：删掉 v3-v5 后游标停在 v5，界面上该显示在用的 v2', () => {
    // 新列表不摆版本号，选中条目的详情标明真实在用版。
    const asset = { id: 'aa-v', title: '版本号显示', type: 'rule', status: 'active', version: '5', activeVersion: '2', updatedAt: '2026-09-16T00:00:00.000Z' };
    const catalog = renderPage('overview', {
      assets: [asset], proofs: [], sources: [], kstarEpisodes: [],
    }, { assetView: 'catalog' });
    expect(catalog).toContain('在用 v2');
    expect(catalog).not.toContain('在用版本 v5');
    const detail = renderPage('overview', {
      assets: [asset], proofs: [], sources: [], kstarEpisodes: [], assetId: 'aa-v',
    });
    expect(detail).not.toContain('v5 ·');
  });

  it('我的认知不再在页尾重复列任务复盘，保留资产来源下钻入口', () => {
    const rows = renderPage('overview', {
      assets: [], proofs: [], sources: [],
      kstarEpisodes: [{ id: 'kse-1', goal: '查认知资产是怎么存的', createdAt: '2026-09-17T10:00:00.000Z' }],
    });
    expect(rows).toContain('ca-library-page');
    expect(rows).not.toContain('class="details ca-kstar-episodes"');
    expect(rows).not.toContain('data-act="open-kstar-episode"');
    expect(rows).not.toContain('查认知资产是怎么存的');
    expect(rows).toContain('这里还没有已保存的认知');
  });

  it('证据分组（2026-09-17 B 档）：版本块内 KSTAR 任务复盘 / 对话与表态 两组分开带说明', () => {
    const asset = { id: 'aa-mix', title: '混两线证据', type: 'rule', status: 'active', version: '2', activeVersion: '2', updatedAt: '2026-09-16T00:00:00.000Z' };
    const html = renderPage('overview', {
      assets: [asset], proofs: [], sources: [],
      assetVersions: {
        assetId: 'aa-mix', usage: [],
        versions: [
          { assetId: 'aa-mix', version: '1', at: '2026-09-14T01:00:00.000Z', snapshot: { title: 'T', statement: 'S' } },
          { assetId: 'aa-mix', version: '2', at: '2026-09-15T01:00:00.000Z', reason: 'review_decision:rd_z', snapshot: { title: 'T', statement: 'S', scope: 'personal', evidenceRefs: [
            { kind: 'execution', id: 'kse-1', title: 'KSTAR requirement episode' },
            { kind: 'conversation', id: 'conv-1', subtype: 'session', title: '某场对话' },
            { kind: 'user_teaching_signal', id: 'teach-1' },
          ] } },
        ],
      },
    }, { assetId: 'aa-mix', assetVersionId: '2' });
    expect(html).toContain('evgroup');
    expect(html).toContain('任务复盘');
    expect(html).toContain('对话与你的表态');
    // bug1：scope=personal 不再裸英文。
    expect(html).toContain('个人对话');
    expect(html).not.toContain('>personal<');
    // bug2：review_decision 版本的来源标签是"确认沉淀"，不再裸内部值。
    expect(html).toContain('确认沉淀');
    expect(html).not.toContain('review_decision');
  });

  it('证据诚实态（2026-09-18）：复盘记录不存在时显示来源不可用，未拉到不误标', () => {
    const asset = { id: 'aa-kmiss', title: '缺记录的证据', type: 'rule', status: 'active', version: '1', activeVersion: '1', updatedAt: '2026-09-16T00:00:00.000Z' };
    const versionsWith = (ref) => ({ assetId: 'aa-kmiss', usage: [], versions: [{ assetId: 'aa-kmiss', version: '1', at: '2026-09-16T01:00:00.000Z', snapshot: { title: 'T', statement: 'S', evidenceRefs: [ref] } }] });
    const kse = (extra = {}) => ({ kind: 'execution', id: 'kse-abc', taxonomyVersion: 1, subtype: 'execution', title: 'KSTAR requirement episode', ...extra });
    const base = { assets: [asset], proofs: [], sources: [], kstarSummariesSettled: [] };
    // ① 摘要已拉到 → 正常可点 chip，显示这次任务的目标。
    const ok = renderPage('overview', { ...base, assetVersions: versionsWith(kse()), kstarSummaries: { 'kse-abc': { id: 'kse-abc', goal: '查认知资产是怎么存的' } } }, { assetId: 'aa-kmiss', assetVersionId: '1' });
    expect(ok).toContain('任务复盘：查认知资产是怎么存的');
    expect(ok).toContain('data-act="open-kstar-episode" data-id="kse-abc"');
    expect(ok).not.toContain('来源记录不可用');
    // ② 已请求过、响应里没有这条 → 诚实显示不可用，且不给可点入口。
    const gone = renderPage('overview', { ...base, assetVersions: versionsWith(kse()), kstarSummaries: {}, kstarSummariesSettled: ['kse-abc'] }, { assetId: 'aa-kmiss', assetVersionId: '1' });
    expect(gone).toContain('来源记录不可用');
    expect(gone).not.toContain('data-act="open-kstar-episode"');
    // ③ 还没请求过（未 settled）→ 维持兜底文案：读不到 ≠ 不存在。
    const pending = renderPage('overview', { ...base, assetVersions: versionsWith(kse()), kstarSummaries: {} }, { assetId: 'aa-kmiss', assetVersionId: '1' });
    expect(pending).toContain('任务复盘：一次任务');
    expect(pending).not.toContain('来源记录不可用');
    // ④ 写入时已标记 degraded（第 3 步入口校验的口径）→ 不等摘要直接不可用。
    const degraded = renderPage('overview', { ...base, assetVersions: versionsWith(kse({ degraded: true, reason: 'kstar_episode_missing' })), kstarSummaries: {} }, { assetId: 'aa-kmiss', assetVersionId: '1' });
    expect(degraded).toContain('来源记录不可用');
    // ⑤ 归边（乙）：degraded 的复盘证据不算 KSTAR 血统，干净的照旧算。
    const { cogAssets: NS2 } = ensureModule();
    expect(NS2.isKstarAsset({ evidenceRefs: [kse({ degraded: true })] })).toBe(false);
    expect(NS2.isKstarAsset({ evidenceRefs: [kse()] })).toBe(true);
    expect(NS2.isKstarCandidate({ sourceRefs: [{ id: 'kse-abc', degraded: true }] })).toBe(false);
  });

  it('候选详情点复盘 chip 就地展开（2026-09-17 修）：不跳页、块出现在证据区下方', () => {
    const cand = {
      id: 'rcand-ep', status: 'pending_review', suggestedType: 'rule', suggestedScope: 'general',
      judgment: '解释机制先给线性主线。', summary: '线性主线',
      capabilities: { canEdit: true, canPromote: true, countsAsPending: true, isSnoozed: false },
      sourceRefs: [{ kind: 'execution', id: 'kse-1' }],
    };
    // 点开态（route 带 candidateId+kstarEpisodeId）：复盘块渲染在候选详情内，
    // 页面仍是 review（此前处理器硬编码 overview，点 chip 整页跳回"我的认知"）。
    const html = renderPage('review', {
      sources: [], candidates: [cand],
      kstarEpisode: { episodeId: 'kse-1', episode: { id: 'kse-1', goal: '命中既有候选是怎么一个逻辑' }, review: { outcome: 'met_expected', attribution: 'execution_gap', lesson: '先给主线再补分支。' } },
    }, { candidateId: 'rcand-ep', kstarEpisodeId: 'kse-1' });
    expect(html).toContain('ca-episode-detail');
    expect(html).toContain('这次任务的经过');
    expect(html).toContain('命中既有候选是怎么一个逻辑');
  });

  it('使用记录引用已删版本（bug3）：标注"当时的版本后来已删除"', () => {
    const asset = { id: 'aa-del', title: '有历史使用的资产', type: 'rule', status: 'active', version: '2', activeVersion: '2', updatedAt: '2026-09-16T00:00:00.000Z' };
    const html = renderPage('overview', {
      assets: [asset], proofs: [], sources: [],
      assetVersions: { assetId: 'aa-del', usage: [], versions: [{ assetId: 'aa-del', version: '2', at: '2026-09-15T01:00:00.000Z', snapshot: { title: 'T', statement: 'S' } }] },
      // 使用记录引用 v5：版本链只有 v2（v3-v5 已被真删），须标注而非裸 v5。
    }, { assetId: 'aa-del' });
    expect(html).toContain('还没有被真实使用过');
    const used = renderPage('overview', {
      assets: [asset], sources: [],
      proofs: [{ id: 'p1', kind: 'usage_recorded', occurredAt: '2026-09-17T11:00:00.000Z', refs: { assetId: 'aa-del', version: '5' } }],
      assetVersions: { assetId: 'aa-del', usage: [], versions: [{ assetId: 'aa-del', version: '2', at: '2026-09-15T01:00:00.000Z', snapshot: { title: 'T', statement: 'S' } }] },
    }, { assetId: 'aa-del' });
    expect(used).toContain('该版本后来已删除');
    expect(used).toContain('v5');
  });

  it('无候选：显示模型给出的理由与筛选原因白话', () => {
    const html = renderPage('organize', {
      captures: [{
        ...detailCapture, candidateIds: [], status: 'completed', displayStatus: 'completed',
        displayReason: 'no_candidate', noCandidateReason: '这轮只是复述已知信息，没有新的可沉淀内容。',
        filterReason: 'model_no_candidate',
      }],
      sources: [], ...contextStore,
    }, { captureId: 'rcap-x' });
    expect(html).toContain('没有发现值得留存的内容');
    expect(html).toContain('这轮只是复述已知信息');
    expect(html).toContain('模型判断这轮没有可沉淀的内容');
  });

  it('进行中：结果区给出占位说明', () => {
    const html = renderPage('organize', {
      captures: [{ ...detailCapture, candidateIds: [] }], sources: [], ...contextStore,
    }, { captureId: 'rcap-x' });
    expect(html).toContain('整理还在进行');
  });

  it('对话上下文：参与角色 chips + 消息时间线（角色名/标签/折叠/产物）', () => {
    const html = renderPage('organize', {
      captures: [{ ...detailCapture, candidateIds: [], screeningSignals: ['preference', 'decision'] }],
      sources: [], ...contextStore,
    }, { captureId: 'rcap-x' });
    expect(html).toContain('对话上下文');
    expect(html).toContain('参与角色');
    expect(html).toContain('消息时间线');
    expect(html).toContain('你');
    expect(html).toContain('指挥官');
    expect(html).toContain('代码评审员');
    expect(html).toContain('帮我把上线前的检查做成清单。');
    expect(html).toContain('m1 ·');
    expect(html).toContain('上线检查清单');
    expect((html.match(/ca-tl-row/g) || []).length).toBeGreaterThanOrEqual(3);
    // 价值信号白话化（manual_selection 被过滤不显示）
    expect(html).toContain('用户偏好');
    expect(html).toContain('决策');
    expect(html).not.toContain('手动选择');
  });

  it('长消息折叠为 details，短消息直出', () => {
    const longText = `${'深度内容。'.repeat(80)}\n第二段也很长。`;
    const html = renderPage('organize', {
      captures: [{ ...detailCapture, candidateIds: [] }], sources: [],
      captureContext: {
        captureId: 'rcap-x',
        data: { ...contextData, messages: [{ ...contextData.messages[0], text: longText, truncated: true }] },
      },
    }, { captureId: 'rcap-x' });
    expect(html).toContain('ca-tl-body');
    expect(html).toContain('内容过长，已截断');
  });

  it('上下文不可用/加载中降级文案', () => {
    const unavailable = renderPage('organize', {
      captures: [{ ...detailCapture, candidateIds: [] }], sources: [],
      captureContext: { captureId: 'rcap-x', data: null },
    }, { captureId: 'rcap-x' });
    expect(unavailable).toContain('消息内容不可用');

    const loading = renderPage('organize', {
      captures: [{ ...detailCapture, candidateIds: [] }], sources: [],
      captureContext: { captureId: 'rcap-x', loading: true, data: null },
    }, { captureId: 'rcap-x' });
    expect(loading).toContain('正在读取对话上下文');
  });

  it('上下文缓存与当前任务不符时不串用', () => {
    const html = renderPage('organize', {
      captures: [{ ...detailCapture, candidateIds: [] }], sources: [],
      captureContext: { captureId: 'rcap-other', data: contextData },
    }, { captureId: 'rcap-x' });
    expect(html).toContain('消息内容不可用');
    expect(html).not.toContain('帮我把上线前的检查做成清单。');
  });
});

describe('待我处理（决策中心）', () => {
  const issueSource = {
    kind: 'artifact_file',
    items: [{
      id: 'src-1', kind: 'artifact_file', title: '架构决策记录.md',
      status: 'failed', statusReason: 'file_index_failed', actions: ['retry', 'remove'],
    }],
  };

  it('候选详情与活动列表并列，关闭详情可返回列表焦点', () => {
    const mk = (id: string) => ({
      id, status: 'pending_review', suggestedType: 'rule',
      judgment: '一条足够长的候选判断正文内容。', summary: `标题-${id}`,
      capabilities: { canEdit: true, canPromote: true, countsAsPending: true },
    });
    const html = renderPage('review', { candidates: [mk('cd-1')], sources: [] }, { candidateId: 'cd-1' });
    expect(html).toContain('ca-activity-layout');
    expect(html).toContain('data-act="activity-close"');
    expect(html).toContain('<h2>标题-cd-1</h2>');
    expect(html).toContain('data-act="activity-select"');
  });

  it('健康来源不出现在待我处理（异常驱动，无常态清单）', () => {
    const html = renderPage('review', { sources: [conversationSources[0]], candidates: [] });
    expect(html).not.toContain('条来源记录需要处理');
    expect(html).not.toContain('Saying hello');
  });
});

describe('资产详情（使用记录并入）', () => {
  const asset = { id: 'aa-1', title: '上线前必须确认影响范围', type: 'rule', status: 'active', scope: 'general', updatedAt: '2026-09-15T00:00:00.000Z' };
  const proofs = [
    {
      id: 'ev-1', kind: 'usage_recorded', occurredAt: '2026-09-15T01:00:00.000Z',
      refs: { assetId: 'aa-1', conversationId: 'conv-1', transferProofId: 'tp-1', version: 2 },
    },
    {
      id: 'ev-2', kind: 'projection_confirmed', occurredAt: '2026-09-14T01:00:00.000Z',
      refs: { assetId: 'aa-1', conversationId: 'conv-1' },
    },
  ];

  it('使用记录区按时间倒序整句化，可评事件展开出评价按钮', () => {
    const html = renderPage(
      'overview',
      { assets: [asset], proofs, sources: conversationSources },
      { assetId: 'aa-1', proofEventId: 'ev-1' },
    );
    expect(html).toContain('使用记录');
    expect(html).toContain('带入或读取');
    expect(html).toContain('对话《Saying hello》里');
    expect(html).toContain('data-act="proof-toggle" data-id="ev-1"');
    expect(html).toContain('data-feedback="positive"');
    expect(html).toContain('data-act="proof-rate"');
  });

  it('使用记录只认真实引用（2026-09-17）：版本保存/选用切换/治理操作不进使用记录', () => {
    const noisy = [
      ...proofs,
      { id: 'ev-3', kind: 'asset_version', occurredAt: '2026-09-16T01:00:00.000Z', refs: { assetId: 'aa-1', version: 3 } },
      { id: 'ev-4', kind: 'asset_version_selected', occurredAt: '2026-09-16T02:00:00.000Z', refs: { assetId: 'aa-1', version: '2' } },
      { id: 'ev-5', kind: 'asset_archived', occurredAt: '2026-09-16T03:00:00.000Z', refs: { assetId: 'aa-1' } },
    ];
    const html = renderPage('overview', { assets: [asset], proofs: noisy, sources: conversationSources }, { assetId: 'aa-1' });
    expect(html).toContain('带入或读取');
    expect(html).not.toContain('保存了新版本');
    expect(html).not.toContain('选用 v2 为在用版本');
    // 噪音事件不进计数摘要；且口径已改（2026-09-25 US-602 AC4；2026-09-28 词表
    // 统一）：宿主注入过一律归「被任务用过」，不再宣称「被实际使用」——是否
    // 采用只看「模型确认采用」。
    expect(html).toContain('带入或读取 2 次');
    expect(html).not.toContain('被实际使用');
  });

  it('版本链（2026-09-16 版本组）：V1 归入同条目可展开，非在用版可「选用此版」', () => {
    const multi = {
      ...asset,
      version: '3',
      activeVersion: '2',
      title: 'Renamed in v2',
      statement: '新内容',
    };
    const html = renderPage('overview', {
      assets: [multi],
      proofs: [],
      sources: [],
      assetVersions: {
        assetId: 'aa-1',
        usage: [{ version: '1', applied: 3, contradicted: 1, total: 4 }, { version: '2', applied: 1, contradicted: 0, total: 1 }],
        versions: [
          { assetId: 'aa-1', version: '1', at: '2026-09-10T01:00:00.000Z', snapshot: { title: '上线前必须确认影响范围', statement: '旧内容', type: 'rule', evidenceRefs: [], status: 'active', maturity: 'seed', version: '1' } },
          { assetId: 'aa-1', version: '2', at: '2026-09-15T01:00:00.000Z', reason: 'Rename for v2.', snapshot: { title: 'Renamed in v2', statement: '新内容', type: 'rule', evidenceRefs: [], status: 'active', maturity: 'seed', version: '2' } },
          { assetId: 'aa-1', version: '3', at: '2026-09-16T01:00:00.000Z', reason: 'merged from aa-x', snapshot: { title: 'Renamed in v2', statement: '新内容', type: 'rule', evidenceRefs: [], status: 'active', maturity: 'seed', version: '3' } },
        ],
      },
    }, { assetId: 'aa-1' });
    // 版本链 section：标题 + 两版（各版快照标题可辨）。
    expect(html).toContain('选择历史版本');
    expect(html).toContain('Renamed in v2');
    expect(html).toContain('上线前必须确认影响范围');
    // 在用版（v2）标「在用」，非在用版（v1）给「选用此版」（在用版无选用按钮；
    // 2026-09-17 起每行带 data-version 供点开，判"无按钮"须带全 data-act 前缀）。
    expect(html).toContain('<option value="1"');
    expect(html).not.toContain('data-act="select-asset-version" data-id="aa-1" data-version="2"');
    expect(html).toContain('在用');
    // 按版本的使用效果列（M8）：v1 模型确认采用 3 次·被否定 1 次（词表统一）。
    expect(html).not.toContain('模型确认采用 3 次');
    expect(html).not.toContain('被否定 1 次');
    // 空版本标记（2026-09-16）：v3 与 v2 一字不差 → 标"内容未变"。
    expect(html).toContain('<option value="3"');
    // 「已有更新的版本」提示（US-402 AC6）：被引用过（有使用回执）的历史版本
    // 明说它已经不是最新——引用它的任务仍按当时冻结的内容执行，所以这不是
    // 错误状态。只给被引用过的 v1，没被引用过的 v3 不打扰。
    expect(html).not.toContain('8 处长期引用保留所选旧版本的快照');
    expect(html).toContain('data-prototype-version-select');
  });

  it('整理报告（2026-09-25 US-403）：逐项改动 + 每项回滚入口 + 拿不准项就地处置 + 跳过如实标注', () => {
    const report = {
      id: 'cr-1', trigger: 'user', createdAt: '2026-09-25T01:00:00.000Z', finishedAt: '2026-09-25T01:00:05.000Z',
      scanned: 12,
      skippedSteps: ['补标签（标签系统尚未落地，待 Epic 2 / 012）'],
      items: [
        { assetId: 'aa-1', kind: 'title_normalized', status: 'applied', before: '旧标题。', after: '旧标题', reason: '标题只有结尾标点不规范', ledgerRef: 'aa-1-updated-x', rollbackAnchor: '1' },
        { assetId: 'aa-2', kind: 'merged_duplicate', status: 'failed', before: '独立条目', after: '并入 aa-1', reason: '正文完全相同', note: 'revoked ability asset cannot be changed' },
      ],
      uncertain: [
        { assetId: 'aa-3', title: '很像的一条', question: '这条和「另一条」看字面很像（88%），要不要合并？', reason: '正文不同但高度重叠：是不是同一个意思需要人来判。' },
        { assetId: 'aa-4', title: '已处置的一条', question: '要不要合并？', reason: '需要人来判。', decision: 'dismissed' },
      ],
    };
    const html = renderPage('cleanup', { cleanupReports: { loading: false, reports: [report] } }, { cleanupReportId: 'cr-1' });
    // 这个夹具的断言一律落在渲染产出的 HTML 上（本文件既有约定，没有 visibleText 助手）。
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    // 概要 + 跳过如实标注（不假装做过补标签）。
    expect(text).toContain('扫描 12 条');
    expect(text).toContain('执行 1 项');
    expect(text).toContain('拿不准 2 项');
    expect(text).toContain('补标签');
    expect(text).toContain('Epic 2');
    // 逐项改动：改了什么 / 为什么 / 失败原因如实显示。
    expect(text).toContain('标题规范化');
    expect(text).toContain('旧标题。');
    expect(text).toContain('旧标题');
    expect(text).toContain('重复归并');
    expect(text).toContain('失败');
    expect(text).toContain('revoked ability asset cannot be changed');
    // 每项的回滚入口（报告项自带锚点，不另造一套）。
    expect(html).toContain('data-act="rollback-cleanup-item" data-id="aa-1" data-version="1"');
    // 拿不准项：未处置的给两个处置按钮，已处置的显示结论、不再给按钮。
    expect(html).toContain('data-act="cleanup-uncertain-dismiss" data-id="aa-3" data-report="cr-1"');
    expect(html).toContain('data-act="cleanup-uncertain-defer" data-id="aa-3" data-report="cr-1"');
    expect(text).toContain('已标记不管');
    expect(html).not.toContain('data-act="cleanup-uncertain-dismiss" data-id="aa-4"');
  });

  it('标题重起轮（2026-09-28 标题一等化 3.3 专项轮）：新 kind 有人话标签，报告页/设置页导语按轮次区分', () => {
    const regenReport = {
      id: 'cr-regen', trigger: 'user', createdAt: '2026-09-28T01:00:00.000Z', finishedAt: '2026-09-28T01:00:05.000Z',
      scanned: 18,
      items: [
        { assetId: 'aa-1', kind: 'title_regen', status: 'applied', before: '导出报表一律带上生成时间戳，导出前还需要人工确认口径与接收人名单。', after: '报表时间戳纪律', reason: '原标题照抄正文首句且超长，由模型重起' },
      ],
      uncertain: [],
    };
    const html = renderPage('cleanup', { cleanupReports: { loading: false, reports: [regenReport] } }, { cleanupReportId: 'cr-regen' });
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    // 新 kind 走专用词条「标题重起」，不落「整理动作」兜底（勿重蹈 tag_added 欠账）。
    expect(text).toContain('标题重起');
    expect(text).not.toContain('整理动作');
    // 重起轮导语换新文案（不做合并、全自动写入、写前备份）；规则轮导语在这轮上是假话。
    expect(text).toContain('由模型把不合格的标题重新拟一个简短的新标题');
    expect(text).not.toContain('只自动规范标题、合并正文完全相同的重复项');
    // 设置页（2026-09-29 三轮合一）：入口恒为「完整整理」文案，不再按最近
    // 报告轮次切换导语（旧规则轮/重起轮只在报告页历史里区分）。
    const settings = renderPage('organize-settings', { cleanupReports: { loading: false, reports: [regenReport] } });
    expect(settings).toContain('夜间发现');
    expect(settings).not.toContain('由模型把不合格的标题重新拟一个简短的新标题');
    // 载体或以独立 trigger 值标记本轮（零项的重起报告也能分辨）——两种形态都认。
    const triggerOnly = { ...regenReport, id: 'cr-regen2', trigger: 'title_regen', items: [] };
    const triggerHtml = renderPage('cleanup', { cleanupReports: { loading: false, reports: [triggerOnly] } }, { cleanupReportId: 'cr-regen2' });
    expect(triggerHtml).toContain('由模型把不合格的标题重新拟一个简短的新标题');
    // 规则轮不受影响：历史规则轮报告导语保留原文案。
    const ruleHtml = renderPage('cleanup', { cleanupReports: { loading: false, reports: [] } }, { cleanupReportId: 'missing' });
    expect(ruleHtml).toContain('没有修改资产或候选');
  });

  it('完整整理轮（2026-09-29 三轮合一）：round:full 用合并导语，tag_added 有「补标签」标签不落兜底', () => {
    const fullReport = {
      id: 'cr-full', trigger: 'user', round: 'full', createdAt: '2026-09-29T01:00:00.000Z', finishedAt: '2026-09-29T01:00:09.000Z',
      scanned: 30,
      items: [
        { assetId: 'aa-1', kind: 'title_normalized', status: 'applied', before: '旧标题。', after: '旧标题', reason: '结尾句读' },
        { assetId: 'aa-2', kind: 'tag_added', status: 'applied', before: '', after: '#排查', reason: '同源组多数标签传播' },
        { assetId: 'aa-3', kind: 'title_regen', status: 'applied', before: '超长旧标题', after: '短标题', reason: '重起' },
      ],
      uncertain: [],
    };
    const html = renderPage('cleanup', { cleanupReports: { loading: false, reports: [fullReport] } }, { cleanupReportId: 'cr-full' });
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    // 合并导语，不再套用规则轮/重起轮任一旧文案。
    expect(text).toContain('本轮自动完成：规范标题');
    expect(text).not.toContain('只自动规范标题');
    expect(text).not.toContain('由模型把不合格的标题重新拟一个简短的新标题');
    // tag_added 走「补标签」词条（此前一直落「整理动作」兜底的欠账）。
    expect(text).toContain('补标签');
    expect(text).not.toContain('整理动作');
  });

  it('整理报告空态：没有报告时给入口而不是空白页', () => {
    const html = renderPage('cleanup', { cleanupReports: { loading: false, reports: [] } });
    expect(html).toContain('还没有整理报告');
    // 2026-09-29 集成维护：报告页右上按钮并入「立即维护」（跑全套）；页首有返回。
    expect(html).toContain('data-act="run-maintenance"');
    expect(html).toContain('data-act="go-back"');
    // 2026-09-29 版式统一：页头与任务/建议详情同款（大标题+说明+右侧动作），
    // 不再用 ui-page-header 紧凑组件——模块内三种详情页头收敛为一种。
    expect(html).toContain('检查建议与历史整理记录；当前检查不会修改资产或候选。');
    expect(html).not.toContain('ui-page-header');
  });

  it('「已删除」筛选与同区详情显示真实保留期，恢复和彻底删除保留稳定ID', () => {
    const html = renderPage('overview', {
      assets: [{ ...asset, id: 'aa-del', title: '删掉的那条', status: 'deleted', deletedAt: '2026-09-20T00:00:00.000Z' }],
      deletedAssets: {
        loading: false, total: 1,
        items: [{ id: 'aa-del', title: '删掉的那条', type: 'rule', scope: 'general', status: 'deleted', retentionDaysLeft: 25, restorable: true, retentionUnknown: false, purgeable: true }],
      },
    }, { category: 'deleted' });
    // 保留期剩余天数（由服务端现算，界面只显示）。
    expect(html).toContain('保留期还剩 25 天');
    expect(html).not.toContain('data-act="asset-action" data-id="aa-del" data-action="purge"');
    expect(html).toContain('data-act="asset-action" data-id="aa-del" data-action="restore"');
    expect(html).toContain('data-act="library-select" data-id="aa-del"');
    expect(html).not.toContain('data-go-asset="aa-del"');
  });

  it('「已删除」列表：时间戳不可用时如实说明，不冒充"还能恢复"', () => {
    const html = renderPage('overview', {
      assets: [{ ...asset, id: 'aa-del2', title: '时间坏了', status: 'deleted' }],
      deletedAssets: {
        loading: false, total: 1,
        items: [{ id: 'aa-del2', title: '时间坏了', type: 'rule', scope: 'general', status: 'deleted', retentionDaysLeft: null, restorable: false, retentionUnknown: true, purgeable: true }],
      },
    }, { category: 'deleted' });
    expect(html).toContain('删除时间无法核实');
    expect(html).toMatch(/<button[^>]*disabled[^>]*data-action="restore"/);
    expect(html).not.toContain('保留期还剩');
  });

  it('生命周期记录走版本链读口（2026-09-25 真机修）：audit 由 assetVersions 提供时也要渲染', () => {
    // 此前只认 asset.audit，而那个字段从未被赋值——整块审计区是死的（真机抓出）。
    const html = renderPage('overview', {
      assets: [asset],
      assetVersions: {
        assetId: 'aa-1',
        versions: [],
        usage: [],
        audit: [
          { action: 'updated', at: '2026-09-25T01:47:12.562Z', actor: 'ai', reason: '用户原话：「把标题改成临时标题」', before: 'title=原名；version=1', after: 'title=临时标题；version=2' },
          { action: 'rolled_back', at: '2026-09-25T01:48:26.914Z', actor: 'user', reason: '取证后回滚', before: 'title=临时标题；version=2', after: 'title=原名；version=3', rollbackAnchor: '2' },
        ],
      },
    }, { assetId: 'aa-1' });
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    // 台账保留在详情的「使用与管理记录」下钻中。
    expect(text).toContain('使用与管理记录');
    expect(text).toContain('AI · 更新内容');
    expect(text).toContain('用户原话');
    expect(text).toContain('你 · 版本回滚');
    expect(text).toContain('title=原名；version=1');
    expect(text).toContain('title=临时标题；version=2');
    // 台账行内「回滚到这次改动前」按钮已删（审计 R2，2026-09-28）：与版本区
    // 「切回此版」重叠且 0 使用；rollbackAnchor 数据仍在（服务端字段），只是
    // 不再渲染按钮。回滚走版本区。
    expect(html).not.toContain('data-act="rollback-asset"');
    // 台账时间必须走统一格式化（2026-09-25 合并态走查修）：此前原样打印存储里的
    // ISO UTC 串（`2026-09-25T01:47:12.562Z`），与同页版本记录的本地时间差 8 小时。
    // 判据取台账块内的 `.when` 单元格：值必须等于本文件装配的 fmtDate 出口输出
    // （harness 固定值），而不是任何原始 ISO 串。
    const ledger = html.slice(html.indexOf('使用与管理记录'));
    const whens = [...ledger.matchAll(/<span class="when">([^<]*)<\/span>/g)].map((m) => m[1]);
    expect(whens).toEqual(['2026/09/15 10:00', '2026/09/15 10:00']);
    expect(ledger).not.toContain('2026-09-25T01:47:12.562Z');
    expect(ledger).not.toContain('2026-09-25T01:48:26.914Z');
  });

  it('历史版本仍可比较，不再显示长期引用统计提示', () => {
    // 真机现状：v1 被 8 条已确认投影冻结，界面却没有标记——旧判据读 KSTAR 采用
    // 回执（usage），而回执库里根本没有这条资产的记录，条件恒假。
    const multi = { ...asset, version: '2', activeVersion: '2', title: 'Renamed in v2', statement: '新内容' };
    const html = renderPage('overview', {
      assets: [multi],
      proofs: [],
      sources: [],
      assetVersions: {
        assetId: 'aa-1',
        usage: [],
        frozen: [{ version: '1', count: 8 }],
        versions: [
          { assetId: 'aa-1', version: '1', at: '2026-09-10T01:00:00.000Z', snapshot: { title: '旧标题', statement: '旧内容', type: 'rule', evidenceRefs: [], status: 'active', maturity: 'seed', version: '1' } },
          { assetId: 'aa-1', version: '2', at: '2026-09-15T01:00:00.000Z', reason: 'Rename for v2.', snapshot: { title: 'Renamed in v2', statement: '新内容', type: 'rule', evidenceRefs: [], status: 'active', maturity: 'seed', version: '2' } },
        ],
      },
    }, { assetId: 'aa-1' });
    // 零采用回执 + 有冻结引用 → 恰好一处标记，且落在被冻结的 v1 行上。
    expect(html).not.toContain('长期引用保留所选旧版本');
    const rows = html.split('data-act="open-asset-version"').slice(1);
    const v1Row = rows.find((r) => r.includes('data-version="1"')) || '';
    const v2Row = rows.find((r) => r.includes('data-version="2"')) || '';
    expect(v1Row).toBe('');
    expect(v2Row).not.toContain('已有更新的版本');
    // 在用版（v2）不给「选用此版」。
    expect(html).not.toContain('data-act="select-asset-version" data-id="aa-1" data-version="2"');
  });

  it('版本行点开详情与真删入口（2026-09-17）：全文/逐项信息/删除按钮/在用版提示', () => {
    const multi = { ...asset, version: '3', activeVersion: '2', title: 'Renamed in v2', statement: '新内容' };
    const versions = {
      assetId: 'aa-1',
      usage: [{ version: '1', applied: 3, contradicted: 1, total: 4 }],
      versions: [
        { assetId: 'aa-1', version: '1', at: '2026-09-10T01:00:00.000Z', reason: 'initial', snapshot: { title: '上线前必须确认影响范围', statement: '旧内容的完整正文，超过八十字预览的部分也要在展开块里完整可见，用于区分列表预览与详情全文。'.repeat(2), type: 'rule', evidenceRefs: [{ kind: 'execution', id: 'exec-v1' }], applicableWhen: ['做发版自查'], forbiddenWhen: ['临时草稿'], status: 'active', maturity: 'seed', version: '1' } },
        { assetId: 'aa-1', version: '2', at: '2026-09-15T01:00:00.000Z', reason: 'Rename for v2.', snapshot: { title: 'Renamed in v2', statement: '新内容', type: 'rule', evidenceRefs: [], status: 'active', maturity: 'seed', version: '2' } },
      ],
    };
    // 列表行可点：每行带 open-asset-version；未展开时不出现详情块。
    const listHtml = renderPage('overview', { assets: [multi], proofs: [], sources: [], assetVersions: versions }, { assetId: 'aa-1' });
    expect(listHtml).toContain('data-prototype-version-select');
    expect(listHtml).not.toContain('版本详情');
    // 点开 v1（非在用）：全文可见（预览截断处之后的内容只在展开块里）、
    // 适用/禁用场景、证据条数、使用效果与「删除此版本」。
    const openHtml = renderPage('overview', { assets: [multi], proofs: [], sources: [], assetVersions: versions }, { assetId: 'aa-1', assetVersionId: '1' });
    expect(openHtml).toContain('所选 v1');
    expect(openHtml).toContain('详情全文。');
    expect(openHtml).toContain('做发版自查');
    expect(openHtml).toContain('临时草稿');
    expect(openHtml).toContain('来源记录');
    expect(openHtml).toContain('差异摘要');
    expect(openHtml).not.toContain('data-act="delete-asset-version"');
    // 点开在用版 v2：无删除按钮，白话提示先切换再删。
    const activeHtml = renderPage('overview', { assets: [multi], proofs: [], sources: [], assetVersions: versions }, { assetId: 'aa-1', assetVersionId: '2' });
    expect(activeHtml).not.toContain('delete-asset-version');
    expect(activeHtml).toContain('当前在用 v2');
  });

  it('详情固定操作栏保留真实暂停与编辑，历史版编辑入口和草稿字段不丢失', () => {
    const list = renderPage('overview', { assets: [asset], proofs: [], sources: [] }, { assetId: 'aa-1' });
    // 顶部：总开关、生效说明和直接修改入口；归档等治理动作不占标题区。
    expect(list).toContain('data-action="pause"');
    expect(list).toContain('是否使用仍取决于任务匹配、状态与来源权限');
    expect(list).toContain('ca-library-detail-footer');
    expect(list).not.toContain('ca-asset-availability');
    expect(list).toContain('data-act="edit-asset" data-id="aa-1"');
    expect(list).not.toContain('data-action="archive"');
    // 头部只留标题+正文+开关：详细信息和证据来源已按版本下沉（2026-09-17
    // 子安口径），顶部不再出现这两个折叠区。
    expect(list).not.toContain('已成功带入');
    expect(list).not.toContain('详细信息');
    expect(list).not.toContain('证据来源');
    expect(list).toContain('data-action="pause"');
    // 版本行的编辑入口：在用版与历史版的展开块都有「基于此版修改」。
    const multi = { ...asset, version: '2', activeVersion: '1' };
    const versions = { assetId: 'aa-1', versions: [
      { assetId: 'aa-1', version: '1', at: '2026-09-10T01:00:00.000Z', snapshot: { title: 'T1', statement: 'S1', evidenceRefs: [] } },
      { assetId: 'aa-1', version: '2', at: '2026-09-15T01:00:00.000Z', snapshot: { title: 'T2', statement: 'S2', evidenceRefs: [] } },
    ] };
    const openV2 = renderPage('overview', { assets: [multi], proofs: [], sources: [], assetVersions: versions }, { assetId: 'aa-1', assetVersionId: '2' });
    expect(openV2).toContain('所选 v2');
    expect(openV2).not.toContain('data-act="edit-from-version"');
    const openV1 = renderPage('overview', { assets: [multi], proofs: [], sources: [], assetVersions: versions }, { assetId: 'aa-1', assetVersionId: '1' });
    expect(openV1).toContain('所选 v1');
    expect(openV1).toContain('当前在用 v1');
    // 编辑态表单仍渲染（预填现值，保存/取消齐全）。
    const editable = { ...asset, applicableWhen: ['发版自查'] };
    const edit = renderPage('overview', { assets: [editable], proofs: [], sources: [] }, { assetId: 'aa-1', assetEdit: '1' });
    expect(edit).toContain('ca-asset-edit');
    expect(edit).toContain('data-f="statement"');
    expect(edit).toContain('发版自查');
    expect(edit).toContain('data-act="asset-edit-save"');
    expect(edit).toContain('data-act="asset-edit-cancel"');
    // 详情异步加载会重绘表单；草稿重绘后必须恢复每个可编辑字段，尤其是
    // 可见范围的多选状态（否则用户修改权限边界会静默丢失）。
    const draftEdit = renderPage('overview', {
      assets: [editable], proofs: [], sources: [],
      assetScopeOptions: {
        status: 'ready',
        agents: [{ agent_id: 'agent-draft', name: 'Draft Agent' }],
        spaces: [{ space_id: 'space-draft', name: 'Draft Space' }],
      },
      assetEditDrafts: {
        'aa-1': {
          title: 'Draft title',
          statement: 'Draft statement',
          applicable: 'Draft applicable',
          forbidden: 'Draft forbidden',
          scopeSelection: { agentIds: ['agent-draft'], workspaceIds: ['space-draft'] },
        },
      },
    }, { assetId: 'aa-1', assetEdit: '1' });
    expect(draftEdit).toContain('value="Draft title"');
    expect(draftEdit).toContain('<textarea');
    expect(draftEdit).toContain('>Draft statement</textarea>');
    expect(draftEdit).toContain('value="Draft applicable"');
    expect(draftEdit).toContain('value="Draft forbidden"');
    // 敏感级三档控件已随机制删除（2026-09-28）：编辑表单不再有任何档位控件。
    expect(draftEdit).not.toContain('data-level');
    expect(draftEdit).toContain('Draft Agent');
    expect(draftEdit).toContain('Draft Space');
    expect(draftEdit).toMatch(/option value="agent-draft" selected/);
    expect(draftEdit).toMatch(/option value="space-draft" selected/);
    // 暂停态：开关 off（resume 即恢复入口）+ 暂停说明；已归并态：只读说明、无任何操作。
    const paused = renderPage('overview', { assets: [{ ...asset, status: 'paused' }], proofs: [], sources: [] }, { assetId: 'aa-1' });
    expect(paused).toContain('data-action="resume"');
    expect(paused).toContain('恢复使用');
    expect(paused).not.toContain('data-act="asset-use-in-chat"');
    const archived = renderPage('overview', { assets: [{ ...asset, status: 'archived' }], proofs: [], sources: [] }, { assetId: 'aa-1' });
    expect(archived).toContain('归档');
    expect(archived).not.toContain('data-action="restore"');
  });

  it('版本来源标签与空版本折叠（2026-09-17 报告建议 E）：标签替原文，迁移空版本默认隐藏可展开', () => {
    const multi = { ...asset, version: '3', activeVersion: '1', title: 'T', statement: 'S' };
    const versions = {
      assetId: 'aa-1', usage: [],
      versions: [
        { assetId: 'aa-1', version: '1', at: '2026-09-10T01:00:00.000Z', reason: 'review_decision:rd_x', snapshot: { title: 'T', statement: 'S', evidenceRefs: [] } },
        { assetId: 'aa-1', version: '2', at: '2026-09-13T01:00:00.000Z', reason: 'legacy free-text scope "personal" → controlled term "general" (2026-09-13 scope enumeration)', snapshot: { title: 'T', statement: 'S', evidenceRefs: [] } },
        { assetId: 'aa-1', version: '3', at: '2026-09-17T01:00:00.000Z', reason: 'user manual edit', snapshot: { title: 'T2', statement: 'S2', evidenceRefs: [] } },
      ],
    };
    const html = renderPage('overview', { assets: [multi], proofs: [], sources: [], assetVersions: versions }, { assetId: 'aa-1' });
    // 「候选确认」→「确认沉淀」（2026-09-17 改）：review_decision 前缀两线
    // 通用，内部流程词换成用户视角的说法。
    expect(html).toContain('确认沉淀');
    expect(html).toContain('手动编辑');
    expect(html).not.toContain('legacy free-text scope');
    // 迁移空版本（v2 与 v1 同文）默认隐藏，尾部给展开入口。
    expect(html).not.toContain('data-act="open-asset-version" data-version="2"');
    expect(html).toContain('<option value="3"');
    expect(html).toContain('选择历史版本');
    const expanded = renderPage('overview', { assets: [multi], proofs: [], sources: [], assetVersions: versions }, { assetId: 'aa-1', assetVersionsExpanded: '1' });
    expect(expanded).toContain('<option value="2"');
    expect(expanded).toContain('系统迁移');
    expect(expanded).not.toContain('toggle-asset-versions-noise');
  });

  it('版本对比（2026-09-17 报告建议 C）：展开块与在用版就地对比，字段级 旧 → 新', () => {
    const multi = { ...asset, version: '2', activeVersion: '1', title: 'T1', statement: 'S1' };
    const versions = {
      assetId: 'aa-1', usage: [],
      versions: [
        { assetId: 'aa-1', version: '1', at: '2026-09-10T01:00:00.000Z', reason: 'review_decision:rd_x', snapshot: { title: 'T1', statement: 'S1', evidenceRefs: [] } },
        { assetId: 'aa-1', version: '2', at: '2026-09-17T01:00:00.000Z', reason: 'user manual edit', snapshot: { title: 'T2', statement: 'S2', evidenceRefs: [{ kind: 'conversation', id: 'c1' }] } },
      ],
    };
    const closed = renderPage('overview', { assets: [multi], proofs: [], sources: [], assetVersions: versions }, { assetId: 'aa-1', assetVersionId: '2' });
    expect(closed).toContain('差异摘要');
    const open = renderPage('overview', { assets: [multi], proofs: [], sources: [], assetVersions: versions }, { assetId: 'aa-1', assetVersionId: '2', assetVersionDiff: '2' });
    expect(open).toContain('所选 v2');
    expect(open).toContain('当前在用 v1');
    expect(open).toContain('S1');
    expect(open).toContain('S2');
    expect(open).toContain('T2 → T1');
    expect(open).toContain('当时范围与来源');
    expect(open).not.toContain('merge-asset-version');
    // 头部下钻已随用户视角重构移除（2026-09-17）：版本信息全归版本区，
    // 头部不再出现"已有更新的版本/看最新一版改了什么"。
    const latestMulti = { ...multi, activeVersion: '1' };
    const latest = renderPage('overview', { assets: [latestMulti], proofs: [], sources: [], assetVersions: versions }, { assetId: 'aa-1' });
    expect(latest).not.toContain('已有更新的版本');
    expect(latest).not.toContain('看最新一版改了什么');
  });

  it('已删除档（2026-09-17 报告建议 G）：默认视图不含已删除；「已删除」档与详情恢复入口', () => {
    const assets = [asset, { ...asset, id: 'aa-del', title: '已删条目占位', status: 'deleted' }];
    const list = renderPage('overview', { assets, proofs: [], sources: [] });
    expect(list).not.toContain('已删条目占位');
    expect(list).toContain('value="deleted"');
    const delTab = renderPage('overview', { assets, proofs: [], sources: [] }, { category: 'deleted' });
    expect(delTab).toContain('已删条目占位');
    const detail = renderPage('overview', { assets: [{ ...asset, id: 'aa-del', status: 'deleted' }], proofs: [], sources: [] }, { assetId: 'aa-del' });
    expect(detail).toContain('data-action="restore"');
  });

  it('单版本资产也出版本区（2026-09-17 下沉改：证据/详细信息的家在版本块）；头部不再有版本提示', () => {
    const single = renderPage('overview', {
      assets: [{ ...asset, version: '1' }],
      proofs: [], sources: [],
      assetVersions: { assetId: 'aa-1', versions: [{ assetId: 'aa-1', version: '1', at: '2026-09-15T01:00:00.000Z', snapshot: { title: '上线前必须确认影响范围', type: 'rule', evidenceRefs: [] } }] },
    }, { assetId: 'aa-1' });
    // 守卫 ≥2 → ≥1：单版本资产的证据只存在唯一一版里，必须给它位置可看。
    expect(single).toContain('选择历史版本');
    // 头部重构（2026-09-17 用户视角）：头部不再出现版本号/"已有更新的版本"
    // ——版本信息全部归版本区（"在用"绿标 + 各版本行自明）。
    const stale = renderPage('overview', {
      assets: [{ ...asset, version: '3', activeVersion: '1' }],
      proofs: [], sources: [], assetVersions: null,
    }, { assetId: 'aa-1' });
    expect(stale).not.toContain('已有更新的版本');
    expect(stale).not.toContain('看最新一版改了什么');
  });

  it('未使用资产出占位说明，不裸空白', () => {
    const html = renderPage('overview', { assets: [asset], proofs: [], sources: [] }, { assetId: 'aa-1' });
    expect(html).toContain('还没有被真实使用过');
  });
});

describe('交互反馈与响应式（2026-09-15 全面优化）', () => {
  const css = readFileSync(resolve(rootDir, 'src/renderer/cognition-assets.css'), 'utf8');

  it('写操作按钮有旋转圈、首载有骨架、静默刷新有进度条', () => {
    expect(css).toContain('ca-spin');
    expect(css).toContain('.btn.is-pending::after');
    expect(css).toContain('ca-skel-row');
    expect(css).toContain('ca-shimmer');
    expect(css).toContain('ca-refresh-slide');
    // 骨架结构真的渲染（首载态）
    const html = renderPage('organize', { captures: [], sources: [] }, {});
    expect(html).not.toContain('ca-skel-row'); // loaded=true 时不显示
    const loadingHtml = renderPage('organize', { loaded: false, loading: true, captures: [], sources: [] }, {});
    expect(loadingHtml).toContain('ca-skel-row');
  });

  it('策略抽屉已退役：ca-drawer 及 0fr 过渡零残留（R-C1 死账清理的钉子）', () => {
    expect(css).not.toContain('.ca-drawer');
    expect(css).not.toContain('grid-template-rows: 0fr');
  });

  it('同页重画保持滚动位置（轮询不再弹回顶部），切页仍归零', () => {
    // render 里保存并恢复 #ca-scroll 的 scrollTop，且只在路由指纹相同时恢复。
    // 2026-09-21 持久壳:恢复目标统一走 scrollRoot(main 或重取的 #ca-scroll)。
    expect(viewsSource).toContain('lastRenderKey');
    expect(viewsSource).toContain('restoreScroll');
    expect(viewsSource).toContain('scrollRoot.scrollTop = restoreScroll');
  });

  it('设置项乐观更新：capture-policy 死委托已删净（2026-09-16 B3），aria-busy 反馈保留', () => {
    // 三档单选的 case 与声明随旧抽屉退役（设置页现为夜间开关两态）；
    // 乐观更新模式由 capture-toggle/nightly 等活路径承载。
    expect(appSource).not.toContain("case 'capture-policy'");
    expect(appSource).toContain("setAttribute('aria-busy', 'true')");
  });

  it('响应式两档断点 + 减少动效尊重', () => {
    expect(css).toContain('@media (max-width: 980px)');
    expect(css).toContain('@media (max-width: 720px)');
    expect(css).toContain('prefers-reduced-motion');
  });

  it('英文 kicker 与 tab 副标题已删（2026-09-15 子安要求）：hero 只有标题，tab 只留标题文字', () => {
    // 源码级：hero 无 kicker 参数/元素；TABS 无 descKey；tab 渲染无 <small>。
    expect(viewsSource).not.toContain('ca-kicker');
    expect(viewsSource).not.toContain('<small>');
    expect(coreSource).not.toContain('descKey');
    expect(css).not.toContain('.ca-kicker');
    // 页面级：三个页面（含设置页/详情页）都不再出英文标题或副标题。
    for (const page of ['organize', 'organize-settings', 'overview']) {
      const html = renderPage(page, { captures: [], sources: [], assets: [] });
      expect(html).not.toContain('ORGANIZE');
      expect(html).not.toContain('SETTINGS');
      expect(html).not.toContain('COGNITION TREE');
    }
    const detail = renderPage('organize', { captures: [detailCapture], sources: [] }, { captureId: 'rcap-x' });
    expect(detail).not.toContain('>LOG<');
  });
});

describe('引导层（app.js / core.js）', () => {
  it('表单读取就近化：readCandidateForm 从被点按钮向上找最近的表单卡（多卡不串）', () => {
    expect(appSource).toContain('function readCandidateForm(anchorEl)');
    expect(appSource).toContain("anchorEl.closest('.ca-candidate-detail')");
    expect(appSource).toContain('readCandidateForm(el)');
  });

  it('批量动作有确认弹窗（写死条数）并从 store 收敛可执行行', () => {
    expect(appSource).toContain("case 'capture-batch'");
    expect(appSource).toContain('capture_batch_retry_confirm');
    expect(appSource).toContain('A.captureBatch');
  });

  it('整理这个会话 = 建任务后立即 runNow（runNow 是既定的唯一额度消耗入口）', () => {
    const fnStart = coreSource.indexOf('async organizeConversation');
    const fnEnd = coreSource.indexOf('async updateCaptureSettings', fnStart);
    const block = coreSource.slice(fnStart, fnEnd);
    expect(block).toContain('historicalAutoStart');
    const autoStart = block.indexOf('historicalAutoStart');
    const runNow = block.indexOf("recall.captures.runNow'");
    expect(autoStart).toBeGreaterThan(-1);
    expect(runNow).toBeGreaterThan(autoStart);
    expect(block).toContain("capture.status === 'waiting_manual'");
  });

  it('快照不再拉 KSTAR 经验；时间线仍拉（资产详情使用记录依赖）', () => {
    expect(coreSource).not.toContain('kstar.experiences.list');
    expect(coreSource).toContain('recall.timeline.list');
  });

  it('configure_model 的处理出口是应用设置页的模型区；整理进度由变更事件刷新，不再轮询', () => {
    expect(appSource).toContain("case 'go-configure-model'");
    // 设置页懒加载：tab 与锚点必须挂在 setView 上，否则配置页加载完后停在默认的
    // 「数据」tab（与知识库「去设置管理模型」同一类真机故障）。
    expect(appSource).toContain("{ settingsTab: 'configuration', settingsAnchor: 'models' }");
    expect(appSource).toContain("activateSettingsTab('configuration', { anchor: 'models' })");
    expect(appSource).toContain('NS.setupChangeRail(panelVisible)');
    expect(coreSource).toContain("subscribe('cognition:changed'");
    expect(coreSource).toMatch(/['"]?captures['"]?:\s*\['captures'\]/);
    expect(appSource).not.toContain('setInterval');
  });
});

/* ═══════════ G1/G2 补落点（承接表 01/02，2026-09-26 B 阶段复核）═══════════ */

describe('G1 任务执行失败与整理失败分别反馈（承接表 01）', () => {

  it('已有整理记录的失败会话不重复计任务失败；无失败时不出该行', () => {
    const withCapture = renderPage('review', {
      loaded: true, loading: false, inbox: [], inboxGroups: null,
      sources: [{ items: [{ id: 'conv-task-fail', lastTurnFailed: true }] }],
      captures: [{ id: 'cap-1', conversationId: 'conv-task-fail', actions: [] }],
    });
    expect(withCapture).not.toContain('任务执行失败');
    const quiet = renderPage('review', { loaded: true, loading: false, inbox: [], inboxGroups: null, sources: [{ items: [{ id: 'conv-ok' }] }] });
    expect(quiet).not.toContain('任务执行失败');
  });
});

describe('G2 候选卡补适用范围呈现（承接表 02）', () => {
  const scopeCandidate = {
    id: 'cand-scope', summary: '带范围的候选', suggestedType: 'rule',
    suggestedScope: 'architecture',
    applicableWhen: ['发布窗口内'], forbiddenWhen: ['紧急回滚时'],
    capabilities: { canPromote: true, canDefer: true, canReject: true, canEdit: false },
  };
  it('新建型候选卡显示作用域与适用/禁用场景', () => {
    const html = renderPage('review', { candidates: [scopeCandidate] }, { candidateId: 'cand-scope', name: 'review' });
    // 详情卡（route.candidateId 命中时）——断言取详情面。
    const detail = renderPage('overview', { loaded: true, loading: false, candidates: [scopeCandidate], assets: [], inbox: [], inboxGroups: null }, { name: 'review', candidateId: 'cand-scope' });
    void html;
    expect(detail).toContain('适用范围');
    expect(detail).toContain('原有设置：architecture');
    expect((detail.match(/原有设置：architecture/g) || []).length).toBe(1);
    expect(detail).toContain('<div class="content-text">发布窗口内</div>');
    expect(detail).toContain('<div class="content-text">紧急回滚时</div>');
  });

  it('没有限定时如实说没有，不编造默认范围', () => {
    const bare = { id: 'cand-bare', summary: '无范围候选', suggestedType: 'fact', capabilities: { canPromote: true } };
    const detail = renderPage('overview', { loaded: true, loading: false, candidates: [bare], assets: [], inbox: [], inboxGroups: null }, { name: 'review', candidateId: 'cand-bare' });
    expect(detail).toContain('尚未填写适用任务范围；确认保存前需要补全。');
  });
});
