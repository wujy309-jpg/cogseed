import { describe, expect, it } from 'vitest';

/**
 * 形成建议读取的失败态（F-r3-1，2026-09-30 认知资产质检 R3）：
 *
 * BLOCK_FETCHERS.candidates 此前走 api.soft 兜底 {}——recall.candidates.list 失败时
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
const readableEmptyList = (channel: string) => {
  if (channel === 'recall.candidates.list') return { ok: true, candidates: [] };
  if (channel === 'personalOntology.candidates.list') return { ok: true, candidate_updates: [] };
  if (channel === 'recall.captures.list') return { ok: true, captures: [], counts: {} };
  if (channel === 'recall.assets.list') return { ok: true, assets: [] };
  return { ok: true };
};

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

describe('形成建议读取的失败态（BLOCK_FETCHERS.candidates，F-r3-1）', () => {
  it('recall.candidates.list 失败：置空清单与分组、显式记 inboxError（不再 soft 降级空数组）', async () => {
    invokeImpl = async (channel) => (channel === 'recall.candidates.list'
      ? { ok: false, error: 'inbox list unavailable', code: 'E_IO' }
      : readableEmptyList(channel));
    await NS.reload();
    expect(NS.store.candidates).toEqual([]);
    expect(NS.store.inboxGroups).toBeUndefined();
    expect(String(NS.store.candidatesError)).toContain('inbox list unavailable');
    // 同页对照：其他区块不受这次失败影响（A5 分区级语义）。
    expect(NS.store.assetsError).toBe('');
  });

  it('成功：清单与分组落盘、错误标记清空（失败→重试→自愈不卡死）', async () => {
    invokeImpl = async (channel) => (channel === 'recall.candidates.list'
      ? { ok: true, candidates: [{ id: 'candidate:c1', urgency: 'confirm' }], groups: [{ category: 'other', titleKey: 'cognition.inbox_group_other', candidates: [{ id: 'candidate:c1' }] }] }
      : readableEmptyList(channel));
    await NS.reload();
    expect(NS.store.candidates).toEqual([{ id: 'candidate:c1', urgency: 'confirm' }]);
    expect(Array.isArray(NS.store.inboxGroups)).toBe(false);
    expect(NS.store.candidatesError).toBe('');
  });
});
