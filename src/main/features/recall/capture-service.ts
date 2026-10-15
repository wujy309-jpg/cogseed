import { queuedNightlyFeedback, feedbackObservation, admitNightlyFeedback, type NightlyFeedbackObservation } from './nightly-feedback';
import { withCaptureModelBudget } from './capture-model-budget';
import { isContentCategory, type CognitionContentCategory } from './content-category';
import { parseFormationProposalEnvelope } from './formation-proposal';
import { captureValueJudgmentInput, parseCaptureValueJudgment, type CaptureValueJudgment } from './capture-value-judgment';
import { captureSummaryDecisionDigest } from './capture-provenance';
import { CaptureGroundingUnavailableError, semanticallyGroundCaptureCandidate } from './capture-grounding';
import { assessRecallCaptureUncertainty, type CaptureUncertaintyAssessment } from './capture-uncertainty';
import { selectCaptureExistingAssets, type CaptureExistingAssetsResult } from './capture-existing-assets';
import { readOntologyDocument } from '../cognition/ontology/service';
import {
  buildOntologyFormationContext, buildSourceQualifiedOntologyFormationContext, ontologyFormationPromptContract, parseOntologyFormationProposal, validateOntologyFormationScope,
} from './ontology-formation';
import {
  summarizeCaptureContext, captureContextSourceDigest, validateCaptureContextSummary,
  CaptureContextInterruptedError, type CaptureContextCheckpoint, type CaptureContextSummary,
} from './capture-context-summary';
import { nonRetainableActivityContent } from './activity-projection';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { createLogger } from '../../logger';
import { prompts } from '../../prompts/loader';
import { assertNotForbiddenToPersist } from '../../util/cognition-sensitivity';
import { runRecallCaptureModel } from './capture-model-routing';
import { safeId } from '../../storage';
import { scheduleBootBackground, type ScheduledBootBackgroundTask } from '../../util/boot_init';
import { getConfiguredModelOAuthExpiredMessage, getConfiguredModelOAuthExpiredMessageForUser, hasConfiguredModel, hasConfiguredModelForUser } from '../auth';
import * as chats from '../chats';
import { run as runCliAgent } from '../local_agents/runner';
import { detectAll } from '../local_agents/registry';
import type { ReviewDecision } from '../cognition/review-decision';
import { getRecallCandidateCapabilities, recallCandidateError, type RecallCandidateCapabilities } from './candidate-capabilities';
import { normalizeAssetScopeValue } from './scope-policy';
import type { PersonalProfileSyncResult, PersonalProfileTarget } from './personal-profile-sync';
import {
  isQuiescent,
} from '../group_chat/bus';
import { readMembers } from '../group_chat/state';
import type { GroupMessage } from '../group_chat/visibility';
import { readAbilityAsset } from './asset-service';
import {
  isAutoCaptureEligible,
  confirmRecallOntologyCandidate,
  promoteRecallCandidate,
  readRecallAssetHandoffReceipt,
  readRecallCandidate,
  type AbilityAssetType,
  type RecallAssetHandoffReceipt,
  type RecallAbilityAssetRecord,
  type RecallCandidateRecord,
  type RecallCandidateStatus,
  type RecallOntologyCandidateConfirmation,
} from './candidate-service';
import { submitCognitionCandidate } from '../cognition/candidate-submission';
import { recallJsonRecordPath } from './paths';
import { notifyCognitionWrite } from './store-events';
import type { CognitionSourceRef } from './source-service';
import {
  cognitionArtifactSourceId,
  cognitionMessageSourceId,
  listCognitionSources,
} from './source-catalog';
import { readCognitionSourceControl } from './source-control';
import { createRecallView, isRecallViewExpired, readRecallView, type RecallViewRecord } from './recall-view-service';
import {
  readRecallJsonRecord,
  updateRecallJsonRecord,
} from './store';
import type { RecallJsonRecord } from './types';
import { listUserTeachingSignals } from './teaching-service';
import {
  isWithinNightlyWindow,
  readRecallCaptureSettings,
  captureAutoApprovalAuthorization,
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
  isRecallCaptureCandidateGrounded,
  isTaskLocalRuleProposal,
  screenRecallCaptureValue,
  type RecallCaptureFilterReason,
  type RecallCaptureValueSignal,
} from './capture-value-screening';
import { isRecallAssistantMessage, isRecallConversationMessage } from './conversation-message-policy';

const log = createLogger('recall.capture');
const CAPTURE_COLLECTION = 'captures';
const MAX_MODEL_CANDIDATES = 64;
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
  | 'context_summary'
  | 'value_judgment'
  | 'model_check'
  | 'recall_view'
  | 'model_extraction'
  | 'candidate_save'
  | 'asset_write';

