import { matchesAbilityAssetActiveVersion } from './asset-service';
import type { RecallCandidateRecord, RecallAbilityAssetRecord } from './candidate-service';
import type { RecallCaptureSettingsRecord } from './capture-settings';
import type { RecallAbilityAssetScopePolicy } from './scope-policy';

export interface NightlyApprovalContext {
  captureId: string;
  policyEpoch: string;
  captureCreatedAt: string;
  startedAt: string;
  sourceScope: string;
  sourceScopePolicy: RecallAbilityAssetScopePolicy;
  evidenceReviewed: boolean;
  riskReviewed: boolean;
  actionReviewed: boolean;
  candidateSnapshot: string;
}
export interface AutomaticCandidateReview {
  policyVersion: 1;
  eligible: boolean;
  reasons: string[];
  checkedAt: string;
  policyEpoch?: string;
}
export function approvalCandidateSnapshot(candidate: RecallCandidateRecord): string {
  return JSON.stringify([candidate.judgment, candidate.value, candidate.summary, candidate.risk,
    candidate.suggestedType, candidate.suggestedAction, candidate.suggestedScope, candidate.scopePolicy,
    candidate.targetAssetId, candidate.targetVersionUsed, candidate.evidenceRefs, candidate.sourceRefs,
    candidate.applicableWhen, candidate.forbiddenWhen, candidate.updatedAt]);
}
function sameBoundary(left: unknown, right: unknown): boolean {
  const canonical = (value: unknown) => JSON.stringify(Object.entries((value || {}) as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, entries]) => [key, Array.isArray(entries) ? [...entries].sort() : entries]));
  return canonical(left) === canonical(right);
}
export function evaluateAutomaticCandidateApproval(
  candidate: RecallCandidateRecord,
  settings: RecallCaptureSettingsRecord,
  context: NightlyApprovalContext,
  target?: RecallAbilityAssetRecord,
): AutomaticCandidateReview {
  const reasons: string[] = [];
  if (!settings.autoApproval || !settings.enabled || settings.executionPolicy !== 'nightly') reasons.push('自动批准或夜间发现已关闭');
  if (!settings.autoApprovalEpoch || settings.autoApprovalEpoch !== context.policyEpoch
    || !settings.autoApprovalEnabledAt || Date.parse(context.captureCreatedAt) <= Date.parse(settings.autoApprovalEnabledAt)) reasons.push('本轮不属于开启策略后的新夜间发现');
  if (!candidate.captureKey?.startsWith(`capture-${context.captureId}-`)
    || Date.parse(candidate.createdAt) < Date.parse(context.startedAt)
    || candidate.origin !== 'capture' || candidate.status !== 'pending_review') reasons.push('不是本轮新建的待确认建议');
  if (approvalCandidateSnapshot(candidate) !== context.candidateSnapshot || candidate.userModifiedAt) reasons.push('建议在校验期间已变化');
  if (!context.evidenceReviewed || !candidate.sourceRefs.length || !candidate.evidenceRefs.length
    || candidate.evidenceRefs.some(ref => ref.degraded === true)) reasons.push('证据不完整或尚未核对');
  if (candidate.risk !== 'low' || !context.riskReviewed) reasons.push('风险不是明确的低风险');
  if (candidate.uncertainty?.trim() || candidate.statementIssues?.length) reasons.push('内容仍有不确定或规范问题');
  if (!candidate.summary.trim() || candidate.judgment.trim().length < 12 || !candidate.value.trim()) reasons.push('必要内容不完整');
  if (!context.actionReviewed || !['create', 'update'].includes(candidate.suggestedAction)) reasons.push('此操作需要人工确认');
  if (!context.sourceScope || candidate.suggestedScope !== context.sourceScope
    || !sameBoundary(candidate.scopePolicy, context.sourceScopePolicy)) reasons.push('建议需要扩大来源的使用范围或授权');
  if (candidate.suggestedAction === 'create' && (candidate.targetAssetId || candidate.targetVersionUsed)) reasons.push('新建建议的目标信息不明确');
  if (candidate.suggestedAction === 'update') {
    if (!target || target.status !== 'active' || target.type !== candidate.suggestedType
      || target.scope !== candidate.suggestedScope || !sameBoundary(target.scopePolicy, candidate.scopePolicy)) reasons.push('更新目标状态、类型或授权范围不一致');
    if (!target || !matchesAbilityAssetActiveVersion(target, candidate.targetVersionUsed)) reasons.push('目标版本缺失或已变化');
    if (target && (!sameBoundary({ values: target.applicableWhen }, { values: candidate.applicableWhen })
      || !sameBoundary({ values: target.forbiddenWhen }, { values: candidate.forbiddenWhen }))) reasons.push('更新会改变适用或禁止条件');
  }
  return { policyVersion: 1, eligible: reasons.length === 0, reasons, checkedAt: new Date().toISOString(), policyEpoch: context.policyEpoch };
}
