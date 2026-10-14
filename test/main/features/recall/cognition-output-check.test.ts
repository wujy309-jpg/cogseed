import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

const runModel = vi.fn();
const snapshot = vi.fn();
const current = vi.fn();
const projection = vi.fn();
const readable = vi.fn();
vi.mock('../../../../src/main/features/recall/capture-model-routing', () => ({ runRecallCaptureModel: (...args: unknown[]) => runModel(...args) }));
vi.mock('../../../../src/main/features/recall/asset-service', () => ({ readAbilityAssetVersionSnapshot: (...args: unknown[]) => snapshot(...args), readAbilityAsset: (...args: unknown[]) => current(...args) }));
vi.mock('../../../../src/main/features/recall/context-projection', () => ({ readContextProjection: (...args: unknown[]) => projection(...args) }));
vi.mock('../../../../src/main/features/recall/prompt-injection', () => ({ filterRecallAssetsForAgentRead: (...args: unknown[]) => readable(...args) }));
let root: string;
let previous: string | undefined;
const output = '结论：采用隔离测试数据。\n\n原因：它能保留你的现有认知和来源。';
const task = '请解释为什么测试需要隔离数据。';
const asset = { assetId: 'aa-pref', version: '1', content: '解释复杂问题，先给结论，再讲原因。', applicableWhen: [], forbiddenWhen: [] };
const good = { assetId: 'aa-pref', version: '1', status: 'complied', outputEvidence: { quote: '结论：采用隔离测试数据。', start: 0, end: 13 } };

beforeEach(async () => {
  vi.resetModules(); runModel.mockReset(); snapshot.mockReset(); current.mockReset(); projection.mockReset(); readable.mockReset();
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'cogseed-output-check-'));
  previous = process.env.COGSEED_WORKSPACE_ROOT;
  process.env.COGSEED_WORKSPACE_ROOT = root;
  snapshot.mockResolvedValue({ type: 'cognition', statement: asset.content, contentCategory: 'preference', applicableWhen: [], forbiddenWhen: [], evidenceRefs: [] });
  current.mockResolvedValue({ id: 'aa-pref', ownerId: 'user-a', status: 'active', scope: 'general', version: '1', evidenceRefs: [] });
  projection.mockResolvedValue({ status: 'confirmed', taskRunId: 'turn-a', conversationId: 'cid-a', purpose: 'general', assetIds: ['aa-pref'], assetVersions: { 'aa-pref': '1' } });
  readable.mockImplementation(async (_user, assets) => assets);
  // Compute coordinates from the fixture, avoiding assumptions about UTF-16.
  good.outputEvidence.end = good.outputEvidence.quote.length;
  runModel.mockResolvedValue({ result: { text: JSON.stringify({ checks: [good] }), meta: {} } });
});
afterEach(async () => {
  if (previous === undefined) delete process.env.COGSEED_WORKSPACE_ROOT;
  else process.env.COGSEED_WORKSPACE_ROOT = previous;
  await fs.rm(root, { recursive: true, force: true });
});
async function supplied(overrides: Record<string, unknown> = {}, finalText = output) {
  const storage = await import('../../../../src/main/storage');
  const layout = await import('../../../../src/main/util/project-layout');
  const file = layout.conversationMessageFile('user-a', 'cid-a');
  await fs.mkdir(path.dirname(file), { recursive: true });
  await storage.appendJsonlAtomic(file, { id: 'message-a', from: 'commander', text: finalText, turn_id: 'turn-a' });
  const { recordInjectionReceipt } = await import('../../../../src/main/features/recall/injection-receipt');
  await recordInjectionReceipt('user-a', { assetId: 'aa-pref', assetVersion: '1', taskRunId: 'turn-a', messageId: 'message-a',
    projectionId: 'projection-a', channel: 'projection', boundary: 'real', status: 'injected', ...overrides });
}
const input = { cid: 'cid-a', taskRunId: 'turn-a', messageId: 'message-a', taskText: task };

