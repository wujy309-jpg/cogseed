import { beforeEach, expect, it, vi } from 'vitest';
const run = vi.hoisted(() => vi.fn());
vi.mock('../../../../src/main/features/recall/capture-model-routing', () => ({ runRecallCaptureModel: run }));
import { assessRecallCaptureUncertainty, parseCaptureUncertaintyAssessment, type CaptureUncertaintyInput } from '../../../../src/main/features/recall/capture-uncertainty';
const text = '以后诊断超时先读取时间线，按同一请求比较重试和依赖耗时，分别验证网络和服务端假设；证据不足时停止归因并保留未验证状态。';
const approved = '诊断超时先读取时间线';
const source = { label: 'm1', text, approvedQuotes: [approved] };
const candidate = { judgment: text, value: '用于后续诊断类似超时问题，减少无依据归因。', suggestedScope: 'general', suggestedAction: 'create',
  uncertainty: '该方法尚未在任何具体故障案例中使用或验证效果。', applicableWhen: ['诊断超时且有请求时间线'], forbiddenWhen: ['缺乏证据时直接归因'] };
const positive = { supported: true, noUnsupportedClaims: true, scopePreserved: true, finalDecisionPreserved: true,
  priorContentPreserved: true, uncertaintyDisposition: 'effect_unverified', evidence: [{ label: 'm1', quote: approved }] };
function input(overrides: Partial<CaptureUncertaintyInput> = {}): CaptureUncertaintyInput {
  return { sessionId: 'one-shot-uncertainty', candidate: structuredClone(candidate), sources: [structuredClone(source)],
    contextMessages: [{ label: 'm1', id: 'original-user', role: 'user', text },
      { label: 'm2', id: 'original-assistant', role: 'assistant', text: '可以以后照这个完整步骤核查，是否有效仍需实际验证。' }],
    summary: [{ title: '完整诊断方法', content: text, conditions: ['证据不足停止归因'], unresolved: [] }],
    modelCandidates: [{ provider: 'configured-provider', model: 'configured-check-model' }], ...overrides };
}
beforeEach(() => run.mockReset().mockResolvedValue({ result: { text: JSON.stringify(positive), meta: {} } }));

it('accepts a single complete fenced assessment followed by explanation without changing its checks or source boundaries', async () => {
  run.mockResolvedValue({ result: { text: `\u0060\u0060\u0060json\n${JSON.stringify(positive)}\n\u0060\u0060\u0060\n\n判定说明：本条方法完整，但效果尚未独立验证。`, meta: {} } });
  const original = input();
  const before = structuredClone(original);
  expect(await assessRecallCaptureUncertainty('alice', original)).toMatchObject({ modelCompleted: true, nonBlocking: true,
    uncertaintyDisposition: 'effect_unverified', checks: { supported: true, noUnsupportedClaims: true, scopePreserved: true,
      finalDecisionPreserved: true, priorContentPreserved: true } });
  expect(original).toEqual(before);
  run.mockResolvedValue({ result: { text: `\u0060\u0060\u0060json\n${JSON.stringify({ ...positive, noUnsupportedClaims: false })}\n\u0060\u0060\u0060\n说明不能代替语义检查。`, meta: {} } });
  expect(await assessRecallCaptureUncertainty('alice', original)).toMatchObject({ modelCompleted: true, nonBlocking: false,
    reason: 'uncertainty_semantic_support_failed' });
});

it('rejects alternative structured verdicts rather than choosing the first JSON payload', () => {
  const fenced = `\u0060\u0060\u0060json\n${JSON.stringify(positive)}\n\u0060\u0060\u0060`;
  for (const suffix of [fenced, JSON.stringify({ ...positive, supported: false }), '[{"supported":false}]', '\u0060\u0060\u0060text\nother payload\n\u0060\u0060\u0060']) {
    expect(() => parseCaptureUncertaintyAssessment(`${fenced}\n${suffix}`, [source])).toThrow();
  }
});

