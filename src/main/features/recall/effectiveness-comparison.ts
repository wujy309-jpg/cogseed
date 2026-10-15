/** Compare readable persisted results against the same explicit criterion.
 * This is an observed contribution assessment, never a causal-effect claim. */
import { createHash } from 'node:crypto';
import { safeId } from '../../storage';
import { prompts } from '../../prompts/loader';
import { createLogger } from '../../logger';
import * as executions from '../execution-records';
import { readReceipt } from '../p3394/context-reuse-receipt';
import { readAbilityAsset, readAbilityAssetVersionSnapshot } from './asset-service';
import { readContextProjection } from './context-projection';
import { isCognitionSourceEnabled } from './source-control';
import { abilityAssetReferenceMatches } from './asset-reference';
import { runRecallCaptureModel } from './capture-model-routing';
import type { TransferProofRecord } from './proof-service';
import type { CognitionSourceRef } from './source-service';

const log = createLogger('recall.effectiveness-comparison');
type Outcome = 'better' | 'no_improvement' | 'worse' | 'rework' | 'insufficient_evidence';
interface Asset { assetId: string; version: string; statement: string; applicableWhen?: string[]; forbiddenWhen?: string[] }
export interface EffectivenessComparison {
  method: 'model_assisted_result_comparison'; outcome: Outcome; reason: string;
  baselineExecutionId: string; resultExecutionId: string; fingerprint: string;
  causalEffectEstablished: false;
  evidence: Array<{ assetId: string; version: string; assetQuote: string; baselineQuote: string; resultQuote: string }>;
}
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function literal(value: unknown, source: string): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 1000
    && source.indexOf(value) >= 0 && source.indexOf(value, source.indexOf(value) + 1) < 0;
}

/** Quotes and the complete identity matrix are host-checked, including negatives. */
export function parseEffectivenessComparison(raw: string, assets: Asset[], baseline: string, result: string) {
  if (typeof raw !== 'string' || raw.length > 24_000) throw new Error('invalid effectiveness comparison');
  const row: unknown = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
  if (!object(row) || Object.keys(row).some(key => !['outcome', 'reason', 'evidence'].includes(key))
    || !['better', 'no_improvement', 'worse', 'rework', 'insufficient_evidence'].includes(String(row.outcome))
    || typeof row.reason !== 'string' || !row.reason.trim() || row.reason.length > 2000
    || !Array.isArray(row.evidence) || row.evidence.length > assets.length) throw new Error('invalid effectiveness comparison');
  const seen = new Set<string>();
  const evidence: EffectivenessComparison['evidence'] = [];
  for (const item of row.evidence) {
    if (!object(item) || Object.keys(item).some(key => !['assetId', 'version', 'assetQuote', 'baselineQuote', 'resultQuote'].includes(key)))
      throw new Error('invalid effectiveness evidence');
    const asset = assets.find(asset => asset.assetId === item.assetId && asset.version === item.version);
    if (!asset || seen.has(asset.assetId) || !literal(item.assetQuote, asset.statement)
      || !literal(item.baselineQuote, baseline) || !literal(item.resultQuote, result)) throw new Error('unresolved effectiveness evidence');
    seen.add(asset.assetId);
    evidence.push({ assetId: asset.assetId, version: asset.version, assetQuote: item.assetQuote,
      baselineQuote: item.baselineQuote, resultQuote: item.resultQuote });
  }
  // A bundle cannot credit unassessed items. Insufficient evidence stays useful
  // feedback, without a fabricated per-asset success or maturity promotion.
  if (row.outcome !== 'insufficient_evidence' && seen.size !== assets.length) throw new Error('incomplete effectiveness evidence');
  return { outcome: row.outcome as Outcome, reason: row.reason, evidence };
}

