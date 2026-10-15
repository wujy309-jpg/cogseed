/** Independent source-support observation for automatic confirmation. A lexical
 * match, a producer's boolean, or source existence cannot authorize new meaning.
 * Receipts contain fingerprints and evidence coordinates, never private text. */
import { createHash } from 'node:crypto';
import { readJsonl } from '../../storage';
import { prompts } from '../../prompts/loader';
import { fileEditLock } from '../../util/locks';
import { conversationMessageReadFile } from '../../util/project-layout';
import type { GroupMessage } from '../group_chat/visibility';
import { readOntologyDocument } from '../cognition/ontology/service';
import { readRecallCaptureSettings } from './capture-settings';
import { captureContextSourceDigest, type CaptureContextSummary } from './capture-context-summary';
import { captureSummaryDecisionDigest, verifyCaptureProvenanceForPromotion } from './capture-provenance';
import { parseCaptureGroundingAssessment, type GroundingSource } from './capture-grounding';
import { runRecallCaptureModel } from './capture-model-routing';
import { parseCaptureUncertaintyAssessment, type CaptureUncertaintyDisposition } from './capture-uncertainty';
import { isRecallAssistantMessage, isRecallConversationMessage } from './conversation-message-policy';
import { cognitionMessageSourceId, cognitionExistingSourceIds } from './source-catalog';
import { recallJsonRecordPath } from './paths';
import { readRecallJsonRecord, writeRecallJsonRecord } from './store';
import type { RecallCandidateRecord } from './candidate-service';
import type { RecallJsonRecord } from './types';

export type NightlySemanticSupportOutcome = 'supported' | 'unsupported' | 'unavailable' | 'stale';
const COLLECTION = 'automatic-source-support';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([, child]) => child !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonical(child)]));
  return value;
}
const digest = (value: unknown) => hash(JSON.stringify(canonical(value)));
// Operational transitions do not alter the meaning being checked. Every other
// field, including the entire plan and source/access policy, participates.
const operationalFields = new Set(['status', 'updatedAt', 'statementIssues', 'autoReview', 'promotedAssetId',
  'reviewDecisionId', 'failureCode', 'failureMessage', 'failedAt', 'validationCount', 'lastValidatedAt',
  'consecutiveFailures', 'appliedValidationIds', 'decisionNote', 'mergedInto', 'mergedIntoAssetId']);
function candidateContent(candidate: RecallCandidateRecord): Record<string, unknown> {
  return Object.fromEntries(Object.entries({ ...candidate, origin: candidate.origin || (candidate.captureProvenance ? 'capture' : undefined) })
    .filter(([key]) => !operationalFields.has(key)));
}
/** Stable semantic binding for a committed observation; excludes only the same
 * operational transitions already excluded by the pending support check. */
export function nightlySemanticCandidateDigest(candidate: RecallCandidateRecord): string { return digest(candidateContent(candidate)); }
interface SummaryUnresolved { topicIndex: number; items: string[] }
/** Select only the source-backed topics relevant to this candidate. Preserve
 * every unresolved item verbatim; the host never classifies by wording. */
