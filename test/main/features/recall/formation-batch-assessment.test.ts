import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assessFormationBatch } from '../../../../src/main/features/recall/formation-batch-assessment';
import { validateFormationComparison } from '../../../../src/main/features/recall/formation-comparison';
import { reviseFormationRuleSemantics, formationRuleContracts, validateFormationRuleChecks } from '../../../../src/main/features/recall/ontology-rule-semantics';
const { run } = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock('../../../../src/main/features/recall/capture-model-routing', () => ({ runRecallCaptureModel: run }));
const sources = [{ label: 'm1', text: '按刚才那套结构作为以后周报的默认格式，临时简报除外。', approvedQuotes: ['按刚才那套结构作为以后周报的默认格式，临时简报除外。'] }];
const checks = { supported: true, noUnsupportedClaims: true, scopePreserved: true, finalDecisionPreserved: true, priorContentPreserved: true,
  evidence: [{ label: 'm1', quote: sources[0].text }] };
const coverage = { total: 0, selected: 0, truncated: false, unavailable: 0 };
const item = (index: number) => ({ index, candidate: { judgment: '周报先列结论再列事实，临时简报除外。', value: '减少阅读负担。', suggestedScope: 'report', uncertainty: '尚未验证实际效果' }, sources });
const input = () => ({ sessionId: 'one-shot-formation', items: [item(0), item(1)], contextMessages: [{ label: 'm0', role: 'assistant', text: '周报先列结论再列事实。' }, { label: 'm1', role: 'user', text: sources[0].text }], summary: [], existing: { assets: [], coverage }, ontology: {}, feedback: [], modelCandidates: [] });
const rows = () => [0, 1].map(index => ({ index, checks, uncertaintyDisposition: 'effect_unverified', comparison: { relation: 'new', reason: '来源对象与范围明确，当前可读池为空。' } }));
beforeEach(() => { run.mockReset(); });
describe('single merged formation adjudication', () => {
  it('checks all ambiguous proposals once, preserving assistant context and explicit user adoption, and reuses the same source snapshot', async () => {
    run.mockResolvedValue({ result: { text: JSON.stringify({ assessments: rows() }), meta: {} } });
    const checkpoint = await assessFormationBatch('user-a', input());
    expect(run).toHaveBeenCalledTimes(1);
    expect(JSON.parse(run.mock.calls[0][1].message).completeConversationContext[0].role).toBe('assistant');
    expect(await assessFormationBatch('user-a', { ...input(), checkpoint })).toEqual(checkpoint);
    expect(run).toHaveBeenCalledTimes(1);
    const changed = input(); changed.items[0].sources = [{ ...sources[0], text: sources[0].text + '更正。' }];
    await assessFormationBatch('user-a', { ...changed, checkpoint });
    expect(run).toHaveBeenCalledTimes(2);
  });
  it('cannot repair a missing/duplicate verdict or manufacture user assent from assistant text', async () => {
    run.mockResolvedValue({ result: { text: JSON.stringify({ assessments: [rows()[0], rows()[0]] }), meta: {} } });
    await expect(assessFormationBatch('user-a', input())).rejects.toThrow();
    run.mockResolvedValue({ result: { text: JSON.stringify({ assessments: rows().map(row => ({ ...row, checks: { ...checks, evidence: [{ label: 'm0', quote: '周报先列结论再列事实。' }] } })) }), meta: {} } });
    await expect(assessFormationBatch('user-a', input())).rejects.toThrow();
  });
  it('does not establish new identity from truncated context or a target from another object/version', () => {
    expect(() => validateFormationComparison({ relation: 'new', reason: 'unseen' }, [], { ...coverage, truncated: true })).toThrow();
    expect(() => validateFormationComparison({ relation: 'changed', reason: 'dated owner change', targetAssetId: 'same-name-other-project', targetVersion: '1', targetQuote: 'owner' }, [], coverage)).toThrow();
  });
  it('uses the complete summary and every original evidence passage when the full day exceeds the formation budget', async () => {
    const text = sources[0].text + '\n' + '长篇讨论。'.repeat(40_000) + '\n最后更正：仍保留临时简报的例外。';
    const finalQuote = '最后更正：仍保留临时简报的例外。';
    const summary = { sourceDigest: 'complete-source', completedAt: new Date().toISOString(),
      topics: [{ title: '周报', content: '保留完整默认及最后例外。', conditions: [], unresolved: [], attribution: 'user_requirement' as const,
        evidence: [sources[0].text, finalQuote].map(quote => ({ messageId: 'user-1', quote, role: 'user', start: text.indexOf(quote), end: text.indexOf(quote) + quote.length })) }],
      coverage: { messageCount: 1, sourceChars: text.length, segmentCount: 80, processedSegmentIds: ['complete'], maxInputChars: 24_000 } };
    run.mockResolvedValue({ result: { text: JSON.stringify({ assessments: rows() }), meta: {} } });
    await assessFormationBatch('user-a', { ...input(), contextSummary: summary,
      contextMessages: [{ id: 'user-1', label: 'm1', role: 'user', text }], conversationId: 'conversation-a' });
    const dispatched = run.mock.calls[0][1];
    const payload = JSON.parse(dispatched.message);
    expect(dispatched.message.length).toBeLessThan(128_000);
    expect(payload.summary).toEqual(summary.topics);
    expect(payload.completeConversationContext[0].text).toContain(finalQuote);
    expect(payload.completeConversationContext[0].text).toContain(sources[0].text);
    expect(payload.contextCoverage.sourceChars).toBe(text.length);
    expect(dispatched.cliContext).toEqual({ conversationId: 'conversation-a' });
  });
  it('distinguishes invalid assessments from unavailable models and oversized complete targets', async () => {
    run.mockResolvedValue({ result: { text: 'not json', meta: {} } });
    await expect(assessFormationBatch('user-a', input())).rejects.toMatchObject({ reason: 'assessment_invalid' });
    run.mockRejectedValue(new Error('offline'));
    await expect(assessFormationBatch('user-a', input())).rejects.toMatchObject({ reason: 'model_unavailable' });
    await expect(assessFormationBatch('user-a', { ...input(), ontology: 'x'.repeat(128_000) })).rejects.toMatchObject({ reason: 'context_too_large' });
  });
});

