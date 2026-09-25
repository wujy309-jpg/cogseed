/**
 * 治理待办分组区（specs/010 T014~T016 / T011 / T025 渲染面）。
 *
 * 页面级断言（与 cognition-capture-log.test.ts 同构的真实页面装配）：
 *   - 分组标题按 冲突 → 扩权 → 缺边界 → 未分级 → 其他 定序、空组不出标题；
 *   - 各分区的行渲染读模型给的动作（渲染层不自判）：扩权两钮、补条件就地表单
 *     （预填当前条件）、未分级聚合（共享分段控件 + 批量钮 + 名单）、冲突选边；
 *   - 降级路径逐字退回扁平清单；空态恰一处；不出现裸动作名。
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import vm from 'node:vm';

const globalScope = globalThis as unknown as Record<string, unknown>;

let cogAssets: Record<string, unknown> | null = null;
let domRoot: { innerHTML: string } | null = null;

function ensureModule(): { cogAssets: Record<string, unknown>; domRoot: { innerHTML: string } } {
  if (cogAssets && domRoot) return { cogAssets, domRoot };
  const T = (key: string, fallbackOrVars?: unknown, maybeVars?: Record<string, string>) => {
    const vars = typeof fallbackOrVars === 'string' ? maybeVars : fallbackOrVars;
    let text = key;
    const locales = JSON.parse(fs.readFileSync(path.join(__dirname, '../../src/renderer/locales/zh.json'), 'utf8')) as Record<string, string>;
    if (locales[key] !== undefined) text = String(locales[key]);
    else if (typeof fallbackOrVars === 'string') text = fallbackOrVars;
    if (vars && typeof vars === 'object') {
      for (const [name, value] of Object.entries(vars as Record<string, string>)) {
        text = text.replace(new RegExp(`\\{${name}\\}`, 'g'), value);
      }
    }
    return text;
  };
  cogAssets = {
    T, esc: (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    fmtDate: () => '2026/09/26 03:00',
    TABS: [
      { id: 'review', titleKey: 'cognition.tab_review', title: '待我处理' },
      { id: 'overview', titleKey: 'cognition.tab_overview', title: '我的认知' },
      { id: 'organize', titleKey: 'cognition.tab_organize', title: '整理' },
    ],
    stats: () => ({ confirmed: 0, pending: 0, validated: 0, transferOk: 0, sourceIssues: 0, failedTasks: 0, coveredAssets: 0, proofCount: 0, attention: 0 }),
    store: {
      loaded: true, loading: false, errors: [],
      route: { name: 'review', category: '', assetId: '', candidateId: '', proofEventId: '', captureBucket: '', captureId: '', sourceIssueOpen: '' },
      captures: [], captureSettings: null,
      sources: [], proofs: [], assets: [], candidates: [],
      organizeSettingsOpen: false, organizeListExpanded: true,
    },
  };
  domRoot = { innerHTML: '' };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { uiInput, uiSwitch, uiTextarea } = require('../../src/renderer/modules/ui-form.js');
  const { uiEmptyState } = require('../../src/renderer/modules/ui-empty.js');
  globalScope.window = {
    CogAssets: cogAssets,
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    uiButton: require('../../src/renderer/modules/ui-button.js').uiButton,
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    uiIconButton: require('../../src/renderer/modules/ui-button.js').uiIconButton,
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    uiIconHtml: (() => { require('../../src/renderer/modules/icons.js'); return (globalScope as { uiIconHtml?: unknown }).uiIconHtml; })(),
    uiInput, uiSwitch, uiTextarea, uiEmptyState,
  };
  globalScope.document = { getElementById: () => domRoot };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../../src/renderer/modules/ui-status.js');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../../src/renderer/modules/ui-page-header.js');
  // 分段控件是 index.html 的静态共享层（敏感级三档控件用它，specs/010 T011）。
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../../src/renderer/modules/ui-segmented-control.js');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../../src/renderer/modules/cognition-assets/vocabulary.js');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../../src/renderer/modules/cognition-assets/views.js');
  return { cogAssets, domRoot };
}

function renderPage(routeName: string, storePatch: Record<string, unknown>): string {
  const { cogAssets: NS, domRoot: rootEl } = ensureModule();
  Object.assign(NS.store as Record<string, unknown>, storePatch);
  (NS.store as Record<string, unknown>).route = { name: routeName, category: '', assetId: '', candidateId: '', proofEventId: '', captureBucket: '', captureId: '', sourceIssueOpen: '' };
  rootEl.innerHTML = '';
  (NS.render as () => void)();
  return rootEl.innerHTML;
}

const CONFLICT_ITEM = {
  id: 'conflict:cand-1', kind: 'classification_conflict', urgency: 'confirm',
  title: '同一句话', candidateId: 'cand-1', detail: 'fact / rule', actions: ['claim', 'reject', 'defer'],
};
const ESCALATION_ITEM = {
  id: 'sensitivity-up:aa-1', kind: 'sensitivity_escalated', urgency: 'confirm',
  title: '被提级的资产', assetId: 'aa-1', detail: 'L1 → L2', level: { before: 'L1', after: 'L2' }, actions: ['accept', 'reject'],
};
const BOUNDARY_ITEM = {
  id: 'rule-boundary:aa-2', kind: 'rule_boundary_missing', urgency: 'low_disturbance',
  title: '缺边界的规则', assetId: 'aa-2', boundary: { applicableWhen: ['发布窗口内'], forbiddenWhen: [] }, actions: ['set_boundary'],
};
const UNCLASSIFIED_ITEMS = [
  { id: 'sensitivity:aa-3', kind: 'sensitivity_unclassified', urgency: 'confirm', title: '资产三', assetId: 'aa-3', actions: ['classify'] },
  { id: 'sensitivity:aa-4', kind: 'sensitivity_unclassified', urgency: 'confirm', title: '资产四', assetId: 'aa-4', actions: ['classify'] },
];
const AGGREGATE_ITEM = {
  id: 'sensitivity-batch:xyz', kind: 'sensitivity_unclassified', urgency: 'confirm',
  title: '2 条资产还没有分级', actions: ['classify'],
  aggregate: { count: 2, assetIds: ['aa-3', 'aa-4'] },
};
const OTHER_ITEM = {
  id: 'candidate:cand-9', kind: 'candidate_pending_review', urgency: 'low_disturbance',
  title: '普通待确认候选', candidateId: 'cand-9', actions: ['accept', 'reject', 'defer'],
};
const PAIR_FINDING = {
  id: 'inspection:dup:aa-5+aa-6', kind: 'inspection_finding', urgency: 'low_disturbance',
  title: '很像的两条', assetId: 'aa-5', assetIds: ['aa-5', 'aa-6'], findingCategory: 'duplicate',
  detail: '这两条看字面很像（97%）', actions: ['keep', 'merge', 'reject', 'defer'],
};

/** 与主进程 groupCognitionInbox 同构的分组夹具（顺序、折叠行为一致）。 */
function groupsFixture(_items: Array<Record<string, unknown>>) {
  return [
    { category: 'conflict', titleKey: 'cognition.inbox_group_conflict', items: [CONFLICT_ITEM, PAIR_FINDING], count: 2, total: 3 },
    { category: 'escalation', titleKey: 'cognition.inbox_group_escalation', items: [ESCALATION_ITEM], count: 1, total: 1 },
    { category: 'boundary', titleKey: 'cognition.inbox_group_boundary', items: [BOUNDARY_ITEM], count: 1, total: 1 },
    { category: 'unclassified', titleKey: 'cognition.inbox_group_unclassified', items: [AGGREGATE_ITEM], count: 1, total: 2 },
    { category: 'other', titleKey: 'cognition.inbox_group_other', items: [OTHER_ITEM], count: 1, total: 1 },
  ].filter((group) => group.items.length);
}

