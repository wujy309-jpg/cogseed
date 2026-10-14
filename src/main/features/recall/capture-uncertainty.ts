/** Separates unknown effectiveness or excluded facts from unknown content.
 * An independent model observes the original complete proposal; it cannot
 * rewrite it, authorize storage, confirm objective facts or prove effectiveness. */
import { createHash } from 'node:crypto';
import { prompts } from '../../prompts/loader';
import { runRecallCaptureModel } from './capture-model-routing';
import { parseCaptureAssessmentJson, parseCaptureGroundingAssessment, type CaptureGroundingAssessment, type GroundingCandidate, type GroundingSource } from './capture-grounding';
import type { RecallCaptureModelCandidate } from './capture-settings';

export type CaptureUncertaintyDisposition = 'effect_unverified' | 'outside_claim_scope' | 'source_attribution_only' | 'content_unresolved';
export interface CaptureUncertaintyContextMessage { label: string; id?: string; role: 'user' | 'assistant'; text: string; timestamp?: string }
export interface CaptureUncertaintyInput {
  sessionId: string; candidate: GroundingCandidate; sources: GroundingSource[];
  contextMessages: CaptureUncertaintyContextMessage[]; summary: unknown;
  existingTarget?: { id: string; statement: string; scope: string; version: string };
  modelCandidates: readonly RecallCaptureModelCandidate[]; signal?: AbortSignal; shouldContinue?: () => Promise<boolean>;
}
export interface CaptureUncertaintyAssessment {
  method: 'model_assisted'; modelCompleted: boolean; nonBlocking: boolean;
  /** Host interruption metadata, never supplied by the checking model. */
  interrupted?: true;
  uncertaintyDisposition: CaptureUncertaintyDisposition;
  checks: Omit<CaptureGroundingAssessment, 'evidence'>;
  candidateHash?: string; sourceHash?: string; summaryHash?: string; targetHash?: string; inputHash?: string;
  evidence: Array<{ label: string; messageId?: string; start: number; end: number; quoteHash: string }>;
  reason?: 'uncertainty_missing' | 'uncertainty_context_unavailable' | 'uncertainty_context_too_large'
    | 'uncertainty_target_unavailable' | 'uncertainty_model_unavailable' | 'uncertainty_assessment_invalid'
    | 'uncertainty_content_unresolved' | 'uncertainty_semantic_support_failed';
}
const DISPOSITIONS = new Set<CaptureUncertaintyDisposition>(['effect_unverified', 'outside_claim_scope', 'source_attribution_only', 'content_unresolved']);
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}
const digest = (value: unknown) => hash(JSON.stringify(canonical(value)));

/** Strict classifications never substitute for independently checked meaning.
 * Literal evidence must resolve in a USER source and overlap an approved topic. */
