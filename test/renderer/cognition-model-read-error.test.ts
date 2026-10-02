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

  it('视图侧接线：读取失败不再渲染「还没配置模型 + 去应用设置」的错误指引（源级钉死）', () => {
    // 修前：modelNeedsAttention = !model || !model.configured || ... —— 读失败
    //（captureModel=null）与未配置同形，直接吃 missing 文案与 go-configure-model。
    expect(viewsSource).toContain('const modelReadFailed = Boolean(S.captureModelError)');
    expect(viewsSource).toContain('modelNeedsAttention = !modelReadFailed && (!model || !model.configured || model.authorizationRequired)');
    // 失败分支：错误态文案 + 既有 refresh 重试动作；未配置分支保留原文案与去设置入口。
    expect(viewsSource).toContain("T('cognition.model_state_read_failed'");
    expect(viewsSource).toContain("'refresh'");
    expect(viewsSource).toContain("T('cognition.model_state_missing'");
    expect(viewsSource).toContain("'go-configure-model'");
  });
});
