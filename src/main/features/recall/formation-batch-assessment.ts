import { z } from 'zod';
import { createHash } from 'node:crypto';
/** One ambiguity check for the complete formation batch, not one call per item.
 * Keeps attribution, target identity, merged content and uncertainty together. */
import { prompts } from '../../prompts/loader';
import { runRecallCaptureModel } from './capture-model-routing';
import { parseCaptureAssessmentJson, parseCaptureGroundingAssessment, type GroundingCandidate, type GroundingSource, type CaptureGroundingAssessment } from './capture-grounding';
import { validateFormationComparison, type FormationComparison } from './formation-comparison';
import type { CaptureExistingAssetsResult } from './capture-existing-assets';
import type { RecallCaptureModelCandidate } from './capture-settings';
import type { CaptureModelBudgetContext } from './capture-model-budget';
import type { CaptureContextSummary } from './capture-context-summary';
import { captureSourcePassages } from './capture-context-payload';
import { ONTOLOGY_RULE_SEMANTICS, SOURCE_RULE_CONCLUSION_PROTOCOL, formationRuleContext, formationRuleContracts, formationRuleSourceRequests,
  blindFormationRuleCandidate, parseSourceRuleConclusions, deriveFormationRuleRevisions,
  type FormationRuleRevision, type SourceRuleConclusion } from './ontology-rule-semantics';
export interface FormationBatchItem { index: number; candidate: GroundingCandidate; sources: GroundingSource[] }
const revisionSchema = z.object({ judgment: z.string().trim().min(1).max(4000),
  applicableWhen: z.array(z.string().trim().min(1).max(500)).max(32).optional(),
  forbiddenWhen: z.array(z.string().trim().min(1).max(500)).max(32).optional(),
}).strict();
export interface FormationBatchResult { revision?: z.infer<typeof revisionSchema>; ruleRevisions?: FormationRuleRevision[];
  sourceRuleConclusions?: SourceRuleConclusion[];
  /** Independent body/baseline verdict, before the host compares R metadata.
   * Cache replay must not reuse a previous host-derived mismatch or repair. */
  sourceChecks?: CaptureGroundingAssessment;
  index: number; checks: CaptureGroundingAssessment; uncertaintyDisposition: string; comparison?: FormationComparison }
export interface FormationBatchCheckpoint { ruleSemanticsPolicyVersion?: 3; sourceFingerprint?: string; fingerprint: string; assessments: FormationBatchResult[];
  itemFailures?: Array<{ index: number; reason: 'assessment_invalid' | 'dependency_unavailable' }> }

/** Connect only actual writes/references, not shared source messages. A joint
 * proposal is already one item; cross-item writes to the same identity or a
 * reference to another item's write cannot be committed independently. */
