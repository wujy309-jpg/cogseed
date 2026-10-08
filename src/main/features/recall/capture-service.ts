import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { createLogger } from '../../logger';
import { prompts } from '../../prompts/loader';
import { buildRunner } from '../../model/core-agent/runner';
import { safeId } from '../../storage';
import { scheduleBootBackground, type ScheduledBootBackgroundTask } from '../../util/boot_init';
import { getConfiguredModelOAuthExpiredMessage, hasConfiguredModel } from '../auth';
import * as chats from '../chats';
import type { ReviewDecision } from '../cognition/review-decision';
import { getRecallCandidateCapabilities, recallCandidateError, type RecallCandidateCapabilities } from './candidate-capabilities';
import { normalizeAssetScopeValue } from './scope-policy';
import type { PersonalProfileSyncResult, PersonalProfileTarget } from './personal-profile-sync';
import {
  run as runCliAgent,
} from '../local_agents/runner';
import { detectAll } from '../local_agents/registry';
import {
  isQuiescent,
  subscribeTaskTerminals,
  type TaskTerminalEvent,
  type TaskTerminalListener,
} from '../group_chat/bus';
import { readMembers } from '../group_chat/state';
import type { GroupMessage } from '../group_chat/visibility';
import { listAbilityAssets, readAbilityAsset } from './asset-service';
import {
  isAutoCaptureEligible,
  promoteRecallCandidate,
  readRecallAssetHandoffReceipt,
  readRecallCandidate,
  type AbilityAssetType,
  type RecallAssetHandoffReceipt,
  type RecallAbilityAssetRecord,
  type RecallCandidateRecord,
  type RecallCandidateStatus,
} from './candidate-service';
import { submitCognitionCandidate } from '../cognition/candidate-submission';
import { recallJsonRecordPath } from './paths';
import type { CognitionSourceRef } from './source-service';
import {
  cognitionArtifactSourceId,
  cognitionMessageSourceId,
  listCognitionSources,
} from './source-catalog';
import { readCognitionSourceControl } from './source-control';
import { createRecallView, isRecallViewExpired, readRecallView, type RecallViewRecord } from './recall-view-service';
import { prepareRecallSkillDraft } from './skill-draft-service';
import {
  readRecallJsonRecord,
  updateRecallJsonRecord,
} from './store';
import type { RecallJsonRecord } from './types';
import { listUserTeachingSignals } from './teaching-service';
import {
  isWithinNightlyWindow,
  nextNightlyRunAt,
  readRecallCaptureSettings,
  type RecallCaptureExecutionPolicy,
  type RecallCaptureSettingsRecord,
} from './capture-settings';
import {
  bumpRecallCaptureStats,
  type RecallCaptureStatsDelta,
} from './capture-stats';
import {
  assessRecallCandidateClassification,
  assessRecallCaptureCandidateQuality,
  isTaskLocalRuleProposal,
  screenRecallCaptureValue,
  type RecallCaptureFilterReason,
  type RecallCaptureValueSignal,
} from './capture-value-screening';
import { isRecallAssistantMessage, isRecallConversationMessage } from './conversation-message-policy';

