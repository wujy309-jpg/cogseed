import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const buttonSource = readFileSync(resolve(__dirname, '../../src/renderer/modules/ui-button.js'), 'utf8');
const formSource = readFileSync(resolve(__dirname, '../../src/renderer/modules/ui-form.js'), 'utf8');
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
    uiAccordion: (options: any) => options.items.map((item: any) => `<details>${item.title}${item.bodyHtml}</details>`).join(''),
  };
  runInNewContext(buttonSource, { window });
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
    expect(html.indexOf('自动确认')).toBeLessThan(html.indexOf('夜间发现模型'));
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
  const invoke = vi.fn(async (channel: string, args: any) => channel === 'auth.listEntries'
    ? { ok: true, entries: [{ provider: 'cp:one', providerLabel: 'One' }, { provider: 'expired', providerLabel: 'Expired', oauthExpired: true, modelAvailable: false }] }
    : { ok: true, models: args.provider === 'cp:one' ? [{ id: 'first', name: 'First', reasoning: true }, { id: 'second', name: 'Second' }] : [{ id: 'gone', name: 'Gone' }] });
  const window = {
    CogAssets: NS, cogseed: { invoke },
    uiButton: (value: any) => `<button data-act="${value.attrs['data-act']}"${value.disabled ? ' disabled' : ''}>${value.label}</button>`,
    uiSelect: (value: any) => `<select id="${value.id}">${value.options.map((item: any) => `<option>${item.label}</option>`).join('')}</select>`,
  };
  runInNewContext(buttonSource, { window });
  runInNewContext(formSource, { window });
  runInNewContext(source, { window });
  NS.actions.updateCaptureSettings.mockImplementation(async (patch: any) => { Object.assign(NS.store.captureSettings, patch); });
  return { NS, policy: NS.assetSettings, invoke, pick: (provider: string, model: string) => ({ querySelector: () => ({ value: JSON.stringify([provider, model]) }) }), el: (index = 0) => ({ dataset: { index: String(index) } }) };
}

describe('夜间模型页面顺序与系统目录', () => {
  it('空配置默认跟随系统，复用系统目录且重复添加不产生重复备用项', async () => {
    const { NS, policy, invoke, pick, el } = modelSettingsHarness();
    expect(policy.modelControls()).toContain('跟随系统模型');
    await policy.loadModels();
    expect(invoke).toHaveBeenCalledWith('auth.listEntries', { includeUnavailable: true });
    expect(policy.modelControls()).toContain('One · First');
    expect(policy.modelControls()).not.toContain('Expired · Gone');
    await policy.modelAction('nightly-model-add', el(), pick('cp:one', 'first'));
    await policy.modelAction('nightly-model-add', el(), pick('cp:one', 'first'));
    await policy.modelAction('nightly-model-add', el(), pick('cp:one', 'second'));
    expect(NS.store.captureSettings.modelCandidates).toEqual([{ provider: 'cp:one', model: 'first' }, { provider: 'cp:one', model: 'second' }]);
    await policy.modelAction('nightly-model-up', el(1), pick('', ''));
    expect(NS.store.captureSettings.modelCandidates[0].model).toBe('second');
    await policy.modelAction('nightly-model-remove', el(1), pick('', ''));
    expect(NS.store.captureSettings.modelCandidates).toHaveLength(1);
    await policy.modelAction('nightly-model-reset', el(), pick('', ''));
    expect(NS.store.captureSettings.modelCandidates).toEqual([]);
  });
  it('已删除模型保留可辨认状态，保存失败与目录失败均不丢顺序且可以重试', async () => {
    const { NS, policy, invoke, pick, el } = modelSettingsHarness();
    NS.store.captureSettings.modelCandidates = [{ provider: 'cp:removed', model: 'saved' }];
    await policy.loadModels();
    expect(policy.modelControls()).toContain('系统配置中已停用或移除');
    NS.actions.updateCaptureSettings.mockRejectedValueOnce(new Error('save failed'));
    await expect(policy.modelAction('nightly-model-reset', el(), pick('', ''))).rejects.toThrow('save failed');
    expect(NS.store.captureSettings.modelCandidates).toEqual([{ provider: 'cp:removed', model: 'saved' }]);
    invoke.mockRejectedValueOnce(new Error('directory offline'));
    await policy.loadModels(true);
    expect(policy.modelControls()).toContain('模型列表读取失败');
    expect(NS.store.captureSettings.modelCandidates[0].model).toBe('saved');
    await policy.modelAction('nightly-model-retry', el(), pick('', ''));
    expect(policy.modelControls()).not.toContain('模型列表读取失败');
    expect(policy.modelControls()).toContain('系统配置中已停用或移除');
  });
});