export function parseCaptureUncertaintyAssessment(raw: string, sources: GroundingSource[]): CaptureGroundingAssessment & { uncertaintyDisposition: CaptureUncertaintyDisposition } {
  if (typeof raw !== 'string' || raw.length > 12_000) throw new Error('invalid uncertainty assessment size');
  const parsed: unknown = parseCaptureAssessmentJson(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid uncertainty assessment');
  const { uncertaintyDisposition, ...checks } = parsed as Record<string, unknown>;
  if (!DISPOSITIONS.has(uncertaintyDisposition as CaptureUncertaintyDisposition)) throw new Error('invalid uncertainty disposition');
  const assessment = parseCaptureGroundingAssessment(JSON.stringify(checks), sources);
  if (assessment.supported && !assessment.evidence.some(ref => sources.some(source => source.label === ref.label
    && source.approvedQuotes?.some(quote => quote.includes(ref.quote) || ref.quote.includes(quote))))) {
    throw new Error('uncertainty assessment requires approved topic evidence');
  }
  return { ...assessment, uncertaintyDisposition: uncertaintyDisposition as CaptureUncertaintyDisposition };
}

/** Caller may clear only the blocking field after nonBlocking=true, retaining
 * the original judgment/boundaries and this source-bound classification audit. */
export async function assessRecallCaptureUncertainty(userId: string, input: CaptureUncertaintyInput): Promise<CaptureUncertaintyAssessment> {
  const blocked: CaptureUncertaintyAssessment = { method: 'model_assisted', modelCompleted: false, nonBlocking: false,
    uncertaintyDisposition: 'content_unresolved', checks: { supported: false, noUnsupportedClaims: false,
      scopePreserved: false, finalDecisionPreserved: false, priorContentPreserved: false }, evidence: [] };
  try {
    if (!input.candidate.uncertainty?.trim()) return { ...blocked, reason: 'uncertainty_missing' };
    const original = { candidate: input.candidate, approvedUserSources: input.sources,
      completeConversationContext: input.contextMessages, summary: input.summary, existingTarget: input.existingTarget };
    const message = JSON.stringify(original);
    // Freeze the exact source/candidate snapshot sent to the independent model.
    const payload = JSON.parse(message) as typeof original;
    const hashes = { candidateHash: digest(payload.candidate), sourceHash: digest({ sources: payload.approvedUserSources,
      context: payload.completeConversationContext }), summaryHash: digest(payload.summary),
      ...(payload.existingTarget ? { targetHash: digest(payload.existingTarget) } : {}), inputHash: digest({ policyVersion: 1, payload }) };
    const held = { ...blocked, ...hashes };
    if (message.length > 96_000) return { ...held, reason: 'uncertainty_context_too_large' };
    const context = payload.completeConversationContext;
    const sources = payload.approvedUserSources;
    // Context includes assistant proposals and late corrections, but only
    // explicit approved user passages can establish newly retained content.
    if (!Array.isArray(context) || !context.length || !Array.isArray(sources) || !sources.length
      || new Set(context.map(row => row.label)).size !== context.length
      || context.some(row => !row || typeof row.label !== 'string' || !row.label.trim()
        || !['user', 'assistant'].includes(row.role) || typeof row.text !== 'string')
      || new Set(sources.map(source => source.label)).size !== sources.length
      || sources.some(source => !source || typeof source.label !== 'string' || typeof source.text !== 'string'
        || !source.approvedQuotes?.length || source.approvedQuotes.some(quote => typeof quote !== 'string' || !quote.trim() || !source.text.includes(quote))
        || !context.some(row => row.label === source.label && row.role === 'user' && row.text === source.text))) {
      return { ...held, reason: 'uncertainty_context_unavailable' };
    }
    if (payload.candidate.targetAssetId && payload.existingTarget?.id !== payload.candidate.targetAssetId
      || (payload.candidate.suggestedAction === 'update' && !payload.existingTarget)) {
      return { ...held, reason: 'uncertainty_target_unavailable' };
    }
    if (input.signal?.aborted || (input.shouldContinue && !await input.shouldContinue())) return { ...held, interrupted: true, reason: 'uncertainty_model_unavailable' };
    let text: string;
    try {
      const { result } = await runRecallCaptureModel(userId, { sessionId: input.sessionId,
        systemPrompt: prompts.load('cognition_capture_uncertainty'), message, modelCandidates: input.modelCandidates,
        signal: input.signal, shouldContinue: input.shouldContinue });
      if (result.meta.aborted || input.signal?.aborted || (input.shouldContinue && !await input.shouldContinue())) {
        return { ...held, interrupted: true, reason: 'uncertainty_model_unavailable' };
      }
      if (result.meta.error) return { ...held, reason: 'uncertainty_model_unavailable' };
      text = result.text;
    } catch (error) {
      return { ...held, ...(input.signal?.aborted || (error as { code?: string })?.code === 'ABORT_ERR' ? { interrupted: true as const } : {}),
        reason: 'uncertainty_model_unavailable' };
    }
    let parsed: ReturnType<typeof parseCaptureUncertaintyAssessment>;
    try { parsed = parseCaptureUncertaintyAssessment(text, sources); }
    catch { return { ...held, reason: 'uncertainty_assessment_invalid' }; }
    const { evidence: literalEvidence, uncertaintyDisposition, ...checks } = parsed;
    const evidence: CaptureUncertaintyAssessment['evidence'] = [];
    for (const ref of literalEvidence) {
      const row = context.find(row => row.label === ref.label && row.role === 'user')!;
      const start = row.text.indexOf(ref.quote);
      if (start < 0 || row.text.indexOf(ref.quote, start + 1) >= 0) return { ...held, reason: 'uncertainty_assessment_invalid' };
      evidence.push({ label: ref.label, ...(row.id ? { messageId: row.id } : {}), start, end: start + ref.quote.length, quoteHash: hash(ref.quote) });
    }
    const allSupported = Object.values(checks).every(value => value === true);
    const nonBlocking = uncertaintyDisposition !== 'content_unresolved' && allSupported && evidence.length > 0;
    return { ...held, modelCompleted: true, nonBlocking, uncertaintyDisposition, checks, evidence,
      ...(!nonBlocking ? { reason: uncertaintyDisposition === 'content_unresolved'
        ? 'uncertainty_content_unresolved' as const : 'uncertainty_semantic_support_failed' as const } : {}) };
  } catch (error) {
    if (input.signal?.aborted || (error as { code?: string })?.code === 'ABORT_ERR') {
      return { ...blocked, interrupted: true, reason: 'uncertainty_model_unavailable' };
    }
    return { ...blocked, reason: 'uncertainty_context_unavailable' };
  }
}
