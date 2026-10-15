/** Opt-in synthetic quality acceptance using production summary/value/extraction.
 * Encrypted auth is copied opaquely into a disposable root with the same uid.
 * Failures are observations: never change production gates to make samples pass. */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import type { RecallCandidateRecord } from '../../src/main/features/recall/candidate-service';
import type { GroupMessage } from '../../src/main/features/group_chat/types';
const suite = process.env.COGSEED_LIVE_COGNITION_QUALITY === '1' ? describe : describe.skip;
let root = '', uid = '', priorRoot: string | undefined, priorTZ: string | undefined;
let stop: (() => void) | undefined;
const configHashes: Record<string, string> = {};
const report: Record<string, any> = { synthetic: true, model: 'zai/glm-5.2', cases: [], stages: [] };
const hash = (text: Buffer | string) => createHash('sha256').update(text).digest('hex');
function persist() { if (process.env.COGSEED_LIVE_QUALITY_REPORT) fs.writeFileSync(process.env.COGSEED_LIVE_QUALITY_REPORT, JSON.stringify(report, null, 2)); }
function record(stage: string, data: Record<string, unknown>) { report.stages.push({ stage, ...data }); persist(); process.stdout.write(`[cognition-quality-live] ${stage}\n`); }
const dayTime = (day: number, hour = 10) => `2026-09-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00+08:00`;
async function append(cid: string, id: string, text: string, from = 'user') {
  const { appendJsonlAtomic } = await import('../../src/main/storage');
  const { conversationMessageFile } = await import('../../src/main/util/project-layout');
  const { appendVisible } = await import('../../src/main/features/group_chat/visibility');
  const chats = await import('../../src/main/features/chats');
  const message: GroupMessage = { id, ts: new Date().toISOString(), from, to: [from === 'user' ? 'commander' : 'user'], text };
  await appendJsonlAtomic(conversationMessageFile(uid, cid), message);
  await appendVisible(uid, cid, message, ['commander']);
  await chats.updateConversation(uid, cid, {});
}
async function discover(key: string, day: number, messages: string[], assistantText = '我理解以上内容；后续以你明确的最终决定及适用边界为准。') {
  const chats = await import('../../src/main/features/chats');
  const captures = await import('../../src/main/features/recall/capture-service');
  const { recallJsonRecordPath } = await import('../../src/main/features/recall/paths');
  const { readRecallCaptureSettings } = await import('../../src/main/features/recall/capture-settings');
  const candidates = await import('../../src/main/features/recall/candidate-service');
  const cid = 'synthetic-quality-' + key;
  vi.setSystemTime(new Date(dayTime(day)));
  await chats.createConversation(uid, { conversationId: cid, title: '隔离质量验收：' + key });
  for (const [index, text] of messages.entries()) await append(cid, `${key}-message-${index}`, text);
  await append(cid, key + '-assistant', assistantText, 'commander');
  vi.setSystemTime(new Date(dayTime(day + 1, 3)));
  const sweep = await captures.runNightlyCaptureSweep(uid, dayTime(day + 1, 3), await readRecallCaptureSettings(uid));
  const folder = path.dirname(recallJsonRecordPath(uid, 'captures', 'probe'));
  const readAll = async () => Promise.all((fs.existsSync(folder) ? fs.readdirSync(folder).filter(name => name.endsWith('.json')) : []).map(name => captures.readRecallCapture(uid, name.slice(0, -5))));
  const own = (await readAll()).filter(capture => capture.conversationId === cid);
  for (const capture of own.filter(capture => capture.status === 'queued')) await captures.runRecallCapture(uid, capture.id);
  const finalCaptures = (await readAll()).filter(capture => capture.conversationId === cid);
  const ids = new Set(finalCaptures.flatMap(capture => capture.candidateIds || []));
  const ownCandidates = (await candidates.listRecallCandidates(uid)).filter(candidate => ids.has(candidate.id));
  record(key, { cid, sweep, captures: finalCaptures, candidates: ownCandidates });
  expect(sweep.ran).toBe(true);
  return { cid, captures: finalCaptures, candidates: ownCandidates };
}
function pending(sample: Awaited<ReturnType<typeof discover>>): RecallCandidateRecord {
  const rows = sample.candidates.filter(candidate => candidate.status === 'pending_review');
  expect(rows.length, 'expected complete pending proposal; see actual capture/model report').toBeGreaterThan(0);
  const row = rows[0]!;
  expect(row.captureProvenance?.pipeline).toBe('nightly_conversation');
  expect(row.captureProvenance?.valueJudgment.eligible).toBe(true);
  expect(row.sourceRefs.some(ref => ref.kind === 'conversation' && ref.subtype === 'message' && !ref.degraded)).toBe(true);
  expect(sample.captures[0]?.contextSummary?.sourceDigest).toMatch(/^[a-f0-9]{64}$/);
  expect(row.judgment.trim()).not.toBe(''); expect(row.value.trim()).not.toBe('');
  return row;
}
async function confirm(row: RecallCandidateRecord) {
  expect(row.ontologyFormation?.blockedReasons || []).toEqual([]);
  const { promoteRecallCaptureCandidate } = await import('../../src/main/features/recall/capture-service');
  if (row.risk === 'high') {
    const { listAbilityAssets } = await import('../../src/main/features/recall/asset-service');
    const before = await listAbilityAssets(uid);
    await expect(promoteRecallCaptureCandidate(uid, row.id)).rejects.toThrow('high-risk candidate requires an independent risk gate');
    expect(await listAbilityAssets(uid)).toEqual(before);
    record('synthetic-high-risk-explicit-confirmation', { candidateId: row.id, declinedWithoutAcknowledgment: true, fixtureActor: 'authorized isolated test stand-in for manual risk confirmation', actualUiClicked: false });
  }
  const result = await promoteRecallCaptureCandidate(uid, row.id, row.risk === 'high' ? { riskAcknowledged: true } : {});
  record('confirmed-' + row.id, { asset: result.asset });
  return result.asset;
}
async function confirmUpdate(saved: Awaited<ReturnType<typeof confirm>>, row: RecallCandidateRecord, key: string, mode: 'correction' | 'change') {
  const assets = await import('../../src/main/features/recall/asset-service');
  const { readOntologyDocument } = await import('../../src/main/features/cognition/ontology/service');
  const originalSnapshot = await assets.readAbilityAssetVersionSnapshot(uid, saved.id, saved.version);
  expect(originalSnapshot).not.toBeNull();
  const beforeOntology = readOntologyDocument(uid);
  const updated = await confirm(row);
  const current = await assets.readAbilityAsset(uid, saved.id);
  const versions = await assets.listAbilityAssetVersions(uid, saved.id);
  const afterOntology = readOntologyDocument(uid);
  record('saved-update-' + key, { updated, versions, ontology: afterOntology, beforeOntology });
  expect(updated.id).toBe(saved.id);
  expect(updated.version).not.toBe(saved.version);
  expect(current.version).toBe(updated.version);
  expect(current.activeVersion).toBe(updated.version);
  expect(current.statement).toBe(row.judgment);
  expect(versions.some(version => version.version === saved.version)).toBe(true);
  expect(versions.some(version => version.version === updated.version)).toBe(true);
  expect(await assets.readAbilityAssetVersionSnapshot(uid, saved.id, saved.version)).toEqual(originalSnapshot);
  // Inspect only the actual model proposal; do not fabricate A/T coverage for a cognition-only proposal.
  for (const action of row.ontologyFormation?.actions || []) {
    if (action.intent !== 'change' && action.intent !== 'correct') continue;
    expect(action.intent).toBe(mode === 'change' ? 'change' : 'correct');
    const old = beforeOntology.records[action.recordId];
    const revised = afterOntology.records[action.recordId];
    const successor = Object.values(afterOntology.records).find(record => record.kind === 'assertion' && record.supersedesId === action.recordId);
    expect(old?.kind).toBe('assertion');
    expect(revised?.kind).toBe('assertion');
    expect(successor?.kind).toBe('assertion');
    if (old?.kind !== 'assertion' || revised?.kind !== 'assertion' || successor?.kind !== 'assertion') throw new Error('proposed A change must have a persisted original and successor');
    expect(afterOntology.history.some(history => history.before?.id === old.id && history.before.version === old.version)).toBe(true);
    if (action.intent === 'change') {
      expect(action.effectiveFrom).toBe('2026-09-24');
      expect(revised.status).toBe('active');
      expect(revised.validity.until).toBe(action.effectiveFrom);
      expect(successor.validity.from).toBe(action.effectiveFrom);
      expect(successor.validity.until).toBe(old.validity.until);
    } else {
      expect(revised.status).toBe('corrected');
      expect(successor.validity).toEqual(old.validity);
    }
  }
  record('saved-update-assertions-' + key, { sameAsset: true, oldVersion: saved.version, newVersion: updated.version, immutableOldSnapshot: true, actualAIntents: row.ontologyFormation?.actions.filter(action => action.intent === 'change' || action.intent === 'correct').map(action => action.intent) || [] });
  return updated;
}
async function use(assetId: string, key: string, taskText: string, options: { ordinary?: boolean } = {}) {
  const chats = await import('../../src/main/features/chats');
  const cid = 'synthetic-quality-use-' + key, taskRunId = 'quality-run-' + key, messageId = 'quality-output-' + key;
  await chats.createConversation(uid, { conversationId: cid, title: '隔离实际使用：' + key });
  const { previewContextProjection } = await import('../../src/main/features/recall/context-projection');
  const { buildRecallTurnPromptContext } = await import('../../src/main/features/recall/prompt-injection');
  const { readAbilityAsset } = await import('../../src/main/features/recall/asset-service');
  const asset = await readAbilityAsset(uid, assetId);
  let projection: Awaited<ReturnType<typeof previewContextProjection>>;
  let context: Awaited<ReturnType<typeof buildRecallTurnPromptContext>>;
  if (options.ordinary) {
    context = await buildRecallTurnPromptContext(uid, { cid, taskRunId, taskText, agentId: 'commander', conversationKind: 'normal' });
    expect(context.citations.some(citation => citation.assetId === assetId)).toBe(true);
    const { readContextProjection } = await import('../../src/main/features/recall/context-projection');
    projection = await readContextProjection(uid, context.citations.find(citation => citation.assetId === assetId)!.projectionId);
    expect(projection.authorization).toBe('not_required');
    expect(context.citations.find(citation => citation.assetId === assetId)?.matchMethod).toBe('standing_preference');
  } else {
    projection = await previewContextProjection(uid, { taskRunId, taskText, purpose: asset.scope, authorization: 'user_confirmed', confirm: true, conversationId: cid, explicitAssetIds: [assetId] });
    context = await buildRecallTurnPromptContext(uid, { cid, taskRunId, taskText, committedProjectionId: projection.id });
  }
  record('actual-context-' + key, { citationCount: context.citations.length, projectionStatus: projection.status, projectionAuthorization: projection.authorization, mode: options.ordinary ? 'ordinary_unpinned' : 'explicit_selection', context, projection });
  expect(context.citations.some(citation => citation.assetId === assetId)).toBe(true);
  const { buildRunner } = await import('../../src/main/model/core-agent/runner');
  const { runner } = await buildRunner({ userId: uid, cid, turnId: taskRunId, taskRunId, sessionId: 'one-shot-' + taskRunId, ephemeralSession: true, disableTools: true, skillList: [], modelCandidates: [{ provider: 'zai', model: 'glm-5.2' }], systemPrompt: '请按已经确认且适用的认知回答当前任务，不声称业务效果已验证。\n' + context.promptBlock });
  const output = await runner.run({ message: taskText, cacheRetention: 'none' });
  record('actual-output-' + key, { output: output.text, error: output.meta.error, citations: context.citations });
  expect(output.meta.error).toBeFalsy();
  const { appendJsonlAtomic } = await import('../../src/main/storage');
  const { conversationMessageFile } = await import('../../src/main/util/project-layout');
  const message: GroupMessage = { id: messageId, ts: new Date().toISOString(), from: 'commander', to: ['user'], text: output.text, turn_id: taskRunId };
  await appendJsonlAtomic(conversationMessageFile(uid, cid), message);
  const { recordInjectionReceipt } = await import('../../src/main/features/recall/injection-receipt');
  const citation = context.citations.find(item => item.assetId === assetId)!;
  await recordInjectionReceipt(uid, { assetId, assetVersion: citation.version, taskRunId, messageId, projectionId: projection.id, channel: 'projection', boundary: 'real', status: 'injected' });
  const { checkPersistedCognitionOutput } = await import('../../src/main/features/recall/cognition-output-check');
  const check = await checkPersistedCognitionOutput(uid, { cid, taskRunId, messageId, taskText });
  record('actual-check-' + key, { check });
  expect(check?.modelCompleted).toBe(true); expect(check?.checks.find(item => item.assetId === assetId)?.status).toBe('complied');
  const { listAssetUsageReceipts } = await import('../../src/main/features/recall/asset-usage-receipt');
  const usage = await listAssetUsageReceipts(uid, taskRunId);
  record('actual-adoption-' + key, { usage });
  expect(usage).toEqual([expect.objectContaining({ assetId, assetVersion: citation.version, status: 'applied', observationMethod: 'model_assisted', messageId, outputCheckReceiptId: check!.id })]);
  expect(citation.version).toBe(asset.activeVersion || asset.version);
  return { text: output.text, citation, check };
}