const log = createLogger('recall.capture');
const CAPTURE_COLLECTION = 'captures';
const MAX_CAPTURE_MESSAGES = 32;
const MAX_CAPTURE_TEXT_CHARS = 22_000;
const MAX_MODEL_CANDIDATES = 3;
async function prepareSkillDraftForPromotedAsset(
  userId: string,
  promoted: { candidate: RecallCandidateRecord; asset: RecallAbilityAssetRecord },
): Promise<void> {
  if (promoted.asset.type !== 'skill_method' || promoted.asset.status !== 'active') return;
  try {
    const draft = await prepareRecallSkillDraft(userId, promoted.asset.id);
    if (draft.status === 'failed') {
      log.warn('automatic Recall skill draft failed', {
        asset_id: promoted.asset.id,
        code: draft.errorCode,
      });
    }
  } catch (error) {
    log.warn('automatic Recall skill draft could not be prepared', {
      asset_id: promoted.asset.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export type RecallCaptureStatus =
  | 'waiting_quiet'
  | 'waiting_completion'
  | 'waiting_manual'
  | 'scheduled'
  | 'queued'
  | 'extracting'
  | 'writing'
  | 'paused'
  | 'review_ready'
  | 'no_candidate'
  | 'completed'
  | 'configuration_required'
  | 'failed'
  | 'cancelled';

export type RecallCaptureStage =
  | 'model_check'
  | 'recall_view'
  | 'model_extraction'
  | 'candidate_save'
  | 'asset_write';

export interface RecallCaptureModelUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface RecallCaptureRecord extends RecallJsonRecord {
  id: string;
  taxonomyVersion: 2;
  conversationId: string;
  conversationTitle?: string;
  terminalRunId: string;
  anchorMessageId: string;
  messageIds: string[];
  status: RecallCaptureStatus;
  visibility: 'internal' | 'visible';
  screeningStatus: 'pending' | 'qualified' | 'filtered';
  screeningSignals?: RecallCaptureValueSignal[];
  screenedAt?: string;
  filterReason?: RecallCaptureFilterReason;
  /** 模型显式判空时它自己给的一句理由。只有 `model_no_candidate` 会带。 */
  noCandidateReason?: string;
  waitingCompletionReason?: 'terminal_waiting_input' | 'activity_changed';
  stage?: RecallCaptureStage;
  executionPolicy: RecallCaptureExecutionPolicy | 'immediate';
  quietMinutes?: number;
  lastActivityAt?: string;
  scheduledFor?: string;
  nightlyStart?: string;
  nightlyEnd?: string;
  catchUpMissed?: boolean;
  resumeStatus?: 'waiting_quiet' | 'waiting_completion' | 'waiting_manual' | 'scheduled' | 'queued';
  attempt: number;
  candidateIds: string[];
  /** 终态时点固化的复核计数快照（2026-09-16 A2）：workflowStatus 判定以它
   *  为准，杜绝 defer 冷却过期等读取时点漂移把已完成任务翻成失败。 */
  reviewSnapshot?: RecallCaptureReviewSummary;
  writingCandidateId?: string;
  /** 历史自动写入标记，只用于读兼容；新提取不设置、不授予发布权限。 */
  autoWrite?: boolean;
  recallViewId?: string;
  errorCode?: string;
  recoveredAt?: string;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  modelUsage?: RecallCaptureModelUsage;
  createdAt: string;
  updatedAt: string;
}

export type RecallCaptureWorkflowStatus = RecallCaptureStatus | 'completed';

export type RecallCaptureDisplayStatus =
  | 'waiting'
  | 'extracting'
  | 'review_ready'
  | 'writing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type RecallCaptureDisplayReason =
  | 'quiet_period'
  | 'conversation_active'
  | 'manual_start_required'
  | 'nightly_window'
  | 'queued'
  | 'paused'
  | 'extracting'
  | 'asset_write'
  | 'review_pending'
  | 'no_candidate'
  | 'review_completed'
  | 'model_not_configured'
  | 'model_auth_required'
  | 'asset_write_failed'
  | 'asset_write_interrupted'
  | 'capture_failed'
  | 'cancelled';

export type RecallCaptureAction =
  | 'run_now'
  | 'pause'
  | 'resume'
  | 'cancel'
  | 'review_candidates'
  | 'configure_model'
  | 'retry'
  | 'view_assets'
  | 'open_conversation';

export interface RecallCaptureReviewSummary {
  total: number;
  pending: number;
  deferred: number;
  promoted: number;
  rejected: number;
  missing: number;
}

export type RecallCaptureNextAction =
  | 'wait_quiet'
  | 'complete_conversation'
  | 'run_now'
  | 'wait_nightly'
  | 'wait_processing'
  | 'resume'
  | 'review_candidates'
  | 'configure_model'
  | 'retry'
  | 'view_assets'
  | 'none';

/**
 * 整理记录的用户视角分桶（2026-09-15 口径修正：与行上展示的 displayStatus
 * 对齐，否则「已完成」筛选恒空——原始状态几乎不停在 completed）：
 *  - attention  有事要用户做：失败 / 待确认（未清）/ 需配置模型 / 被暂停 /
 *               等待手动开始（waiting_manual 没在跑，不冒充整理中）
 *  - active     自己在走：排队 / 提炼 / 写入（真·整理中，通常几十秒）
 *               及静默期/夜间窗口等会自动推进的等待
 *  - done       已终态：完成 / 已取消 / **没有发现可留存内容**（no_candidate
 *               ——对用户就是"跑完了、没内容"，行上显示的正是「已完成」）
 *  - silent     纯内部路由概念（isSilentCapture 零读取跳过 summarize 的
 *               性能不变式），展示口径不再产出（计数恒 0，见 summarize 层
 *               对 displayStatus 的 done 修正）
 */
export type RecallCaptureBucket = 'attention' | 'active' | 'silent' | 'done';

export function captureBucket(capture: Pick<RecallCaptureRecord, 'status'>): RecallCaptureBucket {
  if (capture.status === 'no_candidate') return 'done';
  if (['failed', 'configuration_required', 'review_ready', 'paused', 'waiting_manual'].includes(capture.status)) return 'attention';
  if (['completed', 'cancelled'].includes(capture.status)) return 'done';
  return 'active';
}

/** 静默路由谓词：系统筛空的**内部**记录才走零读取构造器。真正随时间无界
 *  增长的是这批（每段安静会话都会筛出一条）；visible 的 no_candidate 是
 *  刻意展示（手工造数/旧数据），照常进 summarize 参与计数。 */
function isSilentCapture(capture: RecallCaptureRecord): boolean {
  return capture.status === 'no_candidate' && capture.visibility === 'internal';
}

/** 候选投影（P-r1-55，2026-10-02 数据层修）：summarize 全量读池后内联进
 *  workflow 记录的展示形状——渲染层候选队列（review-queue 视图）只含最近
 *  5 条处理记录，旧任务详情按 candidateIds join 队列全落空，「整理结果」
 *  被误报成空态。字段=整理详情「整理结果」区实际消费的白名单（标题兜底
 *  链、证据 chips、pending 过滤所需的 capabilities），与 confirmedAssetReceipts
 *  同一先例：详情页展示数据随 workflow 记录下发，不依赖队列窗口。 */
export interface RecallCaptureCandidateOutcome {
  id: string;
  status: RecallCandidateStatus;
  summary: string;
  judgment: string;
  suggestedType: AbilityAssetType;
  suggestedScope: string;
  sourceRefs: CognitionSourceRef[];
  evidenceRefs: CognitionSourceRef[];
  /** pending 过滤口径与队列同源（getRecallCandidateCapabilities 现算）。 */
  capabilities: RecallCandidateCapabilities;
}

export interface RecallCaptureWorkflowRecord extends RecallCaptureRecord {
  workflowStatus: RecallCaptureWorkflowStatus;
  displayStatus: RecallCaptureDisplayStatus;
  displayReason: RecallCaptureDisplayReason;
  bucket: RecallCaptureBucket;
  reviewSummary: RecallCaptureReviewSummary;
  linkedAssetIds: string[];
  confirmedAssetReceipts: RecallCaptureConfirmedAssetReceipt[];
  /** 整理结果内联投影（P-r1-55）：见 RecallCaptureCandidateOutcome。 */
  candidateOutcomes: RecallCaptureCandidateOutcome[];
  nextAction: RecallCaptureNextAction;
  actions: RecallCaptureAction[];
}

/** 批量控制结果：逐条复用单条状态机，单条失败只记录、不影响其余条目。 */
export interface RecallCaptureBatchResult {
  succeeded: string[];
  failed: Array<{ id: string; error: string }>;
}

/** Small, display-safe view of a formal asset created through candidate review. */
export interface RecallCaptureConfirmedAssetReceipt {
  assetId: string;
  assetType: AbilityAssetType;
  version: string;
  scope: string;
  sourceRefCount: number;
  reviewDecisionId: string;
}

export interface RecallCaptureCandidatePromotion {
  candidate: RecallCandidateRecord;
  asset: RecallAbilityAssetRecord;
  decision: ReviewDecision;
  receipt: RecallAssetHandoffReceipt;
  profileProjection?: PersonalProfileSyncResult;
  /** specs/015 US-702 原样透传的版本重检口径（本层不判定版本）：
   *  `versionCheckSkipped`（复盘候选缺 targetVersionUsed，没能核对改进对象）
   *  与显式重锚成功后的 `rebasedFrom`（原锚）。 */
  versionCheckSkipped?: true;
  rebasedFrom?: string;
}

export type RecallCaptureQueryStatus = RecallCaptureStatus | RecallCaptureDisplayStatus | 'completed';

/** 列表范围：visible=只看用户可见记录（默认，既有口径）；all=含系统内部
 *  记录（被筛掉的 no_candidate、内部失败等），配合 bucket 分桶展示。 */
export type RecallCaptureListScope = 'visible' | 'all';

export interface ListRecallCapturesQuery {
  statuses?: RecallCaptureQueryStatus[];
  executionPolicy?: RecallCaptureExecutionPolicy | 'immediate';
  cursor?: string;
  limit?: number;
  scope?: RecallCaptureListScope;
}

export interface RecallCaptureCounts {
  waiting: number;
  processing: number;
  review: number;
  failed: number;
  completed: number;
  cancelled: number;
}

export interface RecallCaptureBucketCounts {
  attention: number;
  active: number;
  silent: number;
  done: number;
}

export interface RecallCapturePage {
  captures: RecallCaptureWorkflowRecord[];
  nextCursor: string | null;
  counts: RecallCaptureCounts;
  buckets: RecallCaptureBucketCounts;
}

export interface CapturePromptMessage {
  label: string;
  id: string;
  ts: string;
  role: 'user' | 'assistant';
  text: string;
  artifacts: Array<{ id: string; title: string; conversationId: string }>;
}

interface ParsedCandidate {
  judgment: string;
  value: string;
  valueProvided: boolean;
  summary: string;
  uncertainty?: string;
  suggestedType: AbilityAssetType;
  suggestedScope: string;
  suggestedAction?: 'create' | 'update' | 'limit_scope' | 'pause' | 'keep_current' | 'reject';
  actionProvided: boolean;
  risk?: 'low' | 'medium' | 'high';
  targetAssetId?: string;
  /** 规则候选的适用/禁止范围。缺失 = 模型没给出，不是「无限制」。 */
  applicableWhen?: string[];
  forbiddenWhen?: string[];
  evidence: string[];
}

class CaptureFailure extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

function captureDirectory(userId: string): string {
  return path.dirname(recallJsonRecordPath(userId, CAPTURE_COLLECTION, 'placeholder'));
}

function isCaptureStatus(value: unknown): value is RecallCaptureStatus {
  return value === 'waiting_quiet'
    || value === 'waiting_completion'
    || value === 'waiting_manual'
    || value === 'scheduled'
    || value === 'queued'
    || value === 'extracting'
    || value === 'writing'
    || value === 'paused'
    || value === 'review_ready'
    || value === 'no_candidate'
    || value === 'completed'
    || value === 'configuration_required'
    || value === 'failed'
    || value === 'cancelled';
}

function isCaptureStage(value: unknown): value is RecallCaptureStage {
  return value === 'model_check'
    || value === 'recall_view'
    || value === 'model_extraction'
    || value === 'candidate_save'
    || value === 'asset_write';
}

function isExecutionPolicy(value: unknown): value is RecallCaptureRecord['executionPolicy'] {
  return value === 'smart' || value === 'immediate' || value === 'nightly' || value === 'manual';
}

function isCaptureVisibility(value: unknown): value is RecallCaptureRecord['visibility'] {
  return value === 'internal' || value === 'visible';
}

function isCaptureScreeningStatus(value: unknown): value is RecallCaptureRecord['screeningStatus'] {
  return value === 'pending' || value === 'qualified' || value === 'filtered';
}

const CAPTURE_VALUE_SIGNALS = new Set<RecallCaptureValueSignal>([
  'preference', 'rule', 'decision', 'template', 'method', 'artifact',
  'reusable_outcome', 'substantive_exchange', 'manual_selection',
]);

const CAPTURE_FILTER_REASONS = new Set<RecallCaptureFilterReason>([
  'trivial_exchange', 'no_result', 'low_reuse_value', 'model_no_candidate',
  'candidate_unparsable', 'candidate_quality',
]);

function isCaptureValueSignals(value: unknown): value is RecallCaptureValueSignal[] {
  return Array.isArray(value) && value.length <= CAPTURE_VALUE_SIGNALS.size
    && value.every((signal) => typeof signal === 'string' && CAPTURE_VALUE_SIGNALS.has(signal as RecallCaptureValueSignal));
}

function isQuietMinutes(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 120;
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function optionalTimestampIsValid(value: unknown): boolean {
  return value === undefined || isIsoTimestamp(value);
}

function optionalNonNegativeInteger(value: unknown): boolean {
  return value === undefined || (Number.isSafeInteger(value) && Number(value) >= 0);
}

function normalizeModelUsage(value: unknown): RecallCaptureModelUsage | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const usage: RecallCaptureModelUsage = {};
  for (const key of ['inputTokens', 'outputTokens', 'totalTokens'] as const) {
    if (Number.isFinite(raw[key]) && Number(raw[key]) >= 0) usage[key] = Math.floor(Number(raw[key]));
  }
  return Object.keys(usage).length ? usage : undefined;
}

function asCapture(value: RecallJsonRecord): RecallCaptureRecord {
  if (
    !isCaptureStatus(value.status)
    || typeof value.conversationId !== 'string'
    || (value.conversationTitle !== undefined && typeof value.conversationTitle !== 'string')
    || typeof value.terminalRunId !== 'string'
    || typeof value.anchorMessageId !== 'string'
    || !Array.isArray(value.messageIds)
    || value.messageIds.some((id) => typeof id !== 'string')
    || !Number.isInteger(value.attempt)
    || Number(value.attempt) < 1
    || !Array.isArray(value.candidateIds)
    || value.candidateIds.some((id) => typeof id !== 'string')
    || (value.writingCandidateId !== undefined
      && (typeof value.writingCandidateId !== 'string' || !safeId(value.writingCandidateId)))
    || (value.autoWrite !== undefined && typeof value.autoWrite !== 'boolean')
    || (value.recallViewId !== undefined && (typeof value.recallViewId !== 'string' || !safeId(value.recallViewId)))
    || (value.stage !== undefined && !isCaptureStage(value.stage))
    || (value.executionPolicy !== undefined && !isExecutionPolicy(value.executionPolicy))
    || (value.visibility !== undefined && !isCaptureVisibility(value.visibility))
    || (value.screeningStatus !== undefined && !isCaptureScreeningStatus(value.screeningStatus))
    || (value.screeningSignals !== undefined && !isCaptureValueSignals(value.screeningSignals))
    || (value.filterReason !== undefined
      && (typeof value.filterReason !== 'string' || !CAPTURE_FILTER_REASONS.has(value.filterReason as RecallCaptureFilterReason)))
    || (value.noCandidateReason !== undefined
      && (typeof value.noCandidateReason !== 'string' || value.noCandidateReason.length > 500))
    || (value.waitingCompletionReason !== undefined
      && value.waitingCompletionReason !== 'terminal_waiting_input'
      && value.waitingCompletionReason !== 'activity_changed')
    || (value.quietMinutes !== undefined && !isQuietMinutes(value.quietMinutes))
    || (value.nightlyStart !== undefined && (typeof value.nightlyStart !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value.nightlyStart)))
    || (value.nightlyEnd !== undefined && (typeof value.nightlyEnd !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value.nightlyEnd)))
    || (value.catchUpMissed !== undefined && typeof value.catchUpMissed !== 'boolean')
    || (value.resumeStatus !== undefined
      && value.resumeStatus !== 'waiting_quiet'
      && value.resumeStatus !== 'waiting_completion'
      && value.resumeStatus !== 'waiting_manual'
      && value.resumeStatus !== 'scheduled'
      && value.resumeStatus !== 'queued')
    || !optionalTimestampIsValid(value.scheduledFor)
    || !optionalTimestampIsValid(value.lastActivityAt)
    || !optionalTimestampIsValid(value.screenedAt)
    || !optionalTimestampIsValid(value.recoveredAt)
    || !optionalTimestampIsValid(value.startedAt)
    || !optionalTimestampIsValid(value.finishedAt)
    || !optionalNonNegativeInteger(value.durationMs)
    || !isIsoTimestamp(value.createdAt)
    || !isIsoTimestamp(value.updatedAt)
  ) throw new Error('malformed recall capture');
  const executionPolicy = isExecutionPolicy(value.executionPolicy) ? value.executionPolicy : 'immediate';
  const status = value.status as RecallCaptureStatus;
  const legacyVisible = executionPolicy === 'manual'
    || ['paused', 'review_ready', 'writing', 'completed', 'configuration_required', 'failed', 'cancelled'].includes(status);
  const visibility = isCaptureVisibility(value.visibility) ? value.visibility : legacyVisible ? 'visible' : 'internal';
  const screeningStatus = isCaptureScreeningStatus(value.screeningStatus)
    ? value.screeningStatus
    : executionPolicy === 'manual'
      ? 'qualified'
      : status === 'no_candidate'
        ? 'filtered'
        : ['waiting_quiet', 'waiting_completion', 'scheduled', 'queued', 'extracting'].includes(status)
          ? 'pending'
          : 'qualified';
  return {
    ...value,
    taxonomyVersion: 2,
    executionPolicy,
    visibility,
    screeningStatus,
    stage: ['review_ready', 'no_candidate', 'completed', 'cancelled'].includes(String(value.status))
      ? undefined
      : value.stage,
    ...(normalizeModelUsage(value.modelUsage) ? { modelUsage: normalizeModelUsage(value.modelUsage) } : {}),
  } as RecallCaptureRecord;
}

function captureId(conversationId: string, anchorMessageId: string): string {
  const digest = createHash('sha256')
    .update(`${conversationId}\0${anchorMessageId}`)
    .digest('hex')
    .slice(0, 24);
  return `rcap-${digest}`;
}

function manualConversationCaptureId(
  conversationId: string,
  finishedMessageId: string,
  retryNonce = '',
): string {
  const digest = createHash('sha256')
    .update(`${conversationId}\0manual-history\0${finishedMessageId}\0${retryNonce}`)
    .digest('hex')
    .slice(0, 24);
  return `rcap-${digest}`;
}

function quietScheduleAt(now: Date, quietMinutes: number): Date {
  return new Date(now.getTime() + quietMinutes * 60_000);
}

function nightlyScheduleAfterQuiet(
  now: Date,
  quietMinutes: number,
  nightlyStart: string,
  nightlyEnd: string,
): Date {
  const quietAt = quietScheduleAt(now, quietMinutes);
  return isWithinNightlyWindow(quietAt, nightlyStart, nightlyEnd)
    ? quietAt
    : nextNightlyRunAt(quietAt, nightlyStart, nightlyEnd);
}

function timestampMs(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function truncateText(value: string, max: number): string {
  const text = value.trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(1, max - 1))}…`;
}

function comparableCandidateText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLocaleLowerCase();
}

function sameIds(left: string[], right: string[]): boolean {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return leftSet.size === rightSet.size && [...leftSet].every((id) => rightSet.has(id));
}

export function selectCaptureMessages(
  messages: GroupMessage[],
  startedAtMs: number,
  finishedAtMs: number,
  anchorMessageId?: string,
  finishedMessageId?: string,
): CapturePromptMessage[] {
  const anchorIndex = anchorMessageId
    ? messages.findIndex((message) => message.id === anchorMessageId)
    : -1;
  const finishedIndex = anchorIndex >= 0 && finishedMessageId
    ? messages.findIndex((message, index) => index >= anchorIndex && message.id === finishedMessageId)
    : -1;
  const boundedMessages = anchorIndex >= 0
    ? messages.slice(anchorIndex, finishedIndex >= anchorIndex ? finishedIndex + 1 : undefined)
    : messages;
  const secondAlignedStart = Math.floor(startedAtMs / 1_000) * 1_000;
  const inRun = boundedMessages.filter((message) => {
    if (!isRecallConversationMessage(message)) return false;
    const at = timestampMs(message.ts);
    if (anchorIndex >= 0) return at <= finishedAtMs;
    return at >= secondAlignedStart && at <= finishedAtMs;
  });
  const firstUserIndex = inRun.findIndex((message) => message.from === 'user');
  if (firstUserIndex < 0) return [];
  const fromFirstUser = inRun.slice(firstUserIndex);
  const selected = fromFirstUser.length <= MAX_CAPTURE_MESSAGES
    ? fromFirstUser
    : [fromFirstUser[0], ...fromFirstUser.slice(-(MAX_CAPTURE_MESSAGES - 1))];

  const firstCap = selected.length === 1 ? MAX_CAPTURE_TEXT_CHARS : 6_000;
  const lastCap = selected.length === 1 ? MAX_CAPTURE_TEXT_CHARS : 8_000;
  const middleCount = Math.max(0, selected.length - 2);
  const middleCap = middleCount
    ? Math.max(200, Math.floor((MAX_CAPTURE_TEXT_CHARS - firstCap - lastCap) / middleCount))
    : 0;

  return selected.map((message, index) => {
    const cap = index === 0 ? firstCap : index === selected.length - 1 ? lastCap : middleCap;
    return {
      label: `m${index + 1}`,
      id: message.id,
      ts: message.ts,
      role: isRecallAssistantMessage(message) ? 'assistant' : 'user',
      text: truncateText(message.text, cap),
      artifacts: (message.artifacts || []).slice(0, 10).map((artifact) => ({
        id: artifact.id,
        title: artifact.title,
        conversationId: artifact.source_cid || '',
      })),
    };
  });
}

function boundedRequiredText(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string') throw new CaptureFailure('invalid_model_output', `missing ${field}`);
  const text = value.replace(/\s+/g, ' ').trim();
  if (!text || text.length > max) throw new CaptureFailure('invalid_model_output', `invalid ${field}`);
  return text;
}

/** Optional-model-field tolerance: missing, empty, or WRONG-TYPED values are
 *  dropped (undefined) instead of killing the whole candidate — models
 *  occasionally emit `uncertainty: 0.5` or a nested object where a string is
 *  expected. Core fields (judgment/value/summary/scope) stay strict. */
function optionalText(value: unknown, max: number): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') return undefined;
  const text = value.replace(/\s+/g, ' ').trim();
  if (!text || text.length > max) return undefined;
  return text;
}

function parseCandidateType(value: unknown): AbilityAssetType {
  if (value === 'personal' || value === 'rule' || value === 'template' || value === 'skill_method' || value === 'fact') return value;
  throw new CaptureFailure('invalid_model_output', 'invalid suggestedType');
}

function parseCandidateAction(value: unknown): NonNullable<ParsedCandidate['suggestedAction']> {
  if (value === 'create' || value === 'update' || value === 'limit_scope' || value === 'pause'
    || value === 'keep_current' || value === 'reject') return value;
  throw new CaptureFailure('invalid_model_output', 'invalid suggestedAction');
}

function parseCandidateRisk(value: unknown): NonNullable<ParsedCandidate['risk']> {
  if (value === 'low' || value === 'medium' || value === 'high') return value;
  throw new CaptureFailure('invalid_model_output', 'invalid risk');
}

/** 容错解析模型输出：LLM 常把 JSON 包在 ```json 围栏里，或前后带散文/说明。
 *  先剥 markdown 围栏，再隔离最外层 {...}，最后 JSON.parse。任何一步失败
 *  都抛 invalid_model_output（与严格路径同码，语义不变）。 */
function parseCaptureJson(raw: string): unknown {
  let text = String(raw || '').trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new CaptureFailure('invalid_model_output', 'model output is not strict JSON');
  }
  const slice = text.slice(start, end + 1);
  try {
    return JSON.parse(slice);
  } catch {
    throw new CaptureFailure('invalid_model_output', 'model output is not strict JSON');
  }
}

/**
 * 解析结果的**完整事实**，而不只是候选数组。
 *
 * 旧口径只交出候选数组，于是调用方无法区分三件事：模型显式判空、模型给了候选
 * 但全被逐条丢弃、模型压根没给 candidates 键。这三种在实机上都会落成同一个
 * `model_no_candidate`，「为什么这次没抽出来」在系统里没有任何地方记着。
 *
 * `emittedCount` 是模型**声称**产出的候选数，`candidates` 是我们真正接住的。
 * 两者不等就说明是解析侧丢了东西，不是内容里没有。
 */
export interface RecallCaptureParseResult {
  candidates: ParsedCandidate[];
  /** 模型在 `candidates` 数组里给出的原始条目数（含随后被丢弃的）。 */
  emittedCount: number;
  /** 模型显式判空时给出的理由（提示词要求随空数组一并返回）。 */
  noCandidateReason?: string;
}

export function parseRecallCaptureResult(raw: string, validLabels: Set<string>): RecallCaptureParseResult {
  let parsed: unknown;
  try {
    parsed = parseCaptureJson(raw);
  } catch (error) {
    if (error instanceof CaptureFailure) throw error;
    throw new CaptureFailure('invalid_model_output', 'model output is not strict JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new CaptureFailure('invalid_model_output', 'model output must be an object');
  }
  const candidates = (parsed as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates) || candidates.length > MAX_MODEL_CANDIDATES) {
    throw new CaptureFailure('invalid_model_output', 'invalid candidate count');
  }

  // 逐候选容错：LLM 输出里单个候选字段非法（如 suggestedType: "method"）
  // 只丢弃该候选，保留其余合法候选——旧行为一个坏候选毁掉整批提取。
  const parsedOut: ParsedCandidate[] = [];
  for (const rawCandidate of candidates) {
    try {
      parsedOut.push(parseOneCandidate(rawCandidate, validLabels));
    } catch (error) {
      if (error instanceof CaptureFailure) {
        log.warn('recall capture candidate skipped (malformed)', {
          reason: error.message,
        });
        continue;
      }
      throw error;
    }
  }
  // 空返回时的理由是**可选**读取：模型不给也不算解析失败（旧记录、旧提示词都
  // 没有这个字段），只是那一条从此说不出所以然。
  const rawReason = (parsed as { reason?: unknown }).reason;
  const noCandidateReason = typeof rawReason === 'string' && rawReason.trim()
    ? rawReason.replace(/\s+/g, ' ').trim().slice(0, 500)
    : undefined;
  return {
    candidates: parsedOut,
    emittedCount: candidates.length,
    ...(noCandidateReason ? { noCandidateReason } : {}),
  };
}

/** 只要候选数组的旧口径。保留是因为它是纯函数、被多处单测直接断言。 */
export function parseRecallCaptureOutput(raw: string, validLabels: Set<string>): ParsedCandidate[] {
  return parseRecallCaptureResult(raw, validLabels).candidates;
}

function parseOneCandidate(rawCandidate: unknown, validLabels: Set<string>): ParsedCandidate {
  if (!rawCandidate || typeof rawCandidate !== 'object' || Array.isArray(rawCandidate)) {
    throw new CaptureFailure('invalid_model_output', 'candidate must be an object');
  }
  const candidate = rawCandidate as Record<string, unknown>;
  if (!Array.isArray(candidate.evidence) || !candidate.evidence.length) {
    throw new CaptureFailure('invalid_model_output', 'candidate evidence is required');
  }
  const evidence = [...new Set(candidate.evidence.map((label) => {
    if (typeof label !== 'string' || !validLabels.has(label)) {
      throw new CaptureFailure('invalid_model_output', 'unknown evidence label');
    }
    return label;
  }))];
  const uncertainty = optionalText(candidate.uncertainty, 1_000);
  const targetAssetId = optionalText(candidate.targetAssetId, 160);
  if (targetAssetId && !safeId(targetAssetId)) throw new CaptureFailure('invalid_model_output', 'invalid targetAssetId');
  const valueProvided = Object.prototype.hasOwnProperty.call(candidate, 'value');
  const actionProvided = Object.prototype.hasOwnProperty.call(candidate, 'suggestedAction');
  return {
    judgment: boundedRequiredText(candidate.judgment, 'judgment', 4_000),
    value: valueProvided ? boundedRequiredText(candidate.value, 'value', 1_000) : '',
    valueProvided,
    summary: boundedRequiredText(candidate.summary, 'summary', 1_000),
    ...(uncertainty ? { uncertainty } : {}),
    suggestedType: parseCandidateType(candidate.suggestedType),
      ...parseCandidateBoundaries(candidate),
    // scope 归一（A 轨道 · 2026-09-13）：LLM 自由文本（"用户全局画像"等）
    // 尽力归一词表；归不了的保留原文——匹配层 token 软匹配兜底，不硬拒。
    suggestedScope: normalizeAssetScopeValue(String(candidate.suggestedScope || ''))
      ?? boundedRequiredText(candidate.suggestedScope, 'suggestedScope', 500),
    ...(candidate.suggestedAction === undefined ? {} : { suggestedAction: parseCandidateAction(candidate.suggestedAction) }),
    actionProvided,
    ...(candidate.risk === undefined ? {} : { risk: parseCandidateRisk(candidate.risk) }),
    ...(targetAssetId ? { targetAssetId } : {}),
    evidence,
  };

}

/** 读模型给出的边界短语。非数组/空串一律忽略，宁可留空也不编造边界。 */
function parseCandidateBoundaries(candidate: Record<string, unknown>): {
  applicableWhen?: string[];
  forbiddenWhen?: string[];
} {
  const read = (raw: unknown): string[] | undefined => {
    if (!Array.isArray(raw)) return undefined;
    const items = raw
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter((item) => item.length > 0)
      .slice(0, 10)
      .map((item) => item.slice(0, 300));
    return items.length ? items : undefined;
  };
  const applicableWhen = read(candidate.applicableWhen);
  const forbiddenWhen = read(candidate.forbiddenWhen);
  return {
    ...(applicableWhen ? { applicableWhen } : {}),
    ...(forbiddenWhen ? { forbiddenWhen } : {}),
  };
}

function extractionSystemPrompt(): string {
  return [
    'You extract durable, user-reviewable knowledge from one completed conversation run.',
    'Return exactly one JSON object and no markdown or commentary.',
    // 通读整段再定候选（Mem0 abb81c8 评估采纳项②之一）：首条用户消息只提供
    // 背景，候选须由整段有界对话支持，不被首题主导。
    'Read the entire bounded run before deciding candidates; the first user message provides context only and must not dominate what you extract.',
    'Return at most 3 candidates under the top-level candidates array. When no durable candidate is supported, return an empty array and a short reason.',
    'Every candidate must cite at least one user message label from the supplied run. Greetings, status checks, and failed one-off work are not candidates.',
    // 时间双锚（采纳项②之二）：相对时间必须锚定到消息时间戳，落判词时写明
    // 锚定日期，不把"上周/下季度"这类相对词原样存成长期内容。
    'When a statement contains relative time ("last week", "from next quarter"), anchor it against the message timestamp and write the resolved absolute date into judgment; never store a bare relative phrase.',
    // 否定保义（采纳项②之三）："以前喜欢X"＝现在不再喜欢；反转语义必须按
    // 转变后的新状态记录，可带原状态说明，不得存成仍然成立的旧事实。
    'Preserve negation and reversal meaning: "I used to prefer X" means X is no longer preferred, and "we no longer do X" cancels X. Record the post-change state (optionally noting the superseded prior state); never capture the abandoned old state as a current fact.',
    // 版本组（2026-09-16）：update 候选必须基于现有资产的在用版融合生成——
    // 输入里的 existingAssets 列表带当前内容；无融合的重写会让新版丢失
    // 旧版仍然有效的信息。
    'When the conversation corrects or refines an existing asset (see "existingAssets" in the input), emit that candidate with suggestedAction "update" and targetAssetId set to that asset id, and write judgment as a MERGED REVISION of the asset current statement plus the new information — keep still-valid content from the current version, do not rewrite from scratch. If your revision would drop key content of the current version, emit it as a separate "create" candidate instead.',
    // 转变记新旧两态（采纳项②之四）：对话陈述"X 从 A 换成 B"时记录 B 为
    // 当前值，并在判词说明被替代的 A——与 update 融合规则同一精神，作用于
    // 新事实。
    'When the conversation states a change of an assignment or value ("X changed from A to B"), record B as the current state and note the superseded prior state A inside judgment.',
    'Only extract reusable knowledge supported by the supplied messages. Never invent facts or duplicate one judgment under multiple types.',
    prompts.load('recall_candidate_contract'),
  ].join('\n\n');
}

/** 版本组（2026-09-16）：提炼时附用户现有资产清单（在用版内容），供模型
 *  识别 update 场景并基于现有版融合生成，而非无上下文重写。上限护栏：
 *  只带 active 的最近 20 条，防 prompt 膨胀。 */
async function existingAssetsForExtraction(userId: string) {
  try {
    const assets = await listAbilityAssets(userId);
    return assets
      .filter((asset) => asset.status === 'active')
      .sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')))
      .slice(0, 20)
      .map((asset: RecallAbilityAssetRecord) => ({
        id: asset.id,
        title: asset.title,
        statement: asset.statement,
        type: asset.type,
        scope: asset.scope,
        version: String(asset.activeVersion || asset.version || '1'),
      }));
  } catch {
    // 资产清单读取失败不阻断整理：模型照常提炼，只是没有 update 上下文。
    return [];
  }
}

function extractionInput(
  conversationTitle: string,
  messages: CapturePromptMessage[],
  recallView: RecallViewRecord,
  existingAssets: Array<{ id: string; title: string; statement: string; type: string; scope: string; version: string }> = [],
): string {
  return JSON.stringify({
    conversation: { title: conversationTitle },
    ...(existingAssets.length ? { existingAssets } : {}),
    recallView: {
      id: recallView.id,
      purpose: recallView.purpose,
      sourceRefs: recallView.sourceRefs.map((ref) => ({
        kind: ref.kind,
        subtype: ref.subtype,
        id: ref.id,
        ...(ref.degraded ? { degraded: true } : {}),
      })),
      assetRefs: recallView.assetRefs,
      degradedRefs: recallView.degradedRefs,
    },
    messages: messages.map((message) => ({
      label: message.label,
      role: message.role,
      ts: message.ts,
      text: message.text,
      ...(message.artifacts.length
        ? { artifacts: message.artifacts.map(({ id, title }) => ({ id, title })) }
        : {}),
    })),
  });
}

/** CLI-based extraction fallback for recall capture when no CogSeed model is
 *  configured. Mirrors onboarding's `cognition_extraction.ts`: pick an
 *  installed/authenticated local CLI (claude preferred, else first available),
 *  dispatch a one-shot print-mode turn with the extraction prompt + input, and
 *  return the CLI's final text. Returns null when no CLI is usable. */
async function extractCaptureViaCli(
  userId: string,
  capture: RecallCaptureRecord,
  conversation: Awaited<ReturnType<typeof chats.getConversation>>,
  promptMessages: CapturePromptMessage[],
  recallView: RecallViewRecord,
  signal: AbortSignal | undefined,
): Promise<string | null> {
  const entries = await detectAll();
  const available = entries.filter((e) => e && e.available);
  if (!available.length) return null;
  const chosen = available.find((e) => e.type === 'claude') ?? available[0];
  const input = extractionInput(conversation?.title || capture.conversationTitle || '', promptMessages, recallView, await existingAssetsForExtraction(userId));
  const prompt = `${extractionSystemPrompt()}\n\nAnalyze the bounded conversation JSON below.\n\n## Conversation JSON\n${input}`;

  const controller = new AbortController();
  const relayAbort = (): void => controller.abort();
  signal?.addEventListener('abort', relayAbort, { once: true });
  if (signal?.aborted) controller.abort();
  try {
    const result = await runCliAgent({
      uid: userId,
      cid: capture.conversationId,
      agentId: 'recall-capture-extractor',
      agentName: 'Capture Extractor',
      cli: chosen.type,
      prompt,
      cwd: os.tmpdir(),
      signal: controller.signal,
      skipDispatchCheck: true,
      onEvent: () => {},
    });
    if (signal?.aborted) return null;
    if (result.status !== 'completed' || typeof result.output !== 'string' || !result.output.trim()) {
      log.warn('recall capture CLI extraction did not complete', {
        conversation_id: capture.conversationId,
        cli: chosen.type,
        status: result.status,
        error: result.error,
      });
      return null;
    }
    return result.output.trim();
  } finally {
    signal?.removeEventListener('abort', relayAbort);
  }
}

/** Older builds used the historical-selection entry point as an automatic
 * write path. Once that task was persisted as `queued + autoWrite`, a restart
 * could silently extract and write it without the user clicking "立即执行".
 * Convert only an untouched legacy wait; tasks that already have candidates or
 * are in a write/extract stage remain recoverable on their existing path.
 */
function isLegacyHistoricalAutomaticWait(capture: RecallCaptureRecord): boolean {
  return capture.status === 'queued'
    && capture.executionPolicy === 'manual'
    && capture.autoWrite === true
    && capture.candidateIds.length === 0
    && capture.writingCandidateId === undefined
    && capture.stage === undefined
    && capture.startedAt === undefined;
}

async function migrateLegacyHistoricalAutomaticWait(
  userId: string,
  capture: RecallCaptureRecord,
): Promise<RecallCaptureRecord> {
  if (!isLegacyHistoricalAutomaticWait(capture)) return capture;
  const now = new Date().toISOString();
  return updateCapture(userId, capture.id, (current) => {
    if (!isLegacyHistoricalAutomaticWait(current)) return current;
    return {
      ...current,
      status: 'waiting_manual',
      visibility: 'visible',
      screeningStatus: 'qualified',
      screeningSignals: ['manual_selection'],
      screenedAt: current.screenedAt || now,
      scheduledFor: undefined,
      resumeStatus: undefined,
      autoWrite: undefined,
      errorCode: undefined,
      recoveredAt: undefined,
      updatedAt: now,
    };
  });
}

export async function readRecallCapture(userId: string, id: string): Promise<RecallCaptureRecord> {
  if (!safeId(id)) throw new Error('invalid recall capture id');
  const record = await readRecallJsonRecord(userId, CAPTURE_COLLECTION, id);
  if (!record) throw new Error('recall capture not found');
  let capture = asCapture(record);
  capture = await migrateLegacyHistoricalAutomaticWait(userId, capture);
  // Older builds returned an error from runNow before persisting the source
  // failure, leaving a task in `queued` with a permanent source error. Migrate
  // that impossible combination on read so it cannot be scheduled or rendered
  // as if extraction were still pending. The source/candidates are untouched.
  if (capture.status === 'queued'
    && (capture.errorCode === 'source_removed' || capture.errorCode === 'source_paused')) {
    const now = new Date().toISOString();
    return asCapture(await updateRecallJsonRecord(userId, CAPTURE_COLLECTION, id, (current) => {
      if (!current) return record;
      const latest = asCapture(current);
      if (latest.status !== 'queued'
        || (latest.errorCode !== 'source_removed' && latest.errorCode !== 'source_paused')) return latest;
      return {
        ...latest,
        status: 'paused',
        stage: undefined,
        resumeStatus: 'queued',
        updatedAt: now,
      };
    }));
  }
  return capture;
}

function candidateUnavailableForWorkflow(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.message === 'recall candidate not found'
    || error.message.startsWith('malformed recall candidate')
    || error.message.startsWith('malformed recall record:');
}

function abilityAssetUnavailableForWorkflow(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.message === 'recall ability asset not found'
    || error.message.startsWith('malformed recall ability asset')
    || error.message.startsWith('malformed recall record:');
}

function confirmedAssetReceipt(
  candidate: RecallCandidateRecord,
  asset: RecallAbilityAssetRecord,
  receipt: RecallAssetHandoffReceipt,
): RecallCaptureConfirmedAssetReceipt | undefined {
  if (candidate.status !== 'confirmed' || !candidate.promotedAssetId || asset.id !== candidate.promotedAssetId) {
    return undefined;
  }
  const belongsToCandidate = asset.candidateId === candidate.id
    || asset.sourceCandidateIds?.includes(candidate.id);
  if (!belongsToCandidate) return undefined;
  if (
    !candidate.reviewDecisionId
    || receipt.assetId !== asset.id
    || receipt.assetType !== asset.type
    || receipt.reviewDecisionId !== candidate.reviewDecisionId
  ) {
    return undefined;
  }
  return {
    assetId: receipt.assetId,
    assetType: receipt.assetType,
    version: receipt.version,
    scope: receipt.scope,
    sourceRefCount: receipt.sourceRefs.length,
    reviewDecisionId: receipt.reviewDecisionId,
  };
}

function captureNextAction(
  capture: RecallCaptureRecord,
  workflowStatus: RecallCaptureWorkflowStatus,
  linkedAssetIds: string[],
): RecallCaptureNextAction {
  if (workflowStatus === 'completed') return linkedAssetIds.length ? 'view_assets' : 'none';
  if (workflowStatus === 'waiting_quiet') return 'wait_quiet';
  if (workflowStatus === 'waiting_completion') return 'complete_conversation';
  if (workflowStatus === 'waiting_manual') return 'run_now';
  if (workflowStatus === 'scheduled') return 'wait_nightly';
  if (workflowStatus === 'queued' || workflowStatus === 'extracting' || workflowStatus === 'writing') return 'wait_processing';
  // A removed source cannot be resumed locally: reading it again would only
  // requeue the task and immediately fail. Keep the task visible for audit and
  // let the user reconnect/select a new source before creating another task.
  if (workflowStatus === 'paused') return capture.errorCode === 'source_removed' ? 'none' : 'resume';
  if (workflowStatus === 'review_ready') return 'review_candidates';
  if (workflowStatus === 'configuration_required') return 'configure_model';
  if (workflowStatus === 'failed') return 'retry';
  if (capture.status === 'no_candidate' || workflowStatus === 'cancelled') return 'none';
  return 'none';
}

function captureDisplayStatus(
  capture: RecallCaptureRecord,
  workflowStatus: RecallCaptureWorkflowStatus,
): RecallCaptureDisplayStatus {
  if (workflowStatus === 'completed') return 'completed';
  if (workflowStatus === 'failed' || workflowStatus === 'configuration_required') return 'failed';
  if (workflowStatus === 'cancelled') return 'cancelled';
  if (workflowStatus === 'extracting') return 'extracting';
  if (workflowStatus === 'writing') return 'writing';
  if (workflowStatus === 'review_ready') return 'review_ready';
  if (capture.status === 'no_candidate') return 'completed';
  return 'waiting';
}

function captureDisplayReason(
  capture: RecallCaptureRecord,
  workflowStatus: RecallCaptureWorkflowStatus,
): RecallCaptureDisplayReason {
  if (workflowStatus === 'completed') {
    return capture.status === 'no_candidate' ? 'no_candidate' : 'review_completed';
  }
  if (workflowStatus === 'cancelled') return 'cancelled';
  if (capture.errorCode === 'model_not_configured') return 'model_not_configured';
  if (capture.errorCode === 'model_auth_required') return 'model_auth_required';
  if (capture.errorCode === 'asset_write_failed') return 'asset_write_failed';
  if (capture.errorCode === 'asset_write_interrupted') return 'asset_write_interrupted';
  if (workflowStatus === 'failed' || workflowStatus === 'configuration_required') return 'capture_failed';
  if (workflowStatus === 'writing') return 'asset_write';
  if (workflowStatus === 'extracting') return 'extracting';
  if (workflowStatus === 'review_ready') return 'review_pending';
  if (workflowStatus === 'waiting_quiet') return 'quiet_period';
  if (workflowStatus === 'waiting_completion') return 'conversation_active';
  if (workflowStatus === 'waiting_manual') return 'manual_start_required';
  if (workflowStatus === 'scheduled') return 'nightly_window';
  if (workflowStatus === 'paused') return 'paused';
  return 'queued';
}

function captureActions(
  capture: RecallCaptureRecord,
  workflowStatus: RecallCaptureWorkflowStatus,
  linkedAssetIds: string[],
): RecallCaptureAction[] {
  const actions: RecallCaptureAction[] = [];
  if (['waiting_quiet', 'waiting_manual', 'scheduled'].includes(capture.status)
    || (capture.status === 'paused' && capture.errorCode !== 'source_removed')) {
    actions.push('run_now');
  }
  if (['waiting_quiet', 'waiting_completion', 'waiting_manual', 'scheduled', 'queued', 'extracting'].includes(capture.status)
    && !(capture.status === 'extracting' && capture.stage === 'candidate_save')) {
    actions.push('pause');
  }
  if (capture.status === 'paused' && capture.errorCode !== 'source_removed') actions.push('resume');
  if (workflowStatus === 'configuration_required') actions.push('configure_model', 'retry');
  else if (workflowStatus === 'failed') actions.push('retry');
  if (workflowStatus === 'review_ready') actions.push('review_candidates');
  if (workflowStatus === 'completed' && linkedAssetIds.length) actions.push('view_assets');
  if (!['review_ready', 'no_candidate', 'writing', 'cancelled', 'completed'].includes(workflowStatus)
    && !(capture.status === 'extracting' && capture.stage === 'candidate_save')) {
    actions.push('cancel');
  }
  actions.push('open_conversation');
  return [...new Set(actions)];
}

async function summarizeRecallCaptures(
  userId: string,
  captures: RecallCaptureRecord[],
): Promise<RecallCaptureWorkflowRecord[]> {
  const candidateReads = new Map<string, Promise<RecallCandidateRecord | undefined>>();
  const assetReads = new Map<string, Promise<RecallAbilityAssetRecord | undefined>>();
  const receiptReads = new Map<string, Promise<RecallAssetHandoffReceipt | undefined>>();
  const readCandidate = (candidateId: string): Promise<RecallCandidateRecord | undefined> => {
    if (!safeId(candidateId)) return Promise.resolve(undefined);
    const cached = candidateReads.get(candidateId);
    if (cached) return cached;
    const pending = readRecallCandidate(userId, candidateId).catch((error: unknown) => {
      if (candidateUnavailableForWorkflow(error)) return undefined;
      throw error;
    });
    candidateReads.set(candidateId, pending);
    return pending;
  };
  const readAsset = (assetId: string): Promise<RecallAbilityAssetRecord | undefined> => {
    if (!safeId(assetId)) return Promise.resolve(undefined);
    const cached = assetReads.get(assetId);
    if (cached) return cached;
    const pending = readAbilityAsset(userId, assetId).catch((error: unknown) => {
      if (abilityAssetUnavailableForWorkflow(error)) return undefined;
      throw error;
    });
    assetReads.set(assetId, pending);
    return pending;
  };
  const readReceipt = (
    candidateId: string,
    reviewDecisionId: string,
  ): Promise<RecallAssetHandoffReceipt | undefined> => {
    if (!safeId(candidateId) || !/^rd_[A-Za-z0-9_-]{8,64}$/.test(reviewDecisionId)) {
      return Promise.resolve(undefined);
    }
    const key = `${candidateId}:${reviewDecisionId}`;
    const cached = receiptReads.get(key);
    if (cached) return cached;
    const pending = readRecallAssetHandoffReceipt(userId, candidateId, reviewDecisionId).catch((error: unknown) => {
      if (candidateUnavailableForWorkflow(error)) return undefined;
      if (error instanceof Error && (
        error.message.startsWith('malformed recall asset handoff receipt')
        || error.message.startsWith('invalid recall asset handoff receipt')
      )) return undefined;
      throw error;
    });
    receiptReads.set(key, pending);
    return pending;
  };

  return Promise.all(captures.map(async (capture) => {
    const candidateIds = [...new Set(capture.candidateIds)];
    const candidates = await Promise.all(candidateIds.map(readCandidate));
    // 终态固化的快照优先（2026-09-16 A2）：只保护 completed 终态——防 defer
    // 冷却过期等读取时点漂移把已完成的任务翻成失败。review_ready 保持现算：
    // 它是活的等待区，用户确认/拒绝后照常翻「已完成」（既有行为），不锁死。
    // 快照存在时仍现算 confirmed 回执——那是详情页的展示数据。
    const snapshotted = capture.status === 'completed' ? capture.reviewSnapshot : undefined;
    const reviewSummary: RecallCaptureReviewSummary = snapshotted
      ? { ...snapshotted }
      : { total: 0, pending: 0, deferred: 0, promoted: 0, rejected: 0, missing: 0 };
    const linkedAssetIds = new Set<string>();
    const confirmedAssetReceipts: RecallCaptureConfirmedAssetReceipt[] = [];
    const collectConfirmedReceipt = async (candidate: RecallCandidateRecord) => {
      if (!candidate.promotedAssetId || !candidate.reviewDecisionId) return;
      const [asset, receipt] = await Promise.all([
        readAsset(candidate.promotedAssetId),
        readReceipt(candidate.id, candidate.reviewDecisionId),
      ]);
      const displayReceipt = asset && receipt
        ? confirmedAssetReceipt(candidate, asset, receipt)
        : undefined;
      if (displayReceipt) {
        linkedAssetIds.add(displayReceipt.assetId);
        confirmedAssetReceipts.push(displayReceipt);
      }
    };
    for (const candidate of candidates) {
      if (!candidate) {
        if (!snapshotted) {
          reviewSummary.total += 1;
          reviewSummary.missing += 1;
        }
        continue;
      }
      // 复核摘要按 capability 计数，不按 raw status 列举：实机上多数候选是
      // weak_observation，旧写法把它们整条排除，用户看到的 pending 恒为 0。
      // 既不需要用户处理、又还没走完的（证据不足的弱观察）仍然不进摘要。
      const capability = getRecallCandidateCapabilities(candidate);
      // 稍后处理是用户自己按下的静音，这份摘要里继续保持安静（既有行为）。
      if (capability.isSnoozed) continue;
      if (!capability.countsAsPending && !capability.isTerminal) continue;
      if (snapshotted) {
        if (candidate.status === 'confirmed') await collectConfirmedReceipt(candidate);
        continue;
      }
      reviewSummary.total += 1;
      if (capability.countsAsPending) reviewSummary.pending += 1;
      else if (candidate.status === 'confirmed') {
        if (!candidate.promotedAssetId || !candidate.reviewDecisionId) {
          reviewSummary.missing += 1;
          continue;
        }
        const [asset, receipt] = await Promise.all([
          readAsset(candidate.promotedAssetId),
          readReceipt(candidate.id, candidate.reviewDecisionId),
        ]);
        const displayReceipt = asset && receipt
          ? confirmedAssetReceipt(candidate, asset, receipt)
          : undefined;
        if (!displayReceipt) {
          reviewSummary.missing += 1;
          continue;
        }
        reviewSummary.promoted += 1;
        linkedAssetIds.add(displayReceipt.assetId);
        confirmedAssetReceipts.push(displayReceipt);
      } else if (candidate.status === 'ignored' || candidate.status === 'expired') reviewSummary.rejected += 1;
      else reviewSummary[candidate.status] += 1;
    }

    let workflowStatus: RecallCaptureWorkflowStatus = capture.status;
    if (capture.status === 'completed') {
      workflowStatus = reviewSummary.pending || reviewSummary.deferred || reviewSummary.missing
        ? 'failed'
        : 'completed';
    } else if (capture.status === 'no_candidate') {
      workflowStatus = 'completed';
    } else if (capture.status === 'review_ready' && reviewSummary.total === 0) {
      workflowStatus = 'completed';
    } else if (capture.status === 'review_ready' && reviewSummary.missing > 0) {
      workflowStatus = 'failed';
    } else if (
      capture.status === 'review_ready'
      && reviewSummary.total > 0
      && reviewSummary.pending === 0
      && reviewSummary.deferred === 0
      && reviewSummary.missing === 0
      && reviewSummary.promoted + reviewSummary.rejected === reviewSummary.total
    ) {
      workflowStatus = 'completed';
    }
    const linkedAssets = [...linkedAssetIds];
    // 整理结果内联投影（P-r1-55）：全量读池结果直接进 workflow 记录，详情页
    // 不再依赖渲染层队列窗口（review-queue 只含最近 5 条处理记录）。读不到
    // 的候选（missing）不进投影——与旧 join 语义一致（.filter(Boolean)），
    // missing 计数仍由 reviewSummary 如实反映。
    const candidateOutcomes: RecallCaptureCandidateOutcome[] = [];
    for (const candidate of candidates) {
      if (!candidate) continue;
      candidateOutcomes.push({
        id: candidate.id,
        status: candidate.status,
        summary: candidate.summary,
        judgment: candidate.judgment,
        suggestedType: candidate.suggestedType,
        suggestedScope: candidate.suggestedScope,
        sourceRefs: candidate.sourceRefs,
        evidenceRefs: candidate.evidenceRefs,
        capabilities: getRecallCandidateCapabilities(candidate),
      });
    }
    const displayStatus = captureDisplayStatus(capture, workflowStatus);
    // 分桶与展示状态对齐（2026-09-15 口径修正）：review_ready 的候选被全部
    // 处理完时 displayStatus 已是 completed（行上显示「已完成」），桶必须
    // 跟着进 done——此前按 raw status 归 attention，「已完成」筛选恒空。
    const bucket = displayStatus === 'completed' || displayStatus === 'cancelled'
      ? 'done' as const
      : captureBucket(capture);
    return {
      ...capture,
      workflowStatus,
      displayStatus,
      displayReason: captureDisplayReason(capture, workflowStatus),
      bucket,
      reviewSummary,
      linkedAssetIds: linkedAssets,
      confirmedAssetReceipts,
      candidateOutcomes,
      nextAction: captureNextAction(capture, workflowStatus, linkedAssets),
      actions: captureActions(capture, workflowStatus, linkedAssets),
    };
  }));
}

/** 静默记录的展示视图：不经 summarizeRecallCaptures（不读候选/资产）。
 *  no_candidate 语义上已终态且无任何用户动作，reviewSummary 全零即真值。 */
function silentRecallCaptureWorkflow(capture: RecallCaptureRecord): RecallCaptureWorkflowRecord {
  return {
    ...capture,
    workflowStatus: 'completed',
    displayStatus: 'completed',
    displayReason: 'no_candidate',
    // 展示归「已完成」（2026-09-15 口径修正）：行上显示的就是「已完成」，
    // 筛选与计数必须一致；零读取路由（isSilentCapture）不受此影响。
    bucket: 'done',
    reviewSummary: { total: 0, pending: 0, deferred: 0, promoted: 0, rejected: 0, missing: 0 },
    linkedAssetIds: [],
    confirmedAssetReceipts: [],
    // 静默记录语义上无候选（no_candidate），投影为空数组即真值（P-r1-55）。
    candidateOutcomes: [],
    nextAction: 'none',
    actions: ['open_conversation'],
  };
}

/** 读路径补会话标题：conversationTitle 只在执行提炼时落盘（runRecallCapture），
 *  从未跑过的等待类记录永远没有标题。这里按会话去重补齐——只在内存里补，
 *  不写盘（记录的 updatedAt 不因展示需要而变动）；会话读取失败不抛（标题是
 *  展示增强，不是数据修复），保留「未命名会话的整理」兜底。 */
async function withConversationTitles(
  userId: string,
  captures: RecallCaptureWorkflowRecord[],
): Promise<RecallCaptureWorkflowRecord[]> {
  const missing = captures.filter((capture) => !String(capture.conversationTitle || '').trim());
  if (!missing.length) return captures;
  const titles = new Map<string, string>();
  await Promise.all([...new Set(missing.map((capture) => capture.conversationId))].map(
    async (conversationId) => {
      try {
        const conversation = await chats.getConversation(userId, conversationId);
        if (conversation && conversation.title) titles.set(conversationId, conversation.title);
      } catch {
        // 会话已删或读取失败：不阻塞列表，标题走兜底文案。
      }
    },
  ));
  if (!titles.size) return captures;
  return captures.map((capture) => (!String(capture.conversationTitle || '').trim())
    && titles.has(capture.conversationId)
    ? { ...capture, conversationTitle: titles.get(capture.conversationId) }
    : capture);
}

export async function readRecallCaptureWorkflow(
  userId: string,
  id: string,
): Promise<RecallCaptureWorkflowRecord> {
  const [capture] = await summarizeRecallCaptures(userId, [await readRecallCapture(userId, id)]);
  return (await withConversationTitles(userId, [capture]))[0];
}

/* ── 整理详情的「对话上下文」（2026-09-15 详情页改造）──────────────────
 * 展示口径 = 本次整理实际读到的消息（capture.messageIds），与模型看到的
 * 一致——"系统就是看这些内容得出的结论"。独立于 loadStoredPromptMessages
 *（模型路径的文本预算截断不该影响展示），保留 from/to 原始 actor id 供
 * 参与角色与时间线渲染。 */

export interface RecallCaptureContextParticipant {
  id: string;
  name: string;
  kind: 'user' | 'commander' | 'agent';
}

export interface RecallCaptureContextMessage {
  id: string;
  /** m1..mN，与当年喂给模型的标签一致（证据映射的可读锚点）。 */
  label: string;
  ts: string;
  role: 'user' | 'assistant';
  from: string;
  to: string[];
  text: string;
  truncated: boolean;
  artifacts: Array<{ id: string; title: string }>;
  /** evidenceRefs 用的稳定哈希 id（cognitionMessageSourceId），前端据此把
   *  候选证据关联到时间线上的具体消息。 */
  sourceId: string;
}

export interface RecallCaptureContextRecord {
  captureId: string;
  conversationId: string;
  conversationTitle?: string;
  participants: RecallCaptureContextParticipant[];
  messages: RecallCaptureContextMessage[];
  /** 会话消息已不可读（被清理/迁移）：详情页仍可渲染，只是没有上下文区。 */
  contextUnavailable?: boolean;
}

const CAPTURE_CONTEXT_TEXT_LIMIT = 4_000;

function contextParticipantKind(actorId: string): RecallCaptureContextParticipant['kind'] {
  if (actorId === 'user') return 'user';
  if (actorId === 'commander') return 'commander';
  return 'agent';
}

export async function readRecallCaptureContext(
  userId: string,
  id: string,
): Promise<RecallCaptureContextRecord> {
  const capture = await readRecallCapture(userId, id);
  const base: RecallCaptureContextRecord = {
    captureId: capture.id,
    conversationId: capture.conversationId,
    conversationTitle: capture.conversationTitle,
    participants: [],
    messages: [],
  };
  let selected: GroupMessage[];
  try {
    const allMessages = await chats.getMessages(userId, capture.conversationId, 2_000);
    const byId = new Map(allMessages.filter(isRecallConversationMessage).map((message) => [message.id, message]));
    selected = capture.messageIds.map((messageId) => byId.get(messageId))
      .filter((message): message is GroupMessage => Boolean(message));
  } catch {
    // 会话存储不可读：上下文不可用，但任务元数据照常展示。
    return { ...base, contextUnavailable: true };
  }
  if (!selected.length) return { ...base, contextUnavailable: true };

  const members = await readMembers(userId, capture.conversationId);
  const nameById = new Map(members.actors.map((actor) => [actor.id, actor.name || actor.id]));

  const messages: RecallCaptureContextMessage[] = selected.map((message, index) => {
    const text = String(message.text || '');
    return {
      id: message.id,
      label: `m${index + 1}`,
      ts: message.ts,
      role: message.from === 'user' ? 'user' : 'assistant',
      from: message.from,
      to: Array.isArray(message.to) ? [...message.to] : [],
      text: text.length > CAPTURE_CONTEXT_TEXT_LIMIT
        ? text.slice(0, CAPTURE_CONTEXT_TEXT_LIMIT)
        : text,
      truncated: text.length > CAPTURE_CONTEXT_TEXT_LIMIT,
      artifacts: (message.artifacts || []).slice(0, 10).map((artifact) => ({
        id: artifact.id,
        title: artifact.title,
      })),
      sourceId: cognitionMessageSourceId(capture.conversationId, message.id),
    };
  });

  // 参与角色：只列这段上下文里实际出现过的 actor（user 最前、指挥官次之、
  // agent 按首次出现），名字取成员名录，缺名录时用 actor id。
  const order: string[] = [];
  const seen = new Set<string>();
  for (const message of messages) {
    for (const actorId of [message.from, ...message.to]) {
      if (!actorId || seen.has(actorId)) continue;
      seen.add(actorId);
      order.push(actorId);
    }
  }
  order.sort((left, right) => {
    const weight = (actorId: string) => (actorId === 'user' ? 0 : actorId === 'commander' ? 1 : 2);
    return weight(left) - weight(right);
  });
  const participants = order.map((actorId) => ({
    id: actorId,
    name: actorId === 'user' || actorId === 'commander'
      ? actorId
      : (nameById.get(actorId) || actorId),
    kind: contextParticipantKind(actorId),
  }));

  return { ...base, participants, messages };
}

async function listAllRecallCaptures(userId: string): Promise<RecallCaptureRecord[]> {
  let names: string[];
  try {
    names = await fs.readdir(captureDirectory(userId));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const records = await Promise.all(names
    .filter((name) => name.endsWith('.json') && safeId(name.slice(0, -5)))
    .map((name) => readRecallJsonRecord(userId, CAPTURE_COLLECTION, name.slice(0, -5))));
  return records
    .filter((record): record is RecallJsonRecord => Boolean(record))
    .map(asCapture)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id));
}