it('uses the same batch to merge a reread target, preserving its default while adding a supported exception', async () => {
  const original = item(0);
  const target = { id: 'asset-a', version: '2', title: '周报结构', statement: '周报先列结论再列事实。', type: 'cognition' as const, scope: 'report', evidenceRefs: [] };
  run.mockResolvedValue({ result: { text: JSON.stringify({ assessments: [{ index: 0, checks, uncertaintyDisposition: 'effect_unverified',
    comparison: { relation: 'exception', targetAssetId: target.id, targetVersion: target.version, targetQuote: target.statement, reason: '保留默认，只补来源中的简报例外。' },
    revision: { judgment: '周报先列结论再列事实。临时简报除外。', applicableWhen: ['周报'], forbiddenWhen: ['临时简报'] } }] }), meta: {} } });
  const result = await assessFormationBatch('user-a', { ...input(), items: [{ ...original, candidate: { ...original.candidate, targetAssetId: target.id } }],
    existing: { assets: [target], coverage: { ...coverage, total: 1, selected: 1 } } });
  expect(result.assessments[0].revision?.judgment).toBe('周报先列结论再列事实。临时简报除外。');
  expect(run).toHaveBeenCalledTimes(1);
});

it('repairs only source-supported rule semantics before the first complete preview without changing body or source ownership', async () => {
  const { emptyOntologyDocument } = await import('../../../../src/main/features/cognition/ontology/model');
  const { applyOntologyCommand } = await import('../../../../src/main/features/cognition/ontology/commands');
  const { parseOntologyFormationProposal, validateOntologyFormationScope } = await import('../../../../src/main/features/recall/ontology-formation');
  const body = '部署评审必须写风险和回退条件；普通例会不加这两栏。';
  const raw = { reason: 'User scoped obligation', evidence: ['m1'], actions: [{ intent: 'create', recordId: 'review-rule', sourceLabel: 'Explicit deployment-review requirement',
    record: { kind: 'rule', moduleId: 'project-module', name: 'Deployment review', requirementSource: 'cognition_body',
      strength: 'default', condition: null, effect: { kind: 'note' }, exception: '普通例会不适用' } }],
    refs: [{ moduleId: 'project-module', recordId: 'review-rule', versionPolicy: 'current', sharedBody: true }] };
  const semantic = { recordId: 'review-rule', strength: 'required', condition: null, effect: { kind: 'note' }, exception: '普通例会不适用' };
  const doc = applyOntologyCommand(emptyOntologyDocument('user-a'), { commandId: 'seed-module', expectedRevision: 0,
    actions: [{ intent: 'create', recordId: 'project-module', sourceLabel: 'Fixture project scope', record: { kind: 'module', name: 'Scoped module', description: '', scope: { kind: 'project', id: 'project-a' } } }] }, new Date().toISOString()).document;
  run.mockResolvedValue({ result: { text: JSON.stringify({ assessments: [{ index: 0, checks: { ...checks, evidence: [{ label: 'm1', quote: body }] },
    uncertaintyDisposition: 'none', sourceRuleConclusions: [{ recordId: semantic.recordId, status: 'resolved',
      expectedContract: { strength: semantic.strength, condition: semantic.condition, effect: semantic.effect, exception: semantic.exception },
      topicEvidence: [{ label: 'm1', quote: body }], fieldEvidence: { strength: [{ label: 'm1', quote: body }], condition: [], effect: [],
        exception: [{ label: 'm1', quote: body }] } }] }] }), meta: {} } });
  const result = await assessFormationBatch('user-a', { ...input(), items: [{ index: 0, candidate: { judgment: body, value: 'Safe decision', suggestedScope: 'review', ontologyChanges: raw },
    sources: [{ label: 'm1', text: body, approvedQuotes: [body] }] }], ontology: { revision: doc.revision, records: Object.values(doc.records) } });
  const revised = reviseFormationRuleSemantics(raw, result.assessments[0].ruleRevisions!);
  const plan = validateOntologyFormationScope('user-a', doc, parseOntologyFormationProposal(doc, 'candidate-a', revised, body), { projectIds: ['project-a'] })!;
  expect(plan.blockedReasons).toEqual([]);
  expect(plan.previewChanges[0].after).toMatchObject({ kind: 'rule', requirement: body, strength: 'required', effect: { kind: 'note' }, exception: '普通例会不适用' });
  expect(raw.actions[0].record.strength).toBe('default');
  expect(doc.records['review-rule']).toBeUndefined();
  // Wrong scope and an invented typed effect remain blocked by the ordinary
  // canonical/parser gates rather than being inferred from the word 必须.
  expect(validateOntologyFormationScope('user-a', doc, plan, { projectIds: ['project-b'] })!.blockedReasons.length).toBeGreaterThan(0);
  expect(() => reviseFormationRuleSemantics(raw, [{ ...semantic, effect: { kind: 'run_arbitrary_code' } }] as any)).toThrow();
  expect(() => reviseFormationRuleSemantics(raw, [{ ...semantic, recordId: 'unowned-rule' }] as any)).toThrow();
  expect(() => reviseFormationRuleSemantics({ ...raw, actions: [{ ...raw.actions[0], record: { kind: 'assertion' } }] }, [semantic] as any)).toThrow();
});

