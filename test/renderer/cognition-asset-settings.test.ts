import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const buttonSource = readFileSync(resolve(__dirname, '../../src/renderer/modules/ui-button.js'), 'utf8');
const formSource = readFileSync(resolve(__dirname, '../../src/renderer/modules/ui-form.js'), 'utf8');
const cardSource = readFileSync(resolve(__dirname, '../../src/renderer/modules/ui-card.js'), 'utf8');
const statusSource = readFileSync(resolve(__dirname, '../../src/renderer/modules/ui-status.js'), 'utf8');
const iconSource = readFileSync(resolve(__dirname, '../../src/renderer/modules/icons.js'), 'utf8');
const source = readFileSync(resolve(__dirname, '../../src/renderer/modules/cognition-assets/settings.js'), 'utf8');
function setup(settings = { autoApproval: false }) {
  const confirmUser = vi.fn().mockResolvedValue(true);
  const updateCaptureSettings = vi.fn().mockResolvedValue(undefined);
  const NS: any = {
    T: (_key: string, fallback: string, args: Record<string, string> = {}) => fallback.replace(/\{([^}]+)\}/g, (_match, key) => args[key] ?? `{${key}}`),
    store: { captureSettings: settings, captureCapabilities: { autoApproval: true }, captureModelError: '' },
    confirmUser, alertUser: vi.fn(), notify: vi.fn(), actions: { updateCaptureSettings },
  };
  runInNewContext(source, { window: { CogAssets: NS } });
  return { NS, policy: NS.assetSettings, confirmUser, updateCaptureSettings };
}

describe('资产设置真实状态', () => {
  it('读取失败与从未运行区分；扫描排队不能冒充已发现建议', () => {
    const { policy } = setup();
    expect(policy.discoveryStatus(null).state).toBe('unknown');
    expect(policy.discoveryStatus({ sweep: {} }).state).toBe('never');
    const state = policy.discoveryStatus({ sweep: { lastResult: { finishedAt: '2026-10-11T02:00:00Z', scanned: 4, queued: 3, deferred: 1, failed: 0 } } });
    expect(state).toMatchObject({ state: 'completed', scanned: 4, queued: 3, deferred: 1 });
    expect(state).not.toHaveProperty('suggestions');
    expect(policy.discoveryStatus({ sweep: { lastResult: { error: 'network error', failed: 1 } } }).state).toBe('failed');
    expect(policy.discoveryStatus({ sweep: {} }, 'timeout').state).toBe('unknown');
  });
});

const viewsSource = readFileSync(resolve(__dirname, '../../src/renderer/modules/cognition-assets/views.js'), 'utf8');
function settingsHtml(patch: Record<string, unknown> = {}) {
  const { NS } = setup();
  Object.assign(NS.store, {
    captureModel: { channel: 'cli', available: true }, captureStats: { sweep: {} },
    legacyMemoryMigration: { preview: { items: [], sources: {} } },
    legacyScopedMemoryMigration: { preview: { items: [], sources: [] } },
  }, patch);
  NS.esc = (value: unknown) => String(value ?? '');
  NS.fmtDate = NS.esc;
  const window = {
    CogAssets: NS,
    uiSelect: (options: any) => `<select id="${options.id}"${options.disabled ? ' disabled' : ''}>${options.options.map((item: any) => `<option value='${item.value}'>${item.label}</option>`).join('')}</select>`,
    uiButton: (options: any) => `<button data-act="${options.attrs?.['data-act'] || ''}"${options.disabled ? ' disabled' : ''}>${options.label}</button>`,
    uiSwitch: (options: any) => `<button role="switch" data-act="${options.attrs?.['data-act']}"${options.disabled ? ' disabled' : ''}></button>`,
    uiAccordion: (options: any) => options.items.map((item: any) => `<details${item.open ? ' open' : ''}>${item.title}${item.meta || ''}${item.bodyHtml}</details>`).join(''),
    uiCard: (options: any) => `<section class="${options.className || ''}">${options.bodyHtml || ''}</section>`,
    uiStatusPill: (options: any) => `<span role="status">${options.label}</span>`,
    uiProgressBar: (options: any) => `<div role="progressbar" aria-label="${options.ariaLabel}" aria-valuenow="${options.value}" aria-valuemax="${options.max}"></div>`,
  };
  runInNewContext(iconSource, { window });
  runInNewContext(buttonSource, { window });
  runInNewContext(cardSource, { window });
  runInNewContext(statusSource, { window });
  runInNewContext(formSource, { window });
  runInNewContext(source, { window });
  runInNewContext(viewsSource.replace('NS.render = render;', 'NS.__settingsView = viewOrganizeSettingsPage; NS.render = render;'), { window });
  return NS.__settingsView();
}