export function formationDependencyGroups(items: Array<{ index: number; candidate: GroundingCandidate }>): number[][] {
  const referenceKeys = new Set(['moduleId', 'typeId', 'subjectId', 'definitionId', 'entityId',
    'targetModuleId', 'targetRecordId', 'recordId', 'targetId', 'supersedesId', 'subjectTypes', 'objectTypes']);
  const references = (value: unknown, output = new Set<string>(), key = ''): Set<string> => {
    if (typeof value === 'string' && referenceKeys.has(key)) output.add(`ontology:${value}`);
    else if (Array.isArray(value)) value.forEach(child => references(child, output, key));
    else if (value && typeof value === 'object') {
      const object = value as Record<string, unknown>;
      if (object.kind === 'entity' && typeof object.id === 'string') output.add(`ontology:${object.id}`);
      if (object.kind === 'task' && object.field === 'entityId' && typeof object.equals === 'string') output.add(`ontology:${object.equals}`);
      Object.entries(object).forEach(([field, child]) => references(child, output, field));
    }
    return output;
  };
  const footprints = items.map(item => {
    const plan = item.candidate.ontologyChanges as { actions?: Array<{ recordId?: string; targetId?: string }>; refs?: unknown[] } | undefined;
    return { index: item.index, writes: new Set([
      ...(item.candidate.targetAssetId ? [`asset:${item.candidate.targetAssetId}`] : []),
      ...(plan?.actions || []).flatMap(action => [action.recordId, action.targetId].flatMap(id => id ? [`ontology:${id}`] : [])),
    ]), reads: references([plan?.actions, plan?.refs]) };
  });
  const remaining = new Set(footprints.map(row => row.index)), groups: number[][] = [];
  for (const seed of footprints) {
    if (!remaining.delete(seed.index)) continue;
    const group = [seed.index];
    for (let i = 0; i < group.length; i++) {
      const current = footprints.find(row => row.index === group[i])!;
      for (const other of footprints) if (remaining.has(other.index)
        && ([...current.writes].some(id => other.writes.has(id) || other.reads.has(id))
          || [...other.writes].some(id => current.reads.has(id)))) {
        remaining.delete(other.index); group.push(other.index);
      }
    }
    groups.push(group);
  }
  return groups;
}
export class FormationBatchUnavailableError extends Error {
  readonly code = 'formation_batch_unavailable';
  constructor(readonly reason: 'context_too_large' | 'source_unavailable' | 'model_not_configured' | 'model_unavailable' | 'assessment_invalid') {
    super(`formation assessment unavailable: ${reason}`);
  }
}
export async function assessFormationBatch(userId: string, input: {
  sessionId: string; items: FormationBatchItem[]; contextMessages: unknown[]; summary: unknown;
  existing: CaptureExistingAssetsResult; ontology: unknown; feedback: unknown;
  modelCandidates: readonly RecallCaptureModelCandidate[]; budget?: CaptureModelBudgetContext;
  signal?: AbortSignal; shouldContinue?: () => Promise<boolean>;
  checkpoint?: FormationBatchCheckpoint;
  conversationId?: string;
  contextSummary?: CaptureContextSummary;
}): Promise<FormationBatchCheckpoint> {
  if (!input.items.length) return { fingerprint: '', assessments: [] };
  const ontologyRecords = formationRuleContext(input.ontology);
  const failures = new Map<number, 'assessment_invalid' | 'dependency_unavailable'>();
  const candidates = input.items.flatMap(item => {
    try { return [{ index: item.index, sources: item.sources,
      candidate: blindFormationRuleCandidate(item.candidate, ontologyRecords),
      ruleSourceRequests: formationRuleSourceRequests(item.candidate.ontologyChanges, ontologyRecords, item.candidate.judgment) }]; }
    catch { failures.set(item.index, 'assessment_invalid'); return []; }
  });
  const groups = formationDependencyGroups(input.items);
  const holdFailedGroups = () => {
    for (const group of groups) if (group.some(index => failures.has(index)))
      for (const index of group) if (!failures.has(index)) failures.set(index, 'dependency_unavailable');
  };
  holdFailedGroups();
  const envelope = { ruleSemanticsPolicyVersion: 3, candidates, completeConversationContext: input.contextMessages,
    summary: input.contextSummary?.topics || input.summary, existingAssets: input.existing.assets, comparisonCoverage: input.existing.coverage,
    ontology: input.ontology, feedback: input.feedback };
  let message = JSON.stringify(envelope);
  if (message.length > 128_000 && input.contextSummary) {
    const messages = input.contextMessages as Array<{ id: string; label: string; text: string }>;
    try {
      const approved = input.items.flatMap(item => item.sources.flatMap(source => (source.approvedQuotes || []).map(quote => {
        const original = messages.find(message => message.label === source.label);
        if (!original) throw new Error('approved source message missing');
        return { messageId: original.id, quote };
      })));
      const context = captureSourcePassages(messages, input.contextSummary, approved);
      // Per-item source text duplicates the full user message. The parser still
      // checks returned evidence against the original, unmodified sources.
      message = JSON.stringify({ ...envelope, candidates: candidates.map(item => ({ ...item,
        sources: item.sources.map(source => ({ label: source.label, approvedQuotes: source.approvedQuotes })) })),
        completeConversationContext: context,
        contextCoverage: { representation: 'complete_summary_and_original_passages', sourceDigest: input.contextSummary.sourceDigest,
          ...input.contextSummary.coverage } });
    } catch { throw new FormationBatchUnavailableError('source_unavailable'); }
  }
  if (message.length > 128_000) throw new FormationBatchUnavailableError('context_too_large');
  const sourceFingerprint = createHash('sha256').update(message).digest('hex');
  // A reusable source observation is not a grant for a different full draft.
  const fingerprint = createHash('sha256').update(JSON.stringify({ sourceFingerprint,
    proposals: input.items.map(item => ({ index: item.index, candidate: item.candidate })) })).digest('hex');
  const parseRow = (value: unknown): FormationBatchResult => {
    const row = value as FormationBatchResult;
    const item = input.items.find(item => item.index === row?.index);
    if (!item || !row || Object.keys(row).some(key => !['index', 'checks', 'uncertaintyDisposition', 'comparison', 'revision', 'sourceRuleConclusions'].includes(key))
      || !['effect_unverified', 'outside_claim_scope', 'source_attribution_only', 'content_unresolved', 'none'].includes(row.uncertaintyDisposition)) throw new Error('invalid formation assessment');
    const checks = parseCaptureGroundingAssessment(JSON.stringify(row.checks), item.sources);
    const sourceChecks = structuredClone(checks);
    const comparison = row.comparison ? validateFormationComparison(row.comparison, input.existing.assets, input.existing.coverage) : undefined;
    if (item.candidate.targetAssetId && comparison?.targetAssetId !== item.candidate.targetAssetId) throw new Error('formation target identity unresolved');
    if (item.candidate.targetAssetId && !comparison) throw new Error('missing target comparison');
    const revision = row.revision ? revisionSchema.parse(row.revision) : undefined;
    if (revision && (!item.candidate.targetAssetId || !comparison || !['evidence', 'exception', 'correction', 'changed'].includes(comparison.relation))) throw new Error('revision has no resolved existing target');
    const contracts = formationRuleContracts(item.candidate.ontologyChanges, ontologyRecords);
    const sourceRuleConclusions = parseSourceRuleConclusions(row.sourceRuleConclusions, contracts, item.sources);
    const rules = deriveFormationRuleRevisions(item.candidate.ontologyChanges, sourceRuleConclusions, ontologyRecords, true);
    if (!rules.supported) { checks.supported = false; checks.finalDecisionPreserved = false; }
    return { index: row.index, checks, uncertaintyDisposition: row.uncertaintyDisposition, ...(comparison ? { comparison } : {}),
      sourceChecks, ...(revision ? { revision } : {}), ...(rules.ruleRevisions.length ? { ruleRevisions: rules.ruleRevisions } : {}),
      ...(contracts.length ? { sourceRuleConclusions } : {}) };
  };
  const assessments = new Map<number, FormationBatchResult>();
  if (input.checkpoint?.ruleSemanticsPolicyVersion === 3 && input.checkpoint.sourceFingerprint === sourceFingerprint) {
    for (const row of input.checkpoint.assessments) try {
      if (failures.has(row.index)) continue;
      // Replay source observations, not an old host-derived approval/repair.
      const comparison = row.comparison ? Object.fromEntries(Object.entries(row.comparison).filter(([key]) => key !== 'coverage')) : undefined;
      const parsed = parseRow({ index: row.index, checks: row.sourceChecks || row.checks,
        uncertaintyDisposition: row.uncertaintyDisposition,
        ...(comparison ? { comparison } : {}),
        ...(row.revision ? { revision: row.revision } : {}),
        ...(row.sourceRuleConclusions ? { sourceRuleConclusions: row.sourceRuleConclusions } : {}) });
      assessments.set(parsed.index, parsed);
    } catch { /* Invalid cached rows require a fresh verdict, never a default. */ }
  }
  const pending = input.items.filter(item => !assessments.has(item.index) && !failures.has(item.index));
  if (pending.length) {
    const payload = JSON.parse(message);
    payload.candidates = payload.candidates.filter((item: { index: number }) => pending.some(row => row.index === item.index));
    let result: Awaited<ReturnType<typeof runRecallCaptureModel>>['result'];
    try { ({ result } = await runRecallCaptureModel(userId, { sessionId: input.sessionId,
      systemPrompt: `${prompts.load('cognition_formation_batch')}\n${ONTOLOGY_RULE_SEMANTICS}\n${SOURCE_RULE_CONCLUSION_PROTOCOL}`,
      message: JSON.stringify(payload), modelCandidates: input.modelCandidates,
      signal: input.signal, shouldContinue: input.shouldContinue, budget: input.budget,
      ...(input.conversationId ? { cliContext: { conversationId: input.conversationId } } : {}) })); }
    catch (error) {
      if ((error as { code?: string }).code === 'ABORT_ERR') throw error;
      throw new FormationBatchUnavailableError((error as { code?: string }).code === 'capture_model_not_configured' ? 'model_not_configured' : 'model_unavailable');
    }
    if (result.meta.aborted || input.signal?.aborted) throw Object.assign(new Error('formation assessment interrupted'), { code: 'ABORT_ERR' });
    if (result.meta.error) throw new FormationBatchUnavailableError('model_unavailable');
    let rows: unknown[];
    try {
      const raw = parseCaptureAssessmentJson(result.text) as { assessments?: unknown[] };
      if (!raw || Object.keys(raw).some(key => key !== 'assessments') || !Array.isArray(raw.assessments)
        || raw.assessments.length !== pending.length) throw new Error('incomplete formation assessment');
      const seen = new Set<number>();
      for (const value of raw.assessments) {
        const index = (value as { index?: number } | null)?.index;
        if (typeof index !== 'number' || !pending.some(item => item.index === index) || seen.has(index)) throw new Error('unresolved assessment identity');
        seen.add(index);
      }
      rows = raw.assessments;
    } catch { throw new FormationBatchUnavailableError('assessment_invalid'); }
    for (const value of rows) {
      const index = (value as { index: number }).index;
      try { assessments.set(index, parseRow(value)); }
      catch { failures.set(index, 'assessment_invalid'); }
    }
  }
  holdFailedGroups();
  for (const index of failures.keys()) assessments.delete(index);
  if (!assessments.size && failures.size) throw new FormationBatchUnavailableError('assessment_invalid');
  return { ruleSemanticsPolicyVersion: 3, sourceFingerprint, fingerprint,
    assessments: input.items.flatMap(item => assessments.has(item.index) ? [assessments.get(item.index)!] : []),
    ...(failures.size ? { itemFailures: [...failures].map(([index, reason]) => ({ index, reason })) } : {}) };
}
