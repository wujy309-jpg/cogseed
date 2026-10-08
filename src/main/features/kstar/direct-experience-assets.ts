import { cognitionIntegrationIsolated } from '../cognition/integration-boundary';
import { createLogger } from '../../logger';
import { safeId } from '../../storage';
import { classifyAbilityAssetWriteFailure, readAbilityAsset } from '../recall/asset-service';
import { alignUpdateCandidateType, autoApplyRecallCandidate } from '../recall/candidate-service';
import { submitCognitionCandidate } from '../cognition/candidate-submission';
import { createExperience, type ExperienceRecord } from '../recall/experience-service';
import { normalizeCognitionSourceRefs, type CognitionSourceRef } from '../recall/source-service';
import { recallFieldsForKstarProposal } from './candidate-contract';
import { experienceTypeOf, scopeForTask } from '../recall/experience-taxonomy';
import { recordKstarFailure } from './failure-service';
import {
  admitKstarProposals,
  type KstarAdmissionContext,
  type KstarAdmissionSource,
} from './improvement-admission';
import { recordKstarImprovementOutcome } from './improvement-outcome';
import { readKstarReview } from './review-service';
import { userFacingSummary } from './task-level-precipitation';
import type {
  KstarCandidateProposal,
  KstarEpisodeRecord,
  KstarLearningProvenance,
} from './types';

/**
 * direct-experience-assets.ts — KStar experience line (candidate-pool path).
 *
 * Design (2026-08-15-kstar-candidate-pool-unification.md §3.2.1):
 * KStar lessons that passed the closure evidence gate are precipitated into
 * the UNIFIED candidate pool (saveRecallCandidate) instead of directly into
 * ability assets. The unified promotion exit (autoApplyRecallCandidate with
 * semantic dedup + quality fusion)
 * applies semantic dedup + quality fusion, so KStar lessons and the capture
 * line share one dedup domain (no duplicate assets, no content duplication).
 *
 * The candidate record carries learningProvenance (projectionId/forecastId/
 * episodeId/attribution) marking the KStar source. forecastId is omitted only
 * when advisory Forecast generation degraded; the ExtractionRun records that
 * condition explicitly instead of fabricating an id.
 *
 * 采用门（specs/015 T007/T010/T011）：本模块是**两条沉淀线唯一的候选出口**——
 * `saveRecallCandidate` 之前一律先过 `admitKstarProposals`（`improvement-outcome.ts`
 * 之外的唯一准入处）：更新型提案（`update`/`limit_scope`/`pause` 且带 `targetAssetId`）
 * 必须证明「任务里真的用过这一版」（usage 回执 `applied` + `boundary='real'`），
 * **被拦的提案不落候选**。各线只负责提供自己的准入上下文
 * （`kstarPrecipitationAdmission`：哪条线 + 该线相关 run id + 回指复盘/episode）。
 * 结论落点也在这里收口：`no_update`（闸门不达阈）/ `submit_failed`（写失败）
 * 与准入门自己落的 `insufficient_evidence` / `analysis_failed` 互不冒充。
 *
 * 沉淀分流（specs/016 T013 / research D2，2026-09）：create 型提案（解析后无
 * `targetAssetId` 且 action 为 `create`）在准入通过后**改道写经验条目**
 * （`experience-service.createExperience`，独立 `experiences` 集合），不再
 * `saveRecallCandidate`/`autoApplyRecallCandidate`——「这次任务学到的一条知识」
 * 是经验，不该经候选池晋升为资产。mutating（带 target）、`keep_current`/`reject`
 * 与 `preference_scan` 的 personal 候选**原路不动**（Epic 7 主链与「关于我」
 * 资产域不受分流影响）；经验写入失败仍走 `recordKstarFailure(stage:'precipitation')`。
 */

const log = createLogger('kstar.direct-experience-assets');

export interface PrecipitateDirectExperienceResult {
  createdAssetIds: string[];
  candidateIds: string[];
  /** 经验条目（specs/016 T013 分流）：create 线提案改道写入 experiences 集合，
   *  不再进候选池——`candidateIds`/`createdAssetIds` 对 create 线恒为空。 */
  experienceIds: string[];
  /** Candidates that were merged into an existing candidate/asset (dedup). */
  mergedIntoIds: string[];
  /** Candidates that became update proposals (quality-fusion, need user). */
  updateCandidateIds: string[];
  /** Persistent failure ids for proposals that could not be written. */
  failureIds: string[];
}