describe('资产设置只承接夜间发现', () => {
  it('提供夜间开关和模型顺序，不支持自动确认的运行版本禁用开关', () => {
    const html = settingsHtml({ captureSettings: { enabled: true, nightlyStart: '01:00', nightlyEnd: '05:00' }, captureCapabilities: null,
      cognitionStorageUpgrade: { report: { mode: 'unified', projectionPending: true, errors: [] } },
      legacyMemoryMigration: { preview: { items: [{ id: 'legacy' }], sources: {} } } });
    expect(html).toContain('data-act="nightly-toggle"');
    expect(html).toMatch(/<button[^>]*disabled[^>]*data-act="auto-approval-toggle"/);
    for (const action of ['auto-approval-boundary', 'run-maintenance', 'open-cleanup', 'storage-check', 'storage-recover']) expect(html).not.toContain(`data-act="${action}"`);
    expect(html).toContain('完整建议进入');
    expect(html).not.toContain('旧记忆迁移');
  });
  it('立即扫描入口随夜间发现卡呈现，自动确认卡排在模型卡之前', () => {
    const html = settingsHtml({ captureSettings: { enabled: true } });
    expect(html).toContain('data-act="nightly-scan-now"');
    expect(html.indexOf('夜间发现模型')).toBeLessThan(html.indexOf('自动确认'));
    expect(html).toContain('<details class="settings-model-form__advanced ca-model-fold">');
    expect(settingsHtml({ captureSettings: { enabled: false } }))
      .toMatch(/<button[^>]*disabled[^>]*data-act="nightly-scan-now"/);
    const running = settingsHtml({
      captureSettings: { enabled: true },
      captureStats: { sweep: { lastResult: { finishedAt: '2026-10-14T02:00:00Z', scanned: 2, queued: 0, failed: 0 } }, runtime: { running: true, startedAt: '2026-10-14T02:00:00Z' } },
    });
    expect(running).toContain('扫描中…');
    expect(running).toMatch(/<button[^>]*disabled[^>]*data-act="nightly-scan-now"/);
  });
  it('模型授权未完成和通道不可用也不展示旧配置提醒', () => {
    for (const captureModel of [{ channel: 'unavailable', authorizationRequired: true }, { channel: 'api', configured: false }, { channel: 'cli', available: false }]) {
      const html = settingsHtml({ captureModel });
      for (const text of ['ca-settings-model', '模型状态', '授权', 'API', 'CLI', '去应用设置']) expect(html).not.toContain(text);
      expect(html).toContain('nightly-toggle');
    }
  });
  it('关闭和读取失败如实显示，模型配置提醒彻底下线', () => {
    expect(settingsHtml({ captureSettings: { enabled: false } })).toContain('已暂停');
    const html = settingsHtml({ captureModelError: 'timeout', captureStatsError: 'timeout' });
    for (const text of ['ca-settings-model', '模型状态', '模型未配置', '授权', 'API', 'CLI', '去应用设置']) expect(html).not.toContain(text);
    expect(html).toContain('状态暂时无法读取');
    expect(html).not.toContain('data-act="refresh"');
    expect(html).toMatch(/<button[^>]*disabled[^>]*data-act="nightly-toggle"/);
    const failed = settingsHtml({ captureStats: { sweep: { lastResult: { error: 'interrupted', scanned: 4, queued: 0, failed: 0 } } } });
    expect(failed).toContain('本轮扫描未全部完成');
    expect(failed).not.toContain('失败 0 场');
    expect(failed).not.toContain('data-act="capture-action"');
  });
});