it('keeps a complete untested method and its boundaries unchanged without claiming demonstrated effects', async () => {
  const original = input();
  const before = structuredClone(original);
  const result = await assessRecallCaptureUncertainty('alice', original);
  expect(result).toMatchObject({ modelCompleted: true, nonBlocking: true, uncertaintyDisposition: 'effect_unverified', method: 'model_assisted',
    checks: { supported: true, noUnsupportedClaims: true, scopePreserved: true, finalDecisionPreserved: true, priorContentPreserved: true } });
  expect(original).toEqual(before);
  const payload = JSON.parse(run.mock.calls[0][1].message);
  expect(payload.candidate).toEqual(candidate);
  expect(payload.completeConversationContext).toEqual(original.contextMessages);
  expect(payload.approvedUserSources).toEqual([source]);
  expect(run.mock.calls[0]).toEqual(['alice', expect.objectContaining({ modelCandidates: original.modelCandidates, sessionId: original.sessionId })]);
  expect(result.evidence).toEqual([{ label: 'm1', messageId: 'original-user', start: text.indexOf(approved), end: text.indexOf(approved) + approved.length, quoteHash: expect.stringMatching(/^[a-f0-9]{64}$/) }]);
  expect(result.candidateHash).toMatch(/^[a-f0-9]{64}$/);
  expect(result.sourceHash).toMatch(/^[a-f0-9]{64}$/);
  expect(result.inputHash).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify(result)).not.toContain(approved);
  expect(JSON.stringify(result)).not.toContain(candidate.uncertainty);
  expect(result).not.toHaveProperty('judgment');
});

it('classifies missing earlier history outside an explicitly dated claim without extending ontology validity', async () => {
  const dated = '自2026年9月22日起我担任示例项目的技术负责人；此前的职责不在本条陈述范围内。';
  run.mockResolvedValue({ result: { text: JSON.stringify({ ...positive, uncertaintyDisposition: 'outside_claim_scope', evidence: [{ label: 'm1', quote: dated }] }), meta: {} } });
  const result = await assessRecallCaptureUncertainty('alice', input({ candidate: { ...candidate, judgment: dated,
    uncertainty: '9月22日之前的职责来源未说明，本条仅记录9月22日起。', ontologyChanges: { actions: [{ validity: { from: '2026-09-22', until: null } }] } },
    sources: [{ label: 'm1', text: dated, approvedQuotes: [dated] }], contextMessages: [{ label: 'm1', role: 'user', text: dated }] }));
  expect(result).toMatchObject({ nonBlocking: true, uncertaintyDisposition: 'outside_claim_scope' });
  expect(JSON.parse(run.mock.calls[0][1].message).candidate.ontologyChanges.actions[0].validity.from).toBe('2026-09-22');
});

it('preserves a user-attributed report without pretending absent external documentation was verified', async () => {
  const report = '我说明一下：从2026年9月22日起，我负责示例项目的技术协调。';
  run.mockResolvedValue({ result: { text: JSON.stringify({ ...positive, uncertaintyDisposition: 'source_attribution_only', evidence: [{ label: 'm1', quote: report }] }), meta: {} } });
  const result = await assessRecallCaptureUncertainty('alice', input({ candidate: { ...candidate,
    judgment: '根据用户本人陈述，自2026年9月22日起其负责示例项目技术协调。', uncertainty: '未见独立原始材料佐证用户的这项陈述。' },
    sources: [{ label: 'm1', text: report, approvedQuotes: [report] }], contextMessages: [{ label: 'm1', role: 'user', text: report }] }));
  expect(result).toMatchObject({ nonBlocking: true, uncertaintyDisposition: 'source_attribution_only', method: 'model_assisted' });
  expect(result).not.toHaveProperty('externallyVerified');
});

it.each([
  '该方法效果尚未验证；涉及的是哪位负责人仍未确定。',
  '9月22日之前未知；9月22日后的项目范围也尚未确认。',
  '未见外部文件；不清楚是用户本人决定还是助手仅提出建议。',
  '尚无实际验证；停止条件及禁止使用的环境未明确。',
])('retains mixed substantive uncertainty even if the other clause would be nonblocking: %s', async uncertainty => {
  run.mockResolvedValue({ result: { text: JSON.stringify({ ...positive, uncertaintyDisposition: 'content_unresolved' }), meta: {} } });
  const original = input({ candidate: { ...candidate, uncertainty } });
  expect(await assessRecallCaptureUncertainty('alice', original)).toMatchObject({ modelCompleted: true, nonBlocking: false, uncertaintyDisposition: 'content_unresolved', reason: 'uncertainty_content_unresolved' });
  expect(original.candidate.uncertainty).toBe(uncertainty);
});

