import { describe, expect, it, vi } from 'vitest';

import { loadCognitionAssets } from './helpers/cognition-renderer';

type Notice = { collection: string; generation: number };
type ResolveRead = (value: { ok: true; assets: Array<{ id: string }> }) => void;

describe('cognition change rail', () => {
  it('queues a second change that arrives while the same block is being read', async () => {
    const handlers = new Map<string, (notice: Notice) => void>();
    const pendingReads: ResolveRead[] = [];
    const invoke = vi.fn((channel: string) => {
      if (channel !== 'recall.assets.list') return Promise.resolve({ ok: true });
      return new Promise<{ ok: true; assets: Array<{ id: string }> }>((resolve) => {
        pendingReads.push(resolve);
      });
    });
    const { ns, store } = loadCognitionAssets({}, {}, {
      cogseed: {
        invoke,
        onPushEvent: (channel: string, handler: (notice: Notice) => void) => {
          handlers.set(channel, handler);
          return () => handlers.delete(channel);
        },
      },
    });

    ns.setupChangeRail(() => true);
    const onChanged = handlers.get('cognition:changed');
    expect(onChanged).toBeTypeOf('function');

    onChanged!({ collection: 'ability-assets', generation: 1 });
    await vi.waitFor(() => expect(pendingReads).toHaveLength(1));

    // A write happens after the first read has started. The second refresh must
    // run after it finishes, otherwise the panel can stay stale indefinitely.
    onChanged!({ collection: 'ability-assets', generation: 2 });
    pendingReads[0]({ ok: true, assets: [{ id: 'before-second-write' }] });
    await vi.waitFor(() => expect(pendingReads).toHaveLength(2));

    pendingReads[1]({ ok: true, assets: [{ id: 'after-second-write' }] });
    await vi.waitFor(() => expect(store.assets).toEqual([{ id: 'after-second-write' }]));
    expect(invoke.mock.calls.filter(([channel]) => channel === 'recall.assets.list')).toHaveLength(2);
  });

  it('holds notices while hidden and reads the affected block when visible again', async () => {
    const handlers = new Map<string, (notice: Notice) => void>();
    const invoke = vi.fn(async (channel: string) => (
      channel === 'recall.assets.list' ? { ok: true, assets: [{ id: 'asset-1' }] } : { ok: true }
    ));
    const { ns, store } = loadCognitionAssets({}, {}, {
      cogseed: {
        invoke,
        onPushEvent: (channel: string, handler: (notice: Notice) => void) => {
          handlers.set(channel, handler);
          return () => handlers.delete(channel);
        },
      },
    });

    let visible = false;
    ns.setupChangeRail(() => visible);
    handlers.get('cognition:changed')!({ collection: 'ability-assets', generation: 1 });
    expect(invoke).not.toHaveBeenCalled();

    visible = true;
    ns.changeRailVisible(true);
    await ns.flushPendingRefresh();
    expect(invoke).toHaveBeenCalledWith('recall.assets.list', {});
    expect(store.assets).toEqual([{ id: 'asset-1' }]);
  });

  it('keeps the renderer tree link dead: candidate/tree notices never trigger tree IPC (P-r3-30)', async () => {
    const handlers = new Map<string, (notice: Notice) => void>();
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'recall.candidates.list') return { ok: true, candidates: [] };
      return { ok: true };
    });
    const { ns, store } = loadCognitionAssets({}, {}, {
      cogseed: {
        invoke,
        onPushEvent: (channel: string, handler: (notice: Notice) => void) => {
          handlers.set(channel, handler);
          return () => handlers.delete(channel);
        },
      },
    });
    ns.setupChangeRail(() => true);

    // 认知树页面全靠现算（viewTree 从 assets/captures 现算），渲染层不再
    // 持有 store.tree / treeRequested / loadTree：candidates 变更只刷候选块，
    // tree/graph 落盘广播无映射静默忽略——主进程 recall.tree.* 服务与通道
    // 保留（tree-service.test.ts 锁定），但渲染层零调用。
    handlers.get('cognition:changed')!({ collection: 'candidates', generation: 1 });
    await ns.flushPendingRefresh();
    expect(invoke).toHaveBeenCalledWith('recall.candidates.list', { view: 'review-queue' });

    handlers.get('cognition:changed')!({ collection: 'tree', generation: 1 });
    handlers.get('cognition:changed')!({ collection: 'graph', generation: 1 });
    await ns.flushPendingRefresh();
    await ns.reload();
    expect(invoke.mock.calls.filter(([channel]) => String(channel).startsWith('recall.tree.'))).toHaveLength(0);
    expect(store.tree).toBeUndefined();
    expect(store.treeRequested).toBeUndefined();
  });

  it('routes ontology candidate changes into the shared review-inbox block after po page retirement', async () => {
    const handlers = new Map<string, (notice: Notice) => void>();
    const invoke = vi.fn(async (channel: string) => (
      channel === 'recall.candidates.list' ? { ok: true, candidates: [] }
        : channel === 'personalOntology.candidates.list' ? { ok: true, candidate_updates: [] }
        : { ok: true }
    ));
    const { ns } = loadCognitionAssets({}, {}, {
      cogseed: {
        invoke,
        onPushEvent: (channel: string, handler: (notice: Notice) => void) => {
          handlers.set(channel, handler);
          return () => handlers.delete(channel);
        },
      },
    });
    ns.setupChangeRail(() => true);

    handlers.get('cognition:changed')!({ collection: 'ontology-candidates', generation: 1 });
    await ns.flushPendingRefresh();
    expect(invoke).toHaveBeenCalledWith('recall.candidates.list', { view: 'review-queue' });
    expect(invoke).toHaveBeenCalledWith('personalOntology.candidates.list', {});
  });
});
