/**
 * 标签系统渲染层用例（specs/012 T014，US-201 渲染段）。
 *
 * 两条腿（照 chat-asset-approval-card.test.ts 先例）：
 *  1. **真实调用级**：vm 沙箱装载真的共享控件（ui-button/ui-status/ui-form/
 *     ui-empty/ui-segmented-control）+ 真的中文词条 + cognition-assets 的
 *     core/views——组件用错当场抛错；筛选、批量三语义与进度、管理三动作
 *     确认语、详情标签节都按输出断言。
 *  2. **源码级**：IME 组合回车不提交（app.js 委托层守卫）、管理弹层/
 *     批量清单不泄露资产正文（受限正文不进界面）。
 *
 * 主进程端到端（打标→筛选→联动→删除零改动）在
 * test/main/features/recall/asset-tag-system.test.ts（T015）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vm from 'node:vm';

const rendererRoot = path.resolve(__dirname, '../../src/renderer');
const zh: Record<string, string> = JSON.parse(
  fs.readFileSync(path.join(rendererRoot, 'locales/zh.json'), 'utf8'),
);
const appSource = fs.readFileSync(path.join(rendererRoot, 'modules/cognition-assets/app.js'), 'utf8');

const TAG_ASSETS = [
  { id: 'aa-tag-1', type: 'personal', title: '发布流程经验', statement: '正文一：走灰度发布。', status: 'active', version: '1', updatedAt: '2026-09-24T01:00:00Z', tags: ['发布'] },
  { id: 'aa-tag-2', type: 'personal', title: '发布沟通模板', statement: '正文二：周报模板。', status: 'active', version: '1', updatedAt: '2026-09-24T02:00:00Z', tags: ['发布', '沟通'] },
  { id: 'aa-tag-3', type: 'rule', title: '沟通规则', statement: '正文三：不用比喻。', status: 'active', version: '1', updatedAt: '2026-09-24T03:00:00Z', tags: ['沟通'] },
  { id: 'aa-tag-4', type: 'rule', title: '还没打标', statement: '正文四：待分类。', status: 'active', version: '1', updatedAt: '2026-09-24T04:00:00Z' },
];

const TAG_ITEMS = [
  { id: 'tg-aaaaaaaaaaa1', name: '发布', state: 'active', createdFrom: 'user', assetCount: 2, createdAt: '2026-09-20T00:00:00Z', updatedAt: '2026-09-24T00:00:00Z' },
  { id: 'tg-aaaaaaaaaaa2', name: '沟通', state: 'active', createdFrom: 'user', assetCount: 2, createdAt: '2026-09-20T00:00:00Z', updatedAt: '2026-09-24T00:00:00Z' },
  // retired 与零引用都不进筛选条（T012 契约）。
  { id: 'tg-aaaaaaaaaaa3', name: '旧名', state: 'merged', createdFrom: 'user', assetCount: 5, aliases: [], formerNames: [], createdAt: '2026-09-20T00:00:00Z', updatedAt: '2026-09-24T00:00:00Z' },
  { id: 'tg-aaaaaaaaaaa4', name: '零引用', state: 'active', createdFrom: 'user', assetCount: 0, createdAt: '2026-09-20T00:00:00Z', updatedAt: '2026-09-24T00:00:00Z' },
];

function translate(key: string, vars?: Record<string, unknown>): string {
  let raw = typeof zh[key] === 'string' ? zh[key] : key;
  for (const [name, value] of Object.entries(vars || {})) {
    raw = raw.split(`{${name}}`).join(String(value));
  }
  return raw;
}

type InvokeMock = ReturnType<typeof vi.fn>;

/** 装一份 cognition-assets（core+views）到 vm 沙箱；返回命名空间与出口。 */
function loadCognition(options: {
  route?: Record<string, unknown>;
  state?: Record<string, unknown>;
  invoke?: InvokeMock;
  windowStubs?: Record<string, unknown>;
  queryResults?: Record<string, unknown>;
} = {}) {
  const root = { innerHTML: '', hidden: false };
  const document: any = {
    getElementById: (id: string) => (id === 'ca-root' ? root : null),
    _queryResults: options.queryResults || {},
    querySelector(selector: string) { return this._queryResults[selector] || null; },
  };
  const toasts: Array<{ message: string; variant?: string }> = [];
  const confirms: string[] = [];
  const context: any = {
    console,
    document,
    window: {
      addEventListener() {},
      cogseed: { invoke: options.invoke || vi.fn(async () => ({ ok: true })) },
      t: translate,
      uiIconHtml: () => '',
      uiToast: (message: string, payload: any) => { toasts.push({ message, variant: payload && payload.variant }); },
      uiConfirm: async (message: string) => { confirms.push(message); return true; },
      uiConfirmDanger: async (payload: any) => { confirms.push(String(payload && payload.message)); return true; },
      ...(options.windowStubs || {}),
    },
  };
  context.global = context;
  context.globalThis = context;
  vm.createContext(context);
  for (const file of [
    'ui-button.js', 'ui-status.js', 'ui-form.js', 'ui-empty.js', 'ui-segmented-control.js',
    'cognition-assets/core.js', 'cognition-assets/views.js',
  ]) {
    vm.runInContext(fs.readFileSync(path.join(rendererRoot, 'modules', file), 'utf8'), context, { filename: file });
  }
  const store = context.window.CogAssets.store;
  Object.assign(store, {
    loaded: true,
    loading: false,
    errors: [],
    assets: TAG_ASSETS,
    proofs: [],
    ...(options.state || {}),
  }, {
    route: {
      name: 'overview', category: '', assetId: '', candidateId: '', proofEventId: '',
      captureBucket: '', captureId: '', sourceIssueOpen: '', kstarEpisodeId: '',
      assetVersionId: '', assetEdit: '', assetVersionDiff: '', assetVersionsExpanded: '',
      assetView: '', familyRename: '', ontologyBox: '', experienceId: '',
      tagFilter: '', tagMode: '', tagUntagged: '', tagSelect: '', tagOverlay: '',
      ...(options.route || {}),
    },
  });
  return {
    ns: context.window.CogAssets,
    store,
    root,
    document,
    toasts,
    confirms,
    render: () => { context.window.CogAssets.render(); return root.innerHTML; },
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});
/** 从 invoke 记录里按通道名取调用（reload 会插入 recall.assets.list 等快照
 *  调用，不能按下标取——只认目标通道的那一条）。 */
