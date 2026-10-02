import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import vm from 'node:vm';

// 回归测试（P-r3-27，预审决策卡 2026-10-01「A-错误态/映射」）：
// _pocGraphErrorText 映射表修前缺 5 类可达错误——自环 2 类（关系表单直接可造：
// 双 self / 同实体两端）+ not found 3 类（并发窗口：本地图数据仍在、主进程侧
// 已被其他窗口删除）——全落 generic「保存失败，请检查填写内容后重试」；复核
// 另顺带补第 6 条 parent category not found。这里逐条走真实变更链路
// （data-poc-graph-op → _pocGraphMutation → _pocToast(_pocGraphErrorText)）
// 钉死映射，并校验四语词条在位（zh/en/ja/pt 同键）。

const root = resolve(__dirname, '../..');
const ontology = readFileSync(resolve(root, 'src/renderer/modules/personal-ontology.js'), 'utf8');

const NEW_KEYS = [
  'ontologyGraph.error_relation_self_self',
  'ontologyGraph.error_relation_same_entity',
  'ontologyGraph.error_relation_not_found',
  'ontologyGraph.error_entity_not_found',
  'ontologyGraph.error_category_not_found',
  'ontologyGraph.error_parent_category_not_found',
];

const GRAPH = {
  categories: [{ id: 'c1', domain: 'affairs', name: '项目', description: '', fields: [] }],
  entities: [{ id: 'e1', domain: 'affairs', categoryId: 'c1', name: '项目A', description: '', status: 'active', properties: {} }],
  relations: [{ id: 'rel1', subject: { kind: 'entity', id: 'e1' }, predicate: '负责', object: { kind: 'entity', id: 'e1' }, note: '' }],
};

function makeInvoke(overrides: Record<string, any> = {}) {
  return vi.fn(async (channel: string, payload: any) => {
    if (channel in overrides) {
      const override = overrides[channel];
      return typeof override === 'function' ? override(channel, payload) : override;
    }
    switch (channel) {
      case 'po.snapshot':
        return { groups: [], counts: { groups: 0, facts: 0, rules: 0, entries: 0 }, deleted: [] };
      case 'personalOntology.templates.list':
        return { ok: true, templates: [] };
      case 'recall.assets.list':
        return { ok: true, assets: [] };
      case 'personalOntology.candidates.list':
        return { ok: true, candidate_updates: [], blocked_items: [] };
      case 'personalOntology.conflicts.list':
        return { ok: true, conflicts: [] };
      case 'ontology.graph.read':
        return { ok: true, graph: GRAPH };
      default:
        return { ok: true };
    }
  });
}

function makeElement(id: string, options: { qs?: Map<string, any[]>; one?: Map<string, any> } = {}) {
  const qs = options.qs || new Map<string, any[]>();
  const one = options.one || new Map<string, any>();
  return {
    id,
    innerHTML: '',
    style: {},
    scrollTop: 0,
    value: '',
    querySelector: (selector: string) => (one.has(selector) ? one.get(selector) : null),
    querySelectorAll: (selector: string) => (qs.get(selector) || []).slice(),
    addEventListener() {},
    classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} },
  };
}