it.each(['supported', 'noUnsupportedClaims', 'scopePreserved', 'finalDecisionPreserved', 'priorContentPreserved'])('does not clear uncertainty when the independent %s check fails', async key => {
  run.mockResolvedValue({ result: { text: JSON.stringify({ ...positive, [key]: false }), meta: {} } });
  expect(await assessRecallCaptureUncertainty('alice', input())).toMatchObject({ nonBlocking: false, modelCompleted: true, reason: 'uncertainty_semantic_support_failed' });
});

it('rejects fabricated evidence, unrelated topics, assistant labels, extra fields and malformed booleans', () => {
  for (const raw of [
    { ...positive, uncertaintyDisposition: 'safe_to_save' }, { ...positive, supported: 'true' },
    { ...positive, evidence: [] }, { ...positive, evidence: [{ label: 'm1', quote: '实际已经证明节省一半时间' }] },
    { ...positive, evidence: [{ label: 'm2', quote: approved }] }, { ...positive, judgment: 'model rewrite' },
    { ...positive, evidence: [{ label: 'm1', quote: '分别验证网络和服务端假设' }] },
  ]) expect(() => parseCaptureUncertaintyAssessment(JSON.stringify(raw), [source])).toThrow();
});

it('requires an explicitly approved quote and matching full USER context before any independent model call', async () => {
  for (const original of [
    input({ sources: [{ label: 'm1', text }] }),
    input({ sources: [{ label: 'm1', text, approvedQuotes: ['不存在的批准片段'] }] }),
    input({ contextMessages: [{ label: 'm1', role: 'assistant', text }] }),
    input({ contextMessages: [{ label: 'm1', role: 'user', text: 'different original passage' }] }),
    input({ contextMessages: [] }),
  ]) expect(await assessRecallCaptureUncertainty('alice', original)).toMatchObject({ modelCompleted: false, nonBlocking: false, reason: 'uncertainty_context_unavailable' });
  expect(run).not.toHaveBeenCalled();
});

it('checks a full revision with its actual target and returns only a target fingerprint', async () => {
  const target = { id: 'aa-target', statement: '既有诊断方法要求按同一请求比较依赖耗时，并禁止证据不足时直接归因。', scope: 'general', version: '1' };
  const original = input({ candidate: { ...candidate, suggestedAction: 'update', targetAssetId: target.id }, existingTarget: target });
  const result = await assessRecallCaptureUncertainty('alice', original);
  expect(result).toMatchObject({ nonBlocking: true, targetHash: expect.stringMatching(/^[a-f0-9]{64}$/) });
  expect(JSON.parse(run.mock.calls[0][1].message).existingTarget).toEqual(target);
  expect(JSON.stringify(result)).not.toContain(target.statement);
  await expect(assessRecallCaptureUncertainty('alice', { ...original, existingTarget: undefined })).resolves.toMatchObject({ nonBlocking: false, reason: 'uncertainty_target_unavailable' });
  expect(run).toHaveBeenCalledTimes(1);
});

it.each([{ error: { kind: 'network' } }, { aborted: true }])('keeps original uncertainty for incomplete model output: %j', async meta => {
  run.mockResolvedValue({ result: { text: JSON.stringify(positive), meta } });
  expect(await assessRecallCaptureUncertainty('alice', input())).toMatchObject({ nonBlocking: false, modelCompleted: false, uncertaintyDisposition: 'content_unresolved', reason: 'uncertainty_model_unavailable' });
});

