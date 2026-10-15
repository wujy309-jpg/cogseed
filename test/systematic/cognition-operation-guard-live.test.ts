/** Opt-in actual configured model + production Markdown tools. Structure,
 * source, candidate and shared R are explicit synthetic test fixtures, not
 * model formation or evidence of business effects. No execution is mocked. */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { prepareNightlyCandidateInput, markFixtureCaptureReady } from '../helpers/nightly-formation-fixture';
import { drainMainRuntimeForTest } from '../helpers/drain-main-runtime';

const suite = process.env.COGSEED_LIVE_OPERATION_GUARD === '1' ? describe : describe.skip;
const hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const modelCandidates = [{ provider: 'zai', model: 'glm-5.2' }];
let root = '', uid = '', sourceConfig = '', workspace = '', reportFile = '';
let priorRoot: string | undefined, reportWritable = false;
const configHashes: Record<string, string> = {};
const report: Record<string, any> = { schemaVersion: 1, synthetic: true, optInRequired: true,
  productionGatesChanged: false, toolExecutionMocked: false, fixtureModelFormed: false,
  fixtureBusinessEffectProved: false, modelCandidates, stages: [], cases: [] };
function safe(value: unknown): unknown {
  if (typeof value === 'string') return value.replaceAll(root || '\0', '<isolated-root>').replaceAll(uid || '\0', '<opaque-owner>');
  if (Array.isArray(value)) return value.map(safe);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, safe(child)]));
  return value;
}
function record(stage: string, data: Record<string, unknown>) {
  report.stages.push(safe({ stage, ...data }));
  process.stdout.write(`[operation-guard-live] ${stage}\n`);
}
const ruleBody = '隔离测试规则：写入 Markdown 文档必须包含非空的“风险”章节；后续编辑不能删除该必需章节。此规则仅作测试，不证明业务效果。';
const missing = '# 隔离报告\n仅用于验证写前规则，未包含必需章节。';
const valid = '# 隔离报告\n## 风险\n测试数据不代表实际业务风险。';
const final = '# 隔离报告\n## 风险\n已经完成隔离数据核对，不代表业务效果。';
const plan = [
  { name: 'missing section denied', tool: 'write_file', content: missing, expectedError: true, expectedBytes: undefined },
  { name: 'complete sections written', tool: 'write_file', content: valid, expectedError: false, expectedBytes: valid },
  { name: 'deleting required section denied', tool: 'edit_file', old_string: '## 风险\n测试数据不代表实际业务风险。', new_string: '测试已删除必需章节。', expectedError: true, expectedBytes: valid },
  { name: 'compliant edit written', tool: 'edit_file', old_string: '测试数据不代表实际业务风险。', new_string: '已经完成隔离数据核对，不代表业务效果。', expectedError: false, expectedBytes: final },
];

