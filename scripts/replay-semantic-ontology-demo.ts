import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

type Check = {
  name: string;
  passed: boolean;
  details: Record<string, unknown>;
};

function assertCheck(checks: Check[], name: string, condition: boolean, details: Record<string, unknown>): void {
  checks.push({ name, passed: condition, details });
  if (!condition) throw new Error(`${name} failed: ${JSON.stringify(details)}`);
}

function ids(value: readonly { assetId: string }[]): string[] {
  return value.map((item) => item.assetId);
}

async function main(): Promise<void> {
  const outputDir = path.join(os.homedir(), 'cogseed-private-evaluation');
  const outputPath = path.join(outputDir, 'demo-replay-report.json');
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cogseed-semantica-replay-'));
  process.env.COGSEED_WORKSPACE_ROOT = workspaceRoot;

  // These imports must happen after the isolated workspace is selected: the
  // production path module reads COGSEED_WORKSPACE_ROOT during module load.
  const demo = await import('../src/main/features/recall/semantica-demo-assets');
  const assetService = await import('../src/main/features/recall/asset-service');
  const projection = await import('../src/main/features/recall/context-projection');
  const ontology = await import('../src/main/features/recall/ontology-asset-query');
  const orchestrator = await import('../src/main/features/recall/ontology-semantic-orchestrator');
  const suitability = await import('../src/main/features/recall/ontology-candidate-suitability');
  const answerValidation = await import('../src/main/features/recall/ontology-answer-validation');
  const { NoopJevClient } = await import('../src/main/features/jev/adapter');

  const userId = 'semantica-demo-replay';
  const taskText = '我下周工作日要和伴侣两个人在家吃晚饭，帮我安排一下。';
  const travelTaskText = '我和朋友周末想去附近玩两天，预算有限，周日晚上必须回来，帮我规划一下。';
  const checks: Check[] = [];

  try {
    const seeded = await demo.seedSemanticaDemoAssets(userId);
    const records = (await assetService.listAbilityAssets(userId))
      .filter((asset) => asset.status === 'active');
    const byTitle = (title: string) => records.find((asset) => asset.title === title)!;
    const entry = byTitle('生活演示：工作日双人用餐方案');
    const inventory = byTitle('生活演示：库存与采购批次控制');
    const batch = byTitle('生活演示：低峰时段批次编排');
    const safety = byTitle('生活演示：个体约束隔离');
    const trip = byTitle('生活演示：周末短途出行方案');
    const transport = byTitle('生活演示：交通与费用边界');
    const departure = byTitle('生活演示：低峰窗口选择');
    const travelerConstraints = byTitle('生活演示：同行约束隔离');
    const semanticFixture = {
      minScore: 0.3,
      embedTexts: async (texts: string[]) => texts.map((text) => (
        text === taskText || text.includes('工作日双人用餐方案') ? [1, 0] : [0, 1]
      )),
    };
    const travelSemanticFixture = {
      minScore: 0.3,
      embedTexts: async (texts: string[]) => texts.map((text) => (
        text === travelTaskText || text.includes('周末短途出行方案') ? [1, 0] : [0, 1]
      )),
    };

    assertCheck(checks, 'three demo domains seeded', seeded.status.ready && records.length === 14, {
      createdCount: seeded.createdCount,
      assetCount: records.length,
    });

    process.env.COGSEED_SEMANTICA_ENABLED = '0';
    process.env.COGSEED_JEV_ENABLED = '0';
    const disabled = await projection.buildRecallView(userId, {
      taskRunId: 'demo-replay-disabled',
      purpose: 'conversation_reply',
      taskText,
    }, semanticFixture);
    assertCheck(checks, 'Semantica disabled keeps legacy semantic selection',
      disabled.assetIds.length === 1 && disabled.assetIds[0] === entry.id,
      { assetIds: disabled.assetIds, assetMatches: disabled.assetMatches });

    process.env.COGSEED_SEMANTICA_ENABLED = '1';
    const enabled = await projection.buildRecallView(userId, {
      taskRunId: 'demo-replay-enabled',
      purpose: 'conversation_reply',
      taskText,
    }, semanticFixture);
    const enabledIds = new Set(enabled.assetIds);
    assertCheck(checks, 'Semantica enabled expands the entry through persisted relations',
      [entry.id, inventory.id, batch.id, safety.id].every((id) => enabledIds.has(id)),
      { assetIds: enabled.assetIds, assetMatches: enabled.assetMatches });

    process.env.COGSEED_SEMANTICA_ENABLED = '0';
    const travelDisabled = await projection.buildRecallView(userId, {
      taskRunId: 'travel-replay-disabled',
      purpose: 'conversation_reply',
      taskText: travelTaskText,
    }, travelSemanticFixture);
    assertCheck(checks, 'travel request without Semantica keeps only its semantic entry',
      travelDisabled.assetIds.length === 1 && travelDisabled.assetIds[0] === trip.id,
      { assetIds: travelDisabled.assetIds, assetMatches: travelDisabled.assetMatches });

    process.env.COGSEED_SEMANTICA_ENABLED = '1';
    const travelEnabled = await projection.buildRecallView(userId, {
      taskRunId: 'travel-replay-enabled',
      purpose: 'conversation_reply',
      taskText: travelTaskText,
    }, travelSemanticFixture);
    const travelEnabledIds = new Set(travelEnabled.assetIds);
    assertCheck(checks, 'travel request with Semantica expands through persisted relations',
      [trip.id, transport.id, departure.id, travelerConstraints.id]
        .every((id) => travelEnabledIds.has(id)),
      { assetIds: travelEnabled.assetIds, assetMatches: travelEnabled.assetMatches });

    const direct = ontology.queryOntologyAssets(records, {
      query: '哪些生活安排直接依赖工作日双人用餐方案',
      target: entry.title,
      relationKind: 'depends_on',
      direction: 'incoming',
      maxHops: 1,
    });
    assertCheck(checks, 'direct dependency query returns inventory only',
      direct.status === 'ok'
        && direct.matches.length === 1
        && direct.matches[0].asset.id === inventory.id
        && direct.matches[0].distance === 1,
      { result: direct });

    const twoHop = ontology.queryOntologyAssets(records, {
      query: '哪些生活安排两跳内依赖工作日双人用餐方案',
      target: entry.title,
      relationKind: 'depends_on',
      direction: 'incoming',
      maxHops: 2,
    });
    assertCheck(checks, 'two-hop dependency query preserves distance',
      twoHop.status === 'ok'
        && JSON.stringify(twoHop.matches.map((match) => [match.asset.id, match.distance]))
          === JSON.stringify([[inventory.id, 1], [batch.id, 2]]),
      { result: twoHop });

    const refinement = ontology.queryOntologyAssets(records, {
      query: '哪些资产细化工作日双人用餐方案',
      target: entry.title,
      relationKind: 'refines',
      direction: 'incoming',
      maxHops: 1,
    });
    assertCheck(checks, 'refinement query keeps relation direction',
      refinement.status === 'ok'
        && refinement.matches.length === 1
        && refinement.matches[0].asset.id === safety.id,
      { result: refinement });

    const travelTwoHop = ontology.queryOntologyAssets(records, {
      query: '两跳内哪些安排依赖周末短途出行方案',
      target: trip.title,
      relationKind: 'depends_on',
      direction: 'incoming',
      maxHops: 2,
    });
    assertCheck(checks, 'travel dependency query preserves direct and indirect distance',
      travelTwoHop.status === 'ok'
        && JSON.stringify(travelTwoHop.matches.map((match) => [match.asset.id, match.distance]))
          === JSON.stringify([[transport.id, 1], [departure.id, 2]]),
      { result: travelTwoHop });

    const travelRefinement = ontology.queryOntologyAssets(records, {
      query: '哪些资产细化周末短途出行方案',
      target: trip.title,
      relationKind: 'refines',
      direction: 'incoming',
      maxHops: 1,
    });
    assertCheck(checks, 'travel refinement query returns traveler constraints',
      travelRefinement.status === 'ok'
        && travelRefinement.matches.length === 1
        && travelRefinement.matches[0].asset.id === travelerConstraints.id,
      { result: travelRefinement });

    if (direct.status !== 'ok') throw new Error('direct query unexpectedly failed');
    const ontologyCandidates = orchestrator.orchestrateOntologySemanticRecall({
      assets: records,
      ontologyMatches: direct.matches.map((match) => ({
        assetId: match.asset.id,
        matchScore: 1,
        distance: match.distance,
        evidencePath: match.evidencePath,
      })),
    });
    const fallback = await suitability.assessOntologyCandidateSuitability({
      query: '哪些生活安排直接依赖工作日双人用餐方案',
      candidates: ontologyCandidates.candidates,
    }, { jev: new NoopJevClient('unconfigured') });
    assertCheck(checks, 'Jev fallback keeps deterministic candidates',
      fallback.status === 'fallback'
        && JSON.stringify(ids(fallback.candidates)) === JSON.stringify(ids(ontologyCandidates.candidates)),
      { fallbackStatus: fallback.status, fallbackReason: fallback.reason, candidateIds: ids(fallback.candidates) });

    const relationAnswer = `根据关系证据，${inventory.title}直接依赖于${entry.title}。`;
    const validation = await answerValidation.validateOntologyAnswer({
      query: '哪些生活安排直接依赖工作日双人用餐方案',
      answer: relationAnswer,
      assets: records.map((asset) => ({
        assetId: asset.id,
        title: asset.title,
        version: asset.version,
        statement: asset.statement,
      })),
      relations: [{ query: '哪些生活安排直接依赖工作日双人用餐方案', result: direct }],
    }, { jev: new NoopJevClient('unconfigured'), mode: 'enforce' });
    assertCheck(checks, 'answer validation falls back without erasing a supported answer',
      validation.status === 'fallback' && validation.answer === relationAnswer,
      { status: validation.status, reason: validation.reason, checks: validation.checks });

    const report = {
      schemaVersion: 1,
      kind: 'local_demo_replay',
      generatedAt: new Date().toISOString(),
      status: 'passed',
      scope: {
        sampleCount: 14,
        scenarioCount: 2,
        sampleType: '两组演示资产，不是真实业务数据',
        workspaceIsolation: true,
        jevNetworkCall: false,
      },
      conclusion: '本地链路验证通过：Semantica 开关、关系遍历、证据距离和 Jev 降级均按设计工作。该结果不能替代真实业务收益验收，也不能据此默认开启 Jev。',
      checks,
      observations: {
        disabledAssetTitles: disabled.assetIds.map((id) => records.find((asset) => asset.id === id)?.title || id),
        enabledAssetTitles: enabled.assetIds.map((id) => records.find((asset) => asset.id === id)?.title || id),
        travelDisabledAssetTitles: travelDisabled.assetIds.map((id) => records.find((asset) => asset.id === id)?.title || id),
        travelEnabledAssetTitles: travelEnabled.assetIds.map((id) => records.find((asset) => asset.id === id)?.title || id),
        directDependencyTitles: direct.matches.map((match) => match.asset.title),
        twoHopDependency: twoHop.status === 'ok'
          ? twoHop.matches.map((match) => ({ title: match.asset.title, distance: match.distance }))
          : [],
        refinementTitles: refinement.status === 'ok' ? refinement.matches.map((match) => match.asset.title) : [],
        travelTwoHopDependency: travelTwoHop.status === 'ok'
          ? travelTwoHop.matches.map((match) => ({ title: match.asset.title, distance: match.distance }))
          : [],
        travelRefinementTitles: travelRefinement.status === 'ok'
          ? travelRefinement.matches.map((match) => match.asset.title)
          : [],
        jevFallback: { status: fallback.status, reason: fallback.reason },
        answerValidation: { status: validation.status, reason: validation.reason },
      },
    };
    await fs.mkdir(outputDir, { recursive: true });
    await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    process.stdout.write(`${outputPath}\n${JSON.stringify({ status: report.status, checkCount: checks.length }, null, 2)}\n`);
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
