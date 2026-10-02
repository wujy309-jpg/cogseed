import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import vm from 'node:vm';

// 回归测试（P-r1-63 / P-r2-28 / P-r3-21，预审决策卡 2026-10-01 拍板「报错中止」）：
// 模板重装前的归档探测（personalOntology.templates.hasArchive）失败 ≠ 没有归档。
// _pocInvoke 永不抛（失败归一成 {ok:false,error}），修前 ok:false 被
// `ar && ar.hasArchive` 当「无归档」静默走下去重建空模板——空数据落盘后卸载会
// 写进更新的 _backup_<ts>，旧真数据实质不可达。修后一律 fail-fast 报错中止：
// 不发 install、错误信息写明数据未损与恢复途径（零新 UI，走既有 _notifyFail）。
// P-r2-28 附带口径：有归档但 uiConfirmDanger 组件缺失（无法把「恢复还是重建」
// 交给用户）同样中止，不再默认重建空模板。

const root = resolve(__dirname, '../..');
const ontology = readFileSync(resolve(root, 'src/renderer/modules/personal-ontology.js'), 'utf8');

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
        return { ok: true, templates: [{ template_id: 'student', name: '学生模板', installed: false, sections: [] }] };
      case 'recall.assets.list':
        return { ok: true, assets: [] };
      case 'personalOntology.candidates.list':
        return { ok: true, candidate_updates: [], blocked_items: [] };
      case 'personalOntology.conflicts.list':
        return { ok: true, conflicts: [] };
      case 'ontology.graph.read':
        return { ok: true, graph: { categories: [], entities: [], relations: [] } };
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

/** 模板库「安装」按钮：dataset.templateId 驱动 _pocInstallTemplate。 */
function installButton(templateId: string) {
  const listeners = new Map<string, (...args: any[]) => any>();
  return {
    dataset: { templateId },
    disabled: false,
    listeners,
    addEventListener(event: string, handler: (...args: any[]) => any) { listeners.set(event, handler); },
    setAttribute() {},
    removeAttribute() {},
    getAttribute(name: string) { return name === 'data-template-id' ? templateId : null; },
  };
}

/** 导航行按钮（data-poc-nav="template-library" → _pocOpenTemplateLibrary）。 */
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

function loadPersonalOntology(
  invoke: any,
  options: { withConfirmDanger?: boolean; confirmDangerResult?: boolean; confirmResult?: boolean } = {},
) {
  const installBtn = installButton('student');
  const libraryBtn = clickTarget({ 'data-poc-nav': 'template-library' });
  const elements = new Map([
    ['personal-onto-nav', makeElement('personal-onto-nav', { qs: new Map([['[data-poc-nav]', []]]) })],
    ['personal-onto-main-header', makeElement('personal-onto-main-header')],
    ['personal-onto-main-body', makeElement('personal-onto-main-body', { qs: new Map([['[data-poc-nav]', [libraryBtn]]]) })],
    ['personal-onto-modal', makeElement('personal-onto-modal')],
    ['personal-onto-modal-body', makeElement('personal-onto-modal-body')],
    ['personal-onto-template-library-list', makeElement('personal-onto-template-library-list')],
    ['personal-onto-template-library-detail', makeElement('personal-onto-template-library-detail', { qs: new Map([['.personal-onto-library-install', [installBtn]]]) })],
  ]);
  const uiToast = vi.fn();
  const uiAlert = vi.fn();
  const uiConfirm = vi.fn(async () => (options.confirmResult == null ? true : options.confirmResult));
  const sandbox: any = {
    console: { log() {}, warn() {}, error() {} },
    CSS: { escape: (value: string) => String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&') },
    document: {
      getElementById: (id: string) => elements.get(id) || null,
      querySelector: () => null,
      addEventListener: () => {},
      activeElement: null,
    },
    t: (key: string) => key, // 透传：_t 命中「词条缺失」路径，fallback（含错误详情）成为展示文本
    uiToast,
    uiAlert,
    uiConfirm,
    uiModal: vi.fn(async () => ({ value: 'save' })),
    uiInput: (o: any) => `<input id="${String(o && o.id || '')}">`,
    uiTextarea: (o: any) => `<textarea id="${String(o && o.id || '')}"></textarea>`,
    cogseed: { invoke },
  };
  if (options.withConfirmDanger) {
    sandbox.uiConfirmDanger = vi.fn(async () => (options.confirmDangerResult == null ? true : options.confirmDangerResult));
  }
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const file of ['modules/icons.js', 'modules/ui-button.js', 'modules/ui-card.js', 'modules/ui-form.js', 'modules/ui-empty.js', 'modules/ui-status.js']) {
    vm.runInContext(readFileSync(resolve(root, 'src/renderer', file), 'utf8'), sandbox, { filename: file });
  }
  vm.runInContext(ontology, sandbox, { filename: 'personal-ontology.js' });
  return { sandbox, uiToast, uiAlert, uiConfirm, installBtn, libraryBtn };
}

async function settle() {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 10));
}

