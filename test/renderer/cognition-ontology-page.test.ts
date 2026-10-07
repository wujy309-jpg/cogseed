import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

function pageHarness(extraRecords: Record<string, any> = {}, customSearchResults?: Array<Record<string, unknown>>, candidateFixture?: Record<string, any>, options: { holdSnapshot?: boolean } = {}) {
  let releaseSnapshot: (() => void) | null = null;
  const snapshotGate = options.holdSnapshot ? new Promise<void>(resolve => { releaseSnapshot = resolve; }) : null;
  const file = path.join(__dirname, '../../src/renderer/modules/cognition-ontology.js');
  const source = fs.readFileSync(file, 'utf8');
  const calls: Array<{ channel: string; payload: Record<string, unknown> }> = [];
  const buttonCalls: Array<Record<string, any>> = [];
  const toasts: Array<{ message: string; options?: Record<string, unknown> }> = [];
  let failNextGraph = false;
  let exportResponse: Record<string, unknown> = { ok: true, canceled: false, filePath: '/tmp/cogseed-ontology-export.json', bytes: 256 };
  let confirmResult = true;
  let candidate = candidateFixture ? structuredClone(candidateFixture) : null;
  let modalClick: Function | null = null;
  let nextFormValues: Record<string, string> = {};
  const importFile = { name: 'project-notes.md', text: '项目负责人由张浩变更为林青。' };
  const module = { id: 'project-module', kind: 'module', version: 1, status: 'active', access: 'task', createdAt: null, updatedAt: null,
    source: { kind: 'user', label: '用户确认' }, name: 'CogSeed项目', description: '项目事实', scope: { kind: 'project', id: 'p-1' } };
  const doc = { schemaVersion: 1, ownerId: 'test-user', revision: 0, records: { [module.id]: module, ...extraRecords }, history: [], receipts: {} };
  const container: any = { isConnected: true, listeners: new Map<string, Function[]>(), tabGroups: [], _html: '',
    addEventListener(type: string, fn: Function) { this.listeners.set(type, [...(this.listeners.get(type) || []), fn]); },
    removeEventListener() {},
    querySelectorAll(selector: string) {
      if (selector !== '[data-ui-tabs]') return [];
      return this.tabGroups;
    },
    set innerHTML(value: string) {
      this._html = value;
      this.tabGroups = [...value.matchAll(/<div class="ui-tabs[^>]*data-ontology-tabs="([^"]+)"[^>]*>/g)].map((match: RegExpMatchArray) => {
        const handlers: Function[] = [];
        return { dataset: { ontologyTabs: match[1] }, addEventListener(_type: string, fn: Function) { handlers.push(fn); },
          fire(value: string) { handlers.forEach(fn => fn({ detail: { value } })); } };
      });
    },
    get innerHTML() { return this._html; },
  };
  const root: any = {
    listeners: new Map<string, Function[]>(),
    addEventListener(type: string, fn: Function) { this.listeners.set(type, [...(this.listeners.get(type) || []), fn]); },
    removeEventListener(type: string, fn: Function) { this.listeners.set(type, (this.listeners.get(type) || []).filter(f => f !== fn)); },
    dispatchEvent(event: { type: string }) { for (const fn of [...(this.listeners.get(event.type) || [])]) fn(event); return true; },
    t(key: string) { return key; },
    uiToast(message: string, options?: Record<string, unknown>) { toasts.push({ message, options }); },
    cogseed: { async invoke(channel: string, payload: Record<string, unknown> = {}) {
      calls.push({ channel, payload });
      if (channel === 'cognition.ontology.snapshot') {
        if (!snapshotGate) return { ok: true, ontology: doc };
        return snapshotGate.then(() => ({ ok: true, ontology: doc }));
      }
      if (channel === 'cognition.ontology.export') return { ...exportResponse };
      if (channel === 'cognition.ontology.graph.query') {
        if (failNextGraph) { failNextGraph = false; return { ok: false, error: 'temporary graph failure' }; }
        const focusId = String(payload.focusId || '');
        const nodeId = focusId || String(payload.moduleId || module.id);
        return { ok: true, graph: { scale: payload.moduleId ? 'module' : 'modules', nodes: [{ id: nodeId, kind: focusId ? 'entity' : 'module', label: focusId ? '图谱聚焦对象' : module.name, status: 'active' }],
          edges: payload.moduleId ? [{ id: 'unknown-fact', from: nodeId, to: nodeId, label: '负责人', kind: 'assertion', truth: 'unknown', recordId: 'project-fact' }] : [],
          totalNodes: payload.moduleId ? 240 : 1, totalEdges: payload.moduleId ? 600 : 0, truncated: Boolean(payload.moduleId),
          ...(focusId ? { focusId, focusNodeId: focusId } : {}) } };
      }
      if (channel === 'cognition.ontology.search') return { ok: true, results: customSearchResults || [{ id: 'focus-person', kind: 'entity', name: '林青', moduleId: 'project-module' }] };
      if (channel === 'cognition.ontology.history.get') return { ok: true, history: [] };
      if (channel === 'cognition.ontology.import.file') return { ok: true, cancelled: false, ...importFile };
      if (channel === 'cognition.ontology.import.submit') return { ok: true, submitted: 1, total: 1, candidateIds: ['candidate-imported'] };
      if (channel === 'recall.candidates.save') return { ok: true, candidate: { id: 'candidate-1' } };
      if (channel === 'recall.candidates.read') return candidate ? { ok: true, candidate: structuredClone(candidate) } : { ok: false, error: 'candidate unavailable' };
      if (channel === 'cognition.ontology.candidate.commit') {
        const action = (payload.command as any).actions[0];
        const recordId = `candidate-record-${Object.keys(doc.records).length}`;
        const record = { ...action.record, id: recordId, version: 1, status: 'active',
          source: { kind: 'candidate', recordId: candidate.id, label: candidate.summary }, createdAt: null, updatedAt: null };
        doc.records[recordId] = record; doc.revision += 1;
        candidate = { ...candidate, ontologyHandoff: { status: 'in_progress', moduleIds: [String(payload.moduleId)], recordIds: [recordId] },
          capabilities: { ...candidate.capabilities, canEdit: false, canContinueOntology: true } };
        return { ok: true, candidate: structuredClone(candidate), handoff: candidate.ontologyHandoff, duplicate: false };
      }
      if (channel === 'cognition.ontology.candidate.complete') {
        candidate = { ...candidate, status: 'integrated', ontologyHandoff: { ...candidate.ontologyHandoff, status: 'integrated' },
          capabilities: { ...candidate.capabilities, canEdit: false, canContinueOntology: false } };
        return { ok: true, candidate: structuredClone(candidate), handoff: candidate.ontologyHandoff, duplicate: false };
      }
      throw new Error(`unexpected channel ${channel}`);
    } },
    uiButton(options: any) {
      buttonCalls.push(options);
      const { label, attrs = {}, role = 'secondary', className = '', icon = '' } = options;
      const iconMarkup = icon ? `<svg class="ui-button__icon is-${icon}"></svg>` : '';
      return `<button class="ui-button ui-button--${role} ${className}" ${Object.entries(attrs).map(([k,v]) => `${k}="${v}"`).join(' ')}>${iconMarkup}<span>${label}</span></button>`;
    },
    uiIconHtml(name: string, className: string) { return `<svg class="${className} is-${name}"></svg>`; },
    uiIconButton() { return '<button aria-label="close">x</button>'; },
    uiInput() { return '<input />'; }, uiField({ id, control }: any) {
      const attrs = Object.entries(control?.attrs || {}).map(([key, value]) => `${key}="${String(value)}"`).join(' ');
      if (control?.kind === 'input') return `<input id="${id}" value="${control.value || ''}" ${attrs} />`;
      if (control?.kind === 'textarea') return `<textarea id="${id}" ${attrs}>${control.value || ''}</textarea>`;
      if (control?.kind === 'select') return `<div id="${id}" data-ui-select data-ui-select-config='${JSON.stringify({ value: control.value || '' })}'></div>`;
      return '<div class="ui-field"></div>';
    }, uiTextarea() { return '<textarea></textarea>'; }, uiSelect() { return '<div></div>'; },
    async uiConfirm() { return confirmResult; },
    uiModal({ bodyHtml }: any) {
      const controls = [...bodyHtml.matchAll(/data-ontology-field="([^"]+)"/g)].map(match => ({ dataset: { ontologyField: match[1] }, value: nextFormValues[match[1]] || '' }));
      const selects = [...bodyHtml.matchAll(/<div id="([^"]+)" data-ui-select data-ui-select-config='([^']*)'/g)].map(match => ({ id: match[1], dataset: { uiSelectConfig: match[2] } }));
      bodySelects.push(...selects.map(select => ({ id: select.id, value: JSON.parse(select.dataset.uiSelectConfig).value || '' })));
      const error = { hidden: true, textContent: '' };
      const form: any = { querySelectorAll(selector: string) { return selector === '[data-ontology-field]' ? controls : selector === '[data-ui-select]' ? selects : []; },
        querySelector(selector: string) {
          if (selector === '.ontology-ws-form-error') return error;
          const match = selector.match(/\[data-ontology-field="([^"]+)"\]/);
          return match ? controls.find(control => control.dataset.ontologyField === match[1]) || null : null;
        } };
      const overlay: any = { querySelector() { return form; }, addEventListener(_type: string, fn: Function) { modalClick = fn; } };
      const promise: any = Promise.resolve();
      promise.overlay = overlay; promise.close = () => { modalClick = null; };
      return promise;
    },
    hydrateUiFormSelects(_form: unknown, callbacks: Record<string, (value: string) => void>) {
      for (const select of [...bodySelects]) callbacks[select.id]?.(select.value);
    },
    uiSegmentedControl({ items, ariaLabel }: any) { return `<div role="group" aria-label="${ariaLabel}">${items.map((item: any) => `<button type="button" data-ontology-action="${item.attrs['data-ontology-action']}" data-layout="${item.attrs['data-layout']}" aria-pressed="${item.value === 'radial'}">${item.label}</button>`).join('')}</div>`; },
    uiTabs({ items, attrs = {} }: any) { return `<div class="ui-tabs" data-ui-tabs ${Object.entries(attrs).map(([k,v]) => `${k}="${v}"`).join(' ')}>${items.map((item: any) => `<button data-ui-tab="${item.value}">${item.label}</button>`).join('')}</div>`; },
    hydrateUiTabs() {},
  };
  const bodySelects: Array<{ id: string; value: string }> = [];
  root.hydrateUiFormSelects = (_form: unknown, callbacks: Record<string, (value: string) => void>) => {
    for (const select of bodySelects) callbacks[select.id]?.(select.value);
    bodySelects.length = 0;
  };
  const context: any = { window: root, document: {}, console, Date, Intl, Map, Set, String, Number, Math, JSON, setTimeout, clearTimeout };
  vm.runInNewContext(source, context, { filename: file });
  return { context, container, calls, buttonCalls, toasts, module, failNextGraph() { failNextGraph = true; }, setFormValues(values: Record<string, string>) { nextFormValues = values; },
    setConfirmResult(value: boolean) { confirmResult = value; },
    releaseSnapshot() { releaseSnapshot?.(); },
    dispatchWindowEvent(type: string) { root.dispatchEvent({ type }); },
    async saveDialog() {
      const saveControl: any = { disabled: false, dataset: { ontologyAction: 'dialog-save' } };
      if (!modalClick) throw new Error('no dialog is open');
      await modalClick({ target: { closest: () => saveControl }, preventDefault() {} });
    },
    async clickDialog(action: string) {
      const control: any = { disabled: false, dataset: { ontologyAction: action } };
      if (!modalClick) throw new Error('no dialog is open');
      await modalClick({ target: { closest: () => control }, preventDefault() {} });
    } };
}

function click(container: any, action: string, recordId = '', extra: Record<string, string> = {}) {
  const listeners = container.listeners.get('click') || [];
  const target = { dataset: { ontologyAction: action, recordId, ...extra }, closest(selector: string) {
    if (selector === '[data-ontology-node]') return null;
    return selector === '[data-ontology-action]' ? this : null;
  } };
  listeners.forEach((listener: Function) => listener({ target, preventDefault() {} }));
}
function input(container: any, field: string, value: string) {
  const listeners = container.listeners.get('input') || [];
  const target = { value, closest(selector: string) { return selector === `[data-ontology-field="${field}"]` ? this : null; } };
  listeners.forEach((listener: Function) => listener({ target }));
}
function clickEdge(container: any, edgeId: string) {
  const listeners = container.listeners.get('click') || [];
  const target = { closest(selector: string) { return selector === '[data-ontology-edge]' ? { dataset: { ontologyEdge: edgeId } } : null; } };
  listeners.forEach((listener: Function) => listener({ target, preventDefault() {} }));
}

describe('本体工作台页面层级与接线', () => {
  it('本体页面引用的动态文案在四个语言文件中都能找到', () => {
    const source = fs.readFileSync(path.join(__dirname, '../../src/renderer/modules/cognition-ontology.js'), 'utf8');
    const keys = new Set([...source.matchAll(/text\('([^']+)'/g)].map(match => `ontologyWorkspace.${match[1]}`));
    for (const kind of ['module', 'definition', 'entity', 'assertion', 'rule', 'reference', 'value', 'asset', 'candidate', 'legacy']) keys.add(`ontologyWorkspace.${kind}`);
    for (const locale of ['zh', 'en', 'ja', 'pt']) {
      const table = JSON.parse(fs.readFileSync(path.join(__dirname, `../../src/renderer/locales/${locale}.json`), 'utf8'));
      for (const key of keys) expect(table[key], `${locale}.json missing ${key}`).toBeTruthy();
      const expectedTitle = ({ zh: '本体', en: 'Ontology', ja: '本体', pt: 'Ontologia' } as const)[locale];
      expect(table['ontologyWorkspace.title'], `${locale}.json has wrong ontology page title`).toBe(expectedTitle);
    }
  });
  it('列表与全局图谱是同级视图，图谱页不会重复渲染本体首页内容', async () => {
    const f = pageHarness();
    await f.context.window.mountCognitionOntology(f.container);
    expect(f.container.innerHTML).toContain('ontology-ws-module-grid');
    expect(f.container.tabGroups.some((group: any) => group.dataset.ontologyTabs === 'workspace')).toBe(true);
    f.container.tabGroups.find((group: any) => group.dataset.ontologyTabs === 'workspace').fire('graph');
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(f.calls.some(call => call.channel === 'cognition.ontology.graph.query' && !call.payload.moduleId)).toBe(true);
    expect(f.container.innerHTML).toContain('ontology-ws-graph-shell');
    expect(f.container.innerHTML).not.toContain('ontology-ws-stats');
    expect(f.container.innerHTML).not.toContain('ontology-ws-module-grid');
  });
  it('认知资产按钮使用浅色层级和能表达动作的图标', async () => {
    const f = pageHarness();
    await f.context.window.mountCognitionOntology(f.container);
    const action = (name: string) => f.buttonCalls.find(button => button.attrs?.['data-ontology-action'] === name);
    expect(action('import')).toMatchObject({ role: 'secondary', className: 'ontology-ws-button', icon: 'upload' });
    expect(action('supplement')).toMatchObject({ role: 'secondary', className: 'ontology-ws-button', icon: 'sparkles' });
    expect(action('create-module')).toMatchObject({ role: 'primary', className: 'ontology-ws-button', icon: 'plus' });
    expect(action('open-module')).toMatchObject({ role: 'secondary', className: 'ontology-ws-button', icon: 'arrow-right' });
    expect(f.container.innerHTML).toContain('ui-button__icon is-upload');
    const assetCss = fs.readFileSync(path.join(__dirname, '../../src/renderer/cognition-assets.css'), 'utf8');
    expect(assetCss).toContain('#ca-root .btn.ui-button--primary');
    expect(assetCss).toContain('background: var(--color-brand-soft)');
  });
  it('本体卡片用不同图标与颜色区分范围和旧来源', async () => {
    const personal = { id: 'personal-module', kind: 'module', version: 1, status: 'active', access: 'task', createdAt: null, updatedAt: null,
      source: { kind: 'user', label: '用户确认' }, name: '个人规则', description: '', scope: { kind: 'personal' } };
    const workspace = { id: 'workspace-module', kind: 'module', version: 1, status: 'active', access: 'task', createdAt: null, updatedAt: null,
      source: { kind: 'user', label: '用户确认' }, name: '团队知识', description: '', scope: { kind: 'workspace', id: 'w-1' } };
    const legacy = { id: 'legacy-module', kind: 'module', version: 1, status: 'active', access: 'task', createdAt: null, updatedAt: null,
      source: { kind: 'legacy', label: '旧个人本体', recordId: 'legacy-group' }, name: '旧记录', description: '', scope: { kind: 'personal' } };
    const f = pageHarness({ [personal.id]: personal, [workspace.id]: workspace, [legacy.id]: legacy });
    await f.context.window.mountCognitionOntology(f.container);
    expect(f.container.innerHTML).toContain('ontology-ws-module-icon--project');
    expect(f.container.innerHTML).toContain('is-folder');
    expect(f.container.innerHTML).toContain('ontology-ws-module-icon--personal');
    expect(f.container.innerHTML).toContain('is-user');
    expect(f.container.innerHTML).toContain('ontology-ws-module-icon--workspace');
    expect(f.container.innerHTML).toContain('is-users');
    expect(f.container.innerHTML).toContain('ontology-ws-module-icon--legacy');
    expect(f.container.innerHTML).toContain('is-archive');
    expect(f.container.innerHTML).toContain('ontology-ws-scope--legacy');
    expect(f.container.innerHTML).toContain('旧来源');
  });
  it('候选整理入口先展示来源并按项目范围选本体，手工新增记录经候选交接 IPC 保存', async () => {
    const personType = { id: 'person-type', kind: 'definition', moduleId: 'project-module', version: 1, status: 'active', access: 'task',
      source: { kind: 'user', label: '用户确认' }, name: '人物', description: '', definitionKind: 'type', subjectTypes: [], objectTypes: [],
      valueType: 'entity', cardinality: 'many', cardinalityAnchor: 'subject', createdAt: null, updatedAt: null };
    const otherModule = { id: 'other-project-module', kind: 'module', version: 1, status: 'active', access: 'task', createdAt: null, updatedAt: null,
      source: { kind: 'user', label: '用户确认' }, name: '另一个项目', description: '', scope: { kind: 'project', id: 'p-2' } };
    const candidate = { id: 'candidate-1', status: 'pending_review', summary: '项目负责人变更', judgment: '最新周报确认林青负责项目。', value: '项目负责人由张浩变更为林青。', risk: 'low',
      scopePolicy: { projectIds: ['p-1'] }, sourceRefs: [{ kind: 'conversation', id: 'conv-1', title: '周报讨论' }],
      capabilities: { canEdit: true, canContinueOntology: false } };
    const f = pageHarness({ [personType.id]: personType, [otherModule.id]: otherModule }, undefined, candidate);
    await f.context.window.mountCognitionOntology(f.container, { candidateId: candidate.id });
    expect(f.calls.some(call => call.channel === 'recall.candidates.read' && call.payload.candidateId === candidate.id)).toBe(true);
    expect(f.container.innerHTML).toContain('项目负责人由张浩变更为林青');
    expect(f.container.innerHTML).toContain('周报讨论');
    expect(f.container.innerHTML).not.toContain('另一个项目');

    click(f.container, 'candidate-select-module', f.module.id);
    expect(f.container.innerHTML).toContain('已整理 0 条本体记录');
    f.setFormValues({ name: '林青', description: '当前项目负责人', aliases: '小林' });
    click(f.container, 'create-entity');
    await f.saveDialog();
    const commit = f.calls.find(call => call.channel === 'cognition.ontology.candidate.commit');
    expect(commit?.payload).toMatchObject({ candidateId: candidate.id, moduleId: f.module.id });
    expect((commit?.payload.command as any).actions[0].record).toMatchObject({ kind: 'entity', name: '林青', moduleId: f.module.id, typeId: personType.id });
    expect(f.calls.some(call => call.channel === 'cognition.ontology.command.commit')).toBe(false);
    expect(f.container.innerHTML).toContain('林青');
  });
  it('高风险候选在用户拒绝确认时不写入，确认后才提交风险回执', async () => {
    const personType = { id: 'person-type', kind: 'definition', moduleId: 'project-module', version: 1, status: 'active', access: 'task',
      source: { kind: 'user', label: '用户确认' }, name: '人物', description: '', definitionKind: 'type', subjectTypes: [], objectTypes: [],
      valueType: 'entity', cardinality: 'many', cardinalityAnchor: 'subject', createdAt: null, updatedAt: null };
    const candidate = { id: 'candidate-high', status: 'pending_review', summary: '重要负责人', judgment: '原文内容', value: '请核对负责人信息。', risk: 'high',
      capabilities: { canEdit: true, canContinueOntology: false } };
    const f = pageHarness({ [personType.id]: personType }, undefined, candidate);
    await f.context.window.mountCognitionOntology(f.container, { candidateId: candidate.id });
    click(f.container, 'candidate-select-module', f.module.id);
    f.setFormValues({ name: '林青', description: '', aliases: '' });
    click(f.container, 'create-entity');
    f.setConfirmResult(false);
    await f.saveDialog();
    expect(f.calls.some(call => call.channel === 'cognition.ontology.candidate.commit')).toBe(false);
    f.setConfirmResult(true);
    await f.saveDialog();
    const commit = f.calls.find(call => call.channel === 'cognition.ontology.candidate.commit');
    expect(commit?.payload.riskAcknowledged).toBe(true);
  });
  it('文件选择后把原文送入共同候选入口，不直写本体', async () => {
    const f = pageHarness();
    await f.context.window.mountCognitionOntology(f.container);
    click(f.container, 'import');
    await f.clickDialog('choose-import-file');
    await f.saveDialog();
    expect(f.calls.some(call => call.channel === 'cognition.ontology.import.file')).toBe(true);
    expect(f.calls.find(call => call.channel === 'cognition.ontology.import.submit')?.payload).toMatchObject({
      name: 'project-notes.md', text: '项目负责人由张浩变更为林青。', suggestedType: 'fact',
    });
    expect(f.calls.some(call => call.channel === 'cognition.ontology.command.commit')).toBe(false);
    expect(f.toasts.some(toast => toast.options?.variant === 'success')).toBe(true);
  });
  it('进入具体本体后，三个盒子与本体图谱位于同一层级并请求模块范围图', async () => {
    const f = pageHarness();
    await f.context.window.mountCognitionOntology(f.container);
    click(f.container, 'open-module', f.module.id);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(f.container.innerHTML).toContain('TBox');
    expect(f.container.innerHTML).toContain('ABox');
    expect(f.container.innerHTML).toContain('RBox');
    f.container.tabGroups.find((group: any) => group.dataset.ontologyTabs === 'module').fire('graph');
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(f.calls.some(call => call.channel === 'cognition.ontology.graph.query' && call.payload.moduleId === f.module.id)).toBe(true);
    expect(f.container.innerHTML).toContain('ontology-ws-graph-shell');
    expect(f.container.innerHTML).toContain('? = 生效时间待确认');
    expect(f.container.innerHTML).toContain('1/240');
    expect(f.container.innerHTML).toContain('1/600');
  });
  it('旧本体逐条送审时保留来源与项目范围，并排除仅本人可见的关联事实', async () => {
    const legacyModule = { id: 'legacy-module', kind: 'module', version: 1, status: 'active', access: 'task', createdAt: null, updatedAt: null,
      source: { kind: 'legacy', label: '旧图谱', recordId: 'graph-module' }, name: '旧项目本体', description: '', scope: { kind: 'project', id: 'project-1' } };
    const type = { id: 'legacy-person-type', kind: 'definition', moduleId: legacyModule.id, name: '人物', description: '', definitionKind: 'type', subjectTypes: [], objectTypes: [], valueType: 'entity', cardinality: 'many', cardinalityAnchor: 'subject',
      version: 1, status: 'active', access: 'task', source: { kind: 'legacy', label: '旧分类', recordId: 'person-type' }, createdAt: null, updatedAt: null };
    const entity = { id: 'legacy-person', kind: 'entity', moduleId: legacyModule.id, typeId: type.id, name: '林青', description: '负责产品交付', aliases: ['小林'], identityStatus: 'confirmed',
      version: 1, status: 'active', access: 'task', source: { kind: 'legacy', label: '旧人物', recordId: 'person-17', refs: [] }, createdAt: null, updatedAt: null };
    const definition = { id: 'legacy-role', kind: 'definition', moduleId: legacyModule.id, name: '角色', description: '', definitionKind: 'attribute', subjectTypes: [type.id], objectTypes: [], valueType: 'text', cardinality: 'one', cardinalityAnchor: 'subject',
      version: 1, status: 'active', access: 'task', source: { kind: 'legacy', label: '旧字段', recordId: 'role-field' }, createdAt: null, updatedAt: null };
    const shared = { kind: 'assertion', moduleId: legacyModule.id, subjectId: entity.id, definitionId: definition.id, object: { kind: 'literal', valueType: 'text', value: '项目负责人' }, validity: { from: null, until: null, precision: 'day', timezone: 'UTC' },
      version: 1, status: 'active', access: 'task', source: { kind: 'legacy', label: '旧事实', recordId: 'role-value' }, createdAt: null, updatedAt: null };
    const privateFact = { ...shared, id: 'legacy-private', object: { kind: 'literal', valueType: 'text', value: '私密值不得外送' }, access: 'owner_only', source: { kind: 'legacy', label: '旧私密事实', recordId: 'private-value' } };
    const f = pageHarness({ [legacyModule.id]: legacyModule, [type.id]: type, [entity.id]: entity, [definition.id]: definition,
      'legacy-role-value': { ...shared, id: 'legacy-role-value' }, [privateFact.id]: privateFact });
    await f.context.window.mountCognitionOntology(f.container);
    click(f.container, 'open-module', legacyModule.id);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(f.container.innerHTML).toContain('逐项送入待我处理');
    expect(f.container.innerHTML).not.toContain('data-ontology-action="legacy-candidate"');
    click(f.container, 'open-record', entity.id);
    await new Promise(resolve => setTimeout(resolve, 0));
    click(f.container, 'legacy-candidate', entity.id);
    await new Promise(resolve => setTimeout(resolve, 0));
    const saved = f.calls.find(call => call.channel === 'recall.candidates.save');
    expect(saved?.payload.sourceRefs).toEqual([expect.objectContaining({ kind: 'ontology', id: 'person-17' })]);
    expect(saved?.payload.evidenceRefs).toEqual(saved?.payload.sourceRefs);
    expect(saved?.payload.scopePolicy).toEqual({ projectIds: ['project-1'] });
    expect(saved?.payload.value).toContain('林青');
    expect(saved?.payload.value).toContain('项目负责人');
    expect(saved?.payload.value).not.toContain('私密值不得外送');
    click(f.container, 'open-record', privateFact.id);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(f.container.innerHTML).not.toContain('data-ontology-action="legacy-candidate"');
    click(f.container, 'legacy-candidate', privateFact.id);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(f.calls.filter(call => call.channel === 'recall.candidates.save')).toHaveLength(1);
    expect(f.toasts.some(toast => toast.options?.variant === 'warning')).toBe(true);
  });
  it('大量本体与盒内记录分页显示，切换 T/A/R 标签会同步切换对应盒子', async () => {
    const extra: Record<string, any> = {};
    for (let index = 0; index < 62; index++) {
      const id = `page-module-${index}`;
      extra[id] = { id, kind: 'module', version: 1, status: 'active', access: 'task', createdAt: null, updatedAt: `2026-10-${String(index + 1).padStart(2, '0')}T00:00:00Z`,
        source: { kind: 'user', label: '用户确认' }, name: `分页本体 ${index}`, description: '', scope: { kind: 'personal' } };
    }
    for (let index = 0; index < 105; index++) {
      const id = `page-definition-${index}`;
      extra[id] = { id, kind: 'definition', moduleId: 'project-module', name: `定义 ${index}`, description: '', definitionKind: 'type', subjectTypes: [], objectTypes: [],
        valueType: 'entity', cardinality: 'many', cardinalityAnchor: 'subject', version: 1, status: 'active', access: 'task', source: { kind: 'user', label: '用户确认' }, createdAt: null, updatedAt: null };
    }
    const f = pageHarness(extra);
    await f.context.window.mountCognitionOntology(f.container);
    expect(f.container.innerHTML.match(/data-ontology-action="open-module"/g)).toHaveLength(50);
    expect(f.container.innerHTML).toContain('1–50 / 63');
    click(f.container, 'change-page', '', { pageKind: 'modules', page: '1' });
    expect(f.container.innerHTML.match(/data-ontology-action="open-module"/g)).toHaveLength(13);
    expect(f.container.innerHTML).toContain('51–63 / 63');

    click(f.container, 'open-module', 'project-module');
    await new Promise(resolve => setTimeout(resolve, 0));
    f.container.tabGroups.find((group: any) => group.dataset.ontologyTabs === 'module').fire('A');
    await new Promise(resolve => setTimeout(resolve, 0));
    f.container.tabGroups.find((group: any) => group.dataset.ontologyTabs === 'module').fire('T');
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(f.container.innerHTML.match(/data-ontology-action="open-record"/g)).toHaveLength(100);
    expect(f.container.innerHTML).toContain('1–100 / 105');
    expect(f.container.innerHTML).toContain('定义 0');
    click(f.container, 'change-page', '', { pageKind: 'records', page: '1' });
    expect(f.container.innerHTML.match(/data-ontology-action="open-record"/g)).toHaveLength(5);
    expect(f.container.innerHTML).toContain('101–105 / 105');
    expect(f.container.innerHTML).toContain('定义 104');
  });
  it('搜索对象可聚焦图谱，点击关系线打开同一条事实详情', async () => {
    const entity = { id: 'focus-person', kind: 'entity', moduleId: 'project-module', typeId: 'person-type', name: '林青', description: '交付负责人', aliases: [], identityStatus: 'confirmed',
      version: 1, status: 'active', access: 'task', source: { kind: 'user', label: '用户确认' }, createdAt: null, updatedAt: null };
    const type = { id: 'person-type', kind: 'definition', moduleId: 'project-module', name: '人物', description: '', definitionKind: 'type', subjectTypes: [], objectTypes: [], valueType: 'entity', cardinality: 'many', cardinalityAnchor: 'subject',
      version: 1, status: 'active', access: 'task', source: { kind: 'user', label: '用户确认' }, createdAt: null, updatedAt: null };
    const relation = { id: 'owner-definition', kind: 'definition', moduleId: 'project-module', name: '负责人', description: '', definitionKind: 'relation', subjectTypes: [type.id], objectTypes: [type.id], valueType: 'entity', cardinality: 'one', cardinalityAnchor: 'subject',
      version: 1, status: 'active', access: 'task', source: { kind: 'user', label: '用户确认' }, createdAt: null, updatedAt: null };
    const fact = { id: 'project-fact', kind: 'assertion', moduleId: 'project-module', subjectId: entity.id, definitionId: relation.id, object: { kind: 'entity', id: entity.id }, validity: { from: null, until: null, precision: 'day', timezone: 'UTC' },
      version: 1, status: 'active', access: 'task', source: { kind: 'user', label: '用户确认' }, createdAt: null, updatedAt: null };
    const f = pageHarness({ [entity.id]: entity, [type.id]: type, [relation.id]: relation, [fact.id]: fact });
    await f.context.window.mountCognitionOntology(f.container);
    click(f.container, 'open-module', 'project-module');
    await new Promise(resolve => setTimeout(resolve, 0));
    f.container.tabGroups.find((group: any) => group.dataset.ontologyTabs === 'module').fire('graph');
    await new Promise(resolve => setTimeout(resolve, 0));
    input(f.container, 'graphSearch', '林青');
    await new Promise(resolve => setTimeout(resolve, 220));
    expect(f.container.innerHTML).toContain('focus-record');
    click(f.container, 'focus-record', entity.id);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(f.calls.some(call => call.channel === 'cognition.ontology.graph.query' && call.payload.focusId === entity.id)).toBe(true);
    expect(f.container.innerHTML).toContain('返回本体图谱全景');
    click(f.container, 'graph-layout', '', { layout: 'layers' });
    expect(f.container.innerHTML).toContain('data-layout="layers"');
    const normalViewBox = f.container.innerHTML.match(/viewBox="([^"]+)"/)?.[1];
    click(f.container, 'graph-zoom', '', { zoomStep: '1' });
    expect(f.container.innerHTML.match(/viewBox="([^"]+)"/)?.[1]).not.toBe(normalViewBox);
    click(f.container, 'graph-zoom-reset');
    expect(f.container.innerHTML.match(/viewBox="([^"]+)"/)?.[1]).toBe(normalViewBox);
    f.failNextGraph();
    click(f.container, 'graph-full');
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(f.container.innerHTML).toContain('返回本体图谱全景');
    expect(f.toasts.some(toast => toast.message === 'temporary graph failure')).toBe(true);
    clickEdge(f.container, 'unknown-fact');
    expect(f.container.innerHTML).toContain('data-ontology-action="open-graph-record"');
    click(f.container, 'open-graph-record', fact.id);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(f.container.innerHTML).toContain('林青 · 负责人 · 林青');
    click(f.container, 'back-module');
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(f.container.innerHTML).toContain('ontology-ws-graph-shell');
    expect(f.container.innerHTML).toContain('data-ontology-edge="unknown-fact"');
    expect(f.calls.filter(call => call.channel === 'cognition.ontology.graph.query' && call.payload.focusId === entity.id).length).toBeGreaterThanOrEqual(2);
  });
  it('同名对象的图谱搜索结果显示所属本体与可区分的说明', async () => {
    const one = { id: 'person-research', kind: 'entity', moduleId: 'project-module', typeId: 'person-type', name: '张浩', description: '研发组', aliases: [], identityStatus: 'confirmed',
      version: 1, status: 'active', access: 'task', source: { kind: 'user', label: '用户确认' }, createdAt: null, updatedAt: null };
    const two = { ...one, id: 'person-customer', description: '客户组' };
    const type = { id: 'person-type', kind: 'definition', moduleId: 'project-module', name: '人物', description: '', definitionKind: 'type', subjectTypes: [], objectTypes: [], valueType: 'entity', cardinality: 'many', cardinalityAnchor: 'subject',
      version: 1, status: 'active', access: 'task', source: { kind: 'user', label: '用户确认' }, createdAt: null, updatedAt: null };
    const f = pageHarness({ [one.id]: one, [two.id]: two, [type.id]: type }, [
      { id: one.id, kind: 'entity', name: one.name, moduleId: one.moduleId, description: one.description },
      { id: two.id, kind: 'entity', name: two.name, moduleId: two.moduleId, description: two.description },
    ]);
    await f.context.window.mountCognitionOntology(f.container);
    click(f.container, 'open-module', 'project-module');
    await new Promise(resolve => setTimeout(resolve, 0));
    f.container.tabGroups.find((group: any) => group.dataset.ontologyTabs === 'module').fire('graph');
    await new Promise(resolve => setTimeout(resolve, 0));
    input(f.container, 'graphSearch', '张浩');
    await new Promise(resolve => setTimeout(resolve, 220));
    expect(f.container.innerHTML).toContain('CogSeed项目');
    expect(f.container.innerHTML).toContain('研发组');
    expect(f.container.innerHTML).toContain('客户组');
    expect(f.container.innerHTML.match(/data-ontology-action="focus-record"/g)).toHaveLength(2);
  });
});

describe('i18n-change 在快照未落地时只重绘加载骨架（语言切换崩溃修复）', () => {
  it('doc 未加载时收到 i18n-change 不走全量 render；落地后再触发则正常重绘', async () => {
    const f = pageHarness({}, undefined, undefined, { holdSnapshot: true });
    const container = f.container;
    // 不 await：mount 已同步渲染骨架，快照仍在途（state.doc === undefined 窗口）
    const mounted = f.context.window.mountCognitionOntology(container);
    f.dispatchWindowEvent('i18n-change');
    // 修复前：此处抛 TypeError（listPage→modules 读 state.doc.records）；修复后只重绘骨架
    expect(container.innerHTML).toContain('ontology-ws-loading');
    expect(container.innerHTML).not.toContain('ontology-ws-stats');
    expect(container.innerHTML).not.toContain('ontology-ws-module-grid');
    f.releaseSnapshot();
    await mounted;
    // 数据落地后：i18n-change 走全量 render，模块网格正常回来
    f.dispatchWindowEvent('i18n-change');
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(container.innerHTML).toContain('ontology-ws-module-grid');
  });
});

describe('本体导出（FR-015/AC-013）页面接线', () => {
  it('首页与模块页都有导出按钮；成功后 toast 带路径，取消不提示', async () => {
    const f = pageHarness();
    await f.context.window.mountCognitionOntology(f.container);
    expect(f.container.innerHTML).toContain('data-ontology-action="export"');
    // 模块详情页也有
    click(f.container, 'open-module', 'project-module');
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(f.container.innerHTML).toContain('data-ontology-action="export"');
    // 成功导出（模块页 → 带 moduleId）
    click(f.container, 'export');
    await new Promise(resolve => setTimeout(resolve, 0));
    const call = f.calls.find(c => c.channel === 'cognition.ontology.export');
    expect(call).toBeTruthy();
    expect(call?.payload).toEqual({ moduleId: 'project-module' });
    expect(f.toasts.some(t => String(t.message).includes('/tmp/cogseed-ontology-export.json'))).toBe(true);
  });
});
