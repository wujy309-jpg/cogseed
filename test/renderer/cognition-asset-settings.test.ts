import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { loadCognitionAssets } from './helpers/cognition-renderer';

const source = readFileSync(resolve(__dirname, '../../src/renderer/modules/cognition-assets/settings.js'), 'utf8');
function setup(settings = { autoApproval: false }) {
  const confirmUser = vi.fn().mockResolvedValue(true);
  const updateCaptureSettings = vi.fn().mockResolvedValue(undefined);
  const NS: any = {
    T: (_key: string, fallback: string) => fallback,
    store: { captureSettings: settings, captureCapabilities: { autoApproval: true }, captureModelError: '' },
    confirmUser, alertUser: vi.fn(), notify: vi.fn(), actions: { updateCaptureSettings },
  };
  runInNewContext(source, { window: { CogAssets: NS } });
  return { NS, policy: NS.assetSettings, confirmUser, updateCaptureSettings };
}

describe('资产设置真实状态', () => {
  it('未知状态不误报通道不可用，CLI 回退可用时不要求配置 API', () => {
    const { policy } = setup();
    expect(policy.modelStatus({ configured: false, channel: 'cli', cliAvailable: true })).toBe('cli');
    expect(policy.modelStatus({ channel: 'api', runtimeStatus: 'unknown' })).toBe('unknown');
    expect(policy.modelStatus(null, 'read_failed')).toBe('unknown');
    expect(policy.modelStatus({ configured: false })).toBe('unknown');
    expect(policy.modelStatus({ runtimeStatus: 'legacy', apiConfigured: true })).toBe('configured');
    expect(policy.modelStatus({ runtimeStatus: 'legacy', apiConfigured: true, authorizationRequired: true })).toBe('authorization');
    expect(policy.modelStatus({ channel: 'unavailable' })).toBe('unavailable');
    expect(policy.modelStatus({ channel: 'unavailable', authorizationRequired: true })).toBe('authorization');
  });

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

describe('自动批准授权', () => {
  it('旧后端即使返回了同名设置，也必须明确声明支持后才允许确认开启', async () => {
    const { policy, NS, confirmUser, updateCaptureSettings } = setup();
    NS.store.captureCapabilities = null;
    await policy.toggleAutoApproval();
    expect(confirmUser).not.toHaveBeenCalled();
    expect(updateCaptureSettings).not.toHaveBeenCalled();
    expect(NS.alertUser.mock.calls[0][0]).toContain('完全退出并重新打开');
    NS.store.captureCapabilities = { autoApproval: true };
    await policy.toggleAutoApproval();
    expect(updateCaptureSettings).toHaveBeenCalledExactlyOnceWith({ autoApproval: true });
  });

  it('后端忽略设置或未提供批准凭据时，不显示保存成功或修改本地状态', async () => {
    let saved: Record<string, unknown> = { autoApproval: false };
    const toast = vi.fn();
    const fixture = loadCognitionAssets({ captureSettings: { autoApproval: false } }, { name: 'settings' }, {
      cogseed: { invoke: async () => ({ ok: true, settings: saved }) }, uiToast: toast,
    });
    fixture.ns.reload = vi.fn();
    await expect(fixture.ns.actions.updateCaptureSettings({ autoApproval: true })).rejects.toThrow('有效保存结果');
    saved = { autoApproval: true };
    await expect(fixture.ns.actions.updateCaptureSettings({ autoApproval: true })).rejects.toThrow('有效保存结果');
    expect(fixture.store.captureSettings.autoApproval).toBe(false);
    expect(toast).not.toHaveBeenCalled();
    expect(fixture.ns.reload).not.toHaveBeenCalled();
    saved = { autoApproval: true, autoApprovalEpoch: 'new-policy', autoApprovalEnabledAt: '2026-10-11T03:20:00.000Z' };
    await fixture.ns.actions.updateCaptureSettings({ autoApproval: true });
    expect(fixture.store.captureSettings).toEqual(saved);
    expect(fixture.ns.reload).toHaveBeenCalledOnce();
  });

  it('开启必须确认，且只更新独立批准策略', async () => {
    const { policy, confirmUser, updateCaptureSettings } = setup();
    await policy.toggleAutoApproval();
    expect(confirmUser).toHaveBeenCalledOnce();
    expect(confirmUser.mock.calls[0][0]).toContain('当前积压不会被批量批准');
    expect(updateCaptureSettings).toHaveBeenCalledExactlyOnceWith({ autoApproval: true });
  });

  it('取消授权和读取失败都不保存', async () => {
    const { policy, confirmUser, updateCaptureSettings, NS } = setup();
    confirmUser.mockResolvedValue(false);
    await policy.toggleAutoApproval();
    NS.store.captureModelError = 'failed';
    await policy.toggleAutoApproval();
    expect(updateCaptureSettings).not.toHaveBeenCalled();
    expect(NS.store.autoApprovalSaving).toBe(false);
  });

  it('关闭立即停止后续自动批准，无需再次确认', async () => {
    const { policy, confirmUser, updateCaptureSettings } = setup({ autoApproval: true });
    await policy.toggleAutoApproval();
    expect(confirmUser).not.toHaveBeenCalled();
    expect(updateCaptureSettings).toHaveBeenCalledExactlyOnceWith({ autoApproval: false });
  });

  it('保存失败不篡改策略，恢复交互并允许重试', async () => {
    const { policy, updateCaptureSettings, NS } = setup();
    updateCaptureSettings.mockRejectedValueOnce(new Error('offline'));
    await expect(policy.toggleAutoApproval()).rejects.toThrow('offline');
    expect(NS.store.captureSettings.autoApproval).toBe(false);
    expect(NS.store.autoApprovalSaving).toBe(false);
    await policy.toggleAutoApproval();
    expect(updateCaptureSettings).toHaveBeenCalledTimes(2);
  });

  it('确认未完成时阻止重复开启', async () => {
    const { policy, confirmUser, updateCaptureSettings } = setup();
    let resolveConfirmation!: (value: boolean) => void;
    confirmUser.mockImplementation(() => new Promise(resolve => { resolveConfirmation = resolve; }));
    const first = policy.toggleAutoApproval();
    await policy.toggleAutoApproval();
    resolveConfirmation(true);
    await first;
    expect(confirmUser).toHaveBeenCalledOnce();
    expect(updateCaptureSettings).toHaveBeenCalledOnce();
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
    uiButton: (options: any) => `<button data-act="${options.attrs?.['data-act'] || ''}">${options.label}</button>`,
    uiSwitch: (options: any) => `<button role="switch" data-act="${options.attrs?.['data-act']}"${options.disabled ? ' disabled' : ''}></button>`,
    uiAccordion: (options: any) => options.items.map((item: any) => `<details>${item.title}${item.bodyHtml}</details>`).join(''),
  };
  runInNewContext(viewsSource.replace('NS.render = render;', 'NS.__settingsView = viewOrganizeSettingsPage; NS.render = render;'), { window });
  return NS.__settingsView();
}

describe('资产设置条件入口', () => {
  it('旧后端禁用自动批准并明确要求重启，不影响夜间发现开关', () => {
    const html = settingsHtml({ captureCapabilities: null });
    expect(html).toContain('重启后可用');
    expect(html).toContain('data-act="auto-approval-toggle" disabled');
    expect(html).not.toContain('data-act="nightly-toggle" disabled');
  });
  it('健康或尚未检测时隐藏维护迁移，CLI 可用时无错误指引', () => {
    const html = settingsHtml();
    expect(html).not.toContain('ca-settings-model');
    expect(html).not.toContain('data-act="go-configure-model"');
    expect(html).not.toContain('data-act="storage-check"');
    expect(html).not.toContain('旧记忆迁移');
    const unloaded = settingsHtml({ legacyMemoryMigration: null, legacyScopedMemoryMigration: null });
    expect(unloaded).not.toContain('旧记忆迁移');
  });

  it('底层发现总开关关闭时不把 nightly 策略误报为允许', () => {
    const html = settingsHtml({ captureSettings: { enabled: false, executionPolicy: 'nightly' } });
    expect(html).toContain('已暂停');
    expect(html).not.toContain('<span class="note">允许</span>');
  });

  it('未知模型状态如实说明，重试入口可用', () => {
    const html = settingsHtml({ captureModelError: 'timeout', captureStatsError: 'timeout' });
    expect(html).toContain('这不代表模型未配置');
    expect(html).toContain('状态暂时无法读取');
    expect(html).toContain('data-act="refresh"');
    expect(html).toContain('data-act="nightly-toggle" disabled');
  });

  it('正常兼容与统一存储可按需维护，不能仅凭存储模式标为问题', () => {
    for (const mode of ['mirror', 'unified']) {
      const html = settingsHtml({ cognitionStorageUpgrade: { report: { mode, errors: [] } } });
      expect(html).not.toContain('ca-settings-tools');
      expect(html).not.toContain('检测到数据问题');
      expect(html).not.toContain('需要处理');
    }
    expect(settingsHtml({ cognitionStorageUpgrade: { report: { mode: 'unified', projectionPending: true, errors: [] } } })).toContain('data-act="storage-recover"');
  });

  it('旧主进程已读取配置时不伪造通道可用，也不提示读取失败', () => {
    const html = settingsHtml({ captureModel: { runtimeStatus: 'legacy', apiConfigured: true } });
    expect(html).not.toContain('ca-settings-model');
    expect(html).not.toContain('CLI 回退可用');
    expect(html).not.toContain('CLI 回退可用');
    expect(html).not.toContain('这不代表模型未配置');
  });

  it('扫描异常但尚未记录单场失败时，说明未完成且不呈现失败0场', () => {
    const html = settingsHtml({ captureStats: { sweep: { lastResult: { error: 'interrupted', scanned: 4, queued: 0, failed: 0 } } } });
    expect(html).toContain('本轮扫描未全部完成');
    expect(html).not.toContain('失败 0 场');
  });
});

describe('设置存储检测生命周期', () => {
  it('仅首次进入设置执行只读检查，失败 notify 和重复切页不形成循环', async () => {
    const { NS } = setup();
    let listener!: () => void;
    NS.onChange = (fn: () => void) => { listener = fn; };
    NS.store.route = { name: 'overview' };
    NS.actions.cognitionStorageUpgrade = vi.fn(async (action: string) => {
      expect(action).toBe('check');
      NS.store.cognitionStorageUpgrade = { failed: true };
      listener();
    });
    runInNewContext(source, { window: { CogAssets: NS } });
    expect(NS.actions.cognitionStorageUpgrade).not.toHaveBeenCalled();
    NS.store.route.name = 'settings';
    listener();
    listener();
    NS.store.route.name = 'overview'; listener();
    NS.store.route.name = 'settings'; listener();
    expect(NS.actions.cognitionStorageUpgrade).toHaveBeenCalledOnce();
  });
});