export function relevantAutomaticSummaryUnresolved(candidate: RecallCandidateRecord, summary: CaptureContextSummary, conversationId: string): SummaryUnresolved[] | undefined {
  if (!summary || !Array.isArray(summary.topics)) return undefined;
  const ids = new Set(candidate.evidenceRefs.filter(ref => ref.kind === 'conversation' && ref.subtype === 'message').map(ref => ref.id));
  const relevant = summary.topics.map((topic, topicIndex) => ({ topic, topicIndex })).filter(({ topic }) =>
    Array.isArray(topic?.evidence) && topic.evidence.some(ref => ids.has(cognitionMessageSourceId(conversationId, ref.messageId))));
  if (!relevant.length || relevant.some(({ topic }) => !Array.isArray(topic.unresolved)
    || topic.unresolved.some(item => typeof item !== 'string' || !item.trim()))) return undefined;
  return relevant.filter(({ topic }) => topic.unresolved.length > 0).map(({ topic, topicIndex }) => ({ topicIndex, items: [...topic.unresolved] }));
}
interface Snapshot {
  fingerprint: string; candidate: RecallCandidateRecord; sources: GroundingSource[];
  sourceDigest: string; summaryDigest: string; message: string; ontologyRevision?: number; targetVersion?: string; unresolvedDigest?: string;
}
interface SupportReceipt extends RecallJsonRecord {
  schemaVersion: 1; method: 'model_assisted'; policyVersion: 1; fingerprint: string;
  candidateId: string; captureId: string; policyEpoch: string; sourceDigest: string; summaryDigest: string;
  ontologyRevision?: number; targetVersion?: string; modelCompleted: true;
  checks: { supported: true; noUnsupportedClaims: true; scopePreserved: true; finalDecisionPreserved: true; priorContentPreserved: true };
  evidence: Array<{ messageId: string; start: number; end: number; quoteHash: string }>;
  summaryUncertainty?: { disposition: Exclude<CaptureUncertaintyDisposition, 'content_unresolved'>; unresolvedDigest: string };
  createdAt: string;
}
/** Lock-held commit callers can bind the exact already-validated observation.
 * This accessor never invokes a model and cannot validate a post-commit baseline. */
