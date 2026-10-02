/**
 * cognition_kernel/pipeline — 判定→池 的总装线（S3-d）。
 *
 * routeAndSubmit 是「一条内容进门」的唯一入口：
 *   确定性短路（显式声明/字段落点）→ 默认仍进池（applyDeterministic 时直接落库）；
 *   模型判定 → 主候选建 proposed Delta 进池（次候选记 alternatives）；
 *   空候选/降级 → 未分类暂存（有出口，不给黑洞）。
 *
 * 设计约束：判定永不直写档案——applyDeterministic 只服务「用户显式回答」
 * 这一类可信生产者（gap 回填），且落库仍走统一库唯一写入口。
 */

import { judgeContentHome, type ContentToRoute, type JudgeOptions, type RoutingJudgement } from './judge';
import { buildDelta } from './delta';
import { addUnrouted, submitToPool, type PoolSourceKind } from './pool';
import { applyCognitionDeltas } from './store';
import type { DeltaOrigin } from './types';

export interface RouteAndSubmitOptions {
  judge?: JudgeOptions;
  sourceKind?: PoolSourceKind;
  /** Delta 来源口径（六枚举）；缺省 gap（提议），用户显式回答传 user。 */
  origin?: DeltaOrigin;
  /** 确定性结果直接落库（仅限可信生产者：用户显式回答/回填）。 */
  applyDeterministic?: boolean;
}

export interface RouteAndSubmitResult {
  judgement: RoutingJudgement;
  /** proposed/deterministic 进池后的条目 id。 */
  poolItemId?: string;
  /** unclassified 进未分类暂存后的 id。 */
  unroutedId?: string;
  /** applyDeterministic 生效时的统一库落地条数。 */
  appliedCount?: number;
  error?: string;
}

export async function routeAndSubmit(
  uid: string,
  content: ContentToRoute,
  options: RouteAndSubmitOptions = {},
): Promise<RouteAndSubmitResult> {
  const judgement = await judgeContentHome(uid, content, options.judge);
  const statement = String(content?.statement ?? '').replace(/\s+/g, ' ').trim().slice(0, 800);
  if (!statement) return { judgement, error: 'empty statement' };

  if (judgement.outcome === 'unclassified') {
    const unrouted = await addUnrouted(uid, statement, options.sourceKind ?? 'judge');
    return { judgement, ...(unrouted.ok ? { unroutedId: unrouted.unroutedId } : { error: unrouted.error }) };
  }

  const origin: DeltaOrigin = options.origin ?? (judgement.model === 'rules' ? 'user' : 'gap');
  const delta = buildDelta({
    op: judgement.home === 'personal_fact' && content.fieldName ? 'set' : 'add',
    target: {
      home: judgement.home as never,
      ...(content.fieldName ? { fieldName: content.fieldName } : {}),
    },
    origin,
    after: statement,
    status: 'proposed',
  });

  if (judgement.outcome === 'deterministic' && options.applyDeterministic) {
    const applied = await applyCognitionDeltas(uid, [{ ...delta, status: 'applied' }]);
    if (!applied.ok) return { judgement, error: `统一库落地失败：${applied.error ?? 'unknown'}` };
    return { judgement, appliedCount: applied.appliedCount };
  }

  const alternatives = judgement.candidates.slice(1).map((candidate) => ({ home: candidate.home, confidence: candidate.confidence }));
  const submit = await submitToPool(uid, delta, {
    sourceKind: options.sourceKind ?? 'judge',
    ...(alternatives.length ? { alternatives } : {}),
  });
  if (!submit.ok) return { judgement, error: submit.error };
  return { judgement, poolItemId: submit.itemId };
}
