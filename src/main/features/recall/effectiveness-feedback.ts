import {
  evaluateEffectivenessProof,
  listTransferProofs,
  recallProofError,
  type EffectivenessOutcome,
  type EffectivenessProofRecord,
} from './proof-service';
import { readContextProjection } from './context-projection';
import { recommendAbilityAssetAction } from './asset-service';
import { createLogger } from '../../logger';

const log = createLogger('recall.effectiveness-feedback');

export type RecallEffectivenessFeedback = 'positive' | 'neutral' | 'negative' | 'invalid' | 'rework';

export interface RecordEffectivenessFeedbackInput {
  transferProofId: string;
  feedback: RecallEffectivenessFeedback;
  note?: string;
  evidenceRefs?: unknown[];
}

export interface RecordTaskEffectivenessFeedbackInput {
  taskRunId: string;
  feedback: RecallEffectivenessFeedback;
  note?: string;
  evidenceRefs?: unknown[];
}

function outcomeFor(feedback: RecallEffectivenessFeedback): EffectivenessOutcome {
  if (feedback === 'positive') return 'better';
  if (feedback === 'negative') return 'worse';
  if (feedback === 'invalid') return 'invalid';
  if (feedback === 'rework') return 'rework';
  return 'no_improvement';
}

function observedResult(input: { feedback: RecallEffectivenessFeedback; note?: string }): string {
  const note = typeof input.note === 'string' ? input.note.replace(/\s+/g, ' ').trim() : '';
  return note || `User feedback: ${input.feedback}`;
}

function evaluateFeedbackProof(
  userId: string,
  transferProofId: string,
  input: { feedback: RecallEffectivenessFeedback; note?: string; evidenceRefs?: unknown[] },
): Promise<EffectivenessProofRecord> {
  return evaluateEffectivenessProof(userId, {
    transferProofId,
    outcome: outcomeFor(input.feedback),
    observedResult: observedResult(input),
    evidenceRefs: input.evidenceRefs || [],
  });
}

async function applyRecommendedAssetAction(
  userId: string,
  proof: EffectivenessProofRecord,
): Promise<void> {
  const action = proof.recommendedAction;
  if (action !== 'pause' && action !== 'rework') return;
  const transfer = (await listTransferProofs(userId)).find((item) => item.id === proof.transferProofId);
  if (!transfer) return;
  const reason = proof.observedResult.length > 1_000
    ? `${proof.observedResult.slice(0, 997)}...`
    : proof.observedResult;
  for (const item of transfer.assetVersions) {
    // 逐资产降级（照 usage-feedback-service 对同一 recommendAbilityAssetAction 的
    // 先例）：负向反馈到达时资产可能已被删除/撤销/清除，assertMutableAbilityAsset
    // 会抛错——效果证明已先行落盘，单条推荐失败只记日志，不炸整条反馈 API、
    // 不中断剩余资产的推荐（重试也不会因此累积重复证明）。
    try {
      await recommendAbilityAssetAction(userId, item.assetId, {
        actor: 'system',
        expectedVersion: item.version,
        action,
        reason,
      });
    } catch (error) {
      log.warn('effectiveness recommendation skipped', { assetId: item.assetId, action, error: (error as Error).message });
    }
  }
}

export async function recordEffectivenessFeedback(
  userId: string,
  input: RecordEffectivenessFeedbackInput,
): Promise<EffectivenessProofRecord> {
  const proof = await evaluateFeedbackProof(userId, input.transferProofId, input);
  await applyRecommendedAssetAction(userId, proof);
  return proof;
}

export async function recordTaskEffectivenessFeedback(
  userId: string,
  input: RecordTaskEffectivenessFeedbackInput,
): Promise<{ proofs: EffectivenessProofRecord[] }> {
  const transfers = [];
  for (const proof of await listTransferProofs(userId)) {
    if (proof.status !== 'succeeded') continue;
    if (proof.executionId === input.taskRunId) {
      transfers.push(proof);
      continue;
    }
    try {
      const projection = await readContextProjection(userId, proof.projectionId);
      if (projection.taskRunId === input.taskRunId) transfers.push(proof);
    } catch {
      // A malformed/unavailable unrelated projection does not block feedback for other proofs.
    }
  }
  // 这一条是「这次运行压根没产生成功的迁移证明」，和「有证明但没成功」
  // （E_RECALL_TRANSFER_NOT_SUCCEEDED）不是同一件事——前者用户该做的是等任务
  // 跑完，后者是这次带入已经失败了。分开给码，渲染层才能说清下一步。
  if (!transfers.length) throw recallProofError('E_RECALL_NO_SUCCESSFUL_TRANSFER', 'no successful transfer proof for task run');
  const proofs: EffectivenessProofRecord[] = [];
  for (const transfer of transfers) {
    const proof = await evaluateFeedbackProof(userId, transfer.id, input);
    proofs.push(proof);
    await applyRecommendedAssetAction(userId, proof);
  }
  return { proofs };
}