export async function compareEffectivenessResults(userId: string, transfer: TransferProofRecord,
  baselineExecutionId: string, observation: string, evidenceRefs: CognitionSourceRef[]): Promise<EffectivenessComparison | undefined> {
  if (!safeId(userId) || !safeId(baselineExecutionId) || !transfer.receiptExecutionId
    || baselineExecutionId === transfer.receiptExecutionId || !transfer.assetVersions.length) return undefined;
  try {
    const readSnapshot = async () => {
      for (const ref of evidenceRefs) if (!await isCognitionSourceEnabled(userId, ref)) throw new Error('comparison source unavailable');
      const [current, baseline, receipt, baselineReceipt, projection] = await Promise.all([
        executions.read(userId, transfer.receiptExecutionId!), executions.read(userId, baselineExecutionId),
        readReceipt(userId, transfer.receiptExecutionId!), readReceipt(userId, baselineExecutionId),
        readContextProjection(userId, transfer.projectionId),
      ]);
      if ([current, baseline].some(record => record.status !== 'completed' || record.boundary !== 'real' || !record.resultRef)
        || !receipt || receipt.receiptId !== transfer.receiptId || receipt.status === 'rejected'
        || !baselineReceipt || baselineReceipt.boundary !== 'real' || baselineReceipt.status === 'rejected'
        || !transfer.assetVersions.every(asset => (receipt.reusedRefs || []).some(ref => abilityAssetReferenceMatches(ref, asset)))
        || transfer.assetVersions.some(asset => (baselineReceipt.reusedRefs || []).some(ref => abilityAssetReferenceMatches(ref, asset)))
        || current.kind !== baseline.kind || current.agentId !== baseline.agentId
        || current.permissionMode !== baseline.permissionMode) throw new Error('results are not comparable');
      const { filterRecallAssetsForAgentRead } = await import('./prompt-injection');
      const context = { projectId: projection.projectId, workspaceId: projection.workspaceId,
        agentId: projection.agentId, roleId: projection.roleId, purpose: projection.purpose,
        conversationKind: projection.conversationKind, fileKinds: projection.fileKinds };
      const assets: Asset[] = [];
      const revisions: unknown[] = [];
      for (const item of transfer.assetVersions) {
        const head = await readAbilityAsset(userId, item.assetId);
        const saved = await readAbilityAssetVersionSnapshot(userId, item.assetId, item.version);
        if (!saved) throw new Error('comparison asset version unavailable');
        const content = { ...head, ...saved, id: head.id, ownerId: head.ownerId, status: head.status,
          scope: head.scope, scopePolicy: head.scopePolicy, evidenceRefs: saved.evidenceRefs || head.evidenceRefs };
        if (!(await filterRecallAssetsForAgentRead(userId, [content], context)).length) throw new Error('comparison asset source unavailable');
        assets.push({ assetId: head.id, version: item.version, statement: saved.statement,
          applicableWhen: saved.applicableWhen, forbiddenWhen: saved.forbiddenWhen });
        revisions.push([head.id, head.updatedAt, head.scopePolicy, head.status, content.evidenceRefs]);
      }
      const [baselineOutput, resultOutput] = await Promise.all([
        executions.readResult(userId, baseline.executionId, baseline.resultRef!),
        executions.readResult(userId, current.executionId, current.resultRef!),
      ]);
      if (!baselineOutput.trim() || !resultOutput.trim()) throw new Error('comparison result unavailable');
      const payload = { criterion: transfer.expectedResultSnapshot, reportedObservation: observation, assets,
        baselineOutput, resultOutput };
      const message = JSON.stringify(payload);
      if (message.length > 96_000) throw new Error('complete comparison exceeds model input budget');
      return { message, assets, baselineOutput, resultOutput,
        fingerprint: hash(JSON.stringify([payload, revisions, current, baseline, receipt, baselineReceipt, evidenceRefs])) };
    };
    const before = await readSnapshot();
    const { result } = await runRecallCaptureModel(userId, { sessionId: `one-shot-effect-comparison-${before.fingerprint.slice(0, 24)}`,
      systemPrompt: prompts.load('cognition_effectiveness_comparison'), message: before.message, modelCandidates: [] });
    if (result.meta.aborted || result.meta.error) return undefined;
    const assessed = parseEffectivenessComparison(result.text, before.assets, before.baselineOutput, before.resultOutput);
    const after = await readSnapshot();
    if (after.fingerprint !== before.fingerprint) return undefined;
    return { method: 'model_assisted_result_comparison', ...assessed, baselineExecutionId,
      resultExecutionId: transfer.receiptExecutionId, fingerprint: before.fingerprint, causalEffectEstablished: false };
  } catch { log.warn('effectiveness comparison unavailable', { transferProofId: transfer.id }); return undefined; }
}