export interface RecallCaptureModelUsage {
  provider?: string;
  model?: string;
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
  /** Earlier messages used only to understand this day's new content. */
  contextMessageIds?: string[];
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
  autoApprovalEpoch?: string;
  autoApprovalEnabledAt?: string;
  recallViewId?: string;
  errorCode?: string;
  recoveredAt?: string;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  modelUsage?: RecallCaptureModelUsage;
  extractionRepairAttempted?: boolean;
  /** Source-bound semantic observations; no raw conversation or effect proof. */
  uncertaintyAssessments?: Array<CaptureUncertaintyAssessment & { candidateIndex: number }>;
  /** Evaluation availability is separate from an explicit unsupported verdict.
   * These observations carry no source text or publication authority. */
  candidateSupportUnavailable?: Array<{ candidateIndex: number; stage: 'grounding' | 'uncertainty'; reason: string; candidateHash: string }>;
  candidateSupportUnavailableCount?: number;
  valueJudgment?: CaptureValueJudgment;
  contextSummary?: CaptureContextSummary;
  summaryCheckpoint?: CaptureContextCheckpoint;
  extractionCompletedAt?: string;
  feedbackRevision?: string;
  feedbackObservations?: NightlyFeedbackObservation[];
  reviewDay?: string;
  /** Absolute admission boundaries survive timezone changes and later retries. */
  reviewDayStart?: string;
  reviewDayEnd?: string;
  lastAttemptReviewDay?: string;
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

export type RecallCaptureAction = 'review_candidates' | 'view_assets' | 'open_conversation';

export interface RecallCaptureReviewSummary {
  total: number;
  pending: number;
  deferred: number;
  promoted: number;
  rejected: number;
  missing: number;
}

export type RecallCaptureNextAction = 'review_candidates' | 'view_assets' | 'none';

/** Only a completed concrete proposal can require user attention. Background
 * diagnostics stay silent; historical completed records remain readable. */
export type RecallCaptureBucket = 'attention' | 'active' | 'silent' | 'done';

export function captureBucket(capture: Pick<RecallCaptureRecord, 'status'>): RecallCaptureBucket {
  if (capture.status === 'no_candidate') return 'done';
  if (capture.status === 'review_ready') return 'attention';
  if (['failed', 'configuration_required', 'paused', 'waiting_manual'].includes(capture.status)) return 'silent';
  if (['completed', 'cancelled'].includes(capture.status)) return 'done';
  return 'active';
}

/** Background diagnostics have no candidate/asset joins and never become a
 * user-managed task. Internal empty results also avoid reading legacy IDs. */
function isSilentCapture(capture: RecallCaptureRecord): boolean {
  return capture.visibility === 'internal' && (!capture.candidateIds.length || capture.status === 'no_candidate');
}

/** 候选投影（P-r1-55，2026-10-02 数据层修）：summarize 全量读池后内联进
 *  workflow 记录的展示形状——渲染层候选队列（review-queue 视图）只含最近
 *  5 条处理记录，旧任务详情按 candidateIds join 队列全落空，「整理结果」
 *  被误报成空态。字段=整理详情「整理结果」区实际消费的白名单（标题兜底
 *  链、证据 chips、pending 过滤所需的 capabilities），与 confirmedAssetReceipts
 *  同一先例：详情页展示数据随 workflow 记录下发，不依赖队列窗口。 */
export interface RecallCaptureCandidateOutcome {
  proposalTarget?: RecallCandidateRecord['proposalTarget'];
  automaticUndo?: RecallCandidateRecord['automaticUndo'];
  id: string;
  status: RecallCandidateStatus;
  summary: string;
  judgment: string;
  contentCategory?: import('./content-category').StoredCognitionContentCategory;
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
  observations?: NightlyFeedbackObservation[];
  label: string;
  id: string;
  ts: string;
  role: 'user' | 'assistant';
  text: string;
  discovery?: boolean;
  artifacts: Array<{ id: string; title: string; conversationId: string }>;
}

interface ParsedCandidate {
  proposalTarget?: 'cognition' | 'ontology' | 'joint';
  formationProposalId?: string;
  judgment: string;
  value: string;
  valueProvided: boolean;
  summary: string;
  uncertainty?: string;
  contentCategory?: CognitionContentCategory;
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
  ontologyChanges?: unknown;
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
  return value === 'context_summary' || value === 'value_judgment' || value === 'model_check'
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
  for (const key of ['provider', 'model'] as const) {
    if (typeof raw[key] === 'string' && raw[key].trim()) usage[key] = raw[key].trim().slice(0, 200);
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
    || (value.contextMessageIds !== undefined && (!Array.isArray(value.contextMessageIds)
      || value.contextMessageIds.some(id => typeof id !== 'string')))
    || ((value.reviewDayStart !== undefined || value.reviewDayEnd !== undefined)
      && (!isIsoTimestamp(value.reviewDayStart) || !isIsoTimestamp(value.reviewDayEnd)
        || Date.parse(value.reviewDayStart) >= Date.parse(value.reviewDayEnd)))
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
  const visibility = !value.candidateIds.length && !['completed', 'cancelled'].includes(status)
    ? 'internal' : isCaptureVisibility(value.visibility) ? value.visibility : legacyVisible ? 'visible' : 'internal';
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

function timestampMs(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function truncateText(value: string, max: number): string {
  const text = value.trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(1, max - 1))}…`;
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
  // Source selection never applies a model budget. The summary stage submits
  // every character in bounded slices, including long intermediate responses.
  return inRun.map((message, index) => {
    return {
      label: `m${index + 1}`,
      id: message.id,
      ts: message.ts,
      role: isRecallAssistantMessage(message) ? 'assistant' : 'user',
      text: message.text,
      artifacts: (message.artifacts || []).slice(0, 10).map((artifact) => ({
        id: artifact.id,
        title: artifact.title,
        conversationId: artifact.source_cid || '',
      })),
    };
  });
}

function boundedRequiredText(value: unknown, field: string, max: number, preserveParagraphs = false): string {
  if (typeof value !== 'string') throw new CaptureFailure('invalid_model_output', `missing ${field}`);
  const text = preserveParagraphs ? value.replace(/\r\n?/g, '\n').trim() : value.replace(/\s+/g, ' ').trim();
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
  if (Object.hasOwn(parsed, 'proposalVersion') || Object.hasOwn(parsed, 'proposals')) {
    try {
      const envelope = parseFormationProposalEnvelope(parsed, validLabels);
      return { emittedCount: envelope.proposals.length,
        candidates: envelope.proposals.map(proposal => {
          const body = proposal.target === 'ontology'
            ? { ...proposal.explanation, judgment: proposal.explanation.description, suggestedAction: 'create' }
            : proposal.cognition;
          const candidate = parseOneCandidate({ ...body,
            ...(proposal.target !== 'cognition' ? { ontologyChanges: proposal.ontologyChanges } : {}) }, validLabels);
          return { ...candidate, proposalTarget: proposal.target, formationProposalId: proposal.id };
        }), ...(envelope.reason ? { noCandidateReason: envelope.reason } : {}) };
    } catch { throw new CaptureFailure('invalid_model_output', 'invalid versioned formation proposal'); }
  }
  // A sibling plan has no candidate owner. Neither singleton assignment nor
  // dropping it can establish a complete jointly reviewed proposal; the
  // existing bounded extraction repair must regenerate the full response.
  if ((parsed as { ontologyChanges?: unknown }).ontologyChanges != null) {
    throw new CaptureFailure('invalid_model_output', 'ontologyChanges must belong inside its candidate');
  }
  const candidates = (parsed as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates) || candidates.length > MAX_MODEL_CANDIDATES) {
    throw new CaptureFailure('invalid_model_output', 'invalid candidate count');
  }

  // 逐候选容错：LLM 输出里单个候选字段非法（如缺少正文或证据）
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
    judgment: boundedRequiredText(candidate.judgment, 'judgment', 4_000, true),
    value: valueProvided ? boundedRequiredText(candidate.value, 'value', 1_000) : '',
    valueProvided,
    summary: boundedRequiredText(candidate.summary, 'summary', 1_000),
    ...(uncertainty ? { uncertainty } : {}),
    // New formation has one content contract. Old model labels are ignored;
    // an update's historical type is resolved from its actual target by the host.
    // A bad browsing label cannot discard otherwise supported cognition.
    contentCategory: isContentCategory(candidate.contentCategory) ? candidate.contentCategory : 'unclassified',
    suggestedType: 'cognition',
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
    ...(candidate.ontologyChanges === undefined ? {} : { ontologyChanges: candidate.ontologyChanges }),
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
    'Cognition is an understanding formed through exchange, thinking or practice that influences later understanding, judgment or action. Before proposing an asset, identify its specific understanding, concrete future use, original support and limits; resembling a template, rule or experience never grants admission. Facts can still qualify when they guide future understanding or action. A method remains cognition: never convert, link or generate an executable skill. Do not use tools.',
    'You prepare complete, source-grounded understandings and practices for the user to review and retain for future use. Keep storage type cognition; after extracting each complete item propose its contentCategory for browsing.',
    'Return exactly one JSON object and no markdown or commentary.',
    'Read the entire bounded run before deciding candidates; the first user message provides context only and must not dominate what you extract.',
    'The context summary preserves the whole daily conversation, including later corrections, conditions and unresolved questions. Use it together with the original messages or labeled source excerpts. Never restore a superseded claim. Only form conclusions supported by approvedEvidence; the other material provides context, not approval to extract unrelated topics.',
    'A useful understanding can concern the user, other people, a project, a concept, a relationship, a goal, or a judgment. A useful practice can include a method, ordered steps, a reusable structure, or evaluation criteria. Meaningful experience keeps the relevant situation, observed result, lesson and limits; it is not merely a usage count or a success claim. These are possible contents, not required sections for every item. Propose contentCategory only after reading the complete content; it is browsing metadata independent of storage type and does not decide value or eligibility.',
    `Return {"proposalVersion":2,"proposals":[...]}, up to ${MAX_MODEL_CANDIDATES} independently decidable groups. Each group has a unique safe ASCII id and target "cognition", "ontology" or "joint". Do not stop after the first three. When nothing durable is supported, return an empty proposals array and a short reason.`,
    'A cognition group contains cognition:{judgment,value,summary,contentCategory,suggestedScope,suggestedAction,risk,evidence,applicableWhen?,forbiddenWhen?,uncertainty?,targetAssetId?}. A joint group contains the same cognition object plus its own ontologyChanges. An ontology-only group contains explanation:{description,value,summary,suggestedScope,risk,evidence,applicableWhen?,forbiddenWhen?,uncertainty?} plus nonempty ontologyChanges.actions. explanation describes the actual supported change, its future use and limits; it is not cognition and will not become a cognition asset. Do not invent a reusable insight merely to retain a new object or fact. Omit absent optional properties. Each dependent change must be inside the same group; do not use cross-group dependencies.',
    'Every candidate must cite at least one approved user message label from newly discovered content. Greetings, status checks, repeated queries and the mere completion or failure of one operation are not candidates. A failed operation may still yield a supported, bounded lesson; preserve that lesson without inventing causes or successful verification.',
    'Do not invent a new person or project for each mention, equate people by shared names, infer authority from roles, or widen a project-specific requirement to every project. Preserve exact subjects, time, conditions and uncertainty. Do not claim to have created ontology records or executable skills; this stage only prepares reviewable content.',
    'When a statement contains relative time ("last week", "from next quarter"), anchor it against the message timestamp and write the resolved absolute date into judgment; never store a bare relative phrase.',
    'Preserve explicit negation and reversal. Distinguish an earlier mistake from a later real-world change. A historical statement alone does not establish the current state; when the current state is not supplied, retain that uncertainty instead of inventing the opposite preference.',
    'When the conversation corrects or refines an existing asset (see "existingAssets" in the input), use suggestedAction "update" with its targetAssetId. Write judgment as a merged revision that keeps still-valid content and replaces only what the evidence corrects. Do not create a competing duplicate to avoid revising the existing content. If the target identity or change is not sufficiently supported, omit that proposal. Do not update merely because an existing understanding was repeated.',
    'existingAssetsCoverage describes the bounded comparison selection from the readable active pool. When truncated or unavailable is nonzero, absence from existingAssets is not proof that no matching asset exists. Never invent a target identity or claim a complete duplicate/conflict check from this partial context.',
    'When the conversation states a change of an assignment or value ("X changed from A to B"), record B as the current state and note the superseded prior state A inside judgment.',
    'Only retain supported content that improves a later understanding, decision or action. One meaningful item should occur once; do not split or duplicate it merely to satisfy a classification system.',
    prompts.load('recall_candidate_contract'),
    ontologyFormationPromptContract,
  ].join('\n\n');
}

function extractionInput(
  conversationTitle: string,
  messages: CapturePromptMessage[],
  recallView: RecallViewRecord,
  existingAssets: Array<{ id: string; title: string; statement: string; type: string; scope: string; version: string }> = [],
  summary?: CaptureContextSummary,
  approvedEvidence: CaptureValueJudgment['evidence'] = [],
  ontology?: ReturnType<typeof buildOntologyFormationContext>,
  sourceScope?: { projectId?: string; workspaceId?: string },
  existingAssetsCoverage?: CaptureExistingAssetsResult['coverage'],
): string {
  const envelope = {
    conversation: { title: conversationTitle },
    ...(summary ? { summary: summary.topics, approvedEvidence } : {}),
    ...(existingAssets.length ? { existingAssets } : {}),
    ...(existingAssetsCoverage ? { existingAssetsCoverage } : {}),
    ...(ontology ? { existingOntology: ontology } : {}),
    ...(sourceScope ? { sourceScope } : {}),
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
  };
  const sourceMessage = (message: CapturePromptMessage) => ({
      label: message.label,
      id: message.id,
      role: message.role,
      discovery: message.discovery !== false,
      ts: message.ts,
      text: message.text,
      ...(message.observations?.length ? { observations: message.observations } : {}),
      ...(message.artifacts.length
        ? { artifacts: message.artifacts.map(({ id, title }) => ({ id, title })) }
        : {}),
    });
  const full = JSON.stringify({ ...envelope, messages: messages.map(sourceMessage) });
  const budget = 96_000;
  if (full.length <= budget) return full;
  // Full context has already been summarized. For oversized extraction inputs,
  // carry every summary topic plus bounded original passages for all evidence,
  // including corrections and conditions, not just the positively judged quote.
  const evidence = [...(summary?.topics.flatMap(topic => topic.evidence) || []), ...approvedEvidence];
  const excerpts = messages.flatMap(message => {
    const ranges = evidence.filter(item => item.messageId === message.id).map(item => {
      const located = 'start' in item && typeof item.start === 'number'
        && message.text.slice(item.start, item.start + item.quote.length) === item.quote
        ? item.start : message.text.indexOf(item.quote);
      if (located < 0) throw new CaptureFailure('source_unavailable', 'extraction evidence missing');
      return { start: Math.max(0, located - 400), end: Math.min(message.text.length, located + item.quote.length + 400) };
    }).sort((a, b) => a.start - b.start);
    const spans: Array<{ start: number; end: number }> = [];
    for (const range of ranges) {
      const previous = spans.at(-1);
      if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
      else spans.push({ ...range });
    }
    return spans.length ? [{ ...sourceMessage(message), excerpt: true, sourceSpans: spans,
      text: spans.map(span => message.text.slice(span.start, span.end)).join('\n\n[...other source passages omitted; use the complete context summary...]\n\n') }] : [];
  });
  const bounded = JSON.stringify({ ...envelope, messages: excerpts });
  if (!excerpts.length || bounded.length > budget) throw new CaptureFailure('extraction_context_too_large', 'complete evidence cannot fit extraction input');
  return bounded;
}

/** CLI-based extraction fallback for recall capture when no CogSeed model is
 *  configured. Mirrors onboarding's `cognition_extraction.ts`: pick an
 *  installed/authenticated local CLI (claude preferred, else first available),
 *  dispatch a one-shot print-mode turn with the extraction prompt + input, and
 *  return the CLI's final text. Returns null when no CLI is usable. */
/** Same channel selection as the extraction runner; never infer outage from a failed read. */
export async function readRecallCaptureModelRuntime(userId?: string) {
  const apiConfigured = (userId ? hasConfiguredModelForUser(userId) : hasConfiguredModel()).configured || Boolean(process.env.ANTHROPIC_API_KEY);
  const authorizationRequired = apiConfigured && Boolean(userId
    ? getConfiguredModelOAuthExpiredMessageForUser(userId) : getConfiguredModelOAuthExpiredMessage());
  if (apiConfigured) return { runtimeStatus: 'known' as const, apiConfigured, available: !authorizationRequired,
    channel: authorizationRequired ? 'unavailable' as const : 'api' as const, authorizationRequired };
  try {
    const entries = await detectAll();
    const available = entries.filter(entry => entry?.available);
    const chosen = available.find(entry => entry.type === 'claude') || available[0];
    return { runtimeStatus: 'known' as const, apiConfigured: false, cliAvailable: Boolean(chosen), available: Boolean(chosen),
      channel: chosen ? 'cli' as const : 'unavailable' as const, cliAgentId: chosen?.type, cliAuthenticated: chosen?.auth?.loggedIn,
      authorizationRequired: false, cliAuthorizationRequired: chosen?.auth?.loggedIn === false };
  } catch (error) {
    return { runtimeStatus: 'unknown' as const, apiConfigured: false, available: undefined, channel: undefined,
      runtimeError: String((error as Error).message).slice(0, 300) };
  }
}

async function extractCaptureViaCli(
  userId: string, capture: RecallCaptureRecord, conversation: Awaited<ReturnType<typeof chats.getConversation>>,
  promptMessages: CapturePromptMessage[], recallView: RecallViewRecord, signal: AbortSignal | undefined,
  existingAssets: CaptureExistingAssetsResult['assets'],
  ontology?: ReturnType<typeof buildOntologyFormationContext>,
  existingAssetsCoverage?: CaptureExistingAssetsResult['coverage'],
  repairInstruction?: string,
): Promise<string | null> {
  const entries = await detectAll();
  const available = entries.filter(entry => entry && entry.available);
  if (!available.length) return null;
  const chosen = available.find(entry => entry.type === 'claude') ?? available[0];
  const input = extractionInput(conversation?.title || capture.conversationTitle || '', promptMessages, recallView, existingAssets,
    capture.contextSummary, capture.valueJudgment?.evidence, ontology, {
      ...(conversation.project_id ? { projectId: conversation.project_id } : {}),
      ...(conversation.space_id ? { workspaceId: conversation.space_id } : {}),
    }, existingAssetsCoverage);
  const prompt = `${extractionSystemPrompt()}${repairInstruction ? `\n\n${repairInstruction}` : ''}\n\nAnalyze the bounded conversation JSON below.\n\n## Conversation JSON\n${input}`;
  const controller = new AbortController();
  const relayAbort = (): void => controller.abort();
  signal?.addEventListener('abort', relayAbort, { once: true });
  if (signal?.aborted) controller.abort();
  try {
    const result = await withCaptureModelBudget(userId, { jobId: capture.id, stage: 'extraction' }, prompt.length, () => runCliAgent({ uid: userId, cid: capture.conversationId,
      agentId: 'recall-capture-extractor', agentName: 'Capture Extractor', cli: chosen.type,
      prompt, cwd: os.tmpdir(), signal: controller.signal, skipDispatchCheck: true, onEvent: () => {} }));
    if (signal?.aborted) return null;
    if (result.status !== 'completed' || typeof result.output !== 'string' || !result.output.trim()) {
      log.warn('recall capture CLI extraction did not complete', {
        conversation_id: capture.conversationId, cli: chosen.type, status: result.status, error: result.error,
      });
      return null;
    }
    return result.output.trim();
  } finally {
    signal?.removeEventListener('abort', relayAbort);
  }
}

async function runCaptureAnalysisModel(
  userId: string, capture: RecallCaptureRecord, stage: 'summary' | 'value', message: string, signal?: AbortSignal,
): Promise<string> {
  const errorCode = stage === 'summary' ? 'summary_failed' : 'value_judgment_failed';
  const { modelCandidates } = await readRecallCaptureSettings(userId);
  const systemPrompt = prompts.load(stage === 'summary' ? 'cognition_capture_summary' : 'cognition_capture_value') + (capture.feedbackObservations?.length ? '\nobservations are authenticated user feedback about a specific prior task and exact asset version, not verbatim chat text or a new standing instruction. Preserve that attribution. Do not fabricate an evidence quote for metadata, infer a current-version defect from historical-version feedback, or generalize one click into a durable rule.' : '');
  if (!systemPrompt.trim()) throw new CaptureFailure(errorCode, 'analysis prompt unavailable');
  if (!modelCandidates.length && !hasConfiguredModel().configured && !process.env.ANTHROPIC_API_KEY) {
    const entries = (await detectAll()).filter(entry => entry?.available);
    const chosen = entries.find(entry => entry.type === 'claude') || entries[0];
    if (!chosen) throw new CaptureFailure('model_not_configured', 'no value judgment model available');
    const result = await withCaptureModelBudget(userId, { jobId: capture.id, stage }, systemPrompt.length + message.length, () => runCliAgent({ uid: userId, cid: capture.conversationId,
      agentId: `recall-capture-${stage}`, agentName: stage === 'summary' ? 'Context Summary' : 'Value Screening', cli: chosen.type,
      prompt: `${systemPrompt}\n\n${message}`, cwd: os.tmpdir(), signal,
      skipDispatchCheck: true, onEvent: () => {} }));
    if (result.status !== 'completed' || !result.output?.trim()) {
      throw new CaptureFailure(errorCode, 'capture analysis did not complete');
    }
    return result.output;
  }
  const { result } = await runRecallCaptureModel(userId, { sessionId: `memory-${stage}-recall-${capture.id}`,
    systemPrompt, modelCandidates, message, signal, shouldContinue: () => nightlyCaptureCanStart(userId), budget: { jobId: capture.id, stage } });
  if (result.meta.aborted || result.meta.error) {
    throw new CaptureFailure(result.meta.error?.kind === 'auth' ? 'model_auth_required' : errorCode,
      'capture analysis did not complete');
  }
  return result.text;
}

function assertSafeCaptureSummary(value: CaptureContextSummary | CaptureContextCheckpoint): void {
  try {
    // Apply the existing credential storage gate before creating any derived
    // summary copy. Inspect original strings, not escaped JSON serialization.
    const pending: unknown[] = [value];
    const strings: string[] = [];
    while (pending.length) {
      const item = pending.pop();
      if (typeof item === 'string') strings.push(item);
      else if (Array.isArray(item)) pending.push(...item);
      else if (item && typeof item === 'object') pending.push(...Object.values(item));
    }
    assertNotForbiddenToPersist(strings);
  } catch {
    throw new CaptureFailure('summary_sensitive_content', 'summary contains content forbidden to persist');
  }
}

async function judgeCaptureValue(
  userId: string, capture: RecallCaptureRecord, messages: CapturePromptMessage[], signal?: AbortSignal,
): Promise<string> {
  if (!capture.contextSummary) throw new CaptureFailure('summary_failed', 'summary required before value decision');
  // The summary keeps context and corrections; the attached quotations let the
  // judge check claims against actual source text without re-truncating it.
  const input = captureValueJudgmentInput(capture.contextSummary, messages);
  return runCaptureAnalysisModel(userId, capture, 'value', JSON.stringify(input), signal);
}

export async function readRecallCapture(userId: string, id: string): Promise<RecallCaptureRecord> {
  if (!safeId(id)) throw new Error('invalid recall capture id');
  const record = await readRecallJsonRecord(userId, CAPTURE_COLLECTION, id);
  if (!record) throw new Error('recall capture not found');
  return asCapture(record);
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
  if (workflowStatus === 'completed' && linkedAssetIds.length) return 'view_assets';
  if (workflowStatus === 'review_ready') return 'review_candidates';
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
  if (workflowStatus === 'review_ready') return ['review_candidates', 'open_conversation'];
  if (workflowStatus === 'completed' && linkedAssetIds.length) return ['view_assets', 'open_conversation'];
  return [];
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
        ...(candidate.proposalTarget ? { proposalTarget: candidate.proposalTarget } : {}),
        ...(candidate.automaticUndo ? { automaticUndo: candidate.automaticUndo } : {}),
        ...(candidate.contentCategory !== undefined ? { contentCategory: candidate.contentCategory } : {}),
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
    workflowStatus: capture.status === 'no_candidate' ? 'completed' : capture.status,
    displayStatus: captureDisplayStatus(capture, capture.status),
    displayReason: capture.status === 'no_candidate' ? 'no_candidate' : captureDisplayReason(capture, capture.status),
    // 展示归「已完成」（2026-09-15 口径修正）：行上显示的就是「已完成」，
    // 筛选与计数必须一致；零读取路由（isSilentCapture）不受此影响。
    bucket: capture.status === 'no_candidate' ? 'done' : 'silent',
    reviewSummary: { total: 0, pending: 0, deferred: 0, promoted: 0, rejected: 0, missing: 0 },
    linkedAssetIds: [],
    confirmedAssetReceipts: [],
    // 静默记录语义上无候选（no_candidate），投影为空数组即真值（P-r1-55）。
    candidateOutcomes: [],
    nextAction: 'none',
    actions: [],
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
    let allMessages: GroupMessage[];
  if (capture.reviewDay) {
    const { start, end } = captureReviewDayBounds(capture);
    allMessages = await readReviewDayMessages(userId, capture.conversationId, start, end);
  } else {
    allMessages = await chats.getMessages(userId, capture.conversationId, 2_000);
  }
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
  // 逐条降级，而不是让一条坏 capture 把整个列表、终端事件入队和调度恢复全部
  // 读失败（照抄 workspace-refs / listAbilityAssets 的既有口径）：记录形状的
  // 不变量分布在 store 的 validateRecallRecord 和这里的 asCapture 两层，任一层
  // 一抛，好记录也列不出。只降级记录形状的错；真正的 IO 故障（带 errno code）
  // 照旧上抛——静默少几条等于把磁盘问题伪装成「没有整理任务」。
  const reads = await Promise.all(names
    .filter((name) => name.endsWith('.json') && safeId(name.slice(0, -5)))
    .map(async (name) => {
      const id = name.slice(0, -5);
      try {
        return { id, record: await readRecallJsonRecord(userId, CAPTURE_COLLECTION, id) };
      } catch (error) {
        if (typeof (error as NodeJS.ErrnoException).code === 'string') throw error;
        return { id, error: error as Error };
      }
    }));
  const captures: RecallCaptureRecord[] = [];
  for (const read of reads) {
    if (read.error) {
      log.warn('skipped an unreadable recall capture', { captureId: read.id, error: read.error.message });
      continue;
    }
    if (!read.record) continue;
    try {
      captures.push(asCapture(read.record));
    } catch (error) {
      log.warn('skipped a malformed recall capture', { captureId: read.id, error: (error as Error).message });
    }
  }
  return captures
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id));
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

function captureTaskKey(userId: string, id: string): string {
  return `${userId}:${id}`;
}

function durationSince(startedAt: string | undefined, finishedAt: string): number | undefined {
  if (!startedAt) return undefined;
  return Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt));
}

