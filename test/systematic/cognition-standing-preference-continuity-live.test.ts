/** Opt-in production standing-preference continuity acceptance. Every source, capture,
 * permission, model call and review receipt is real within a disposable root.
 * Only encrypted auth config is copied opaquely; no formal user cognition is read.
 * Run once with COGSEED_LIVE_STANDING_CONTINUITY=1 and explicit source config/uid.
 * The immutable /tmp report distinguishes fixture structure from model formation. */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import type { RecallCandidateRecord } from '../../src/main/features/recall/candidate-service';
import type { GroupMessage } from '../../src/main/features/group_chat/types';
import { drainMainRuntimeForTest } from '../helpers/drain-main-runtime';

const suite = process.env.COGSEED_LIVE_STANDING_CONTINUITY === '1' ? describe : describe.skip;
const hash = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');
let root = '', uid = '', sourceConfig = '', reportFile = '';
let priorRoot: string | undefined, priorTZ: string | undefined, firstDay: Date;
let reportWritable = false, isolationStarted = false;
const originalConfigHashes: Record<string, string> = {};
const report: Record<string, any> = { schemaVersion: 1, synthetic: true, optInRequired: true,
  realModelsExecuted: false, productionGatesChanged: false, forcedManualAcceptance: false,
  observerOnly: true, responseNotAltered: true,
  stages: [], cases: [] };