function callOf(invoke: InvokeMock, channel: string): any[] {
  return invoke.mock.calls.filter((entry: any[]) => entry[0] === channel);
}

describe('标签筛选条（T012）', () => {
  it('数据源只显示 assetCount>0 的 active + 「未分类」chip；计数按其它筛选生效后算', () => {
    const { render } = loadCognition({ state: { tags: { items: TAG_ITEMS, loading: false, failed: false, stale: false } } });
    const html = render();
    expect(html).toContain('ca-tag-filter');
    // 发布/沟通（assetCount=2）在；retired「旧名」与零引用「零引用」不在。
    expect(html).toContain('发布 2');
    expect(html).toContain('沟通 2');
    expect(html).not.toContain('旧名');
    expect(html).not.toContain('零引用');
    // 「未分类」chip 计数 = 未打标资产数（aa-tag-4 一条）。
    expect(html).toContain(`${zh['cognition.tag_untagged']} 1`);
    // 交/并集切换与「管理标签」入口都在（共享 uiSegmentedControl）。
    expect(html).toContain('ui-segmented-control');
    expect(html).toContain(`data-act="filter-tag-mode"`);
    expect(html).toContain(`data-act="tag-manage"`);
  });

  it('空库不显示标签筛选行（「未分类 = 全量」，不误导）', () => {
    const { render } = loadCognition({ state: { tags: { items: [], loading: false, failed: false, stale: false } } });
    const html = render();
    expect(html).not.toContain('ca-tag-filter');
  });

  it('并集（默认）：命中任一标签即入选，且保持主进程顺序（渲染层不重排）', () => {
    const { render } = loadCognition({
      route: { tagFilter: '发布\u001f沟通' },
      state: { tags: { items: TAG_ITEMS, loading: false, failed: false, stale: false } },
    });
    const html = render();
    expect(html).toContain('发布流程经验');
    expect(html).toContain('发布沟通模板');
    expect(html).toContain('沟通规则');
    expect(html).not.toContain('还没打标');
    // 保序：aa-tag-1 的标题先于 aa-tag-3 出现。
    expect(html.indexOf('发布流程经验')).toBeLessThan(html.indexOf('沟通规则'));
  });

  it('交集（同时具备）：两条都命中才入选', () => {
    const { render } = loadCognition({
      route: { tagFilter: '发布\u001f沟通', tagMode: 'all' },
      state: { tags: { items: TAG_ITEMS, loading: false, failed: false, stale: false } },
    });
    const html = render();
    expect(html).toContain('发布沟通模板');
    expect(html).not.toContain('发布流程经验');
    expect(html).not.toContain('沟通规则');
  });

  it('「未分类」= !tags || length===0；与类型筛选 AND 叠加', () => {
    const { render } = loadCognition({
      route: { tagUntagged: '1', category: 'rule' },
      state: { tags: { items: TAG_ITEMS, loading: false, failed: false, stale: false } },
    });
    const html = render();
    expect(html).toContain('还没打标');
    expect(html).not.toContain('发布流程经验');
    expect(html).not.toContain('沟通规则'); // rule 但有标签，被标签轴筛掉
  });

  it('「未分类」+「同时具备」= 空集：显示明确空态说明，不是一屏空白', () => {
    const { render } = loadCognition({
      route: { tagFilter: '发布', tagMode: 'all', tagUntagged: '1' },
      state: { tags: { items: TAG_ITEMS, loading: false, failed: false, stale: false } },
    });
    const html = render();
    expect(html).toContain(zh['cognition.tag_filter_empty_all']);
  });

  it('纯判定件 matchesTagFilter：大小写不敏感、未分类语义独立', () => {
    const { ns } = loadCognition();
    const asset = { tags: ['Release'] };
    expect(ns.matchesTagFilter(asset, ['release'], false, 'any')).toBe(true);
    expect(ns.matchesTagFilter({ tags: [] }, [], true, 'any')).toBe(true);
    expect(ns.matchesTagFilter({ tags: ['a'] }, [], true, 'any')).toBe(false);
    // 交集：names 全中才算中；untagged 与 all 组合恒空。
    expect(ns.matchesTagFilter({ tags: ['a', 'b'] }, ['a', 'b'], false, 'all')).toBe(true);
    expect(ns.matchesTagFilter({ tags: ['a'] }, ['a', 'b'], false, 'all')).toBe(false);
    expect(ns.matchesTagFilter({ tags: [] }, ['a'], true, 'all')).toBe(false);
  });
});

