import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import vm from 'node:vm';

// 回归测试：两个懒加载名称映射「失败固化空 Map」（P-r2-29 / P-r3-23，
// 预审决策卡 A-锁内复核/并发组，拍板=失败不写缓存保持 null 自然重试）。
//
// P-r3-23：_pocEnsureProjectNames 调的 projects.list 是死通道（主进程零注册，
// invoke 返回 {ok:false, unknown channel}），此前把空 Map 固化成缓存——@项目
// 从此永久显示原始 pid 且再不发请求（「修固化」是拍板口径：新增通道/改调
// spaces.list 需先定数据源，不在本批）。
// P-r2-29：_pocEnsureResourceNames（skills.list/agents.list）失败后同样固化
// 空 Map，一次瞬时失败 → bundle 名称永久退化到裸 id。
// 修后：读不到形状合法的清单一律保持 null，下一次打开真实重试。

const root = resolve(__dirname, '../..');
const ontology = readFileSync(resolve(root, 'src/renderer/modules/personal-ontology.js'), 'utf8');

const SNAPSHOT = {
  groups: [
    {
      id: 'g1', title: '工作偏好', kind: 'user',
      createdAt: '2026-09-01T10:00:00', updatedAt: '2026-09-02T10:00:00',
      fields: [{ id: 'f1', name: '常用工具', origin: 'user', valueIds: ['v1'] }],
      values: [{ id: 'v1', fieldId: 'f1', text: 'ZCode', source: '手动', createdAt: '', updatedAt: '' }],
      entries: [],
    },
  ],
  counts: { groups: 1, facts: 1, rules: 0, entries: 0 },
  deleted: [],
};

const TEMPLATE = {
  template_id: 't1', group_id: 'g1', name: '工作偏好模板', installed: true,
  sections: [], bundle: { skill_ids: ['sk-1'], agent_ids: ['ag-1'] },
};

function makeInvoke(overrides: Record<string, any> = {}) {
  return vi.fn(async (channel: string, payload: any) => {
    if (channel in overrides) {
      const override = overrides[channel];
      return typeof override === 'function' ? override(channel, payload) : override;
    }
    switch (channel) {
      case 'po.snapshot': return SNAPSHOT;
      case 'personalOntology.templates.list': return { ok: true, templates: [TEMPLATE] };
      case 'personalOntology.groups.read': return { ok: true, content: '# 工作偏好\n' };
      case 'personalOntology.candidates.list': return { ok: true, candidate_updates: [], blocked_items: [] };
      case 'personalOntology.conflicts.list': return { ok: true, conflicts: [] };
      case 'ontology.graph.read': return { ok: true, graph: { categories: [], entities: [], relations: [] } };
      case 'recall.assets.list': return { ok: true, assets: [] };
      default: return { ok: true };
    }
  });
}

function clickTarget(attrs: Record<string, string>) {
  const listeners = new Map<string, (...args: any[]) => any>();
  return {
    attrs, listeners,
    dataset: {},
    innerHTML: '',
    style: {},
    getAttribute(name: string) { return attrs[name] != null ? String(attrs[name]) : null; },
    addEventListener(event: string, handler: (...args: any[]) => any) { listeners.set(event, handler); },
    setAttribute() {}, removeAttribute() {},
    classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} },
    closest() { return null; },
    querySelectorAll() { return []; },
  };
}

function makeElement(id: string, options: { qs?: Map<string, any[]>; one?: Map<string, any> } = {}) {
  const qs = options.qs || new Map<string, any[]>();
  const one = options.one || new Map<string, any>();
  return {
    id, innerHTML: '', style: {}, value: '',
    querySelector: (selector: string) => (one.has(selector) ? one.get(selector) : null),
    querySelectorAll: (selector: string) => (qs.get(selector) || []).slice(),
    addEventListener() {},
    classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} },
  };
}