describe('model-assisted cognition compliance observations', () => {
  it('checks the persisted final output and injected version without claiming an effectiveness proof', async () => {
    await supplied();
    const { checkPersistedCognitionOutput } = await import('../../../../src/main/features/recall/cognition-output-check');
    const result = await checkPersistedCognitionOutput('user-a', input);
    expect(result).toMatchObject({ modelCompleted: true, method: 'model_assisted', checks: [{ assetId: 'aa-pref', version: '1', status: 'complied' }] });
    const payload = JSON.parse(runModel.mock.calls[0][1].message);
    expect(payload).toMatchObject({ task, output, assets: [asset] });
    expect(runModel.mock.calls[0][1].responseFormat).toBe('json_object');
    expect(snapshot).toHaveBeenCalledWith('user-a', 'aa-pref', '1');
    const { listAssetUsageReceipts } = await import('../../../../src/main/features/recall/asset-usage-receipt');
    expect(await listAssetUsageReceipts('user-a')).toEqual([expect.objectContaining({ status: 'applied', reason: expect.stringContaining('not an effectiveness proof') })]);
    expect(JSON.stringify(result)).not.toContain(output);
    await checkPersistedCognitionOutput('user-a', input);
    expect(runModel).toHaveBeenCalledTimes(1);
  });

  it.each([{ assetVersion: '2' }, { messageId: 'other-message' }, { taskRunId: 'other-turn' }, { status: 'omitted' }, { boundary: 'test-double' }])('holds invalid/mismatched supply as unverified: %j', async overrides => {
    await supplied(overrides);
    const { checkPersistedCognitionOutput } = await import('../../../../src/main/features/recall/cognition-output-check');
    const result = await checkPersistedCognitionOutput('user-a', input);
    if (overrides.assetVersion) {
      expect(result?.modelCompleted).toBe(false);
      expect(result?.checks[0]).toMatchObject({ version: '2', status: 'unknown' });
      expect(runModel).not.toHaveBeenCalled();
    } else { expect(result).toBeUndefined(); expect(runModel).not.toHaveBeenCalled(); }
  });

  it('rejects fabricated evidence, missing identities and later asset versions', async () => {
    const { parseCognitionOutputChecks } = await import('../../../../src/main/features/recall/cognition-output-check');
    for (const checks of [[], [good, good], [{ ...good, version: '2' }], [{ ...good, outputEvidence: { quote: '假的证据', start: 0, end: 4 } }], [{ ...good, outputEvidence: undefined }]]) {
      expect(() => parseCognitionOutputChecks(JSON.stringify({ checks }), [asset], task, output)).toThrow();
    }
  });

  it('resolves unique quote-only evidence and rejects ambiguous passages without coordinates', async () => {
    const { parseCognitionOutputChecks } = await import('../../../../src/main/features/recall/cognition-output-check');
    const quote = good.outputEvidence.quote;
    expect(parseCognitionOutputChecks(JSON.stringify({ checks: [{ ...good, outputEvidence: { quote } }] }), [asset], task, output)[0].outputEvidence)
      .toEqual({ start: 0, end: quote.length });
    expect(() => parseCognitionOutputChecks(JSON.stringify({ checks: [{ ...good, outputEvidence: { quote } }] }), [asset], task, quote + quote)).toThrow('ambiguous');
  });

  it('normalizes distinct grounded clause observations without inventing identities or resolving conflicting verdicts', async () => {
    const { parseCognitionOutputChecks } = await import('../../../../src/main/features/recall/cognition-output-check');
    const later = { ...good, outputEvidence: { quote: '原因：它能保留你的现有认知和来源。' } };
    expect(parseCognitionOutputChecks(JSON.stringify({ checks: [later, good] }), [asset], task, output))
      .toEqual([{ assetId: asset.assetId, version: asset.version, status: 'complied', outputEvidence: { start: 0, end: good.outputEvidence.quote.length } }]);
    for (const rows of [
      [good, { ...later, status: 'not_complied' }],
      [good, { ...later, version: '2' }],
      [good, { ...later, assetId: 'invented' }],
      [good, { ...later, outputEvidence: { quote: '未出现的原文' } }],
    ]) expect(() => parseCognitionOutputChecks(JSON.stringify({ checks: rows }), [asset], task, output)).toThrow();
    expect(() => parseCognitionOutputChecks(JSON.stringify({ checks: [good, later] }),
      [asset, { ...asset, assetId: 'aa-missing' }], task, output)).toThrow('incomplete');
  });

  it('recovers usage accounting after the compliance receipt persisted but its usage write failed', async () => {
    await supplied();
    const usage = await import('../../../../src/main/features/recall/asset-usage-receipt');
    const write = vi.spyOn(usage, 'recordAssetUsageReceipt').mockRejectedValueOnce(new Error('interrupted usage write'));
    const { checkPersistedCognitionOutput } = await import('../../../../src/main/features/recall/cognition-output-check');
    await checkPersistedCognitionOutput('user-a', input);
    expect(await usage.listAssetUsageReceipts('user-a')).toEqual([]);
    await checkPersistedCognitionOutput('user-a', input);
    expect(runModel).toHaveBeenCalledTimes(1);
    expect(await usage.listAssetUsageReceipts('user-a')).toEqual([expect.objectContaining({ status: 'applied' })]);
    write.mockRestore();
  });

  it('records unavailable model checking as unknown and creates no adoption or effectiveness claim', async () => {
    await supplied(); runModel.mockRejectedValue(new Error('unavailable'));
    const { checkPersistedCognitionOutput } = await import('../../../../src/main/features/recall/cognition-output-check');
    expect(await checkPersistedCognitionOutput('user-a', input)).toMatchObject({ modelCompleted: false, checks: [{ status: 'unknown' }] });
    const { listAssetUsageReceipts } = await import('../../../../src/main/features/recall/asset-usage-receipt');
    expect(await listAssetUsageReceipts('user-a')).toEqual([]);
  });

  it('retries a transient provider failure and keeps the subsequent completed observation', async () => {
    await supplied(); runModel.mockRejectedValueOnce(new Error('temporary outage'));
    const { checkPersistedCognitionOutput } = await import('../../../../src/main/features/recall/cognition-output-check');
    const first = await checkPersistedCognitionOutput('user-a', input);
    expect(first).toMatchObject({ modelCompleted: false, checks: [{ status: 'unknown' }] });
    const recovered = await checkPersistedCognitionOutput('user-a', input);
    expect(recovered).toMatchObject({ id: first?.id, modelCompleted: true, checks: [{ status: 'complied' }] });
    await checkPersistedCognitionOutput('user-a', input);
    expect(runModel).toHaveBeenCalledTimes(2);
    const { listAssetUsageReceipts } = await import('../../../../src/main/features/recall/asset-usage-receipt');
    expect(await listAssetUsageReceipts('user-a')).toHaveLength(1);
  });

  it('records failure to follow guidance without treating it as rejection of the cognition', async () => {
    await supplied();
    runModel.mockResolvedValue({ result: { text: JSON.stringify({ checks: [{ ...good, status: 'not_complied' }] }), meta: {} } });
    const { checkPersistedCognitionOutput } = await import('../../../../src/main/features/recall/cognition-output-check');
    expect(await checkPersistedCognitionOutput('user-a', input)).toMatchObject({ modelCompleted: true, checks: [{ status: 'not_complied' }] });
    const { listAssetUsageReceipts, listAppliedUsageReceipts } = await import('../../../../src/main/features/recall/asset-usage-receipt');
    expect(await listAssetUsageReceipts('user-a')).toEqual([expect.objectContaining({ status: 'usage_unknown', evidenceKind: 'final_output' })]);
    expect(await listAppliedUsageReceipts('user-a', { taskRunIds: ['turn-a'] })).toEqual([]);
    const { loadAssetAdoptionStats } = await import('../../../../src/main/features/recall/asset-catalog');
    expect((await loadAssetAdoptionStats('user-a')).get('aa-pref')?.contradictedCount || 0).toBe(0);
  });

  it('corrects an earlier agent adoption claim using the exact persisted output check', async () => {
    await supplied();
    const { finalizeAssetUsageClaims } = await import('../../../../src/main/features/recall/asset-usage-claim');
    const report = { taskRunId: input.taskRunId, messageId: input.messageId, finalText: output,
      claims: [{ assetId: asset.assetId, assetVersion: asset.version, outputExcerpt: good.outputEvidence.quote }] };
    await finalizeAssetUsageClaims('user-a', report);
    const { listAssetUsageReceipts, listAppliedUsageReceipts, listAssetUsageReceiptViews } = await import('../../../../src/main/features/recall/asset-usage-receipt');
    expect(await listAppliedUsageReceipts('user-a', { taskRunIds: ['turn-a'] })).toHaveLength(1);
    runModel.mockResolvedValue({ result: { text: JSON.stringify({ checks: [{ ...good, status: 'not_complied' }] }), meta: {} } });
    const { checkPersistedCognitionOutput } = await import('../../../../src/main/features/recall/cognition-output-check');
    await checkPersistedCognitionOutput('user-a', input);
    await finalizeAssetUsageClaims('user-a', report);
    expect(await listAssetUsageReceipts('user-a')).toEqual([expect.objectContaining({ status: 'usage_unknown', observationMethod: 'model_assisted' })]);
    expect(await listAppliedUsageReceipts('user-a', { taskRunIds: ['turn-a'] })).toEqual([]);
    expect(await listAssetUsageReceiptViews('user-a', asset.assetId)).toEqual([expect.objectContaining({ observationMethod: 'model_assisted' })]);
  });

  it('recognizes an explicit current request overriding a preference without contradiction', async () => {
    await supplied();
    runModel.mockResolvedValue({ result: { text: JSON.stringify({ checks: [{ assetId: 'aa-pref', version: '1', status: 'not_applicable',
      taskEvidence: { quote: task, start: 0, end: task.length } }] }), meta: {} } });
    const { checkPersistedCognitionOutput } = await import('../../../../src/main/features/recall/cognition-output-check');
    expect(await checkPersistedCognitionOutput('user-a', input)).toMatchObject({ checks: [{ status: 'not_applicable' }] });
    const { listAssetUsageReceipts } = await import('../../../../src/main/features/recall/asset-usage-receipt');
    expect(await listAssetUsageReceipts('user-a')).toEqual([expect.objectContaining({ status: 'usage_unknown', observationMethod: 'model_assisted', reason: expect.stringContaining('inapplicable') })]);
  });

  it('does not substitute current content for a missing historical snapshot', async () => {
    await supplied(); snapshot.mockResolvedValue(null);
    const { checkPersistedCognitionOutput } = await import('../../../../src/main/features/recall/cognition-output-check');
    expect(await checkPersistedCognitionOutput('user-a', input)).toMatchObject({ modelCompleted: false, checks: [{ status: 'unknown' }] });
    expect(runModel).not.toHaveBeenCalled();
  });

  it.each(['cognition', 'fact'])('checks actually supplied %s facts against the exact stored dates, not external truth', async type => {
    const fact = '星泽验收：2026-09-24起由秦舟签字；此前宋遥负责的历史仍成立。';
    const factualOutput = '2026-09-25星泽验收找秦舟，2026-09-23找宋遥，以2026-09-24为生效分界；这是根据你已保存的项目认识。';
    const factualTask = '准备星泽验收材料，2026-09-25和2026-09-23各找谁签字？';
    snapshot.mockResolvedValue({ type, contentCategory: 'unclassified', statement: fact, applicableWhen: ['星泽验收'], forbiddenWhen: [], evidenceRefs: [] });
    await supplied({}, factualOutput);
    runModel.mockResolvedValue({ result: { text: JSON.stringify({ checks: [{ assetId: 'aa-pref', version: '1', status: 'complied', outputEvidence: { quote: factualOutput } }] }), meta: {} } });
    const { checkPersistedCognitionOutput } = await import('../../../../src/main/features/recall/cognition-output-check');
    const result = await checkPersistedCognitionOutput('user-a', { ...input, taskText: factualTask });
    expect(result).toMatchObject({ modelCompleted: true, checks: [{ status: 'complied', version: '1' }] });
    expect(JSON.parse(runModel.mock.calls[0][1].message).assets[0].content).toBe(fact);
    expect(runModel.mock.calls[0][1].systemPrompt).toContain('not external fact verification');
    expect(runModel.mock.calls[0][1].systemPrompt).toContain('wrong person or date');
    const { listAssetUsageReceipts } = await import('../../../../src/main/features/recall/asset-usage-receipt');
    expect(await listAssetUsageReceipts('user-a')).toEqual([expect.objectContaining({ assetVersion: '1', status: 'applied', observationMethod: 'model_assisted', reason: expect.stringContaining('not external fact verification') })]);
  });

  it.each([
    { status: 'not_complied', answer: '2026-09-25星泽验收仍由宋遥签字。', request: '准备2026-09-25星泽验收材料，找谁签字？' },
    { status: 'unknown', answer: '当前无法确定签字负责人，请先核对资料。', request: '准备星泽验收材料，找谁签字？' },
    { status: 'not_applicable', answer: '本次整理青岚项目材料，星泽项目安排不适用。', request: '只讨论青岚项目验收，不涉及星泽。' },
  ])('does not mark a factual $status finding as adoption', async ({ status, answer, request }) => {
    snapshot.mockResolvedValue({ type: 'cognition', contentCategory: 'unclassified', statement: '星泽验收2026-09-24起秦舟负责，此前宋遥负责。', applicableWhen: [], forbiddenWhen: [] });
    await supplied({}, answer);
    runModel.mockResolvedValue({ result: { text: JSON.stringify({ checks: [{ assetId: 'aa-pref', version: '1', status, ...(status === 'not_complied' ? { outputEvidence: { quote: answer } } : {}), ...(status === 'not_applicable' ? { taskEvidence: { quote: request } } : {}) }] }), meta: {} } });
    const { checkPersistedCognitionOutput } = await import('../../../../src/main/features/recall/cognition-output-check');
    expect(await checkPersistedCognitionOutput('user-a', { ...input, taskText: request })).toMatchObject({ checks: [{ status }] });
    const { listAppliedUsageReceipts } = await import('../../../../src/main/features/recall/asset-usage-receipt');
    expect(await listAppliedUsageReceipts('user-a', { taskRunIds: ['turn-a'] })).toEqual([]);
    const { listAssetUsageReceipts } = await import('../../../../src/main/features/recall/asset-usage-receipt');
    expect(await listAssetUsageReceipts('user-a')).toEqual([expect.objectContaining({ status: 'usage_unknown', observationMethod: 'model_assisted' })]);
  });

  it.each(['unknown', 'not_applicable'])('a completed %s check holds a prior same-output self-report without claiming non-use or ineffectiveness', async status => {
    await supplied();
    const { finalizeAssetUsageClaims } = await import('../../../../src/main/features/recall/asset-usage-claim');
    const claim = { taskRunId: input.taskRunId, messageId: input.messageId, finalText: output,
      claims: [{ assetId: asset.assetId, assetVersion: asset.version, outputExcerpt: good.outputEvidence.quote }] };
    await finalizeAssetUsageClaims('user-a', claim);
    const usage = await import('../../../../src/main/features/recall/asset-usage-receipt');
    expect(await usage.listAppliedUsageReceipts('user-a', { taskRunIds: [input.taskRunId] })).toHaveLength(1);
    runModel.mockResolvedValue({ result: { text: JSON.stringify({ checks: [{ assetId: asset.assetId, version: asset.version, status,
      ...(status === 'not_applicable' ? { taskEvidence: { quote: task } } : {}) }] }), meta: {} } });
    const { checkPersistedCognitionOutput } = await import('../../../../src/main/features/recall/cognition-output-check');
    await checkPersistedCognitionOutput('user-a', input);
    await finalizeAssetUsageClaims('user-a', claim);
    expect(await usage.listAssetUsageReceipts('user-a')).toEqual([expect.objectContaining({ status: 'usage_unknown', observationMethod: 'model_assisted' })]);
    expect(await usage.listAppliedUsageReceipts('user-a', { taskRunIds: [input.taskRunId] })).toEqual([]);
  });

  it('a provider failure preserves a prior same-output self-report without inventing an independent finding', async () => {
    await supplied();
    const { finalizeAssetUsageClaims } = await import('../../../../src/main/features/recall/asset-usage-claim');
    await finalizeAssetUsageClaims('user-a', { taskRunId: input.taskRunId, messageId: input.messageId, finalText: output,
      claims: [{ assetId: asset.assetId, assetVersion: asset.version, outputExcerpt: good.outputEvidence.quote }] });
    runModel.mockRejectedValue(new Error('provider unavailable'));
    const { checkPersistedCognitionOutput } = await import('../../../../src/main/features/recall/cognition-output-check');
    expect(await checkPersistedCognitionOutput('user-a', input)).toMatchObject({ modelCompleted: false, checks: [{ status: 'unknown' }] });
    const usage = await import('../../../../src/main/features/recall/asset-usage-receipt');
    expect(await usage.listAssetUsageReceipts('user-a')).toEqual([expect.objectContaining({ status: 'applied', observationMethod: 'agent_reported' })]);
  });

  it.each([
    { status: 'rejected' }, { taskRunId: 'other-turn' }, { conversationId: 'other-chat' },
    { assetIds: [] }, { assetVersions: { 'aa-pref': '2' } }, { expiresAt: '2000-01-01T00:00:00Z' },
  ])('does not send facts to a model with stale or unbound projection: %j', async patch => {
    await supplied();
    projection.mockResolvedValue({ status: 'confirmed', taskRunId: 'turn-a', conversationId: 'cid-a', purpose: 'general', assetIds: ['aa-pref'], assetVersions: { 'aa-pref': '1' }, ...patch });
    const { checkPersistedCognitionOutput } = await import('../../../../src/main/features/recall/cognition-output-check');
    expect(await checkPersistedCognitionOutput('user-a', input)).toMatchObject({ modelCompleted: false, checks: [{ status: 'unknown' }] });
    expect(runModel).not.toHaveBeenCalled();
  });

  it('rechecks current source access and the historical source refs before any model call', async () => {
    await supplied();
    snapshot.mockResolvedValue({ type: 'fact', statement: '原版本事实', contentCategory: 'unclassified', evidenceRefs: [{ id: 'revoked-original-source' }] });
    current.mockResolvedValue({ id: 'aa-pref', ownerId: 'user-a', status: 'active', scope: 'general', evidenceRefs: [{ id: 'different-new-source' }] });
    readable.mockResolvedValue([]);
    const { checkPersistedCognitionOutput } = await import('../../../../src/main/features/recall/cognition-output-check');
    expect(await checkPersistedCognitionOutput('user-a', input)).toMatchObject({ modelCompleted: false, checks: [{ status: 'unknown' }] });
    expect(readable).toHaveBeenCalledWith('user-a', [expect.objectContaining({ evidenceRefs: [{ id: 'revoked-original-source' }] })], expect.objectContaining({ purpose: 'general', taskText: task }));
    expect(runModel).not.toHaveBeenCalled();
  });

  it('holds access revoked during a model call as unknown, without recording adoption', async () => {
    await supplied();
    runModel.mockImplementationOnce(async () => { readable.mockResolvedValue([]); return { result: { text: JSON.stringify({ checks: [good] }), meta: {} } }; });
    const { checkPersistedCognitionOutput } = await import('../../../../src/main/features/recall/cognition-output-check');
    expect(await checkPersistedCognitionOutput('user-a', input)).toMatchObject({ modelCompleted: false, checks: [{ status: 'unknown' }] });
    const { listAssetUsageReceipts } = await import('../../../../src/main/features/recall/asset-usage-receipt');
    expect(await listAssetUsageReceipts('user-a')).toEqual([]);
  });

  it('does not recover an adoption claim from a cached completed observation after source access was revoked', async () => {
    await supplied();
    const usage = await import('../../../../src/main/features/recall/asset-usage-receipt');
    const write = vi.spyOn(usage, 'recordAssetUsageReceipt').mockRejectedValueOnce(new Error('interrupted adoption write'));
    const { checkPersistedCognitionOutput } = await import('../../../../src/main/features/recall/cognition-output-check');
    expect(await checkPersistedCognitionOutput('user-a', input)).toMatchObject({ checks: [{ status: 'complied' }] });
    readable.mockResolvedValue([]);
    expect(await checkPersistedCognitionOutput('user-a', input)).toMatchObject({ checks: [{ status: 'unknown' }] });
    expect(await usage.listAssetUsageReceipts('user-a')).toEqual([]);
    expect(runModel).toHaveBeenCalledTimes(1);
    write.mockRestore();
  });

  it('does not persist adoption for a result edited while its model check was running', async () => {
    await supplied();
    runModel.mockImplementationOnce(async () => {
      const { appendJsonlAtomic } = await import('../../../../src/main/storage');
      const { conversationMessageFile } = await import('../../../../src/main/util/project-layout');
      await appendJsonlAtomic(conversationMessageFile('user-a', 'cid-a'), { id: 'message-a', from: 'commander', text: '核查中更改了结果', turn_id: 'turn-a' });
      return { result: { text: JSON.stringify({ checks: [good] }), meta: {} } };
    });
    const { checkPersistedCognitionOutput } = await import('../../../../src/main/features/recall/cognition-output-check');
    expect(await checkPersistedCognitionOutput('user-a', input)).toMatchObject({ modelCompleted: false, checks: [{ status: 'unknown' }] });
    const { listAssetUsageReceipts } = await import('../../../../src/main/features/recall/asset-usage-receipt');
    expect(await listAssetUsageReceipts('user-a')).toEqual([]);
  });

  it('does not choose one of two different supplied versions of the same cognition', async () => {
    await supplied(); await supplied({ assetVersion: '2' });
    const { checkPersistedCognitionOutput } = await import('../../../../src/main/features/recall/cognition-output-check');
    expect(await checkPersistedCognitionOutput('user-a', input)).toMatchObject({ modelCompleted: false, checks: [{ status: 'unknown' }] });
    expect(runModel).not.toHaveBeenCalled();
  });

  it('keeps a legitimate supplied historical version rather than replacing it with the current body', async () => {
    await supplied();
    current.mockResolvedValue({ id: 'aa-pref', ownerId: 'user-a', status: 'active', scope: 'general', version: '3', activeVersion: '3', statement: '不能代替历史版的当前正文', evidenceRefs: [] });
    const { checkPersistedCognitionOutput } = await import('../../../../src/main/features/recall/cognition-output-check');
    expect(await checkPersistedCognitionOutput('user-a', input)).toMatchObject({ checks: [{ version: '1', status: 'complied' }] });
    expect(JSON.parse(runModel.mock.calls[0][1].message).assets[0]).toMatchObject({ version: '1', content: asset.content });
  });

  it.each(['unsupported', 'budget'])('retains %s supplied items as unknown without a model call', async condition => {
    await supplied();
    snapshot.mockResolvedValue({ type: condition === 'unsupported' ? 'skill_method' : 'cognition', contentCategory: 'unclassified', statement: condition === 'budget' ? '完整事实'.repeat(25_000) : '只可检查有效认知', evidenceRefs: [] });
    const { checkPersistedCognitionOutput } = await import('../../../../src/main/features/recall/cognition-output-check');
    expect(await checkPersistedCognitionOutput('user-a', input)).toMatchObject({ modelCompleted: false, checks: [{ status: 'unknown' }] });
    expect(runModel).not.toHaveBeenCalled();
  });

  it('does not count catalog hints or profile context as a task-authorized citation', async () => {
    await supplied({ channel: 'profile_memory' });
    const { checkPersistedCognitionOutput } = await import('../../../../src/main/features/recall/cognition-output-check');
    expect(await checkPersistedCognitionOutput('user-a', input)).toBeUndefined();
    expect(runModel).not.toHaveBeenCalled();
  });

  it('reassesses native JSON syntax once with the full immutable context and original selected model route', async () => {
    await supplied();
    const chosen = { provider: 'zai', model: 'glm-5.2' };
    const invalid = '{"checks":[{"status":"complied","broken":]}';
    runModel.mockResolvedValueOnce({ result: { text: invalid, meta: {} }, chosen });
    const { checkPersistedCognitionOutput } = await import('../../../../src/main/features/recall/cognition-output-check');
    expect(await checkPersistedCognitionOutput('user-a', input)).toMatchObject({ modelCompleted: true, checks: [{ status: 'complied' }] });
    expect(runModel).toHaveBeenCalledTimes(2);
    const initial = runModel.mock.calls[0][1], repair = runModel.mock.calls[1][1];
    expect(JSON.parse(repair.message)).toEqual({ ...JSON.parse(initial.message), invalidPreviousResponse: invalid });
    expect(repair.modelCandidates).toEqual([chosen]);
    expect(initial.responseFormat).toBe('json_object'); expect(repair.responseFormat).toBe('json_object');
    expect(repair.sessionId).toBe(initial.sessionId + '-syntax-repair');
    expect(await repair.shouldContinue()).toBe(true);
    const { listAssetUsageReceipts } = await import('../../../../src/main/features/recall/asset-usage-receipt');
    expect(await listAssetUsageReceipts('user-a')).toEqual([expect.objectContaining({ status: 'applied', observationMethod: 'model_assisted' })]);
  });

  it('does not attempt a third call when syntax reassessment is still invalid', async () => {
    await supplied(); runModel.mockResolvedValue({ result: { text: '{bad json', meta: {} } });
    const { checkPersistedCognitionOutput } = await import('../../../../src/main/features/recall/cognition-output-check');
    expect(await checkPersistedCognitionOutput('user-a', input)).toMatchObject({ modelCompleted: false, checks: [{ status: 'unknown' }] });
    expect(runModel).toHaveBeenCalledTimes(2);
  });

  it.each([
    { checks: [] },
    { checks: [{ ...good, assetId: 'foreign-asset' }] },
    { checks: [{ ...good, outputEvidence: { quote: 'invented' } }] },
    { checks: [{ ...good, version: '99' }] },
    { checks: [{ ...good, outputEvidence: undefined }] },
  ])('never repairs a valid JSON semantic or evidence refusal: %j', async response => {
    await supplied(); runModel.mockResolvedValue({ result: { text: JSON.stringify(response), meta: {} } });
    const { checkPersistedCognitionOutput } = await import('../../../../src/main/features/recall/cognition-output-check');
    expect(await checkPersistedCognitionOutput('user-a', input)).toMatchObject({ modelCompleted: false, checks: [{ status: 'unknown' }] });
    expect(runModel).toHaveBeenCalledTimes(1);
  });

  it.each(['unknown', 'not_complied'])('does not repair a complete %s observation', async status => {
    await supplied(); runModel.mockResolvedValue({ result: { text: JSON.stringify({ checks: [{ ...good, status }] }), meta: {} } });
    const { checkPersistedCognitionOutput } = await import('../../../../src/main/features/recall/cognition-output-check');
    expect(await checkPersistedCognitionOutput('user-a', input)).toMatchObject({ modelCompleted: true, checks: [{ status }] });
    expect(runModel).toHaveBeenCalledTimes(1);
  });

  it.each([{ error: 'provider unavailable' }, { aborted: true }])('does not repair provider failure or abort: %j', async meta => {
    await supplied(); runModel.mockResolvedValue({ result: { text: '{invalid', meta } });
    const { checkPersistedCognitionOutput } = await import('../../../../src/main/features/recall/cognition-output-check');
    expect(await checkPersistedCognitionOutput('user-a', input)).toMatchObject({ modelCompleted: false });
    expect(runModel).toHaveBeenCalledTimes(1);
  });

  it('does not start checking an aborted request or repair a request aborted during the first call', async () => {
    await supplied(); const controller = new AbortController(); controller.abort();
    const { checkPersistedCognitionOutput } = await import('../../../../src/main/features/recall/cognition-output-check');
    expect(await checkPersistedCognitionOutput('user-a', { ...input, signal: controller.signal })).toBeUndefined();
    expect(runModel).not.toHaveBeenCalled();
    const running = new AbortController();
    runModel.mockImplementationOnce(async () => { running.abort(); return { result: { text: '{invalid', meta: {} } }; });
    expect(await checkPersistedCognitionOutput('user-a', { ...input, signal: running.signal })).toMatchObject({ modelCompleted: false });
    expect(runModel).toHaveBeenCalledTimes(1);
  });

  it.each(['source', 'scope', 'version', 'projection', 'result', 'injections'])('does not repair after the immutable %s baseline changes', async kind => {
    await supplied();
    runModel.mockImplementationOnce(async () => {
      if (kind === 'source') readable.mockResolvedValue([]);
      if (kind === 'scope') current.mockResolvedValue({ id: 'aa-pref', ownerId: 'user-a', status: 'active', scope: 'project', version: '1', evidenceRefs: [] });
      if (kind === 'version') current.mockResolvedValue({ id: 'aa-pref', ownerId: 'user-a', status: 'active', scope: 'general', version: '2', activeVersion: '2', evidenceRefs: [] });
      if (kind === 'projection') projection.mockResolvedValue({ status: 'revoked' });
      if (kind === 'result') await supplied({}, 'Changed answer');
      if (kind === 'injections') await supplied({ assetVersion: '2' });
      return { result: { text: '{invalid', meta: {} } };
    });
    const { checkPersistedCognitionOutput } = await import('../../../../src/main/features/recall/cognition-output-check');
    expect(await checkPersistedCognitionOutput('user-a', input)).toMatchObject({ modelCompleted: false });
    expect(runModel).toHaveBeenCalledTimes(1);
    const { listAppliedUsageReceipts } = await import('../../../../src/main/features/recall/asset-usage-receipt');
    expect(await listAppliedUsageReceipts('user-a', { taskRunIds: ['turn-a'] })).toEqual([]);
  });

  it('rejects a successful syntax reassessment if source access is lost during that call', async () => {
    await supplied(); runModel.mockResolvedValueOnce({ result: { text: '{invalid', meta: {} } });
    runModel.mockImplementationOnce(async () => { readable.mockResolvedValue([]); return { result: { text: JSON.stringify({ checks: [good] }), meta: {} } }; });
    const { checkPersistedCognitionOutput } = await import('../../../../src/main/features/recall/cognition-output-check');
    expect(await checkPersistedCognitionOutput('user-a', input)).toMatchObject({ modelCompleted: false, checks: [{ status: 'unknown' }] });
    expect(runModel).toHaveBeenCalledTimes(2);
  });

  it('does not truncate the immutable context to make room for a malformed previous response', async () => {
    await supplied({}, output + '证据'.repeat(46_500));
    runModel.mockResolvedValueOnce({ result: { text: '{' + ' '.repeat(5_000), meta: {} } });
    const { checkPersistedCognitionOutput } = await import('../../../../src/main/features/recall/cognition-output-check');
    expect(await checkPersistedCognitionOutput('user-a', input)).toMatchObject({ modelCompleted: false });
    expect(runModel).toHaveBeenCalledTimes(1);
    expect(JSON.parse(runModel.mock.calls[0][1].message).output).toBe(output + '证据'.repeat(46_500));
  });


  it.each([
    { name: 'unique real output quote with wrong end', outputEvidence: { quote: good.outputEvidence.quote, start: 0, end: good.outputEvidence.quote.length - 1 } },
    { name: 'correct output quote with wrong optional task end', outputEvidence: good.outputEvidence, taskEvidence: { quote: task, start: 0, end: task.length + 3 } },
    { name: 'unique real quote with a partial coordinate pair', outputEvidence: { quote: good.outputEvidence.quote, start: 0 } },
    { name: 'coordinates without a required quote', outputEvidence: { start: 0, end: good.outputEvidence.quote.length } },
  ])('holds invalid mixed evidence without retry or adoption: $name', async ({ outputEvidence, ...rest }) => {
    await supplied();
    expect(output.indexOf(good.outputEvidence.quote)).toBe(0);
    expect(output.indexOf(good.outputEvidence.quote, 1)).toBe(-1);
    const taskEvidence = 'taskEvidence' in rest ? rest.taskEvidence : undefined;
    runModel.mockResolvedValue({ result: { text: JSON.stringify({ checks: [{ ...good, outputEvidence, ...(taskEvidence ? { taskEvidence } : {}) }] }), meta: {} } });
    const { checkPersistedCognitionOutput } = await import('../../../../src/main/features/recall/cognition-output-check');
    expect(await checkPersistedCognitionOutput('user-a', input)).toMatchObject({ modelCompleted: false, checks: [{ assetId: asset.assetId, version: asset.version, status: 'unknown' }] });
    expect(runModel).toHaveBeenCalledTimes(1);
    const { listAppliedUsageReceipts, listAssetUsageReceipts } = await import('../../../../src/main/features/recall/asset-usage-receipt');
    expect(await listAppliedUsageReceipts('user-a', { taskRunIds: [input.taskRunId] })).toEqual([]);
    expect(await listAssetUsageReceipts('user-a')).toEqual([]);
  });

});
