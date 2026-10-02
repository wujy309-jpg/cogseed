import { describe, expect, it } from 'vitest';

/**
 * claim 处置后的 sibling 僵尸行（P-r3-6，预审决策卡组 6「处置后条件重拉」）。
 *
 * conflict: 选边（claim）成功时，主进程在锁内把同组 sibling 候选逐一 reject
 * （resolveCognitionInboxItem 的「先拒其余、再晋升」顺序）；渲染层的就地
 * 删行只删得掉本行——sibling 行变成「盘上已 rejected、界面仍可处置」的
 * 僵尸行（二次点击撞终态守卫）。修法（重拉条件扩展，最小案）：conflict:+claim
 * 与 inspection: 同款，处置成功后显式重拉一次 inbox 区块；不扩
 * COLLECTION_BLOCKS 的 candidates 映射（避免高频广播成本）。
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
    actions: {
      resolveInboxItem: (id: string, action: string, params?: Record<string, unknown>) => Promise<void>;
    };
  };
})();

async function settle() {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 10));
}

describe('组6：claim 处置后条件重拉（P-r3-6）', () => {
  it('conflict:claim 成功后重拉 inbox 区块——sibling 僵尸行被清掉，界面回到盘上真相', async () => {
    // 重拉后的最新清单：只剩一条别的待办（sibling c2 在盘上已 rejected，不再出现）。
    invokeImpl = async (channel) => (channel === 'cognition.inbox.list'
      ? { ok: true, items: [{ id: 'cleanup:r1:a9', urgency: 'defer' }] }
      : { ok: true });
    NS.store.inbox = [{ id: 'conflict:c1' }, { id: 'conflict:c2' }];
    NS.store.inboxGroups = null;
    ipcCounts.delete('cognition.inbox.list');
    await NS.actions.resolveInboxItem('conflict:c1', 'claim');
    await settle();
    expect(count('cognition.inbox.list')).toBe(1); // 修前：claim 不在重拉条件里，恒为 0
    expect(NS.store.inbox).toEqual([{ id: 'cleanup:r1:a9', urgency: 'defer' }]); // 修前：残留 [{id:'conflict:c2'}] 僵尸行
  });

  it('conflict: 的 reject/defer 只动本行，不触发 inbox 重拉（最小条件，不扩大重拉面）', async () => {
    invokeImpl = async () => ({ ok: true });
    NS.store.inbox = [{ id: 'conflict:c1' }, { id: 'conflict:c2' }];
    NS.store.inboxGroups = null;
    ipcCounts.delete('cognition.inbox.list');
    await NS.actions.resolveInboxItem('conflict:c2', 'reject');
    await settle();
    expect(count('cognition.inbox.list')).toBe(0);
    expect(NS.store.inbox).toEqual([{ id: 'conflict:c1' }]); // 就地删行照旧
  });

  it('inspection: 前缀维持既有显式重拉（回归守护）', async () => {
    invokeImpl = async (channel) => (channel === 'cognition.inbox.list'
      ? { ok: true, items: [] }
      : { ok: true });
    NS.store.inbox = [{ id: 'inspection:key-1' }];
    NS.store.inboxGroups = null;
    ipcCounts.delete('cognition.inbox.list');
    await NS.actions.resolveInboxItem('inspection:key-1', 'reject');
    await settle();
    expect(count('cognition.inbox.list')).toBe(1);
    expect(NS.store.inbox).toEqual([]);
  });
});