it('rejects missing duplicate or mismatched per-rule fields instead of accepting a prose-only repair', () => {
  const first = { recordId: 'rule-a', strength: 'default' as const, condition: null, effect: { kind: 'note' }, exception: '临时简报除外' };
  const second = { ...first, recordId: 'rule-b' };
  const checked = { ...first, checks: { strengthPreserved: true, conditionPreserved: true, effectPreserved: true, exceptionPreserved: true }, evidence: checks.evidence };
  expect(() => validateFormationRuleChecks(undefined, [first], sources)).toThrow();
  expect(() => validateFormationRuleChecks([{ ...checked, effect: undefined }], [first], sources)).toThrow();
  expect(() => validateFormationRuleChecks([checked, checked], [first, second], sources)).toThrow();
  for (const mismatch of [{ strength: 'required' }, { condition: { kind: 'task', field: 'purpose', equals: 'invented' } },
    { effect: { kind: 'required_section', name: 'invented' } }, { exception: '' }]) {
    expect(() => validateFormationRuleChecks([{ ...checked, ...mismatch }], [first], sources)).toThrow();
  }
  // Normalized create shapes, inherited update metadata and unchanged R refs
  // all require an explicit check; none can hide behind lexical body support.
  const canonical = { id: 'rule-b', kind: 'rule', ...second };
  const raw = { actions: [{ intent: 'create', recordId: 'rule-a', record: { moduleId: 'module', name: 'Rule', requirement: 'Body', ...first } },
    { intent: 'update', recordId: 'rule-b', patch: { exception: 'changed' } }], refs: [{ recordId: 'rule-b' }] };
  expect(formationRuleContracts(raw, [canonical])).toEqual([first, { ...second, exception: 'changed' }]);
  const pinned = { refs: [{ recordId: 'rule-b', versionPolicy: 'pinned', targetVersion: 1 }] };
  expect(() => formationRuleContracts(pinned, [{ ...canonical, version: 2 }])).toThrow();
  expect(formationRuleContracts(pinned, [{ ...canonical, version: 2 }, { ...canonical, version: 1, strength: 'required' }]))
    .toEqual([{ ...second, strength: 'required' }]);
});

it.each(['unresolved', 'not_supported'])('holds an overall true verdict when source rule meaning is %s', async status => {
  const semantic = { recordId: 'rule-a', strength: 'default', condition: null, effect: { kind: 'note' }, exception: '临时简报除外' };
  const raw = { actions: [{ intent: 'create', recordId: semantic.recordId, record: { kind: 'rule', ...semantic } }] };
  const sourceRuleConclusions = [{ recordId: semantic.recordId, status, reason: 'Source meaning is unresolved or belongs to another topic.' }];
  run.mockResolvedValue({ result: { text: JSON.stringify({ assessments: [{ index: 0, checks, uncertaintyDisposition: 'none', sourceRuleConclusions }] }), meta: {} } });
  const result = await assessFormationBatch('user-a', { ...input(), items: [{ ...item(0), candidate: { ...item(0).candidate, ontologyChanges: raw } }] });
  expect(result.assessments[0].checks).toMatchObject({ supported: false, finalDecisionPreserved: false });
  expect(result.assessments[0].ruleRevisions).toBeUndefined();
});