/** data-poc-graph-op 操作按钮：_pocBindMainView 在关系网络等域页绑定。 */
function graphOpTarget(attrs: Record<string, string>) {
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

/** 表单弹窗假件：uiModal() 返回带 overlay 的 thenable；微任务里模拟点击
 *  「保存」触发 collect，随后 resolve {value:'save'}（_pocGraphFormModal 契约）。 */
function makeFormModalFake(fieldValues: Record<string, string> = {}) {
  return vi.fn(() => {
    const listeners = new Map<string, (...args: any[]) => any>();
    const overlay = {
      addEventListener: (event: string, handler: (...args: any[]) => any) => { listeners.set(event, handler); },
      querySelector: (selector: string) => {
        const id = selector.startsWith('#') ? selector.slice(1) : selector;
        return Object.prototype.hasOwnProperty.call(fieldValues, id) ? { value: fieldValues[id], checked: false } : null;
      },
      querySelectorAll: () => [],
    };
    let resolveModal: (value: any) => void;
    const modal: any = new Promise((resolve) => { resolveModal = resolve; });
    modal.overlay = overlay;
    queueMicrotask(() => {
      const click = listeners.get('click');
      if (click) {
        click({
          target: { closest: (selector: string) => (selector === '[data-ui-modal-action="save"]' ? {} : null) },
          preventDefault() {},
          stopImmediatePropagation() {},
        });
      }
      resolveModal({ value: 'save' });
    });
    return modal;
  });
}

function loadPersonalOntology(
  invoke: any,
  options: { graphOps?: any[]; formFieldValues?: Record<string, string> } = {},
) {
  const graphOps = options.graphOps || [];
  const elements = new Map([
    ['personal-onto-nav', makeElement('personal-onto-nav', { qs: new Map([['[data-poc-nav]', []]]) })],
    ['personal-onto-main-header', makeElement('personal-onto-main-header')],
    ['personal-onto-main-body', makeElement('personal-onto-main-body', { qs: new Map([['[data-poc-graph-op]', graphOps]]) })],
    ['personal-onto-modal', makeElement('personal-onto-modal')],
    ['personal-onto-modal-body', makeElement('personal-onto-modal-body')],
    ['personal-onto-template-library-list', makeElement('personal-onto-template-library-list')],
    ['personal-onto-template-library-detail', makeElement('personal-onto-template-library-detail')],
  ]);
  const uiToast = vi.fn();
  const uiConfirm = vi.fn(async () => true);
  const uiConfirmDanger = vi.fn(async () => true);
  const sandbox: any = {
    console: { log() {}, warn() {}, error() {} },
    CSS: { escape: (value: string) => String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&') },
    document: {
      getElementById: (id: string) => elements.get(id) || null,
      querySelector: () => null,
      addEventListener: () => {},
      activeElement: null,
    },
    t: (key: string) => key, // 透传 → _t 走 fallback，toast 文本即 _pocGraphErrorText 的映射结果
    uiToast,
    uiAlert: vi.fn(),
    uiConfirm,
    uiConfirmDanger,
    uiModal: makeFormModalFake(options.formFieldValues || {}),
    uiInput: (o: any) => `<input id="${String(o && o.id || '')}">`,
    uiTextarea: (o: any) => `<textarea id="${String(o && o.id || '')}"></textarea>`,
    cogseed: { invoke },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const file of ['modules/icons.js', 'modules/ui-button.js', 'modules/ui-card.js', 'modules/ui-form.js', 'modules/ui-empty.js', 'modules/ui-status.js']) {
    vm.runInContext(readFileSync(resolve(root, 'src/renderer', file), 'utf8'), sandbox, { filename: file });
  }
  // ui-form.js 的真品依赖 AiSelect 运行时（浏览器侧）；表单链路测试只需选中态
  // 回写：置空实现（模块加载后覆盖，personal-ontology.js 调用时读取的是它）。
  sandbox.hydrateUiFormSelects = () => {};
  vm.runInContext(ontology, sandbox, { filename: 'personal-ontology.js' });
  return { sandbox, uiToast };
}

async function settle() {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 10));
}

async function boot(invoke: any, options: Parameters<typeof loadPersonalOntology>[1] = {}) {
  const loaded = loadPersonalOntology(invoke, options);
  await loaded.sandbox.renderPersonalOntology();
  await settle();
  // 域页（关系网络）才走 _pocBindMainView 绑定 data-poc-graph-op
  await loaded.sandbox.renderPersonalOntology({ view: 'relationships' });
  await settle();
  return loaded;
}

async function click(target: any) {
  const handler = target.listeners.get('click');
  expect(handler).toBeTypeOf('function');
  await handler({ stopPropagation() {} });
  await settle();
}

function toastTexts(uiToast: any) {
  return uiToast.mock.calls.map(([message]: [string]) => String(message));
}