describe('设置不再触发旧迁移或自动批准流程', () => {
  it('进入页面和重复变化只读取已加载的运行状态', () => {
    const { NS } = setup();
    NS.onChange = vi.fn();
    NS.store.route = { name: 'settings' };
    NS.actions.cognitionStorageUpgrade = vi.fn();
    runInNewContext(source, { window: { CogAssets: NS } });
    expect(NS.actions.cognitionStorageUpgrade).not.toHaveBeenCalled();
    expect(NS.actions.updateCaptureSettings).not.toHaveBeenCalled();
  });
});

describe('自动确认设置的真实页面闭环', () => {
  it('默认关闭；只有运行能力明确支持才允许开启，读取失败不伪装为已开启', () => {
    const defaultHtml = settingsHtml();
    expect(defaultHtml).toContain('默认关闭');
    expect(defaultHtml).toMatch(/aria-checked="false"[^>]*data-act="auto-approval-toggle"/);
    expect(defaultHtml).not.toMatch(/disabled[^>]*data-act="auto-approval-toggle"/);
    const missing = settingsHtml({ captureCapabilities: null, captureSettings: { autoApproval: true } });
    expect(missing).toMatch(/aria-checked="false"[^>]*disabled[^>]*data-act="auto-approval-toggle"/);
    expect(missing).toContain('尚不支持自动确认');
    const error = settingsHtml({ captureModelError: 'timeout', captureSettings: { autoApproval: true } });
    expect(error).toMatch(/aria-checked="false"[^>]*disabled[^>]*data-act="auto-approval-toggle"/);
    const enabled = settingsHtml({ captureSettings: { autoApproval: true } });
    expect(enabled).toMatch(/aria-checked="true"[^>]*data-act="auto-approval-toggle"/);
    expect(enabled).toContain('其余完整建议留在');
    expect(enabled).toContain('T 结构变化、冲突和不确定内容仍需人工确认');
  });
  it('开启需说明确认范围，取消不写入，重复点击不会产生两次授权', async () => {
    const { NS, policy, confirmUser, updateCaptureSettings } = setup();
    let approve!: (value: boolean) => void;
    confirmUser.mockImplementationOnce(() => new Promise(resolve => { approve = resolve; }));
    const first = policy.toggleAutoApproval();
    await policy.toggleAutoApproval();
    expect(confirmUser).toHaveBeenCalledOnce();
    expect(confirmUser.mock.calls[0][0]).toContain('T 结构变化');
    expect(updateCaptureSettings).not.toHaveBeenCalled();
    approve(false);
    await first;
    expect(updateCaptureSettings).not.toHaveBeenCalled();
    await policy.toggleAutoApproval();
    expect(updateCaptureSettings).toHaveBeenCalledOnce();
    expect(updateCaptureSettings).toHaveBeenCalledWith({ autoApproval: true });
    expect(NS.store.captureSettings.autoApproval).toBe(false);
  });
  it('关闭直接保存，保存失败维持后端已确认的值并恢复可重试状态', async () => {
    const { NS, policy, confirmUser, updateCaptureSettings } = setup({ autoApproval: true });
    updateCaptureSettings.mockRejectedValueOnce(new Error('disk unavailable'));
    await expect(policy.toggleAutoApproval()).rejects.toThrow('disk unavailable');
    expect(NS.store.captureSettings.autoApproval).toBe(true);
    expect(confirmUser).not.toHaveBeenCalled();
    await policy.toggleAutoApproval();
    expect(updateCaptureSettings).toHaveBeenLastCalledWith({ autoApproval: false });
    expect(updateCaptureSettings).toHaveBeenCalledTimes(2);
  });
  it('后端没有返回所请求的设置时不冒充保存成功', async () => {
    const { loadCognitionAssets } = await import('./helpers/cognition-renderer');
    const invoke = vi.fn().mockResolvedValue({ ok: true, settings: { autoApproval: false } });
    const toast = vi.fn();
    const loaded = loadCognitionAssets({ captureSettings: { autoApproval: false } }, {}, { cogseed: { invoke }, uiToast: toast });
    await expect(loaded.ns.actions.updateCaptureSettings({ autoApproval: true })).rejects.toThrow('有效保存结果');
    expect(loaded.store.captureSettings.autoApproval).toBe(false);
    expect(toast).not.toHaveBeenCalled();
  });
});