/** 分流的路由上下文（specs/016 D2/T013）：经验条目的 `source` 需要任务口径的
 *  字段（任务目标 → taskType、终态 → taskStatus），它们在两条沉淀线的调用方
 *  手里（直通线 = episode；需求级聚合线 = requirement + 锚 episode），提案
 *  身上没有——由调用线如实提供，不在这里编造。 */
export interface DirectExperienceRouting {
  taskGoal: string;
  taskStatus: string;
}

/** 沉淀分支 → 经验类型轴的输入（specs/016 D3）：`suggestedType` 是候选类型
 *  （rule/skill_method/personal/template…），经验类型是 lesson/workflow/gap。
 *  判定只用提案自带的既有信号，不新增判据：归因为四类 *_gap 之一 → gap
 *  （复盘命名了认知缺口）；skill_method → workflow（已验证工作流程）；
 *  其余（rule 等）→ lesson（判断/教训）。判不出的情形交给
 *  `experienceTypeOf` 兜底 uncategorized，不抛错。 */
function experienceKindFor(proposal: KstarCandidateProposal): 'lesson' | 'workflow' | 'gap' {
  const attribution = proposal.learningProvenance?.attribution;
  if (
    attribution === 'knowledge_gap' || attribution === 'rule_gap'
    || attribution === 'template_gap' || attribution === 'skill_gap'
  ) return 'gap';
  return proposal.suggestedType === 'skill_method' ? 'workflow' : 'lesson';
}


/** Lightweight source reference for requirement-level precipitation. */
export interface DirectExperienceSource {
  id: string;
  conversationId?: string;
  requirementId?: string;
  workspaceId?: string;
}

/** 沉淀线的准入上下文（两条线共用，只有这一处定义）。 */
export async function kstarPrecipitationAdmission(
  userId: string,
  input: {
    source: KstarAdmissionSource;
    /** 本线覆盖的 episode（需求级 = 该需求全部 episode；直通线 = 该 episode）。 */
    episodes: readonly KstarEpisodeRecord[];
    /** 锚 episode：结论 id 由它派生（`kio-<episodeId>`），也由它回指复盘。 */
    episodeId: string;
    requirementId?: string;
  },
): Promise<KstarAdmissionContext> {
  if (!safeId(userId) || !safeId(input.episodeId)) {
    throw new Error('invalid kstar precipitation admission reference');
  }
  // 「该线相关 taskRunIds」= episode 自身 run id + 权威归属的逐回合 run id
  // （与 `task-closure.ts::receiptRunIds`、`run-evidence.ts` 同口径）。采用回执
  // 可能挂在其中任一 id 上——少取会误把"用过"判成"没有采用证据"。
  const taskRunIds = new Set<string>();
  for (const episode of input.episodes) {
    if (episode.taskRunId && safeId(episode.taskRunId)) taskRunIds.add(episode.taskRunId);
    for (const runId of episode.reuseTurnIds || []) {
      if (safeId(runId)) taskRunIds.add(runId);
    }
  }
  return {
    source: input.source,
    appliedAdoption: { taskRunIds: [...taskRunIds] },
    reviewId: await kstarReviewIdForEpisode(userId, input.episodeId),
    episodeId: input.episodeId,
    ...(input.requirementId ? { requirementId: input.requirementId } : {}),
  };
}

/** 结论回指的复盘 id：读不到（或读失败）时派生 `ksr-<episodeId>` —— 与
 *  `task-level-precipitation.ts::updateExtractionRuns` 的兜底同口径；读取失败不
 *  阻断沉淀（复盘侧的问题由失败面记录，结论只负责回指）。 */
async function kstarReviewIdForEpisode(userId: string, episodeId: string): Promise<string> {
  try {
    const review = await readKstarReview(userId, episodeId);
    if (review?.id && safeId(review.id)) return review.id;
  } catch (error) {
    log.warn('kstar review lookup degraded', {
      userId,
      episodeId,
      error: (error as Error).message,
    });
  }
  return `ksr-${episodeId}`;
}

/** 结论是反馈，不是主链：写不进去也不能让沉淀/收口失败（best-effort），
 *  但必须留日志——否则"结论没出现"会被误读成"分析没跑"。 */
async function recordOutcomeSafely(
  userId: string,
  label: string,
  write: () => Promise<{ id: string }>,
): Promise<string | null> {
  try {
    return (await write()).id;
  } catch (error) {
    log.warn(label, { userId, error: (error as Error).message });
    return null;
  }
}

