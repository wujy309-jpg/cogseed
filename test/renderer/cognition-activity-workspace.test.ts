import { describe, expect, it, vi } from 'vitest';
import { loadCognitionAssets } from './helpers/cognition-renderer';
const candidate = (id: string, extra = {}) => ({ id, summary: `建议 ${id}`, judgment: `长期内容 ${id}`, suggestedType: 'template', suggestedScope: 'general', status: 'pending_review', createdAt: `2026-10-11T0${id === 'a' ? 2 : 1}:00:00Z`, sourceRefs: [], capabilities: { countsAsPending: true, canEdit: true, canPromote: true, canReject: true }, ...extra });
const button = (act: string, id = '', card: any = null) => ({ dataset: { act, id }, disabled: false, getAttribute: () => null, setAttribute: vi.fn(), removeAttribute: vi.fn(), closest: () => card });
describe('系统活动列表与逐项审核', () => {
  it('默认打开首条、保留 50 条分页，详情使用紧凑编辑字段和固定操作栏', () => {
    const loaded = loadCognitionAssets({ candidates: Array.from({ length: 55 }, (_, i) => candidate(String(i))) }, { name: 'activity' });
    const html = loaded.render();
    expect(loaded.store.activityRows).toHaveLength(50);
    expect(html).toContain('每页 50 条');
    expect(html).toContain('data-f="summary"');
    expect(html).toContain('data-f="type"');
    const footer = html.slice(html.indexOf('<footer class="ca-activity-detail-footer">'));
    expect(footer).toContain('data-act="cand-adopt-with-form"');
    expect(footer).toContain('data-act="activity-save-draft"');
  });
  it('终态即使携带陈旧可编辑能力也只读，并展示真实处理者与依据', () => {
    const loaded = loadCognitionAssets({ candidates: [candidate('a', { status: 'confirmed', processingActor: '系统自动批准', processingReason: '证据完整、低风险', promotedAssetId: 'asset-a' })] }, { name: 'activity', activityView: 'done' });
    const html = loaded.render();
    expect(html).toContain('系统自动批准');
    expect(html).toContain('证据完整、低风险');
    expect(html).not.toContain('data-f="judgment"');
    expect(html).not.toContain('data-act="cand-adopt-with-form"');
    expect(html).not.toContain('data-act="cand-decide"');
  });
  it('未保存修改被拒绝离开时保留详情和草稿，允许离开后才更换选择', async () => {
    const loaded = loadCognitionAssets({ candidates: [candidate('a'), candidate('b')] }, { name: 'activity' });
    loaded.render();
    const card = { dataset: { candId: 'a', candType: 'template' } };
    loaded.ns.activityController.handleInput({ target: { dataset: { f: 'judgment' }, value: '新的可复用正文', closest: () => card } });
    loaded.ns.confirmUser = vi.fn(async () => false);
    loaded.ns.router.go = vi.fn();
    await loaded.ns.activityController.handleClick(button('activity-select', 'candidate:b'));
    expect(loaded.ns.router.go).not.toHaveBeenCalled();
    expect(loaded.render()).toContain('新的可复用正文');
    loaded.ns.confirmUser = vi.fn(async () => true);
    await loaded.ns.activityController.handleClick(button('activity-select', 'candidate:b'));
    expect(loaded.ns.router.go).toHaveBeenCalledWith(expect.objectContaining({ candidateId: 'b' }), { replace: true });
  });
  it('保存修改调用真实候选更新通道，保持证据、边界与使用授权并消费服务端校验', async () => {
    const original = candidate('a', { sourceRefs: [{ kind: 'conversation', id: 'source-session' }], evidenceRefs: [{ kind: 'conversation', id: 'conversation-a' }], applicableWhen: ['报告'], forbiddenWhen: ['法律'], scopePolicy: { agentIds: ['commander'] } });
    const invoke = vi.fn(async () => ({ ok: true, candidate: { ...original, judgment: '编辑后的正文', capabilities: { ...original.capabilities, canPromote: false, ineligibleReasons: ['evidence_missing'] } } }));
    const loaded = loadCognitionAssets({ candidates: [original] }, { name: 'activity' }, { cogseed: { invoke } });
    loaded.render();
    const card = { dataset: { candId: 'a', candType: 'template' }, querySelector: (selector: string) => selector === '[data-f="judgment"]' ? { value: '编辑后的正文' } : null };
    const footerButton = button('activity-save-draft', 'a');
    footerButton.closest = (selector?: string) => selector === '.ca-candidate-detail' ? null : { querySelector: () => card };
    await loaded.ns.activityController.handleClick(footerButton);
    expect(invoke).toHaveBeenCalledWith('recall.candidates.update', expect.objectContaining({ candidateId: 'a', judgment: '编辑后的正文', sourceRefs: original.sourceRefs, evidenceRefs: original.evidenceRefs, applicableWhen: ['报告'], forbiddenWhen: ['法律'], scopePolicy: { agentIds: ['commander'] } }));
    expect(loaded.store.candidates[0].capabilities.canPromote).toBe(false);
  });
  it('稍后处理调用后端并保留需要关注，处理后选下一项而不跳资产页', async () => {
    const original = candidate('a');
    const invoke = vi.fn(async () => ({ ok: true, candidate: { ...original, activityDeferredAt: '2026-10-11T02:30:00Z' } }));
    const loaded = loadCognitionAssets({ candidates: [original, candidate('b')] }, { name: 'activity' }, { cogseed: { invoke } });
    loaded.render();
    loaded.ns.router.go = vi.fn();
    await loaded.ns.activityController.handleClick(button('activity-defer', 'a'));
    expect(invoke).toHaveBeenCalledWith('recall.candidates.defer', { candidateId: 'a' });
    expect(loaded.ns.activityModel().attention).toHaveLength(2);
    expect(loaded.ns.activityModel().attention.find((row: any) => row.key === 'candidate:a').result).toContain('稍后');
    expect(loaded.ns.router.go).toHaveBeenCalledWith(expect.objectContaining({ name: 'activity', candidateId: 'b' }), { replace: true });
  });
  it('首次窄屏不自动打开详情，宽屏选中后缩窄也不意外弹出抽屉', async () => {
    let narrow = false;
    const loaded = loadCognitionAssets({ candidates: [candidate('a')] }, { name: 'activity' }, { matchMedia: () => ({ matches: narrow }) });
    loaded.render(); narrow = true;
    expect(loaded.render()).not.toContain('is-drawer-open');
    const loadedNarrow = loadCognitionAssets({ candidates: [candidate('a')] }, { name: 'activity' }, { matchMedia: () => ({ matches: true }) });
    expect(loadedNarrow.render()).not.toContain('is-drawer-open');
    expect(loadedNarrow.render()).toContain('选择一项查看详情');
  });
  it('窄屏抽屉隔离列表，Tab 循环并在 Esc 关闭后恢复原行焦点', async () => {
    const loaded = loadCognitionAssets({ candidates: [candidate('a')] }, { name: 'activity', candidateId: 'a' }, { matchMedia: () => ({ matches: true }) });
    const html = loaded.render();
    expect(html).toContain('role="dialog" aria-modal="true"');
    expect(html).toContain('ca-activity-list" inert');
    const first = { focus: vi.fn(), getAttribute: () => null };
    const last = { focus: vi.fn(), getAttribute: () => null };
    const row = { dataset: { id: 'candidate:a' }, focus: vi.fn() };
    loaded.context.document.querySelectorAll = (selector: string) => selector === '[data-act="activity-select"]' ? [row] : [first, last];
    loaded.ns.router.go = vi.fn();
    const tab = { key: 'Tab', target: last, preventDefault: vi.fn() };
    await loaded.ns.activityController.handleKeydown(tab);
    expect(tab.preventDefault).toHaveBeenCalled();
    expect(first.focus).toHaveBeenCalled();
    const escape = { key: 'Escape', preventDefault: vi.fn() };
    await loaded.ns.activityController.handleKeydown(escape);
    expect(escape.preventDefault).toHaveBeenCalled();
    expect(row.focus).toHaveBeenCalled();
    expect(loaded.ns.router.go).toHaveBeenCalledWith(expect.objectContaining({ candidateId: '' }), { replace: true });
  });
  it('只改类型也会触发脏草稿确认，拒绝丢弃时不执行拒绝操作', async () => {
    const loaded = loadCognitionAssets({ candidates: [candidate('a')] }, { name: 'activity' });
    loaded.render();
    const card = { dataset: { candId: 'a', candType: 'template' } };
    await loaded.ns.activityController.handleClick(button('cand-type', 'rule', card));
    loaded.ns.confirmUser = vi.fn(async () => false);
    expect(await loaded.ns.activityController.handleClick(button('cand-decide', 'a'))).toBe(true);
    expect(loaded.ns.confirmUser).toHaveBeenCalledOnce();
  });
  it('原生类型选择写入候选草稿，后台更新保留新类型且离开时提示未保存', async () => {
    const loaded = loadCognitionAssets({ candidates: [candidate('a')] }, { name: 'activity' });
    loaded.render();
    const card = { dataset: { candId: 'a', candType: 'template' } };
    expect(loaded.ns.activityController.handleInput({ target: { dataset: { f: 'type' }, value: 'rule', closest: () => card } })).toBe(true);
    expect(card.dataset.candType).toBe('rule');
    const html = loaded.render();
    expect(html).toContain('value="rule" selected');
    loaded.ns.confirmUser = vi.fn(async () => false);
    expect(await loaded.ns.activityController.handleClick(button('activity-next'))).toBe(true);
    expect(loaded.ns.confirmUser).toHaveBeenCalledOnce();
  });

  it('同一条目刷新保持阅读位置、展开状态和输入光标，切换条目重置详情但保留列表位置', () => {
    const loaded = loadCognitionAssets({ candidates: [candidate('a'), candidate('b')] }, { name: 'activity' });
    function detail(key: string) {
      const field = { dataset: { f: 'judgment' }, scrollTop: 0, scrollLeft: 0, selectionStart: 0, selectionEnd: 0, selectionDirection: 'none', focus: vi.fn(), setSelectionRange: vi.fn() };
      const disclosure = { open: false };
      const body = { dataset: { activityKey: key }, scrollTop: 0, querySelectorAll: (selector: string) => selector === '[data-f]' ? [field] : [disclosure] };
      const list = { scrollTop: 0, scrollLeft: 0 };
      return { field, disclosure, body, list, querySelector: (selector: string) => selector === '.ca-activity-detail-body' ? body : list };
    }
    const old = detail('candidate:a');
    old.body.scrollTop = 120; old.field.scrollTop = 44; old.field.scrollLeft = 9;
    old.field.selectionStart = 3; old.field.selectionEnd = 8; old.disclosure.open = true;
    old.list.scrollTop = 210; old.list.scrollLeft = 6;
    loaded.context.document.activeElement = old.field;
    const state = loaded.ns.activityController.captureRenderState(old);
    const same = detail('candidate:a');
    loaded.ns.activityController.restoreRenderState(same, state);
    expect(same.body.scrollTop).toBe(120);
    expect(same.field.scrollTop).toBe(44);
    expect(same.field.scrollLeft).toBe(9);
    expect(same.field.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(same.field.setSelectionRange).toHaveBeenCalledWith(3, 8, 'none');
    expect(same.disclosure.open).toBe(true);
    const next = detail('candidate:b');
    next.body.scrollTop = 90; next.field.scrollTop = 30;
    loaded.ns.activityController.restoreRenderState(next, state);
    expect(next.body.scrollTop).toBe(0);
    expect(next.field.scrollTop).toBe(0);
    expect(next.field.focus).not.toHaveBeenCalled();
    expect(next.disclosure.open).toBe(false);
    expect(next.list).toEqual({ scrollTop: 210, scrollLeft: 6 });
  });

  it('宽屏直接缩窄后第一次选择即可打开抽屉，不要求先重画页面', async () => {
    let narrow = false;
    const loaded = loadCognitionAssets({ candidates: [candidate('a')] }, { name: 'activity' }, { matchMedia: () => ({ matches: narrow }) });
    loaded.render(); narrow = true;
    await loaded.ns.activityController.handleClick(button('activity-select', 'candidate:a'));
    expect(loaded.render()).toContain('is-drawer-open');
  });

  it('处理 A 的请求期间切到 B 并编辑，A 完成时不跳离 B 或丢失 B 的草稿', async () => {
    const loaded = loadCognitionAssets({ candidates: [candidate('a'), candidate('b')] }, { name: 'activity' });
    loaded.render();
    const operation = loaded.ns.activityController.beginDecision();
    await loaded.ns.activityController.handleClick(button('activity-select', 'candidate:b'));
    const card = { dataset: { candId: 'b', candType: 'template' } };
    loaded.ns.activityController.handleInput({ target: { dataset: { f: 'judgment' }, value: 'B 的新草稿', closest: () => card } });
    loaded.ns.router.go = vi.fn();
    loaded.store.candidates[0] = candidate('a', { status: 'confirmed', capabilities: { isTerminal: true } });
    expect(loaded.ns.activityController.afterDecision('a', false, operation)).toBe(false);
    expect(loaded.ns.router.go).not.toHaveBeenCalled();
    expect(loaded.render()).toContain('B 的新草稿');
  });
  it('处理期间离开系统活动，完成回执只更新数据且不强行导航', () => {
    const loaded = loadCognitionAssets({ candidates: [candidate('a'), candidate('b')] }, { name: 'activity' });
    loaded.render();
    const operation = loaded.ns.activityController.beginDecision();
    loaded.store.route = { name: 'settings' };
    loaded.ns.router.go = vi.fn();
    expect(loaded.ns.activityController.afterDecision('a', false, operation)).toBe(false);
    expect(loaded.ns.router.go).not.toHaveBeenCalled();
  });

  it('实际整页 render 在刷新时保留详情阅读状态，处理后下一条从顶部打开', () => {
    const loaded = loadCognitionAssets({ candidates: [candidate('a'), candidate('b')] }, { name: 'activity' });
    function makeBody(key: string) {
      const field = { dataset: { f: 'judgment' }, scrollTop: 0, scrollLeft: 0, selectionStart: 0, selectionEnd: 0, focus: vi.fn(), setSelectionRange: vi.fn() };
      const disclosure = { open: false };
      return { dataset: { activityKey: key }, scrollTop: 0, field, disclosure, querySelectorAll: (selector: string) => selector === '[data-f]' ? [field] : [disclosure] };
    }
    let current: ReturnType<typeof makeBody> | null = null;
    let list = { scrollTop: 0, scrollLeft: 0 };
    const main = {
      scrollTop: 0, classList: { toggle() {} },
      querySelector(selector: string) { return selector === '.ca-activity-detail-body' ? current : selector === '.ca-activity-table-wrap' ? list : null; },
      set innerHTML(html: string) {
        current = makeBody(html.match(/data-activity-key="([^"]+)"/)?.[1] || '');
        list = { scrollTop: 0, scrollLeft: 0 };
      },
    };
    const root = { innerHTML: '' }, plain = { innerHTML: '' };
    loaded.context.document.getElementById = (id: string) => id === 'ca-root' ? root : id === 'ca-scroll' ? main : plain;
    loaded.ns.render();
    const old = current!;
    old.scrollTop = 160; old.field.scrollTop = 70; old.disclosure.open = true;
    old.field.selectionStart = 4; old.field.selectionEnd = 9;
    list.scrollTop = 120;
    main.scrollTop = 80;
    loaded.context.document.activeElement = old.field;
    loaded.ns.render();
    expect(current).not.toBe(old);
    expect(current!.scrollTop).toBe(160);
    expect(current!.field.scrollTop).toBe(70);
    expect(current!.disclosure.open).toBe(true);
    expect(current!.field.setSelectionRange).toHaveBeenCalledWith(4, 9, undefined);
    expect(list.scrollTop).toBe(120);
    expect(main.scrollTop).toBe(80);
    const operation = loaded.ns.activityController.beginDecision();
    loaded.store.candidates[0] = candidate('a', { status: 'confirmed', capabilities: { isTerminal: true } });
    loaded.ns.activityController.afterDecision('a', false, operation);
    loaded.ns.render();
    expect(current!.dataset.activityKey).toBe('candidate:b');
    expect(current!.scrollTop).toBe(0);
    expect(current!.field.scrollTop).toBe(0);
    expect(current!.disclosure.open).toBe(false);
    expect(list.scrollTop).toBe(120);
    expect(main.scrollTop).toBe(0);
  });

});

describe('活动详情的真实处理记录', () => {
  it('仅按候选 ID 读取处理记录，不依赖示例历史，并在失败后允许重试', async () => {
    const original = candidate('a');
    let fail = true;
    const invoke = vi.fn(async () => fail ? { ok: false, error: 'disk unavailable' } : { ok: true, items: [{ decision_id: 'd1', decision_type: 'modify', actor: 'user', timestamp: '2026-10-11T02:00:00Z', reason: '人工核对', outcome: 'asset_failed' }] });
    const loaded = loadCognitionAssets({ candidates: [original] }, { name: 'activity' }, { cogseed: { invoke } });
    await loaded.ns.activityController.handleClick(button('activity-history', 'a'));
    expect(loaded.render()).toContain('本条处理记录暂时无法读取');
    expect(invoke).toHaveBeenCalledWith('recall.candidates.history', { candidateId: 'a' });
    await loaded.ns.activityController.handleClick(button('activity-history', 'a'));
    fail = false;
    await loaded.ns.activityController.handleClick(button('activity-history', 'a'));
    expect(loaded.render()).toContain('人工核对');
    expect(loaded.render()).toContain('正式保存未成功');
  });
  it('候选保存后使用服务端能力显示校验结果，继续编辑则清除过期提示', async () => {
    const original = candidate('a');
    const invoke = vi.fn(async () => ({ ok: true, candidate: { ...original, capabilities: { ...original.capabilities, canPromote: false, ineligibleReasons: ['evidence_missing'] } } }));
    const loaded = loadCognitionAssets({ candidates: [original] }, { name: 'activity' }, { cogseed: { invoke } });
    const card = { dataset: { candId: 'a', candType: 'template' }, querySelector: () => null };
    await loaded.ns.activityController.handleClick(button('activity-save-draft', 'a', card));
    expect(loaded.render()).toContain('草稿已保存，仍有阻断项需要处理');
    loaded.ns.activityController.handleInput({ target: { dataset: { f: 'judgment' }, value: '继续修改', closest: () => card } });
    expect(loaded.render()).not.toContain('草稿已保存，仍有阻断项需要处理');
  });
});