const MERGEABLE_AUTOMATIC_STATUSES = new Set<RecallCaptureStatus>([
  'waiting_quiet',
  'waiting_completion',
  'waiting_manual',
  'scheduled',
  'paused',
]);

async function findMergeableAutomaticCapture(
  userId: string,
  conversationId: string,
  executionPolicy?: 'smart' | 'nightly',
): Promise<RecallCaptureRecord | undefined> {
  return (await listAllRecallCaptures(userId)).find((capture) => (
    capture.conversationId === conversationId
    && (capture.executionPolicy === 'smart' || capture.executionPolicy === 'nightly')
    && (!executionPolicy || capture.executionPolicy === executionPolicy)
    && MERGEABLE_AUTOMATIC_STATUSES.has(capture.status)
  ));
}

export async function listRecallCaptures(userId: string, limit = 20): Promise<RecallCaptureWorkflowRecord[]> {
  const wanted = Math.max(1, Math.min(100, Math.floor(Number(limit) || 20)));
  const visible = (await listAllRecallCaptures(userId)).filter((capture) => capture.visibility === 'visible');
  return withConversationTitles(userId, (await summarizeRecallCaptures(userId, visible.slice(0, wanted))));
}

function captureCounts(captures: RecallCaptureWorkflowRecord[]): RecallCaptureCounts {
  return captures.reduce<RecallCaptureCounts>((counts, capture) => {
    if (capture.displayStatus === 'extracting' || capture.displayStatus === 'writing') counts.processing += 1;
    else if (capture.displayStatus === 'review_ready') counts.review += 1;
    else if (capture.displayStatus === 'failed') counts.failed += 1;
    else if (capture.displayStatus === 'completed') counts.completed += 1;
    else if (capture.displayStatus === 'cancelled') counts.cancelled += 1;
    else counts.waiting += 1;
    return counts;
  }, { waiting: 0, processing: 0, review: 0, failed: 0, completed: 0, cancelled: 0 });
}

