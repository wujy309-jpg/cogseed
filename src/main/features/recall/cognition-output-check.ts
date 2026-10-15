/** Check the persisted result against the exact guidance supplied this turn.
 * Model-assisted compliance is an observation, never an effectiveness proof.
 * Receipts retain hashes/coordinates/references, not copied private text. */
import { createHash } from 'node:crypto';
import { readPersistedResultContent, type PersistedResultContent } from './persisted-result-content';
import { readJsonl, safeId } from '../../storage';
import { conversationMessageReadFile } from '../../util/project-layout';
import { createLogger } from '../../logger';
import { prompts } from '../../prompts/loader';
import { readAbilityAsset, readAbilityAssetVersionSnapshot } from './asset-service';
import { listInjectionReceipts, type InjectionReceipt } from './injection-receipt';
import { AGENT_READ_PROJECTION_ID, recordAssetUsageReceipt } from './asset-usage-receipt';
import { readRecallCaptureSettings } from './capture-settings';
import { runRecallCaptureModel } from './capture-model-routing';
import { readRecallJsonRecord, updateRecallJsonRecord } from './store';
import type { RecallJsonRecord } from './types';

const log = createLogger('recall.cognition-output-check');
export type CognitionOutputCheckStatus = 'complied' | 'not_complied' | 'not_applicable' | 'unknown';
export interface OutputCheckAsset { assetId: string; version: string; content: string; applicableWhen: string[]; forbiddenWhen: string[] }
interface CheckEvidence { start: number; end: number }
export interface CognitionOutputCheck {
  assetId: string; version: string; status: CognitionOutputCheckStatus;
  outputEvidence?: CheckEvidence; taskEvidence?: CheckEvidence;
}
export interface CognitionOutputCheckReceipt extends RecallJsonRecord {
  id: string; taskRunId: string; messageId: string; outputHash: string; taskHash: string;
  resultRefs?: PersistedResultContent['refs']; resultCoverage?: PersistedResultContent['coverage'];
  method: 'model_assisted'; checks: CognitionOutputCheck[];
  modelCompleted: boolean; createdAt: string;
}
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const plain = (raw: unknown): raw is Record<string, unknown> => !!raw && typeof raw === 'object' && !Array.isArray(raw);
function evidence(raw: unknown, text: string): CheckEvidence | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!plain(raw) || Object.keys(raw).some(k => !['quote', 'start', 'end'].includes(k))) throw new Error('invalid output check evidence');
  const { quote, start, end } = raw;
  if (typeof quote !== 'string' || !quote.trim() || quote.length > 1000) throw new Error('invalid output check quote');
  if (start === undefined && end === undefined) {
    const located = text.indexOf(quote);
    if (located < 0 || text.indexOf(quote, located + 1) >= 0) throw new Error('output check quote is missing or ambiguous');
    return { start: located, end: located + quote.length };
  }
  if (!Number.isInteger(start) || !Number.isInteger(end) || Number(start) < 0
    || Number(end) !== Number(start) + quote.length || text.slice(Number(start), Number(end)) !== quote) {
    throw new Error('output check evidence does not resolve');
  }
  return { start: Number(start), end: Number(end) };
}

/** A complete matrix is required: omissions, invented assets/versions and
 * fabricated evidence never masquerade as successful compliance. */