describe('个人本体 › 图谱变更错误映射补齐（P-r3-27：自环 2 类 + not found 3 类 + parent 1 条）', () => {
  it.each([
    // [场景, 操作按钮属性, 失败通道, 主进程错误串, 期望映射文案（zh fallback）]
    ['自环·双 self：新建关系两端都是「我」', { 'data-poc-graph-op': 'relation-create' }, 'ontology.relation.create', 'ontology self relation is not allowed', '起点和终点不能都是「我」'],
    ['自环·同实体：编辑既有关系两端同为 e1', { 'data-poc-graph-op': 'relation-edit', 'data-relation-id': 'rel1' }, 'ontology.relation.update', 'ontology entity cannot relate to itself', '关系的起点和终点不能是同一个实体'],
    ['并发窗·关系已被他窗删除', { 'data-poc-graph-op': 'relation-delete', 'data-relation-id': 'rel1' }, 'ontology.relation.delete', 'ontology relation not found', '这条关系已不存在（可能已在其他窗口删除），请刷新后重试'],
    ['并发窗·实体已被他窗删除', { 'data-poc-graph-op': 'entity-delete', 'data-entity-id': 'e1' }, 'ontology.entity.delete', 'ontology entity not found', '该实体已不存在（可能已在其他窗口删除），请刷新后重试'],
    ['并发窗·分类已被他窗删除', { 'data-poc-graph-op': 'category-delete', 'data-category-id': 'c1' }, 'ontology.category.delete', 'ontology category not found', '该分类已不存在（可能已在其他窗口删除），请刷新后重试'],
  ] as [string, Record<string, string>, string, string, string][])(
    '%s → toast 显示专属映射文案而非 generic',
    async (_scene, attrs, channel, mainError, expectedText) => {
      const invoke = makeInvoke({ [channel]: { ok: false, error: mainError } });
      const op = graphOpTarget(attrs);
      const loaded = await boot(invoke, { graphOps: [op], formFieldValues: { 'ontology-relation-predicate': '负责' } });
      await click(op);

      expect(invoke.mock.calls.some(([ch]: [string]) => ch === channel)).toBe(true);
      const texts = toastTexts(loaded.uiToast);
      expect(texts).toContain(expectedText); // _pocGraphErrorText 已解析映射 → toast 文本即映射文案
      expect(texts).not.toContain('保存失败，请检查填写内容后重试');
    },
  );

  it('复核顺带第 6 条：编辑分类时上级分类已被删（parent category not found）→ 专属词条', async () => {
    // 分类带 parentId（本地图仍在、主进程侧父分类已没了的并发窗口）
    const graph = JSON.parse(JSON.stringify(GRAPH));
    graph.categories.push({ id: 'c9', domain: 'affairs', name: '子分类', description: '', parentId: 'c1', fields: [] });
    const invoke = makeInvoke({
      'ontology.graph.read': { ok: true, graph },
      'ontology.category.update': { ok: false, error: 'ontology parent category not found' },
    });
    const op = graphOpTarget({ 'data-poc-graph-op': 'category-edit', 'data-category-id': 'c9' });
    const loaded = await boot(invoke, { graphOps: [op], formFieldValues: { 'ontology-category-name': '子分类' } });
    await click(op);

    const texts = toastTexts(loaded.uiToast);
    expect(texts).toContain('所选上级分类已不存在，请重新选择后再保存');
    expect(texts).not.toContain('保存失败，请检查填写内容后重试');
  });

  it('四语词条在位：6 个新键 zh/en/ja/pt 同键非空（renderer locale 表）', () => {
    for (const locale of ['zh', 'en', 'ja', 'pt']) {
      const table = JSON.parse(readFileSync(resolve(root, `src/renderer/locales/${locale}.json`), 'utf8'));
      for (const key of NEW_KEYS) {
        expect(typeof table[key], `${locale}:${key}`).toBe('string');
        expect((table[key] as string).trim().length, `${locale}:${key}`).toBeGreaterThan(0);
      }
    }
  });

  it('既有 9 条映射不回归：duplicate 关系错误仍映射到旧词条', async () => {
    const invoke = makeInvoke({
      'ontology.relation.delete': { ok: false, error: 'ontology relation already exists' },
    });
    const op = graphOpTarget({ 'data-poc-graph-op': 'relation-delete', 'data-relation-id': 'rel1' });
    const loaded = await boot(invoke, { graphOps: [op] });
    await click(op);
    expect(toastTexts(loaded.uiToast)).toContain('这条关系已经存在');
  });
});