/**
 * 「无需更新」结论（T012 · quickstart S3.2）：**只**表示"分析过、确实没有达到
 * 沉淀门槛的内容"（闸门判定后无提案）。证据读取失败 / 写失败分别有
 * `analysis_failed` / `submit_failed` —— `no_update` **绝不**由失败退化而来
 * （data-model §2 不变量）。id 由 `kio-<episodeId>` 派生：同一 episode 反复分析
 * 仍只有一条（覆盖同一条，幂等）。
 */
export async function recordKstarNoUpdateOutcome(
  userId: string,
  admission: KstarAdmissionContext,
): Promise<string | null> {
  return recordOutcomeSafely(userId, 'kstar no-update outcome degraded', () => (
    recordKstarImprovementOutcome(userId, {
      episodeId: admission.episodeId,
      reviewId: admission.reviewId,
      conclusion: 'no_update',
      reason: '这次分析没有达到沉淀门槛的内容（度量差未达阈值，也没有高置信度的可复用增量），没有需要更新的内容。',
      evidenceRefs: [{ kind: 'execution', id: admission.episodeId }],
      ...(admission.requirementId ? { requirementId: admission.requirementId } : {}),
    })
  ));
}

/**
 * 「候选提交失败」结论（T013）：写候选/写资产失败时的用户可见反馈。
 * 与失败面（`recordKstarFailure(stage='precipitation')`）**并存、不替代**：
 * 结论给人话 + 归因，失败面给详情（`kstar.failures.list`）。
 * 归因复用资产写路径的分类器（specs/008 T032），认不出的落 `unknown`；
 * 错误消息原文**不进**结论（详情在失败记录里），避免受限正文落到记录。
 */
export async function recordKstarSubmitFailedOutcome(
  userId: string,
  admission: KstarAdmissionContext,
  options: { error: unknown; failureId?: string },
): Promise<string | null> {
  const failureCategory = classifyAbilityAssetWriteFailure(options.error);
  return recordOutcomeSafely(userId, 'kstar submit-failed outcome degraded', () => (
    recordKstarImprovementOutcome(userId, {
      episodeId: admission.episodeId,
      reviewId: admission.reviewId,
      conclusion: 'submit_failed',
      reason: `改进提议提交失败（归因：${failureCategory}），没有生成候选。`
        + (options.failureId ? `详情见失败记录「${options.failureId}」。` : '详情见失败记录。'),
      evidenceRefs: [{ kind: 'execution', id: admission.episodeId }],
      failureCategory,
      ...(admission.requirementId ? { requirementId: admission.requirementId } : {}),
    })
  ));
}

async function proposalToCandidateInput(
  userId: string,
  source: DirectExperienceSource,
  proposal: KstarCandidateProposal,
  index: number,
): Promise<import('../recall/candidate-service').SaveRecallCandidateInput> {
  const evidenceRefs = normalizeCognitionSourceRefs(proposal.sourceRefs);
  const action = recallFieldsForKstarProposal(proposal);
  return {
    judgment: String(proposal.judgment || '').replace(/\s+/g, ' ').trim().slice(0, 4_000),
    // value = judgment：与 recall-bridge（drain 路径）一致——两条沉淀路径
    // 的候选指纹（含 value）相同，saveRecallCandidate 指纹去重让第二次
    // 沉淀返回 existing（不产生 confirmed+superseded 双候选，也不让
    // summary 标题残片进 statement）。promote 时 value!==judgment 检查
    // 保证 statement 纯净。
    value: String(proposal.judgment || '').replace(/\s+/g, ' ').trim().slice(0, 1_000),
    summary: String(proposal.summary || '').replace(/\s+/g, ' ').trim().slice(0, 1_000),
    ...(proposal.uncertainty ? { uncertainty: String(proposal.uncertainty).slice(0, 1_000) } : {}),
    // 更新型提案的类型取自目标资产：类型在抽取阶段是按"缺口类型"推的
    // （gapType 认不出 execution_gap 时会退化成新建线的 skill_method），
    // 与它要改的那条资产无关；不一致会在确认守卫处硬拒绝。
    suggestedType: await alignUpdateCandidateType(userId, {
      suggestedType: proposal.suggestedType,
      suggestedAction: action.suggestedAction,
      ...(action.targetAssetId ? { targetAssetId: action.targetAssetId } : {}),
    }),
    suggestedScope: String(proposal.suggestedScope || 'general').slice(0, 500),
    suggestedAction: action.suggestedAction,
    ...(action.targetAssetId ? { targetAssetId: action.targetAssetId } : {}),
    // 版本组契约（specs/015 T011 ②，与 recall-bridge.ts:41 同口径）：任务当时
    // 用的版本必须一起进候选——缺了它，确认时与"当前在用版"核对无从谈起，
    // 依据链也说不清改的是哪一版。缺省 = 存量 episode 没记版本（老数据分支：
    // 不拦截、不阻断，如实提示无法核对）。
    ...(proposal.targetVersionUsed ? { targetVersionUsed: proposal.targetVersionUsed } : {}),
    sourceRefs: evidenceRefs,
    evidenceRefs,
    ...(proposal.applicableWhen ? { applicableWhen: proposal.applicableWhen } : {}),
    ...(proposal.forbiddenWhen ? { forbiddenWhen: proposal.forbiddenWhen } : {}),
    ...(proposal.learningSignal ? { learningSignal: proposal.learningSignal } : {}),
    ...(proposal.learningProvenance ? { learningProvenance: proposal.learningProvenance } : {}),
    captureKey: `kstar-${source.id}-${index}`,
    // 空间归属：KStar 会话挂空间时 workspaceId 即空间 id（bus.ts 以
    // turnSpaceId 填充）。带上后资产落 spaceId，空间资产 tab 才能显示
    // KStar 沉淀的资产（否则全局可见但空间过滤不到）。
    ...(source.workspaceId && safeId(source.workspaceId) ? { spaceId: source.workspaceId } : {}),
  };
}