export function parseCognitionOutputChecks(raw: string, assets: OutputCheckAsset[], task: string, output: string): CognitionOutputCheck[] {
  if (typeof raw !== 'string' || raw.length > 24_000) throw new Error('invalid output check response');
  const parsed: unknown = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
  if (!plain(parsed) || Object.keys(parsed).some(k => k !== 'checks') || !Array.isArray(parsed.checks)
    || parsed.checks.length < assets.length || parsed.checks.length > assets.length * 8) throw new Error('incomplete output check matrix');
  const checks = new Map<string, CognitionOutputCheck>();
  const evidenceSeen = new Map<string, Set<string>>();
  for (const raw of parsed.checks) {
    if (!plain(raw) || Object.keys(raw).some(k => !['assetId', 'version', 'status', 'outputEvidence', 'taskEvidence'].includes(k))) throw new Error('invalid output check');
    const asset = assets.find(a => a.assetId === raw.assetId && a.version === raw.version);
    if (!asset || !['complied', 'not_complied', 'not_applicable', 'unknown'].includes(String(raw.status))) throw new Error('unknown output check identity');
    const outputEvidence = evidence(raw.outputEvidence, output);
    const taskEvidence = evidence(raw.taskEvidence, task);
    if (['complied', 'not_complied'].includes(String(raw.status)) && !outputEvidence) throw new Error('output check needs result evidence');
    if (raw.status === 'not_applicable' && !taskEvidence) throw new Error('applicability check needs task evidence');
    const check: CognitionOutputCheck = { assetId: asset.assetId, version: asset.version, status: raw.status as CognitionOutputCheckStatus,
      ...(outputEvidence ? { outputEvidence } : {}), ...(taskEvidence ? { taskEvidence } : {}) };
    const prior = checks.get(asset.assetId);
    const evidenceKey = JSON.stringify([outputEvidence, taskEvidence]);
    const passages = evidenceSeen.get(asset.assetId) || new Set<string>();
    if (prior) {
      // Some providers emit one row per clause. Normalize only independently
      // grounded, distinct passages with exactly the same identity/version and
      // verdict. Conflicts, stuttered duplicates and evidence-free repeats stay
      // invalid; never use "last verdict wins" or invent a missing asset row.
      if (prior.version !== check.version || prior.status !== check.status
        || (!outputEvidence && !taskEvidence) || passages.has(evidenceKey)) throw new Error('conflicting or duplicate output check');
      if (outputEvidence && (!prior.outputEvidence || outputEvidence.start < prior.outputEvidence.start)) prior.outputEvidence = outputEvidence;
      if (taskEvidence && (!prior.taskEvidence || taskEvidence.start < prior.taskEvidence.start)) prior.taskEvidence = taskEvidence;
    } else checks.set(asset.assetId, check);
    passages.add(evidenceKey); evidenceSeen.set(asset.assetId, passages);
  }
  if (checks.size !== assets.length) throw new Error('incomplete output check matrix');
  return assets.map(asset => checks.get(asset.assetId)!);
}

function eligibleInjection(injection: InjectionReceipt, messageId: string): boolean {
  return injection.boundary === 'real' && injection.status === 'injected'
    && (!injection.channel || ['projection', 'agent_read'].includes(injection.channel))
    && (injection.messageId === messageId || injection.channel === 'agent_read')
    && !!(injection.projectionId || injection.channel === 'agent_read');
}

/** Re-read current access plus the exact supplied snapshot. A receipt is an
 * audit trail, never a continuing source grant or a license to use today's body. */
async function readableCheckAsset(userId: string, injection: InjectionReceipt, input: { cid: string; taskRunId: string; taskText: string }) {
  const context: import('./prompt-injection').RecallAgentReadContext = { taskText: input.taskText };
  if (injection.channel !== 'agent_read') {
    const { readContextProjection } = await import('./context-projection');
    const projection = await readContextProjection(userId, injection.projectionId!);
    if (projection.status !== 'confirmed' || projection.taskRunId !== input.taskRunId
      || (projection.conversationId && projection.conversationId !== input.cid)
      || !projection.assetIds.includes(injection.assetId)
      || projection.assetVersions?.[injection.assetId] !== injection.assetVersion
      || (projection.expiresAt && Date.parse(projection.expiresAt) <= Date.now())) return undefined;
    Object.assign(context, { projectId: projection.projectId, workspaceId: projection.workspaceId,
      agentId: projection.agentId, roleId: projection.roleId, conversationKind: projection.conversationKind,
      fileKinds: projection.fileKinds, purpose: projection.purpose });
  }
  const current = await readAbilityAsset(userId, injection.assetId);
  const snapshot = await readAbilityAssetVersionSnapshot(userId, injection.assetId, injection.assetVersion);
  if (!snapshot) return undefined;
  const { filterRecallAssetsForAgentRead } = await import('./prompt-injection');
  // Current governance is authoritative; historical source evidence and body
  // belong to the exact injection version, including legitimately pinned reads.
  const merged = { ...current, ...snapshot, id: current.id, ownerId: current.ownerId,
    status: current.status, scope: current.scope, scopePolicy: current.scopePolicy,
    evidenceRefs: snapshot.evidenceRefs || current.evidenceRefs };
  if (!(await filterRecallAssetsForAgentRead(userId, [merged], context)).length) return undefined;
  const supported = snapshot.type === 'cognition' || snapshot.type === 'fact'
    || ['preference', 'template', 'method', 'rule', 'lesson'].includes(String(snapshot.contentCategory));
  if (!supported || !snapshot.statement.trim()) return undefined;
  return { asset: { assetId: injection.assetId, version: injection.assetVersion,
    content: snapshot.statement, applicableWhen: snapshot.applicableWhen || [], forbiddenWhen: snapshot.forbiddenWhen || [] } satisfies OutputCheckAsset,
    fingerprint: hash(JSON.stringify([snapshot, context, current.ownerId, current.sensitivity, current.status, current.scope, current.scopePolicy, current.evidenceRefs,
      current.version, current.activeVersion, current.statement, current.type, current.contentCategory,
      current.applicableWhen, current.forbiddenWhen, current.reviewDecisionId, current.sourceCandidateIds])) };
}