export async function readVerifiedPendingNightlySupport(userId: string, candidate: RecallCandidateRecord, epoch: string): Promise<SupportReceipt | undefined> {
  try {
    const current = await snapshot(userId, candidate, epoch);
    const receipt = await readRecallJsonRecord(userId, COLLECTION, `ass-${current.fingerprint.slice(0, 32)}`);
    return validReceipt(receipt, current, epoch) ? receipt : undefined;
  } catch { return undefined; }
}
function stale(): never { throw Object.assign(new Error('automatic semantic support baseline changed'), { code: 'automatic_support_stale' }); }
async function snapshot(userId: string, expected: RecallCandidateRecord, epoch: string): Promise<Snapshot> {
  const { readRecallCandidate } = await import('./candidate-service');
  const candidate = await readRecallCandidate(userId, expected.id);
  if (digest(candidateContent(candidate)) !== digest(candidateContent(expected))
    || candidate.status !== 'pending_review' || candidate.userModifiedAt || candidate.ontologyHandoff
    || Date.parse(candidate.expiresAt) <= Date.now()) stale();
  const settings = await readRecallCaptureSettings(userId);
  if (!settings.enabled || !settings.autoApproval || settings.autoApprovalEpoch !== epoch) stale();
  const proof = await verifyCaptureProvenanceForPromotion(userId, candidate);
  const groups = new Map<import('./source-service').CognitionSourceType, string[]>();
  for (const ref of [...candidate.sourceRefs, ...candidate.evidenceRefs]) {
    if (ref.taxonomyVersion !== 2) stale();
    const kind = ref.kind as import('./source-service').CognitionSourceType;
    groups.set(kind, [...(groups.get(kind) || []), ref.id]);
  }
  for (const [kind, ids] of groups) {
    const available = await cognitionExistingSourceIds(userId, kind, ids);
    if (ids.some(id => !available.has(id))) stale();
  }
  const capture = (await readRecallJsonRecord(userId, 'captures', proof.captureId))!;
  if (capture.autoApprovalEpoch !== epoch || capture.autoApprovalEnabledAt !== settings.autoApprovalEnabledAt) stale();
  const summary = capture.contextSummary as CaptureContextSummary;
  const relevantUnresolved = relevantAutomaticSummaryUnresolved(candidate, summary, String(capture.conversationId));
  if (!relevantUnresolved) stale();
  const unresolvedDigest = relevantUnresolved.length ? digest(relevantUnresolved) : undefined;
  const wanted = new Set([...proof.messageIds, ...((capture.contextMessageIds as string[] | undefined) || [])]);
  const raw = (await readJsonl<GroupMessage>(conversationMessageReadFile(userId, String(capture.conversationId)), Number.MAX_SAFE_INTEGER))
    .filter(row => wanted.has(row.id) && isRecallConversationMessage(row));
  const context = raw.map((row, index) => ({ label: `m${index + 1}`, messageId: row.id,
    role: isRecallAssistantMessage(row) ? 'assistant' : 'user', text: row.text, timestamp: row.ts,
    discovery: proof.messageIds.includes(row.id) }));
  if (raw.length !== wanted.size || captureContextSourceDigest(context.map(row => ({ ...row, id: row.messageId }))) !== summary.sourceDigest) stale();
  const selected = new Set(candidate.evidenceRefs.filter(ref => ref.kind === 'conversation' && ref.subtype === 'message').map(ref => ref.id));
  const sources = context.filter(row => row.role === 'user').map(row => ({ label: row.label, text: row.text,
    approvedQuotes: proof.valueJudgment.evidence.filter(ref => ref.messageId === row.messageId
      && selected.has(cognitionMessageSourceId(String(capture.conversationId), row.messageId))).map(ref => ref.quote) }))
    .filter(row => row.approvedQuotes.length > 0);
  if (!sources.length) stale();
  let target: unknown;
  let targetVersion: string | undefined;
  if (candidate.suggestedAction === 'update') {
    const { readAbilityAsset } = await import('./asset-service');
    const asset = candidate.targetAssetId ? await readAbilityAsset(userId, candidate.targetAssetId) : undefined;
    if (!asset || asset.version !== candidate.targetVersionUsed || (asset.activeVersion || asset.version) !== candidate.targetVersionUsed
      || asset.status !== 'active') stale();
    target = asset; targetVersion = asset.version;
  }
  // Only the exact canonical dependency closure is needed. Include referenced
  // before/after identities and pinned history, without leaking unrelated records.
  let ontology: unknown;
  let ontologyRevision: number | undefined;
  if (candidate.ontologyFormation) {
    const doc = readOntologyDocument(userId);
    if (doc.revision !== candidate.ontologyFormation.baselineRevision) stale();
    const ids = new Set<string>();
    const collect = (value: unknown): void => {
      if (typeof value === 'string' && doc.records[value] && !ids.has(value)) {
        ids.add(value); collect(doc.records[value]);
      } else if (Array.isArray(value)) value.forEach(collect);
      else if (value && typeof value === 'object') Object.values(value).forEach(collect);
    };
    collect(candidate.ontologyFormation);
    ontology = { revision: doc.revision, records: [...ids].sort().map(id => doc.records[id]),
      history: doc.history.filter(row => ids.has(row.after.id)) };
    ontologyRevision = doc.revision;
  }
  const payload = { policyVersion: 1, candidate: candidateContent(candidate), approvedUserSources: sources,
    completeConversationContext: context, summary, existingTarget: target, ontology,
    ...(unresolvedDigest ? { relevantSummaryUnresolved: relevantUnresolved } : {}) };
  const message = JSON.stringify(payload);
  if (message.length > 96_000) throw new Error('automatic support complete context too large');
  return { candidate, sources, message, sourceDigest: summary.sourceDigest, summaryDigest: captureSummaryDecisionDigest(summary),
    fingerprint: digest({ policyVersion: 1, epoch, payload }), ontologyRevision, targetVersion, unresolvedDigest };
}
function validReceipt(receipt: RecallJsonRecord | undefined, current: Snapshot, epoch: string): receipt is SupportReceipt {
  if (!receipt || receipt.schemaVersion !== 1 || receipt.method !== 'model_assisted' || receipt.policyVersion !== 1 || receipt.modelCompleted !== true
    || receipt.fingerprint !== current.fingerprint || receipt.candidateId !== current.candidate.id
    || receipt.captureId !== current.candidate.captureProvenance!.captureId || receipt.policyEpoch !== epoch
    || receipt.sourceDigest !== current.sourceDigest || receipt.summaryDigest !== current.summaryDigest
    || receipt.ontologyRevision !== current.ontologyRevision || receipt.targetVersion !== current.targetVersion
    || typeof receipt.createdAt !== 'string' || !Number.isFinite(Date.parse(receipt.createdAt))
    || !receipt.checks || !Array.isArray(receipt.evidence) || !receipt.evidence.length || receipt.evidence.length > 32) return false;
  const classification = receipt.summaryUncertainty as Record<string, unknown> | undefined;
  if (current.unresolvedDigest && (!classification
    || classification.unresolvedDigest !== current.unresolvedDigest
    || typeof classification.disposition !== 'string'
    || !['effect_unverified', 'outside_claim_scope', 'source_attribution_only'].includes(classification.disposition))) return false;
  const checks = receipt.checks as Record<string, unknown>;
  if (!['supported', 'noUnsupportedClaims', 'scopePreserved', 'finalDecisionPreserved', 'priorContentPreserved'].every(key => checks[key] === true)) return false;
  const context = JSON.parse(current.message).completeConversationContext as Array<{ messageId: string; text: string; label: string }>;
  const referencesValid = receipt.evidence.every(ref => {
    const row = context.find(row => row.messageId === ref?.messageId);
    const source = current.sources.find(source => source.label === row?.label);
    return row && source && Number.isInteger(ref.start) && Number.isInteger(ref.end) && ref.start >= 0 && ref.end > ref.start
      && ref.end <= row.text.length && hash(row.text.slice(ref.start, ref.end)) === ref.quoteHash;
  });
  return referencesValid && receipt.evidence.some(ref => {
    const row = context.find(row => row.messageId === ref.messageId)!;
    const source = current.sources.find(source => source.label === row.label)!;
    return source.approvedQuotes?.some(quote => quote.includes(row.text.slice(ref.start, ref.end)) || row.text.slice(ref.start, ref.end).includes(quote));
  });
}

