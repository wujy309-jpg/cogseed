import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import vm from 'node:vm';

// 回归测试：个人本体渲染层 IPC 失败分支（op_failed 提示，不得伪装成空态/静默）。
// _pocInvoke（personal-ontology.js:225-232）永不抛异常，失败统一返回 {ok:false,error}，
// 因此每个 IPC 调用点必须自带失败分支——这里逐点钉死。

const root = resolve(__dirname, '../..');
const ontology = readFileSync(resolve(root, 'src/renderer/modules/personal-ontology.js'), 'utf8');

// ── fixtures ─────────────────────────────────────────────────────────────

const SNAPSHOT = {
  groups: [
    {
      id: 'g1',
      title: '工作偏好',
      kind: 'user',
      createdAt: '2026-09-01T10:00:00',
      updatedAt: '2026-09-02T10:00:00',
      fields: [{ id: 'f1', name: '常用工具', origin: 'user', valueIds: ['v1'] }],
      values: [
        { id: 'v1', fieldId: 'f1', text: 'ZCode', source: '手动', createdAt: '', updatedAt: '' },
      ],
      entries: [],
    },
  ],
  counts: { groups: 1, facts: 1, rules: 0, entries: 0 },
  deleted: [],
};

function makeInvoke(overrides: Record<string, any> = {}) {
  return vi.fn(async (channel: string, payload: any) => {
    if (channel in overrides) {
      const override = overrides[channel];
      return typeof override === 'function' ? override(channel, payload) : override;
    }
    switch (channel) {
      case 'po.snapshot':
        return SNAPSHOT;
      case 'personalOntology.templates.list':
        return { ok: true, templates: [] };
      case 'recall.assets.list':
        return { ok: true, assets: [] };
      case 'personalOntology.candidates.list':
        return { ok: true, candidate_updates: [{ candidate_id: 'c1', kind: 'rule', summary: '候选A', memory_text: '周五先跑全量测试再合入。' }], blocked_items: [] };
      case 'personalOntology.conflicts.list':
        return { ok: true, conflicts: [] };
      case 'ontology.graph.read':
        return { ok: true, graph: { categories: [], entities: [], relations: [] } };
      default:
        return { ok: true };
    }
  });
}

/** 可点击假元素：属性驱动（data-poc-*），监听器可捕获后手动触发。 */
function clickTarget(attrs: Record<string, string>) {
  const listeners = new Map<string, (...args: any[]) => any>();
  return {
    attrs,
    listeners,
    disabled: false,
    getAttribute(name: string) { return attrs[name] != null ? String(attrs[name]) : null; },
    addEventListener(event: string, handler: (...args: any[]) => any) { listeners.set(event, handler); },
    setAttribute() {},
    removeAttribute() {},
    closest() { return null; },
  };
}

/** 假下拉：捕获 change 监听器，value/innerHTML 可读写。 */
function selectElement(id: string, value: string) {
  const listeners = new Map<string, (...args: any[]) => any>();
  return {
    id,
    value,
    innerHTML: '',
    listeners,
    addEventListener(event: string, handler: (...args: any[]) => any) { listeners.set(event, handler); },
    getAttribute() { return null; },
  };
}

function makeElement(id: string, options: { qs?: Map<string, any[]>; one?: Map<string, any>; value?: string } = {}) {
  const qs = options.qs || new Map<string, any[]>();
  const one = options.one || new Map<string, any>();
  return {
    id,
    innerHTML: '',
    style: {},
    scrollTop: 0,
    value: options.value || '',
    querySelector: (selector: string) => (one.has(selector) ? one.get(selector) : null),
    querySelectorAll: (selector: string) => (qs.get(selector) || []).slice(),
    addEventListener() {},
    classList: {
      _set: new Set<string>(),
      add(cls: string) { this._set.add(cls); },
      remove(cls: string) { this._set.delete(cls); },
      contains(cls: string) { return this._set.has(cls); },
    },
  };
}

