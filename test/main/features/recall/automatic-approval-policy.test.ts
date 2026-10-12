import { describe, expect, it } from 'vitest';
import { approvalCandidateSnapshot, evaluateAutomaticCandidateApproval, type NightlyApprovalContext } from '../../../../src/main/features/recall/automatic-approval-policy';
import type { RecallCandidateRecord, RecallAbilityAssetRecord } from '../../../../src/main/features/recall/candidate-service';
import type { RecallCaptureSettingsRecord } from '../../../../src/main/features/recall/capture-settings';

function fixture() {
  const settings = { enabled: true, executionPolicy: 'nightly', autoApproval: true, autoApprovalEnabledAt: '2026-10-11T00:00:00.000Z', autoApprovalEpoch: 'epoch-1' } as RecallCaptureSettingsRecord;
  const candidate = { id: 'c-1', origin: 'capture', captureKey: 'capture-batch-1-0', status: 'pending_review',
    judgment: '在当前项目进行变更时，先核对实际使用版本再保存。', value: '避免覆盖并发变更', summary: '保存时核对版本', risk: 'low',
    suggestedType: 'rule', suggestedAction: 'create', suggestedScope: 'code', scopePolicy: { projectIds: ['project-1'] },
    sourceRefs: [{ kind: 'conversation', id: 'conv-1' }], evidenceRefs: [{ kind: 'conversation', id: 'conv-1' }],
    createdAt: '2026-10-11T02:00:01.000Z', updatedAt: '2026-10-11T02:00:01.000Z' } as RecallCandidateRecord;
  const context: NightlyApprovalContext = { captureId: 'batch-1', policyEpoch: 'epoch-1', captureCreatedAt: '2026-10-11T01:00:00.000Z', startedAt: '2026-10-11T02:00:00.000Z',
    sourceScope: 'code', sourceScopePolicy: { projectIds: ['project-1'] }, evidenceReviewed: true, riskReviewed: true, actionReviewed: true, candidateSnapshot: approvalCandidateSnapshot(candidate) };
  return { candidate, context, settings };
}
describe('nightly low-risk automatic approval boundary', () => {
  it('allows only a new complete low-risk candidate inside its original source boundary', () => {
    const { candidate, settings, context } = fixture();
    expect(evaluateAutomaticCandidateApproval(candidate, settings, context)).toMatchObject({ eligible: true, reasons: [] });
  });
  it.each([
    ['disabled', (f: ReturnType<typeof fixture>) => { f.settings.autoApproval = false; }],
    ['reenabled epoch', (f: ReturnType<typeof fixture>) => { f.settings.autoApprovalEpoch = 'epoch-2'; }],
    ['backlog capture', (f: ReturnType<typeof fixture>) => { f.context.captureCreatedAt = f.settings.autoApprovalEnabledAt!; }],
    ['backlog candidate', (f: ReturnType<typeof fixture>) => { f.candidate.createdAt = '2026-10-10T02:00:00.000Z'; }],
    ['other producer', (f: ReturnType<typeof fixture>) => { f.candidate.captureKey = 'capture-other-0'; }],
    ['missing evidence check', (f: ReturnType<typeof fixture>) => { f.context.evidenceReviewed = false; }],
    ['degraded evidence', (f: ReturnType<typeof fixture>) => { f.candidate.evidenceRefs[0].degraded = true; }],
    ['high risk', (f: ReturnType<typeof fixture>) => { f.candidate.risk = 'high'; }],
    ['defaulted risk', (f: ReturnType<typeof fixture>) => { f.context.riskReviewed = false; }],
    ['defaulted action', (f: ReturnType<typeof fixture>) => { f.context.actionReviewed = false; }],
    ['unknown risk', (f: ReturnType<typeof fixture>) => { f.candidate.risk = undefined as never; }],
    ['global expansion', (f: ReturnType<typeof fixture>) => { f.candidate.scopePolicy = undefined; }],
    ['new scope', (f: ReturnType<typeof fixture>) => { f.candidate.suggestedScope = 'general'; }],
    ['edited content', (f: ReturnType<typeof fixture>) => { f.candidate.judgment += '新增未经核对的内容'; }],
    ['uncertainty', (f: ReturnType<typeof fixture>) => { f.candidate.uncertainty = '尚不明确'; }],
  ])('returns %s to manual review', (_label, mutate) => {
    const f = fixture(); mutate(f);
    expect(evaluateAutomaticCandidateApproval(f.candidate, f.settings, f.context).eligible).toBe(false);
  });
  it('requires the actual version and all target authorization/type/condition boundaries to remain unchanged', () => {
    const f = fixture();
    Object.assign(f.candidate, { suggestedAction: 'update', targetAssetId: 'asset-1', targetVersionUsed: '3' });
    f.context.candidateSnapshot = approvalCandidateSnapshot(f.candidate);
    const target = { id: 'asset-1', type: 'rule', status: 'active', scope: 'code', scopePolicy: { projectIds: ['project-1'] }, version: '3' } as RecallAbilityAssetRecord;
    expect(evaluateAutomaticCandidateApproval(f.candidate, f.settings, f.context, target).eligible).toBe(true);
    expect(evaluateAutomaticCandidateApproval(f.candidate, f.settings, f.context, { ...target, version: '4' }).eligible).toBe(false);
    expect(evaluateAutomaticCandidateApproval(f.candidate, f.settings, f.context, { ...target, status: 'paused' }).eligible).toBe(false);
    expect(evaluateAutomaticCandidateApproval(f.candidate, f.settings, f.context, { ...target, applicableWhen: ['只用于评审'] }).eligible).toBe(false);
  });
});