/** 分桶计数按 workflow 记录的（修正后）bucket 字段直读——它已含
 *  displayStatus 的 done 修正与 no_candidate 归并，与行上展示一致。 */
function captureBucketCounts(captures: Array<Pick<RecallCaptureWorkflowRecord, 'bucket'>>): RecallCaptureBucketCounts {
  return captures.reduce<RecallCaptureBucketCounts>((counts, capture) => {
    counts[capture.bucket] += 1;
    return counts;
  }, { attention: 0, active: 0, silent: 0, done: 0 });
}

const DISPLAY_CAPTURE_STATUSES = new Set<RecallCaptureDisplayStatus>([
  'waiting', 'extracting', 'review_ready', 'writing', 'completed', 'failed', 'cancelled',
]);

function encodeCaptureCursor(capture: RecallCaptureRecord): string {
  return Buffer.from(JSON.stringify([capture.updatedAt, capture.id]), 'utf8').toString('base64url');
}

function decodeCaptureCursor(cursor: string): [string, string] {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
    if (
      !Array.isArray(parsed)
      || parsed.length !== 2
      || !isIsoTimestamp(parsed[0])
      || typeof parsed[1] !== 'string'
      || !safeId(parsed[1])
    ) throw new Error('invalid cursor');
    return [parsed[0], parsed[1]];
  } catch {
    throw new Error('invalid recall capture cursor');
  }
}

export async function queryRecallCaptures(
  userId: string,
  query: ListRecallCapturesQuery = {},
): Promise<RecallCapturePage> {
  const records = await listAllRecallCaptures(userId);
  const scoped = query.scope === 'all'
    ? records
    : records.filter((capture) => capture.visibility === 'visible');
  // 性能不变式：静默记录（内部筛空的 no_candidate，随时间无界增长）永不进
  // summarizeRecallCaptures——它要逐条读候选/资产。静默记录走零读取的
  // 展示构造器；counts 口径不变（只数非静默），静默数走 buckets。
  const loud = scoped.filter((capture) => !isSilentCapture(capture));
  const silent = scoped.filter(isSilentCapture);
  const summarized = await summarizeRecallCaptures(userId, loud);
  const all = [...summarized, ...silent.map(silentRecallCaptureWorkflow)]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id));
  const counts = captureCounts(summarized);
  // 分桶计数按 workflow 记录（含 displayStatus 的 done 修正），与行上展示一致。
  const buckets = captureBucketCounts(all);
  const statuses = query.statuses?.length ? new Set(query.statuses) : undefined;
  const cursor = query.cursor ? decodeCaptureCursor(query.cursor) : undefined;
  const limit = Math.max(1, Math.min(100, Math.floor(Number(query.limit) || 25)));
  const filtered = all.filter((capture) => {
    if (statuses && ![...statuses].some((status) => (
      DISPLAY_CAPTURE_STATUSES.has(status as RecallCaptureDisplayStatus)
        ? capture.displayStatus === status
        : status === 'completed'
          ? capture.workflowStatus === 'completed'
        : status === 'no_candidate'
          ? capture.status === 'no_candidate'
          : capture.workflowStatus === status
    ))) return false;
    if (query.executionPolicy && capture.executionPolicy !== query.executionPolicy) return false;
    if (!cursor) return true;
    return capture.updatedAt < cursor[0]
      || (capture.updatedAt === cursor[0] && capture.id < cursor[1]);
  });
  const captures = filtered.slice(0, limit);
  return {
    captures: await withConversationTitles(userId, captures),
    counts,
    buckets,
    nextCursor: filtered.length > captures.length && captures.length
      ? encodeCaptureCursor(captures[captures.length - 1])
      : null,
  };
}

async function updateCapture(
  userId: string,
  id: string,
  updater: (capture: RecallCaptureRecord) => RecallCaptureRecord | Promise<RecallCaptureRecord>,
): Promise<RecallCaptureRecord> {
  const updated = await updateRecallJsonRecord(userId, CAPTURE_COLLECTION, id, async (current) => {
    if (!current) throw new Error('recall capture not found');
    return updater(asCapture(current));
  });
  return asCapture(updated);
}

function requeueInterruptedCapture(userId: string, id: string): Promise<RecallCaptureRecord> {
  return updateCapture(userId, id, (current) => current.status === 'extracting'
    ? {
        ...current,
        status: 'queued',
        stage: undefined,
        errorCode: undefined,
        updatedAt: new Date().toISOString(),
      }
    : current);
}

type RecallCaptureControlRequest = 'pause' | 'cancel';
const captureControlRequests = new Map<string, RecallCaptureControlRequest>();

function captureTaskKey(userId: string, id: string): string {
  return `${userId}:${id}`;
}

function durationSince(startedAt: string | undefined, finishedAt: string): number | undefined {
  if (!startedAt) return undefined;
  return Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt));
}

async function settleInterruptedCapture(userId: string, id: string): Promise<RecallCaptureRecord> {
  const key = captureTaskKey(userId, id);
  const requested = captureControlRequests.get(key);
  captureControlRequests.delete(key);
  if (!requested) return requeueInterruptedCapture(userId, id);
  return updateCapture(userId, id, (current) => {
    if (current.status === 'paused' || current.status === 'cancelled') return current;
    const now = new Date().toISOString();
    if (requested === 'cancel') {
      return {
        ...current,
        status: 'cancelled',
        stage: undefined,
        resumeStatus: undefined,
        errorCode: undefined,
        finishedAt: now,
        durationMs: durationSince(current.startedAt, now),
        updatedAt: now,
      };
    }
    return {
      ...current,
      status: 'paused',
      stage: undefined,
      resumeStatus: 'queued',
      errorCode: undefined,
      updatedAt: now,
    };
  });
}

async function setCaptureStage(
  userId: string,
  id: string,
  stage: RecallCaptureStage,
): Promise<RecallCaptureRecord> {
  return updateCapture(userId, id, (current) => {
    if (current.status !== 'extracting') return current;
    return { ...current, stage, updatedAt: new Date().toISOString() };
  });
}

async function loadStoredPromptMessages(
  userId: string,
  capture: RecallCaptureRecord,
): Promise<CapturePromptMessage[]> {
  const allMessages = await chats.getMessages(userId, capture.conversationId, 2_000);
  const byId = new Map(allMessages.filter(isRecallConversationMessage).map((message) => [message.id, message]));
  const selected = capture.messageIds.map((id) => byId.get(id)).filter((message): message is GroupMessage => Boolean(message));
  if (!selected.length || selected[0].from !== 'user') {
    throw new CaptureFailure('source_unavailable', 'capture messages are unavailable');
  }
  return selectCaptureMessages(selected, 0, Number.MAX_SAFE_INTEGER).map((message) => ({
    ...message,
    artifacts: message.artifacts.map((artifact) => ({
      ...artifact,
      conversationId: artifact.conversationId || capture.conversationId,
    })),
  }));
}

async function screenQueuedRecallCapture(
  userId: string,
  id: string,
  capture: RecallCaptureRecord,
): Promise<RecallCaptureRecord> {
  if (capture.executionPolicy === 'manual' || capture.screeningStatus === 'qualified') return capture;
  let promptMessages: CapturePromptMessage[];
  try {
    promptMessages = await loadStoredPromptMessages(userId, capture);
  } catch {
    const finishedAt = new Date().toISOString();
    return updateCapture(userId, id, (current) => current.status !== 'queued'
      ? current
      : {
          ...current,
          status: 'failed',
          visibility: 'internal',
          errorCode: 'source_unavailable',
          finishedAt,
          updatedAt: finishedAt,
        });
  }
  const screening = screenRecallCaptureValue(promptMessages);
  const screenedAt = new Date().toISOString();
  const screened = await updateCapture(userId, id, (current) => current.status !== 'queued'
    ? current
    : screening.eligible
      ? {
          ...current,
          screeningStatus: 'qualified',
          screeningSignals: screening.signals,
          screenedAt,
          filterReason: undefined,
          updatedAt: screenedAt,
        }
      : {
          ...current,
          status: 'no_candidate',
          visibility: 'internal',
          screeningStatus: 'filtered',
          screeningSignals: screening.signals,
          screenedAt,
          filterReason: screening.reason || 'low_reuse_value',
          finishedAt: screenedAt,
          durationMs: undefined,
          updatedAt: screenedAt,
        });
  if (screened.status === 'no_candidate' && screened.filterReason) {
    void bumpRecallCaptureStats(userId, {
      coarseFiltered: 1,
      coarseReasons: { [screened.filterReason]: 1 },
    }).catch(() => {
      // 统计失败不影响筛选主流程。
    });
  }
  return screened;
}

function isSettledAutomaticCandidate(candidate: Pick<RecallCandidateRecord, 'status'>): boolean {
  return ['rejected', 'ignored', 'expired'].includes(candidate.status);
}