function loadPersonalOntology(
  invoke: any,
  options: { navTargets?: any[]; bodyTargets?: Map<string, any[]>; bodyOne?: Map<string, any>; documentElements?: any[]; uiConfirmResult?: boolean; messages?: Record<string, string>; uiModalImpl?: any } = {},
) {
  const navTargets = options.navTargets || [];
  const bodyTargets = options.bodyTargets || new Map<string, any[]>();
  const elements = new Map([
    ['personal-onto-nav', makeElement('personal-onto-nav', { qs: new Map([['[data-poc-nav]', navTargets]]) })],
    ['personal-onto-main-header', makeElement('personal-onto-main-header')],
    ['personal-onto-main-body', makeElement('personal-onto-main-body', { qs: bodyTargets, one: options.bodyOne || new Map<string, any>() })],
    ['personal-onto-modal', makeElement('personal-onto-modal')],
    ['personal-onto-modal-body', makeElement('personal-onto-modal-body')],
  ]);
  for (const el of options.documentElements || []) elements.set(el.id, el);
  const uiToast = vi.fn();
  const uiModal = options.uiModalImpl || vi.fn(async () => ({ value: 'save' }));
  const uiConfirm = vi.fn(async () => (options.uiConfirmResult == null ? true : options.uiConfirmResult));
  const sandbox: any = {
    console: { log() {}, warn() {}, error() {} },
    CSS: { escape: (value: string) => String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&') },
    document: {
      getElementById: (id: string) => elements.get(id) || null,
      querySelector: () => null,
      addEventListener: () => {},
    },
    t: (key: string, vars?: Record<string, unknown>) => {
      const raw = (options.messages && options.messages[key])
        || (key.startsWith('personalOntology.') ? key.slice('personalOntology.'.length) : key);
      if (!vars) return raw;
      return raw.replace(/\{(\w+)\}/g, (_m, n: string) => String(vars[n] ?? `{${n}}`));
    },
    uiToast,
    uiModal,
    uiConfirm,
    uiInput: (o: any) => `<input id="${String(o && o.id || '')}" value="${String(o && o.value || '')}">`,
    uiTextarea: (o: any) => `<textarea id="${String(o && o.id || '')}">${String(o && o.value || '')}</textarea>`,
    cogseed: { invoke },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const file of ['modules/icons.js', 'modules/ui-button.js', 'modules/ui-card.js', 'modules/ui-form.js', 'modules/ui-empty.js', 'modules/ui-status.js']) {
    vm.runInContext(readFileSync(resolve(root, 'src/renderer', file), 'utf8'), sandbox, { filename: file });
  }
  vm.runInContext(ontology, sandbox, { filename: 'personal-ontology.js' });
  return { sandbox, uiToast, uiModal, uiConfirm, elements };
}

async function settle() {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 10));
}

async function boot(invoke: any, options: Parameters<typeof loadPersonalOntology>[1] = {}) {
  const loaded = loadPersonalOntology(invoke, options);
  await loaded.sandbox.renderPersonalOntology();
  await settle();
  return loaded;
}

async function click(target: any) {
  const handler = target.listeners.get('click');
  expect(handler).toBeTypeOf('function');
  await handler({ stopPropagation() {} });
  await settle();
}

function hasToast(uiToast: any, message: string, variant: string) {
  return uiToast.mock.calls.some(([msg, opts]: any[]) => msg === message && opts && opts.variant === variant);
}

// ── F-r1-5：po.history.list 失败不得伪装成「还没有历史版本」空态 ──────────