describe('资产详情「标签」节（T010）', () => {
  it('已有标签用 uiTag + 移除；空态给「未分类」+ 引导；输入与候选下拉都是共享件', () => {
    const { render } = loadCognition({
      route: { assetId: 'aa-tag-1' },
      state: { tags: { items: TAG_ITEMS, loading: false, failed: false, stale: false } },
    });
    const html = render();
    expect(html).toContain('ui-tag');
    expect(html).toContain(`data-act="tag-remove"`);
    expect(html).toContain('data-tag-input');
    expect(html).toContain(`data-act="tag-add"`);
    // 候选下拉：已有「发布」不再出现在候选里，未挂的「沟通」在。
    expect(html).toContain(zh['cognition.tag_candidates']);
    expect(html).toContain('data-preset="1"');

    const bare = loadCognition({ route: { assetId: 'aa-tag-4' } });
    const emptyHtml = bare.render();
    expect(emptyHtml).toContain(zh['cognition.tag_empty']);
    expect(emptyHtml).toContain(zh['cognition.tag_empty_hint']);
    expect(emptyHtml).not.toContain(`data-act="tag-remove"`);
  });

  it('提交走整组替换：新增时提交的是「现值 + 新名」的最终名单（真实调用级）', async () => {
    const invoke = vi.fn(async () => ({ ok: true, asset: { ...TAG_ASSETS[0] } }));
    const loaded = loadCognition({ invoke });
    await loaded.ns.actions.addAssetTag('aa-tag-1', ' 重构 ');
    const calls = callOf(invoke, 'recall.assets.tags.set');
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toEqual({ assetId: 'aa-tag-1', tags: ['发布', '重构'] });
  });

  it('同名标签不触发 IPC，只提示不重复添加', async () => {
    const invoke = vi.fn(async () => ({ ok: true }));
    const loaded = loadCognition({ invoke });
    await loaded.ns.actions.addAssetTag('aa-tag-1', '发布');
    expect(invoke).not.toHaveBeenCalled();
    expect(loaded.toasts.some((entry) => entry.message === zh['cognition.tag_duplicate_hint'])).toBe(true);
  });

  it('移除也是整组替换：把目标名字从现值里减掉', async () => {
    const invoke = vi.fn(async () => ({ ok: true }));
    const loaded = loadCognition({ invoke });
    await loaded.ns.actions.removeAssetTag('aa-tag-2', '发布');
    const calls = callOf(invoke, 'recall.assets.tags.set');
    expect(calls).toHaveLength(1);
    expect(calls[0][1].tags).toEqual(['沟通']);
    expect(loaded.toasts.some((entry) => entry.message.includes('发布'))).toBe(true);
  });
});