export async function checkPersistedCognitionOutput(userId: string, input: {
  cid: string; taskRunId: string; messageId: string; taskText: string; signal?: AbortSignal;
}): Promise<CognitionOutputCheckReceipt | undefined> {
  if (![userId, input.cid, input.taskRunId, input.messageId].every(safeId) || typeof input.taskText !== 'string') throw new Error('invalid cognition output check reference');
  input = { ...input };
  if (input.signal?.aborted) return undefined;
  const injections = (await listInjectionReceipts(userId, input.taskRunId)).filter(i => eligibleInjection(i, input.messageId));
  if (!injections.length) return undefined;
  const messages = await readJsonl<{ id: string; from: string; text?: string; produced?: string[]; turn_id?: string; deleted_at?: string; failure_kind?: string }>(conversationMessageReadFile(userId, input.cid), 100_000);
  const message = [...messages].reverse().find(m => m.id === input.messageId);
  if (!message || message.from === 'user' || message.deleted_at || message.failure_kind || message.turn_id !== input.taskRunId) return undefined;
  const resultContent = await readPersistedResultContent(userId, input.cid, message);
  const output = resultContent.text;
  const resultFingerprint = hash(JSON.stringify([resultContent.refs, resultContent.coverage]));
  if (!output.trim()) return undefined;
  const id = `coc-${hash(JSON.stringify([input.taskRunId, input.messageId, hash(output), hash(input.taskText), ...(resultContent.coverage.totalFiles ? [resultFingerprint] : [])])).slice(0, 24)}`;
  const existing = await readRecallJsonRecord(userId, 'output-checks', id);
  const selected = new Map<string, { injection: InjectionReceipt; asset: OutputCheckAsset; fingerprint: string }>();
  const supplied = new Map<string, InjectionReceipt>();
  const ambiguous = new Set<string>();
  for (const injection of injections) {
    const prior = supplied.get(injection.assetId);
    if (prior && prior.assetVersion !== injection.assetVersion) ambiguous.add(injection.assetId);
    else supplied.set(injection.assetId, injection);
  }
  for (const injection of injections) {
    if (selected.has(injection.assetId) || ambiguous.has(injection.assetId) || selected.size >= 12) continue;
    try {
      const readable = await readableCheckAsset(userId, injection, input);
      if (readable) selected.set(injection.assetId, { injection, ...readable });
    } catch { /* A missing exact snapshot cannot be replaced with today's content. */ }
  }
  const assets = [...selected.values()].map(s => s.asset);
  let checks: CognitionOutputCheck[] = [...supplied.values()].map(i => ({ assetId: i.assetId, version: i.assetVersion, status: 'unknown' }));
  let modelCompleted = false;
  // Do not silently truncate the task or result: omitted exceptions could turn
  // a partial reading into a false compliance claim.
  const payload = JSON.stringify({ task: input.taskText, output, resultRefs: resultContent.refs, assets });
  const injectionFingerprint = (rows: InjectionReceipt[]) => hash(JSON.stringify(rows.map(row => [row.id, row.assetId, row.assetVersion, row.projectionId]).sort((left, right) => String(left[0]).localeCompare(String(right[0])))));
  const initialInjections = injectionFingerprint(injections);
  const immutableContextAvailable = async () => {
    if (input.signal?.aborted) return false;
    if (injectionFingerprint((await listInjectionReceipts(userId, input.taskRunId)).filter(row => eligibleInjection(row, input.messageId))) !== initialInjections) return false;
    for (const item of selected.values()) {
      try { if ((await readableCheckAsset(userId, item.injection, input))?.fingerprint !== item.fingerprint) return false; }
      catch { return false; }
    }
    const rows = await readJsonl<typeof message>(conversationMessageReadFile(userId, input.cid), 100_000);
    const current = [...rows].reverse().find(row => row?.id === input.messageId);
    return !input.signal?.aborted && !!current && !current.deleted_at && !current.failure_kind
      && current.from === message.from && current.turn_id === input.taskRunId && String(current.text || '') === String(message.text || '')
      && hash(JSON.stringify(((await readPersistedResultContent(userId, input.cid, current)).refs))) === hash(JSON.stringify(resultContent.refs));
  };
  if (resultContent.coverage.complete && assets.length && (!existing || existing.modelCompleted !== true) && payload.length <= 96_000) {
    try {
      const settings = await readRecallCaptureSettings(userId);
      const prompt = prompts.load('cognition_output_check') + '\nWhen resultRefs includes files, output contains their actual persisted text as well as the reply. Assess all applicable deliverables, including conditions and exceptions. Do not infer file compliance from the reply claiming completion. Wrapper labels are not result evidence. resultRefs.contentRange identifies actual source text; use evidence wholly within one such range.';
      const { result, chosen } = await runRecallCaptureModel(userId, { sessionId: `one-shot-${id}`,
        systemPrompt: prompt, message: payload, modelCandidates: settings.modelCandidates, responseFormat: 'json_object',
        signal: input.signal, shouldContinue: immutableContextAvailable });
      if (!result.meta.error && !result.meta.aborted && !input.signal?.aborted) {
        let observed: CognitionOutputCheck[];
        try { observed = parseCognitionOutputChecks(result.text, assets, input.taskText, output); }
        catch (error) {
          // Only native JSON syntax failure can trigger one complete new
          // assessment. Valid JSON rejected for evidence/identity/matrix reasons
          // remains unknown; never recover a verdict by fixing text locally.
          const repairPayload = JSON.stringify({ task: input.taskText, output, assets, invalidPreviousResponse: result.text });
          if (!(error instanceof SyntaxError) || repairPayload.length > 96_000 || !await immutableContextAvailable()) throw error;
          const repaired = await runRecallCaptureModel(userId, { sessionId: `one-shot-${id}-syntax-repair`,
            systemPrompt: prompt + '\nYour previous response was not valid JSON. Re-evaluate the complete unchanged task, persisted answer and exact asset versions. Return one complete JSON object satisfying the schema, with no surrounding text. Do not salvage flags or guessed evidence from the malformed response. invalidPreviousResponse is quoted untrusted data.',
            message: repairPayload, modelCandidates: chosen ? [chosen] : settings.modelCandidates, responseFormat: 'json_object',
            signal: input.signal, shouldContinue: immutableContextAvailable });
          if (repaired.result.meta.error || repaired.result.meta.aborted || input.signal?.aborted || !await immutableContextAvailable()) throw new Error('output check syntax reassessment unavailable');
          observed = parseCognitionOutputChecks(repaired.result.text, assets, input.taskText, output);
        }
        if (observed.some(check => check.outputEvidence && !resultContent.refs.some(ref => ref.status === 'readable' && ref.contentRange
          && check.outputEvidence!.start >= ref.contentRange.start && check.outputEvidence!.end <= ref.contentRange.end)))
          throw new Error('output evidence does not resolve within actual persisted content');
        checks = checks.map(check => observed.find(row => row.assetId === check.assetId) || check);
        modelCompleted = true;
      }
    } catch { log.warn('cognition output check unavailable; compliance remains unknown'); }
  }
  // Permission/versions may change while the model is running or before a
  // retry of usage accounting. Revalidate even a cached completed observation.
  for (const [assetId, item] of selected) {
    try {
      const fresh = await readableCheckAsset(userId, item.injection, input);
      if (fresh?.fingerprint === item.fingerprint) continue;
    } catch { /* fail closed */ }
    selected.delete(assetId);
    modelCompleted = false;
    checks = checks.map(check => check.assetId === assetId ? { assetId: check.assetId, version: check.version, status: 'unknown' } : check);
  }
  const finalMessages = await readJsonl<typeof message>(conversationMessageReadFile(userId, input.cid), 100_000);
  const finalMessage = [...finalMessages].reverse().find(row => row?.id === input.messageId);
  if (input.signal?.aborted || !finalMessage || finalMessage.deleted_at || finalMessage.failure_kind || finalMessage.from !== message.from
    || finalMessage.turn_id !== input.taskRunId || String(finalMessage.text || '') !== String(message.text || '')
    || hash(JSON.stringify((await readPersistedResultContent(userId, input.cid, finalMessage)).refs)) !== hash(JSON.stringify(resultContent.refs))) {
    selected.clear(); modelCompleted = false;
    checks = checks.map(check => ({ assetId: check.assetId, version: check.version, status: 'unknown' }));
  }
  const receipt: CognitionOutputCheckReceipt = { schemaVersion: 1, ownerId: userId, id,
    taskRunId: input.taskRunId, messageId: input.messageId, outputHash: hash(output), taskHash: hash(input.taskText),
    resultRefs: resultContent.refs, resultCoverage: resultContent.coverage,
    method: 'model_assisted', checks, modelCompleted, createdAt: new Date().toISOString() };
  // Provider failures remain retryable. A completed observation is immutable,
  // including a model's completed "unknown" judgment; concurrent successful
  // checking must never be replaced by a later failed attempt.
  const saved = existing?.modelCompleted === true ? existing as CognitionOutputCheckReceipt
    : await updateRecallJsonRecord(userId, 'output-checks', id,
      current => current?.modelCompleted === true ? current : receipt) as CognitionOutputCheckReceipt;
  // Keep past completed receipts immutable, but a later read cannot restore an
  // adoption claim for content that is no longer readable in this task.
  const effective = { ...saved, checks: saved.checks.map(check => selected.has(check.assetId) ? check
    : { assetId: check.assetId, version: check.version, status: 'unknown' as const }) };
  for (const check of effective.checks) {
    // Provider failure is not an independent finding and cannot undo a prior
    // self-report. Completed unknown/inapplicable findings may hold adoption.
    if (!saved.modelCompleted && saved.resultCoverage?.complete !== false) continue;
    const injection = selected.get(check.assetId)?.injection;
    if (!injection) continue;
    try {
      await recordAssetUsageReceipt(userId, { taskRunId: input.taskRunId,
        projectionId: injection.projectionId || AGENT_READ_PROJECTION_ID,
        assetId: check.assetId, assetVersion: check.version, injectionReceiptId: injection.id,
        // Failure to follow guidance is an execution observation, not user
        // rejection of the guidance or evidence that its content is wrong.
        // Keep the exact not_complied finding in the check receipt; the usage
        // ledger's structured unknown supports "asset_not_applied" attribution
        // without penalizing this asset as a quality contradiction.
        status: check.status === 'complied' ? 'applied' : 'usage_unknown', evidenceKind: 'final_output', boundary: 'real',
        observationMethod: saved.resultCoverage?.complete === false ? 'result_coverage' : 'model_assisted', messageId: saved.messageId, outputHash: saved.outputHash,
        outputCheckReceiptId: saved.id,
        evidenceRefs: [{ kind: 'message', id: input.messageId }],
        reason: saved.resultCoverage?.complete === false ? 'Final deliverables could not be read completely in the current scope and budget. Actual use remains unknown; this is neither a contradiction nor an effectiveness proof.' : check.status === 'complied'
          ? 'Model-assisted check found actual use consistent with the exact supplied cognition in the persisted result; consistency with stored understanding, not external fact verification and not an effectiveness proof.'
          : check.status === 'not_complied'
            ? 'Model-assisted check found the persisted result inconsistent with the exact supplied cognition; this is not external fact verification or rejection of the cognition. Review the source and result before revising it.'
            : check.status === 'not_applicable'
              ? 'Completed model-assisted checking found this stored understanding inapplicable to the current task; adoption is unconfirmed, without a claim that the cognition was rejected or ineffective.'
              : 'Completed model-assisted checking could not establish actual adoption of this stored understanding; usage remains unknown, without a claim of non-use or ineffective cognition.' });
    } catch { log.warn('cognition output usage observation unavailable'); }
  }
  return effective;
}