export async function runRecallCapture(
  userId: string,
  id: string,
  signal?: AbortSignal,
): Promise<RecallCaptureRecord> {
  let queued = await readRecallCapture(userId, id);
  if (queued.status !== 'queued') return queued;
  const sourceControl = await readCognitionSourceControl(userId, {
    kind: 'conversation',
    id: queued.conversationId,
  });
  if (sourceControl && sourceControl.availability !== 'active') {
    return updateCapture(userId, id, (current) => current.status !== 'queued'
      ? current
      : {
          ...current,
          status: 'paused',
          resumeStatus: 'queued',
          errorCode: sourceControl.availability === 'removed' ? 'source_removed' : 'source_paused',
          updatedAt: new Date().toISOString(),
        });
  }
  queued = await screenQueuedRecallCapture(userId, id, queued);
  if (queued.status !== 'queued') return queued;
  let claimed = false;
  const startedAt = new Date().toISOString();
  let capture = await updateCapture(userId, id, (current) => ({
    ...(current.status === 'queued' ? (() => {
      claimed = true;
      return {
        ...current,
        status: 'extracting' as const,
        stage: 'model_check' as const,
        errorCode: undefined,
        startedAt,
        finishedAt: undefined,
        durationMs: undefined,
        modelUsage: undefined,
        updatedAt: startedAt,
      };
    })() : current),
  }));
  if (!claimed) return capture;

  try {
    if (signal?.aborted) return settleInterruptedCapture(userId, id);
    if ((hasConfiguredModel().configured || process.env.ANTHROPIC_API_KEY)
      && getConfiguredModelOAuthExpiredMessage()) {
      throw new CaptureFailure('model_auth_required', 'model authorization is required');
    }
    capture = await setCaptureStage(userId, id, 'recall_view');
    if (capture.status !== 'extracting' || signal?.aborted) return settleInterruptedCapture(userId, id);
    let conversation: Awaited<ReturnType<typeof chats.getConversation>>;
    let promptMessages: CapturePromptMessage[];
    try {
      [conversation, promptMessages] = await Promise.all([
        chats.getConversation(userId, capture.conversationId),
        loadStoredPromptMessages(userId, capture),
      ]);
    } catch (error) {
      if (error instanceof CaptureFailure) throw error;
      throw new CaptureFailure('source_unavailable', 'capture source could not be read');
    }
    if (!conversation) throw new CaptureFailure('source_unavailable', 'conversation is unavailable');
    if (!capture.conversationTitle && conversation.title) {
      capture = await updateCapture(userId, id, (current) => ({
        ...current,
        conversationTitle: conversation.title,
        updatedAt: new Date().toISOString(),
      }));
    }

    let recallView: RecallViewRecord | undefined;
    let activeTeachingSignals: Awaited<ReturnType<typeof listUserTeachingSignals>> = [];
    try {
      activeTeachingSignals = (await listUserTeachingSignals(userId, {
        conversationId: capture.conversationId,
        status: 'active',
        limit: 100,
      })).filter((signal) => capture.messageIds.includes(signal.messageId));
      const workspaceId = conversation.project_id || undefined;
      if (capture.recallViewId) {
        try {
          const existing = await readRecallView(userId, capture.recallViewId);
          if (
            !isRecallViewExpired(existing)
            && existing.purpose === 'conversation_capture'
            && existing.workspaceId === workspaceId
            && sameIds(
              existing.sourceRefs
                .filter((ref) => ref.kind === 'user_teaching_signal' && !ref.degraded)
                .map((ref) => ref.id),
              activeTeachingSignals.map((signal) => signal.id),
            )
          ) recallView = existing;
        } catch {
          // A missing view can be rebuilt from the durable capture source ids.
        }
      }
      if (!recallView) {
        const executionGroups = await listCognitionSources(userId, {
          kinds: ['execution_evaluation'],
          conversationId: capture.conversationId,
          limit: 10,
        });
        const sourceRefs = [
          {
            kind: 'conversation' as const,
            subtype: 'session' as const,
            scope: 'conversation' as const,
            id: capture.conversationId,
            title: conversation.title,
            sourceVersion: conversation.updated_at,
          },
          ...promptMessages.map((message) => ({
            kind: 'conversation' as const,
            subtype: 'message' as const,
            scope: 'conversation' as const,
            id: cognitionMessageSourceId(capture.conversationId, message.id),
            sourceVersion: message.ts,
          })),
          ...promptMessages.flatMap((message) => message.artifacts.map((artifact) => ({
            kind: 'artifact_file' as const,
            subtype: 'artifact' as const,
            scope: 'conversation' as const,
            id: cognitionArtifactSourceId(artifact.conversationId || capture.conversationId, artifact.id),
            title: artifact.title,
            sourceVersion: message.ts,
          }))),
          ...executionGroups.flatMap((group) => group.items),
          ...activeTeachingSignals.map((signal) => ({
            kind: 'user_teaching_signal' as const,
            subtype: 'teaching' as const,
            scope: signal.scope,
            id: signal.id,
            sourceVersion: signal.createdAt,
          })),
        ];
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1_000).toISOString();
        recallView = await createRecallView(userId, {
          purpose: 'conversation_capture',
          ...(workspaceId ? { workspaceId } : {}),
          sourceRefs,
          assetRefs: [],
          expiresAt,
        });
        capture = await updateCapture(userId, id, (current) => ({
          ...current,
          recallViewId: recallView.id,
          updatedAt: new Date().toISOString(),
        }));
      }
    } catch {
      throw new CaptureFailure('recall_view_failed', 'recall view could not be created');
    }

    capture = await setCaptureStage(userId, id, 'model_extraction');
    if (capture.status !== 'extracting' || signal?.aborted) return settleInterruptedCapture(userId, id);

    // No-model CLI fallback: when the user has no CogSeed API model (commander
    // already routes to local CLI agents), drive the extraction through an
    // installed/authenticated local CLI instead of failing with
    // model_not_configured. This keeps the capture→candidate→confirm loop
    // working in the exact setup that motivated CLI fallback.
    let extractionText: string;
    let extractionModelUsage: RecallCaptureModelUsage | undefined;
    if (!hasConfiguredModel().configured && !process.env.ANTHROPIC_API_KEY) {
      try {
        const cliText = await extractCaptureViaCli(
          userId,
          capture,
          conversation,
          promptMessages,
          recallView,
          signal,
        );
        if (cliText === null) {
          throw new CaptureFailure('model_not_configured', 'model configuration is required (no local CLI available)');
        }
        extractionText = cliText;
      } catch (err) {
        if (err instanceof CaptureFailure) throw err;
        throw new CaptureFailure('model_failed', `CLI extraction failed: ${(err as Error).message}`);
      }
    } else {
      let runner: Awaited<ReturnType<typeof buildRunner>>['runner'];
      try {
        ({ runner } = await buildRunner({
          sessionId: `memory-extract-recall-${capture.id}`,
          userId,
          systemPrompt: extractionSystemPrompt(),
          disableTools: true,
          ephemeralSession: true,
          skillList: [],
        }));
      } catch {
        throw new CaptureFailure('model_failed', 'model runner could not be built');
      }
      let result: Awaited<ReturnType<typeof runner.run>>;
      const modelController = new AbortController();
      const relayAbort = (): void => modelController.abort();
      signal?.addEventListener('abort', relayAbort, { once: true });
      if (signal?.aborted) modelController.abort();
      try {
        result = await runner.run({
          message: extractionInput(conversation.title, promptMessages, recallView, await existingAssetsForExtraction(userId)),
          signal: modelController.signal,
          thinkingLevel: 'off',
          cacheRetention: 'none',
        });
      } catch {
        if (signal?.aborted) return settleInterruptedCapture(userId, id);
        throw new CaptureFailure('model_failed', 'model extraction failed');
      } finally {
        signal?.removeEventListener('abort', relayAbort);
      }
      if (signal?.aborted) return settleInterruptedCapture(userId, id);
      if (result.meta.aborted) throw new CaptureFailure('model_failed', 'model extraction was aborted');
      if (result.meta.error) {
        const code = result.meta.error.kind === 'auth'
          ? 'model_auth_required'
          : result.meta.error.kind === 'timeout'
            ? 'model_timeout'
            : 'model_failed';
        throw new CaptureFailure(code, result.meta.error.message);
      }
      extractionText = result.text.trim();
      extractionModelUsage = normalizeModelUsage(result.meta.usage);
    }
    let parseResult: RecallCaptureParseResult;
    try {
      parseResult = parseRecallCaptureResult(
        extractionText,
        new Set(promptMessages.map((message) => message.label)),
      );
    } catch (error) {
      // Keep model output out of logs: it may contain user-authored content.
      log.warn('recall capture parse failed', {
        capture_id: id,
        conversation_id: capture.conversationId,
        error: error instanceof CaptureFailure ? error.message : String((error as Error)?.message || error),
      });
      throw error;
    }
    const parsed = parseResult.candidates;
    capture = await setCaptureStage(userId, id, 'candidate_save');
    if (capture.status !== 'extracting') return capture;
    // 自动来源只能形成候选；旧 autoWrite/auto 配置不构成逐条确认授权。
    const byLabel = new Map(promptMessages.map((message) => [message.label, message]));
    const candidates: RecallCandidateRecord[] = [];
    for (const [index, candidate] of parsed.entries()) {
      const evidenceMessages = candidate.evidence.map((label) => byLabel.get(label)!);
      if (capture.executionPolicy !== 'manual' && isTaskLocalRuleProposal(candidate, evidenceMessages)) {
        log.info('recall capture omitted task-local rule', { captureId: capture.id, candidateIndex: index });
        continue;
      }
      const quality = assessRecallCaptureCandidateQuality(candidate, evidenceMessages);
      // 归类校验：提示词要求模型按五类定义分类，运行时仍需兜底校验。命中 PRD
      // 明确排除的内容（项目事实当 personal、原文件当 template、能力自述当
      // skill_method）时降级为弱观察，不进 pending_review。
      const classification = assessRecallCandidateClassification(candidate);
      if (!classification.ok) {
        log.info('recall capture candidate misclassified', {
          captureId: capture.id,
          suggestedType: candidate.suggestedType,
          reasons: classification.blockingReasons,
        });
      }
      const retainForReview = classification.ok;
      const teachingSignals = activeTeachingSignals.filter((signal) => (
        evidenceMessages.some((message) => message.id === signal.messageId)
      ));
      if (quality.reviewable && teachingSignals.length) {
        const teachingCandidateIds = [...new Set(teachingSignals.flatMap((signal) => signal.candidateIds))];
        const existing = await Promise.all(teachingCandidateIds.map(async (candidateId) => {
          try { return await readRecallCandidate(userId, candidateId); }
          catch { return undefined; }
        }));
        const matching = existing.find((current) => current && (
          comparableCandidateText(current.judgment) === comparableCandidateText(candidate.judgment)
        ));
        if (matching) {
          const retainMatching = quality.reviewable
            && retainForReview
            && isAutoCaptureEligible(matching);
          if (retainMatching) {
            candidates.push(matching);
          }
          if (isAutoCaptureEligible(matching) || matching.status === 'confirmed') continue;
        }
      }
      const artifactRefs = evidenceMessages.flatMap((message) => message.artifacts.map((artifact) => ({
        kind: 'artifact_file' as const,
        subtype: 'artifact' as const,
        scope: 'conversation' as const,
        id: cognitionArtifactSourceId(artifact.conversationId || capture.conversationId, artifact.id),
        title: artifact.title,
      })));
      // 空间归属：捕获的会话属于哪个空间 → 候选带 spaceId（资产随 recall 全局，
      // 空间资产 tab 按 spaceId 过滤显示；空间可读全局资产但显示只显示本空间的）。
      const captureSpaceId = typeof (conversation as any)?.space_id === 'string'
        ? (conversation as any).space_id : undefined;
      try {
        const storedCandidate = await submitCognitionCandidate(userId, {
          judgment: candidate.judgment,
          value: candidate.value,
          summary: candidate.summary,
          ...(candidate.uncertainty ? { uncertainty: candidate.uncertainty } : {}),
          suggestedType: candidate.suggestedType,
          suggestedScope: candidate.suggestedScope,
          ...(candidate.suggestedAction ? { suggestedAction: candidate.suggestedAction } : {}),
          ...(candidate.risk ? { risk: candidate.risk } : {}),
          ...(candidate.targetAssetId ? { targetAssetId: candidate.targetAssetId } : {}),
          ...(candidate.applicableWhen ? { applicableWhen: candidate.applicableWhen } : {}),
          ...(candidate.forbiddenWhen ? { forbiddenWhen: candidate.forbiddenWhen } : {}),
          forceWeakObservation: !quality.reviewable || !classification.ok,
          captureKey: `capture-${capture.id}-${index}`,
          ...(captureSpaceId ? { spaceId: captureSpaceId } : {}),
          taskRunId: capture.terminalRunId,
          sourceRefs: [
            { kind: 'conversation', subtype: 'session', scope: 'conversation', id: capture.conversationId, title: conversation.title },
            ...evidenceMessages.map((message) => ({
              kind: 'conversation' as const,
              subtype: 'message' as const,
              scope: 'conversation' as const,
              id: cognitionMessageSourceId(capture.conversationId, message.id),
            })),
            ...artifactRefs,
          ],
        });
        if (quality.reviewable
          && retainForReview
          && (
            isAutoCaptureEligible(storedCandidate) || isSettledAutomaticCandidate(storedCandidate)
          )) {
          candidates.push(storedCandidate);
        }
      } catch (error) {
        const messageText = error instanceof Error ? error.message : String(error);
        // L3 敏感内容（凭据等）绝不落盘——闸门在 saveRecallCandidate 内部。
        // 这里只丢弃**这一条**候选并留痕，其余候选照常保存：此前直接把整次
        // 整理打成失败，重试又撞同一堵墙，会话永远整理不了（2026-09-21
        // 真机抓出：candidate_save_failed 背后是 credential_assignment）。
        if (messageText.includes('forbidden to persist')) {
          log.warn('recall capture candidate dropped (sensitive)', {
            capture_id: capture.id,
            candidate_index: index,
            error: messageText,
          });
          continue;
        }
        // 其他保存错误必须落日志：真实错误此前被整体吞掉，真机上只留下
        // candidate_save_failed 一个码，定位全靠猜。
        log.warn('recall capture candidate save threw', {
          capture_id: capture.id,
          candidate_index: index,
          suggested_type: candidate.suggestedType,
          error: messageText,
        });
        throw new CaptureFailure('candidate_save_failed', 'candidate could not be saved');
      }
    }

    const candidateIds = [...new Set([
      ...candidates.map((candidate) => candidate.id),
    ])];
    capture = await updateCapture(userId, id, (current) => current.status !== 'extracting'
      ? current
      : {
          ...current,
          candidateIds,
          updatedAt: new Date().toISOString(),
        });
    if (capture.status !== 'extracting' || signal?.aborted) return settleInterruptedCapture(userId, id);

    const finishedAt = new Date().toISOString();
    const modelUsage = extractionModelUsage;
    const hasQualifiedCandidates = candidateIds.length > 0;
    const hasReviewableCandidates = candidates.some((candidate) => (
      isAutoCaptureEligible(candidate)
    ));
    capture = await updateCapture(userId, id, (current) => current.status !== 'extracting'
      ? current
      : {
          ...current,
          status: hasReviewableCandidates ? 'review_ready' : hasQualifiedCandidates ? 'completed' : 'no_candidate',
          visibility: current.executionPolicy === 'manual' || hasQualifiedCandidates ? 'visible' : 'internal',
          screeningStatus: hasQualifiedCandidates ? 'qualified' : 'filtered',
          // 三分而不是二分：模型判空 / 模型给了但全被丢弃 / 给了且接住但下游筛掉。
          // 中间那档过去混在 model_no_candidate 里，让解析侧的丢弃伪装成"内容里
          // 确实没有"——实机上这两种的处置完全相反。
          filterReason: hasQualifiedCandidates
            ? undefined
            : parsed.length
              ? 'candidate_quality'
              : parseResult.emittedCount ? 'candidate_unparsable' : 'model_no_candidate',
          ...(parseResult.noCandidateReason && !hasQualifiedCandidates
            ? { noCandidateReason: parseResult.noCandidateReason }
            : {}),
          stage: undefined,
          autoWrite: undefined,
          candidateIds,
          errorCode: undefined,
          finishedAt,
          durationMs: durationSince(current.startedAt, finishedAt),
          ...(modelUsage ? { modelUsage } : {}),
          updatedAt: finishedAt,
        });
    if (capture.status === 'review_ready' || capture.status === 'no_candidate' || capture.status === 'completed') {
      void bumpRecallCaptureStats(userId, {
        extracted: 1,
        suggestions: candidateIds.length,
        ...(capture.status === 'review_ready' ? { reviewReady: 1 } : {}),
        ...(capture.status === 'no_candidate'
          ? {
            noCandidate: 1,
            ...(capture.filterReason ? { noCandidateReasons: { [capture.filterReason]: 1 } } : {}),
          }
          : {}),
      }).catch(() => {
        // 统计失败不影响结算主流程。
      });
    }
    captureControlRequests.delete(captureTaskKey(userId, id));
    return capture;
  } catch (error) {
    if (signal?.aborted) return settleInterruptedCapture(userId, id);
    const code = error instanceof CaptureFailure ? error.code : 'capture_failed';
    const status: RecallCaptureStatus = code === 'model_not_configured' || code === 'model_auth_required'
      ? 'configuration_required'
      : 'failed';
    log.warn('recall capture extraction failed', {
      capture_id: capture.id,
      conversation_id: capture.conversationId,
      error_code: code,
    });
    const finishedAt = new Date().toISOString();
    void bumpRecallCaptureStats(userId, {
      failures: { [code]: 1 },
    }).catch(() => {
      // 统计失败不影响失败结算主流程。
    });
    captureControlRequests.delete(captureTaskKey(userId, id));
    return updateCapture(userId, id, (current) => (current.status !== 'extracting' && current.status !== 'writing')
      ? current
      : {
          ...current,
          status,
          visibility: current.screeningStatus === 'qualified' ? 'visible' : current.visibility,
          errorCode: code,
          finishedAt,
          durationMs: durationSince(current.startedAt, finishedAt),
          updatedAt: finishedAt,
        });
  }
}

const scheduledCaptures = new Map<string, ScheduledBootBackgroundTask>();
const captureScheduleAdmissions = new Set<string>();
const manualCaptureRequests = new Map<string, Promise<RecallCaptureRecord>>();
let captureSchedulingEnabled = true;

function cancelScheduledCapture(userId: string, id: string): void {
  const key = captureTaskKey(userId, id);
  const task = scheduledCaptures.get(key);
  if (!task) return;
  scheduledCaptures.delete(key);
  task.cancel();
}