/** Model execution is only allowed at the lock-free preflight. Locked promotion
 * boundaries require a matching persisted observation, never a caller boolean. */
export async function ensureNightlySemanticSupport(userId: string, candidate: RecallCandidateRecord,
  epoch: string, options: { cachedOnly?: boolean } = {}): Promise<NightlySemanticSupportOutcome> {
  try {
    const current = await snapshot(userId, candidate, epoch);
    const id = `ass-${current.fingerprint.slice(0, 32)}`;
    if (validReceipt(await readRecallJsonRecord(userId, COLLECTION, id), current, epoch)) return 'supported';
    if (options.cachedOnly) return 'unavailable';
    // Serialize duplicate model checks separately from candidate/settings locks.
    return await fileEditLock(`${recallJsonRecordPath(userId, COLLECTION, id)}.assessment`).runExclusive(async () => {
      if (validReceipt(await readRecallJsonRecord(userId, COLLECTION, id), current, epoch)) return 'supported';
      const settings = await readRecallCaptureSettings(userId);
      const summaryInstruction = current.unresolvedDigest
        ? '\nAlso independently classify ALL relevantSummaryUnresolved items against this same complete payload, including the entire resulting cognition and A/R plan. Return the usual five boolean checks and literal user evidence, plus uncertaintyDisposition: effect_unverified | outside_claim_scope | source_attribution_only | content_unresolved. The first three mean only unknown effectiveness, facts explicitly outside this claim, or user attribution without independent external validation. Any mixed unresolved identity, source attribution, scope, conflict, final decision or meaning requires content_unresolved; do not erase unknown content or infer permission. The original summary and candidate remain unchanged. A prior extraction classification or autoReview cannot supply this observation; effectiveness and objective external facts are never confirmed here.'
        : '';
      const { result } = await runRecallCaptureModel(userId, { sessionId: `one-shot-automatic-support-${id}`,
        budget: { jobId: current.candidate.captureProvenance!.captureId, stage: 'automatic_support' },
        systemPrompt: `${prompts.load(current.unresolvedDigest ? 'cognition_capture_uncertainty' : 'cognition_capture_grounding')}\nFor automatic retention inspect the ENTIRE persisted candidate and joint ontologyFormation actions, refs and previewChanges, including before/after versions. completeConversationContext is full quoted source data: preserve its final corrections, negations, dates, exceptions, people/projects and permissions. Only approvedUserSources.approvedQuotes authorize the candidate topic; surrounding context limits it and cannot authorize unrelated additions. A/R identities, assertions, validity, rule strength, conditions, exceptions and scope require support too. Existing canonical records explain identity and valid prior meaning, never license new claims. Check the jointly resulting cognition plus A/R proposal; a correct cognition with an unsupported dependency must fail. No lexical-overlap threshold is proof. Other independent unresolved topics do not veto this supported topic. Return only the specified grounding assessment; saving permission and effectiveness are never assessed here.${summaryInstruction}`,
        message: current.message, modelCandidates: settings.modelCandidates,
        shouldContinue: async () => { const now = await readRecallCaptureSettings(userId); return now.enabled && now.autoApproval && now.autoApprovalEpoch === epoch; } });
      if (result.meta.aborted || result.meta.error) return 'unavailable';
      const classification = current.unresolvedDigest ? parseCaptureUncertaintyAssessment(result.text, current.sources) : undefined;
      const assessment = classification ?? parseCaptureGroundingAssessment(result.text, current.sources);
      const disposition = classification?.uncertaintyDisposition;
      if (current.unresolvedDigest && disposition === 'content_unresolved') return 'unsupported';
      if (!assessment.supported || !assessment.noUnsupportedClaims || !assessment.scopePreserved
        || !assessment.finalDecisionPreserved || !assessment.priorContentPreserved) return 'unsupported';
      const context = JSON.parse(current.message).completeConversationContext as Array<{ messageId: string; text: string; label: string }>;
      const evidence = assessment.evidence.map(ref => {
        const row = context.find(row => row.label === ref.label)!;
        const start = row.text.indexOf(ref.quote);
        if (start < 0 || row.text.indexOf(ref.quote, start + 1) >= 0) throw new Error('ambiguous automatic support evidence');
        return { messageId: row.messageId, start, end: start + ref.quote.length, quoteHash: hash(ref.quote) };
      });
      // Source/permission/epoch/target/body/plan changes during model waiting
      // invalidate the observation before it can authorize any asset write.
      const refreshed = await snapshot(userId, candidate, epoch);
      if (refreshed.fingerprint !== current.fingerprint) return 'stale';
      const receipt: SupportReceipt = { schemaVersion: 1, ownerId: userId, id, method: 'model_assisted', policyVersion: 1,
        candidateId: candidate.id, captureId: candidate.captureProvenance!.captureId, policyEpoch: epoch,
        fingerprint: current.fingerprint, sourceDigest: current.sourceDigest, summaryDigest: current.summaryDigest,
        ...(current.ontologyRevision !== undefined ? { ontologyRevision: current.ontologyRevision } : {}),
        ...(current.targetVersion !== undefined ? { targetVersion: current.targetVersion } : {}), modelCompleted: true,
        checks: { supported: true, noUnsupportedClaims: true, scopePreserved: true, finalDecisionPreserved: true, priorContentPreserved: true },
        ...(current.unresolvedDigest && disposition && disposition !== 'content_unresolved'
          ? { summaryUncertainty: { disposition, unresolvedDigest: current.unresolvedDigest } } : {}),
        evidence, createdAt: new Date().toISOString() };
      await writeRecallJsonRecord(userId, COLLECTION, id, receipt);
      return 'supported';
    });
  } catch (error) { return (error as { code?: string }).code === 'automatic_support_stale' ? 'stale' : 'unavailable'; }
}