it('rejects ambiguous evidence coordinates and invented attribution in an otherwise positive classification', async () => {
  const repeated = text + text;
  run.mockResolvedValueOnce({ result: { text: JSON.stringify(positive), meta: {} } });
  expect(await assessRecallCaptureUncertainty('alice', input({ sources: [{ label: 'm1', text: repeated, approvedQuotes: [approved] }], contextMessages: [{ label: 'm1', role: 'user', text: repeated }] })))
    .toMatchObject({ nonBlocking: false, reason: 'uncertainty_assessment_invalid' });
  run.mockResolvedValueOnce({ result: { text: JSON.stringify({ ...positive, evidence: [{ label: 'm2', quote: '可以以后照这个完整步骤核查，是否有效仍需实际验证。' }] }), meta: {} } });
  expect(await assessRecallCaptureUncertainty('alice', input())).toMatchObject({ nonBlocking: false, reason: 'uncertainty_assessment_invalid' });
});

it('does not truncate full context to classify a partial source as supported', async () => {
  const large = text + '补充上下文。'.repeat(20_000);
  expect(await assessRecallCaptureUncertainty('alice', input({ sources: [{ label: 'm1', text: large, approvedQuotes: [approved] }], contextMessages: [{ label: 'm1', role: 'user', text: large }] })))
    .toMatchObject({ nonBlocking: false, reason: 'uncertainty_context_too_large' });
  expect(run).not.toHaveBeenCalled();
});

it('binds assessment fingerprints to original uncertainty, boundaries, joint ontology and complete context', async () => {
  const original = input();
  const first = await assessRecallCaptureUncertainty('alice', original);
  for (const candidate of [
    { ...original.candidate, uncertainty: '涉及具体对象尚未确认。' },
    { ...original.candidate, forbiddenWhen: ['altered boundary'] },
    { ...original.candidate, ontologyChanges: { actions: [{ intent: 'create', record: { object: 'unsupported new meaning' } }] } },
  ]) {
    const result = await assessRecallCaptureUncertainty('alice', { ...original, candidate });
    expect(result.candidateHash).not.toBe(first.candidateHash);
    expect(result.inputHash).not.toBe(first.inputHash);
  }
  const alteredContext = await assessRecallCaptureUncertainty('alice', { ...original, contextMessages: [original.contextMessages[0], { ...original.contextMessages[1], text: '更正说明与范围。' }] });
  expect(alteredContext.sourceHash).not.toBe(first.sourceHash);
  expect(alteredContext.inputHash).not.toBe(first.inputHash);
});

it('never mutates inputs after the independent model wait and checks caller continuation again', async () => {
  const original = input();
  let continuation = true;
  run.mockImplementationOnce(async () => { continuation = false; return { result: { text: JSON.stringify(positive), meta: {} } }; });
  expect(await assessRecallCaptureUncertainty('alice', { ...original, shouldContinue: async () => continuation }))
    .toMatchObject({ nonBlocking: false, reason: 'uncertainty_model_unavailable' });
  expect(original.candidate.uncertainty).toBe(candidate.uncertainty);
});

it('uses host interruption metadata for actual runner abort and ABORT_ERR without accepting a model-supplied field', async () => {
  run.mockResolvedValueOnce({ result: { text: '', meta: { aborted: true } } });
  expect(await assessRecallCaptureUncertainty('alice', input())).toMatchObject({ interrupted: true, modelCompleted: false, nonBlocking: false });
  run.mockRejectedValueOnce(Object.assign(new Error('host aborted'), { code: 'ABORT_ERR' }));
  expect(await assessRecallCaptureUncertainty('alice', input())).toMatchObject({ interrupted: true, nonBlocking: false });
  run.mockResolvedValueOnce({ result: { text: JSON.stringify({ ...positive, interrupted: true }), meta: {} } });
  const invalid = await assessRecallCaptureUncertainty('alice', input());
  expect(invalid).toMatchObject({ nonBlocking: false, reason: 'uncertainty_assessment_invalid' });
  expect(invalid.interrupted).toBeUndefined();
  run.mockResolvedValueOnce({ result: { text: '', meta: { error: { kind: 'network' } } } });
  const failed = await assessRecallCaptureUncertainty('alice', input());
  expect(failed).toMatchObject({ nonBlocking: false, reason: 'uncertainty_model_unavailable' });
  expect(failed.interrupted).toBeUndefined();
});

