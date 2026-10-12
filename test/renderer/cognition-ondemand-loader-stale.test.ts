import { describe, expect, it } from 'vitest';

/**
 * 三个按需 loader 失败静默置空且被缓存判重挡死（P-r1-52，预审决策卡组 7
 * 「loader 失败置 stale」）：loadDeletedAssets / loadInspection /
 * loadCleanupReports 失败时此前写 {loading:false} 不带 stale——守卫
 * `!stale` 判重直接 return，「没读到」永久伪装「没有」。修法（catch 补
 * stale，3 行最小自愈）：失败置 stale=true；巡检/报告同时缓存 failed 防止通知自续，由 force 显式重试；成功
 * stale=false 照常缓存。视图零改动（失败态文案已另批走查）。
 *
 * 装配与 cognition-inbox-error-state.test.ts 同构。
 */

const globalScope = globalThis as unknown as Record<string, unknown>;
type Invoke = (channel: string, payload: Record<string, unknown>) => Promise<unknown>;
let invokeImpl: Invoke = async () => ({ ok: true });
const ipcCounts = new Map<string, number>();
const invoke = (channel: string, payload: Record<string, unknown>) => {
  ipcCounts.set(channel, (ipcCounts.get(channel) || 0) + 1);
  return invokeImpl(channel, payload);
};
const count = (channel: string) => ipcCounts.get(channel) || 0;

const NS = (() => {
  const stub: Record<string, unknown> = {};
  globalScope.window = {
    CogAssets: stub,
    cogseed: { invoke },
  };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../../src/renderer/modules/cognition-assets/core.js');
  return stub as unknown as {
    store: Record<string, unknown>;
    loadInspection: (force?: boolean) => Promise<void>;
    loadCleanupReports: (force?: boolean) => Promise<void>;
    actions: {
      loadDeletedAssets: () => Promise<void>;
    };
  };
})();

async function settle() {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 10));
}

describe('组7：按需 loader 失败置 stale（P-r1-52）', () => {
  it('loadDeletedAssets 失败置 stale，第二次调用自愈重拉；成功后不 stale、缓存判重照旧', async () => {
    invokeImpl = async (channel) => (channel === 'recall.assets.deleted.list'
      ? { ok: false, error: 'deleted list unreadable', code: 'E_IO' }
      : { ok: true });
    NS.store.deletedAssets = null;
    ipcCounts.delete('recall.assets.deleted.list');
    await NS.actions.loadDeletedAssets();
    await settle();
    expect(NS.store.deletedAssets).toMatchObject({ loading: false, stale: true }); // 修前：无 stale 键
    await NS.actions.loadDeletedAssets(); // 修前：守卫 !stale 判重直接 return，IPC 不再发
    await settle();
    expect(count('recall.assets.deleted.list')).toBe(2);
    // 成功路径：stale=false，后续调用走缓存。
    invokeImpl = async () => ({ ok: true, items: [{ id: 'a1' }], total: 1 });
    await NS.actions.loadDeletedAssets();
    await settle();
    expect(NS.store.deletedAssets).toMatchObject({ loading: false, stale: false, total: 1 });
    const settled = count('recall.assets.deleted.list');
    await NS.actions.loadDeletedAssets();
    await settle();
    expect(count('recall.assets.deleted.list')).toBe(settled); // 健康态缓存判重照旧
  });

  it('loadInspection 失败保留未知标记，普通调用不循环，force 可恢复', async () => {
    invokeImpl = async (channel) => ((channel === 'recall.inspection.settings' || channel === 'recall.inspection.list')
      ? { ok: false, error: 'inspection unreadable', code: 'E_IO' }
      : { ok: true });
    NS.store.inspection = null;
    ipcCounts.delete('recall.inspection.settings');
    await NS.loadInspection();
    await settle();
    expect(NS.store.inspection).toMatchObject({ loading: false, stale: true });
    await NS.loadInspection();
    await settle();
    expect(count('recall.inspection.settings')).toBe(1);
    expect(NS.store.inspection).toMatchObject({ failed: true, stale: true });
    invokeImpl = async () => ({ ok: true, settings: { enabled: true }, runs: [{ id: 'run-1' }] });
    await NS.loadInspection(true);
    expect(count('recall.inspection.settings')).toBe(2);
    expect(NS.store.inspection).toMatchObject({ failed: false, stale: false, latestRun: { id: 'run-1' } });
  });

  it('loadCleanupReports 失败保留未知标记，普通调用不循环，force 可恢复', async () => {
    invokeImpl = async (channel) => (channel === 'recall.cleanup.list'
      ? { ok: false, error: 'cleanup reports unreadable', code: 'E_IO' }
      : { ok: true });
    NS.store.cleanupReports = null;
    ipcCounts.delete('recall.cleanup.list');
    await NS.loadCleanupReports();
    await settle();
    expect(NS.store.cleanupReports).toMatchObject({ loading: false, stale: true });
    await NS.loadCleanupReports();
    await settle();
    expect(count('recall.cleanup.list')).toBe(1);
    expect(NS.store.cleanupReports).toMatchObject({ failed: true, stale: true });
    invokeImpl = async () => ({ ok: true, reports: [{ id: 'report-1' }] });
    await NS.loadCleanupReports(true);
    expect(count('recall.cleanup.list')).toBe(2);
    expect(NS.store.cleanupReports).toMatchObject({ failed: false, stale: false, reports: [{ id: 'report-1' }] });
  });
});
