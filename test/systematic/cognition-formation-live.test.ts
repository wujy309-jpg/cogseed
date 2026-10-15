/** Opt-in real model acceptance. All chats/cognition live in a disposable root.
 * Copies only opaque encrypted auth configuration, preserving the owner uid. */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
const suite = process.env.COGSEED_LIVE_COGNITION_TEST === '1' ? describe : describe.skip;
let root = '', oldRoot: string | undefined, uid = '', oldTimezone: string | undefined;
const report: Record<string, any> = { synthetic: true, stages: [] };
const logStage = (stage: string, data: Record<string, unknown>) => { report.stages.push({ stage, ...data }); process.stdout.write(`[cognition-live] ${stage}\n`); };
suite('真实模型两夜认知、本体与使用闭环', () => {
  beforeAll(async () => {
    const source = process.env.COGSEED_LIVE_SOURCE_CONFIG_DIR; uid = process.env.COGSEED_LIVE_SOURCE_UID || '';
    if (!source || !uid) throw new Error('explicit encrypted config source and owner uid required');
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'cogseed-cognition-live-')); oldRoot = process.env.COGSEED_WORKSPACE_ROOT;
    oldTimezone = process.env.TZ; process.env.TZ = 'Asia/Shanghai'; process.env.COGSEED_WORKSPACE_ROOT = root; vi.resetModules();
    const target = path.join(root, uid, 'local/config'); fs.mkdirSync(target, { recursive: true, mode: 0o700 });
    for (const name of ['auth-profiles.json', 'account.json']) { const file = path.join(source, name); if (fs.existsSync(file)) fs.copyFileSync(file, path.join(target, name)); }
    const { activateUser } = await import('../../src/main/features/users'); activateUser(uid);
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-11T09:00:00+08:00'));
    const { migrateLegacyCognition } = await import('../../src/main/features/cognition_migration');
    const migration = await migrateLegacyCognition(uid, { activate: true }); expect(migration.errors).toEqual([]);
    const { commitOntologyCommand } = await import('../../src/main/features/cognition/ontology/service');
    const create = (recordId: string, record: Record<string, unknown>) => ({ intent: 'create' as const, recordId, record, sourceLabel: '隔离验收的虚构用户最小语义结构' });
    await commitOntologyCommand(uid, { commandId: 'synthetic-minimal-t', expectedRevision: 0, actions: [
      create('personal', { kind: 'module', name: '我的表达偏好', description: '隔离验收用的虚构用户模型', scope: { kind: 'personal' } }),
      create('person-type', { kind: 'definition', moduleId: 'personal', name: '人物', description: '表达偏好的主体', definitionKind: 'type', subjectTypes: [], objectTypes: [], valueType: 'entity', cardinality: 'many', cardinalityAnchor: 'subject' }),
      create('expressed-preference', { kind: 'definition', moduleId: 'personal', name: '表达偏好', description: '用户明确表达的偏好正文，保留适用情境和例外', definitionKind: 'attribute', subjectTypes: ['person-type'], objectTypes: [], valueType: 'text', cardinality: 'one', cardinalityAnchor: 'subject' }),
      create('self', { kind: 'entity', moduleId: 'personal', typeId: 'person-type', name: '用户本人', description: '隔离验收的虚构用户，当前对话user发言者', aliases: [], identityStatus: 'confirmed' }),
    ] });
    const capture = await import('../../src/main/features/recall/capture-service'); capture.startRecallCaptureOrchestrator()();
    const { updateRecallCaptureSettings } = await import('../../src/main/features/recall/capture-settings');
    await updateRecallCaptureSettings(uid, { enabled: true, autoApproval: false, executionPolicy: 'nightly', nightlyStart: '02:00', nightlyEnd: '06:00' });
    const routing = await import('../../src/main/features/recall/capture-model-routing');
    const realRun = routing.runRecallCaptureModel;
    vi.spyOn(routing, 'runRecallCaptureModel').mockImplementation(async (userId, input) => {
      const output = await realRun(userId, input);
      logStage('real_model_response', { sessionId: input.sessionId, chosen: output.chosen, text: output.result.text, failed: !!output.result.meta.error });
      return output;
    });
    logStage('isolated_setup', { seededMinimalStructure: true });
  });
  afterAll(async () => {
    const { closeEmbedder } = await import('../../src/main/features/kb_embed'); closeEmbedder();
    vi.useRealTimers();
    vi.restoreAllMocks();
    if (process.env.COGSEED_LIVE_COGNITION_REPORT) fs.writeFileSync(process.env.COGSEED_LIVE_COGNITION_REPORT, JSON.stringify(report, null, 2));
    if (oldRoot === undefined) delete process.env.COGSEED_WORKSPACE_ROOT; else process.env.COGSEED_WORKSPACE_ROOT = oldRoot;
    if (oldTimezone === undefined) delete process.env.TZ; else process.env.TZ = oldTimezone;
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });
  it('两夜形成更新同一认知、A/R；真实回答与持久结果检查留痕', async () => {
    const chats = await import('../../src/main/features/chats');
    const { appendVisible } = await import('../../src/main/features/group_chat/visibility');
    const { appendJsonlAtomic } = await import('../../src/main/storage');
    const { conversationMessageFile } = await import('../../src/main/util/project-layout');
    const appendMessage = async (cid: string, message: import('../../src/main/features/group_chat/types').GroupMessage) => {
      await appendJsonlAtomic(conversationMessageFile(uid, cid), message);
      await appendVisible(uid, cid, message, ['commander']);
      await chats.updateConversation(uid, cid, {});
    };
    const capture = await import('../../src/main/features/recall/capture-service');
    const { readRecallCaptureSettings } = await import('../../src/main/features/recall/capture-settings');
    const candidates = await import('../../src/main/features/recall/candidate-service');
    const assets = await import('../../src/main/features/recall/asset-service');
    const ontology = await import('../../src/main/features/cognition/ontology/service');
    const conversation = await chats.createConversation(uid, { conversationId: 'synthetic-preference-source', title: '隔离验收：虚构用户表达偏好' });
    await appendMessage(conversation.conversation_id, { id: 'synthetic-preference-day1', ts: '2026-10-11T10:00:00+08:00', from: 'user', to: ['commander'], text: '从2026年10月11日起，我有一个长期的表达偏好：回答我的复杂问题时，先直接说结论，再解释关键原因，避免开头先铺很长的背景。这是以后类似问题都适用的偏好，并不要求省略必要证据。' });
    const allCaptures = async () => {
      const { recallJsonRecordPath } = await import('../../src/main/features/recall/paths');
      const dir = path.dirname(recallJsonRecordPath(uid, 'captures', 'probe'));
      const names = fs.existsSync(dir) ? fs.readdirSync(dir).filter(name => name.endsWith('.json')) : [];
      return Promise.all(names.map(name => capture.readRecallCapture(uid, name.slice(0, -5))));
    };
    const runNight = async (night: string, key: string) => {
      vi.setSystemTime(new Date(night));
      const settings = await readRecallCaptureSettings(uid);
      const sweep = await capture.runNightlyCaptureSweep(uid, night, settings); logStage(`${key}_sweep`, { sweep });
      expect(sweep.ran).toBe(true);
      const pending = await allCaptures();
      const queued = pending.filter(row => row.status === 'queued');
      for (const row of queued) await capture.runRecallCapture(uid, row.id);
      const captures = await allCaptures(); const all = await candidates.listRecallCandidates(uid);
      logStage(`${key}_extraction`, { captures: captures.map(row => ({ id: row.id, status: row.status, stage: row.stage, errorCode: row.errorCode, candidateIds: row.candidateIds, contextSummary: row.contextSummary, valueJudgment: row.valueJudgment })), candidates: all });
      return all.filter(row => row.status === 'pending_review');
    };
    const first = await runNight('2026-10-12T03:00:00+08:00', 'night1');
    expect(first).toHaveLength(1); expect(first[0].ontologyFormation?.blockedReasons).toEqual([]);
    expect(first[0].ontologyFormation?.requiresTReview).toBe(false);
    expect(first[0].ontologyFormation?.previewChanges.some(row => row.box === 'A')).toBe(true);
    expect(first[0].ontologyFormation?.previewChanges.some(row => row.box === 'R')).toBe(true);
    const saved = await capture.promoteRecallCaptureCandidate(uid, first[0].id); const firstAsset = saved.asset;
    logStage('night1_confirmed', { asset: firstAsset, ontology: ontology.readOntologyDocument(uid) });
    const ruleRefs = firstAsset.ontologyRefs?.filter(ref => ref.sharedBody).map(ref => ref.recordId) || [];
    expect(ruleRefs).toHaveLength(1);
    const initialAssertion = Object.values(ontology.readOntologyDocument(uid).records).find(row => row.kind === 'assertion');
    expect(initialAssertion).toBeDefined();

    const use = async (version: string, purpose: string, taskText: string) => {
      const cid = `synthetic-use-${version}`, taskRunId = `synthetic-real-run-${version}`, messageId = `synthetic-real-output-${version}`;
      await chats.createConversation(uid, { conversationId: cid, title: '隔离验收：真实模型使用偏好' });
      const { previewContextProjection } = await import('../../src/main/features/recall/context-projection');
      const { buildRecallTurnPromptContext } = await import('../../src/main/features/recall/prompt-injection');
      const projection = await previewContextProjection(uid, { taskRunId, purpose, authorization: 'user_confirmed', confirm: true, conversationId: cid, explicitAssetIds: [firstAsset.id] });
      const context = await buildRecallTurnPromptContext(uid, { cid, taskRunId, taskText, committedProjectionId: projection.id });
      expect(context.citations.some(row => row.assetId === firstAsset.id && row.version === version)).toBe(true);
      const { buildRunner } = await import('../../src/main/model/core-agent/runner');
      const { runner, providerId, modelId } = await buildRunner({ userId: uid, cid, turnId: taskRunId, taskRunId, sessionId: `one-shot-${taskRunId}`, ephemeralSession: true, disableTools: true, skillList: [], systemPrompt: `请用中文回答当前问题，遵守下列已经确认且适用的用户认知。只回答问题，不评价测试，也不声称业务效果已经验证。\n${context.promptBlock}` });
      const result = await runner.run({ message: taskText, cacheRetention: 'none' }); expect(result.meta.error).toBeFalsy(); expect(result.text.trim()).not.toBe('');
      await appendMessage(cid, { id: messageId, ts: new Date().toISOString(), from: 'commander', to: ['user'], text: result.text, turn_id: taskRunId });
      const { recordInjectionReceipt } = await import('../../src/main/features/recall/injection-receipt');
      await recordInjectionReceipt(uid, { taskRunId, projectionId: projection.id, assetId: firstAsset.id, assetVersion: version, boundary: 'real', status: 'injected', channel: 'projection', messageId });
      const { checkPersistedCognitionOutput } = await import('../../src/main/features/recall/cognition-output-check');
      const check = await checkPersistedCognitionOutput(uid, { cid, taskRunId, messageId, taskText });
      logStage(`real_use_v${version}`, { providerId, modelId, contextCitations: context.citations, response: result.text, check });
      expect(check?.modelCompleted).toBe(true); expect(check?.checks[0].status).toBe('complied');
    };
    await use('1', 'complex_question', '这是一个复杂的架构问题：小团队管理运行时数据，应该用一个集中式写入口还是让每个界面独立写文件？请说明判断和关键原因。');
    vi.setSystemTime(new Date('2026-10-12T10:00:00+08:00'));
    await appendMessage(conversation.conversation_id, { id: 'synthetic-preference-day2', ts: new Date().toISOString(), from: 'user', to: ['commander'], text: '补充昨天的表达偏好，从2026年10月12日起：一般复杂问题仍然先说结论，再说原因；但是分析故障时，要先列出已观察到的证据和待确认点，再给诊断结论。这个故障场景的边界要与原来的偏好合成同一条，不能把它误解成所有问题都先列证据，也不要删掉原来对一般复杂问题的偏好。' });
    const second = await runNight('2026-10-13T03:00:00+08:00', 'night2');
    expect(second).toHaveLength(1); expect(second[0].targetAssetId).toBe(firstAsset.id);
    expect(['update', 'limit_scope']).toContain(second[0].suggestedAction); expect(second[0].ontologyFormation?.blockedReasons).toEqual([]);
    const revised = await capture.promoteRecallCaptureCandidate(uid, second[0].id); expect(revised.asset.id).toBe(firstAsset.id); expect(revised.asset.version).toBe('2');
    expect(revised.asset.ontologyRefs?.some(ref => ref.recordId === ruleRefs[0] && ref.sharedBody)).toBe(true);
    expect(ontology.readOntologyDocument(uid).records[ruleRefs[0]!]).toMatchObject({ requirement: revised.asset.statement, version: 2 });
    const finalOntology = ontology.readOntologyDocument(uid);
    expect(finalOntology.records[initialAssertion!.id]).toMatchObject({ validity: { from: '2026-10-11', until: '2026-10-12' }, version: 2 });
    const successor = Object.values(finalOntology.records).find(row => row.kind === 'assertion' && row.supersedesId === initialAssertion!.id);
    expect(successor).toMatchObject({ validity: { from: '2026-10-12', until: null }, source: { recordId: second[0].id } });
    expect(revised.asset.ontologyRefs?.some(ref => ref.recordId === successor?.id && ref.versionPolicy === 'current')).toBe(true);
    expect(revised.asset.ontologyRefs?.some(ref => ref.recordId === initialAssertion!.id && ref.versionPolicy === 'current')).toBe(false);
    const currentAssets = await assets.listAbilityAssets(uid); expect(currentAssets.filter(row => row.status === 'active')).toHaveLength(1);
    logStage('night2_confirmed', { asset: revised.asset, ontology: ontology.readOntologyDocument(uid) });
    await use('2', 'fault_analysis', '请分析这个故障：日志显示14:03数据库连接等待超时，14:04重试成功；还没有查连接池占用量，也没有证据表明数据库服务宕机。请给出诊断，并保留尚未确认的判断。');
    report.passed = true;
  }, 0);
});

