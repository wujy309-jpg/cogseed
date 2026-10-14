import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 模型主快照读失败伪装（P-r3-25，预审决策卡组 7）：settings 区块此前走
 * api.soft 兜底 {}，captureModel=null 被资产设置页当成「还没配置模型」，
 * 配上「去应用设置」的错误指引——读不到 ≠ 未配置。修法（loader 改
 * api.call + 分区级错误标记，对齐 candidatesError/inboxError 的 A5 先例）：
 * 失败记 store.captureModelError、视图按读取失败如实呈现；settings 半边
 * 经复核实测不触发（兜底 {} truthy、整理页 warn 不出现），故失败时
 * store 形状与旧行为保持一致（captureSettings={}、errors 照记）。
 *
 * 装配与 cognition-inbox-error-state.test.ts 同构。
 */

const rootDir = resolve(__dirname, '../..');
const viewsSource = readFileSync(resolve(rootDir, 'src/renderer/modules/cognition-assets/views.js'), 'utf8');

const globalScope = globalThis as unknown as Record<string, unknown>;
type Invoke = (channel: string, payload: Record<string, unknown>) => Promise<unknown>;
let invokeImpl: Invoke = async () => ({ ok: true });

const NS = (() => {
  const stub: Record<string, unknown> = {};
  globalScope.window = {
    CogAssets: stub,
    cogseed: { invoke: (channel: string, payload: Record<string, unknown>) => invokeImpl(channel, payload) },
  };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../../src/renderer/modules/cognition-assets/core.js');
  return stub as unknown as {
    store: Record<string, unknown>;
    reload: () => Promise<void>;
  };
})();

describe('组7：模型主快照读失败的分区错误标记（P-r3-25）', () => {
  it('settings.get 失败：captureModelError 落标记；captureSettings/captureModel 形状与旧行为一致、errors 照记', async () => {
    invokeImpl = async (channel) => (channel === 'recall.captures.settings.get'
      ? { ok: false, error: 'settings unreadable', code: 'E_IO' }
      : { ok: true });
    await NS.reload();
    expect(String(NS.store.captureModelError || '')).not.toBe(''); // 修前：无此标记，null 被当「未配置」
    expect(NS.store.captureSettings).toEqual({}); // 与 api.soft 兜底 {} 的旧行为一致（整理页 warn 不出现）
    expect(NS.store.captureModel).toBe(null);
    expect((NS.store.errors as Array<{ channel: string }>).some((entry) => entry.channel === 'recall.captures.settings.get')).toBe(true);
  });

  it('settings.get 成功：标记清空、模型照常落盘（失败→重试→自愈不卡死）', async () => {
    invokeImpl = async (channel) => (channel === 'recall.captures.settings.get'
      ? { ok: true, settings: { executionPolicy: 'nightly' }, model: { configured: true, authorizationRequired: false } }
      : { ok: true });
    await NS.reload();
    expect(NS.store.captureModelError).toBe('');
    expect(NS.store.captureModel).toMatchObject({ configured: true });
    expect(NS.store.captureSettings).toMatchObject({ executionPolicy: 'nightly' });
  });

  it('热重载读取旧主进程快照时保留已证明的 API 配置与授权状态', async () => {
    invokeImpl = async channel => channel === 'recall.captures.settings.get'
      ? { ok: true, settings: { executionPolicy: 'nightly' }, model: { configured: true, authorizationRequired: false } }
      : { ok: true };
    await NS.reload();
    expect(NS.store.captureModelError).toBe('');
    expect(NS.store.captureModel).toMatchObject({ runtimeStatus: 'legacy', apiConfigured: true, available: undefined });
    expect((NS.store.captureModel as Record<string, unknown>).channel).toBeUndefined();
    invokeImpl = async channel => channel === 'recall.captures.settings.get'
      ? { ok: true, settings: {}, model: { configured: true, authorizationRequired: true } }
      : { ok: true };
    await NS.reload();
    expect(NS.store.captureModel).toMatchObject({ channel: 'unavailable', authorizationRequired: true, available: false });
  });

  it('旧主进程未配置 API 不能证明 CLI 不可用，显式 unknown 也不能被配置标记覆盖', async () => {
    invokeImpl = async channel => channel === 'recall.captures.settings.get'
      ? { ok: true, settings: {}, model: { configured: false, authorizationRequired: false } }
      : { ok: true };
    await NS.reload();
    expect(NS.store.captureModel).not.toHaveProperty('channel');
    invokeImpl = async channel => channel === 'recall.captures.settings.get'
      ? { ok: true, settings: {}, model: { configured: true, authorizationRequired: false, runtimeStatus: 'unknown', runtimeError: 'profile read failed' } }
      : { ok: true };
    await NS.reload();
    expect(NS.store.captureModel).toMatchObject({ runtimeStatus: 'unknown', runtimeError: 'profile read failed' });
    expect(NS.store.captureModel).not.toHaveProperty('channel');
  });

  it('视图不再消费模型配置提醒，读取失败仍保持设置未知', () => {
    expect(viewsSource).not.toContain('NS.assetSettings.modelStatus');
    expect(viewsSource).not.toContain('ca-settings-model');
    expect(viewsSource).not.toContain("'cognition.settings_channel_unknown'");
    expect(viewsSource).not.toContain("'cognition.settings_channel_unavailable'");
    expect(viewsSource).toContain('const stateUnknown = Boolean(S.captureModelError) || !S.captureSettings');
  });
});