describe('治理待办分组区（specs/010 T014~T016/T011/T025）', () => {
  it('分组标题按固定顺序呈现、未分级显示总数而非条数、空组不出标题', () => {
    const items = [CONFLICT_ITEM, ESCALATION_ITEM, BOUNDARY_ITEM, ...UNCLASSIFIED_ITEMS, PAIR_FINDING, OTHER_ITEM];
    const html = renderPage('review', { inbox: items, inboxGroups: groupsFixture(items) });
    const order = [
      html.indexOf('冲突与重复'), html.indexOf('敏感级扩权'), html.indexOf('缺少作用边界'),
      html.indexOf('尚未分级'), html.indexOf('其他待处理'),
    ];
    for (const at of order) expect(at).toBeGreaterThan(-1);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // 未分级组显示 total（2）而非 count（1）。
    const unclassifiedBlock = html.slice(html.indexOf('尚未分级'), html.indexOf('其他待处理'));
    expect(unclassifiedBlock).toContain('>2<');
  });

  it('扩权行：确认扩权 / 驳回维持原级两钮（驳回 danger）', () => {
    const html = renderPage('review', { inbox: [ESCALATION_ITEM], inboxGroups: groupsFixture([ESCALATION_ITEM]) });
    expect(html).toContain('data-act="inbox-escalation-accept" data-id="sensitivity-up:aa-1"');
    expect(html).toContain('data-act="inbox-escalation-reject" data-id="sensitivity-up:aa-1"');
    expect(html).toContain('确认扩权');
    expect(html).toContain('驳回，维持原级');
  });

  it('缺边界行：就地表单预填当前条件（uiInput + data-f），保存钮在', () => {
    const html = renderPage('review', { inbox: [BOUNDARY_ITEM], inboxGroups: groupsFixture([BOUNDARY_ITEM]) });
    expect(html).toContain('data-inbox-boundary-form');
    expect(html).toContain('data-f="applicableWhen"');
    expect(html).toContain('data-f="forbiddenWhen"');
    // 预填当前条件（发布窗口内），不是空表单。
    expect(html).toContain('value="发布窗口内"');
    expect(html).toContain('data-act="inbox-boundary-save" data-id="rule-boundary:aa-2"');
  });

  it('未分级聚合：共享分段控件（三档均未选中）+ 批量定级钮携带名单', () => {
    const items = [...UNCLASSIFIED_ITEMS];
    const html = renderPage('review', { inbox: items, inboxGroups: groupsFixture(items) });
    expect(html).toContain('ui-segmented-control');
    expect(html).toContain('aria-pressed="false"');
    expect((html.match(/aria-pressed="false"/g) || []).length).toBeGreaterThanOrEqual(3);
    expect(html).toContain('data-act="inbox-classify-level"');
    expect(html).toContain('data-act="inbox-classify-batch" data-id="sensitivity-batch:xyz" data-ids="aa-3,aa-4"');
    // 名单可见（聚合不丢条目）。
    expect(html).toContain('aa-3');
    expect(html).toContain('aa-4');
  });

  it('未分级单条（无聚合）：保存分级钮在', () => {
    const single = UNCLASSIFIED_ITEMS[0];
    const groups = [{ category: 'unclassified', titleKey: 'cognition.inbox_group_unclassified', items: [single], count: 1, total: 1 }];
    const html = renderPage('review', { inbox: [single], inboxGroups: groups });
    expect(html).toContain('data-act="inbox-classify-apply" data-id="sensitivity:aa-3"');
    expect(html).not.toContain('inbox-classify-batch');
  });

  it('冲突行：候选侧 claim；巡检 pair 侧 keep/merge 携带 anchor 与另一方', () => {
    const items = [CONFLICT_ITEM, PAIR_FINDING];
    const html = renderPage('review', { inbox: items, inboxGroups: groupsFixture(items) });
    expect(html).toContain('data-act="inbox-conflict-claim" data-id="conflict:cand-1"');
    expect(html).toContain('data-act="inbox-inspection-keep" data-id="inspection:dup:aa-5+aa-6" data-anchor="aa-5" data-target="aa-6"');
    expect(html).toContain('data-act="inbox-inspection-merge" data-id="inspection:dup:aa-5+aa-6" data-anchor="aa-5" data-target="aa-6"');
  });

  it('不出现裸动作名（label 表全覆盖，labels[action]||action 的兜底不触发）', () => {
    const items = [CONFLICT_ITEM, ESCALATION_ITEM, BOUNDARY_ITEM, ...UNCLASSIFIED_ITEMS, PAIR_FINDING, OTHER_ITEM];
    const html = renderPage('review', { inbox: items, inboxGroups: groupsFixture(items) });
    for (const bare of ['>claim<', '>keep<', '>merge<', '>classify<', '>set_boundary<', '>accept<', '>reject<']) {
      expect(html).not.toContain(bare);
    }
  });

  it('降级路径：groups 缺失时逐字退回扁平清单（既有断言的锚点行为）', () => {
    const html = renderPage('review', { inbox: [OTHER_ITEM], inboxGroups: null });
    expect(html).toContain('待确认清单');
    expect(html).toContain('data-act="inbox-resolve" data-id="candidate:cand-9" data-action="accept"');
    expect(html).not.toContain('冲突与重复');
  });

  it('空态恰一处：没有待办时只出现一个空态说明，没有空分组标题', () => {
    const html = renderPage('review', { inbox: [], inboxGroups: [] });
    expect((html.match(/没有需要你确认的事项。/g) || []).length).toBe(1);
    expect(html).not.toContain('冲突与重复');
    expect(html).not.toContain('其他待处理');
  });
});