suite('真实模型扩展认知质量覆盖（隔离合成材料）', () => {
  beforeAll(async () => {
    const source = process.env.COGSEED_LIVE_SOURCE_CONFIG_DIR; uid = process.env.COGSEED_LIVE_SOURCE_UID || '';
    if (!source || !uid) throw new Error('explicit opaque auth config source and uid required');
    priorRoot = process.env.COGSEED_WORKSPACE_ROOT; priorTZ = process.env.TZ;
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'cogseed-cognition-quality-live-'));
    process.env.COGSEED_WORKSPACE_ROOT = root; process.env.TZ = 'Asia/Shanghai'; vi.resetModules();
    const target = path.join(root, uid, 'local/config'); fs.mkdirSync(target, { recursive: true, mode: 0o700 });
    for (const file of ['auth-profiles.json', 'account.json']) {
      const original = path.join(source, file);
      if (fs.existsSync(original)) { configHashes[file] = hash(fs.readFileSync(original)); fs.copyFileSync(original, path.join(target, file)); }
    }
    const { activateUser } = await import('../../src/main/features/users'); activateUser(uid);
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(dayTime(14)));
    const { migrateLegacyCognition } = await import('../../src/main/features/cognition_migration');
    expect((await migrateLegacyCognition(uid, { activate: true })).errors).toEqual([]);
    const capture = await import('../../src/main/features/recall/capture-service'); stop = capture.startRecallCaptureOrchestrator(); stop();
    const { updateRecallCaptureSettings } = await import('../../src/main/features/recall/capture-settings');
    await updateRecallCaptureSettings(uid, { enabled: true, autoApproval: false, executionPolicy: 'nightly', nightlyStart: '02:00', nightlyEnd: '06:00', modelCandidates: [{ provider: 'zai', model: 'glm-5.2' }] });
    const routing = await import('../../src/main/features/recall/capture-model-routing');
    const real = routing.runRecallCaptureModel;
    vi.spyOn(routing, 'runRecallCaptureModel').mockImplementation(async (owner, input) => {
      const result = await real(owner, input);
      record('real-model-response', { sessionId: input.sessionId, chosen: result.chosen, text: result.result.text, error: result.result.meta.error });
      return result;
    });
    record('isolated-setup', { seededFormalCognitionCount: 0, realProvider: 'zai', realModel: 'glm-5.2' });
  });
  afterEach(context => { report.cases.push({ name: context.task.name, state: context.task.result?.state, errors: context.task.result?.errors?.map(error => error.message) }); persist(); });
  afterAll(async () => {
    stop?.();
    const { closeEmbedder } = await import('../../src/main/features/kb_embed'); closeEmbedder();
    report.sourceConfigUnchanged = Object.entries(configHashes).every(([file, value]) => hash(fs.readFileSync(path.join(process.env.COGSEED_LIVE_SOURCE_CONFIG_DIR!, file))) === value);
    vi.useRealTimers(); vi.restoreAllMocks();
    if (priorRoot === undefined) delete process.env.COGSEED_WORKSPACE_ROOT; else process.env.COGSEED_WORKSPACE_ROOT = priorRoot;
    if (priorTZ === undefined) delete process.env.TZ; else process.env.TZ = priorTZ;
    if (root) fs.rmSync(root, { recursive: true, force: true }); report.disposableDataRemoved = true; persist();
  });
  it('模板：完整形成→保存→真实任务遵守检查', async () => {
    const row = pending(await discover('template', 15, ['这是我以后每周交付复盘都用的模板：第一部分本周目标与完成情况；第二部分风险及对应负责人；第三部分下周行动，逐项写负责人和截止日期。用于周报与复盘，不要求日常问答套这个模板。请长期保留这个模板，缺数据时写待确认而不要编造。']));
    expect(row.contentCategory).toBe('template'); expect(row.judgment).toMatch(/负责人/); expect(row.judgment).toMatch(/截止|期限|日期/);
    const saved = await confirm(row);
    await use(saved.id, 'weekly_report', '请写本周交付复盘：目标完成接口迁移，已完成迁移；当前风险是监控尚未覆盖，负责人小林；下周行动补齐监控，负责人小周，截止日期2026-09-21。');
  }, 0);
  it('判断方法：完整形成→保存→真实任务遵守检查', async () => {
    const row = pending(await discover('method', 17, ['以后判断软件故障原因，用这个可复用方法：先将已观察证据和假设分开，再为每个候选原因列一项能区分它和其他原因的验证，优先做成本低且可逆的验证；没有验证前只表达可能性，不直接宣布根因。适用于软件故障定位，不把它当医学诊断方法。长期按这个判断流程帮我排查。']));
    expect(row.contentCategory).toBe('method'); expect(row.judgment).toMatch(/证据/); expect(row.judgment).toMatch(/假设|候选原因/);
    const saved = await confirm(row);
    await use(saved.id, 'fault_method', '这是软件故障定位与排查任务：软件请求偶发超时，日志只有上游等待超过3秒，随后重试成功；还没查连接池和网络。请按已保存方法给排查判断与下一项低成本可逆验证。');
  }, 0);
  it('长期偏好：普通下一轮无手工选择→真实回答遵守→精确版本采用凭证', async () => {
    const row = pending(await discover('standing-preference', 17, ['我长期偏好：以后回答我的复杂技术问题或解释方案时，先给明确结论，再说明关键原因和依据；不要因此省略必要证据。日常问候不需要强制套用这个格式；如果我当前明确要求先展示过程，就按当前要求。请长期保存这个回答偏好。']));
    expect(row.contentCategory).toBe('preference'); expect(row.suggestedType).toBe('cognition');
    const saved = await confirm(row);
    expect(saved.maturity).toBe('bud'); expect(saved.lifecycleStatus).toBe('user_confirmed_unverified');
    const answer = await use(saved.id, 'standing_ordinary', '请解释为什么增加数据库连接池容量可能仍解决不了请求超时，并给一个低成本检查思路。', { ordinary: true });
    expect(answer.text).toMatch(/连接池/);
    const { readAbilityAsset } = await import('../../src/main/features/recall/asset-service');
    expect(await readAbilityAsset(uid, saved.id)).toMatchObject({ maturity: 'bud', appliedValidationIds: [] });
    record('ordinary-standing-verified', { manualPin: false, actualUiClicked: false, priorUserReview: true, unchangedMaturity: 'bud', category: saved.contentCategory, version: answer.citation.version });
  }, 0);
  it('原真实普通偏好答复：坏 JSON 回放→一次真实语法重核→采用凭证', async () => {
    const sourceReport = process.env.COGSEED_LIVE_CHECK_REPLAY_REPORT;
    if (!sourceReport) throw new Error('an immutable original ordinary-use report is required');
    const preservedReports = [sourceReport, ...(process.env.COGSEED_LIVE_PRIOR_CHECK_REPORT ? [process.env.COGSEED_LIVE_PRIOR_CHECK_REPORT] : [])].map(file => ({ file, hash: hash(fs.readFileSync(file)) }));
    const originalBytes = fs.readFileSync(sourceReport);
    const original = JSON.parse(originalBytes.toString('utf8'));
    const saved = original.stages.find((row: any) => row.stage.startsWith('confirmed-'))?.asset;
    const contextStage = original.stages.find((row: any) => row.stage === 'actual-context-standing_ordinary');
    const output = original.stages.find((row: any) => row.stage === 'actual-output-standing_ordinary')?.output;
    const previous = original.stages.find((row: any) => row.stage === 'actual-check-standing_ordinary')?.check;
    const raw = original.stages.find((row: any) => row.stage === 'real-model-response' && row.sessionId === `one-shot-${previous?.id}`);
    const source = original.stages.find((row: any) => row.stage === 'standing-preference');
    const task = '请解释为什么增加数据库连接池容量可能仍解决不了请求超时，并给一个低成本检查思路。';
    expect(original.synthetic).toBe(true); expect(saved.ownerId).toBe(uid);
    expect(previous.modelCompleted).toBe(false); expect(previous.checks[0].status).toBe('unknown');
    expect(hash(output)).toBe(previous.outputHash); expect(hash(task)).toBe(previous.taskHash);
    expect(() => JSON.parse(raw.text)).toThrow(SyntaxError);
    expect(contextStage.projection.authorization).toBe('not_required');
    expect(contextStage.context.citations[0]).toMatchObject({ assetId: saved.id, version: saved.version, matchMethod: 'standing_preference' });
    vi.setSystemTime(new Date(previous.createdAt));
    // Playback of the exact captured host artifacts, not a new human review or
    // a fresh test of standing authorization. No ReviewDecision is fabricated.
    const { replaceCognitionSources } = await import('../../src/main/features/cognition_bridge');
    await replaceCognitionSources(uid, { mode: 'unified', revision: 1, records: { 'ability-assets': { [saved.id]: saved }, candidates: {} }, po: { groups: [], trash: [] }, pendingProjection: false, migratedAt: previous.createdAt });
    const assets = await import('../../src/main/features/recall/asset-service');
    await assets.initializeAbilityAsset(uid, saved, { actor: 'system', reason: '隔离回放原真实保存快照；不创建新人工审阅授权' });
    const beforeSnapshot = await assets.readAbilityAssetVersionSnapshot(uid, saved.id, saved.version);
    expect(beforeSnapshot).toMatchObject({ statement: saved.statement, version: saved.version });
    const chats = await import('../../src/main/features/chats');
    await chats.createConversation(uid, { conversationId: source.cid, title: '隔离回放：原合成偏好来源' });
    await append(source.cid, 'standing-preference-message-0', '我长期偏好：以后回答我的复杂技术问题或解释方案时，先给明确结论，再说明关键原因和依据；不要因此省略必要证据。日常问候不需要强制套用这个格式；如果我当前明确要求先展示过程，就按当前要求。请长期保存这个回答偏好。');
    await append(source.cid, 'standing-preference-assistant', '我理解以上内容；后续以你明确的最终决定及适用边界为准。', 'commander');
    const cid = contextStage.projection.conversationId;
    await chats.createConversation(uid, { conversationId: cid, title: '隔离回放：原真实普通偏好答复' });
    const { writeRecallJsonRecord } = await import('../../src/main/features/recall/store');
    await writeRecallJsonRecord(uid, 'projections', contextStage.projection.id, contextStage.projection);
    const { readContextProjection } = await import('../../src/main/features/recall/context-projection');
    expect(await readContextProjection(uid, contextStage.projection.id)).toEqual(contextStage.projection);
    const { appendJsonlAtomic } = await import('../../src/main/storage');
    const { conversationMessageFile } = await import('../../src/main/util/project-layout');
    await appendJsonlAtomic(conversationMessageFile(uid, cid), { id: previous.messageId, from: 'commander', to: ['user'], text: output, turn_id: previous.taskRunId, ts: previous.createdAt });
    const { recordInjectionReceipt } = await import('../../src/main/features/recall/injection-receipt');
    const injection = await recordInjectionReceipt(uid, { assetId: saved.id, assetVersion: saved.version, taskRunId: previous.taskRunId, messageId: previous.messageId, projectionId: contextStage.projection.id, channel: 'projection', boundary: 'real', status: 'injected' });
    const routing = await import('../../src/main/features/recall/capture-model-routing');
    const spy = vi.mocked(routing.runRecallCaptureModel);
    // Observe only the fields returned by the actual SDK onPayload hook. No
    // key, Authorization header or full/private request is read or recorded.
    const jsonMode = await import('../../src/main/model/core-agent/utility-response-format');
    const compose = jsonMode.composeUtilityResponseFormatOnPayload;
    const observedModes: Array<{ provider: string; api: string | undefined; responseFormat: unknown }> = [];
    vi.spyOn(jsonMode, 'composeUtilityResponseFormatOnPayload').mockImplementation((provider, responseFormat, existingHook) => {
      const hook = compose(provider, responseFormat, existingHook);
      return async (payload, model) => {
        const result = await hook(payload, model);
        if (provider === 'zai' && responseFormat === 'json_object') {
          const observation = { provider, api: model.api, responseFormat: result && typeof result === 'object' && !Array.isArray(result) ? (result as { response_format?: unknown }).response_format : undefined };
          observedModes.push(observation); record('actual-json-mode-hook', observation);
        }
        return result;
      };
    });
    expect(spy).not.toHaveBeenCalled();
    spy.mockImplementationOnce(async (_owner, input) => {
      expect(input.sessionId).toBe(raw.sessionId);
      expect(JSON.parse(input.message)).toEqual({ task, output, assets: [{ assetId: saved.id, version: saved.version, content: saved.statement, applicableWhen: saved.applicableWhen, forbiddenWhen: saved.forbiddenWhen }] });
      record('original-malformed-check-replayed', { sessionId: input.sessionId, text: raw.text, newModelCall: false });
      return { chosen: raw.chosen, result: { text: raw.text, meta: {} } } as Awaited<ReturnType<typeof routing.runRecallCaptureModel>>;
    });
    record('ordinary-artifacts-replayed', { sourceReport, originalReportHash: hash(originalBytes), formation: 'original real model run replayed', humanReview: 'original actual promotion saved asset replayed; no new ReviewDecision', ordinaryContext: 'original production not_required standing projection replayed unchanged', answer: 'original real model response replayed unchanged', newFormationCalls: 0, newAnswerCalls: 0, expectedNewCheckCalls: 1, preservedReports, projection: contextStage.projection, injection });
    const { checkPersistedCognitionOutput } = await import('../../src/main/features/recall/cognition-output-check');
    const check = await checkPersistedCognitionOutput(uid, { cid, taskRunId: previous.taskRunId, messageId: previous.messageId, taskText: task });
    record('repaired-real-check', { check, totalTransportInvocations: spy.mock.calls.length, realNewModelCalls: report.stages.filter((row: any) => row.stage === 'real-model-response').length });
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[1][1].sessionId).toBe(raw.sessionId + '-syntax-repair');
    expect(spy.mock.calls[1][1].responseFormat).toBe('json_object');
    record('json-mode-observed', { actualHookInvocations: observedModes.length, observedModes, parameterOptIn: spy.mock.calls[1][1].responseFormat });
    expect(observedModes).toContainEqual({ provider: 'zai', api: 'openai-completions', responseFormat: { type: 'json_object' } });
    expect(check).toMatchObject({ id: previous.id, outputHash: previous.outputHash, taskHash: previous.taskHash, modelCompleted: true, checks: [{ assetId: saved.id, version: saved.version, status: 'complied' }] });
    const { listAssetUsageReceipts } = await import('../../src/main/features/recall/asset-usage-receipt');
    const usage = await listAssetUsageReceipts(uid, previous.taskRunId);
    record('repaired-real-adoption', { usage });
    expect(usage).toEqual([expect.objectContaining({ assetId: saved.id, assetVersion: saved.version, status: 'applied', observationMethod: 'model_assisted', outputCheckReceiptId: check!.id, messageId: previous.messageId, outputHash: previous.outputHash })]);
    expect(await assets.readAbilityAssetVersionSnapshot(uid, saved.id, saved.version)).toEqual(beforeSnapshot);
    expect(await assets.readAbilityAsset(uid, saved.id)).toMatchObject({ maturity: 'bud', appliedValidationIds: [] });
    expect(hash(fs.readFileSync(sourceReport))).toBe(hash(originalBytes));
    expect(preservedReports.every(prior => hash(fs.readFileSync(prior.file)) === prior.hash)).toBe(true);
    record('repaired-real-verified', { sourceReportUnchanged: true, exactOriginalOutputAndVersion: true, newModelCalls: 1, maturity: 'bud', effectivenessProven: false });
  }, 0);
  it('有未来用途的事实纠正：定位已有认知，保留纠正而不伪造生效日', async () => {
    const baselineSample = await discover('fact-correction-before', 19, ['青岚项目的交付验收负责人是陈河。以后准备青岚项目验收材料时，需找陈河确认签字；这是长期有效的项目情况，其他项目不能套用。']);
    let saved: Awaited<ReturnType<typeof confirm>> | undefined;
    try { saved = await confirm(pending(baselineSample)); }
    catch (error) { record('fact-correction-baseline-failure', { error: String((error as Error).message) }); }
    const row = pending(await discover('fact-correction-after', 20, ['纠正青岚项目负责人：昨天说陈河负责验收，是我记错了，实际一直是周宁负责，陈河只提供技术建议。今后准备青岚项目验收材料必须找周宁确认签字；这不是从今天起换了负责人，不要编造负责人变更时间。请更新原来那条项目认识。']));
    expect(saved, 'baseline must really be saved before an update can be verified').toBeDefined();
    expect(row.targetAssetId).toBe(saved!.id); expect(['update', 'limit_scope']).toContain(row.suggestedAction); expect(row.judgment).toMatch(/周宁/);
    expect(row.ontologyFormation?.actions.every(action => action.intent !== 'change') ?? true).toBe(true);
    record('fact-correction-semantic-assertions', { targetMatches: true, action: row.suggestedAction, category: row.contentCategory });
    const updated = await confirmUpdate(saved!, row, 'fact-correction', 'correction');
    const answer = await use(updated.id, 'fact_correction', '现在准备青岚项目验收材料，需要谁最终确认签字？这是现实发生了负责人变更，还是原来记忆的纠正？请仅按已保存来源作答，不编造变更日期。');
    expect(answer.text).toMatch(/周宁/); expect(answer.text).toMatch(/纠正|记错|错误/);
    expect(answer.text).not.toMatch(/(?:自|从|于)2026[-年]0?9[-月]20.{0,8}(?:起|接替|变更)/);
  }, 0);
  it('有未来用途的事实变更：明确时间，并更新同一条认知', async () => {
    const baselineSample = await discover('fact-change-before', 22, ['星泽项目每次验收需要宋遥最终签字。自2026年9月22日起宋遥是该项目验收负责人；后续准备星泽验收材料时按这个情况找人，不能套到其他项目。']);
    let saved: Awaited<ReturnType<typeof confirm>> | undefined;
    try { saved = await confirm(pending(baselineSample)); }
    catch (error) { record('fact-change-baseline-failure', { error: String((error as Error).message) }); }
    const row = pending(await discover('fact-change-after', 23, ['星泽项目负责人现实发生变更：从2026年9月24日起，秦舟接替宋遥负责最终验收签字；9月24日以前宋遥负责的历史仍然成立。以后准备该项目验收材料要按生效日期找到正确负责人。请更新原项目认识，不要把旧事实说成从来都是错的。']));
    expect(saved, 'baseline must really be saved before an update can be verified').toBeDefined();
    expect(row.targetAssetId).toBe(saved!.id); expect(['update', 'limit_scope']).toContain(row.suggestedAction); expect(row.judgment).toMatch(/秦舟/); expect(row.judgment).toMatch(/2026.{0,2}9.{0,2}24|2026-09-24/);
    if (row.ontologyFormation?.actions.some(action => action.intent === 'change')) expect(row.ontologyFormation.effectiveFrom).toBe('2026-09-24');
    record('fact-change-semantic-assertions', { targetMatches: true, action: row.suggestedAction, category: row.contentCategory });
    const updated = await confirmUpdate(saved!, row, 'fact-change', 'change');
    const answer = await use(updated.id, 'fact_change', '准备星泽项目验收材料：2026年9月25日与2026年9月23日各应找谁最终签字？请区分生效日期前后，保留仍然成立的历史，不编造负责人。');
    expect(answer.text).toMatch(/秦舟/); expect(answer.text).toMatch(/宋遥/); expect(answer.text).toMatch(/9月24日|09-24|9\/24/);
  }, 0);
  it('无价值对话：真实流程停止，不制造需要关注的建议', async () => {
    const sample = await discover('no-value', 25, ['早上好，今天窗外好亮呀。喝了杯水，随便聊一句。'], '早上好，祝你今天顺利。');
    expect(sample.candidates.filter(row => row.status === 'pending_review')).toEqual([]);
    expect(sample.captures.every(row => ['skipped', 'archived', 'no_candidate'].includes(row.status))).toBe(true);
  }, 0);
  it('长对话后半最终纠正：摘要覆盖最后决定，不把早先无效说法保存成全局要求', async () => {
    const filler = Array.from({ length: 32 }, (_, i) => `第${i + 1}段临时材料：这只是讨论中的例子，不是长期要求。假设我们分析一次试验的日志：观察到重试后恢复，但没有测连接池占用量和网络延迟。此处保留待确认问题，不能据此推广为所有项目规则。`);
    const messages = ['暂定以后回答任何问题都先写完整背景，再给结论，暂时按这个想法讨论。', ...filler,
      '最后纠正并确定：前面那个“所有问题先写完整背景”的暂定想法取消，不要保存它。长期要求仅用于软件故障分析：先列已观察证据和待确认点，再给暂定诊断与验证步骤；普通问答不要强制套用。这个才是最后决定。'];
    const sample = await discover('long-correction', 27, messages);
    const row = pending(sample); expect(row.judgment).toMatch(/证据/); expect(row.judgment).toMatch(/故障/);
    if (/所有问题.{0,8}先.{0,8}完整背景/.test(row.judgment)) expect(row.judgment).toMatch(/取消|不再|已撤销|不要保存|不得.{0,12}所有问题/);
    expect([row.judgment, ...(row.forbiddenWhen || [])].join('\n')).toMatch(/普通问答|日常问答/);
    const finalId = `long-correction-message-${messages.length - 1}`;
    expect(sample.captures.some(capture => capture.contextSummary?.topics.some(topic => topic.evidence.some(item => item.messageId === finalId)))).toBe(true);
    record('long-correction-semantic-assertions', { finalEvidenceRetained: true, approvedEvidence: row.captureProvenance?.valueJudgment.evidence });
  }, 0);
});