it('uses approved fragment selection for the exact observed typo case without rewriting content or manufacturing effect proof', async () => {
  const originalQuote = '没有证据表明效果已经改善';
  const sourceText = text + '没有证据表明效果已经改善。';
  const original = input({ candidate: { ...candidate, judgment: sourceText }, sources: [{ label: 'm1', text: sourceText, approvedQuotes: [originalQuote] }],
    contextMessages: [{ label: 'm1', id: 'exact-user', role: 'user', text: sourceText }] });
  const before = structuredClone(original);
  run.mockResolvedValueOnce({ result: { text: JSON.stringify({ ...positive, evidence: [{ label: 'm1', quote: '没有证据表明效果已改善' }] }), meta: {} } });
  expect(await assessRecallCaptureUncertainty('alice', original)).toMatchObject({ nonBlocking: false, reason: 'uncertainty_assessment_invalid' });
  run.mockResolvedValueOnce({ result: { text: JSON.stringify({ ...positive, evidence: [{ label: 'm1', approvedQuoteIndex: 0 }] }), meta: {} } });
  const observed = await assessRecallCaptureUncertainty('alice', original);
  expect(observed).toMatchObject({ modelCompleted: true, nonBlocking: true, uncertaintyDisposition: 'effect_unverified',
    evidence: [{ label: 'm1', messageId: 'exact-user', start: sourceText.indexOf(originalQuote), end: sourceText.indexOf(originalQuote) + originalQuote.length, quoteHash: expect.stringMatching(/^[a-f0-9]{64}$/) }] });
  expect(original).toEqual(before);
  expect(JSON.stringify(observed)).not.toContain(originalQuote);
  expect(observed).not.toHaveProperty('effectVerified');
});

it.each(['supported', 'noUnsupportedClaims', 'scopePreserved', 'finalDecisionPreserved', 'priorContentPreserved'])('requires %s even when uncertainty evidence selects a legitimate approved fragment', async key => {
  run.mockResolvedValue({ result: { text: JSON.stringify({ ...positive, [key]: false, evidence: [{ label: 'm1', approvedQuoteIndex: 0 }] }), meta: {} } });
  expect(await assessRecallCaptureUncertainty('alice', input())).toMatchObject({ nonBlocking: false, modelCompleted: true, reason: 'uncertainty_semantic_support_failed' });
});

it('keeps content-unresolved and nonunique indexed coordinates manual', async () => {
  run.mockResolvedValueOnce({ result: { text: JSON.stringify({ ...positive, uncertaintyDisposition: 'content_unresolved', evidence: [{ label: 'm1', approvedQuoteIndex: 0 }] }), meta: {} } });
  expect(await assessRecallCaptureUncertainty('alice', input())).toMatchObject({ nonBlocking: false, reason: 'uncertainty_content_unresolved' });
  run.mockResolvedValueOnce({ result: { text: JSON.stringify({ ...positive, evidence: [{ label: 'm1', approvedQuoteIndex: 0 }] }), meta: {} } });
  const repeated = text + text;
  expect(await assessRecallCaptureUncertainty('alice', input({ sources: [{ label: 'm1', text: repeated, approvedQuotes: [approved] }], contextMessages: [{ label: 'm1', role: 'user', text: repeated }] })))
    .toMatchObject({ nonBlocking: false, reason: 'uncertainty_assessment_invalid' });
});

it('does not use indexed evidence from an assistant source or unapproved full text', async () => {
  run.mockResolvedValue({ result: { text: JSON.stringify({ ...positive, evidence: [{ label: 'm1', approvedQuoteIndex: 0 }] }), meta: {} } });
  for (const original of [input({ contextMessages: [{ label: 'm1', role: 'assistant', text }] }), input({ sources: [{ label: 'm1', text }] })]) {
    expect(await assessRecallCaptureUncertainty('alice', original)).toMatchObject({ nonBlocking: false, modelCompleted: false, reason: 'uncertainty_context_unavailable' });
  }
  expect(run).not.toHaveBeenCalled();
});