async function activateScheduledCapture(userId: string, id: string): Promise<RecallCaptureRecord> {
  let stored = await readRecallCapture(userId, id);
  const schedulableStatus = stored.status === 'waiting_quiet'
    || stored.status === 'scheduled'
    || (stored.status === 'waiting_completion' && stored.waitingCompletionReason === 'activity_changed');
  if (schedulableStatus) {
    if (stored.scheduledFor && Date.parse(stored.scheduledFor) > Date.now()) return stored;
    const rescheduleCheck = () => updateCapture(userId, id, (current) => ![
      'waiting_quiet', 'waiting_completion', 'scheduled',
    ].includes(current.status)
      ? current
      : {
          ...current,
          scheduledFor: new Date(Date.now() + 60_000).toISOString(),
          updatedAt: new Date().toISOString(),
        });
    if (!isQuiescent(userId, stored.conversationId)) return rescheduleCheck();

    let allMessages: GroupMessage[];
    try {
      allMessages = await chats.getMessages(userId, stored.conversationId, 2_000);
    } catch {
      return rescheduleCheck();
    }
    const latestMessage = allMessages.filter(isRecallConversationMessage).at(-1);
    const capturedLastMessageId = stored.messageIds.at(-1);
    const activityChanged = Boolean(latestMessage && latestMessage.id !== capturedLastMessageId);
    if (activityChanged || stored.waitingCompletionReason === 'activity_changed') {
      const selected = latestMessage
        ? selectCaptureMessages(
            allMessages,
            0,
            Number.MAX_SAFE_INTEGER,
            stored.anchorMessageId,
            latestMessage.id,
          )
        : [];
      const selectedLast = selected.at(-1);
      if (!selectedLast || selectedLast.role !== 'assistant') {
        return updateCapture(userId, id, (current) => ![
          'waiting_quiet', 'waiting_completion', 'scheduled',
        ].includes(current.status)
          ? current
          : {
              ...current,
              status: 'waiting_completion',
              waitingCompletionReason: 'activity_changed',
              messageIds: selected.length ? selected.map((message) => message.id) : current.messageIds,
              scheduledFor: new Date(Date.now() + 60_000).toISOString(),
              ...(latestMessage && isIsoTimestamp(latestMessage.ts) ? { lastActivityAt: latestMessage.ts } : {}),
              updatedAt: new Date().toISOString(),
            });
      }

      const activityAt = isIsoTimestamp(selectedLast.ts) ? new Date(selectedLast.ts) : new Date();
      const nextStatus: RecallCaptureStatus = stored.executionPolicy === 'nightly' ? 'scheduled' : 'waiting_quiet';
      const scheduledFor = stored.executionPolicy === 'nightly'
        ? nightlyScheduleAfterQuiet(
            activityAt,
            stored.quietMinutes || 10,
            stored.nightlyStart || '02:00',
            stored.nightlyEnd || '06:00',
          ).toISOString()
        : quietScheduleAt(activityAt, stored.quietMinutes || 10).toISOString();
      stored = await updateCapture(userId, id, (current) => ![
        'waiting_quiet', 'waiting_completion', 'scheduled',
      ].includes(current.status)
        ? current
        : {
            ...current,
            status: nextStatus,
            visibility: 'internal',
            screeningStatus: 'pending',
            screeningSignals: undefined,
            screenedAt: undefined,
            filterReason: undefined,
            waitingCompletionReason: undefined,
            messageIds: selected.map((message) => message.id),
            recallViewId: undefined,
            candidateIds: [],
            scheduledFor,
            lastActivityAt: selectedLast.ts,
            updatedAt: new Date().toISOString(),
          });
      return stored;
    }

    if (stored.status === 'waiting_completion') return stored;
    if (!latestMessage) return rescheduleCheck();

    if (stored.status === 'scheduled') {
      return updateCapture(userId, id, (current) => {
        if (current.status !== 'scheduled') return current;
        if (current.scheduledFor && Date.parse(current.scheduledFor) > Date.now()) return current;
        if (current.messageIds.at(-1) !== capturedLastMessageId) return current;
        const now = new Date();
        const nightlyStart = current.nightlyStart || '02:00';
        const nightlyEnd = current.nightlyEnd || '06:00';
        if (current.catchUpMissed === false && !isWithinNightlyWindow(now, nightlyStart, nightlyEnd)) {
          return {
            ...current,
            scheduledFor: nextNightlyRunAt(now, nightlyStart, nightlyEnd).toISOString(),
            updatedAt: now.toISOString(),
          };
        }
        return { ...current, status: 'queued', scheduledFor: undefined, updatedAt: now.toISOString() };
      });
    }

    return updateCapture(userId, id, (current) => {
      if (current.status !== 'waiting_quiet') return current;
      if (current.scheduledFor && Date.parse(current.scheduledFor) > Date.now()) return current;
      if (current.messageIds.at(-1) !== capturedLastMessageId) return current;
      return { ...current, status: 'queued', scheduledFor: undefined, updatedAt: new Date().toISOString() };
    });
  }
  return stored;
}

function scheduleKnownRecallCapture(userId: string, capture: RecallCaptureRecord): void {
  const schedulable = ['waiting_quiet', 'queued', 'scheduled'].includes(capture.status)
    || (
      capture.status === 'waiting_completion'
      && capture.waitingCompletionReason === 'activity_changed'
      && Boolean(capture.scheduledFor)
    );
  if (!captureSchedulingEnabled || !schedulable) return;
  const key = captureTaskKey(userId, capture.id);
  if (scheduledCaptures.has(key)) return;
  const delayMs = capture.status !== 'queued' && capture.scheduledFor
    ? Math.max(0, Date.parse(capture.scheduledFor) - Date.now())
    : 0;
  const task = scheduleBootBackground(`recall:capture:${capture.id}`, (signal) => (
    activateScheduledCapture(userId, capture.id)
      .then((activated) => activated.status === 'queued'
        ? runRecallCapture(userId, activated.id, signal).then(() => undefined)
        : undefined)
  ), delayMs, {
    resourceClass: 'model',
    // A user-triggered manual capture is an explicit request to start now.
    // Automatic quiet/nightly captures continue to yield to active work.
    preferIdle: capture.executionPolicy !== 'manual',
  });
  scheduledCaptures.set(key, task);
  void task.promise.finally(() => {
    if (scheduledCaptures.get(key) === task) scheduledCaptures.delete(key);
    if (!captureSchedulingEnabled) return;
    void readRecallCapture(userId, capture.id)
      .then((stored) => scheduleKnownRecallCapture(userId, stored))
      .catch(() => {
        // A removed or malformed capture cannot be rescheduled.
      });
  });
}

export function scheduleRecallCapture(userId: string, id: string): void {
  if (!captureSchedulingEnabled) return;
  const key = captureTaskKey(userId, id);
  if (scheduledCaptures.has(key) || captureScheduleAdmissions.has(key)) return;
  captureScheduleAdmissions.add(key);
  void readRecallCapture(userId, id)
    .then((capture) => scheduleKnownRecallCapture(userId, capture))
    .catch(() => {
      // A removed or malformed capture cannot be scheduled.
    })
    .finally(() => captureScheduleAdmissions.delete(key));
}

export async function queueRecallCaptureFromTerminal(
  event: TaskTerminalEvent,
): Promise<RecallCaptureRecord | undefined> {
  const sourceControl = await readCognitionSourceControl(event.user_id, {
    kind: 'conversation',
    id: event.conversation_id,
  });
  if (sourceControl && sourceControl.availability !== 'active') {
    log.info('recall terminal capture skipped: conversation source disabled', {
      conversation_id: event.conversation_id,
      run_id: event.run_id,
      availability: sourceControl.availability,
    });
    return undefined;
  }
  if (event.status !== 'completed') {
    const pending = await findMergeableAutomaticCapture(event.user_id, event.conversation_id);
    if (!pending) return undefined;
    cancelScheduledCapture(event.user_id, pending.id);
    const stored = await updateCapture(event.user_id, pending.id, (current) => {
      if (!MERGEABLE_AUTOMATIC_STATUSES.has(current.status)) return current;
      const waitingStatus = event.status === 'waiting_input' ? 'waiting_completion' : 'waiting_manual';
      const waitingCompletionReason = waitingStatus === 'waiting_completion'
        ? 'terminal_waiting_input' as const
        : undefined;
      const errorCode = event.status === 'failed'
        ? 'conversation_failed'
        : event.status === 'cancelled'
          ? 'conversation_cancelled'
          : undefined;
      if (current.status === 'paused') {
        return {
          ...current,
          resumeStatus: waitingStatus,
          scheduledFor: undefined,
          waitingCompletionReason,
          errorCode,
          updatedAt: new Date().toISOString(),
        };
      }
      return {
        ...current,
        status: waitingStatus,
        scheduledFor: undefined,
        waitingCompletionReason,
        errorCode,
        updatedAt: new Date().toISOString(),
      };
    });
    return stored;
  }

  const settings = await readRecallCaptureSettings(event.user_id);
  if (!settings.enabled) {
    log.info('recall terminal capture skipped: capture disabled', {
      conversation_id: event.conversation_id,
      run_id: event.run_id,
    });
    return undefined;
  }

  const messages = await chats.getMessages(event.user_id, event.conversation_id, 2_000);
  const mergeable = settings.executionPolicy === 'manual'
    ? undefined
    : await findMergeableAutomaticCapture(event.user_id, event.conversation_id);
  const selected = selectCaptureMessages(
    messages,
    event.started_at_ms,
    event.finished_at_ms,
    mergeable?.anchorMessageId || event.anchor_message_id,
    event.finished_message_id,
  );
  if (!selected.length) {
    log.warn('recall terminal capture skipped: no eligible messages', {
      conversation_id: event.conversation_id,
      run_id: event.run_id,
      anchor_message_id: event.anchor_message_id || '',
    });
    return undefined;
  }
  if (selected.at(-1)?.role !== 'assistant') {
    log.warn('recall terminal capture skipped: completed exchange has no assistant response', {
      conversation_id: event.conversation_id,
      run_id: event.run_id,
      selected_count: selected.length,
    });
    return undefined;
  }
  const requestedAnchorId = mergeable?.anchorMessageId || event.anchor_message_id;
  const anchor = requestedAnchorId
    ? selected.find((message) => message.id === requestedAnchorId && message.role === 'user')
    : [...selected].reverse().find((message) => message.role === 'user');
  if (!anchor) {
    log.warn('recall terminal capture skipped: user anchor missing', {
      conversation_id: event.conversation_id,
      run_id: event.run_id,
      anchor_message_id: event.anchor_message_id || '',
      selected_count: selected.length,
    });
    return undefined;
  }
  const id = mergeable?.id || captureId(event.conversation_id, anchor.id);
  const existing = await readRecallJsonRecord(event.user_id, CAPTURE_COLLECTION, id);
  if (existing) {
    const stored = asCapture(existing);
    const selectedIds = selected.map((message) => message.id);
    if (stored.terminalRunId === event.run_id && sameIds(stored.messageIds, selectedIds)) {
      scheduleKnownRecallCapture(event.user_id, stored);
      return stored;
    }
  }

  const nowDate = new Date();
  const now = nowDate.toISOString();
  const status: RecallCaptureStatus = settings.executionPolicy === 'manual'
    ? 'waiting_manual'
    : settings.executionPolicy === 'nightly'
      ? 'scheduled'
      : 'waiting_quiet';
  const scheduledFor = settings.executionPolicy === 'smart'
    ? quietScheduleAt(nowDate, settings.quietMinutes).toISOString()
    : settings.executionPolicy === 'nightly'
      ? nightlyScheduleAfterQuiet(
          nowDate,
          settings.quietMinutes,
          settings.nightlyStart,
          settings.nightlyEnd,
        ).toISOString()
      : undefined;
  const lastSelectedMessage = selected.at(-1);
  const lastActivityAt = lastSelectedMessage && isIsoTimestamp(lastSelectedMessage.ts)
    ? lastSelectedMessage.ts
    : now;
  const record: RecallCaptureRecord = {
    schemaVersion: 1,
    taxonomyVersion: 2,
    ownerId: event.user_id,
    id,
    conversationId: event.conversation_id,
    terminalRunId: event.run_id,
    anchorMessageId: anchor.id,
    messageIds: selected.map((message) => message.id),
    status,
    visibility: settings.executionPolicy === 'manual' ? 'visible' : 'internal',
    screeningStatus: settings.executionPolicy === 'manual' ? 'qualified' : 'pending',
    ...(settings.executionPolicy === 'manual' ? {
      screeningSignals: ['manual_selection' as const],
      screenedAt: now,
    } : {}),
    executionPolicy: settings.executionPolicy,
    ...(settings.executionPolicy !== 'manual' ? {
      quietMinutes: settings.quietMinutes,
      lastActivityAt,
    } : {}),
    ...(scheduledFor ? { scheduledFor } : {}),
    ...(settings.executionPolicy === 'nightly' ? {
      nightlyStart: settings.nightlyStart,
      nightlyEnd: settings.nightlyEnd,
      catchUpMissed: settings.catchUpMissed,
    } : {}),
    attempt: 1,
    candidateIds: [],
    createdAt: now,
    updatedAt: now,
  };
  const stored = asCapture(await updateRecallJsonRecord(
    event.user_id,
    CAPTURE_COLLECTION,
    id,
    (current) => {
      if (!current) return record;
      const capture = asCapture(current);
      const paused = capture.status === 'paused';
      return {
        ...capture,
        terminalRunId: event.run_id,
        anchorMessageId: anchor.id,
        messageIds: selected.map((message) => message.id),
        status: paused ? 'paused' : status,
        visibility: settings.executionPolicy === 'manual' ? 'visible' : 'internal',
        screeningStatus: settings.executionPolicy === 'manual' ? 'qualified' : 'pending',
        screeningSignals: settings.executionPolicy === 'manual' ? ['manual_selection'] : undefined,
        screenedAt: settings.executionPolicy === 'manual' ? now : undefined,
        filterReason: undefined,
        waitingCompletionReason: undefined,
        executionPolicy: settings.executionPolicy,
        quietMinutes: settings.executionPolicy === 'manual' ? undefined : settings.quietMinutes,
        lastActivityAt: settings.executionPolicy === 'manual' ? undefined : lastActivityAt,
        scheduledFor,
        nightlyStart: settings.executionPolicy === 'nightly' ? settings.nightlyStart : undefined,
        nightlyEnd: settings.executionPolicy === 'nightly' ? settings.nightlyEnd : undefined,
        catchUpMissed: settings.executionPolicy === 'nightly' ? settings.catchUpMissed : undefined,
        resumeStatus: paused ? status : undefined,
        errorCode: undefined,
        updatedAt: now,
      };
    },
  ));
  log.info('recall terminal capture task created', {
    conversation_id: event.conversation_id,
    run_id: event.run_id,
    capture_id: stored.id,
    status: stored.status,
    message_count: stored.messageIds.length,
  });
  cancelScheduledCapture(event.user_id, stored.id);
  scheduleKnownRecallCapture(event.user_id, stored);
  return stored;
}

const MANUAL_TAKEOVER_STATUSES = new Set<RecallCaptureStatus>([
  'waiting_quiet',
  'waiting_completion',
  'waiting_manual',
  'scheduled',
  'queued',
  'paused',
  'cancelled',
]);

function canConvertToWaitingManual(capture: RecallCaptureRecord): boolean {
  return MANUAL_TAKEOVER_STATUSES.has(capture.status)
    && capture.candidateIds.length === 0
    && capture.writingCandidateId === undefined
    && capture.stage === undefined
    && capture.startedAt === undefined
    && capture.autoWrite !== true;
}

function makeWaitingManual(
  capture: RecallCaptureRecord,
  finishedAt: string,
  now: string,
): RecallCaptureRecord {
  if (!canConvertToWaitingManual(capture)) return capture;
  return {
    ...capture,
    status: 'waiting_manual',
    visibility: 'visible',
    screeningStatus: 'qualified',
    screeningSignals: ['manual_selection'],
    screenedAt: now,
    filterReason: undefined,
    waitingCompletionReason: undefined,
    stage: undefined,
    executionPolicy: 'manual',
    quietMinutes: undefined,
    scheduledFor: undefined,
    nightlyStart: undefined,
    nightlyEnd: undefined,
    catchUpMissed: undefined,
    resumeStatus: undefined,
    lastActivityAt: finishedAt,
    autoWrite: undefined,
    errorCode: undefined,
    recoveredAt: undefined,
    finishedAt: undefined,
    durationMs: undefined,
    modelUsage: undefined,
    updatedAt: now,
  };
}

async function queueManualRecallCaptureRequest(
  userId: string,
  conversationId: string,
): Promise<RecallCaptureRecord> {
  const sourceControl = await readCognitionSourceControl(userId, {
    kind: 'conversation',
    id: conversationId,
  });
  if (sourceControl && sourceControl.availability !== 'active') {
    throw new Error(sourceControl.availability === 'removed'
      ? 'conversation source was removed from Recall'
      : 'conversation source is paused');
  }
  const conversation = await chats.getConversation(userId, conversationId);
  if (!conversation) throw new Error('conversation not found');

  const messages = await chats.getMessages(userId, conversationId, 2_000);
  const eligible = messages.filter(isRecallConversationMessage);
  const firstUser = eligible.find((message) => message.from === 'user');
  const finished = eligible.at(-1);
  if (!firstUser || !finished) throw new Error('conversation has no completed exchange');

  const selected = selectCaptureMessages(
    messages,
    0,
    Number.MAX_SAFE_INTEGER,
    firstUser.id,
    finished.id,
  );
  if (!selected.length || selected.at(-1)?.role !== 'assistant') {
    throw new Error('conversation is still waiting for a response');
  }

  const settings = await readRecallCaptureSettings(userId);
  if (!settings.enabled) throw new Error('recall capture is disabled');

  const baseId = manualConversationCaptureId(conversationId, finished.id);
  let id = baseId;
  const exact = await readRecallJsonRecord(userId, CAPTURE_COLLECTION, baseId);
  if (exact) {
    const stored = await migrateLegacyHistoricalAutomaticWait(userId, asCapture(exact));
    if (stored.status === 'waiting_manual') return stored;
    // Preserve a completed task that already owns candidates. A second manual
    // selection is only a re-extraction when the prior extraction produced no
    // candidates; otherwise it would hide the existing review work behind a
    // duplicate capture record.
    if (stored.status === 'completed' && stored.candidateIds.length > 0) return stored;
    const canRetryAfterExtraction = ['no_candidate', 'completed'].includes(stored.status);
    if (!canRetryAfterExtraction) {
      if (!canConvertToWaitingManual(stored)) return stored;
      cancelScheduledCapture(userId, stored.id);
      const now = new Date().toISOString();
      return updateCapture(userId, stored.id, (current) => makeWaitingManual(current, finished.ts, now));
    }
    id = manualConversationCaptureId(conversationId, finished.id, randomUUID());
  }

  let covering: RecallCaptureRecord | undefined;
  for (const candidate of await listAllRecallCaptures(userId)) {
    if (candidate.conversationId !== conversationId || !candidate.messageIds.includes(finished.id)) continue;
    const migrated = await migrateLegacyHistoricalAutomaticWait(userId, candidate);
    if (migrated.status === 'cancelled') continue;
    if (['no_candidate', 'completed'].includes(migrated.status)) continue;
    if (migrated.status === 'no_candidate' && migrated.visibility === 'internal') continue;
    covering = migrated;
    break;
  }
  if (covering) {
    if (covering.status === 'waiting_manual') return covering;
    if (!canConvertToWaitingManual(covering)) return covering;
    cancelScheduledCapture(userId, covering.id);
    const now = new Date().toISOString();
    return updateCapture(userId, covering.id, (current) => makeWaitingManual(current, finished.ts, now));
  }

  const now = new Date().toISOString();
  const record: RecallCaptureRecord = {
    schemaVersion: 1,
    taxonomyVersion: 2,
    ownerId: userId,
    id,
    conversationId,
    conversationTitle: conversation.title,
    terminalRunId: `manual-${id.slice('rcap-'.length)}`,
    anchorMessageId: firstUser.id,
    messageIds: selected.map((message) => message.id),
    status: 'waiting_manual',
    visibility: 'visible',
    screeningStatus: 'qualified',
    screeningSignals: ['manual_selection'],
    screenedAt: now,
    executionPolicy: 'manual',
    lastActivityAt: finished.ts,
    attempt: 1,
    candidateIds: [],
    createdAt: now,
    updatedAt: now,
  };
  const stored = asCapture(await updateRecallJsonRecord(
    userId,
    CAPTURE_COLLECTION,
    id,
    (current) => current || record,
  ));
  log.info('manual historical recall capture task created', {
    conversation_id: conversationId,
    capture_id: stored.id,
    message_count: stored.messageIds.length,
  });
  return stored;
}

