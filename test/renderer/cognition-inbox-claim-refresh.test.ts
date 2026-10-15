import { describe, expect, it, vi } from 'vitest';
import { loadCognitionAssets } from './helpers/cognition-renderer';
describe('旧独立治理待办彻底退役', () => {
  it('没有独立处置控制器，普通刷新不会获取或恢复旧待办', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'recall.candidates.list') return { candidates: [] };
      if (channel === 'recall.assets.list') return { assets: [] };
      return { ok: true };
    });
    const { ns } = loadCognitionAssets({}, { name: 'activity' }, { cogseed: { invoke } });
    expect(ns.actions.resolveInboxItem).toBeUndefined();
    await ns.reload();
    expect(invoke.mock.calls.some(([channel]) => channel === 'cognition.inbox.list' || channel === 'cognition.inbox.resolve')).toBe(false);
  });
});
