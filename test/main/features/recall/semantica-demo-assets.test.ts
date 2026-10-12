import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

vi.mock('../../../../src/main/features/kb_indexer', () => ({
  enqueue: () => {},
  kbEvents: { on: () => {}, off: () => {}, emit: () => {} },
}));
vi.mock('../../../../src/main/features/search', () => ({
  upsertContext: () => {},
  dropContext: () => {},
}));

let tmpDir: string;
let previousRoot: string | undefined;

beforeEach(() => {
  vi.resetModules();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cogseed-semantica-demo-'));
  previousRoot = process.env.COGSEED_WORKSPACE_ROOT;
  process.env.COGSEED_WORKSPACE_ROOT = tmpDir;
});

afterEach(() => {
  vi.unstubAllEnvs();
  if (previousRoot === undefined) delete process.env.COGSEED_WORKSPACE_ROOT;
  else process.env.COGSEED_WORKSPACE_ROOT = previousRoot;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('Semantica demo ability assets', () => {
  it('seeds an idempotent governed relation domain', async () => {
    const demo = await import('../../../../src/main/features/recall/semantica-demo-assets');
    const assets = await import('../../../../src/main/features/recall/asset-service');
    const ontology = await import('../../../../src/main/features/recall/ontology-asset-query');
    const userId = 'semantica-demo-user';

    const first = await demo.seedSemanticaDemoAssets(userId);
    expect(first.createdCount).toBe(14);
    expect(first.status).toMatchObject({ ready: true, assetCount: 14, expectedAssetCount: 14 });

    const records = (await assets.listAbilityAssets(userId)).filter((asset) => asset.status === 'active');
    expect(records).toHaveLength(14);
    expect(records.every((asset) => asset.tags?.includes(demo.SEMANTICA_DEMO_TAG))).toBe(true);
    expect(records.every((asset) => asset.origin === 'manual' && asset.maturity === 'bud')).toBe(true);

    const direct = ontology.queryOntologyAssets(records, {
      query: '哪些生活安排直接依赖工作日双人用餐方案',
      target: '生活演示：工作日双人用餐方案',
      relationKind: 'depends_on',
      direction: 'incoming',
      maxHops: 1,
    });
    expect(direct.status).toBe('ok');
    if (direct.status === 'ok') {
      expect(direct.matches.map((match) => [match.asset.title, match.distance])).toEqual([
        ['生活演示：库存与采购批次控制', 1],
      ]);
    }

    const multiHop = ontology.queryOntologyAssets(records, {
      query: '两跳内哪些生活安排依赖工作日双人用餐方案',
      target: '生活演示：工作日双人用餐方案',
      relationKind: 'depends_on',
      direction: 'incoming',
      maxHops: 2,
    });
    expect(multiHop.status).toBe('ok');
    if (multiHop.status === 'ok') {
      expect(multiHop.matches.map((match) => [match.asset.title, match.distance])).toEqual([
        ['生活演示：库存与采购批次控制', 1],
        ['生活演示：低峰时段批次编排', 2],
      ]);
    }

    const second = await demo.seedSemanticaDemoAssets(userId);
    expect(second).toMatchObject({ createdCount: 0, updatedCount: 0 });
    expect((await assets.listAbilityAssets(userId)).filter((asset) => asset.status === 'active')).toHaveLength(14);
  });

  it('updates an earlier managed demo in place instead of duplicating it', async () => {
    const demo = await import('../../../../src/main/features/recall/semantica-demo-assets');
    const assets = await import('../../../../src/main/features/recall/asset-service');
    const userId = 'semantica-migration-user';

    await demo.seedSemanticaDemoAssets(userId);
    const before = (await assets.listAbilityAssets(userId)).find((asset) => asset.id.includes('-meal-plan-'))!;
    await assets.updateAbilityAsset(userId, before.id, {
      title: 'Semantica演示网关',
      statement: '旧版抽象演示内容。',
      actor: 'user',
      reason: '模拟旧版演示资产。',
    });

    const migrated = await demo.seedSemanticaDemoAssets(userId);
    expect(migrated).toMatchObject({ createdCount: 0, updatedCount: 1 });
    const active = (await assets.listAbilityAssets(userId)).filter((asset) => asset.status === 'active');
    expect(active).toHaveLength(14);
    expect(active.find((asset) => asset.id === before.id)?.title).toBe('生活演示：工作日双人用餐方案');
  });

  it('migrates legacy technical IDs to life-scenario IDs without leaving active duplicates', async () => {
    const demo = await import('../../../../src/main/features/recall/semantica-demo-assets');
    const assets = await import('../../../../src/main/features/recall/asset-service');
    const types = await import('../../../../src/main/features/recall/types');
    const userId = 'legacy-demo-migration-user';
    const at = new Date().toISOString();

    await assets.createAbilityAsset(userId, {
      schemaVersion: types.RECALL_SCHEMA_VERSION,
      ownerId: userId,
      id: 'aa-semantica-demo-gateway-legacy1234',
      candidateId: 'candidate-legacy-demo-1234',
      reviewDecisionId: 'rd_legacy_demo_1234',
      type: 'skill_method',
      title: '生活演示：工作日双人用餐方案',
      statement: '旧版生活演示内容。',
      evidenceRefs: [],
      origin: 'manual',
      relations: [],
      tags: ['semantica-demo'],
      scope: 'general',
      status: 'active',
      lifecycleStatus: 'user_confirmed_unverified',
      maturity: 'bud',
      version: '1',
      activeVersion: '1',
      createdAt: at,
      updatedAt: at,
    }, { actor: 'user', reason: '模拟旧版演示资产。' });

    const migrated = await demo.seedSemanticaDemoAssets(userId);
    expect(migrated).toMatchObject({ createdCount: 14, status: { ready: true, assetCount: 14 } });

    const records = await assets.listAbilityAssets(userId);
    expect(records.find((asset) => asset.id === 'aa-semantica-demo-gateway-legacy1234')?.status).toBe('deleted');
    const active = records.filter((asset) => asset.status === 'active');
    expect(active).toHaveLength(14);
    expect(active.every((asset) => asset.id.startsWith('aa-life-demo-'))).toBe(true);
    expect(active.every((asset) => asset.tags?.includes('life-demo'))).toBe(true);
  });

  it('makes relation-only assets observable only through Semantica expansion', async () => {
    const demo = await import('../../../../src/main/features/recall/semantica-demo-assets');
    const projection = await import('../../../../src/main/features/recall/context-projection');
    const assets = await import('../../../../src/main/features/recall/asset-service');
    const userId = 'semantica-comparison-user';
    await demo.seedSemanticaDemoAssets(userId);

    const records = (await assets.listAbilityAssets(userId)).filter((asset) => asset.status === 'active');
    const byKey = (key: string) => records.find((asset) => asset.id.includes(`-${key}-`))!;
    const entry = byKey('meal-plan');
    const resource = byKey('inventory');
    const execution = byKey('batch-planning');
    const safety = byKey('constraint-safety');
    const taskText = '我下周工作日要和伴侣两个人在家吃晚饭，帮我安排一下。';
    const semanticFixture = {
      minScore: 0.3,
      embedTexts: async (texts: string[]) => texts.map((text) => (
        text === taskText || text.includes('工作日双人用餐方案') ? [1, 0] : [0, 1]
      )),
    };

    vi.stubEnv('COGSEED_SEMANTICA_ENABLED', '0');
    const disabled = await projection.buildRecallView(userId, {
      taskRunId: 'demo-disabled', purpose: 'conversation_reply', taskText,
    }, semanticFixture);
    expect(disabled.assetIds).toEqual([entry.id]);
    expect(disabled.assetMatches).toEqual([
      expect.objectContaining({ assetId: entry.id, matchMethod: 'semantic' }),
    ]);

    vi.stubEnv('COGSEED_SEMANTICA_ENABLED', '1');
    const enabled = await projection.buildRecallView(userId, {
      taskRunId: 'demo-enabled', purpose: 'conversation_reply', taskText,
    }, semanticFixture);
    expect(enabled.assetIds).toEqual(expect.arrayContaining([
      entry.id, resource.id, execution.id, safety.id,
    ]));
    expect(enabled.assetMatches).toEqual(expect.arrayContaining([
      expect.objectContaining({ assetId: resource.id, matchMethod: 'ontology', entryAssetId: entry.id, distance: 1 }),
      expect.objectContaining({ assetId: execution.id, matchMethod: 'ontology', entryAssetId: entry.id, distance: 2 }),
      expect.objectContaining({ assetId: safety.id, matchMethod: 'ontology', entryAssetId: entry.id, distance: 1 }),
    ]));
  });

  it('expands a natural travel request through a separate relation domain', async () => {
    const demo = await import('../../../../src/main/features/recall/semantica-demo-assets');
    const projection = await import('../../../../src/main/features/recall/context-projection');
    const assets = await import('../../../../src/main/features/recall/asset-service');
    const ontology = await import('../../../../src/main/features/recall/ontology-asset-query');
    const userId = 'semantica-travel-comparison-user';
    await demo.seedSemanticaDemoAssets(userId);

    const records = (await assets.listAbilityAssets(userId)).filter((asset) => asset.status === 'active');
    const byKey = (key: string) => records.find((asset) => asset.id.includes(`-${key}-`))!;
    const entry = byKey('trip-plan');
    const transport = byKey('transport-budget');
    const timing = byKey('departure-window');
    const constraints = byKey('traveler-constraints');
    const taskText = '我和朋友周末想去附近玩两天，预算有限，周日晚上必须回来，帮我规划一下。';
    const semanticFixture = {
      minScore: 0.3,
      embedTexts: async (texts: string[]) => texts.map((text) => (
        text === taskText || text.includes('周末短途出行方案') ? [1, 0] : [0, 1]
      )),
    };

    vi.stubEnv('COGSEED_SEMANTICA_ENABLED', '0');
    const disabled = await projection.buildRecallView(userId, {
      taskRunId: 'travel-disabled', purpose: 'conversation_reply', taskText,
    }, semanticFixture);
    expect(disabled.assetIds).toEqual([entry.id]);

    vi.stubEnv('COGSEED_SEMANTICA_ENABLED', '1');
    const enabled = await projection.buildRecallView(userId, {
      taskRunId: 'travel-enabled', purpose: 'conversation_reply', taskText,
    }, semanticFixture);
    expect(enabled.assetIds).toEqual(expect.arrayContaining([
      entry.id, transport.id, timing.id, constraints.id,
    ]));
    expect(enabled.assetMatches).toEqual(expect.arrayContaining([
      expect.objectContaining({ assetId: transport.id, matchMethod: 'ontology', entryAssetId: entry.id, distance: 1 }),
      expect.objectContaining({ assetId: timing.id, matchMethod: 'ontology', entryAssetId: entry.id, distance: 2 }),
      expect.objectContaining({ assetId: constraints.id, matchMethod: 'ontology', entryAssetId: entry.id, distance: 1 }),
    ]));

    const related = ontology.queryOntologyAssets(records, {
      query: '两跳内哪些安排依赖周末短途出行方案',
      target: entry.title,
      relationKind: 'depends_on',
      direction: 'incoming',
      maxHops: 2,
    });
    expect(related.status).toBe('ok');
    if (related.status === 'ok') {
      expect(related.matches.map((match) => [match.asset.id, match.distance])).toEqual([
        [transport.id, 1],
        [timing.id, 2],
      ]);
    }
  });

  it('expands a natural progress-report request into evidence, risk, value, and privacy guidance', async () => {
    const demo = await import('../../../../src/main/features/recall/semantica-demo-assets');
    const projection = await import('../../../../src/main/features/recall/context-projection');
    const assets = await import('../../../../src/main/features/recall/asset-service');
    const userId = 'semantica-report-comparison-user';
    await demo.seedSemanticaDemoAssets(userId);

    const records = (await assets.listAbilityAssets(userId)).filter((asset) => asset.status === 'active');
    const byKey = (key: string) => records.find((asset) => asset.id.includes(`-${key}-`))!;
    const context = byKey('semantica-project-context');
    const entry = byKey('progress-report');
    const dataCheck = byKey('report-data-check');
    const risk = byKey('report-risk-action');
    const value = byKey('report-outcome-value');
    const sensitive = byKey('report-sensitive-check');
    const taskText = '我明天要给老师汇报 CogSeed 的 Semantica 工作，帮我整理一份五分钟汇报稿。';
    const semanticFixture = {
      minScore: 0.3,
      embedTexts: async (texts: string[]) => texts.map((text) => (
        text === taskText || text.includes('Semantica现状') ? [1, 0] : [0, 1]
      )),
    };

    vi.stubEnv('COGSEED_SEMANTICA_ENABLED', '0');
    const disabled = await projection.buildRecallView(userId, {
      taskRunId: 'report-disabled', purpose: 'conversation_reply', taskText,
    }, semanticFixture);
    expect(disabled.assetIds).toEqual([context.id]);

    vi.stubEnv('COGSEED_SEMANTICA_ENABLED', '1');
    const enabled = await projection.buildRecallView(userId, {
      taskRunId: 'report-enabled', purpose: 'conversation_reply', taskText,
    }, semanticFixture);
    expect(enabled.assetIds).toEqual(expect.arrayContaining([
      context.id, entry.id, dataCheck.id, risk.id, value.id, sensitive.id,
    ]));
    expect(enabled.assetMatches).toEqual(expect.arrayContaining([
      expect.objectContaining({ assetId: entry.id, matchMethod: 'ontology', entryAssetId: context.id, distance: 1 }),
      expect.objectContaining({ assetId: dataCheck.id, matchMethod: 'ontology', entryAssetId: context.id, distance: 1 }),
      expect.objectContaining({ assetId: risk.id, matchMethod: 'ontology', entryAssetId: context.id, distance: 2 }),
      expect.objectContaining({ assetId: value.id, matchMethod: 'ontology', entryAssetId: context.id, distance: 2 }),
      expect.objectContaining({ assetId: sensitive.id, matchMethod: 'ontology', entryAssetId: context.id, distance: 2 }),
    ]));
  });

  it('clears only managed demo assets and can seed again', async () => {
    const demo = await import('../../../../src/main/features/recall/semantica-demo-assets');
    const assets = await import('../../../../src/main/features/recall/asset-service');
    const types = await import('../../../../src/main/features/recall/types');
    const userId = 'semantica-clean-user';
    const at = new Date().toISOString();

    await assets.createAbilityAsset(userId, {
      schemaVersion: types.RECALL_SCHEMA_VERSION,
      ownerId: userId,
      id: 'aa-ordinary-asset',
      candidateId: 'candidate-ordinary-asset',
      reviewDecisionId: 'rd_ordinary_asset_1234',
      type: 'rule',
      title: '普通生活经验',
      statement: '变更发布前应核对入口配置。',
      evidenceRefs: [],
      origin: 'manual',
      scope: 'general',
      status: 'active',
      lifecycleStatus: 'user_confirmed_unverified',
      maturity: 'bud',
      version: '1',
      activeVersion: '1',
      createdAt: at,
      updatedAt: at,
    }, { actor: 'user', reason: '测试普通资产。' });

    await demo.seedSemanticaDemoAssets(userId);
    const cleared = await demo.clearSemanticaDemoAssets(userId);
    expect(cleared).toMatchObject({ clearedCount: 14, status: { ready: false, assetCount: 0 } });
    expect((await assets.readAbilityAsset(userId, 'aa-ordinary-asset')).status).toBe('active');

    const seededAgain = await demo.seedSemanticaDemoAssets(userId);
    expect(seededAgain).toMatchObject({ createdCount: 14, status: { ready: true, assetCount: 14 } });
  });
});