export function queueManualRecallCaptureFromConversation(
  userId: string,
  conversationId: string,
): Promise<RecallCaptureRecord> {
  if (!safeId(conversationId)) return Promise.reject(new Error('invalid conversation id'));
  const key = `${userId}:${conversationId}`;
  const inFlight = manualCaptureRequests.get(key);
  if (inFlight) return inFlight;

  let request: Promise<RecallCaptureRecord>;
  request = queueManualRecallCaptureRequest(userId, conversationId).finally(() => {
    if (manualCaptureRequests.get(key) === request) manualCaptureRequests.delete(key);
  });
  manualCaptureRequests.set(key, request);
  return request;
}

/**
 * Backwards-compatible name for the old historical-auto IPC channel.
 * Selecting a past conversation must never invoke the model or write an
 * asset. It only creates the visible `waiting_manual` task; the explicit
 * `runNow` action is the sole admission point for extraction.
 */
export function startHistoricalRecallCapture(
  userId: string,
  conversationId: string,
): Promise<RecallCaptureRecord> {
  return queueManualRecallCaptureFromConversation(userId, conversationId);
}

export async function promoteRecallCaptureCandidate(
  userId: string,
  candidateId: string,
  options: { riskAcknowledged?: boolean; profileTarget?: PersonalProfileTarget; forceCreateSimilar?: boolean; confirmBaselineVersion?: string } = {},
): Promise<RecallCaptureCandidatePromotion> {
  if (!safeId(candidateId)) throw new Error('invalid recall candidate id');
  const similarRetry = options.forceCreateSimilar === true ? { forceCreateSimilar: true } : {};
  // 版本冲突后的显式重锚（specs/015 US-702，`contracts/ipc.md` §二）：本层只是
  // 把调用方声明的基线转发下去，不做任何版本判定——判定在
  // `updateAbilityAsset` 的锁内（唯一一处）。
  const rebase = options.confirmBaselineVersion ? { confirmBaselineVersion: options.confirmBaselineVersion } : {};
  const capture = (await listAllRecallCaptures(userId)).find((item) => item.candidateIds.includes(candidateId));
  if (!capture) {
    // 用户确认提升 → actor 必须为 user（promoteRecallCandidate 强制校验；此前漏传导致 IPC 提升一直失败）
    const promoted = await promoteRecallCandidate(userId, candidateId, { actor: 'user', riskAcknowledged: options.riskAcknowledged, ...similarRetry, ...rebase, ...(options.profileTarget ? { profileTarget: options.profileTarget } : {}) });
    await prepareSkillDraftForPromotedAsset(userId, promoted);
    return promoted;
  }

  await updateCapture(userId, capture.id, (current) => {
    if (!current.candidateIds.includes(candidateId)) throw new Error('candidate does not belong to recall capture');
    if (current.status === 'writing') throw recallCandidateError('recall_capture_writing', 'recall capture is already writing');
    if (current.status !== 'review_ready') {
      throw recallCandidateError('recall_capture_not_review_ready', 'recall capture is not ready for review');
    }
    return {
      ...current,
      status: 'writing',
      stage: 'asset_write',
      writingCandidateId: candidateId,
      errorCode: undefined,
      updatedAt: new Date().toISOString(),
    };
  });

  try {
    const promoted = await promoteRecallCandidate(userId, candidateId, { actor: 'user', riskAcknowledged: options.riskAcknowledged, ...similarRetry, ...rebase, ...(options.profileTarget ? { profileTarget: options.profileTarget } : {}) });
    await prepareSkillDraftForPromotedAsset(userId, promoted);
    await updateCapture(userId, capture.id, (current) => (
      current.status === 'writing' && current.writingCandidateId === candidateId
        ? {
            ...current,
            status: 'review_ready',
            stage: undefined,
            writingCandidateId: undefined,
            errorCode: undefined,
            updatedAt: new Date().toISOString(),
          }
        : current
    ));
    return promoted;
  } catch (error) {
    await updateCapture(userId, capture.id, (current) => (
      current.status === 'writing' && current.writingCandidateId === candidateId
        ? {
            ...current,
            status: 'review_ready',
            stage: undefined,
            writingCandidateId: undefined,
            errorCode: 'asset_write_failed',
            updatedAt: new Date().toISOString(),
          }
        : current
    ));
    throw error;
  }
}

export async function retryRecallCapture(userId: string, id: string): Promise<RecallCaptureRecord> {
  const capture = await updateCapture(userId, id, async (current) => {
    let retryable = current.status === 'failed' || current.status === 'configuration_required';
    if (current.status === 'review_ready' || current.status === 'completed') {
      const [workflow] = await summarizeRecallCaptures(userId, [current]);
      retryable = workflow.workflowStatus === 'failed' && workflow.reviewSummary.missing > 0;
    }
    if (!retryable) {
      throw new Error('recall capture is not retryable');
    }
    return {
      ...current,
      status: 'queued',
      stage: undefined,
      attempt: current.attempt + 1,
      errorCode: undefined,
      recoveredAt: undefined,
      startedAt: undefined,
      finishedAt: undefined,
      durationMs: undefined,
      modelUsage: undefined,
      updatedAt: new Date().toISOString(),
    };
  });
  scheduleRecallCapture(userId, capture.id);
  return capture;
}

export async function pauseRecallCapture(userId: string, id: string): Promise<RecallCaptureRecord> {
  const key = captureTaskKey(userId, id);
  const capture = await updateCapture(userId, id, (current) => {
    if (!['waiting_quiet', 'waiting_completion', 'waiting_manual', 'scheduled', 'queued', 'extracting'].includes(current.status)) {
      throw new Error('recall capture is not pausable');
    }
    if (current.status === 'extracting' && current.stage === 'candidate_save') {
      throw new Error('recall capture is finalizing candidates');
    }
    const resumeStatus: NonNullable<RecallCaptureRecord['resumeStatus']> = current.status === 'extracting'
      ? 'queued'
      : current.status as NonNullable<RecallCaptureRecord['resumeStatus']>;
    if (current.status === 'extracting') captureControlRequests.set(key, 'pause');
    return {
      ...current,
      status: 'paused',
      stage: undefined,
      resumeStatus,
      updatedAt: new Date().toISOString(),
    };
  });
  cancelScheduledCapture(userId, id);
  return capture;
}

export async function resumeRecallCapture(userId: string, id: string): Promise<RecallCaptureRecord> {
  const key = captureTaskKey(userId, id);
  const capture = await updateCapture(userId, id, (current) => {
    if (current.status !== 'paused') throw new Error('recall capture is not paused');
    let status = current.resumeStatus || 'queued';
    let scheduledFor = current.scheduledFor;
    if (status === 'scheduled' && (!scheduledFor || Date.parse(scheduledFor) <= Date.now())) {
      scheduledFor = current.catchUpMissed === false
        ? nextNightlyRunAt(
            new Date(),
            current.nightlyStart || '02:00',
            current.nightlyEnd || '06:00',
          ).toISOString()
        : new Date().toISOString();
    }
    if (status === 'waiting_quiet' && !scheduledFor) {
      scheduledFor = quietScheduleAt(new Date(), current.quietMinutes || 10).toISOString();
    }
    if (
      status === 'waiting_completion'
      && current.waitingCompletionReason === 'activity_changed'
      && !scheduledFor
    ) {
      scheduledFor = new Date(Date.now() + 60_000).toISOString();
    }
    const keepsSchedule = status === 'waiting_quiet'
      || status === 'scheduled'
      || (status === 'waiting_completion' && current.waitingCompletionReason === 'activity_changed');
    return {
      ...current,
      status,
      scheduledFor: keepsSchedule ? scheduledFor : undefined,
      resumeStatus: undefined,
      updatedAt: new Date().toISOString(),
    };
  });
  captureControlRequests.delete(key);
  scheduleKnownRecallCapture(userId, capture);
  return capture;
}

export async function cancelRecallCapture(userId: string, id: string): Promise<RecallCaptureRecord> {
  const key = captureTaskKey(userId, id);
  const finishedAt = new Date().toISOString();
  const capture = await updateCapture(userId, id, (current) => {
    if (current.status === 'writing') throw new Error('recall capture is writing an approved candidate');
    if (['review_ready', 'no_candidate', 'completed', 'cancelled'].includes(current.status)) {
      throw new Error('recall capture is terminal');
    }
    if (current.status === 'extracting' && current.stage === 'candidate_save') {
      throw new Error('recall capture is finalizing candidates');
    }
    if (current.status === 'extracting') captureControlRequests.set(key, 'cancel');
    return {
      ...current,
      status: 'cancelled',
      stage: undefined,
      resumeStatus: undefined,
      errorCode: undefined,
      finishedAt,
      durationMs: durationSince(current.startedAt, finishedAt),
      updatedAt: finishedAt,
    };
  });
  cancelScheduledCapture(userId, id);
  return capture;
}

export async function runRecallCaptureNow(userId: string, id: string): Promise<RecallCaptureRecord> {
  const key = captureTaskKey(userId, id);
  const stored = await readRecallCapture(userId, id);
  const sourceControl = await readCognitionSourceControl(userId, {
    kind: 'conversation',
    id: stored.conversationId,
  });
  if (sourceControl && sourceControl.availability !== 'active') {
    const errorCode = sourceControl.availability === 'removed' ? 'source_removed' : 'source_paused';
    const paused = await updateCapture(userId, id, (current) => {
      // Another worker may have claimed the task between the read and this
      // preflight. Never overwrite an active extraction or a terminal result.
      if (['extracting', 'writing', 'review_ready', 'completed', 'no_candidate', 'cancelled'].includes(current.status)) {
        return current;
      }
      const now = new Date().toISOString();
      const resumableStatus: NonNullable<RecallCaptureRecord['resumeStatus']> = [
        'waiting_quiet', 'waiting_completion', 'waiting_manual', 'scheduled', 'queued',
      ].includes(current.status)
        ? current.status as NonNullable<RecallCaptureRecord['resumeStatus']>
        : 'queued';
      return {
        ...current,
        status: 'paused',
        stage: undefined,
        resumeStatus: resumableStatus,
        errorCode,
        updatedAt: now,
      };
    });
    cancelScheduledCapture(userId, id);
    return paused;
  }
  if (stored.status === 'waiting_completion') {
    throw new Error('recall capture conversation is not complete');
  }
  const capture = await updateCapture(userId, id, (current) => {
    if (current.status === 'queued' || current.status === 'extracting') return current;
    if (![
      'waiting_quiet', 'waiting_manual', 'scheduled', 'paused', 'failed', 'configuration_required',
    ].includes(current.status)) {
      throw new Error('recall capture cannot run now');
    }
    const retrying = current.status === 'failed' || current.status === 'configuration_required';
    return {
      ...current,
      status: 'queued',
      stage: undefined,
      resumeStatus: undefined,
      scheduledFor: undefined,
      waitingCompletionReason: undefined,
      attempt: retrying ? current.attempt + 1 : current.attempt,
      errorCode: undefined,
      recoveredAt: undefined,
      startedAt: undefined,
      finishedAt: undefined,
      durationMs: undefined,
      modelUsage: undefined,
      updatedAt: new Date().toISOString(),
    };
  });
  captureControlRequests.delete(key);
  cancelScheduledCapture(userId, id);
  scheduleRecallCapture(userId, id);
  return capture;
}