suite('真实模型：Markdown write/edit 前 required_section 门禁', () => {
  beforeAll(async () => {
    sourceConfig = process.env.COGSEED_LIVE_SOURCE_CONFIG_DIR || '';
    uid = process.env.COGSEED_LIVE_SOURCE_UID || '';
    if (!sourceConfig || !uid || path.basename(uid) !== uid || ['.', '..'].includes(uid)) throw new Error('explicit opaque auth source and owner required');
    reportFile = process.env.COGSEED_LIVE_OPERATION_REPORT || `/tmp/cogseed-operation-guard-live-${randomUUID()}.json`;
    if (!path.isAbsolute(reportFile) || !path.resolve(reportFile).startsWith('/tmp/') || fs.existsSync(reportFile)) throw new Error('fresh immutable /tmp report required');
    reportWritable = true; priorRoot = process.env.COGSEED_WORKSPACE_ROOT;
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'cogseed-operation-live-'));
    process.env.COGSEED_WORKSPACE_ROOT = root; vi.resetModules();
    const target = path.join(root, uid, 'local/config'); fs.mkdirSync(target, { recursive: true, mode: 0o700 });
    for (const name of ['auth-profiles.json', 'account.json']) {
      const file = path.join(sourceConfig, name);
      if (fs.existsSync(file)) { configHashes[name] = hash(fs.readFileSync(file)); fs.copyFileSync(file, path.join(target, name)); }
    }
    if (!configHashes['auth-profiles.json']) throw new Error('configured encrypted auth required');
    report.startedAt = new Date().toISOString(); report.ownerHash = hash(uid);
    const { activateUser } = await import('../../src/main/features/users'); activateUser(uid);
    const { migrateLegacyCognition } = await import('../../src/main/features/cognition_migration');
    expect((await migrateLegacyCognition(uid, { activate: true })).errors).toEqual([]);
    const capture = await import('../../src/main/features/recall/capture-service'); capture.startRecallCaptureOrchestrator()();
    workspace = path.join(root, 'workspace'); fs.mkdirSync(workspace);
    const { setWorkspacePath } = await import('../../src/main/features/user_workspace'); expect(setWorkspacePath(uid, workspace).ok).toBe(true);
    const permissions = await import('../../src/main/features/permissions');
    permissions.setLocalExecMode('workspace_approval'); // Narrow only this disposable account; never all-files auto.
    expect(permissions.getLocalExecMode()).toBe('workspace_approval');
    const { listAbilityAssets } = await import('../../src/main/features/recall/asset-service'); expect(await listAbilityAssets(uid)).toEqual([]);
    record('isolated-setup', { permissionMode: 'workspace_approval', extraRoots: [], copiedFiles: Object.keys(configHashes), formalAssetsImported: 0 });
  });
  afterAll(async () => {
    try {
      if (root && uid) await drainMainRuntimeForTest(uid);
      report.sourceConfigUnchanged = Object.entries(configHashes).every(([name, value]) => hash(fs.readFileSync(path.join(sourceConfig, name))) === value);
    } finally {
      vi.restoreAllMocks(); report.finishedAt = new Date().toISOString();
      if (root) { fs.rmSync(root, { force: true, recursive: true }); report.disposableDataRemoved = !fs.existsSync(root); }
      report.passed = report.passed === true && report.sourceConfigUnchanged === true && report.disposableDataRemoved === true;
      if (priorRoot === undefined) delete process.env.COGSEED_WORKSPACE_ROOT; else process.env.COGSEED_WORKSPACE_ROOT = priorRoot;
      if (reportWritable) { fs.writeFileSync(reportFile, JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 }); fs.chmodSync(reportFile, 0o400); process.stdout.write(`[operation-guard-live] immutable-report ${reportFile}\n`); }
    }
    expect(report.sourceConfigUnchanged).toBe(true);
  });
  it('真实四步工具动作严格拒绝缺章并允许完整章写入与合规编辑', async () => {
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 240_000);
    try {
      const ontology = await import('../../src/main/features/cognition/ontology/service');
      await ontology.commitOntologyCommand(uid, { commandId: 'operation-live-structure-fixture', expectedRevision: 0, actions: [
        { intent: 'create', recordId: 'operation-personal', sourceLabel: '显式测试结构，非模型形成', record: { kind: 'module', name: '隔离工具规则', description: '测试夹具', scope: { kind: 'personal' } } },
      ] });
      const prepared = await prepareNightlyCandidateInput(uid, { judgment: ruleBody, summary: 'Markdown风险章节规则', value: '仅用于验证写前约束对临时 Markdown 文件确实生效。',
        suggestedType: 'cognition', contentCategory: 'rule', suggestedScope: 'general', suggestedAction: 'create',
        applicableWhen: ['Markdown创建和编辑'], forbiddenWhen: ['非Markdown文件'], sourceRefs: [], risk: 'low', rawStatement: true });
      const store = await import('../../src/main/features/recall/store');
      const capture = (await store.readRecallJsonRecord(uid, 'captures', prepared.captureProvenance!.captureId))!;
      const messageId = prepared.captureProvenance!.messageIds[0];
      const { conversationMessageFile } = await import('../../src/main/util/project-layout');
      const sourceFile = conversationMessageFile(uid, String(capture.conversationId));
      const originalRow = JSON.parse(fs.readFileSync(sourceFile, 'utf8').trim());
      fs.writeFileSync(sourceFile, JSON.stringify({ ...originalRow, text: ruleBody }) + '\n');
      const summaryTools = await import('../../src/main/features/recall/capture-context-summary');
      const provenance = await import('../../src/main/features/recall/capture-provenance');
      const messages = [{ id: messageId, role: 'user', text: ruleBody, discovery: true }];
      const summary = summaryTools.validateCaptureContextSummary({ sourceDigest: summaryTools.captureContextSourceDigest(messages), completedAt: prepared.captureProvenance!.extractionCompletedAt,
        topics: [{ title: '显式工具测试规则', content: ruleBody, conditions: ['Markdown创建和编辑'], unresolved: [], attribution: 'user_requirement', evidence: [{ messageId, role: 'user', quote: ruleBody, start: 0, end: ruleBody.length }] }],
        coverage: { messageCount: 1, sourceChars: ruleBody.length, segmentCount: 1, processedSegmentIds: ['m0:0'], maxInputChars: 4000 } }, messages);
      prepared.captureProvenance!.valueJudgment = { ...prepared.captureProvenance!.valueJudgment, summaryDigest: provenance.captureSummaryDecisionDigest(summary), evidence: prepared.captureProvenance!.valueJudgment.evidence.map(ref => ({ ...ref, quote: ruleBody })) };
      for (const refs of [prepared.sourceRefs, prepared.evidenceRefs]) for (const ref of refs || []) if (ref.excerpt) ref.excerpt = ruleBody;
      await store.writeRecallJsonRecord(uid, 'captures', capture.id, { ...capture, contextSummary: summary, valueJudgment: prepared.captureProvenance!.valueJudgment });
      const { invalidateConversationCaches, createConversation } = await import('../../src/main/features/chats'); invalidateConversationCaches(uid);
      const formation = await import('../../src/main/features/recall/ontology-formation');
      prepared.ontologyFormation = formation.parseOntologyFormationProposal(ontology.readOntologyDocument(uid), 'temporary-operation-candidate', {
        reason: '明确人工测试夹具，非模型形成', evidence: [messageId], refs: [{ moduleId: 'operation-personal', recordId: 'operation-risk-rule', versionPolicy: 'current', sharedBody: true }],
        actions: [{ intent: 'create', recordId: 'operation-risk-rule', sourceLabel: '测试源原文', record: { kind: 'rule', moduleId: 'operation-personal', name: '风险章节', requirement: ruleBody,
          strength: 'required', condition: { kind: 'task', field: 'taskKind', equals: 'write_file' }, effect: { kind: 'required_section', name: '风险' }, exception: '' } }],
      }, ruleBody)!;
      expect(prepared.ontologyFormation.blockedReasons).toEqual([]); expect(prepared.ontologyFormation.requiresTReview).toBe(false);
      const candidates = await import('../../src/main/features/recall/candidate-service');
      const candidate = await candidates.saveRecallCandidate(uid, prepared); await markFixtureCaptureReady(uid, candidate);
      const promoted = await candidates.promoteRecallCandidate(uid, candidate.id, { actor: 'user' });
      const { readReviewDecision } = await import('../../src/main/features/cognition/review-decision');
      expect(await readReviewDecision(uid, `recall_candidate:${candidate.id}`, promoted.candidate.reviewDecisionId)).toMatchObject({ actor: 'user', outcome: 'asset_created' });
      expect(ontology.readOntologyDocument(uid).records['operation-risk-rule']).toMatchObject({ version: 1, source: { refs: [{ kind: 'asset', id: promoted.asset.id }] } });
      record('human-confirmed-fixture', { fixture: true, modelFormed: false, nativeUIClicked: false, businessEffectProved: false, assetId: promoted.asset.id, assetVersion: promoted.asset.version, ruleId: 'operation-risk-rule', ruleVersion: 1, captureSourceDigest: summary.sourceDigest });
      const cid = 'operation-live-conversation', taskRunId = 'operation-live-tool-run'; await createConversation(uid, { conversationId: cid, title: '隔离实际工具验证' });
      const target = path.join(workspace, 'report.md');
      const taskText = `这是已授权的隔离写前门禁测试，不是实际业务报告。请依次完成下面四次实际工具调用，每次等待上一调用返回。仅使用write_file和edit_file，目标仅${target}；不要read_file/bash/其它工具，不要创建其它文件。不要自行纠错、增删内容或重试；预期的拒绝也是有效测试结果。\n1.write_file: content=${JSON.stringify(missing)}，应被宿主拒绝。\n2.write_file: content=${JSON.stringify(valid)}，应实际写入。\n3.edit_file: old_string=${JSON.stringify(plan[2].old_string)}, new_string=${JSON.stringify(plan[2].new_string)}，应被拒绝。\n4.edit_file: old_string=${JSON.stringify(plan[3].old_string)}, new_string=${JSON.stringify(plan[3].new_string)}，应实际保存。\n每次path都为上述完整路径。四步完成后仅简述真实工具结果，不声称业务效果。`;
      const guard = await import('../../src/main/features/cognition/ontology/operation-guard');
      const actualCheck = guard.checkOntologyMarkdownWrite;
      const guardDecisions: Array<Awaited<ReturnType<typeof actualCheck>>> = [];
      vi.spyOn(guard, 'checkOntologyMarkdownWrite').mockImplementation(async (owner, input) => {
        const decision = await actualCheck(owner, input); guardDecisions.push(decision);
        record('actual-host-guard', { operation: input.operation, path: input.path, contentHash: hash(input.content), decision, observerOnly: true, resultNotAltered: true });
        return decision;
      });
      let phase = 0, inFlight: string | undefined;
      const writes: Array<{ phase: number; bytesHash: string }> = [];
      const { buildRunner } = await import('../../src/main/model/core-agent/runner');
      const built = await buildRunner({ userId: uid, cid, taskRunId, turnId: taskRunId, userMessage: taskText,
        sessionId: 'anon-operation-guard-live', modelCandidates, ephemeralSession: true, skillList: [], maxToolLoops: 6,
        suppliedAbilityAssets: [{ assetId: promoted.asset.id, assetVersion: promoted.asset.version }],
        systemPrompt: `这是隔离环境中的确定性门禁验收。按用户指定顺序逐次实际调用四个工具，不要并行或使用额外工具。缺章尝试必须交给宿主规则拒绝，不能把自己口头拒绝当真实工具结果。工具拒绝后只继续下一指定步骤，不重试、不修正参数。当前已保存测试规则：${ruleBody}。`,
        onCandidateChosen: info => { report.realModelsExecuted = true; record('actual-model-chosen', { providerId: info.providerId, modelId: info.modelId, profileIdHash: hash(info.profileId) }); },
        onFileWritten: abs => { expect(path.resolve(abs)).toBe(target); const bytes = fs.readFileSync(abs); writes.push({ phase, bytesHash: hash(bytes) }); record('actual-file-written', { path: abs, phase, size: bytes.length, bytesHash: hash(bytes) }); },
      });
      record('actual-tool-definitions', { tools: built.toolDefs.filter(tool => ['write_file', 'edit_file'].includes(tool.name)).map(tool => ({ name: tool.name, source: tool.source })) });
      expect(built.toolDefs.filter(tool => ['write_file', 'edit_file'].includes(tool.name))).toHaveLength(2);
      let completed = false;
      for await (const event of built.runner.runStream({ message: taskText, workingDir: workspace, signal: abort.signal, cacheRetention: 'none' })) {
        if (event.type === 'tool_start') {
          const expected = plan[phase], input = event.input as Record<string, unknown>;
          record('actual-tool-start', { phase, name: event.name, id: event.id, input });
          if (!expected || inFlight || event.name !== expected.tool || !input || typeof input.path !== 'string' || path.resolve(workspace, input.path) !== target
            || (expected.tool === 'write_file' ? input.content !== expected.content : input.old_string !== expected.old_string || input.new_string !== expected.new_string || input.replace_all === true)) {
            abort.abort(); throw new Error('unexpected tool, path, order or parameters; stopped before execution');
          }
          inFlight = event.id;
        } else if (event.type === 'tool_end') {
          record('actual-tool-end', { phase, name: event.name, id: event.id, isError: event.isError === true, result: event.result });
          const expected = plan[phase]; expect(event.id).toBe(inFlight); expect(event.name).toBe(expected.tool);
          expect(event.isError === true).toBe(expected.expectedError);
          if (expected.expectedError) expect(event.result).toContain('E_ONTOLOGY_OPERATION_PRECONDITION');
          expect(guardDecisions[phase]).toMatchObject({ allowed: !expected.expectedError, checks: [expect.objectContaining({ recordId: 'operation-risk-rule', version: 1 })] });
          expect(writes.filter(write => write.phase === phase)).toHaveLength(expected.expectedError ? 0 : 1);
          if (expected.expectedBytes === undefined) expect(fs.existsSync(target)).toBe(false);
          else expect(fs.readFileSync(target, 'utf8')).toBe(expected.expectedBytes);
          report.cases.push({ name: expected.name, passed: true, realToolEvent: true, diskBytesHash: fs.existsSync(target) ? hash(fs.readFileSync(target)) : null });
          phase++; inFlight = undefined;
        } else if (event.type === 'done') {
          record('actual-run-done', { text: event.result.text, usage: event.result.meta.usage, aborted: event.result.meta.aborted === true,
            ...(event.result.meta.error ? { safeError: { kind: event.result.meta.error.kind, messageHash: hash(event.result.meta.error.message || '') } } : {}) });
          expect(event.result.meta.error).toBeFalsy(); expect(event.result.meta.aborted).toBeFalsy(); completed = true;
        }
      }
      expect(completed).toBe(true); expect(phase).toBe(4); expect(guardDecisions).toHaveLength(4); expect(writes).toHaveLength(2);
      expect(fs.readFileSync(target, 'utf8')).toBe(final);
      expect(fs.readdirSync(workspace)).toEqual(['report.md']);
      expect(report.realModelsExecuted).toBe(true);
      report.passed = true;
    } catch (error) {
      abort.abort(); report.passed = false;
      record('failure', { message: error instanceof Error ? error.message : 'live verification failed' }); throw error;
    } finally { clearTimeout(timeout); }
  }, 0);
});
