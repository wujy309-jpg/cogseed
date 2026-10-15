/** Opt-in production automatic-confirmation acceptance. Every source, capture,
 * permission, model call and review receipt is real within a disposable root.
 * Only encrypted auth config is copied opaquely; no formal user cognition is read.
 * Run once with COGSEED_LIVE_COGNITION_AUTOMATIC=1 and explicit source config/uid.
 * The immutable /tmp report distinguishes fixture structure from model formation. */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import type { RecallCandidateRecord } from '../../src/main/features/recall/candidate-service';
import type { GroupMessage } from '../../src/main/features/group_chat/types';
import { drainMainRuntimeForTest } from '../helpers/drain-main-runtime';

const suite = process.env.COGSEED_LIVE_COGNITION_AUTOMATIC === '1' ? describe : describe.skip;
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
  process.stdout.write(`[cognition-automatic-live] ${stage}\n`);
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

suite('真实模型自动确认：隔离来源、系统审计与授权生命周期', () => {
  beforeAll(async () => {
    sourceConfig = process.env.COGSEED_LIVE_SOURCE_CONFIG_DIR || ''; uid = process.env.COGSEED_LIVE_SOURCE_UID || '';
    if (!sourceConfig || !uid || path.basename(uid) !== uid || uid === '.' || uid === '..') throw new Error('explicit opaque auth config source and owner uid required');
    reportFile = process.env.COGSEED_LIVE_AUTOMATIC_REPORT || `/tmp/cogseed-cognition-automatic-live-${randomUUID()}.json`;
    if (!path.isAbsolute(reportFile) || !path.resolve(reportFile).startsWith('/tmp/') || fs.existsSync(reportFile)) {
      throw new Error('automatic live report must be a fresh immutable /tmp file');
    }
    reportWritable = true;
    priorRoot = process.env.COGSEED_WORKSPACE_ROOT; priorTZ = process.env.TZ;
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'cogseed-cognition-automatic-live-'));
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
    const grant = await settings.updateRecallCaptureSettings(uid, { enabled: true, autoApproval: true, executionPolicy: 'nightly',
      nightlyStart: '02:00', nightlyEnd: '06:00', modelCandidates });
    expect(grant.autoApprovalEpoch).toBeTruthy(); expect(grant.autoApprovalEnabledAt).toBeTruthy();
    report.ownerHash = hash(uid); report.modelCandidates = modelCandidates;
    record('isolated-explicit-setup', { formalAssetsSeeded: 0, structureSeed: { T: 3, ACurrentSyntheticSelfIdentity: 1,
      modelFormed: false, source: 'explicit synthetic test setup', ruleRecordsSeeded: 0 }, freshAutomaticGrant: true });
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
      try {
        if (reportWritable) {
          fs.writeFileSync(reportFile, JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 });
          fs.chmodSync(reportFile, 0o400);
          process.stdout.write(`[cognition-automatic-live] immutable-report ${reportFile}\n`);
        }
      } finally {
        if (isolationStarted) {
          if (priorRoot === undefined) delete process.env.COGSEED_WORKSPACE_ROOT; else process.env.COGSEED_WORKSPACE_ROOT = priorRoot;
          if (priorTZ === undefined) delete process.env.TZ; else process.env.TZ = priorTZ;
        }
        if (root) fs.rmSync(root, { recursive: true, force: true });
      }
    }
    expect(report.sourceConfigUnchanged).toBe(true);
  });
  it('自动保存至少一条无冲突真实偏好，保持未验证效果，幂等并拒绝向旧候选追授授权', async () => {
    try {
      const sourceText = `从${time(0, 10).slice(0, 10)}起，我本人的长期表达偏好是：以后回答我的复杂技术问题时先直接说明结论，再解释关键理由与依据；不要先铺很长的背景，但必须保留必要证据，并明确标注尚未验证的内容。这项偏好仅适用于给我解释复杂技术问题，不推断其他人的偏好，也不改写引用原文；没有证据表明它已产生更好的效果。`;
      const source = await sourceConversation('synthetic-automatic-positive', 'synthetic-automatic-positive-user', sourceText, 0);
      report.liveModelAttemptRequested = true;
      const positive = await runNight('synthetic-automatic-positive', 0);
      const confirmed = positive.candidates.filter(row => row.status === 'confirmed' && row.autoReview?.eligible === true);
      report.actualHolds = positive.candidates.filter(row => row.status !== 'confirmed').map(row => ({ id: row.id,
        reasons: row.autoReview?.reasons || [], requiresTReview: row.ontologyFormation?.requiresTReview,
        blockedReasons: row.ontologyFormation?.blockedReasons || [] }));
      expect(confirmed.length, 'actual production automation held this source; immutable report retains true reasons, no gate bypass or forced saving').toBeGreaterThan(0);
      const candidate = confirmed[0]!;
      expect(candidate.risk).toBe('low'); expect(candidate.userModifiedAt).toBeUndefined();
      expect(candidate.captureProvenance?.pipeline).toBe('nightly_conversation');
      expect(candidate.captureProvenance?.valueJudgment.eligible).toBe(true);
      expect(candidate.sourceRefs.some(ref => ref.kind === 'conversation' && ref.subtype === 'message' && !ref.degraded)).toBe(true);
      const { readReviewDecision, listReviewDecisions } = await import('../../src/main/features/cognition/review-decision');
      const decision = await readReviewDecision(uid, `recall_candidate:${candidate.id}`, candidate.reviewDecisionId);
      expect(decision).toMatchObject({ actor: 'system', decision_type: 'accept', decision: 'automatic low-risk approval', asset_id: candidate.promotedAssetId });
      const assets = await import('../../src/main/features/recall/asset-service');
      const asset = await assets.readAbilityAsset(uid, candidate.promotedAssetId!);
      expect(asset).toMatchObject({ statement: candidate.judgment, maturity: 'seed', lifecycleStatus: 'automatically_extracted_unverified', version: '1' });
      expect(asset.validationCount || 0).toBe(0); expect(asset.appliedValidationIds || []).toEqual([]);
      expect(candidate.validationCount || 0).toBe(0);
      const receipts = (await records('automatic-source-support')).filter(row => row?.candidateId === candidate.id);
      expect(receipts.length).toBeGreaterThan(0);
      const proof = receipts[0]!;
      expect(proof).toMatchObject({ method: 'model_assisted', modelCompleted: true, policyEpoch: candidate.autoReview!.policyEpoch });
      for (const field of ['fingerprint', 'sourceDigest', 'summaryDigest']) expect(proof[field]).toMatch(/^[a-f0-9]{64}$/);
      const evidence = proof.evidence as Array<{ messageId: string; start: number; end: number; quoteHash: string }>;
      expect(evidence.length).toBeGreaterThan(0);
      for (const ref of evidence) {
        const message = source.find(row => row.id === ref.messageId && row.from === 'user');
        expect(message).toBeDefined(); expect(Number.isInteger(ref.start) && Number.isInteger(ref.end)).toBe(true);
        expect(ref.start).toBeGreaterThanOrEqual(0); expect(ref.end).toBeGreaterThan(ref.start);
        expect(ref.end).toBeLessThanOrEqual(message!.text.length);
        expect(hash(message!.text.slice(ref.start, ref.end))).toBe(ref.quoteHash);
      }
      expect(JSON.stringify(proof)).not.toContain(sourceText);
      const { listValidationRecords } = await import('../../src/main/features/recall/validation-service');
      const { listTransferProofs, listEffectivenessProofs } = await import('../../src/main/features/recall/proof-service');
      const { listAssetUsageReceipts } = await import('../../src/main/features/recall/asset-usage-receipt');
      expect(await listValidationRecords(uid)).toEqual([]); expect(await listTransferProofs(uid)).toEqual([]);
      expect(await listEffectivenessProofs(uid)).toEqual([]); expect(await listAssetUsageReceipts(uid)).toEqual([]);
      record('actual-automatic-commit', { candidate: candidateView(candidate), asset: { id: asset.id, statement: asset.statement,
        lifecycleStatus: asset.lifecycleStatus, maturity: asset.maturity, validationCount: asset.validationCount || 0 },
        systemDecision: { id: decision!.decision_id, actor: decision!.actor, type: decision!.decision_type, decision: decision!.decision, assetId: decision!.asset_id },
        support: { id: proof.id, method: proof.method, modelCompleted: proof.modelCompleted, fingerprint: proof.fingerprint,
          sourceDigest: proof.sourceDigest, summaryDigest: proof.summaryDigest, evidence }, noExecutionEffectOrValidationProofs: true });
      const policy = await import('../../src/main/features/recall/nightly-automatic-approval');
      const beforeAssets = (await assets.listAbilityAssets(uid)).map(row => row.id).sort();
      const beforeDecisions = await listReviewDecisions(uid, `recall_candidate:${candidate.id}`);
      const proofCount = (await records('automatic-source-support')).length;
      for (let attempt = 0; attempt < 2; attempt++) {
        const repeated = await policy.tryAutomaticallyApproveRecallCandidate(uid, candidate.id);
        expect(repeated.approved).toBe(false); expect(repeated.candidate.status).toBe('confirmed');
        expect(repeated.asset?.id || repeated.candidate.promotedAssetId).toBe(asset.id);
      }
      expect((await assets.listAbilityAssets(uid)).map(row => row.id).sort()).toEqual(beforeAssets);
      expect(await listReviewDecisions(uid, `recall_candidate:${candidate.id}`)).toEqual(beforeDecisions);
      expect((await records('automatic-source-support')).length).toBe(proofCount);
      record('automatic-idempotence', { calls: 2, newAssets: 0, newDecisions: 0, newSupportChecks: 0 });
      const settings = await import('../../src/main/features/recall/capture-settings');
      await settings.updateRecallCaptureSettings(uid, { autoApproval: false });
      await sourceConversation('synthetic-automatic-optout', 'synthetic-automatic-optout-user',
        '我的长期个人草稿命名偏好是：以后给我整理的个人草稿文件，名称采用日期在前、主题在后的格式，便于按日期找到对应材料；仅对个人草稿适用，不改变已发布的文件名，也不推断别人的命名偏好。', 1);
      const optedOut = await runNight('synthetic-automatic-optout', 1);
      const old = optedOut.candidates.find(row => row.status === 'pending_review');
      expect(old, 'expected genuine model-formed unconfirmed candidate under opt-out').toBeDefined();
      expect(optedOut.captures.every(row => !row.autoApprovalEpoch)).toBe(true);
      const closed = await policy.tryAutomaticallyApproveRecallCandidate(uid, old!.id);
      expect(closed.approved).toBe(false); expect(closed.reasons).toContain('automatic_confirmation_disabled');
      const newGrant = await settings.updateRecallCaptureSettings(uid, { autoApproval: true });
      expect(newGrant.autoApprovalEpoch).not.toBe(candidate.autoReview!.policyEpoch);
      const retroactive = await policy.tryAutomaticallyApproveRecallCandidate(uid, old!.id);
      expect(retroactive.approved).toBe(false); expect(retroactive.reasons).toContain('automatic_confirmation_grant_expired');
      expect(retroactive.candidate.status).toBe('pending_review');
      expect((await assets.listAbilityAssets(uid)).map(row => row.id).sort()).toEqual(beforeAssets);
      expect((await records('automatic-source-support')).length).toBe(proofCount);
      expect(await listReviewDecisions(uid, `recall_candidate:${old!.id}`)).toEqual([]);
      record('automatic-authorization-lifecycle', { oldCandidate: candidateView(retroactive.candidate), closedReasons: closed.reasons,
        reenabledReasons: retroactive.reasons, grantChanged: true, newAssets: 0, retroactivePermission: false });
      report.passed = true; report.cases.push({ name: 'actual automatic confirmation and grant lifecycle', passed: true });
    } catch (error) {
      report.passed = false; report.cases.push({ name: 'actual automatic confirmation and grant lifecycle', passed: false,
        failure: error instanceof Error ? error.message : 'live acceptance failed' });
      throw error;
    }
  }, 0);
});