// Reuses immutable output already produced by the opt-in live run. Only the
// provider transport is replayed; snapshots, messages, checks and usage proofs
// all use production persistence. This does not relabel the original live run.
const replaySuite = process.env.COGSEED_COGNITION_REPLAY_SOURCE ? describe : describe.skip;
replaySuite('真实结果持久化复核回放', () => {
  it('原真实v2结果写入唯一检查及model_assisted采用凭证，不升级效果', async () => {
    const source = process.env.COGSEED_COGNITION_REPLAY_SOURCE!;
    const originalBytes = fs.readFileSync(source, 'utf8');
    const original = JSON.parse(originalBytes);
    const use = original.stages.find((row: any) => row.stage === 'real_use_v2');
    const confirmed = original.stages.find((row: any) => row.stage === 'night2_confirmed');
    const raw = original.stages.find((row: any) => row.stage === 'real_model_response' && row.sessionId === `one-shot-${use.check.id}`);
    const task = '请分析这个故障：日志显示14:03数据库连接等待超时，14:04重试成功；还没有查连接池占用量，也没有证据表明数据库服务宕机。请给出诊断，并保留尚未确认的判断。';
    const hash = (value: string) => createHash('sha256').update(value).digest('hex');
    expect(original.synthetic).toBe(true); expect(raw.failed).toBe(false);
    expect(hash(task)).toBe(use.check.taskHash); expect(hash(use.response)).toBe(use.check.outputHash);
    expect(JSON.parse(raw.text).checks).toHaveLength(3);
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cogseed-cognition-result-replay-'));
    const priorRoot = process.env.COGSEED_WORKSPACE_ROOT;
    process.env.COGSEED_WORKSPACE_ROOT = tempRoot; vi.resetModules();
    try {
      const owner = confirmed.asset.ownerId, asset = confirmed.asset;
      const { activateUser } = await import('../../src/main/features/users'); activateUser(owner);
      const store = await import('../../src/main/features/recall/store');
      const assets = await import('../../src/main/features/recall/asset-service');
      const { replaceCognitionSources } = await import('../../src/main/features/cognition_bridge');
      await replaceCognitionSources(owner, { mode: 'unified', revision: 1, records: { 'ability-assets': { [asset.id]: asset }, candidates: {} }, po: { groups: [], trash: [] }, pendingProjection: false, migratedAt: use.check.createdAt });
      const { editCognitionDocument } = await import('../../src/main/features/cognition_kernel/store');
      await editCognitionDocument(owner, draft => { draft.ontology = confirmed.ontology; });
      await assets.initializeAbilityAsset(owner, asset, { actor: 'user', reason: '隔离重建原真实验收v2快照，仅用于持久化复核回放' });
      const before = await assets.readAbilityAssetVersionSnapshot(owner, asset.id, '2');
      expect(before).toMatchObject({ statement: asset.statement, applicableWhen: asset.applicableWhen, forbiddenWhen: asset.forbiddenWhen, version: '2' });
      const { appendJsonlAtomic } = await import('../../src/main/storage');
      const { conversationMessageFile } = await import('../../src/main/util/project-layout');
      await appendJsonlAtomic(conversationMessageFile(owner, 'synthetic-use-2'), { id: use.check.messageId, from: 'commander', to: ['user'], text: use.response, turn_id: use.check.taskRunId, ts: use.check.createdAt });
      // Rebuild a genuine confirmed task projection for this isolated replay;
      // an old report's projection ID alone cannot grant present source access.
      const { previewContextProjection } = await import('../../src/main/features/recall/context-projection');
      const replayProjection = await previewContextProjection(owner, { taskRunId: use.check.taskRunId, taskText: task, purpose: asset.scope,
        authorization: 'user_confirmed', confirm: true, conversationId: 'synthetic-use-2', explicitAssetIds: [asset.id] });
      expect(replayProjection.assetVersions?.[asset.id]).toBe('2');
      const { recordInjectionReceipt } = await import('../../src/main/features/recall/injection-receipt');
      const injection = await recordInjectionReceipt(owner, { assetId: asset.id, assetVersion: '2', taskRunId: use.check.taskRunId, messageId: use.check.messageId,
        projectionId: replayProjection.id, channel: 'projection', boundary: 'real', status: 'injected' });
      const routing = await import('../../src/main/features/recall/capture-model-routing');
      const transport = vi.spyOn(routing, 'runRecallCaptureModel').mockImplementation(async (_owner, input) => {
        expect(input.sessionId).toBe(raw.sessionId);
        expect(JSON.parse(input.message)).toEqual({ task, output: use.response, assets: [{ assetId: asset.id, version: '2', content: asset.statement, applicableWhen: asset.applicableWhen, forbiddenWhen: asset.forbiddenWhen }] });
        return { chosen: raw.chosen, result: { text: raw.text, meta: {} } } as Awaited<ReturnType<typeof routing.runRecallCaptureModel>>;
      });
      const { checkPersistedCognitionOutput } = await import('../../src/main/features/recall/cognition-output-check');
      const input = { cid: 'synthetic-use-2', taskRunId: use.check.taskRunId, messageId: use.check.messageId, taskText: task };
      const checked = await checkPersistedCognitionOutput(owner, input);
      expect(checked).toMatchObject({ id: use.check.id, outputHash: use.check.outputHash, taskHash: use.check.taskHash, method: 'model_assisted', modelCompleted: true,
        checks: [{ assetId: asset.id, version: '2', status: 'complied' }] });
      expect(checked!.checks).toHaveLength(1);
      expect(await store.readRecallJsonRecord(owner, 'output-checks', checked!.id)).toEqual(checked);
      const usage = await import('../../src/main/features/recall/asset-usage-receipt');
      const proofs = await usage.listAssetUsageReceipts(owner, input.taskRunId);
      expect(proofs).toHaveLength(1);
      expect(proofs[0]).toMatchObject({ status: 'applied', assetId: asset.id, assetVersion: '2', observationMethod: 'model_assisted', evidenceKind: 'final_output', boundary: 'real',
        injectionReceiptId: injection.id, outputCheckReceiptId: checked!.id, messageId: input.messageId, outputHash: checked!.outputHash });
      expect(proofs[0].reason).toContain('not an effectiveness proof');
      expect(await usage.listAppliedUsageReceipts(owner, { taskRunIds: [input.taskRunId], assetId: asset.id })).toHaveLength(1);
      expect(await usage.listAssetUsageReceiptViews(owner, asset.id)).toEqual([expect.objectContaining({ status: 'applied', observationMethod: 'model_assisted', assetVersion: '2' })]);
      const { listEffectivenessProofs } = await import('../../src/main/features/recall/proof-service');
      const { listValidationRecords } = await import('../../src/main/features/recall/validation-service');
      expect(await listEffectivenessProofs(owner)).toEqual([]); expect(await listValidationRecords(owner)).toEqual([]);
      expect(await assets.readAbilityAsset(owner, asset.id)).toMatchObject({ version: '2', maturity: asset.maturity, appliedValidationIds: [] });
      expect(await assets.readAbilityAssetVersionSnapshot(owner, asset.id, '2')).toEqual(before);
      expect(await checkPersistedCognitionOutput(owner, input)).toEqual(checked);
      expect(await usage.listAssetUsageReceipts(owner, input.taskRunId)).toHaveLength(1); expect(transport).toHaveBeenCalledTimes(1);
      expect(fs.readFileSync(source, 'utf8')).toBe(originalBytes);
      if (process.env.COGSEED_COGNITION_REPLAY_REPORT) fs.writeFileSync(process.env.COGSEED_COGNITION_REPLAY_REPORT, JSON.stringify({
        label: '真实结果持久化复核回放', synthetic: true, source, sourceLiveTestPassed: original.passed === true, hashesMatch: true,
        newModelCalls: 0, replayedProviderResponses: 1, checked, usageProofs: proofs, effectivenessProofCount: 0, validationCount: 0, snapshotUnchanged: true, idempotentRetry: true, originalReportUnchanged: true,
      }, null, 2));
    } finally {
      const { closeEmbedder } = await import('../../src/main/features/kb_embed'); closeEmbedder(); vi.restoreAllMocks();
      if (priorRoot === undefined) delete process.env.COGSEED_WORKSPACE_ROOT; else process.env.COGSEED_WORKSPACE_ROOT = priorRoot;
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
