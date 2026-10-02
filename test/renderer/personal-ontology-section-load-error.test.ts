import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import vm from 'node:vm';

// 回归测试：三处按需区块读取失败静默成空态（P-r3-24，预审决策卡组 7
// 「三处共用错误块」）。画像区（recall.assets.list）/ 分组列表（po.snapshot →
// _pocGroups.loadError）/ 候选横幅（personalOntology.candidates.list）失败时
// loadError 此前写入后零渲染消费：「加载失败」与「没有数据」同形，分组页还
// 渲染可操作的新建引导。修法：抽 _pocSectionLoadErrorHtml 共用错误块
// （对齐 _pocRenderGroupEditorHtml 的编辑器既有模式：错误说明 + 重试出口），
// 三处消费；重试按钮 data-poc-op="reload-data" → refreshPersonalOntology。
// 装配与 personal-ontology-error-branches.test.ts 同构。

const root = resolve(__dirname, '../..');
const ontology = readFileSync(resolve(root, 'src/renderer/modules/personal-ontology.js'), 'utf8');

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
  options: { navTargets?: any[]; bodyTargets?: Map<string, any[]>; bodyOne?: Map<string, any>; documentElements?: any[] } = {},
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
  const sandbox: any = {
    console: { log() {}, warn() {}, error() {} },
    CSS: { escape: (value: string) => String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&') },
    document: {
      getElementById: (id: string) => elements.get(id) || null,
      querySelector: () => null,
      addEventListener: () => {},
    },
    t: (key: string, vars?: Record<string, unknown>) => {
      const raw = (key.startsWith('personalOntology.') ? key.slice('personalOntology.'.length) : key);
      if (!vars) return raw;
      return raw.replace(/\{(\w+)\}/g, (_m, n: string) => String(vars[n] ?? `{${n}}`));
    },
    uiToast: vi.fn(),
    uiModal: vi.fn(async () => ({ value: 'save' })),
    uiConfirm: vi.fn(async () => true),
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
  return { sandbox, elements };
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

describe('个人本体 › 按需区块读取失败的共用错误块（P-r3-24）', () => {
  it('画像区：recall.assets.list 失败时显示错误块（含重试出口），不再静默成「没有个人信息」', async () => {
    const reloadBtn = clickTarget({ 'data-poc-op': 'reload-data' });
    const invoke = makeInvoke({ 'recall.assets.list': { ok: false, error: 'db locked' } });
    const loaded = await boot(invoke, { bodyTargets: new Map([['[data-poc-op]', [reloadBtn]]]) });
    const html = String(loaded.elements.get('personal-onto-main-body').innerHTML);
    expect(html).toContain('poc-section-load-error'); // 修前：画像区静默 return ''，与空态同形
    expect(html).toContain('load_error');
    expect(html).toContain('db locked');
    // 重试出口在场且能自愈：reload-data → refreshPersonalOntology 全量重读。
    expect(reloadBtn.listeners.get('click')).toBeTypeOf('function');
    invoke.mockImplementation(async (channel: string) => (channel === 'recall.assets.list'
      ? { ok: true, assets: [{ id: 'a1', type: 'personal', status: 'active', statement: '偏好简洁回复', updatedAt: '2026-09-01T00:00:00' }] }
      : makeInvoke()(channel, {})));
    await click(reloadBtn);
    const healed = String(loaded.elements.get('personal-onto-main-body').innerHTML);
    expect(healed).not.toContain('poc-section-load-error');
    expect(healed).toContain('偏好简洁回复');
  });

  it('分组列表：po.snapshot 失败时错误块替换可操作的新建引导空态', async () => {
    const groupsNav = clickTarget({ 'data-poc-nav': 'groups' });
    const invoke = makeInvoke({ 'po.snapshot': { ok: false, error: 'snapshot unreadable' } });
    const loaded = await boot(invoke, { navTargets: [groupsNav] });
    await click(groupsNav); // 切到「分组与模板」页
    const html = String(loaded.elements.get('personal-onto-main-body').innerHTML);
    expect(html).toContain('poc-section-load-error');
    expect(html).not.toContain('po2_groups_empty'); // 修前：失败渲染「还没有自己的分组。新建一个…」的误导引导
  });

  it('分组列表：快照正常且确实没有分组时，仍走原空态（回归守护）', async () => {
    const groupsNav = clickTarget({ 'data-poc-nav': 'groups' });
    const invoke = makeInvoke({ 'po.snapshot': { groups: [], counts: { groups: 0, facts: 0, rules: 0, entries: 0 }, deleted: [] } });
    const loaded = await boot(invoke, { navTargets: [groupsNav] });
    await click(groupsNav);
    const html = String(loaded.elements.get('personal-onto-main-body').innerHTML);
    expect(html).toContain('po2_groups_empty');
    expect(html).not.toContain('poc-section-load-error');
  });

  it('候选横幅：candidates.list 失败时横幅位置给错误块，不静默消失', async () => {
    const invoke = makeInvoke({ 'personalOntology.candidates.list': { ok: false, error: 'pool locked' } });
    const loaded = await boot(invoke, {});
    const html = String(loaded.elements.get('personal-onto-main-body').innerHTML);
    expect(html).toContain('poc-section-load-error'); // 修前：失败与空池同形，横幅直接消失
    expect(html).toContain('pool locked');
  });

  it('候选横幅：读取成功时无错误块、横幅照常渲染（回归守护）', async () => {
    const loaded = await boot(makeInvoke(), {});
    const html = String(loaded.elements.get('personal-onto-main-body').innerHTML);
    expect(html).not.toContain('poc-section-load-error');
    expect(html).toContain('周五先跑全量测试再合入');
  });
});