describe('personal ontology v2 renderer › IPC 失败分支', () => {
  it('F-r1-5 历史版本：po.history.list 失败时提示 op_failed，不再误报空态', async () => {
    const invoke = makeInvoke({ 'po.history.list': { ok: false, error: 'db_locked' } });
    const historyBtn = clickTarget({ 'data-poc-group-op': 'history', 'data-poc-gid': 'g1' });
    const loaded = await boot(invoke, { bodyTargets: new Map([['[data-poc-group-op]', [historyBtn]]]) });
    await click(historyBtn);
    expect(invoke.mock.calls.some(([c]: any[]) => c === 'po.history.list')).toBe(true);
    expect(hasToast(loaded.uiToast, 'op_failed', 'error')).toBe(true);
    expect(hasToast(loaded.uiToast, 'po2_history_empty', 'info')).toBe(false);
    expect(loaded.uiModal).not.toHaveBeenCalled();
  });

  it('F-r1-5 历史版本：成功且无历史仍走原空态提示；有历史正常弹窗', async () => {
    const emptyInvoke = makeInvoke({ 'po.history.list': { ok: true, history: [] } });
    const emptyBtn = clickTarget({ 'data-poc-group-op': 'history', 'data-poc-gid': 'g1' });
    const emptyLoaded = await boot(emptyInvoke, { bodyTargets: new Map([['[data-poc-group-op]', [emptyBtn]]]) });
    await click(emptyBtn);
    expect(hasToast(emptyLoaded.uiToast, 'po2_history_empty', 'info')).toBe(true);
    expect(hasToast(emptyLoaded.uiToast, 'op_failed', 'error')).toBe(false);

    const listInvoke = makeInvoke({
      'po.history.list': { ok: true, history: [{ id: 'h1', savedAt: '2026-09-01T00:00:00', bytes: 128, preview: '早期版本' }] },
    });
    const listBtn = clickTarget({ 'data-poc-group-op': 'history', 'data-poc-gid': 'g1' });
    const listLoaded = await boot(listInvoke, { bodyTargets: new Map([['[data-poc-group-op]', [listBtn]]]) });
    await click(listBtn);
    expect(listLoaded.uiModal).toHaveBeenCalledTimes(1);
    expect(String(listLoaded.uiModal.mock.calls[0][0].bodyHtml)).toContain('po2-history-list');
    expect(hasToast(listLoaded.uiToast, 'op_failed', 'error')).toBe(false);
  });

  it('F-r1-17 历史弹窗「恢复到这版」：overlay 内按钮可点，恢复成功后关闭弹窗', async () => {
    const invoke = makeInvoke({
      'po.history.list': { ok: true, history: [{ id: 'h1', savedAt: '2026-09-01T00:00:00', bytes: 128, preview: '早期版本' }] },
      'po.history.restore': { ok: true }, // 显式声明，不依赖 default 分支
    });
    const historyBtn = clickTarget({ 'data-poc-group-op': 'history', 'data-poc-gid': 'g1' });
    const restoreBtn = clickTarget({ 'data-poc-history-restore': 'h1', 'data-poc-gid': 'g1' });
    // 仿真实 uiModal（ui-modal.js:326）：同步返回带 close/dialog 的 thenable，
    // 弹窗 overlay 挂 document.body，不在 #personal-onto-main-body 子树内；
    // close() 结算 promise（真实实现 resolve {value, reason}）。
    let settleModal: (value: any) => void;
    const modalPromise = new Promise<any>((resolve) => { settleModal = resolve; });
    const close = vi.fn(() => settleModal({ value: 'close', reason: 'close' }));
    const modalObj = Object.assign(modalPromise, {
      close,
      overlay: { addEventListener() {} },
      dialog: {
        querySelectorAll: (selector: string) => (selector === '[data-poc-history-restore]' ? [restoreBtn] : []),
        querySelector: () => null,
      },
    });
    const uiModal = vi.fn(() => modalObj);
    const loaded = await boot(invoke, {
      bodyTargets: new Map([['[data-poc-group-op]', [historyBtn]]]),
      uiModalImpl: uiModal,
    });
    // 打开历史弹窗：流程会挂在「等待弹窗关闭」上，先并行推进。
    const historyOpened = click(historyBtn);
    await settle();
    expect(uiModal).toHaveBeenCalledTimes(1);
    const handler = restoreBtn.listeners.get('click');
    expect(handler).toBeTypeOf('function'); // 修前：按钮在 overlay 里，主视图绑定零命中（死按钮）
    await handler({ stopPropagation() {} });
    await historyOpened; // 恢复成功 → close() 结算 → 弹窗流程完成
    await settle();
    expect(invoke.mock.calls.some(([c, p]: any[]) => (
      c === 'po.history.restore' && p && p.groupId === 'g1' && p.snapshotId === 'h1'
    ))).toBe(true);
    expect(hasToast(loaded.uiToast, 'po2_history_restored', 'success')).toBe(true);
    expect(close).toHaveBeenCalledTimes(1); // 成功后关弹窗
  });

  it('旧本体候选转入共同审核后重拉候选池，成功文案不声称已经保存', async () => {
    let listCalls = 0;
    const invoke = makeInvoke({
      'personalOntology.candidates.list': async () => {
        listCalls += 1;
        return { ok: true, candidate_updates: listCalls === 1 ? [{ candidate_id: 'c1', kind: 'rule', summary: '候选A', memory_text: '周五先跑全量测试再合入。' }] : [], blocked_items: [] };
      },
      'personalOntology.candidates.transferToRecall': { ok: true, candidate: { id: 'recall-c1' }, sourceRemoved: true },
    });
    const transferBtn = clickTarget({ 'data-poc-candidate-op': 'transfer', 'data-poc-candidate-id': 'c1' });
    const loaded = await boot(invoke, {
      bodyTargets: new Map([['[data-poc-candidate-op]', [transferBtn]]]),
    });
    const bodyEl = loaded.elements.get('personal-onto-main-body');
    const navEl = loaded.elements.get('personal-onto-nav');
    expect(String(bodyEl.innerHTML)).toContain('周五先跑全量测试再合入'); // 初始横幅在场
    expect(String(navEl.innerHTML)).toContain('backflow_badge'); // 初始角标在场
    await click(transferBtn);
    expect(listCalls).toBe(2); // 确认后必须重拉候选池（修前缓存未失效恒为 1）
    expect(String(bodyEl.innerHTML)).not.toContain('周五先跑全量测试再合入'); // 横幅消失
    expect(String(navEl.innerHTML)).not.toContain('backflow_badge'); // 角标消失
    expect(hasToast(loaded.uiToast, 'po2_candidate_transferred', 'success')).toBe(true);
    expect(hasToast(loaded.uiToast, 'po2_candidate_accepted', 'success')).toBe(false);
  });

  /** F-r3-3 共用：两组各一字段的快照 + 带 overlay 的弹窗 mock（联动绑定挂在 overlay 内 select 上）。 */
  function composeFixture(invokeOverrides: Record<string, any>) {
    const SNAPSHOT2 = {
      groups: [
        { id: 'g1', title: '工作偏好', kind: 'user', createdAt: '', updatedAt: '', fields: [{ id: 'f1', name: '常用工具', origin: 'user', valueIds: [] }], values: [], entries: [] },
        { id: 'g2', title: '项目', kind: 'user', createdAt: '', updatedAt: '', fields: [{ id: 'f2', name: '项目角色', origin: 'user', valueIds: [] }], values: [], entries: [] },
      ],
      counts: { groups: 2, facts: 0, rules: 0, entries: 0 },
      deleted: [],
    };
    const base = makeInvoke(invokeOverrides);
    const invoke = vi.fn(async (channel: string, payload: any) => (
      channel === 'po.snapshot' ? SNAPSHOT2 : base(channel, payload)
    ));
    const composeBtn = clickTarget({ 'data-poc-op': 'compose-value' });
    const groupSel = selectElement('po2-compose-group', 'g1');
    const fieldSel = selectElement('po2-compose-field', '');
    const textEl = makeElement('po2-compose-text', { value: '一条内容' });
    const asofEl = makeElement('po2-compose-asof', { value: '' });
    let settleModal: (value: any) => void;
    const modalObj = Object.assign(new Promise<any>((resolve) => { settleModal = resolve; }), {
      close: vi.fn(),
      overlay: {
        addEventListener() {},
        querySelector: (selector: string) => (selector === '#po2-compose-group' ? groupSel : selector === '#po2-compose-field' ? fieldSel : null),
      },
      dialog: { querySelectorAll: () => [], querySelector: () => null },
    });
    const uiModal = vi.fn(() => modalObj);
    async function open() {
      const loaded = loadPersonalOntology(invoke, {
        bodyTargets: new Map([['[data-poc-op]', [composeBtn]]]),
        documentElements: [groupSel, fieldSel, textEl, asofEl],
        uiModalImpl: uiModal,
      });
      await loaded.sandbox.renderPersonalOntology();
      await settle();
      const opened = click(composeBtn); // 挂在「等待弹窗结算」上，settleModal 后可 await
      await settle();
      return { loaded, opened };
    }
    return { invoke, groupSel, fieldSel, settleModal: (value: any) => settleModal(value), open };
  }

  it('F-r3-3 记一条弹窗：分组切换联动重建字段下拉；跨组字段组合被拦下不外发', async () => {
    const fx = composeFixture({ 'po.values.add': { ok: true } });
    const { loaded, opened } = await fx.open();
    // ① 联动绑定在场（修前：静态 select 无联动，change 零监听）
    const changeHandler = fx.groupSel.listeners.get('change');
    expect(changeHandler).toBeTypeOf('function');
    // ② 切到 g2 后字段下拉重建：只剩 g2 的字段、值重置为空
    fx.groupSel.value = 'g2';
    await changeHandler();
    expect(fx.fieldSel.innerHTML).toContain('项目角色');
    expect(fx.fieldSel.innerHTML).not.toContain('常用工具');
    expect(fx.fieldSel.value).toBe('');
    // ③ 跨组组合（组=g2、字段=f1）提交被拦：提示重选、不外发 po.values.add
    fx.fieldSel.value = 'f1';
    fx.settleModal({ value: 'save', reason: 'action' });
    await opened;
    await settle();
    expect(hasToast(loaded.uiToast, 'po2_pick_field_first', 'error')).toBe(true);
    expect(fx.invoke.mock.calls.some(([c]: any[]) => c === 'po.values.add')).toBe(false);
  });

  it('F-r3-3 记一条弹窗：联动后选新组字段提交正常（守护既有提交链路）', async () => {
    const fx = composeFixture({ 'po.values.add': { ok: true } });
    const { opened } = await fx.open();
    const changeHandler = fx.groupSel.listeners.get('change');
    expect(changeHandler).toBeTypeOf('function');
    fx.groupSel.value = 'g2';
    await changeHandler();
    fx.fieldSel.value = 'f2'; // 用户在新组字段里选了一条
    fx.settleModal({ value: 'save', reason: 'action' });
    await opened;
    await settle();
    expect(fx.invoke.mock.calls.some(([c, p]: any[]) => (
      c === 'po.values.add' && p && p.groupId === 'g2' && p.fieldId === 'f2' && p.text === '一条内容'
    ))).toBe(true);
  });

  it('F-r2-11 同组编辑器重开窗口：旧刷新响应不得写入新编辑器（对象身份守卫）', async () => {
    const TMPL = { installed: true, group_id: 'g1', template_id: 't1', name: '工作偏好', sections: [{ title: '默认', fields: [] }] };
    // 受控 groups.read：每次调用入队挂起，由测试按「新响应先回、旧响应后到」的顺序手动 resolve。
    const reads: Array<(value: any) => void> = [];
    const base = makeInvoke({ 'personalOntology.templates.list': { ok: true, templates: [TMPL] } });
    const invoke = vi.fn(async (channel: string, payload: any) => {
      if (channel === 'personalOntology.groups.read') {
        return await new Promise((resolve) => { reads.push(resolve); });
      }
      return base(channel, payload);
    });
    const navBtn = clickTarget({ 'data-poc-nav': 'template', 'data-poc-id': 'g1' });
    const viewRawBtn = clickTarget({ 'data-poc-group-action': 'view-raw' });
    const saveBtn = clickTarget({ 'data-poc-group-action': 'save-content' });
    const contentTa = { value: '手动编辑的新内容' };
    const loaded = await boot(invoke, {
      navTargets: [navBtn],
      bodyTargets: new Map([['[data-poc-group-action]', [viewRawBtn, saveBtn]]]),
      bodyOne: new Map([['[data-poc-group-content]', contentTa]]),
    });
    const bodyEl = loaded.elements.get('personal-onto-main-body');
    // ① 打开编辑器 A（read#1 返回初始内容）
    click(navBtn);
    await settle();
    expect(reads.length).toBe(1);
    reads[0]({ ok: true, content: '## 默认\n### 流水\n\n§\n初始内容' });
    await settle();
    // ② 切 raw 视图（save-content 仅 raw 视图可用），保存触发 _pocRefreshGroupData：read#2 挂起
    await click(viewRawBtn);
    const saved = click(saveBtn);
    await settle();
    expect(reads.length).toBe(2);
    // ③ 旧刷新挂起期间同组重开：_pocOpenGroup 创建新编辑器 B（read#3）
    click(navBtn);
    await settle();
    expect(reads.length).toBe(3);
    // ④ 新编辑器响应先回，旧刷新响应后到
    reads[2]({ ok: true, content: '## 默认\n### 流水\n\n§\n新编辑器内容' });
    await settle();
    reads[1]({ ok: true, content: '## 默认\n### 流水\n\n§\n旧响应写入' });
    await saved;
    await settle();
    const html = String(bodyEl.innerHTML);
    expect(html).toContain('新编辑器内容'); // 新编辑器保持自己的内容
    expect(html).not.toContain('旧响应写入'); // 旧刷新响应被身份守卫丢弃（修前按 groupId 弱匹配写入）
  });

  it('F-r2-10 历史恢复失败（IPC {ok:false}）：提示 op_failed、不提示成功、不关弹窗、不 reload', async () => {
    const invoke = makeInvoke({
      'po.history.list': { ok: true, history: [{ id: 'h1', savedAt: '2026-09-01T00:00:00', bytes: 128, preview: '早期版本' }] },
      'po.history.restore': { ok: false, error: 'snapshot not found' },
    });
    const historyBtn = clickTarget({ 'data-poc-group-op': 'history', 'data-poc-gid': 'g1' });
    const restoreBtn = clickTarget({ 'data-poc-history-restore': 'h1', 'data-poc-gid': 'g1' });
    let settleModal: (value: any) => void;
    const modalPromise = new Promise<any>((resolve) => { settleModal = resolve; });
    const close = vi.fn(() => settleModal({ value: 'close', reason: 'close' }));
    const modalObj = Object.assign(modalPromise, {
      close,
      overlay: { addEventListener() {} },
      dialog: {
        querySelectorAll: (selector: string) => (selector === '[data-poc-history-restore]' ? [restoreBtn] : []),
        querySelector: () => null,
      },
    });
    const uiModal = vi.fn(() => modalObj);
    const loaded = await boot(invoke, {
      bodyTargets: new Map([['[data-poc-group-op]', [historyBtn]]]),
      uiModalImpl: uiModal,
    });
    const historyOpened = click(historyBtn);
    await settle();
    const handler = restoreBtn.listeners.get('click');
    expect(handler).toBeTypeOf('function');
    await handler({ stopPropagation() {} });
    await settle();
    // _pocRunOnce 必须透传 IPC 响应：失败时不得假成功（成功 toast + 关弹窗）。
    expect(hasToast(loaded.uiToast, 'op_failed', 'error')).toBe(true);
    expect(hasToast(loaded.uiToast, 'po2_history_restored', 'success')).toBe(false);
    expect(close).not.toHaveBeenCalled();
    // 失败不得触发无意义 reload（_pocReloadPo → renderPersonalOntology → po.snapshot 重拉）。
    const snapshotCalls = invoke.mock.calls.filter(([c]: any[]) => c === 'po.snapshot').length;
    expect(snapshotCalls).toBe(1); // 仅 boot 时那一次
  });

  it('F-r1-17 旧绑定段已删：主视图容器不再给 [data-poc-history-restore] 绑定（绑定只属于弹窗 overlay）', async () => {
    const strayBtn = clickTarget({ 'data-poc-history-restore': 'h1', 'data-poc-gid': 'g1' });
    await boot(makeInvoke(), { bodyTargets: new Map([['[data-poc-history-restore]', [strayBtn]]]) });
    expect(strayBtn.listeners.get('click')).toBeUndefined();
  });

  it('F-r1-6 导出：po.data.export 失败时提示 op_failed，不再弹空文档', async () => {
    const invoke = makeInvoke({ 'po.data.export': { ok: false, error: 'fs_denied' } });
    const exportBtn = clickTarget({ 'data-poc-nav': 'memory-export' });
    const loaded = await boot(invoke, { navTargets: [exportBtn] });
    await click(exportBtn);
    expect(invoke.mock.calls.some(([c]: any[]) => c === 'po.data.export')).toBe(true);
    expect(hasToast(loaded.uiToast, 'op_failed', 'error')).toBe(true);
    expect(loaded.uiModal).not.toHaveBeenCalled();
  });

  it('F-r1-6 导出：成功仍弹全文文档', async () => {
    const invoke = makeInvoke({ 'po.data.export': { ok: true, markdown: '# 个人本体导出\n\n## 工作偏好\n' } });
    const exportBtn = clickTarget({ 'data-poc-nav': 'memory-export' });
    const loaded = await boot(invoke, { navTargets: [exportBtn] });
    await click(exportBtn);
    expect(loaded.uiModal).toHaveBeenCalledTimes(1);
    expect(String(loaded.uiModal.mock.calls[0][0].bodyHtml)).toContain('个人本体导出');
    expect(hasToast(loaded.uiToast, 'op_failed', 'error')).toBe(false);
  });

  it('F-r1-6 导入预览：失败时提示 op_failed，不再误报「没有解析出可导入的内容」', async () => {
    const invoke = makeInvoke({ 'po.data.importPreview': { ok: false, error: 'parse_failed' } });
    const importBtn = clickTarget({ 'data-poc-nav': 'memory-import' });
    const loaded = await boot(invoke, {
      navTargets: [importBtn],
      documentElements: [makeElement('po2-import-text', { value: '## 工作偏好\n- 周五交周报' })],
    });
    await click(importBtn);
    expect(invoke.mock.calls.some(([c]: any[]) => c === 'po.data.importPreview')).toBe(true);
    expect(hasToast(loaded.uiToast, 'op_failed', 'error')).toBe(true);
    expect(hasToast(loaded.uiToast, 'po2_import_nothing', 'error')).toBe(false);
    expect(loaded.uiModal).toHaveBeenCalledTimes(1); // 只有粘贴弹窗，没有确认弹窗
  });

  it('F-r1-6 导入预览：成功但解析为空仍提示「没有解析出可导入的内容」', async () => {
    const invoke = makeInvoke({ 'po.data.importPreview': { ok: true, items: [] } });
    const importBtn = clickTarget({ 'data-poc-nav': 'memory-import' });
    const loaded = await boot(invoke, {
      navTargets: [importBtn],
      documentElements: [makeElement('po2-import-text', { value: '空空如也' })],
    });
    await click(importBtn);
    expect(hasToast(loaded.uiToast, 'po2_import_nothing', 'error')).toBe(true);
    expect(hasToast(loaded.uiToast, 'op_failed', 'error')).toBe(false);
  });

  it('F-r1-6 导入：预览有内容走确认弹窗，应用成功提示已导入', async () => {
    const invoke = makeInvoke({
      'po.data.importPreview': {
        ok: true,
        items: [{ title: '工作偏好', mergeIntoExisting: false, fields: [{ name: '常用工具', values: [{ value: 'ZCode' }] }], entries: ['周五交周报'] }],
      },
      'po.data.importApply': { ok: true, applied: 2 },
    });
    const importBtn = clickTarget({ 'data-poc-nav': 'memory-import' });
    const loaded = await boot(invoke, {
      navTargets: [importBtn],
      documentElements: [makeElement('po2-import-text', { value: '## 工作偏好\n- 周五交周报' })],
    });
    await click(importBtn);
    expect(loaded.uiModal).toHaveBeenCalledTimes(2); // 粘贴弹窗 + 确认弹窗
    expect(String(loaded.uiModal.mock.calls[1][0].bodyHtml)).toContain('po2-import-list');
    expect(hasToast(loaded.uiToast, 'po2_import_done', 'success')).toBe(true);
    expect(hasToast(loaded.uiToast, 'op_failed', 'error')).toBe(false);
  });

  it('F-r1-19 死代码簇删除不改变行为：归不进固定类别的 profile 条目仍渲染「其他沉淀」分节', async () => {
    const invoke = makeInvoke({
      'recall.assets.list': { ok: true, assets: [
        { id: 'a1', type: 'personal', status: 'active', statement: '张三丰教我打太极', updatedAt: '2026-09-01T00:00:00' },
      ] },
    });
    const loaded = await boot(invoke, {});
    const html = String(loaded.elements.get('personal-onto-main-body').innerHTML);
    // other 分节由 _pocProfileSections 的 other section 承载（personal-ontology.js:196-203），
    // 不依赖 _pocRenderProfileSection 里已删除的 rest 兜底分支。
    expect(html).toContain('po2-profile-group');
    expect(html).toContain('张三丰教我打太极');
    expect(html).toContain('ontology_other');
  });

  it('F-r1-19 死代码簇四项不再回潮：_pocDeletedGroups/_pocExpandedValues/selectProfile/rest 兜底', async () => {
    expect(ontology).not.toContain('_pocDeletedGroups');
    expect(ontology).not.toContain('_pocExpandedValues');
    expect(ontology).not.toContain('selectProfile');
    expect(ontology).not.toContain('!classified.has(');
  });

  it('F-r1-18 导入成功 toast：词条含 {n} 时传 vars 插值，不再显示字面「已导入 {n} 条」', async () => {
    const invoke = makeInvoke({
      'po.data.importPreview': {
        ok: true,
        items: [{ title: '工作偏好', mergeIntoExisting: false, fields: [{ name: '常用工具', values: [{ value: 'ZCode' }] }], entries: [] }],
      },
      'po.data.importApply': { ok: true, applied: 2 },
    });
    const importBtn = clickTarget({ 'data-poc-nav': 'memory-import' });
    const loaded = await boot(invoke, {
      navTargets: [importBtn],
      documentElements: [makeElement('po2-import-text', { value: '## 工作偏好\n- 周五交周报' })],
      messages: { 'personalOntology.po2_import_done': '已导入 {n} 条' }, // 真实词条 zh.json:8655
    });
    await click(importBtn);
    expect(hasToast(loaded.uiToast, '已导入 2 条', 'success')).toBe(true);
    expect(loaded.uiToast.mock.calls.some(([msg]: any[]) => String(msg).includes('{n}'))).toBe(false);
  });

  it('受限旧候选不会显示转入共同审核入口', async () => {
    const invoke = makeInvoke({
      'personalOntology.candidates.list': { ok: true, candidate_updates: [{ candidate_id: 'restricted', kind: 'preference',
        sensitivity: 'restricted', summary: '私密内容', memory_text: '不应进入任务可用资产' }], blocked_items: [] },
    });
    const loaded = await boot(invoke);
    expect(String(loaded.elements.get('personal-onto-main-body').innerHTML)).not.toContain('data-poc-candidate-op="transfer"');
    expect(String(loaded.elements.get('personal-onto-main-body').innerHTML)).toContain('po2_candidate_restricted');
  });
});