async function settleInterruptedCapture(userId: string, id: string): Promise<RecallCaptureRecord> {
  return requeueInterruptedCapture(userId, id);
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
  const { start, end } = captureReviewDayBounds(capture);
  const allMessages = await readReviewDayMessages(userId, capture.conversationId, start, end, true);
  const byId = new Map(allMessages.filter(isRecallConversationMessage).map((message) => [message.id, message]));
  const wanted = new Set([...(capture.contextMessageIds || []), ...capture.messageIds]);
  const selected = allMessages.filter(message => wanted.has(message.id));
  if (wanted.size !== selected.length || !selected.length || capture.messageIds.some(id => !byId.has(id))) {
    throw new CaptureFailure('source_unavailable', 'capture messages are unavailable');
  }
  return selectCaptureMessages(selected, 0, Number.MAX_SAFE_INTEGER).map((message) => ({
    ...message,
    discovery: capture.messageIds.includes(message.id),
    ...(capture.feedbackObservations?.some(item => item.messageId === message.id) ? { observations: capture.feedbackObservations.filter(item => item.messageId === message.id) } : {}),
    artifacts: message.artifacts.map((artifact) => ({
      ...artifact,
      conversationId: artifact.conversationId || capture.conversationId,
    })),
  }));
}

/** Local shortlist only. The independent model value decision follows this
 * check; an earlier local qualification never substitutes for that decision. */