describe('夜间模型设置与实际配置一致', () => {
  it('显示系统首选，但不把配置首选说成已成功调用的模型', async () => {
    const { NS, policy } = modelSettingsHarness();
    NS.store.captureModel = { provider: 'cp:one', model: 'first', available: false };
    await policy.loadModels();
    const html = policy.modelControls();
    expect(html).toContain('系统首选：One · First');
    expect(html).toContain('跟随系统模型顺序');
    expect(html).not.toContain('调用成功');
    expect(html).toMatch(/<button[^>]*disabled[^>]*data-act="nightly-model-add"/);
  });
  it('保留手输绑定模型，登录过期但可以刷新的配置仍可选择', async () => {
    const { policy, invoke } = modelSettingsHarness();
    invoke.mockImplementation(async (channel: string) => channel === 'auth.listEntries'
      ? { ok: true, entries: [{ provider: 'manual', providerLabel: 'Manual', model: 'custom-id', modelName: 'Custom', oauthExpired: true }] }
      : { ok: true, models: [] });
    await policy.loadModels();
    expect(policy.modelControls()).toContain('Manual · Custom');
    expect(policy.modelControls()).not.toContain('系统配置中已停用或移除');
  });
  it('部分目录失败时保留已绑定模型和重试入口', async () => {
    const { NS, policy, invoke } = modelSettingsHarness();
    NS.store.captureSettings.modelCandidates = [{ provider: 'manual', model: 'custom-id' }];
    invoke.mockImplementation(async (channel: string) => {
      if (channel === 'auth.listEntries') return { ok: true, entries: [{ provider: 'manual', model: 'custom-id' }] };
      throw new Error('offline');
    });
    await policy.loadModels();
    const html = policy.modelControls();
    expect(html).toContain('manual · custom-id');
    expect(html).toContain('部分模型目录未读到');
    expect(html).toContain('nightly-model-retry');
    expect(html).not.toContain('系统配置中已停用或移除');
  });
  it('选择前不能保存，重画保留选择；保存后明确首选与备用顺序', async () => {
    const { NS, policy, pick, el } = modelSettingsHarness();
    await policy.loadModels();
    const add = { disabled: true, classList: { toggle: vi.fn() } };
    policy.modelInput({ target: { id: 'ca-nightly-model-picker', value: JSON.stringify(['cp:one', 'first']) } }, { querySelector: () => add });
    expect(add.disabled).toBe(false);
    expect(add.classList.toggle).toHaveBeenCalledWith('is-disabled', false);
    expect(policy.modelControls()).toContain('selected');
    await policy.modelAction('nightly-model-add', el(), pick('cp:one', 'first'));
    await policy.modelAction('nightly-model-add', el(), pick('cp:one', 'second'));
    const html = policy.modelControls();
    expect(html).toContain('首选模型');
    expect(html).toContain('备用 1');
    expect(html).toMatch(/<button[^>]*disabled[^>]*data-act="nightly-model-add"/);
    expect(NS.actions.updateCaptureSettings).toHaveBeenLastCalledWith({ modelCandidates: [{ provider: 'cp:one', model: 'first' }, { provider: 'cp:one', model: 'second' }] });
  });
});
