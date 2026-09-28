import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  calls: 0,
  blocked: new Set<string>(),
}));

vi.mock('../../../../src/main/features/recall/asset-service', () => ({
  listAbilityAssets: async () => {
    state.calls += 1;
    return [
      { id: 'aa-release', title: '发版检查', statement: '发版前核对版本和回退方案', type: 'rule', status: 'active', maturity: 'bud', version: '1', updatedAt: '2026-09-01T00:00:00Z' },
      { id: 'aa-writing', title: '写作规范', statement: '文章先给结论再给依据', type: 'rule', status: 'active', maturity: 'bud', version: '1', updatedAt: '2026-09-01T00:00:00Z' },
      { id: 'aa-blocked', title: '内部秘密', statement: '不可见内容', type: 'rule', status: 'active', maturity: 'bud', version: '1', updatedAt: '2026-09-01T00:00:00Z' },
    ];
  },
}));

vi.mock('../../../../src/main/features/recall/prompt-injection', () => ({
  filterRecallAssetsForAgentRead: async (_userId: string, assets: Array<{ id: string }>) =>
    assets.filter((asset) => !state.blocked.has(asset.id)),
}));

vi.mock('../../../../src/main/features/recall/catalog-vector-cache', () => ({
  pruneCatalogVectors: async () => undefined,
  catalogVectors: async () => ({ query: null, byId: new Map() }),
}));

vi.mock('../../../../src/main/features/recall/asset-catalog', () => ({
  loadAssetAdoptionStatsCached: async () => new Map(),
  formatCatalogEntry: (asset: { id: string; title: string }, _stat: unknown, index: number, marked: boolean) => `${index}. ${marked ? '★' : ''}[asset:${asset.id}] ${asset.title}`,
}));

vi.mock('../../../../src/main/features/recall/catalog-ranking-weights', () => ({
  DEFAULT_RANKING_WEIGHTS: { relevance: 2, adoption: 0.3, scene: 0.5, maturity: 0.2 },
  getRankingWeights: async () => ({ weights: { relevance: 2, adoption: 0.3, scene: 0.5, maturity: 0.2 }, source: 'default' }),
}));

beforeEach(() => {
  state.calls = 0;
  state.blocked = new Set(['aa-blocked']);
});

describe('turn-scoped asset catalog', () => {
  it('keeps concurrent conversations separate and coalesces the same turn build', async () => {
    const engine = await import('../../../../src/main/features/recall/catalog-engine');
    engine.resetCatalogEngineForTest();
    const input = { cid: 'conv-a', turnId: 'turn-a', taskText: '发版检查' };
    const [first, repeated] = await Promise.all([
      engine.catalogSnapshot('catalogtest', input),
      engine.catalogSnapshot('catalogtest', input),
    ]);
    expect(first).toBe(repeated);
    expect(state.calls).toBe(1);
    const second = await engine.catalogSnapshot('catalogtest', { cid: 'conv-b', turnId: 'turn-b', taskText: '写作规范' });
    expect(second).not.toBe(first);
    expect(engine.catalogRankedForTurn('catalogtest', 'conv-a', 'turn-a').size).toBe(2);
    expect(engine.catalogRankedForTurn('catalogtest', 'conv-b', 'turn-b').size).toBe(2);
    expect(engine.catalogRankedForTurn('catalogtest', 'conv-a', 'turn-b').size).toBe(0);
    expect(first.assets.some((asset) => asset.id === 'aa-blocked')).toBe(false);
  });

  it('rechecks admission before a tool page even when its rank snapshot exists', async () => {
    const engine = await import('../../../../src/main/features/recall/catalog-engine');
    engine.resetCatalogEngineForTest();
    const input = { cid: 'conv-a', turnId: 'turn-a', taskText: '发版检查' };
    const snapshot = await engine.catalogSnapshot('catalogtest', input);
    state.blocked.add('aa-writing');
    const ordered = await engine.catalogOrderedToolPool('catalogtest', input, snapshot.assets);
    expect(ordered.map((asset) => asset.id)).toEqual(['aa-release']);
  });

  it('keeps the active task for a short continuation without pinning the first message forever', async () => {
    const engine = await import('../../../../src/main/features/recall/catalog-engine');
    engine.resetCatalogEngineForTest();
    const first = await engine.catalogSnapshot('catalogtest', { cid: 'conv-a', turnId: 'turn-1', taskText: '发版检查' });
    const continued = await engine.catalogSnapshot('catalogtest', { cid: 'conv-a', turnId: 'turn-2', taskText: '继续' });
    expect(continued.matches.get('aa-release')?.score).toBe(first.matches.get('aa-release')?.score);
    const changed = await engine.catalogSnapshot('catalogtest', { cid: 'conv-a', turnId: 'turn-3', taskText: '写作规范' });
    expect(changed.matches.get('aa-writing')!.score).toBeGreaterThan(changed.matches.get('aa-release')!.score);
  });

  it('keeps prompt marks within a bounded excerpt and never marks blocked assets', async () => {
    const engine = await import('../../../../src/main/features/recall/catalog-engine');
    const hint = await import('../../../../src/main/features/recall/asset-catalog-hint');
    engine.resetCatalogEngineForTest();
    const snapshot = await engine.catalogSnapshot('catalogtest', { cid: 'conv-a', turnId: 'turn-a', taskText: '发版检查' });
    const rendered = hint.renderCatalogPrompt(snapshot);
    expect(rendered.text).toContain('[asset:aa-release]');
    expect(rendered.text).not.toContain('aa-blocked');
    expect(rendered.shown.length).toBeLessThanOrEqual(hint.INLINE_CATALOG_MAX_ENTRIES);
    expect([...rendered.relevantIds].every((id) => rendered.shown.some((row) => row.id === id))).toBe(true);
  });
});

describe('retrieval and replay', () => {
  it('finds exact titles and works when embeddings are unavailable; tags cannot change the profile', async () => {
    const { catalogMatches, catalogAssetProfile } = await import('../../../../src/main/features/recall/catalog-relevance');
    const assets = [
      { id: 'aa-a', title: 'KSTAR 回退流程', statement: '故障时恢复上一版本' },
      { id: 'aa-b', title: '通用写作', statement: '先给结论与依据' },
    ];
    const scores = await catalogMatches('catalogtest', 'KSTAR 回退', assets);
    expect(scores.get('aa-a')!.score).toBeGreaterThan(scores.get('aa-b')!.score);
    expect(scores.get('aa-a')!.strong).toBe(true);
    expect(catalogAssetProfile({ ...assets[0], tags: ['A'] } as never))
      .toBe(catalogAssetProfile({ ...assets[0], tags: ['B'] } as never));
    expect([...scores.values()].every((row) => row.score >= 0 && row.score <= 1)).toBe(true);
  });

  it('scores labelled tasks without treating old applied receipts as ground truth', async () => {
    const { evaluateCatalogRuns } = await import('../../../../src/main/features/recall/catalog-evaluation');
    const result = evaluateCatalogRuns(
      [{ id: 'task-a', relevantIds: ['aa-good'], harmfulIds: ['aa-bad'] }],
      [{ caseId: 'task-a', rankedIds: ['aa-good', 'aa-bad'], shownIds: ['aa-good', 'aa-bad'], appliedIds: ['aa-good'] }],
    );
    expect(result).toMatchObject({ cases: 1, relevantCases: 1, recallAt5: 1, mrrAt10: 1, harmfulShownRate: 0.5, relevantAppliedRate: 1 });
  });
});