async function batchRecallCaptureControl(
  userId: string,
  captureIds: string[],
  control: (userId: string, id: string) => Promise<RecallCaptureRecord>,
): Promise<RecallCaptureBatchResult> {
  const succeeded: string[] = [];
  const failed: Array<{ id: string; error: string }> = [];
  // 逐条复用单条状态机（retry / runNow 的全部前置检查与副作用原样生效）；
  // 单条失败（不可重试 / 不可立即运行 / 已被并发改动）只记录结果，不中断
  // 也不回滚其余条目。串行执行：控制写盘有读-改-写竞态，并发批量放大会
  // 互相踩 updateCapture。
  for (const id of [...new Set(captureIds)]) {
    try {
      await control(userId, id);
      succeeded.push(id);
    } catch (error) {
      failed.push({ id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { succeeded, failed };
}

/** 批量重试：只对确实失败 / 待配置的记录生效（retryRecallCapture 自校验）。 */
export function retryRecallCapturesBatch(userId: string, captureIds: string[]): Promise<RecallCaptureBatchResult> {
  return batchRecallCaptureControl(userId, captureIds, retryRecallCapture);
}

/** 批量立即整理：每次都是一次模型额度消耗，入口方（IPC/前端）必须先让用户
 *  确认具体条数；这里不做二次确认，只保证逐条状态机语义。 */
export function runRecallCapturesNowBatch(userId: string, captureIds: string[]): Promise<RecallCaptureBatchResult> {
  return batchRecallCaptureControl(userId, captureIds, runRecallCaptureNow);
}

export async function recoverRecallCaptures(userId: string): Promise<number> {
  const captures = await listAllRecallCaptures(userId);
  let recovered = 0;
  for (const item of captures) {
    let capture = await migrateLegacyHistoricalAutomaticWait(userId, item);
    if (capture.status === 'writing') {
      const recoveredAt = new Date().toISOString();
      capture = await updateCapture(userId, capture.id, (current) => ({
        ...current,
        status: current.autoWrite ? 'failed' : 'review_ready',
        stage: undefined,
        writingCandidateId: undefined,
        errorCode: 'asset_write_interrupted',
        recoveredAt,
        updatedAt: recoveredAt,
      }));
    }
    if (capture.status === 'extracting' || capture.status === 'queued') {
      const recoveredAt = new Date().toISOString();
      capture = await updateCapture(userId, capture.id, (current) => ({
        ...current,
        status: 'queued',
        stage: undefined,
        errorCode: undefined,
        recoveredAt,
        updatedAt: recoveredAt,
      }));
    }
    if (capture.status === 'waiting_completion' && !capture.waitingCompletionReason) {
      try {
        const latestMessage = (await chats.getMessages(userId, capture.conversationId, 2_000))
          .filter(isRecallConversationMessage)
          .at(-1);
        if (latestMessage && latestMessage.id !== capture.messageIds.at(-1)) {
          const recoveredAt = new Date().toISOString();
          capture = await updateCapture(userId, capture.id, (current) => (
            current.status !== 'waiting_completion' || current.waitingCompletionReason
              ? current
              : {
                  ...current,
                  waitingCompletionReason: 'activity_changed',
                  scheduledFor: recoveredAt,
                  recoveredAt,
                  updatedAt: recoveredAt,
                }
          ));
        }
      } catch {
        // Keep an ambiguous legacy wait untouched until its conversation is readable.
      }
    }
    if (
      capture.status === 'waiting_completion'
      && capture.waitingCompletionReason === 'activity_changed'
      && !capture.scheduledFor
    ) {
      const recoveredAt = new Date().toISOString();
      capture = await updateCapture(userId, capture.id, (current) => (
        current.status !== 'waiting_completion' || current.waitingCompletionReason !== 'activity_changed'
          ? current
          : {
              ...current,
              scheduledFor: recoveredAt,
              recoveredAt,
              updatedAt: recoveredAt,
            }
      ));
    }
    const schedulable = capture.status === 'queued'
      || capture.status === 'waiting_quiet'
      || capture.status === 'scheduled'
      || (
        capture.status === 'waiting_completion'
        && capture.waitingCompletionReason === 'activity_changed'
        && Boolean(capture.scheduledFor)
      );
    if (schedulable) {
      scheduleKnownRecallCapture(userId, capture);
      recovered += 1;
    }
  }
  return recovered;
}

type TerminalSubscribe = (listener: TaskTerminalListener) => () => void;

// ── 夜间增量清扫（U01）──────────────────────────────────────────────────────
// 终态事件建 capture 是主触发；本清扫是兜底：夜间窗口内对「基线之后有更新」
// 的会话做增量排队，活跃会话延后，失败有限重试，忽略与完成都记扫描水位，
// 避免每晚重扫同一批内容。新基线只向前看，不回扫全部历史。
const SWEEP_COLLECTION = 'capture-sweep';
const NIGHTLY_SWEEP_ID = 'nightly';
const NIGHTLY_SWEEP_TICK_MS = 15 * 60_000;
const NIGHTLY_AUTO_RETRY_ATTEMPT_LIMIT = 3;

export type RecallNightlySweepCursorState = 'covered' | 'ignored' | 'failed' | 'deferred';

export interface RecallNightlySweepCursor {
  state: RecallNightlySweepCursorState;
  throughMessageId?: string;
  throughTs?: string;
  errorCode?: string;
  updatedAt: string;
}

export interface RecallNightlySweepResult {
  ranForWindow: string;
  finishedAt: string;
  scanned: number;
  queued: number;
  deferred: number;
  retried: number;
  skipped: number;
  failed: number;
  error?: string;
}

export interface RecallNightlySweepRecord extends RecallJsonRecord {
  id: typeof NIGHTLY_SWEEP_ID;
  baselineAt: string;
  cursors: Record<string, RecallNightlySweepCursor>;
  lastRunAt?: string;
  lastResult?: RecallNightlySweepResult;
  consecutiveErrors?: number;
}

export type RecallNightlySweepRun = RecallNightlySweepResult & { ran: true } | { ran: false; reason: string };

function asSweepCursor(value: unknown): RecallNightlySweepCursor {
  const raw = (value || {}) as Partial<RecallNightlySweepCursor>;
  const state: RecallNightlySweepCursorState = raw.state === 'covered' || raw.state === 'ignored'
    || raw.state === 'failed' || raw.state === 'deferred' ? raw.state : 'deferred';
  return {
    state,
    ...(typeof raw.throughMessageId === 'string' ? { throughMessageId: raw.throughMessageId } : {}),
    ...(typeof raw.throughTs === 'string' ? { throughTs: raw.throughTs } : {}),
    ...(typeof raw.errorCode === 'string' ? { errorCode: raw.errorCode } : {}),
    updatedAt: typeof raw.updatedAt === 'string' && isIsoTimestamp(raw.updatedAt) ? raw.updatedAt : new Date().toISOString(),
  };
}

function asSweepRecord(value: RecallJsonRecord): RecallNightlySweepRecord {
  const raw = value as unknown as Partial<RecallNightlySweepRecord>;
  const cursors: Record<string, RecallNightlySweepCursor> = {};
  if (raw.cursors && typeof raw.cursors === 'object') {
    for (const [cid, cursor] of Object.entries(raw.cursors)) cursors[cid] = asSweepCursor(cursor);
  }
  return {
    ...value,
    id: NIGHTLY_SWEEP_ID,
    baselineAt: typeof raw.baselineAt === 'string' && isIsoTimestamp(raw.baselineAt)
      ? raw.baselineAt : new Date().toISOString(),
    cursors,
    ...(raw.lastRunAt ? { lastRunAt: raw.lastRunAt } : {}),
    ...(raw.lastResult ? { lastResult: raw.lastResult } : {}),
    ...(typeof raw.consecutiveErrors === 'number' ? { consecutiveErrors: raw.consecutiveErrors } : {}),
  } as RecallNightlySweepRecord;
}

async function readNightlySweepRecord(userId: string): Promise<RecallNightlySweepRecord | undefined> {
  const stored = await readRecallJsonRecord(userId, SWEEP_COLLECTION, NIGHTLY_SWEEP_ID);
  return stored ? asSweepRecord(stored) : undefined;
}

export async function readRecallNightlySweep(userId: string): Promise<RecallNightlySweepRecord | undefined> {
  return readNightlySweepRecord(userId);
}

function minuteOfDayValue(value: string): number {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

function mostRecentWindowStart(now: Date, nightlyStart: string, nightlyEnd: string): Date {
  const start = minuteOfDayValue(nightlyStart);
  const candidate = new Date(now);
  candidate.setHours(Math.floor(start / 60), start % 60, 0, 0);
  if (candidate.getTime() > now.getTime()) candidate.setDate(candidate.getDate() - 1);
  return candidate;
}

function windowEndFromStart(start: Date, nightlyStart: string, nightlyEnd: string): Date {
  const startMinute = minuteOfDayValue(nightlyStart);
  const endMinute = minuteOfDayValue(nightlyEnd);
  const lengthMinutes = (endMinute - startMinute + 24 * 60) % (24 * 60) || 24 * 60;
  return new Date(start.getTime() + lengthMinutes * 60_000);
}

/** 当前时刻应补跑哪个夜间窗口：窗口内跑当窗；错过且 catchUpMissed 补最近一个
 *  已结束窗口；应用未运行/休眠时不假装完成，恢复可运行后续办。 */
function dueNightlyWindow(
  now: Date,
  settings: RecallCaptureSettingsRecord,
  record: RecallNightlySweepRecord | undefined,
): string | undefined {
  const { nightlyStart, nightlyEnd } = settings;
  const inWindow = isWithinNightlyWindow(now, nightlyStart, nightlyEnd);
  const recentStart = mostRecentWindowStart(now, nightlyStart, nightlyEnd);
  if (!inWindow && !settings.catchUpMissed) return undefined;
  if (!inWindow && now.getTime() < windowEndFromStart(recentStart, nightlyStart, nightlyEnd).getTime()) return undefined;
  const windowKey = recentStart.toISOString();
  if (record?.lastResult?.ranForWindow === windowKey) return undefined;
  return windowKey;
}

function sweepTailMessages(
  messages: GroupMessage[],
  cursor: RecallNightlySweepCursor | undefined,
  baselineMs: number,
): GroupMessage[] {
  if (!cursor) return messages.filter((message) => timestampMs(message.ts) >= baselineMs);
  if (cursor.throughMessageId) {
    const index = messages.findIndex((message) => message.id === cursor.throughMessageId);
    if (index >= 0) return messages.slice(index + 1);
  }
  if (cursor.throughTs) {
    const through = Date.parse(cursor.throughTs);
    if (!Number.isNaN(through)) return messages.filter((message) => timestampMs(message.ts) > through);
  }
  return messages.slice();
}

function nightSweepRunId(ranForWindow: string): string {
  return `nightly-sweep-${ranForWindow.replace(/[^0-9A-Za-z-]/g, '')}`;
}

const nightlySweepsInFlight = new Set<string>();

export async function runNightlyCaptureSweep(
  userId: string,
  ranForWindow: string,
  settings: RecallCaptureSettingsRecord,
): Promise<RecallNightlySweepRun> {
  if (nightlySweepsInFlight.has(userId)) return { ran: false, reason: 'sweep_in_flight' };
  nightlySweepsInFlight.add(userId);
  const startedAt = new Date().toISOString();
  let counters = { scanned: 0, queued: 0, deferred: 0, retried: 0, skipped: 0, failed: 0 };
  let failure: string | undefined;
  try {
    const [conversations, captures] = await Promise.all([
      chats.listConversations(userId),
      listAllRecallCaptures(userId),
    ]);
    const capturesByConversation = new Map<string, RecallCaptureRecord[]>();
    for (const capture of captures) {
      const list = capturesByConversation.get(capture.conversationId) || [];
      list.push(capture);
      capturesByConversation.set(capture.conversationId, list);
    }
    // 先建基线再扫：首轮基线=现在，之前的会话一律不动（不回扫历史）。
    const sweep = asSweepRecord(await updateRecallJsonRecord(userId, SWEEP_COLLECTION, NIGHTLY_SWEEP_ID, (current) => {
      if (current) return current;
      return {
        schemaVersion: 1,
        ownerId: userId,
        id: NIGHTLY_SWEEP_ID,
        baselineAt: startedAt,
        cursors: {},
      } as RecallJsonRecord;
    }));
    const baselineMs = Date.parse(sweep.baselineAt);
    const cursors: Record<string, RecallNightlySweepCursor> = { ...sweep.cursors };
    const ordered = [...conversations].sort((left, right) => String(left.updated_at).localeCompare(String(right.updated_at)));
    for (const conversation of ordered) {
      counters.scanned += 1;
      const cid = conversation.conversation_id;
      const cursor = cursors[cid];
      const conversationUpdatedMs = Date.parse(String(conversation.updated_at));
      if (cursor?.throughTs && !Number.isNaN(conversationUpdatedMs)
        && conversationUpdatedMs <= Date.parse(cursor.throughTs)) {
        counters.skipped += 1;
        continue;
      }
      if (!cursor && !Number.isNaN(conversationUpdatedMs) && conversationUpdatedMs < baselineMs) {
        counters.skipped += 1;
        continue;
      }
      const sourceControl = await readCognitionSourceControl(userId, { kind: 'conversation', id: cid });
      if (sourceControl && sourceControl.availability !== 'active') {
        cursors[cid] = {
          state: 'ignored',
          ...(isIsoTimestamp(String(conversation.updated_at)) ? { throughTs: String(conversation.updated_at) } : {}),
          updatedAt: startedAt,
        };
        counters.skipped += 1;
        continue;
      }
      if (!isQuiescent(userId, cid)) {
        // 活跃对话延后：不推进水位，下轮再扫。
        cursors[cid] = { ...(cursor || { state: 'deferred' as const }), state: 'deferred', updatedAt: startedAt };
        counters.deferred += 1;
        continue;
      }
      let messages: GroupMessage[];
      try {
        messages = (await chats.getMessages(userId, cid, 2_000)).filter(isRecallConversationMessage);
      } catch {
        // 会话暂不可读：不推进水位，留待下轮。
        cursors[cid] = { ...(cursor || { state: 'deferred' as const }), state: 'deferred', updatedAt: startedAt };
        counters.deferred += 1;
        continue;
      }
      const latest = messages.at(-1);
      if (!latest) {
        cursors[cid] = {
          state: 'ignored',
          ...(isIsoTimestamp(String(conversation.updated_at)) ? { throughTs: String(conversation.updated_at) } : {}),
          updatedAt: startedAt,
        };
        counters.skipped += 1;
        continue;
      }
      // 覆盖同一最新消息的捕获优先判定：失败/待配置的覆盖捕获要先走
      // 有限重试（cursor 命中短路会让失败的覆盖捕获永远轮不到重试）。
      const covering = (capturesByConversation.get(cid) || [])
        .find((capture) => capture.messageIds.at(-1) === latest.id);
      if (covering) {
        if (covering.status === 'failed' || covering.status === 'configuration_required') {
          if ((covering.attempt || 1) < NIGHTLY_AUTO_RETRY_ATTEMPT_LIMIT) {
            const retriedAt = new Date().toISOString();
            await updateCapture(userId, covering.id, (current) => (
              current.status !== 'failed' && current.status !== 'configuration_required'
            ) ? current : {
              ...current,
              status: 'queued',
              stage: undefined,
              resumeStatus: undefined,
              scheduledFor: undefined,
              waitingCompletionReason: undefined,
              attempt: (current.attempt || 1) + 1,
              errorCode: undefined,
              recoveredAt: undefined,
              startedAt: undefined,
              finishedAt: undefined,
              durationMs: undefined,
              modelUsage: undefined,
              updatedAt: retriedAt,
            });
            scheduleRecallCapture(userId, covering.id);
            counters.retried += 1;
          } else {
            cursors[cid] = {
              state: 'failed',
              throughMessageId: latest.id,
              ...(isIsoTimestamp(latest.ts) ? { throughTs: latest.ts } : {}),
              errorCode: covering.errorCode || 'capture_failed',
              updatedAt: startedAt,
            };
            counters.failed += 1;
            continue;
          }
        } else {
          cursors[cid] = {
            state: 'covered',
            throughMessageId: latest.id,
            ...(isIsoTimestamp(latest.ts) ? { throughTs: latest.ts } : {}),
            updatedAt: startedAt,
          };
          counters.skipped += 1;
          continue;
        }
      } else if (cursor?.throughMessageId === latest.id) {
        // 无覆盖捕获但水位已到最新（如捕获记录被清理）：记 covered 即可。
        cursors[cid] = {
          state: 'covered',
          throughMessageId: latest.id,
          ...(isIsoTimestamp(latest.ts) ? { throughTs: latest.ts } : {}),
          updatedAt: startedAt,
        };
        counters.skipped += 1;
        continue;
      } else {
        const tail = sweepTailMessages(messages, cursor, baselineMs);
        const anchor = tail.find((message) => message.from === 'user');
        const selected = anchor
          ? selectCaptureMessages(messages, 0, Number.MAX_SAFE_INTEGER, anchor.id, latest.id)
          : [];
        if (!selected.length || selected.at(-1)?.role !== 'assistant' || !anchor) {
          // 尾部没有完整问答（如停在用户消息）：延后，不动水位。
          cursors[cid] = { ...(cursor || { state: 'deferred' as const }), state: 'deferred', updatedAt: startedAt };
          counters.deferred += 1;
          continue;
        }
        const mergeable = (capturesByConversation.get(cid) || []).find((capture) => (
          (capture.executionPolicy === 'smart' || capture.executionPolicy === 'nightly')
          && MERGEABLE_AUTOMATIC_STATUSES.has(capture.status)
        ));
        const nowDate = new Date();
        const now = nowDate.toISOString();
        const scheduledFor = nightlyScheduleAfterQuiet(
          new Date(isIsoTimestamp(latest.ts) ? latest.ts : now),
          settings.quietMinutes,
          settings.nightlyStart,
          settings.nightlyEnd,
        ).toISOString();
        const lastActivityAt = isIsoTimestamp(latest.ts) ? latest.ts : now;
        if (mergeable) {
          await updateCapture(userId, mergeable.id, (current) => !MERGEABLE_AUTOMATIC_STATUSES.has(current.status)
            ? current
            : {
              ...current,
              terminalRunId: nightSweepRunId(ranForWindow),
              anchorMessageId: anchor.id,
              messageIds: selected.map((message) => message.id),
              status: 'scheduled',
              screeningStatus: 'pending',
              screeningSignals: undefined,
              screenedAt: undefined,
              filterReason: undefined,
              waitingCompletionReason: undefined,
              scheduledFor,
              lastActivityAt,
              resumeStatus: current.status === 'paused' ? 'scheduled' as const : undefined,
              errorCode: undefined,
              updatedAt: now,
            });
          cancelScheduledCapture(userId, mergeable.id);
          const refreshed = await readRecallCapture(userId, mergeable.id);
          scheduleKnownRecallCapture(userId, refreshed);
        } else {
          const record: RecallCaptureRecord = {
            schemaVersion: 1,
            taxonomyVersion: 2,
            ownerId: userId,
            id: captureId(cid, anchor.id),
            conversationId: cid,
            ...(conversation.title ? { conversationTitle: conversation.title } : {}),
            terminalRunId: nightSweepRunId(ranForWindow),
            anchorMessageId: anchor.id,
            messageIds: selected.map((message) => message.id),
            status: 'scheduled',
            visibility: 'internal',
            screeningStatus: 'pending',
            executionPolicy: settings.executionPolicy,
            quietMinutes: settings.quietMinutes,
            lastActivityAt,
            scheduledFor,
            nightlyStart: settings.nightlyStart,
            nightlyEnd: settings.nightlyEnd,
            catchUpMissed: settings.catchUpMissed,
            attempt: 1,
            candidateIds: [],
            createdAt: now,
            updatedAt: now,
          };
          const stored = asCapture(await updateRecallJsonRecord(userId, CAPTURE_COLLECTION, record.id, (current) => {
            if (!current) return record;
            const existing = asCapture(current);
            if (sameIds(existing.messageIds, record.messageIds)) return existing;
            return { ...existing, ...record, id: existing.id, createdAt: existing.createdAt };
          }));
          log.info('recall nightly sweep capture created', {
            conversation_id: cid,
            capture_id: stored.id,
            window: ranForWindow,
            message_count: stored.messageIds.length,
          });
          scheduleKnownRecallCapture(userId, stored);
        }
        counters.queued += 1;
      }
      // 扫描水位推进到最新消息；失败语义由 capture 记录自身携带（有限重试）。
      cursors[cid] = {
        state: 'covered',
        throughMessageId: latest.id,
        ...(isIsoTimestamp(latest.ts) ? { throughTs: latest.ts } : {}),
        updatedAt: startedAt,
      };
    }
    const result: RecallNightlySweepResult = {
      ranForWindow,
      finishedAt: new Date().toISOString(),
      ...counters,
    };
    await updateRecallJsonRecord(userId, SWEEP_COLLECTION, NIGHTLY_SWEEP_ID, (current) => {
      const base = asSweepRecord(current || {
        schemaVersion: 1,
        ownerId: userId,
        id: NIGHTLY_SWEEP_ID,
        baselineAt: startedAt,
        cursors: {},
      } as RecallJsonRecord);
      return {
        ...base,
        cursors,
        lastRunAt: result.finishedAt,
        lastResult: result,
        consecutiveErrors: 0,
      } as RecallJsonRecord;
    });
    const statsDelta: RecallCaptureStatsDelta = {
      sweeps: 1,
      conversationsScanned: counters.scanned,
      retried: counters.retried,
    };
    await bumpRecallCaptureStats(userId, statsDelta).catch((error) => {
      log.warn('recall capture stats update failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
    return { ran: true, ...result };
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
    log.warn('recall nightly sweep failed', { window: ranForWindow, error: failure });
    await updateRecallJsonRecord(userId, SWEEP_COLLECTION, NIGHTLY_SWEEP_ID, (current) => {
      const base = asSweepRecord(current || {
        schemaVersion: 1,
        ownerId: userId,
        id: NIGHTLY_SWEEP_ID,
        baselineAt: startedAt,
        cursors: {},
      } as RecallJsonRecord);
      return {
        ...base,
        lastRunAt: startedAt,
        consecutiveErrors: (base.consecutiveErrors || 0) + 1,
        lastResult: {
          ranForWindow,
          finishedAt: new Date().toISOString(),
          scanned: counters.scanned,
          queued: counters.queued,
          deferred: counters.deferred,
          retried: counters.retried,
          skipped: counters.skipped,
          failed: counters.failed,
          error: failure,
        },
      } as RecallJsonRecord;
    }).catch(() => {
      // 水位写失败时下一轮重扫：宁可重扫不可漏扫。
    });
    return {
      ran: true,
      ranForWindow,
      finishedAt: new Date().toISOString(),
      ...counters,
      error: failure,
    };
  } finally {
    nightlySweepsInFlight.delete(userId);
  }
}

export interface RecallCaptureSweepLoopHandle {
  stop(): void;
}

/** 夜间清扫循环：低频自续期，只在应跑窗口跑一次（窗口内当窗，错过补最近），
 *  其余 tick 只做廉价判定。配置缺失/禁用/非 nightly 时静默不动。 */
export function startNightlyCaptureSweepLoop(userId: string): RecallCaptureSweepLoopHandle {
  let scheduled: ScheduledBootBackgroundTask | null = null;
  let stopped = false;
  const scheduleNext = (delayMs: number): void => {
    scheduled = scheduleBootBackground('recall:nightly-sweep', async (signal) => {
      if (stopped || signal?.aborted) return;
      try {
        const settings = await readRecallCaptureSettings(userId);
        if (!settings.enabled || settings.executionPolicy !== 'nightly') return;
        // 连续失败熔断：3 次后当天不再重试，等下一个窗口。
        const record = await readNightlySweepRecord(userId);
        if ((record?.consecutiveErrors || 0) >= 3 && record?.lastRunAt
          && Date.now() - Date.parse(record.lastRunAt) < 24 * 60 * 60_000) return;
        const windowKey = dueNightlyWindow(new Date(), settings, record);
        if (!windowKey) return;
        await runNightlyCaptureSweep(userId, windowKey, settings);
      } catch (error) {
        log.warn('recall nightly sweep tick failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }, delayMs, { resourceClass: 'disk', preferIdle: true, maxSliceMs: 20_000 });
    void scheduled.promise.finally(() => {
      scheduled = null;
      if (!stopped) scheduleNext(NIGHTLY_SWEEP_TICK_MS);
    });
  };
  scheduleNext(0);
  return {
    stop() {
      stopped = true;
      scheduled?.cancel();
      scheduled = null;
    },
  };
}


export interface RecallCaptureOrchestratorRuntime {
  subscribe?: TerminalSubscribe;
  queue?: (event: TaskTerminalEvent) => Promise<RecallCaptureRecord | undefined>;
}

/** 自动创建口径（2026-09-15 两度拍板的终态）：
 *  - smart（任务一结束就整理）保持下线——判断不成熟，手动整理为主；
 *  - nightly（夜间自动沉淀）由用户在「沉淀设置」里显式开启：仅当
 *    enabled && executionPolicy==='nightly' 时，任务终态才创建 scheduled
 *    整理任务（scheduledFor=所选夜间时间），到点由既有定时器执行；
 *    产出走「先问我」（开启时联动 reviewPolicy=manual，见渲染层）。 */
async function terminalCaptureEnabledFor(userId: string): Promise<boolean> {
  try {
    const settings = await readRecallCaptureSettings(userId);
    return settings.enabled && settings.executionPolicy === 'nightly';
  } catch {
    return false;
  }
}

export function startRecallCaptureOrchestrator(
  runtime: RecallCaptureOrchestratorRuntime = {},
): () => void {
  captureSchedulingEnabled = true;
  const subscribe = runtime.subscribe || subscribeTaskTerminals;
  const queue = runtime.queue || queueRecallCaptureFromTerminal;
  const unsubscribe = subscribe((event) => {
    void (async () => {
      if (!await terminalCaptureEnabledFor(event.user_id)) return;
      await queue(event);
    })().catch(() => {
      log.warn('recall terminal capture queue failed', {
        conversation_id: event.conversation_id,
        run_id: event.run_id,
      });
    });
  });
  return () => {
    captureSchedulingEnabled = false;
    unsubscribe();
    for (const task of scheduledCaptures.values()) task.cancel();
    scheduledCaptures.clear();
    captureScheduleAdmissions.clear();
    manualCaptureRequests.clear();
    captureControlRequests.clear();
  };
}