/**
 * Episode（直通）线入口：单 episode 的沉淀。
 *
 * 沉淀闸门不达阈（上游 `proposeKstarCandidates` 按 ΔR/置信度判完没有提案）→
 * 如实回一条 `no_update` 结论，不让"确实没什么可沉淀"静默无声。
 * `timed_out` 的 episode 由 `proposeKstarCandidates` 直接返回空——那不是
 * "没什么可沉淀"，而是"这次不算数"，**不写成 `no_update`**（不得掩盖失败）。
 */
export async function precipitateDirectExperienceAssets(
  userId: string,
  episode: KstarEpisodeRecord,
  proposals: KstarCandidateProposal[],
): Promise<PrecipitateDirectExperienceResult> {
  if (!safeId(userId) || !safeId(episode.id)) throw new Error('invalid direct experience reference');
  if (cognitionIntegrationIsolated()) return { createdAssetIds: [], candidateIds: [], experienceIds: [], mergedIntoIds: [], updateCandidateIds: [], failureIds: [] };
  const admission = await kstarPrecipitationAdmission(userId, {
    source: 'direct_experience',
    episodes: [episode],
    episodeId: episode.id,
  });
  if (!proposals.length) {
    if (episode.r.status !== 'timed_out') await recordKstarNoUpdateOutcome(userId, admission);
    return {
      createdAssetIds: [], candidateIds: [], experienceIds: [], mergedIntoIds: [], updateCandidateIds: [], failureIds: [],
    };
  }
  // 直通线的 routing 上下文来自 episode 本身（任务目标 + 终态）。
  return precipitateDirectExperienceFromSource(
    userId,
    { id: episode.id, workspaceId: episode.s?.workspaceId },
    proposals,
    admission,
    { taskGoal: episode.t.userGoal, taskStatus: episode.r.status },
  );
}

/**
 * 两条沉淀线**唯一**的候选提交出口：先过采用门，再进候选池。
 *
 * `admission` 由调用线提供（需求级 / 直通线各自的上下文），本函数只做两件事：
 *  ① 把提案交给 `admitKstarProposals`，**只有 `admitted` 的提案**才会走到
 *     `saveRecallCandidate`（被拦提案不落候选，拦下的原因与结论由准入门落档）；
 *  ② 写入失败时保留既有 `recordKstarFailure(stage='precipitation')`（best-effort
 *     语义不变），并补一条 `submit_failed` 结论与归因。
 */