async function screenQueuedRecallCapture(
  userId: string,
  id: string,
  capture: RecallCaptureRecord,
): Promise<{ capture: RecallCaptureRecord; promptMessages?: CapturePromptMessage[] }> {
  if (capture.screeningStatus === 'qualified') {
    return { capture };
  }
  let promptMessages: CapturePromptMessage[];
  try {
    promptMessages = await loadStoredPromptMessages(userId, capture);
  } catch {
    const finishedAt = new Date().toISOString();
    return {
      capture: await updateCapture(userId, id, (current) => current.status !== 'queued'
        ? current
        : {
            ...current,
            status: 'failed',
            visibility: 'internal',
            errorCode: 'source_unavailable',
            finishedAt,
            updatedAt: finishedAt,
          }),
    };
  }
  const fresh = promptMessages.filter(message => message.discovery !== false);
  const screening = screenRecallCaptureValue(fresh.some(message => message.role === 'user') ? fresh : promptMessages);
  const screenedAt = new Date().toISOString();
  const screened = await updateCapture(userId, id, (current) => current.status !== 'queued'
    ? current
    : screening.eligible || current.feedbackRevision
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
  return { capture: screened, promptMessages };
}

function isSettledAutomaticCandidate(candidate: Pick<RecallCandidateRecord, 'status'>): boolean {
  return ['confirmed', 'integrated', 'rejected', 'ignored', 'expired'].includes(candidate.status);
}

export async function runRecallCapture(
  userId: string,
  id: string,
  signal?: AbortSignal,
): Promise<RecallCaptureRecord> {
  let queued = await readRecallCapture(userId, id);
  if (queued.status !== 'queued') return queued;
  if (queued.executionPolicy !== 'nightly' || !queued.reviewDay) throw new Error('only nightly capture is available');
  const executionSettings = await readRecallCaptureSettings(userId);
  if (!executionSettings.enabled) {
    return updateCapture(userId, id, current => current.status !== 'queued' ? current : {
      ...current, status: 'cancelled', visibility: 'internal', errorCode: 'capture_disabled', updatedAt: new Date().toISOString(),
    });
  }
  if (!isWithinNightlyWindow(new Date(), executionSettings.nightlyStart, executionSettings.nightlyEnd)) return queued;
  const sourceControl = await readCognitionSourceControl(userId, {
    kind: 'conversation',
    id: queued.conversationId,
  });
  if (sourceControl && sourceControl.availability !== 'active') {
    return updateCapture(userId, id, (current) => current.status !== 'queued'
      ? current
      : {
          ...current,
          status: 'cancelled',
          visibility: 'internal',
          resumeStatus: undefined,
          errorCode: sourceControl.availability === 'removed' ? 'source_removed' : 'source_paused',
          updatedAt: new Date().toISOString(),
        });
  }
  const screened = await screenQueuedRecallCapture(userId, id, queued);
  // 筛选阶段已加载过同一份消息（messageIds 在 capture 创建时固定，两次读之间
  // 本就无锁），提取阶段复用，免去对同一会话 JSONL 的第二次全量翻页读；
  // qualified/manual 重跑没读过（undefined）则提取阶段自读。
  const screenedPromptMessages = screened.promptMessages;
  queued = screened.capture;
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
        autoApprovalEpoch: current.feedbackRevision ? undefined : captureAutoApprovalAuthorization(executionSettings).autoApprovalEpoch,
        autoApprovalEnabledAt: current.feedbackRevision ? undefined : captureAutoApprovalAuthorization(executionSettings).autoApprovalEnabledAt,
        finishedAt: undefined,
        durationMs: undefined,
        modelUsage: undefined,
        extractionRepairAttempted: undefined,
        uncertaintyAssessments: undefined,
        candidateSupportUnavailable: undefined,
        candidateSupportUnavailableCount: undefined,
        updatedAt: startedAt,
      };
    })() : current),
  }));
  if (!claimed) return capture;

  try {
    if (signal?.aborted) return settleInterruptedCapture(userId, id);
    const { modelCandidates } = await readRecallCaptureSettings(userId);
    capture = await setCaptureStage(userId, id, 'recall_view');
    if (capture.status !== 'extracting' || signal?.aborted) return settleInterruptedCapture(userId, id);
    let conversation: Awaited<ReturnType<typeof chats.getConversation>>;
    let promptMessages: CapturePromptMessage[];
    try {
      [conversation, promptMessages] = await Promise.all([
        chats.getConversation(userId, capture.conversationId),
        screenedPromptMessages ?? loadStoredPromptMessages(userId, capture),
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

    if (!await nightlyCaptureCanStart(userId)) return settleInterruptedCapture(userId, id);
    const sourceDigest = captureContextSourceDigest(promptMessages);
    let validSummary: CaptureContextSummary | undefined;
    if (capture.contextSummary) {
      try {
        validSummary = validateCaptureContextSummary(capture.contextSummary, promptMessages);
        assertSafeCaptureSummary(validSummary);
      }
      catch { validSummary = undefined; /* Rebuild stale, malformed or unsafe derived content. */ }
    }
    if (!validSummary) {
      capture = await setCaptureStage(userId, id, 'context_summary');
      let checkpoint = capture.summaryCheckpoint?.sourceDigest === sourceDigest
        ? capture.summaryCheckpoint : undefined;
      if (checkpoint) {
        try { assertSafeCaptureSummary(checkpoint); }
        catch { checkpoint = undefined; }
      }
      capture = await updateCapture(userId, id, current => current.status !== 'extracting' ? current : {
        ...current, contextSummary: undefined, valueJudgment: undefined, extractionCompletedAt: undefined,
        summaryCheckpoint: checkpoint, updatedAt: new Date().toISOString(),
      });
      if (capture.status !== 'extracting') return capture;
      try {
        validSummary = await summarizeCaptureContext(promptMessages, {
          checkpoint,
          run: input => runCaptureAnalysisModel(userId, capture, 'summary', input, signal),
          shouldContinue: async () => capture.status === 'extracting' && !signal?.aborted && await nightlyCaptureCanStart(userId),
          onCheckpoint: async progress => {
            assertSafeCaptureSummary(progress);
            capture = await updateCapture(userId, id, current => current.status !== 'extracting' ? current : {
              ...current, summaryCheckpoint: progress, updatedAt: new Date().toISOString(),
            });
          },
        });
        assertSafeCaptureSummary(validSummary);
      } catch (error) {
        if (error instanceof CaptureContextInterruptedError || signal?.aborted
          || (error as { code?: string })?.code === 'ABORT_ERR') return settleInterruptedCapture(userId, id);
        if (error instanceof CaptureFailure) throw error;
        throw new CaptureFailure('summary_failed', 'context summary failed validation');
      }
      capture = await updateCapture(userId, id, current => current.status !== 'extracting' ? current : {
        ...current, contextSummary: validSummary, summaryCheckpoint: undefined, updatedAt: new Date().toISOString(),
      });
      if (capture.status !== 'extracting') return capture;
    } else {
      capture = { ...capture, contextSummary: validSummary };
    }
    if (!await nightlyCaptureCanStart(userId)) return settleInterruptedCapture(userId, id);
    // A previous value decision may only be reused with the very same validated
    // complete summary. Legacy decisions never skip this new stage.
    const judgmentSummaryDigest = captureSummaryDecisionDigest(validSummary);
    if (!capture.valueJudgment?.eligible || capture.valueJudgment.summaryDigest !== judgmentSummaryDigest) {
      capture = await setCaptureStage(userId, id, 'value_judgment');
      let judgment: CaptureValueJudgment;
      try {
        judgment = { ...parseCaptureValueJudgment(await judgeCaptureValue(userId, capture, promptMessages, signal),
          promptMessages.map(message => ({ ...message, sourceId: cognitionMessageSourceId(capture.conversationId, message.id) })), validSummary),
          summaryDigest: judgmentSummaryDigest };
        assertNotForbiddenToPersist([judgment.reason, ...judgment.evidence.map(item => item.quote)]);
      } catch (error) {
        if (signal?.aborted || (error as { code?: string })?.code === 'ABORT_ERR') return settleInterruptedCapture(userId, id);
        if (error instanceof CaptureFailure) throw error;
        throw new CaptureFailure('value_judgment_failed', 'value judgment failed validation');
      }
      if (signal?.aborted) return settleInterruptedCapture(userId, id);
      capture = await updateCapture(userId, id, current => current.status !== 'extracting' ? current : {
        ...current, valueJudgment: judgment, extractionCompletedAt: undefined, updatedAt: judgment.judgedAt,
        ...(!judgment.eligible ? { status: 'no_candidate' as const, visibility: 'internal' as const,
          screeningStatus: 'filtered' as const, filterReason: 'low_reuse_value' as const,
          noCandidateReason: judgment.reason, finishedAt: judgment.judgedAt, stage: undefined } : {}),
      });
      if (capture.status !== 'extracting') return capture;
    }

    // Keep later corrections and prior context. Value evidence controls what
    // may be extracted; it must not delete contextual messages from the input.

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

    if (!await nightlyCaptureCanStart(userId)) return settleInterruptedCapture(userId, id);

    // All formation stages retain the configured API or installed CLI model route.
    const { assets: extractionAssets, coverage: comparisonCoverage } = await selectCaptureExistingAssets(userId, {
      summary: capture.contextSummary, approvedEvidence: capture.valueJudgment?.evidence,
      sourceScope: {
        ...(conversation.project_id ? { projectId: conversation.project_id } : {}),
        ...(conversation.space_id ? { workspaceId: conversation.space_id } : {}),
        ...(conversation.kind ? { conversationKind: conversation.kind } : {}),
      },
    });
    const ontologyDocument = readOntologyDocument(userId);
    const ontologyContext = await buildSourceQualifiedOntologyFormationContext(userId, ontologyDocument, {
      scopeBound: true,
      queryText: [capture.contextSummary?.topics.map(topic => `${topic.title}\n${topic.content}`).join('\n'),
        capture.valueJudgment?.evidence.map(item => item.quote).join('\n')].filter(Boolean).join('\n'),
      ...(conversation.project_id ? { projectId: conversation.project_id } : {}),
      ...(conversation.space_id ? { workspaceId: conversation.space_id } : {}),
    });
    let extractionText: string;
    let extractionModelUsage: RecallCaptureModelUsage | undefined;
    const usesCli = !modelCandidates.length && !hasConfiguredModel().configured && !process.env.ANTHROPIC_API_KEY;
    const schemaRepairInstruction = 'The previous extraction was not a complete parseable proposal. Re-read the same approved source and return the explicit proposalVersion:2 envelope described above. Each group owns its complete cognition or ontology explanation and its evidence. ontologyChanges belongs only inside its owning ontology or joint proposal. Never borrow an unowned top-level plan or invent cognition for ontology-only changes. Include supported conditions and exceptions. Do not guess a missing scope, identity, fact or source, and do not claim anything has been saved. If the source cannot support a complete proposal, return an empty proposals array and a short reason.';
    const requestExtraction = async (repair = false): Promise<{ text: string; usage?: RecallCaptureModelUsage }> => {
      if (usesCli) {
        try {
          const cliText = await extractCaptureViaCli(userId, capture, conversation, promptMessages, recallView, signal, extractionAssets, ontologyContext, comparisonCoverage, repair ? schemaRepairInstruction : undefined);
          if (cliText === null) throw new CaptureFailure('model_not_configured', 'model configuration is required (no local CLI available)');
          return { text: cliText };
        } catch (error) {
          if (error instanceof CaptureFailure) throw error;
          if ((error as { code?: string })?.code === 'ABORT_ERR') throw error;
          throw new CaptureFailure('model_failed', `CLI extraction failed: ${(error as Error).message}`);
        }
      } else {
        const { result, chosen } = await runRecallCaptureModel(userId, {
          sessionId: `memory-extract-${repair ? 'repair' : 'recall'}-${capture.id}`,
          budget: { jobId: capture.id, stage: 'extraction' },
          systemPrompt: extractionSystemPrompt() + (repair ? `\n\n${schemaRepairInstruction}` : ''), modelCandidates,
          message: extractionInput(conversation.title, promptMessages, recallView, extractionAssets,
            capture.contextSummary, capture.valueJudgment?.evidence, ontologyContext, {
              ...(conversation.project_id ? { projectId: conversation.project_id } : {}),
              ...(conversation.space_id ? { workspaceId: conversation.space_id } : {}),
            }, comparisonCoverage), signal,
          shouldContinue: () => nightlyCaptureCanStart(userId),
        });
        if (signal?.aborted) throw Object.assign(new Error('capture extraction interrupted'), { code: 'ABORT_ERR' });
        if (result.meta.aborted) throw Object.assign(new Error('capture extraction interrupted'), { code: 'ABORT_ERR' });
        if (result.meta.error) {
          const code = result.meta.error.kind === 'auth'
            ? 'model_auth_required'
            : result.meta.error.kind === 'timeout'
              ? 'model_timeout'
              : 'model_failed';
          throw new CaptureFailure(code, result.meta.error.message);
        }
        return { text: result.text.trim(), usage: normalizeModelUsage({ ...result.meta.usage, ...chosen }) };
      }
    };
    const initialExtraction = await requestExtraction();
    if (signal?.aborted || !await nightlyCaptureCanStart(userId)) return settleInterruptedCapture(userId, id);
    extractionText = initialExtraction.text; extractionModelUsage = initialExtraction.usage;
    let parseResult: RecallCaptureParseResult | undefined;
    let initialParseError: unknown;
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
      initialParseError = error;
    }
    // One bounded format repair, using the same full source and baselines.
    // Valid proposals are never discarded/re-generated to improve the verdict.
    // Missing fields cannot be invented by a deterministic default.
    if (!parseResult || (parseResult.emittedCount > 0 && parseResult.candidates.length === 0)) {
      if (signal?.aborted || !await nightlyCaptureCanStart(userId)) return settleInterruptedCapture(userId, id);
      capture = await updateCapture(userId, id, current => current.status !== 'extracting' ? current : {
        ...current, extractionRepairAttempted: true, updatedAt: new Date().toISOString(),
      });
      if (capture.status !== 'extracting') return capture;
      const repaired = await requestExtraction(true);
      if (signal?.aborted || !await nightlyCaptureCanStart(userId)) return settleInterruptedCapture(userId, id);
      extractionText = repaired.text;
      if (repaired.usage) {
        const earlier = extractionModelUsage;
        extractionModelUsage = { ...repaired.usage,
          ...Object.fromEntries(['inputTokens', 'outputTokens', 'totalTokens'].flatMap(key => {
            const sum = Number(earlier?.[key] || 0) + Number(repaired.usage?.[key] || 0);
            return sum > 0 ? [[key, sum]] : [];
          })),
        };
      }
      parseResult = parseRecallCaptureResult(extractionText, new Set(promptMessages.map(message => message.label)));
    }
    if (!parseResult) throw initialParseError;
    const parsed = parseResult.candidates;
    // Replaying candidate persistence must retain the proof already attached to
    // a saved group. A rebuilt summary/value decision clears this checkpoint.
    const extractionCompletedAt = capture.extractionCompletedAt || new Date().toISOString();
    const extractionIdentity = createHash('sha256').update(JSON.stringify({ sourceDigest,
      summaryDigest: judgmentSummaryDigest, judgedAt: capture.valueJudgment!.judgedAt })).digest('hex').slice(0, 20);
    capture = await updateCapture(userId, id, current => current.status !== 'extracting' ? current : {
      ...current, extractionCompletedAt, updatedAt: extractionCompletedAt,
    });
    capture = await setCaptureStage(userId, id, 'candidate_save');
    if (capture.status !== 'extracting') return capture;
    // 自动来源只能形成候选；旧 autoWrite/auto 配置不构成逐条确认授权。
    const byLabel = new Map(promptMessages.map((message) => [message.label, message]));
    const candidates: RecallCandidateRecord[] = [];
    const supportUnavailable: NonNullable<RecallCaptureRecord['candidateSupportUnavailable']> = [];
    const recordSupportUnavailable = async (candidateIndex: number, candidate: ParsedCandidate,
      stage: 'grounding' | 'uncertainty', reason: string) => {
      supportUnavailable.push({ candidateIndex, stage, reason,
        candidateHash: createHash('sha256').update(JSON.stringify(candidate)).digest('hex') });
      capture = await updateCapture(userId, id, current => current.status !== 'extracting' ? current : {
        ...current, candidateSupportUnavailable: [...supportUnavailable], candidateSupportUnavailableCount: supportUnavailable.length,
        updatedAt: new Date().toISOString(),
      });
    };
    for (const [index, candidate] of parsed.entries()) {
      const evidenceMessages = candidate.evidence.map((label) => byLabel.get(label)!);
      if (capture.executionPolicy !== 'manual' && (isTaskLocalRuleProposal(candidate, evidenceMessages) || nonRetainableActivityContent(candidate.judgment))) {
        log.info('recall capture omitted task-local rule', { captureId: capture.id, candidateIndex: index });
        continue;
      }
      const judgedEvidence = capture.valueJudgment?.evidence || [];
      if (!evidenceMessages.some(message => message.role === 'user'
        && judgedEvidence.some(evidence => evidence.messageId === message.id && message.text.includes(evidence.quote)))) {
        continue;
      }
      const qualityEvidence = evidenceMessages.map(message => {
        if (message.role !== 'user') return message;
        const quotes = judgedEvidence.filter(evidence => evidence.messageId === message.id).map(evidence => evidence.quote);
        return { ...message, text: quotes.join('\n') };
      });
      let uncertaintySupported = false;
      if (candidate.uncertainty && assessRecallCaptureCandidateQuality(candidate, qualityEvidence).reviewable
        && assessRecallCandidateClassification(candidate).ok) {
        const assessment = await assessRecallCaptureUncertainty(userId, {
          sessionId: `memory-uncertainty-recall-${capture.id}-${index}`, candidate,
          budget: { jobId: capture.id, stage: 'uncertainty' },
          sources: evidenceMessages.filter(message => message.role === 'user').map(message => ({ label: message.label,
            text: message.text, approvedQuotes: judgedEvidence.filter(ref => ref.messageId === message.id).map(ref => ref.quote) })),
          contextMessages: promptMessages.map(message => ({ label: message.label, id: message.id,
            role: message.role, text: message.text, timestamp: message.ts })),
          summary: capture.contextSummary?.topics,
          existingTarget: extractionAssets.find(asset => asset.id === candidate.targetAssetId),
          modelCandidates, signal, shouldContinue: () => nightlyCaptureCanStart(userId),
        });
        if (assessment.interrupted || signal?.aborted || !await nightlyCaptureCanStart(userId)) return settleInterruptedCapture(userId, id);
        capture = await updateCapture(userId, id, current => current.status !== 'extracting' ? current : {
          ...current, uncertaintyAssessments: [
            ...(current.uncertaintyAssessments || []).filter(row => row.candidateIndex !== index),
            { ...assessment, candidateIndex: index },
          ], updatedAt: new Date().toISOString(),
        });
        if (capture.status !== 'extracting') return capture;
        if (!assessment.modelCompleted && assessment.reason && [
          'uncertainty_model_unavailable', 'uncertainty_assessment_invalid', 'uncertainty_context_too_large',
          'uncertainty_context_unavailable',
        ].includes(assessment.reason)) {
          await recordSupportUnavailable(index, candidate, 'uncertainty', assessment.reason);
          if (capture.status !== 'extracting') return capture;
        }
        if (assessment.nonBlocking) {
          // Only the classified blocking annotation changes. The exact body,
          // scope, effective dates and ontology proposal remain model-authored.
          delete candidate.uncertainty;
          uncertaintySupported = true;
        }
      }
      const quality = assessRecallCaptureCandidateQuality(candidate, qualityEvidence);
      // New cognition follows one quality contract. Historical type validation
      // remains read-compatible; it no longer asks the model to choose a class.
      const classification = assessRecallCandidateClassification(candidate);
      if (!classification.ok) {
        log.info('recall capture candidate misclassified', {
          captureId: capture.id,
          suggestedType: candidate.suggestedType,
          ...(candidate.contentCategory !== undefined ? { contentCategory: candidate.contentCategory } : {}),
          reasons: classification.blockingReasons,
        });
      }
      const retainForReview = classification.ok;
      // Automatic output rejected by evidence/value gates must not accumulate as weak observations.
      let grounded = uncertaintySupported || isRecallCaptureCandidateGrounded(candidate, qualityEvidence);
      if (!grounded && quality.reviewable && classification.ok && !candidate.uncertainty
        && !isTaskLocalRuleProposal(candidate, evidenceMessages)) {
        try {
          grounded = await semanticallyGroundCaptureCandidate(userId, {
            sessionId: `memory-grounding-recall-${capture.id}-${index}`, candidate,
            budget: { jobId: capture.id, stage: 'grounding' },
            sources: evidenceMessages.filter(message => message.role === 'user').map(message => ({ label: message.label,
              text: message.text, approvedQuotes: judgedEvidence.filter(ref => ref.messageId === message.id).map(ref => ref.quote) })),
            summary: capture.contextSummary?.topics,
            existingTarget: extractionAssets.find(asset => asset.id === candidate.targetAssetId),
            modelCandidates, signal, shouldContinue: () => nightlyCaptureCanStart(userId),
          });
        } catch (error) {
          if (signal?.aborted || (error as { code?: string }).code === 'ABORT_ERR') throw error;
          if (!await nightlyCaptureCanStart(userId)) return settleInterruptedCapture(userId, id);
          const reason = error instanceof CaptureGroundingUnavailableError ? error.reason : 'model_unavailable';
          await recordSupportUnavailable(index, candidate, 'grounding', reason);
          if (capture.status !== 'extracting') return capture;
          log.warn('candidate semantic support evaluation unavailable; retained for nightly retry', { candidateIndex: index, reason });
        }
      }
      if (!quality.reviewable || !classification.ok || !grounded) {
        log.info('capture candidate filtered before persistence', { captureId: capture.id,
          classification: classification.blockingReasons, quality: quality.reasons,
          grounding: quality.automaticIneligibilityReasons, grounded });
        continue;
      }
      if (signal?.aborted || !await nightlyCaptureCanStart(userId)) return settleInterruptedCapture(userId, id);
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
      const sourceScopePolicy = {
        ...(captureSpaceId ? { workspaceIds: [captureSpaceId] } : {}),
        ...(conversation.project_id ? { projectIds: [conversation.project_id] } : {}),
      };
      let ontologyFormation: ReturnType<typeof parseOntologyFormationProposal>;
      try {
        ontologyFormation = parseOntologyFormationProposal(ontologyDocument, `proposal-${capture.id}-${index}`,
          candidate.ontologyChanges, candidate.judgment, extractionCompletedAt, candidate.proposalTarget === 'ontology' ? 'ontology' : 'cognition');
        ontologyFormation = validateOntologyFormationScope(userId, ontologyDocument, ontologyFormation,
          Object.keys(sourceScopePolicy).length ? sourceScopePolicy : undefined);
      } catch (error) {
        if (error instanceof Error && error.message.includes('forbidden to persist')) {
          log.warn('capture ontology candidate omitted (sensitive)', { captureId: capture.id, candidateIndex: index });
          continue;
        }
        throw new CaptureFailure('candidate_save_failed', 'ontology proposal could not be prepared');
      }
      if (ontologyFormation) {
        const approvedLabels = new Set(evidenceMessages.filter(message => message.role === 'user'
          && judgedEvidence.some(evidence => evidence.messageId === message.id && message.text.includes(evidence.quote))).map(message => message.label));
        if (!ontologyFormation.evidence.length || ontologyFormation.evidence.some(label => !approvedLabels.has(label))) {
          ontologyFormation.blockedReasons.push('ontology_evidence_unapproved');
        }
        if (ontologyContext.truncated) ontologyFormation.blockedReasons.push('ontology_comparison_incomplete');
        const comparedIds = new Set(ontologyContext.records.map(record => record.id));
        if (ontologyFormation.actions.some(action => action.intent !== 'create' && !comparedIds.has(action.recordId)))
          ontologyFormation.blockedReasons.push('ontology_target_not_compared');
      }
      if (candidate.proposalTarget === 'ontology' && !ontologyFormation?.actions.length && !ontologyFormation?.blockedReasons.length) continue;
      try {
        const storedCandidate = await submitCognitionCandidate(userId, {
          judgment: candidate.judgment,
          value: candidate.value,
          summary: candidate.summary,
          ...(candidate.proposalTarget ? { proposalTarget: candidate.proposalTarget, formationProposalId: candidate.formationProposalId } : {}),
          ...(ontologyFormation ? { ontologyFormation } : {}),
          ...(candidate.uncertainty ? { uncertainty: candidate.uncertainty } : {}),
          suggestedType: candidate.suggestedType,
          ...(candidate.contentCategory !== undefined ? { contentCategory: candidate.contentCategory } : {}),
          suggestedScope: candidate.suggestedScope,
          ...(candidate.suggestedAction ? { suggestedAction: candidate.suggestedAction } : {}),
          ...(candidate.risk ? { risk: candidate.risk } : {}),
          ...(candidate.targetAssetId ? { targetAssetId: candidate.targetAssetId,
            targetVersionUsed: extractionAssets.find(asset => asset.id === candidate.targetAssetId)?.version } : {}),
          ...(Object.keys(sourceScopePolicy).length ? { scopePolicy: sourceScopePolicy } : {}),
          ...(candidate.applicableWhen ? { applicableWhen: candidate.applicableWhen } : {}),
          ...(candidate.forbiddenWhen ? { forbiddenWhen: candidate.forbiddenWhen } : {}),
          forceWeakObservation: !quality.reviewable || !classification.ok,
          captureKey: `capture-${capture.id}-${extractionIdentity}-${candidate.formationProposalId ? `v2-${candidate.formationProposalId}` : `legacy-${index}`}`,
          ...(captureSpaceId ? { spaceId: captureSpaceId } : {}),
          taskRunId: capture.terminalRunId,
          captureProvenance: { pipeline: 'nightly_conversation', captureId: capture.id, messageIds: capture.messageIds,
            valueJudgment: { ...capture.valueJudgment!, eligible: true }, extractionCompletedAt },
          sourceRefs: [
            { kind: 'conversation', subtype: 'session', scope: 'conversation', id: capture.conversationId, title: conversation.title },
            ...evidenceMessages.map((message) => ({
              kind: 'conversation' as const,
              subtype: 'message' as const,
              scope: 'conversation' as const,
              id: cognitionMessageSourceId(capture.conversationId, message.id),
              excerpt: capture.valueJudgment?.evidence.find(evidence => evidence.messageId === message.id)?.quote
                || message.text.slice(0, 1_000),
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
    const supportEvaluationFailed = !hasQualifiedCandidates && supportUnavailable.length > 0;
    const hasReviewableCandidates = candidates.some((candidate) => (
      isAutoCaptureEligible(candidate)
    ));
    capture = await updateCapture(userId, id, (current) => current.status !== 'extracting'
      ? current
      : {
          ...current,
          status: supportEvaluationFailed ? 'failed' : hasReviewableCandidates ? 'review_ready' : hasQualifiedCandidates ? 'completed' : 'no_candidate',
          visibility: current.executionPolicy === 'manual' || hasQualifiedCandidates ? 'visible' : 'internal',
          screeningStatus: hasQualifiedCandidates || supportEvaluationFailed ? 'qualified' : 'filtered',
          // 三分而不是二分：模型判空 / 模型给了但全被丢弃 / 给了且接住但下游筛掉。
          // 中间那档过去混在 model_no_candidate 里，让解析侧的丢弃伪装成"内容里
          // 确实没有"——实机上这两种的处置完全相反。
          filterReason: hasQualifiedCandidates || supportEvaluationFailed
            ? undefined
            : parsed.length
              ? 'candidate_quality'
              : parseResult.emittedCount ? 'candidate_unparsable' : 'model_no_candidate',
          ...(parseResult.noCandidateReason && !hasQualifiedCandidates && !supportEvaluationFailed
            ? { noCandidateReason: parseResult.noCandidateReason }
            : {}),
          stage: undefined,
          autoWrite: undefined,
          candidateIds,
          errorCode: supportEvaluationFailed ? 'candidate_support_unavailable' : undefined,
          finishedAt,
          durationMs: durationSince(current.startedAt, finishedAt),
          ...(modelUsage ? { modelUsage } : {}),
          updatedAt: finishedAt,
        });
    if (capture.status === 'failed' && capture.errorCode === 'candidate_support_unavailable') {
      void bumpRecallCaptureStats(userId, { failures: { candidate_support_unavailable: 1 } }).catch(() => {});
    }
    if (capture.status === 'review_ready' && capture.autoApprovalEpoch) {
      capture = await automaticallyReviewCompletedCapture(userId, capture, signal);
    }
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
    return capture;
  } catch (error) {
    if (signal?.aborted || (error as { code?: string })?.code === 'ABORT_ERR') return settleInterruptedCapture(userId, id);
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
    return updateCapture(userId, id, (current) => (current.status !== 'extracting' && current.status !== 'writing')
      ? current
      : {
          ...current,
          status,
          visibility: 'internal',
          errorCode: code,
          finishedAt,
          durationMs: durationSince(current.startedAt, finishedAt),
          updatedAt: finishedAt,
        });
  }
}

const scheduledCaptures = new Map<string, ScheduledBootBackgroundTask>();
const captureScheduleAdmissions = new Set<string>();
let captureSchedulingEnabled = true;

async function nightlyCaptureCanStart(userId: string, allowOutsideWindow = false): Promise<boolean> {
  const settings = await readRecallCaptureSettings(userId);
  return settings.enabled && settings.executionPolicy === 'nightly'
    && (allowOutsideWindow || isWithinNightlyWindow(new Date(), settings.nightlyStart, settings.nightlyEnd));
}

async function scheduleKnownRecallCapture(userId: string, capture: RecallCaptureRecord): Promise<void> {
  const schedulable = capture.status === 'queued' && capture.executionPolicy === 'nightly' && Boolean(capture.reviewDay);
  // Captures admitted by a manual run keep processing outside the window;
  // scheduled admissions stay night-only.
  const manualAdmitted = String(capture.terminalRunId || '').includes('-manual-');
  if (!captureSchedulingEnabled || !schedulable || !await nightlyCaptureCanStart(userId, manualAdmitted)) return;
  const key = captureTaskKey(userId, capture.id);
  // Recheck after the settings read so concurrent admissions share one task.
  if (!captureSchedulingEnabled || scheduledCaptures.has(key)) return;
  const task = scheduleBootBackground(`recall:capture:${capture.id}`, signal => (
    runRecallCapture(userId, capture.id, signal).then(() => undefined)
  ), 0, { resourceClass: 'model', preferIdle: !manualAdmitted });
  scheduledCaptures.set(key, task);
  void task.promise.finally(() => {
    if (scheduledCaptures.get(key) === task) scheduledCaptures.delete(key);
    // No immediate self-renewal: a task deferred at the window boundary remains
    // queued until a later nightly sweep, without a daytime rescheduling loop.
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

export async function promoteRecallCaptureCandidate(
  userId: string,
  candidateId: string,
  options: { riskAcknowledged?: boolean; profileTarget?: PersonalProfileTarget; forceCreateSimilar?: boolean; confirmBaselineVersion?: string } = {},
): Promise<RecallCaptureCandidatePromotion | RecallOntologyCandidateConfirmation> {
  if (!safeId(candidateId)) throw new Error('invalid recall candidate id');
  const similarRetry = options.forceCreateSimilar === true ? { forceCreateSimilar: true } : {};
  // 版本冲突后的显式重锚（specs/015 US-702，`contracts/ipc.md` §二）：本层只是
  // 把调用方声明的基线转发下去，不做任何版本判定——判定在
  // `updateAbilityAsset` 的锁内（唯一一处）。
  const rebase = options.confirmBaselineVersion ? { confirmBaselineVersion: options.confirmBaselineVersion } : {};
  const confirm = async () => {
    const candidate = await readRecallCandidate(userId, candidateId);
    return candidate.proposalTarget === 'ontology'
      ? confirmRecallOntologyCandidate(userId, candidateId, { riskAcknowledged: options.riskAcknowledged })
      : promoteRecallCandidate(userId, candidateId, { actor: 'user', riskAcknowledged: options.riskAcknowledged,
        ...similarRetry, ...rebase, ...(options.profileTarget ? { profileTarget: options.profileTarget } : {}) });
  };
  const capture = (await listAllRecallCaptures(userId)).find((item) => item.candidateIds.includes(candidateId));
  if (!capture) {
    // Only committed-asset recovery can succeed without a live formation record.
    // The canonical promotion gate rejects any first publication of old input.
    const promoted = await confirm();
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
    const promoted = await confirm();
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

/** Resume only proposals from the same still-enabled grant. Policy rejection
 * keeps them in individual review and never becomes a background failure task. */
async function automaticallyReviewCompletedCapture(userId: string, capture: RecallCaptureRecord, signal?: AbortSignal): Promise<RecallCaptureRecord> {
  if (capture.status !== 'review_ready' || !capture.autoApprovalEpoch) return capture;
  const { tryAutomaticallyApproveRecallCandidate } = await import('./nightly-automatic-approval');
  for (const candidateId of capture.candidateIds) {
    if (signal?.aborted) return readRecallCapture(userId, capture.id);
    try { await tryAutomaticallyApproveRecallCandidate(userId, candidateId); }
    catch { log.warn('automatic cognition confirmation held; proposal retained for review'); }
  }
  const current = await readRecallCapture(userId, capture.id);
  const [workflow] = await summarizeRecallCaptures(userId, [current]);
  if (current.status === 'review_ready' && workflow.workflowStatus === 'completed') {
    return updateCapture(userId, capture.id, latest => latest.status !== 'review_ready' ? latest : {
      ...latest, status: 'completed', reviewSnapshot: workflow.reviewSummary, updatedAt: new Date().toISOString(),
    });
  }
  return current;
}

export async function recoverRecallCaptures(userId: string): Promise<number> {
  const canRunNightly = await nightlyCaptureCanStart(userId);
  const captures = await listAllRecallCaptures(userId);
  let recovered = 0;
  for (const item of captures) {
    if (item.executionPolicy !== 'nightly' || !item.reviewDay) continue;
    let capture = item;
    if (canRunNightly && capture.status === 'review_ready' && capture.autoApprovalEpoch) {
      capture = await automaticallyReviewCompletedCapture(userId, capture);
    }
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
    if (canRunNightly && (capture.status === 'extracting' || capture.status === 'queued')) {
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
    const schedulable = canRunNightly && capture.status === 'queued';
    if (schedulable) {
      await scheduleKnownRecallCapture(userId, capture);
      recovered += 1;
    }
  }
  return recovered;
}

// ── 夜间增量清扫（U01）──────────────────────────────────────────────────────
// Sole automatic producer: the previous complete local day, frozen at window
// start. Missed windows have no daytime catch-up. Persisted ranges may retry
// on subsequent nights without re-admitting or scanning old conversation days.
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
  pipelineVersion: 2;
  reviewDay: string;
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
  pendingRanges?: Record<string, RecallNightlyPendingRange>;
  reviewWindow?: Omit<RecallNightlyPendingRange, 'conversationId'>;
  lastRunAt?: string;
  lastResult?: RecallNightlySweepResult;
  consecutiveErrors?: number;
}

export interface RecallNightlyPendingRange {
  conversationId: string;
  feedbackRevision?: string;
  feedbackObservations?: NightlyFeedbackObservation[];
  reviewDay: string;
  start: string;
  end: string;
  ranForWindow: string;
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
  const pendingRanges: Record<string, RecallNightlyPendingRange> = {};
  if (raw.pendingRanges !== undefined) {
    if (!raw.pendingRanges || typeof raw.pendingRanges !== 'object' || Array.isArray(raw.pendingRanges)) {
      throw new Error('malformed nightly pending ranges');
    }
    for (const [key, range] of Object.entries(raw.pendingRanges)) {
      if (!range || !safeId(range.conversationId) || !/^\d{4}-\d{2}-\d{2}$/.test(range.reviewDay)
        || key !== `${range.reviewDay}:${range.conversationId}${range.feedbackRevision ? `:feedback-${range.feedbackRevision}` : ''}`
        || range.feedbackRevision && !/^[a-f0-9]{64}$/.test(range.feedbackRevision)
        || !isIsoTimestamp(range.start) || !isIsoTimestamp(range.end) || !isSweepWindowKey(range.ranForWindow)
        || Date.parse(range.start) >= Date.parse(range.end)) throw new Error('malformed nightly pending range');
      pendingRanges[key] = range;
    }
  }
  if (raw.reviewWindow && (!/^\d{4}-\d{2}-\d{2}$/.test(raw.reviewWindow.reviewDay)
    || !isIsoTimestamp(raw.reviewWindow.start) || !isIsoTimestamp(raw.reviewWindow.end)
    || !isSweepWindowKey(raw.reviewWindow.ranForWindow)
    || Date.parse(raw.reviewWindow.start) >= Date.parse(raw.reviewWindow.end))) {
    throw new Error('malformed nightly review window');
  }
  return {
    ...value,
    id: NIGHTLY_SWEEP_ID,
    baselineAt: typeof raw.baselineAt === 'string' && isIsoTimestamp(raw.baselineAt)
      ? raw.baselineAt : new Date().toISOString(),
    cursors,
    pendingRanges,
    ...(raw.lastRunAt ? { lastRunAt: raw.lastRunAt } : {}),
    ...(raw.lastResult ? { lastResult: raw.lastResult } : {}),
    ...(typeof raw.consecutiveErrors === 'number' ? { consecutiveErrors: raw.consecutiveErrors } : {}),
  } as RecallNightlySweepRecord;
}

/** Manual runs tag their window key with `manual-` so on-demand and scheduled
 * admissions stay distinguishable in persisted sweep state. */
function isSweepWindowKey(value: unknown): boolean {
  return isIsoTimestamp(value)
    || (typeof value === 'string' && value.startsWith('manual-') && isIsoTimestamp(value.slice('manual-'.length)));
}

async function readNightlySweepRecord(userId: string): Promise<RecallNightlySweepRecord | undefined> {
  const stored = await readRecallJsonRecord(userId, SWEEP_COLLECTION, NIGHTLY_SWEEP_ID);
  return stored ? asSweepRecord(stored) : undefined;
}

export async function readRecallNightlySweep(userId: string): Promise<RecallNightlySweepRecord | undefined> {
  const record = await readNightlySweepRecord(userId);
  if (!record || record.lastResult?.pipelineVersion === 2) return record;
  // Old scan counts used a different time range and admission policy. Preserve
  // their stored history, but never present them as results of the new pipeline.
  return { ...record, lastResult: undefined, lastRunAt: undefined };
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

/** Admission starts only in the configured night. Missed windows never
 * create a daytime catch-up run. */
function dueNightlyWindow(
  now: Date, settings: RecallCaptureSettingsRecord, _record: RecallNightlySweepRecord | undefined,
): string | undefined {
  if (isWithinNightlyWindow(now, settings.nightlyStart, settings.nightlyEnd)) {
    return mostRecentWindowStart(now, settings.nightlyStart, settings.nightlyEnd).toISOString();
  }
  return undefined;
}

/** Freeze the complete local day before the window starts, including windows
 * that cross midnight. Calendar arithmetic also respects DST transitions. */
export function nightlyReviewDay(ranForWindow: string): { key: string; start: Date; end: Date } {
  const end = new Date(ranForWindow);
  if (Number.isNaN(end.getTime())) throw new Error('invalid nightly review window');
  end.setHours(0, 0, 0, 0);
  const start = new Date(end);
  start.setDate(start.getDate() - 1);
  const key = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
  return { key, start, end };
}

/** Manual runs do not wait for the window: they review the day the next due
 * window would review — the in-progress local day once today's window has
 * opened, otherwise the previous complete day. */
function manualNightlyReviewDay(now: Date, settings: RecallCaptureSettingsRecord): { key: string; start: Date; end: Date } {
  const [hours, minutes] = String(settings.nightlyStart || '02:00').split(':').map(Number);
  const windowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours || 0, minutes || 0, 0, 0);
  const day = now >= windowStart
    ? new Date(now.getFullYear(), now.getMonth(), now.getDate())
    : new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const end = new Date(day);
  end.setDate(end.getDate() + 1);
  const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
  return { key, start: day, end };
}

function captureReviewDayBounds(capture: RecallCaptureRecord): { start: Date; end: Date } {
  if (capture.reviewDayStart && capture.reviewDayEnd) {
    return { start: new Date(capture.reviewDayStart), end: new Date(capture.reviewDayEnd) };
  }
  // Read compatibility for ranges admitted before absolute boundaries existed.
  const start = new Date(`${capture.reviewDay}T00:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

/** Read the complete day and, when requested, the preceding user turn needed
 * to understand a cross-midnight continuation. Older context is never new work. */
async function readReviewDayMessages(userId: string, cid: string, start: Date, end: Date, includeContext = false): Promise<GroupMessage[]> {
  let before: number | null | undefined;
  const collected: GroupMessage[] = [];
  do {
    const page = await chats.getMessagesPage(userId, cid, 256, before);
    collected.unshift(...page.history.filter(message => isRecallConversationMessage(message)
      && (includeContext || timestampMs(message.ts) >= start.getTime()) && timestampMs(message.ts) < end.getTime()));
    if (page.nextCursor === null || page.nextCursor === before
      || page.history.some(message => timestampMs(message.ts) < start.getTime()
        && (!includeContext || (isRecallConversationMessage(message) && message.from === 'user')))) break;
    before = page.nextCursor;
  } while (true);
  const firstNew = collected.findIndex(message => timestampMs(message.ts) >= start.getTime());
  if (firstNew < 0) return [];
  let contextStart = firstNew;
  if (includeContext) {
    for (let index = firstNew - 1; index >= 0; index--) {
      if (collected[index].from === 'user') { contextStart = index; break; }
    }
  }
  return collected.slice(contextStart);
}

function nightSweepRunId(ranForWindow: string): string {
  return `nightly-sweep-${ranForWindow.replace(/[^0-9A-Za-z-]/g, '')}`;
}

const nightlySweepsInFlight = new Set<string>();
const nightlySweepStartedAt = new Map<string, string>();
export function readRecallNightlySweepRuntime(userId: string) {
  return { running: nightlySweepsInFlight.has(userId), startedAt: nightlySweepStartedAt.get(userId) };
}

export async function runNightlyCaptureSweep(
  userId: string, ranForWindow: string, settings: RecallCaptureSettingsRecord, signal?: AbortSignal,
  options: { manual?: boolean; reviewDay?: { key: string; start: Date; end: Date } } = {},
): Promise<RecallNightlySweepRun> {
  if (signal?.aborted) return { ran: false, reason: 'cancelled' };
  if (!settings.enabled || settings.executionPolicy !== 'nightly') return { ran: false, reason: 'disabled' };
  if (!options.manual && !isWithinNightlyWindow(new Date(), settings.nightlyStart, settings.nightlyEnd)) return { ran: false, reason: 'outside_nightly_window' };
  if (nightlySweepsInFlight.has(userId)) return { ran: false, reason: 'sweep_in_flight' };
  let day = options.reviewDay || nightlyReviewDay(ranForWindow);
  nightlySweepsInFlight.add(userId);
  const startedAt = new Date().toISOString();
  nightlySweepStartedAt.set(userId, startedAt);
  notifyCognitionWrite(userId, SWEEP_COLLECTION, 'update', NIGHTLY_SWEEP_ID);
  const counters = { scanned: 0, queued: 0, deferred: 0, retried: 0, skipped: 0, failed: 0 };
  // This is an admission cursor, not source or review history. Persisted
  // captures already retain every admitted range for retries and audit.
  const currentDayCursors = (values: Record<string, RecallNightlySweepCursor>) => Object.fromEntries(
    Object.entries(values).filter(([key]) => /^\d{4}-\d{2}-\d{2}:/.test(key) && key.slice(0, 10) >= day.key));
  let cursors: Record<string, RecallNightlySweepCursor> = {};
  let pendingRanges: Record<string, RecallNightlyPendingRange> = {};
  let admissionLoaded = false;
  const canContinue = async () => !signal?.aborted && captureSchedulingEnabled && await nightlyCaptureCanStart(userId, options.manual);
  const persist = async (result?: RecallNightlySweepResult) => updateRecallJsonRecord(userId, SWEEP_COLLECTION, NIGHTLY_SWEEP_ID, current => ({
    ...(current || { schemaVersion: 1, ownerId: userId, id: NIGHTLY_SWEEP_ID, baselineAt: day.start.toISOString() }),
    cursors: { ...currentDayCursors((current as RecallNightlySweepRecord | undefined)?.cursors || {}), ...cursors },
    ...(admissionLoaded ? { pendingRanges: { ...pendingRanges } } : {}),
    ...(admissionLoaded ? { reviewWindow: { reviewDay: day.key, start: day.start.toISOString(), end: day.end.toISOString(), ranForWindow } } : {}),
    ...(result ? { lastRunAt: result.finishedAt, lastResult: result,
      consecutiveErrors: result.error ? Number(current?.consecutiveErrors || 0) + 1 : 0 } : {}),
  } as RecallJsonRecord));
  try {
    const [conversations, captures, sweep] = await Promise.all([
      chats.listConversations(userId), listAllRecallCaptures(userId), readNightlySweepRecord(userId),
    ]);
    // 2026-10-15 实例审计：'scheduled' 是退役管线的遗留状态——现行调度只处理
    // 'queued'，存量 scheduled 记录永不进展（活跃实例 28 条，会话 100% 已被
    // 认知源控制移除）。会话已删除或被移除/暂停的，在此收口为 cancelled
    //（与 runRecallCapture 的 source_removed/source_paused 口径一致）。
    const liveConversationIds = new Set(conversations.map((conversation) => conversation.conversation_id));
    for (const legacy of captures.filter((capture) => capture.status === 'scheduled')) {
      const availability = liveConversationIds.has(legacy.conversationId)
        ? ((await readCognitionSourceControl(userId, { kind: 'conversation', id: legacy.conversationId }))?.availability ?? 'active')
        : 'removed';
      if (availability === 'active') continue;
      await updateCapture(userId, legacy.id, (current) => current.status !== 'scheduled'
        ? current
        : {
            ...current,
            status: 'cancelled',
            visibility: 'internal',
            resumeStatus: undefined,
            errorCode: availability === 'removed' ? 'source_removed' : 'source_paused',
            updatedAt: new Date().toISOString(),
          });
      counters.skipped += 1;
    }
    if (sweep?.reviewWindow?.ranForWindow === ranForWindow) {
      day = { key: sweep.reviewWindow.reviewDay, start: new Date(sweep.reviewWindow.start), end: new Date(sweep.reviewWindow.end) };
    }
    cursors = currentDayCursors(sweep?.cursors || {});
    pendingRanges = { ...sweep?.pendingRanges };
    admissionLoaded = true;
    if (!await canContinue()) return { ran: false, reason: 'cancelled' };
    await (await import('./effectiveness-feedback')).recoverNightlyEffectivenessFeedback(userId)
      .catch(() => log.warn('nightly effectiveness feedback recovery deferred'));
    if (!await canContinue()) return { ran: false, reason: 'cancelled' };
    for (const event of (await queuedNightlyFeedback(userId)).slice(0, 20)) {
      if (!await canContinue()) break;
      try {
        const messages = (await chats.getMessagesPage(userId, event.conversationId, 1_000)).history;
        const original = messages.find(message => message.id === event.messageId && !message.deleted_at);
        if (!original || !Number.isFinite(Date.parse(original.ts))) continue;
        const originalDate = new Date(original.ts), start = new Date(originalDate.getFullYear(), originalDate.getMonth(), originalDate.getDate());
        const end = new Date(start); end.setDate(end.getDate() + 1);
        const reviewDay = nightlyReviewDay(end.toISOString()).key;
        const observation = feedbackObservation(event);
        const revision = createHash('sha256').update(JSON.stringify(observation)).digest('hex');
        const key = `${reviewDay}:${event.conversationId}:feedback-${revision}`;
        pendingRanges[key] ||= { conversationId: event.conversationId, reviewDay, start: start.toISOString(), end: end.toISOString(),
          ranForWindow, feedbackRevision: revision, feedbackObservations: [observation] };
      } catch { /* A transient source failure preserves the queued feedback. */ }
    }
    // Previously admitted ranges deferred by shutdown/window closure resume
    // only inside this night; no old conversation day is scanned again.
    for (const capture of captures.filter(item => item.reviewDay && item.executionPolicy === 'nightly' && item.status === 'queued')) {
      if (!await canContinue()) break;
      await scheduleKnownRecallCapture(userId, capture);
    }
    // Retry diagnostics only for this day; no automatic historical catch-up.
    for (const capture of captures.filter(item => item.reviewDay && item.executionPolicy === 'nightly')) {
      if (!await canContinue()) break;
      if (!['failed', 'configuration_required'].includes(capture.status) || capture.attempt >= NIGHTLY_AUTO_RETRY_ATTEMPT_LIMIT) continue;
      // Retry a persisted range on a subsequent night; never spend all attempts
      // during the same unavailable/configuration-failed window.
      if ((capture.lastAttemptReviewDay || capture.reviewDay!) >= day.key) continue;
      const retried = await updateCapture(userId, capture.id, current => !['failed', 'configuration_required'].includes(current.status)
        ? current : { ...current, status: 'queued', visibility: 'internal', stage: undefined, attempt: current.attempt + 1, lastAttemptReviewDay: day.key,
          errorCode: undefined, startedAt: undefined, finishedAt: undefined, updatedAt: startedAt });
      await scheduleKnownRecallCapture(userId, retried);
      counters.retried += 1;
    }
    if (!await canContinue()) return { ran: false, reason: 'cancelled' };
    for (const conversation of conversations) {
      if (timestampMs(String(conversation.updated_at)) < day.start.getTime()) continue;
      const cid = conversation.conversation_id;
      const key = `${day.key}:${cid}`;
      pendingRanges[key] ||= { conversationId: cid, reviewDay: day.key,
        start: day.start.toISOString(), end: day.end.toISOString(), ranForWindow };
    }
    // Admission is durable before quiescence/source reads; even an unreadable
    // conversation can resume its exact range after this window or a restart.
    await persist();
    for (const [cursorKey, pending] of Object.entries(pendingRanges)) {
      if (!await canContinue()) break;
      const cid = pending.conversationId;
      const rangeDay = { key: pending.reviewDay, start: new Date(pending.start), end: new Date(pending.end) };
      counters.scanned += 1;
      const sourceControl = await readCognitionSourceControl(userId, { kind: 'conversation', id: cid });
      if (sourceControl && sourceControl.availability !== 'active') {
        delete pendingRanges[cursorKey];
        cursors[cursorKey] = { state: 'ignored', updatedAt: startedAt }; await persist(); counters.skipped += 1; continue;
      }
      if (!isQuiescent(userId, cid)) {
        cursors[cursorKey] = { ...(cursors[cursorKey] || {}), state: 'deferred', updatedAt: startedAt };
        await persist(); counters.deferred += 1; continue;
      }
      let dayMessages: GroupMessage[];
      let conversation;
      try {
        conversation = await chats.getConversation(userId, cid);
        if (!conversation) {
          delete pendingRanges[cursorKey];
          cursors[cursorKey] = { state: 'ignored', errorCode: 'source_removed', updatedAt: startedAt };
          await persist(); counters.skipped += 1; continue;
        }
        dayMessages = await readReviewDayMessages(userId, cid, rangeDay.start, rangeDay.end, true);
      }
      catch {
        cursors[cursorKey] = { ...(cursors[cursorKey] || {}), state: 'deferred', errorCode: 'source_unavailable', updatedAt: startedAt };
        await persist(); counters.deferred += 1; continue;
      }
      const contextMessages = dayMessages.filter(message => timestampMs(message.ts) < rangeDay.start.getTime());
      dayMessages = dayMessages.filter(message => timestampMs(message.ts) >= rangeDay.start.getTime());
      const covered = new Set(captures.filter(capture => capture.conversationId === cid
        && capture.executionPolicy === 'nightly' && capture.reviewDay === rangeDay.key
        && (!pending.feedbackRevision || capture.feedbackRevision === pending.feedbackRevision)).flatMap(capture => capture.messageIds));
      const cursor = cursors[cursorKey];
      if (cursor?.throughMessageId) {
        const through = dayMessages.findIndex(message => message.id === cursor.throughMessageId);
        if (through >= 0) dayMessages.slice(0, through + 1).forEach(message => covered.add(message.id));
      }
      const fresh = dayMessages.filter(message => !covered.has(message.id));
      if (!fresh.length) {
        const existing = pending.feedbackRevision && captures.find(item => item.feedbackRevision === pending.feedbackRevision && item.conversationId === cid);
        if (existing) for (const observation of pending.feedbackObservations || []) await admitNightlyFeedback(userId, observation, existing.id);
        delete pendingRanges[cursorKey]; await persist(); counters.skipped += 1; continue;
      }
      if (!await canContinue()) break;
      const currentSourceControl = await readCognitionSourceControl(userId, { kind: 'conversation', id: cid });
      if (currentSourceControl && currentSourceControl.availability !== 'active') {
        delete pendingRanges[cursorKey]; await persist(); counters.skipped += 1; continue;
      }
      // One frozen daily range keeps later corrections with earlier statements.
      // Model budgets are enforced by the complete-source summary chunker.
      {
        const range = fresh;
        const selected = selectCaptureMessages([...contextMessages, ...range], 0, Number.MAX_SAFE_INTEGER)
          .map(message => ({ ...message, discovery: range.some(freshMessage => freshMessage.id === message.id) }));
        const newMessages = selected.filter(message => message.discovery);
        const screening = screenRecallCaptureValue(newMessages.some(message => message.role === 'user') ? newMessages : selected);
        const now = new Date().toISOString();
        const record: RecallCaptureRecord = {
          schemaVersion: 1, taxonomyVersion: 2, ownerId: userId,
          id: `capture-${createHash('sha256').update(JSON.stringify([cid, range.map(message => message.id), ...(pending.feedbackRevision ? [pending.feedbackRevision] : [])])).digest('hex').slice(0, 32)}`,
          conversationId: cid, ...(conversation.title ? { conversationTitle: conversation.title } : {}),
          terminalRunId: nightSweepRunId(pending.ranForWindow), anchorMessageId: range[0].id,
          messageIds: range.map(message => message.id), reviewDay: rangeDay.key, lastAttemptReviewDay: day.key,
          reviewDayStart: pending.start, reviewDayEnd: pending.end,
          ...(pending.feedbackRevision ? { feedbackRevision: pending.feedbackRevision, feedbackObservations: pending.feedbackObservations } : {}),
          ...(contextMessages.length ? { contextMessageIds: contextMessages.map(message => message.id) } : {}),
          status: screening.eligible || pending.feedbackRevision ? 'queued' : 'no_candidate', visibility: 'internal',
          screeningStatus: screening.eligible || pending.feedbackRevision ? 'pending' : 'filtered', screeningSignals: screening.signals,
          ...(screening.eligible || pending.feedbackRevision ? {} : { filterReason: screening.reason || 'low_reuse_value', screenedAt: now, finishedAt: now }),
          executionPolicy: 'nightly', attempt: 1, candidateIds: [], createdAt: now, updatedAt: now,
        };
        const stored = asCapture(await updateRecallJsonRecord(userId, CAPTURE_COLLECTION, record.id, current => current || record));
        captures.push(stored);
        for (const observation of pending.feedbackObservations || []) await admitNightlyFeedback(userId, observation, stored.id);
        await scheduleKnownRecallCapture(userId, stored);
        if (screening.eligible || pending.feedbackRevision) counters.queued += 1; else counters.skipped += 1;
      }
      const latest = fresh.at(-1)!;
      delete pendingRanges[cursorKey];
      cursors[cursorKey] = { state: 'covered', throughMessageId: latest.id, throughTs: latest.ts, updatedAt: startedAt };
      // Persist each admission's progress. A crash after capture save is deduped
      // by the immutable message IDs even if the cursor write has not happened.
      await persist();
    }
    const result: RecallNightlySweepResult = { pipelineVersion: 2, reviewDay: day.key, ranForWindow, finishedAt: new Date().toISOString(), ...counters };
    await persist(result);
    await bumpRecallCaptureStats(userId, { sweeps: 1, conversationsScanned: counters.scanned, retried: counters.retried }).catch(() => {});
    return { ran: true, ...result };
  } catch {
    const result: RecallNightlySweepResult = { pipelineVersion: 2, reviewDay: day.key, ranForWindow, finishedAt: new Date().toISOString(), ...counters, error: 'sweep_failed' };
    await persist(result).catch(() => {});
    return { ran: true, ...result };
  } finally {
    nightlySweepsInFlight.delete(userId);
    nightlySweepStartedAt.delete(userId);
    notifyCognitionWrite(userId, SWEEP_COLLECTION, 'update', NIGHTLY_SWEEP_ID);
  }
}

/** User-triggered discovery run: same admission, cursor and budget machinery
 * as the nightly window, started on demand instead of waiting for it. */
export async function runManualCaptureSweep(userId: string, signal?: AbortSignal): Promise<RecallNightlySweepRun> {
  const settings = await readRecallCaptureSettings(userId);
  if (!settings.enabled || settings.executionPolicy !== 'nightly') return { ran: false, reason: 'disabled' };
  if (nightlySweepsInFlight.has(userId)) return { ran: false, reason: 'sweep_in_flight' };
  const now = new Date();
  return runNightlyCaptureSweep(userId, `manual-${now.toISOString()}`, settings, signal,
    { manual: true, reviewDay: manualNightlyReviewDay(now, settings) });
}

export interface RecallCaptureSweepLoopHandle {
  stop(): void;
}

/** Low-frequency nightly admission; persistent message ranges prevent rework
 * while deferred/unreadable conversations resume their frozen range next night. */
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
        await runNightlyCaptureSweep(userId, windowKey, settings, signal);
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

/** Runtime lifecycle only; the daily sweep is the sole automatic producer. */
export function startRecallCaptureOrchestrator(): () => void {
  captureSchedulingEnabled = true;
  return () => {
    captureSchedulingEnabled = false;
    for (const task of scheduledCaptures.values()) task.cancel();
    scheduledCaptures.clear();
    captureScheduleAdmissions.clear();
  };
}