function modelSettingsHarness() {
  const { NS } = setup({ enabled: true, modelCandidates: [] } as any);
  NS.store.route = { name: 'settings' };
  NS.esc = (value: unknown) => String(value ?? '');
  let models = [
    { provider: 'cp:one', model: 'first', label: 'One · First', available: true, configured: true },
    { provider: 'cp:one', model: 'second', label: 'One · Second', available: true, configured: true },
    { provider: 'expired', model: 'gone', label: 'Expired · Gone', available: false, configured: true },
  ];
  const invoke = vi.fn(async () => ({ ok: true, modelSelection: { configured: models } }));
  let modal: any;
  const focus = vi.fn();
  const root = { querySelector: () => ({ focus }) };
  const events: Record<string, () => void> = {};
  const window = {
    CogAssets: NS, cogseed: { invoke },
    addEventListener: (name: string, handler: () => void) => { events[name] = handler; },
    uiModal: vi.fn((options: any) => {
      let resolveModal: (value: unknown) => void;
      const body = { innerHTML: options.bodyHtml };
      const heading = { textContent: '' };
      const close = { setAttribute: vi.fn() };
      let onClick: (event: any) => Promise<void>;
      const dialog = {
        querySelector: (selector: string) => selector === '.ui-modal__body' ? body : selector === '.ui-modal__title' ? heading : selector === '[data-ui-modal-close]' ? close : null,
        querySelectorAll: () => [],
        addEventListener: (_name: string, handler: any) => { onClick = handler; }, removeEventListener: vi.fn(), focus: vi.fn(),
      };
      modal = Object.assign(new Promise(resolve => { resolveModal = resolve; }), {
        dialog, body, options, close: vi.fn(() => resolveModal(null)),
        choose: (provider: string, model: string, disabled = false) => onClick({ target: { closest: () => ({ dataset: { modelKey: JSON.stringify([provider, model]) }, disabled }) } }),
      });
      return modal;
    }),
  };
  runInNewContext(iconSource, { window });
  runInNewContext(buttonSource, { window });
  runInNewContext(cardSource, { window });
  runInNewContext(statusSource, { window });
  runInNewContext(source, { window });
  NS.actions.updateCaptureSettings.mockImplementation(async (patch: any) => { Object.assign(NS.store.captureSettings, patch); });
  return { NS, policy: NS.assetSettings, invoke, root, focus, events,
    models: () => models, setModels: (next: typeof models) => { models = next; },
    modal: () => modal,
    open: () => NS.assetSettings.modelAction('nightly-model-add', { dataset: {} }, root),
    act: (action: string, index = 0) => NS.assetSettings.modelAction(action, { dataset: { index: String(index) } }, root),
  };
}