describe('列表批量打标（T011）', () => {
  it('多选态渲染 uiCheckbox + 批量条；三选一语义分开提交（真实调用级）', async () => {
    const invoke = vi.fn(async () => ({ ok: true, report: { total: 2, updated: 2, unchanged: 0, failed: 0, items: [] } }));
    const loaded = loadCognition({
      route: { tagSelect: '1' },
      state: { tagSelectIds: ['aa-tag-1', 'aa-tag-2'], tags: { items: TAG_ITEMS, loading: false, failed: false, stale: false } },
      invoke,
    });
    const html = loaded.render();
    expect(html).toContain('ui-checkbox');
    expect(html).toContain(`data-act="tag-select-toggle"`);
    expect(html).toContain(zh['cognition.tag_selected_count'].replace('{n}', '2'));
    expect(html).toContain(`data-act="tag-batch-run"`);

    await loaded.ns.actions.batchTags(['发布'], 'add');
    expect(callOf(invoke, 'recall.assets.tags.batch')[0][1].op).toEqual({ add: ['发布'] });

    await loaded.ns.actions.batchTags(['沟通'], 'remove');
    expect(callOf(invoke, 'recall.assets.tags.batch')[1][1].op).toEqual({ remove: ['沟通'] });

    await loaded.ns.actions.batchTags(['重构'], 'replace');
    expect(callOf(invoke, 'recall.assets.tags.batch')[2][1].op).toEqual({ replace: ['重构'] });
  });

  it('进度可见且失败清单不截断；整批拒绝时按本地名单逐项记失败', async () => {
    const invoke = vi.fn(async () => {
      if (invoke.mock.calls.length === 1) {
        return {
          ok: true,
          report: {
            total: 2, updated: 1, unchanged: 0, failed: 1,
            items: [
              { assetId: 'aa-tag-1', title: '发布流程经验', status: 'updated' },
              { assetId: 'aa-tag-2', title: '发布沟通模板', status: 'failed', note: 'exceeds 12 tags' },
            ],
          },
        };
      }
      // 第二批（refreshTags 之外的 snapshot 读取可能多次调用其它通道），
      // 让后续 batch 调用整体抛错，覆盖「整批拒绝」路径。
      throw new Error('invalid recall asset tag batch: exceeds 200 assets, split into smaller batches');
    });
    const loaded = loadCognition({
      state: { tagSelectIds: ['aa-tag-1', 'aa-tag-2'], tags: { items: TAG_ITEMS, loading: false, failed: false, stale: false } },
      invoke,
    });
    await loaded.ns.actions.batchTags(['发布'], 'add');
    expect(invoke).toHaveBeenCalled();
    // 完成后：不在运行态、进度数字齐、失败清单完整（标题 + 原因都在）。
    expect(loaded.store.tagBatch.running).toBe(false);
    expect(loaded.store.tagBatch.done).toBe(2);
    expect(loaded.store.tagBatch.total).toBe(2);
    expect(loaded.store.tagBatch.failed).toHaveLength(1);
    expect(loaded.store.tagBatch.failed[0].note).toBe('exceeds 12 tags');

    // 渲染层把失败清单如实摆出来（uiProgressBar 进度 + 逐项标题）。
    loaded.store.route.tagSelect = '1';
    loaded.ns.notify();
    const html = loaded.render();
    expect(html).toContain('ui-progress');
    expect(html).toContain('发布沟通模板');
    expect(html).toContain('exceeds 12 tags');
    expect(html).toContain(zh['cognition.tag_batch_failed_note']);

    // 整批拒绝路径：第二次执行时所有调用抛错 → 本地名单逐项进失败清单。
    loaded.store.tagSelectIds = ['aa-tag-1'];
    await loaded.ns.actions.batchTags(['沟通'], 'remove');
    expect(loaded.store.tagBatch.failed.some((item: any) => item.assetId === 'aa-tag-1')).toBe(true);
  });

  it('没选资产 / 没填标签名时如实提示，不发起 IPC', async () => {
    const invoke = vi.fn(async () => ({ ok: true }));
    const loaded = loadCognition({ state: { tagSelectIds: [] }, invoke });
    await loaded.ns.actions.batchTags(['发布'], 'add');
    expect(invoke).not.toHaveBeenCalled();
    loaded.store.tagSelectIds = ['aa-tag-1'];
    await loaded.ns.actions.batchTags([], 'add');
    expect(invoke).not.toHaveBeenCalled();
    expect(loaded.toasts.some((entry) => entry.message === zh['cognition.tag_batch_no_tags'])).toBe(true);
  });
});