function loadPersonalOntology(invoke: any, bodyTargets: Map<string, any[]>) {
  const elements = new Map([
    ['personal-onto-nav', makeElement('personal-onto-nav', { qs: new Map([['[data-poc-nav]', []]]) })],
    ['personal-onto-main-header', makeElement('personal-onto-main-header')],
    ['personal-onto-main-body', makeElement('personal-onto-main-body', { qs: bodyTargets })],
    ['personal-onto-modal', makeElement('personal-onto-modal')],
    ['personal-onto-modal-body', makeElement('personal-onto-modal-body')],
    ['personal-onto-template-library-list', makeElement('personal-onto-template-library-list')],
    ['personal-onto-template-library-detail', makeElement('personal-onto-template-library-detail')],
  ]);
  const sandbox: any = {
    console: { log() {}, warn() {}, error() {} },
    CSS: { escape: (value: string) => String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&') },
    document: {
      getElementById: (id: string) => elements.get(id) || null,
      querySelector: () => null,
      addEventListener: () => {},
      activeElement: null,
    },
    t: (key: string) => key,
    uiToast: vi.fn(),
    uiModal: vi.fn(async () => ({ value: 'save' })),
    uiConfirm: vi.fn(async () => true),
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
  vm.runInContext(ontology, sandbox, { filename: 'personal-ontology.js' });
  return { sandbox, elements };
}

async function settle() {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 10));
}

async function boot(invoke: any, bodyTargets: Map<string, any[]>) {
  const loaded = loadPersonalOntology(invoke, bodyTargets);
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

function countChannel(invoke: any, channel: string) {
  return invoke.mock.calls.filter(([ch]: [string]) => ch === channel).length;
}

describe('个人本体 › 懒加载名称映射失败不固化（P-r2-29 / P-r3-23）', () => {
  it('P-r3-23：projects.list 读不到（死通道 ok:false）不固化空 Map——重开分组会真实重试', async () => {
    const groupBtn = clickTarget({ 'data-poc-nav': 'template', 'data-poc-id': 'g1' });
    const invoke = makeInvoke({
      // 复刻真实行为：主进程零注册 → handleInvoke 返回 {ok:false, unknown channel}。
      'projects.list': { ok: false, error: 'unknown channel: projects.list' },
    });
    await boot(invoke, new Map([['[data-poc-nav]', [groupBtn]]]));

    await click(groupBtn);
    expect(countChannel(invoke, 'projects.list')).toBe(1);

    // 修前：第一次已把空 Map 固化成缓存，第二次进函数直接 return（零新增
    // invoke）——@项目从此永久显示原始 pid。修后：保持 null，自然重试。
    await click(groupBtn);
    expect(countChannel(invoke, 'projects.list')).toBe(2);
  });

  it('P-r3-23 对照组：projects.list 可用后正常缓存，重复打开不重复拉', async () => {
    const groupBtn = clickTarget({ 'data-poc-nav': 'template', 'data-poc-id': 'g1' });
    const invoke = makeInvoke({
      'projects.list': { ok: true, projects: [{ project_id: 'pj-1', name: 'CogSeed' }] },
    });
    await boot(invoke, new Map([['[data-poc-nav]', [groupBtn]]]));
    await click(groupBtn);
    await click(groupBtn);
    expect(countChannel(invoke, 'projects.list')).toBe(1); // 成功才缓存
  });

  it('P-r2-29：skills.list 瞬时失败不固化——重开模板库会真实重试，成功后恢复', async () => {
    const libraryBtn = clickTarget({ 'data-poc-nav': 'template-library' });
    let skillsOk = false;
    const invoke = makeInvoke({
      'skills.list': () => (skillsOk
        ? { ok: true, skills: [{ id: 'sk-1', name: '检索技能', description_zh: '找资料' }] }
        : { ok: false, error: 'db locked' }),
      'agents.list': { ok: true, agents: [{ agent_id: 'ag-1', name: '审校', description_zh: '把关' }] },
    });
    const loaded = await boot(invoke, new Map([['[data-poc-nav]', [libraryBtn]]]));

    // 第一次打开：skills.list 失败——不写缓存。
    await click(libraryBtn);
    expect(countChannel(invoke, 'skills.list')).toBe(1);

    // 修前：空 Map 固化后这里零新增 invoke，bundle 名称永久退化到裸 id。
    skillsOk = true;
    await click(libraryBtn);
    expect(countChannel(invoke, 'skills.list')).toBe(2);
    // 成功后恢复：详情区按映射渲染技能/智能体名称而非裸 id。
    const detailHtml = String(loaded.elements.get('personal-onto-template-library-detail').innerHTML);
    expect(detailHtml).toContain('检索技能');
    expect(detailHtml).toContain('审校');
  });
});