describe('夜间模型条目与选择弹窗', () => {
  it('默认只显示首个模型及末尾添加行；弹窗只使用后端配置列表', async () => {
    const h = modelSettingsHarness();
    await h.policy.loadModels();
    const html = h.policy.modelControls();
    expect(h.invoke).toHaveBeenCalledExactlyOnceWith('recall.captures.settings.get', {});
    expect(html).toContain('跟随系统首个模型');
    expect(html).toContain('One · First');
    expect(html).not.toContain('One · Second');
    expect(html).not.toContain('Expired · Gone');
    expect(html.indexOf('添加模型')).toBeGreaterThan(html.indexOf('One · First'));
    expect(html).not.toContain('<select');
    expect(html).not.toContain('设为首选模型');
    for (const act of ['nightly-model-up', 'nightly-model-down', 'nightly-model-remove', 'nightly-model-reset']) expect(html).not.toContain(`data-act="${act}"`);
    const opened = h.open();
    expect(h.modal().body.innerHTML).toContain('已添加');
    expect(h.modal().body.innerHTML).toContain('One · Second');
    expect(h.modal().body.innerHTML).toContain('系统配置中已停用或移除');
    await h.modal().choose('cp:one', 'first');
    await h.modal().choose('expired', 'gone');
    expect(h.NS.actions.updateCaptureSettings).not.toHaveBeenCalled();
    await h.modal().choose('cp:one', 'second');
    await opened;
    expect(h.NS.store.captureSettings.modelCandidates).toEqual([{ provider: 'cp:one', model: 'first' }, { provider: 'cp:one', model: 'second' }]);
    expect(h.focus).toHaveBeenCalled();
    expect(h.policy.modelControls()).toContain('备用 1');
  });
  it('模型和添加入口使用相同卡片壳，弹窗以独立模型名、供应商和右侧状态呈现', async () => {
    const h = modelSettingsHarness(); await h.policy.loadModels();
    const html = h.policy.modelControls();
    expect(html.match(/class="ui-resource-card[^"\n]*ca-nightly-model-card"/g)).toHaveLength(2);
    expect(html).toContain('class="ca-nightly-model-name">First</strong>');
    expect(html).toContain('class="ca-nightly-model-provider">One</span>');
    expect(html).toContain('从设置中选择已配置的模型');
    const opened = h.open();
    expect(h.modal().options.size).toBe('md');
    const body = h.modal().body.innerHTML;
    expect(body).toContain('ui-status-pill--success');
    expect(body).toContain('已添加');
    expect(body).toContain('class="ca-nightly-model-name">First</strong>');
    const buttons = body.match(/<button[^>]*>/g) || [];
    expect(buttons).toHaveLength(1); // Added and unavailable entries remain readable, without a disabled button wash.
    expect(buttons[0]).toContain('data-model-key=');
    expect(buttons[0]).toContain('second');
    h.modal().close(); await opened;
  });
  it('保存失败保留弹窗及原列表，重试成功；并发点击只保存一次', async () => {
    const h = modelSettingsHarness(); await h.policy.loadModels();
    h.NS.actions.updateCaptureSettings.mockRejectedValueOnce(new Error('disk unavailable'));
    const opened = h.open();
    await h.modal().choose('cp:one', 'second');
    expect(h.modal().body.innerHTML).toContain('未能保存模型列表');
    expect(h.modal().close).not.toHaveBeenCalled();
    expect(h.NS.store.captureSettings.modelCandidates).toEqual([]);
    let finish: () => void;
    h.NS.actions.updateCaptureSettings.mockImplementationOnce(async (patch: any) => {
      await new Promise<void>(resolve => { finish = resolve; });
      Object.assign(h.NS.store.captureSettings, patch);
    });
    const save = h.modal().choose('cp:one', 'second');
    await h.modal().choose('cp:one', 'second');
    expect(h.NS.actions.updateCaptureSettings).toHaveBeenCalledTimes(2);
    expect(h.modal().body.innerHTML).toContain('aria-busy="true"');
    finish!(); await save; await opened;
    expect(h.NS.store.captureSettings.modelCandidates).toHaveLength(2);
  });
  it('默认随系统首个变化，自定义顺序不被刷新覆盖，并可排序、删除及恢复', async () => {
    const h = modelSettingsHarness(); await h.policy.loadModels();
    h.setModels([...h.models()].reverse()); await h.policy.loadModels(true);
    expect(h.policy.modelControls()).toContain('Expired · Gone');
    expect(h.policy.modelControls()).toContain('系统配置中已停用或移除');
    h.NS.store.captureSettings.modelCandidates = [{ provider: 'cp:one', model: 'first' }, { provider: 'cp:one', model: 'second' }];
    await h.policy.loadModels(true);
    expect(h.policy.modelControls()).not.toContain('Expired · Gone');
    await h.act('nightly-model-up', 1);
    expect(h.NS.store.captureSettings.modelCandidates[0].model).toBe('second');
    await h.act('nightly-model-down', 0);
    expect(h.NS.store.captureSettings.modelCandidates[0].model).toBe('first');
    await h.act('nightly-model-remove', 0); await h.act('nightly-model-remove', 0);
    expect(h.NS.store.captureSettings.modelCandidates).toEqual([]);
    expect(h.policy.modelControls()).toContain('Expired · Gone');
  });
  it('旧目录项保留可辨认状态；读取和保存失败都不丢已保存顺序', async () => {
    const h = modelSettingsHarness();
    h.NS.store.captureSettings.modelCandidates = [{ provider: 'removed', model: 'saved' }];
    await h.policy.loadModels();
    expect(h.policy.modelControls()).toContain('已不在设置列表，保留原配置');
    h.NS.actions.updateCaptureSettings.mockRejectedValueOnce(new Error('save failed'));
    await expect(h.act('nightly-model-reset')).rejects.toThrow('save failed');
    h.invoke.mockRejectedValueOnce(new Error('offline')); await h.policy.loadModels(true);
    expect(h.policy.modelControls()).toContain('模型列表读取失败');
    expect(h.NS.store.captureSettings.modelCandidates[0].model).toBe('saved');
    await h.act('nightly-model-retry');
    expect(h.policy.modelControls()).not.toContain('模型列表读取失败');
    await h.act('nightly-model-reset');
    expect(h.NS.store.captureSettings.modelCandidates).toEqual([]);
  });
  it('弹窗打开期间支持语言及模型目录变化，取消不保存', async () => {
    const h = modelSettingsHarness(); await h.policy.loadModels();
    const opened = h.open();
    h.NS.T = (key: string) => key;
    h.events['i18n-change']();
    expect(h.modal().body.innerHTML).toContain('cognition.settings_nightly_model_added');
    h.setModels(h.models().slice(0, 1)); await h.policy.loadModels(true);
    expect(h.modal().body.innerHTML).not.toContain('One · Second');
    h.modal().close(); await opened;
    expect(h.NS.actions.updateCaptureSettings).not.toHaveBeenCalled();
  });
  it('离页修改系统模型后不复用旧快照，较早的目录响应不能覆盖较新的顺序', async () => {
    const h = modelSettingsHarness();
    h.NS.store.captureModelSelection = { configured: h.models().slice(0, 1) };
    h.NS.store.route.name = 'overview';
    h.setModels([h.models()[1]]);
    h.events['cogseed:model-entries-changed']();
    h.NS.store.route.name = 'settings';
    await h.policy.loadModels();
    expect(h.policy.modelControls()).toContain('One · Second');
    expect(h.policy.modelControls()).not.toContain('One · First');
    let finishOld: (value: unknown) => void;
    h.invoke.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }) as any);
    const old = h.policy.loadModels(true);
    await h.policy.loadModels(true);
    finishOld!({ ok: true, modelSelection: { configured: [{ provider: 'stale', model: 'old', label: 'Stale', available: true }] } });
    await old;
    expect(h.policy.modelControls()).toContain('One · Second');
    expect(h.policy.modelControls()).not.toContain('Stale');
  });
  it('无配置时保留真实运行来源，模型列表未确认保存不得冒充成功', async () => {
    const h = modelSettingsHarness(); h.setModels([]); await h.policy.loadModels();
    h.NS.store.captureModel = { channel: 'cli' };
    expect(h.policy.modelControls()).toContain('将使用可用的本地助手');
    h.NS.store.captureModel = { channel: 'api', apiConfigured: true };
    expect(h.policy.modelControls()).toContain('将使用环境变量配置的模型');
    const { loadCognitionAssets } = await import('./helpers/cognition-renderer');
    const invoke = vi.fn().mockResolvedValue({ ok: true, settings: { modelCandidates: [] } });
    const loaded = loadCognitionAssets({ captureSettings: { modelCandidates: [] } }, {}, { cogseed: { invoke } });
    await expect(loaded.ns.actions.updateCaptureSettings({ modelCandidates: [{ provider: 'one', model: 'first' }] })).rejects.toThrow('保存模型列表');
    expect(loaded.store.captureSettings.modelCandidates).toEqual([]);
  });
});