describe('标签管理弹层（T013）', () => {
  const retiredItems = [...TAG_ITEMS, {
    id: 'tg-aaaaaaaaaaa5', name: '上线流程', state: 'merged', createdFrom: 'user', assetCount: 0,
    formerNames: ['发版流程'], aliases: ['旧上线'], createdAt: '2026-09-20T00:00:00Z', updatedAt: '2026-09-24T00:00:00Z',
  }];

  it('弹层（不新建页面）承载三动作入口 + 建议（只建议不合并）+ 已停用/已合并折叠区', () => {
    const { render } = loadCognition({
      route: { tagOverlay: 'manage' },
      state: {
        tags: { items: retiredItems, loading: false, failed: false, stale: false },
        tagSuggestions: [{ sourceName: '发布', targetName: '发版', reason: 'similar' }],
      },
    });
    const html = render();
    // 弹层 markup 落在持久壳槽位，过 uiModalController（ui-modal 形态）。
    expect(html).toContain('data-tag-overlay="manage"');
    expect(html).toContain('role="dialog"');
    expect(html).toContain(zh['cognition.tag_manage_title']);
    // 三动作。
    expect(html).toContain(`data-act="tag-rename"`);
    expect(html).toContain(`data-act="tag-merge"`);
    expect(html).toContain(`data-act="tag-delete"`);
    // 建议区只读 + 直达按钮；折叠区显示 formerNames/aliases。
    expect(html).toContain(zh['cognition.tag_suggestions']);
    expect(html).toContain(zh['cognition.tag_suggestions_hint']);
    expect(html).toContain(`data-act="tag-suggestion-merge"`);
    expect(html).toContain(zh['cognition.tag_retired_section']);
    expect(html).toContain('发版流程');
    expect(html).toContain('旧上线');
  });

  it('渲染建议不等于合并：不发起任何写通道', () => {
    const invoke = vi.fn(async () => ({ ok: true }));
    const loaded = loadCognition({
      route: { tagOverlay: 'manage' },
      state: {
        tags: { items: TAG_ITEMS, loading: false, failed: false, stale: false },
        tagSuggestions: [{ sourceName: '发布', targetName: '发版', reason: 'similar' }],
      },
      invoke,
    });
    loaded.render();
    expect(invoke).not.toHaveBeenCalledWith('recall.tags.merge', expect.anything());
  });

  it('重命名：确认语带影响面（N 条资产 + 新旧名）；完成 toast 数字与实际一致', async () => {
    const invoke = vi.fn(async () => ({ ok: true, report: { total: 2, updated: 2, unchanged: 0, failed: 0, items: [] } }));
    const loaded = loadCognition({
      state: {
        tags: { items: TAG_ITEMS, loading: false, failed: false, stale: false },
        tagManageEdit: 'tg-aaaaaaaaaaa1',
      },
      queryResults: { '[data-tag-rename-input]': { value: '发版' } },
      invoke,
    });
    await loaded.ns.actions.renameTag('tg-aaaaaaaaaaa1');
    expect(loaded.confirms[0]).toContain('2 条资产');
    expect(loaded.confirms[0]).toContain('发布');
    expect(loaded.confirms[0]).toContain('发版');
    const calls = callOf(invoke, 'recall.tags.rename');
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toEqual({ tagId: 'tg-aaaaaaaaaaa1', name: '发版' });
    expect(loaded.toasts.some((entry) => entry.message === zh['cognition.tag_renamed_toast'].replace('{n}', '2'))).toBe(true);
  });

  it('重命名影响 0 条时不显示数字（如实）', async () => {
    const invoke = vi.fn(async () => ({ ok: true, report: { total: 0, updated: 0, unchanged: 0, failed: 0, items: [] } }));
    const loaded = loadCognition({
      state: {
        tags: { items: [{ ...TAG_ITEMS[0], assetCount: 0 }], loading: false, failed: false, stale: false },
        tagManageEdit: 'tg-aaaaaaaaaaa1',
      },
      queryResults: { '[data-tag-rename-input]': { value: '发版' } },
      invoke,
    });
    await loaded.ns.actions.renameTag('tg-aaaaaaaaaaa1');
    expect(loaded.toasts.some((entry) => entry.message === zh['cognition.tag_renamed_toast_zero'])).toBe(true);
  });

  it('合并：确认前必须显示影响面（N 条「源」改「目标」+ 源标签停用）', async () => {
    const invoke = vi.fn(async () => ({ ok: true, report: { total: 2, updated: 2, unchanged: 0, failed: 0, items: [] } }));
    const loaded = loadCognition({
      state: {
        tags: { items: TAG_ITEMS, loading: false, failed: false, stale: false },
        tagManageMerge: { sourceId: 'tg-aaaaaaaaaaa1', targetName: '沟通' },
      },
      invoke,
    });
    await loaded.ns.actions.mergeTag('tg-aaaaaaaaaaa1', '沟通');
    expect(loaded.confirms[0]).toContain('2 条资产');
    expect(loaded.confirms[0]).toContain('发布');
    expect(loaded.confirms[0]).toContain('沟通');
    expect(loaded.confirms[0]).toContain('源标签将停用');
    expect(callOf(invoke, 'recall.tags.merge')).toEqual([
      ['recall.tags.merge', { sourceTagId: 'tg-aaaaaaaaaaa1', targetTagId: 'tg-aaaaaaaaaaa2' }],
    ]);
  });

  it('删除确认语含「只摘除标签，资产本身不受影响」', async () => {
    const invoke = vi.fn(async () => ({ ok: true, report: { total: 2, updated: 2, unchanged: 0, failed: 0, items: [] } }));
    const loaded = loadCognition({
      state: { tags: { items: TAG_ITEMS, loading: false, failed: false, stale: false } },
      invoke,
    });
    await loaded.ns.actions.deleteTag('tg-aaaaaaaaaaa1');
    expect(loaded.confirms[0]).toContain('只摘除标签，资产本身不受影响');
    expect(loaded.confirms[0]).toContain('发布');
    expect(callOf(invoke, 'recall.tags.delete')).toEqual([
      ['recall.tags.delete', { tagId: 'tg-aaaaaaaaaaa1' }],
    ]);
  });
});