function record(stage: string, data: Record<string, unknown>) {
  report.stages.push({ stage, ...data });
  process.stdout.write(`[standing-continuity-live] ${stage}\n`);
}
function time(dayOffset: number, hour: number): string {
  const day = new Date(firstDay); day.setDate(day.getDate() + dayOffset); day.setHours(hour, 0, 0, 0);
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00+08:00`;
}
async function records(collection: string) {
  const { recallJsonRecordPath } = await import('../../src/main/features/recall/paths');
  const { readRecallJsonRecord } = await import('../../src/main/features/recall/store');
  const folder = path.dirname(recallJsonRecordPath(uid, collection, 'probe'));
  const names = fs.existsSync(folder) ? fs.readdirSync(folder).filter(name => name.endsWith('.json')) : [];
  return Promise.all(names.map(name => readRecallJsonRecord(uid, collection, name.slice(0, -5))));
}
function candidateView(candidate: RecallCandidateRecord) {
  return { id: candidate.id, status: candidate.status, judgment: candidate.judgment, value: candidate.value,
    suggestedScope: candidate.suggestedScope, scopePolicy: candidate.scopePolicy, risk: candidate.risk,
    uncertainty: candidate.uncertainty, autoReview: candidate.autoReview,
    requiresTReview: candidate.ontologyFormation?.requiresTReview,
    blockedReasons: candidate.ontologyFormation?.blockedReasons || [],
    actualPlanBoxes: candidate.ontologyFormation?.previewChanges.map(row => row.box) || [],
    promotedAssetId: candidate.promotedAssetId, reviewDecisionId: candidate.reviewDecisionId };
}
async function sourceConversation(cid: string, messageId: string, sourceText: string, dayOffset: number) {
  const chats = await import('../../src/main/features/chats');
  const { appendJsonlAtomic } = await import('../../src/main/storage');
  const { conversationMessageFile } = await import('../../src/main/util/project-layout');
  const { appendVisible } = await import('../../src/main/features/group_chat/visibility');
  vi.setSystemTime(new Date(time(dayOffset, 10)));
  await chats.createConversation(uid, { conversationId: cid, title: '隔离自动确认验收' });
  const messages: GroupMessage[] = [
    { id: messageId, ts: new Date().toISOString(), from: 'user', to: ['commander'], text: sourceText },
    { id: `${messageId}-reply`, ts: new Date().toISOString(), from: 'commander', to: ['user'],
      text: '理解以上明确表达及其适用范围。仅以用户原文和最终决定为准；不声称已证明效果，也不额外推断其他人的偏好。' },
  ];
  for (const message of messages) {
    await appendJsonlAtomic(conversationMessageFile(uid, cid), message);
    await appendVisible(uid, cid, message, ['commander']);
  }
  await chats.updateConversation(uid, cid, {});
  return messages;
}
async function runNight(cid: string, dayOffset: number) {
  const capture = await import('../../src/main/features/recall/capture-service');
  const settings = await import('../../src/main/features/recall/capture-settings');
  const candidates = await import('../../src/main/features/recall/candidate-service');
  const night = time(dayOffset + 1, 3); vi.setSystemTime(new Date(night));
  const sweep = await capture.runNightlyCaptureSweep(uid, night, await settings.readRecallCaptureSettings(uid));
  const own = (await records('captures')).filter(row => row?.conversationId === cid);
  record('real-nightly-admission', { cid, sweep, captureCount: own.length });
  expect(sweep.ran).toBe(true); expect(own.length).toBeGreaterThan(0);
  const captures = [];
  for (const row of own) captures.push(await capture.runRecallCapture(uid, row!.id));
  report.realModelsExecuted ||= captures.some(row => !!row.contextSummary || !!row.valueJudgment || !!row.modelUsage);
  const ids = new Set(captures.flatMap(row => row.candidateIds));
  const ownCandidates = (await candidates.listRecallCandidates(uid)).filter(row => ids.has(row.id));
  record('real-nightly-formation', { cid, captures: captures.map(row => ({ id: row.id, status: row.status,
    errorCode: row.errorCode, filterReason: row.filterReason, candidateIds: row.candidateIds,
    autoApprovalEpoch: row.autoApprovalEpoch, summarySourceDigest: row.contextSummary?.sourceDigest,
    summaryCoverage: row.contextSummary?.coverage, valueJudgmentEligible: row.valueJudgment?.eligible,
    extractionCompletedAt: row.extractionCompletedAt, modelUsage: row.modelUsage,
    extractionRepairAttempted: row.extractionRepairAttempted })), candidates: ownCandidates.map(candidateView) });
  return { captures, candidates: ownCandidates };
}

suite('真实模型：详情保存与自动更新后的普通下一轮偏好', () => {
  beforeAll(async () => {
    sourceConfig = process.env.COGSEED_LIVE_SOURCE_CONFIG_DIR || ''; uid = process.env.COGSEED_LIVE_SOURCE_UID || '';
    if (!sourceConfig || !uid || path.basename(uid) !== uid || uid === '.' || uid === '..') throw new Error('explicit opaque auth config source and owner uid required');
    reportFile = process.env.COGSEED_LIVE_CONTINUITY_REPORT || `/tmp/cogseed-standing-continuity-live-${randomUUID()}.json`;
    if (!path.isAbsolute(reportFile) || !path.resolve(reportFile).startsWith('/tmp/') || fs.existsSync(reportFile)) {
      throw new Error('automatic live report must be a fresh immutable /tmp file');
    }
    reportWritable = true;
    priorRoot = process.env.COGSEED_WORKSPACE_ROOT; priorTZ = process.env.TZ;
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'cogseed-standing-continuity-live-'));
    isolationStarted = true; report.startedAt = new Date().toISOString();
    process.env.COGSEED_WORKSPACE_ROOT = root; process.env.TZ = 'Asia/Shanghai'; vi.resetModules();
    const configTarget = path.join(root, uid, 'local/config'); fs.mkdirSync(configTarget, { recursive: true, mode: 0o700 });
    for (const name of ['auth-profiles.json', 'account.json']) {
      const original = path.join(sourceConfig, name);
      if (!fs.existsSync(original)) continue;
      originalConfigHashes[name] = hash(fs.readFileSync(original)); fs.copyFileSync(original, path.join(configTarget, name));
    }
    if (!originalConfigHashes['auth-profiles.json']) throw new Error('encrypted configured auth profiles are required');
    const { activateUser } = await import('../../src/main/features/users'); activateUser(uid);
    firstDay = new Date(); firstDay.setHours(9, 0, 0, 0);
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(firstDay);
    const { migrateLegacyCognition } = await import('../../src/main/features/cognition_migration');
    expect((await migrateLegacyCognition(uid, { activate: true })).errors).toEqual([]);
    const assets = await import('../../src/main/features/recall/asset-service');
    expect(await assets.listAbilityAssets(uid)).toEqual([]);
    const ontology = await import('../../src/main/features/cognition/ontology/service');
    const create = (recordId: string, record: Record<string, unknown>) => ({ intent: 'create' as const,
      recordId, record, sourceLabel: '显式测试设置确认的虚构当前用户最小结构，非模型形成' });
    await ontology.commitOntologyCommand(uid, { commandId: 'automatic-live-explicit-structure-fixture', expectedRevision: 0, actions: [
      create('personal', { kind: 'module', name: '我的表达偏好', description: '隔离验收用的虚构用户模型', scope: { kind: 'personal' } }),
      create('person-type', { kind: 'definition', moduleId: 'personal', name: '人物', description: '表达偏好的主体', definitionKind: 'type', subjectTypes: [], objectTypes: [], valueType: 'entity', cardinality: 'many', cardinalityAnchor: 'subject' }),
      create('expressed-preference', { kind: 'definition', moduleId: 'personal', name: '表达偏好', description: '用户明确表达的偏好正文，保留情境与例外，不表明实际效果已验证', definitionKind: 'attribute', subjectTypes: ['person-type'], objectTypes: [], valueType: 'text', cardinality: 'one', cardinalityAnchor: 'subject' }),
      create('self', { kind: 'entity', moduleId: 'personal', typeId: 'person-type', name: '用户本人', description: '仅作为隔离测试中当前user发言者的身份锚点', aliases: [], identityStatus: 'confirmed' }),
    ] });
    // Read-only diagnostics around the real provider boundary. The original
    // response object, references and metadata are returned unchanged; no model
    // answers, permission decisions or source receipts are fabricated.
    const routing = await import('../../src/main/features/recall/capture-model-routing');
    const realRun = routing.runRecallCaptureModel;
    vi.spyOn(routing, 'runRecallCaptureModel').mockImplementation(async (owner, input) => {
      const actual = await realRun(owner, input);
      report.realModelsExecuted = true;
      record('actual-provider-observation', { sessionId: input.sessionId, chosen: actual.chosen,
        responseText: actual.result.text, responseHash: hash(actual.result.text),
        usage: actual.result.meta.usage, aborted: actual.result.meta.aborted === true,
        ...(actual.result.meta.error ? { safeError: { kind: actual.result.meta.error.kind,
          messageHash: hash(actual.result.meta.error.message || '') } } : {}), responseNotAltered: true });
      return actual;
    });
    const capture = await import('../../src/main/features/recall/capture-service'); capture.startRecallCaptureOrchestrator()();
    const settings = await import('../../src/main/features/recall/capture-settings');
    const modelCandidates = [{ provider: process.env.COGSEED_LIVE_AUTOMATIC_PROVIDER || 'zai', model: process.env.COGSEED_LIVE_AUTOMATIC_MODEL || 'glm-5.2' }];
    const grant = await settings.updateRecallCaptureSettings(uid, { enabled: true, autoApproval: false, executionPolicy: 'nightly',
      nightlyStart: '02:00', nightlyEnd: '06:00', modelCandidates });
    expect(grant.autoApproval).toBe(false);
    report.ownerHash = hash(uid); report.modelCandidates = modelCandidates;
    record('isolated-explicit-setup', { formalAssetsSeeded: 0, structureSeed: { T: 3, ACurrentSyntheticSelfIdentity: 1,
      modelFormed: false, source: 'explicit synthetic test setup', ruleRecordsSeeded: 0 }, automaticInitiallyOff: true });
  });
  afterAll(async () => {
    try {
      if (root && uid) {
        await drainMainRuntimeForTest(uid);
        report.sourceConfigUnchanged = Object.entries(originalConfigHashes).every(([name, expected]) => hash(fs.readFileSync(path.join(sourceConfig, name))) === expected);
      }
    } finally {
      vi.useRealTimers(); vi.restoreAllMocks();
      report.finishedAt = new Date().toISOString();
      report.passed = report.passed === true && report.sourceConfigUnchanged === true;
      if (root) { fs.rmSync(root, { recursive: true, force: true }); report.disposableDataRemoved = !fs.existsSync(root); }
      try {
        if (reportWritable) {
          fs.writeFileSync(reportFile, JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 });
          fs.chmodSync(reportFile, 0o400);
          process.stdout.write(`[standing-continuity-live] immutable-report ${reportFile}\n`);
        }
      } finally {
        if (isolationStarted) {
          if (priorRoot === undefined) delete process.env.COGSEED_WORKSPACE_ROOT; else process.env.COGSEED_WORKSPACE_ROOT = priorRoot;
          if (priorTZ === undefined) delete process.env.TZ; else process.env.TZ = priorTZ;
        }
      }
    }
    expect(report.sourceConfigUnchanged).toBe(true);
  });
  it('完整详情人审和真实自动更新均在普通无选择回答中使用新版本', async () => {
    try {
      const assets = await import('../../src/main/features/recall/asset-service');
      const settings = await import('../../src/main/features/recall/capture-settings');
      const candidates = await import('../../src/main/features/recall/candidate-service');
      const prompt = await import('../../src/main/features/recall/prompt-injection');
      const sourceText = `从${time(0, 10).slice(0, 10)}起，我本人的长期表达偏好是：以后回答我的复杂技术问题时先直接说明结论，再解释关键理由与依据；不要先铺很长的背景，保留必要证据，并明确标注尚未验证的内容。这项偏好仅适用于给我解释复杂技术问题，不推断其他人的偏好，也不改写引用原文；没有证据表明它已产生更好的效果。`;
      await sourceConversation('synthetic-continuity-human-source', 'synthetic-continuity-human-message', sourceText, 0);
      const first = await runNight('synthetic-continuity-human-source', 0);
      let candidate = first.candidates.find(row => row.status === 'pending_review' && row.contentCategory === 'preference');
      expect(candidate, 'actual formation must provide a genuine preference; no synthetic proposal replaces model output').toBeDefined();
      if (candidate?.ontologyFormation?.blockedReasons.length) {
        // Exercise the real human review action once, retaining the initial
        // blocked proposal. The fixture cannot repair fields or clear gates.
        const before = candidateView(candidate);
        record('actual-manual-dependency-recheck-started', { before, attempts: 1, nativeUIClicked: false });
        const { recheckOntologyFormation } = await import('../../src/main/features/recall/ontology-formation-recheck');
        candidate = await recheckOntologyFormation(uid, candidate.id);
        record('actual-manual-dependency-recheck', { before, after: candidateView(candidate),
          originalBodyUnchanged: candidate.judgment === before.judgment, attempts: 1, nativeUIClicked: false });
        expect(candidate.judgment).toBe(before.judgment);
      }
      expect(candidate!.ontologyFormation?.previewChanges.map(row => row.box),
        'this acceptance requires genuine A expression evidence and R guidance, not just a cognition body')
        .toEqual(expect.arrayContaining(['A', 'R']));
      const saved = await candidates.promoteRecallCandidate(uid, candidate!.id, { actor: 'user' });
      const rootAsset = saved.asset;
      const { readReviewDecision } = await import('../../src/main/features/cognition/review-decision');
      expect(await readReviewDecision(uid, `recall_candidate:${candidate!.id}`, rootAsset.reviewDecisionId!)).toMatchObject({ actor: 'user', asset_id: rootAsset.id });
      const reviewedBody = `${rootAsset.statement}\n回答的两个部分分别使用“结论”和“关键原因”作为标题。`;
      const reviewed = await assets.saveUserStandingPreferenceDetails(uid, rootAsset.id, {
        statement: reviewedBody, applicableWhen: rootAsset.applicableWhen || [], forbiddenWhen: rootAsset.forbiddenWhen || [],
        expectedVersion: rootAsset.version, expectedActiveVersion: rootAsset.activeVersion || rootAsset.version,
        reason: '隔离验收用户完整审阅并保存新正文与全部条件',
      });
      expect(reviewed.version).not.toBe(rootAsset.version);
      record('actual-complete-human-details-save', { asset: reviewed, caller: 'trusted production details API', nativeUIClicked: false });
      const useCheckFailures: string[] = [];
      const use = async (asset: typeof reviewed, key: string, taskText: string) => {
        const chats = await import('../../src/main/features/chats');
        const cid = `synthetic-continuity-use-${key}`, taskRunId = `synthetic-continuity-run-${key}`, messageId = `synthetic-continuity-answer-${key}`;
        await chats.createConversation(uid, { conversationId: cid, title: '隔离普通下一轮默认偏好验收' });
        const context = await prompt.buildRecallTurnPromptContext(uid, { cid, taskRunId, taskText, agentId: 'commander', conversationKind: 'normal' });
        expect(context.citations).toContainEqual(expect.objectContaining({ assetId: asset.id, version: asset.version, matchMethod: 'standing_preference' }));
        const { readContextProjection } = await import('../../src/main/features/recall/context-projection');
        const projection = await readContextProjection(uid, context.citations.find(row => row.assetId === asset.id)!.projectionId);
        expect(projection).toMatchObject({ authorization: 'not_required', status: 'confirmed', assetVersions: { [asset.id]: asset.version } });
        const { buildRunner } = await import('../../src/main/model/core-agent/runner');
        const runner = await buildRunner({ userId: uid, cid, turnId: taskRunId, taskRunId, sessionId: `one-shot-${taskRunId}`,
          modelCandidates: report.modelCandidates, ephemeralSession: true, disableTools: true, skillList: [],
          systemPrompt: `请用中文回答当前问题，遵守已经确认且适用的用户认知。只回答问题，保留未验证的判断。\n${context.promptBlock}` });
        const result = await runner.runner.run({ message: taskText, cacheRetention: 'none' });
        expect(result.meta.error).toBeFalsy(); expect(result.text.trim()).not.toBe('');
        const { appendJsonlAtomic } = await import('../../src/main/storage');
        const { conversationMessageFile } = await import('../../src/main/util/project-layout');
        const { appendVisible } = await import('../../src/main/features/group_chat/visibility');
        const message: GroupMessage = { id: messageId, from: 'commander', to: ['user'], text: result.text, turn_id: taskRunId, ts: new Date().toISOString() };
        await appendJsonlAtomic(conversationMessageFile(uid, cid), message); await appendVisible(uid, cid, message, ['commander']);
        await chats.updateConversation(uid, cid, {});
        // Mirror the real host reply completion boundary: the unchanged output
        // was generated with these exact citations and is now durably saved.
        // Prompt preparation alone is not an actual injection observation.
        const { recordInjectionReceipt } = await import('../../src/main/features/recall/injection-receipt');
        const injections = [];
        for (const citation of context.citations) injections.push(await recordInjectionReceipt(uid, {
          taskRunId, projectionId: citation.projectionId, assetId: citation.assetId, assetVersion: citation.version,
          boundary: 'real', status: 'injected', channel: 'projection', messageId,
        }));
        const { checkPersistedCognitionOutput } = await import('../../src/main/features/recall/cognition-output-check');
        const check = await checkPersistedCognitionOutput(uid, { cid, taskRunId, messageId, taskText });
        const { listAssetUsageReceipts } = await import('../../src/main/features/recall/asset-usage-receipt');
        const usage = await listAssetUsageReceipts(uid);
        record(`ordinary-actual-use-${key}`, { projection, citations: context.citations, output: result.text,
          provider: runner.providerId, model: runner.modelId, check, usage: usage.filter(row => row.taskRunId === taskRunId),
          injections, explicitAssetIds: [], committedProjectionSupplied: false, outputUnaltered: true });
        try {
          expect(check?.modelCompleted).toBe(true);
          expect(check?.outputHash).toBe(hash(result.text)); expect(check?.taskHash).toBe(hash(taskText));
          expect(check?.checks).toContainEqual(expect.objectContaining({ assetId: asset.id, version: asset.version, status: 'complied' }));
          expect(usage).toContainEqual(expect.objectContaining({ assetId: asset.id, assetVersion: asset.version, taskRunId,
            injectionReceiptId: injections.find(row => row.assetId === asset.id)!.id, outputCheckReceiptId: check!.id,
            messageId, outputHash: hash(result.text), status: 'applied', observationMethod: 'model_assisted', evidenceKind: 'final_output' }));
        } catch (error) {
          // A failed observation must still fail this whole acceptance, while
          // allowing independent later formation/use stages to be measured.
          const failure = `${key}: ${(error as Error).message}`;
          useCheckFailures.push(failure);
          record('ordinary-actual-use-not-verified', { key, failure, gatesChanged: false });
        }
        expect(await assets.readAbilityAsset(uid, asset.id)).toMatchObject({ maturity: 'bud', lifecycleStatus: 'user_confirmed_unverified' });
        return { context, check };
      };
      await use(reviewed, 'details', '复杂技术问题：小团队管理运行时数据时，集中式写入口有什么作用？请给出判断和关键原因。');
      vi.setSystemTime(new Date(time(1, 9)));
      const grant = await settings.updateRecallCaptureSettings(uid, { autoApproval: true });
      expect(grant.autoApprovalEpoch).toBeTruthy();
      await sourceConversation('synthetic-continuity-auto-source', 'synthetic-continuity-auto-message',
        `从${time(1, 10).slice(0, 10)}起，更新我已经保存的复杂技术回答偏好：一般复杂技术问题依然先说明结论，再解释关键理由与依据，两个部分继续分别用“结论”和“关键原因”标题；但排查故障时先列出已观察到的证据和待确认点，再给诊断结论。只在排查故障时采用这个例外，不改变一般问题的顺序。保留必要证据和未验证标记，不先铺很长背景，不推断别人的偏好；这只是我的长期要求，没有证据表明效果已经改善。`, 1);
      const second = await runNight('synthetic-continuity-auto-source', 1);
      const { validatePromotionByAssetType } = await import('../../src/main/features/recall/formal-assets/promotion');
      record('actual-automatic-update-results', { candidates: second.candidates.map(candidate => ({
        ...candidateView(candidate),
        promotionValidation: validatePromotionByAssetType(candidate, { actor: 'system' }),
      })) });
      const automatic = second.candidates.find(row => row.status === 'confirmed' && row.targetAssetId === rootAsset.id && row.autoReview?.eligible === true);
      expect(automatic, 'actual gates must approve a genuine update of the human-rooted preference; held reasons remain in immutable report').toBeDefined();
      expect(automatic!.ontologyFormation?.previewChanges.map(row => row.box),
        'the dated preference update must retain actual joint A/R changes')
        .toEqual(expect.arrayContaining(['A', 'R']));
      const current = await assets.readAbilityAsset(uid, rootAsset.id);
      expect(current.version).not.toBe(reviewed.version);
      expect(await readReviewDecision(uid, `recall_candidate:${automatic!.id}`, current.reviewDecisionId!)).toMatchObject({ actor: 'system', asset_id: rootAsset.id });
      const support = (await records('automatic-source-support')).filter(row => row?.candidateId === automatic!.id);
      expect(support).toContainEqual(expect.objectContaining({ modelCompleted: true, method: 'model_assisted' }));
      record('actual-automatic-continuation-commit', { asset: current, candidate: candidateView(automatic!), support });
      await settings.updateRecallCaptureSettings(uid, { autoApproval: false });
      await use(current, 'automatic', '请分析这个故障：日志显示14:03数据库连接等待超时，14:04重试成功；还没有查连接池占用量，也没有证据表明数据库服务宕机。请给出诊断，并保留尚未确认的判断。');
      const beforeVersion = current.version, beforeSupport = support.length;
      const policy = await import('../../src/main/features/recall/nightly-automatic-approval');
      const repeated = await policy.tryAutomaticallyApproveRecallCandidate(uid, automatic!.id);
      expect(repeated.approved).toBe(false); expect((await assets.readAbilityAsset(uid, current.id)).version).toBe(beforeVersion);
      expect((await records('automatic-source-support')).filter(row => row?.candidateId === automatic!.id)).toHaveLength(beforeSupport);
      const { listValidationRecords } = await import('../../src/main/features/recall/validation-service');
      const { listTransferProofs, listEffectivenessProofs } = await import('../../src/main/features/recall/proof-service');
      expect(await listValidationRecords(uid)).toEqual([]); expect(await listTransferProofs(uid)).toEqual([]);
      expect(await listEffectivenessProofs(uid)).toEqual([]);
      record('no-effect-upgrade', { validationCount: 0, transferProofCount: 0, effectivenessProofCount: 0 });
      expect(useCheckFailures, 'both actual output checks and exact adoption receipts must pass').toEqual([]);
      report.passed = true; report.cases.push({ name: 'human full details save and genuine automatic update ordinary next-turn continuity', passed: true });
    } catch (error) {
      report.passed = false; report.cases.push({ name: 'human full details save and genuine automatic update ordinary next-turn continuity', passed: false,
        failure: error instanceof Error ? error.message : 'live acceptance failed' });
      throw error;
    }
  }, 0);
});
