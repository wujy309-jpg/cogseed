import { describe, expect, it } from 'vitest';

/**
 * 治理待办读取的失败态（F-r3-1，2026-09-30 认知资产质检 R3）：
 *
 * BLOCK_FETCHERS.inbox 此前走 api.soft 兜底 {}——cognition.inbox.list 失败时
 * store.inbox=[]、inboxGroups=null，与「真的没有待办」「加载中」三态同形，
 * 待我处理页把主数据源读失败呈现成「没有需要你确认的事项…系统继续在后台
 * 沉淀」。修法对齐同页 candidates 的 A5 先例（candidatesError）：改 api.call
 * +try/catch，失败显式记 store.inboxError（视图层分区级失败态+重试），成功
 * 清掉标记。与 candidatesError 不同点：治理待办是分区数据源，失败不挡整页。
 *
 * 装配与 cognition-kstar-summaries.test.ts 同构：core.js 是 IIFE，require
 * 一次即挂 window.CogAssets，唯一 IPC 出口是 window.cogseed.invoke。
 */

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

describe('治理待办读取的失败态（BLOCK_FETCHERS.inbox，F-r3-1）', () => {
  it('cognition.inbox.list 失败：置空清单与分组、显式记 inboxError（不再 soft 降级空数组）', async () => {
    invokeImpl = async (channel) => (channel === 'cognition.inbox.list'
      ? { ok: false, error: 'inbox list unavailable', code: 'E_IO' }
      : { ok: true });
    await NS.reload();
    expect(NS.store.inbox).toEqual([]);
    expect(NS.store.inboxGroups).toBe(null);
    expect(String(NS.store.inboxError)).toContain('inbox list unavailable');
    // 同页对照：其他区块不受这次失败影响（A5 分区级语义）。
    expect(NS.store.candidatesError).toBe('');
  });

  it('成功：清单与分组落盘、错误标记清空（失败→重试→自愈不卡死）', async () => {
    invokeImpl = async (channel) => (channel === 'cognition.inbox.list'
      ? { ok: true, items: [{ id: 'candidate:c1', urgency: 'confirm' }], groups: [{ category: 'other', titleKey: 'cognition.inbox_group_other', items: [{ id: 'candidate:c1' }] }] }
      : { ok: true });
    await NS.reload();
    expect(NS.store.inbox).toEqual([{ id: 'candidate:c1', urgency: 'confirm' }]);
    expect(Array.isArray(NS.store.inboxGroups)).toBe(true);
    expect(NS.store.inboxError).toBe('');
  });
});