async function boot(invoke: any, options: Parameters<typeof loadPersonalOntology>[1] = {}) {
  const loaded = loadPersonalOntology(invoke, options);
  await loaded.sandbox.renderPersonalOntology();
  await settle();
  const openHandler = loaded.libraryBtn.listeners.get('click');
  expect(openHandler).toBeTypeOf('function');
  await openHandler({ stopPropagation() {} }); // 打开模板库 → 绑定安装按钮
  await settle();
  return loaded;
}

async function clickInstall(loaded: ReturnType<typeof loadPersonalOntology>) {
  const handler = loaded.installBtn.listeners.get('click');
  expect(handler).toBeTypeOf('function');
  await handler({ stopPropagation() {} });
  await settle();
}

function countChannel(invoke: any, channel: string) {
  return invoke.mock.calls.filter(([ch]: [string]) => ch === channel).length;
}

describe('个人本体 › 模板重装归档探测失败一律报错中止（P-r1-63/P-r2-28/P-r3-21）', () => {
  it('P-r1-63 主案：hasArchive 返回 {ok:false} → 不发 install，报错写明数据未损与恢复途径', async () => {
    const invoke = makeInvoke({
      'personalOntology.templates.hasArchive': { ok: false, error: 'db locked' },
    });
    const loaded = await boot(invoke);
    await clickInstall(loaded);

    expect(countChannel(invoke, 'personalOntology.templates.install')).toBe(0);
    expect(loaded.uiAlert).toHaveBeenCalledTimes(1);
    const message = String(loaded.uiAlert.mock.calls[0][0]);
    expect(message).toContain('模板安装失败');
    expect(message).toContain('无法确认该模板的归档数据');
    expect(message).toContain('数据没有丢失'); // 卡口径：错误信息写明数据未损
    expect(message).toContain('恢复原数据'); // 卡口径：写明恢复途径
    expect(message).toContain('db locked'); // 底层错误原样带回
  });

  it('P-r1-63 异常面：hasArchive 通道抛错（_pocInvoke 归一成 ok:false）→ 同样中止不装', async () => {
    const invoke = makeInvoke({
      'personalOntology.templates.hasArchive': () => { throw new Error('ipc bridge gone'); },
    });
    const loaded = await boot(invoke);
    await clickInstall(loaded);

    expect(countChannel(invoke, 'personalOntology.templates.install')).toBe(0);
    expect(loaded.uiAlert).toHaveBeenCalledTimes(1);
    expect(String(loaded.uiAlert.mock.calls[0][0])).toContain('ipc bridge gone');
  });

  it('P-r2-28 组件缺失分支：有归档但 uiConfirmDanger 不可用 → 中止，不再默认重建空模板', async () => {
    const invoke = makeInvoke({
      // 成功形状（无 ok 字段）且确有归档——修前走 else { restoreData = false } 静默重建。
      'personalOntology.templates.hasArchive': { hasArchive: true, hasMemoryArchive: false },
    });
    const loaded = await boot(invoke); // harness 默认不提供 uiConfirmDanger
    await clickInstall(loaded);

    expect(countChannel(invoke, 'personalOntology.templates.install')).toBe(0);
    expect(loaded.uiAlert).toHaveBeenCalledTimes(1);
    expect(String(loaded.uiAlert.mock.calls[0][0])).toContain('数据没有丢失');
  });

  it('对照组 A：探测成功且无归档 → 正常直装空模板（restoreData:false）', async () => {
    const invoke = makeInvoke({
      'personalOntology.templates.hasArchive': { hasArchive: false, hasMemoryArchive: false },
    });
    const loaded = await boot(invoke, { withConfirmDanger: true });
    await clickInstall(loaded);

    expect(countChannel(invoke, 'personalOntology.templates.install')).toBe(1);
    const payload = invoke.mock.calls.find(([ch]: [string]) => ch === 'personalOntology.templates.install')?.[1];
    expect(payload && payload.restoreData).toBe(false);
    expect(loaded.uiAlert).not.toHaveBeenCalled();
  });

  it('对照组 B：探测成功有归档 + 用户选「恢复原数据」→ install 带 restoreData:true（恢复流不回归）', async () => {
    const invoke = makeInvoke({
      'personalOntology.templates.hasArchive': { hasArchive: true, hasMemoryArchive: false },
    });
    const loaded = await boot(invoke, { withConfirmDanger: true, confirmDangerResult: true });
    await clickInstall(loaded);

    expect(countChannel(invoke, 'personalOntology.templates.install')).toBe(1);
    const payload = invoke.mock.calls.find(([ch]: [string]) => ch === 'personalOntology.templates.install')?.[1];
    expect(payload && payload.restoreData).toBe(true);
    expect(loaded.uiAlert).not.toHaveBeenCalled();
  });

  it('对照组 C：有归档 + 用户两次都取消 → 不安装也不报错（用户主动放弃，非故障）', async () => {
    const invoke = makeInvoke({
      'personalOntology.templates.hasArchive': { hasArchive: true, hasMemoryArchive: false },
    });
    const loaded = await boot(invoke, { withConfirmDanger: true, confirmDangerResult: false, confirmResult: false });
    await clickInstall(loaded);

    expect(countChannel(invoke, 'personalOntology.templates.install')).toBe(0);
    expect(loaded.uiAlert).not.toHaveBeenCalled();
  });
});