export async function precipitateDirectExperienceFromSource(
  userId: string,
  source: DirectExperienceSource,
  proposals: KstarCandidateProposal[],
  admission: KstarAdmissionContext,
  routing: DirectExperienceRouting,
): Promise<PrecipitateDirectExperienceResult> {
  if (!safeId(userId) || !safeId(source.id)) throw new Error('invalid direct experience reference');
  if (cognitionIntegrationIsolated()) return { createdAssetIds: [], candidateIds: [], experienceIds: [], mergedIntoIds: [], updateCandidateIds: [], failureIds: [] };
  // 提交前取采用证据 + 准入（T007/T010/T011）：门在写入之前**只走一次**，
  // 两条线共用同一判定，不存在绕过它的第二出口。分流在准入**之后**——
  // 被准入拦下的提案既不落候选也不写经验（specs/016：分流的分流点在准入
  // 之后的提案处理处，准入逻辑本身不动）。
  const submitted = proposals.slice(0, 3);
  const gate = await admitKstarProposals(userId, submitted, admission);
  const allowed = new Set(gate.admitted);
  const result: PrecipitateDirectExperienceResult = {
    createdAssetIds: [],
    candidateIds: [],
    experienceIds: [],
    mergedIntoIds: [],
    updateCandidateIds: [],
    failureIds: [],
  };
  for (const [index, proposal] of submitted.entries()) {
    // 被拦提案不落候选：唯一的提交出口就是这里。index 用原序（不因被拦而
    // 重排）——captureKey 是候选的稳定指纹，漂移会造出第二个候选；经验 id
    // `exp-<source.id>-<index>` 同理复用这个原序。
    if (!allowed.has(proposal)) continue;
    try {
      const evidenceRefs = normalizeCognitionSourceRefs(proposal.sourceRefs);
      if (!evidenceRefs.length) continue;
      const action = recallFieldsForKstarProposal(proposal);
      // 2026-10-08 U09（KSTAR 双向隔离）：create 型提案不再直写经验条目
      //（经验属「我的认知」域，KSTAR 新产出不得绕过确认写入认知）；
      // 全部提案统一进 submitCognitionCandidate 候选池，只作建议，
      // 由用户确认后经 autoApplyRecallCandidate（仅作用于已 confirmed
      // 候选）走正式写口。
      void action;
      // 1. Enter the unified extraction pipeline (KSTAR = its adapter): the
      //    submission goes through submitCognitionCandidate, never straight to
      //    saveRecallCandidate. Same dedup semantics: the EXISTING candidate is
      //    returned when the exact fingerprint matched (merged evidence).
      const input = await proposalToCandidateInput(userId, source, proposal, index);
      // Attribution names the gap, not the target's storage type. A knowledge
      // gap in an existing rule must not turn its update into a personal fact.
      // Read the actual owned target before persisting; missing targets fail
      // honestly rather than leaving a candidate that can never be confirmed.
      if (action.targetAssetId) {
        const target = await readAbilityAsset(userId, action.targetAssetId);
        input.suggestedType = target.type;
      }
      const candidate = await submitCognitionCandidate(userId, input);
      result.candidateIds.push(candidate.id);

      // 2. Unified promotion exit: semantic dedup + quality fusion against
      //    the asset library, then promote (or generate an update candidate).
      //    `provenance: 'kstar'` 仅作审计提示（出身收敛后不再产生行为差异）。
      const outcome = await autoApplyRecallCandidate(userId, candidate.id, { provenance: 'kstar' });
      if (outcome.asset) {
        result.createdAssetIds.push(outcome.asset.id);
        const workspaceId = source.workspaceId;
        if (workspaceId && safeId(workspaceId)) {
          try {
            const { addWorkspaceAssetReference } = await import('../recall/workspace-refs');
            await addWorkspaceAssetReference(userId, {
              assetId: outcome.asset.id,
              workspaceId,
              scope: proposal.suggestedScope,
            });
          } catch (error) {
            log.warn('direct experience workspace reference degraded', {
              userId,
              assetId: outcome.asset.id,
              error: (error as Error).message,
            });
          }
        }
      }
      if (outcome.mergedIntoAssetId) result.mergedIntoIds.push(outcome.mergedIntoAssetId);
      if (outcome.updateCandidate) result.updateCandidateIds.push(outcome.updateCandidate.id);
    } catch (error) {
      // Direct precipitation is best-effort: a failure must never break the
      // closure itself.
      log.warn('direct experience precipitation degraded', {
        userId,
        sourceId: source.id,
        error: (error as Error).message,
      });
      const failure = await recordKstarFailure(userId, {
        stage: 'precipitation', errorCode: 'asset_write_failed',
        errorMessage: (error as Error).message, operationKey: `precipitation-${source.id}-${index}`,
        ...(source.conversationId ? { conversationId: source.conversationId } : {}),
        ...(source.requirementId ? { requirementId: source.requirementId } : {}),
        episodeId: source.id.startsWith('kse-') ? source.id : undefined,
      }).catch(() => null);
      if (failure) result.failureIds.push(failure.id);
      // 提交失败如实反馈（T013）：同一失败重试时失败记录 id 与结论 id 都由
      // 派生保证只有一条（不产生第二条成功对象，也不产生第二条结论）。
      await recordKstarSubmitFailedOutcome(userId, admission, {
        error,
        ...(failure ? { failureId: failure.id } : {}),
      });
    }
  }
  return result;
}