describe('族话术降级（T008）与隐私红线', () => {
  it('组头计数/无组文案已降级，不再出现「未归类」指族', () => {
    const { render } = loadCognition({
      state: {
        assets: [
          { id: 'aa-fam-1', type: 'personal', title: '同源甲', statement: '正文甲。', status: 'active', version: '1', updatedAt: '2026-09-24T01:00:00Z', relations: [{ kind: 'same_family', assetId: 'aa-fam-2' }] },
          { id: 'aa-fam-2', type: 'personal', title: '同源乙', statement: '正文乙。', status: 'active', version: '1', updatedAt: '2026-09-24T02:00:00Z', relations: [{ kind: 'same_family', assetId: 'aa-fam-1' }] },
          { id: 'aa-fam-3', type: 'rule', title: '独一条', statement: '正文丙。', status: 'active', version: '1', updatedAt: '2026-09-24T03:00:00Z' },
        ],
      },
    });
    const html = render();
    expect(html).toContain('2 条同源');
    expect(html).toContain('无同源血缘');
    expect(html).not.toContain('条同类');
    expect(html).not.toContain('未归类');
    expect(html).toContain(zh['cognition.family_rename']);
    expect(zh['cognition.family_rename']).toBe('命名同源血缘');
  });

  it('批量失败清单与管理弹层不泄露资产正文（只名字/标题/计数）', () => {
    const loaded = loadCognition({
      route: { tagOverlay: 'manage', tagSelect: '1' },
      state: {
        tags: { items: TAG_ITEMS, loading: false, failed: false, stale: false },
        tagBatch: {
          running: false, done: 4, total: 4, updated: 3, unchanged: 0,
          failed: [{ assetId: 'aa-tag-4', title: '还没打标', status: 'failed', note: 'exceeds 12 tags' }],
        },
      },
    });
    const html = loaded.render();
    expect(html).toContain('还没打标');
    expect(html).toContain('exceeds 12 tags');
    // 详情页之外的批量/管理区域不出现任何资产正文。
    expect(html).not.toContain('正文一');
    expect(html).not.toContain('正文二');
    expect(html).not.toContain('正文三');
    expect(html).not.toContain('正文四');
  });

  it('源码级：回车提交带 IME 组合守卫（isComposing / keyCode 229）', () => {
    expect(appSource).toContain("event.key !== 'Enter' || event.isComposing || event.keyCode === 229");
  });
});
