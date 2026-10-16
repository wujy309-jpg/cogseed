import { createHash } from 'node:crypto';

import { nowIso, safeId } from '../../storage';
import { fileEditLock } from '../../util/locks';
import { readInjectionReceipt } from './injection-receipt';
import { recallJsonlPath } from './paths';
import {
  normalizeCognitionSourceRefsForWrite,
  type CognitionSourceRef,
} from './source-service';
import { appendRecallJsonlRecord, listRecallJsonlRecords, readRecallJsonRecord } from './store';
import type { RecallJsonRecord } from './types';
import type { RuntimeResultSource } from './runtime-result-content';
import type { PersistedResultContent, PersistedResultEvidence } from './persisted-result-content';

/** 主动读取（agent_read）没有投影授权，采用回执的 projectionId 用这个常量
 *  占位：读取侧据此区分「投影供应」与「模型本轮主动读正文」两条带入通道，
 *  回执幂等键也保持确定。 */
export const AGENT_READ_PROJECTION_ID = 'agent-read';
export const RUNTIME_PROJECTION_ID = 'runtime-task';

export type AssetUsageStatus =
  | 'applied'
  | 'considered_not_applicable'
  | 'available_no_opportunity'
  | 'contradicted'
  | 'usage_unknown';

export type AssetUsageEvidenceKind = 'tool_call' | 'agent_action' | 'artifact' | 'final_output' | 'none';
export type AssetUsageBoundary = 'real' | 'degraded' | 'test-double';
export type AssetUsageReportFailure = 'quote_not_found' | 'result_unavailable' | 'result_changed';

/** Optional for historical receipts. Model reports and persisted-result checks
 * have distinct authority; hashes bind both observations to the same output. */
export interface AssetUsageObservation {
  observationMethod?: 'agent_reported' | 'model_assisted' | 'result_coverage';
  messageId?: string;
  outputHash?: string;
  outputCheckReceiptId?: string;
  /** Host-grounded failure of a self-report, not a finding of non-use. */
  reportFailure?: AssetUsageReportFailure;
  resultRefs?: PersistedResultContent['refs'];
  resultCoverage?: PersistedResultContent['coverage'];
  outputEvidence?: PersistedResultEvidence;
  /** Host Runtime coordinates, not a fabricated conversation message. */
  resultSource?: RuntimeResultSource;
}

export interface AssetUsageReceipt extends RecallJsonRecord, AssetUsageObservation {
  schemaVersion: 1;
  taskRunId: string;
  projectionId: string;
  assetId: string;
  assetVersion: string;
  injectionReceiptId: string;
  status: AssetUsageStatus;
  evidenceRefs: CognitionSourceRef[];
  evidenceKind: AssetUsageEvidenceKind;
  boundary: AssetUsageBoundary;
  reason?: string;
  createdAt: string;
}

export interface RecordAssetUsageReceiptInput extends AssetUsageObservation {
  taskRunId: string;
  projectionId: string;
  assetId: string;
  assetVersion: string;
  injectionReceiptId: string;
  status: AssetUsageStatus;
  evidenceRefs?: unknown[];
  evidenceKind: AssetUsageEvidenceKind;
  boundary: AssetUsageBoundary;
  reason?: string;
}

const USAGE_STATUSES = new Set<AssetUsageStatus>([
  'applied',
  'considered_not_applicable',
  'available_no_opportunity',
  'contradicted',
  'usage_unknown',
]);
const EVIDENCE_KINDS = new Set<AssetUsageEvidenceKind>([
  'tool_call',
  'agent_action',
  'artifact',
  'final_output',
  'none',
]);
const BOUNDARIES = new Set<AssetUsageBoundary>(['real', 'degraded', 'test-double']);
const EVIDENCE_REQUIRED = new Set<AssetUsageStatus>(['applied', 'considered_not_applicable', 'contradicted']);
const REPORT_FAILURES = new Set<AssetUsageReportFailure>(['quote_not_found', 'result_unavailable', 'result_changed']);

function compactReason(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const compacted = value.replace(/\s+/g, ' ').trim();
  return compacted ? compacted.slice(0, 240) : undefined;
}

function assertSafeInput(userId: string, input: RecordAssetUsageReceiptInput): void {
  if (
    !safeId(userId)
    || !safeId(input.taskRunId)
    || !safeId(input.projectionId)
    || !safeId(input.assetId)
    || !safeId(input.injectionReceiptId)
    || typeof input.assetVersion !== 'string'
    || !input.assetVersion.trim()
    || input.assetVersion.length > 80
    || !USAGE_STATUSES.has(input.status)
    || !EVIDENCE_KINDS.has(input.evidenceKind)
    || !BOUNDARIES.has(input.boundary)
  ) throw new Error('invalid asset usage receipt reference');
  assertObservation(input);
}

function assertObservation(input: RecordAssetUsageReceiptInput): void {
  const hasResultEvidence = input.resultRefs !== undefined || input.resultCoverage !== undefined || input.outputEvidence !== undefined;
  if (input.reportFailure !== undefined && (input.observationMethod !== 'agent_reported' || input.status !== 'usage_unknown'
    || !REPORT_FAILURES.has(input.reportFailure))) throw new Error('invalid asset usage report failure');
  if (hasResultEvidence) {
    if (input.observationMethod !== 'agent_reported' || !Array.isArray(input.resultRefs) || !input.resultCoverage
      || typeof input.resultCoverage.complete !== 'boolean' || !Number.isSafeInteger(input.resultCoverage.totalFiles)
      || !Number.isSafeInteger(input.resultCoverage.readableFiles) || input.resultCoverage.readableFiles < 0
      || input.resultCoverage.readableFiles > input.resultCoverage.totalFiles) throw new Error('invalid asset usage result references');
    for (const ref of input.resultRefs) {
      if (!ref || !['message', 'file'].includes(ref.kind) || !safeId(ref.id) || !['readable', 'unverified'].includes(ref.status)
        || [ref.contentHash, ref.sourceHash].some(hash => hash !== undefined && !/^[a-f0-9]{64}$/.test(hash))
        || ref.contentRange && (!Number.isSafeInteger(ref.contentRange.start) || !Number.isSafeInteger(ref.contentRange.end)
          || ref.contentRange.start < 0 || ref.contentRange.end < ref.contentRange.start)) throw new Error('invalid asset usage result reference');
    }
    if (input.outputEvidence) {
      const evidence = input.outputEvidence, ref = input.resultRefs.find(row => row.id === evidence.refId);
      if (input.status !== 'applied' || !ref?.contentRange || ref.status !== 'readable'
        || !Number.isSafeInteger(evidence.start) || !Number.isSafeInteger(evidence.end)
        || evidence.start < ref.contentRange.start || evidence.end > ref.contentRange.end || evidence.end <= evidence.start)
        throw new Error('invalid asset usage result evidence');
    }
  }
  if (input.resultSource && (input.resultSource.kind !== 'runtime_terminal'
    || ![input.resultSource.taskId, input.resultSource.runId, input.resultSource.requestId, input.resultSource.runtimeSessionId].every(safeId)
    || input.resultSource.taskId !== input.taskRunId || input.observationMethod !== 'model_assisted')) throw new Error('invalid runtime usage result source');
  if (input.observationMethod === undefined) {
    if (input.messageId !== undefined || input.outputHash !== undefined || input.outputCheckReceiptId !== undefined) {
      throw new Error('asset usage observation method is required');
    }
    return;
  }
  if (!['agent_reported', 'model_assisted', 'result_coverage'].includes(input.observationMethod)
    || typeof input.messageId !== 'string' || !safeId(input.messageId)
    || typeof input.outputHash !== 'string' || !/^[a-f0-9]{64}$/.test(input.outputHash)
    || input.evidenceKind !== 'final_output' || input.boundary !== 'real'
    || (input.observationMethod === 'agent_reported'
      ? !['applied', 'usage_unknown'].includes(input.status) || input.outputCheckReceiptId !== undefined
        || (input.status === 'usage_unknown' ? !input.reportFailure : input.reportFailure !== undefined)
      : !['applied', 'usage_unknown'].includes(input.status)
        || typeof input.outputCheckReceiptId !== 'string' || !/^coc-[a-f0-9]{24}$/.test(input.outputCheckReceiptId))) {
    throw new Error('invalid asset usage observation');
  }
}

/** A caller's label is insufficient: completed checks must already be stored by
 * the persisted-output checker and resolve this exact asset/version/result. */
function validCheckCoordinates(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const coordinates = value as Record<string, unknown>;
  return Object.keys(coordinates).length === 2
    && Object.keys(coordinates).every(key => key === 'start' || key === 'end')
    && Number.isSafeInteger(coordinates.start) && Number.isSafeInteger(coordinates.end)
    && Number(coordinates.start) >= 0 && Number(coordinates.end) > Number(coordinates.start);
}

async function verifyOutputObservation(userId: string, input: RecordAssetUsageReceiptInput): Promise<void> {
  if (!['model_assisted', 'result_coverage'].includes(String(input.observationMethod))) return;
  const check = await readRecallJsonRecord(userId, 'output-checks', input.outputCheckReceiptId!);
  const resultCoverage = check?.resultCoverage as { complete?: boolean; totalFiles?: number } | undefined;
  const rows = Array.isArray(check?.checks) ? check.checks : [];
  const matching = rows.filter(row => row && typeof row === 'object'
    && row.assetId === input.assetId && row.version === input.assetVersion);
  const row = matching[0];
  // Coordinates were resolved against actual text before the completed checker
  // proof was persisted. This ledger does not retain or invent task/output text.
  // An evidence-free unknown only withdraws a self-report; it proves no absence
  // of use, contradiction, or effectiveness.
  const validRow = row && !Array.isArray(row)
    && Object.keys(row).every(key => ['assetId', 'version', 'status', 'outputEvidence', 'taskEvidence'].includes(key))
    && (row.outputEvidence === undefined || validCheckCoordinates(row.outputEvidence))
    && (row.taskEvidence === undefined || validCheckCoordinates(row.taskEvidence))
    && (input.status === 'applied'
      ? row.status === 'complied' && validCheckCoordinates(row.outputEvidence)
      : (row.status === 'not_complied' && validCheckCoordinates(row.outputEvidence))
        || row.status === 'unknown'
        || (row.status === 'not_applicable' && validCheckCoordinates(row.taskEvidence)));
  if (!check || check.schemaVersion !== 1 || check.ownerId !== userId
    || check.method !== 'model_assisted'
    || (input.observationMethod === 'result_coverage'
      ? input.status !== 'usage_unknown' || row?.status !== 'unknown' || resultCoverage?.complete !== false
      : check.modelCompleted !== true)
    || check.taskRunId !== input.taskRunId || check.messageId !== input.messageId
    || check.outputHash !== input.outputHash || typeof check.taskHash !== 'string'
    || JSON.stringify(check.resultSource) !== JSON.stringify(input.resultSource)
    || !/^[a-f0-9]{64}$/.test(check.taskHash)
    || check.id !== `coc-${createHash('sha256').update(JSON.stringify([
      input.taskRunId, input.messageId, input.outputHash, check.taskHash,
      ...(resultCoverage?.totalFiles ? [createHash('sha256').update(JSON.stringify([check.resultRefs, check.resultCoverage])).digest('hex')] : []),
      ...(input.resultSource ? [input.resultSource] : []),
    ])).digest('hex').slice(0, 24)}` || matching.length !== 1
    || !validRow) {
    throw new Error('asset usage output check does not match observation');
  }
}

function normalizeEvidence(input: RecordAssetUsageReceiptInput): CognitionSourceRef[] {
  const evidenceRefs = normalizeCognitionSourceRefsForWrite(Array.isArray(input.evidenceRefs) ? input.evidenceRefs : []);
  if (EVIDENCE_REQUIRED.has(input.status) && (!evidenceRefs.length || input.evidenceKind === 'none')) {
    throw new Error('asset usage evidence is required');
  }
  if (input.evidenceKind === 'none' && evidenceRefs.length) {
    throw new Error('asset usage evidence kind does not match evidence');
  }
  if (input.observationMethod && !(input.resultSource
    ? evidenceRefs.some(ref => ref.kind === 'execution' && ref.id === input.resultSource!.runId)
    : evidenceRefs.some(ref => ref.kind === 'message' && ref.id === input.messageId))) {
    throw new Error('asset usage observation needs its final message evidence');
  }
  return evidenceRefs;
}

function receiptId(input: Pick<RecordAssetUsageReceiptInput, 'taskRunId' | 'projectionId' | 'assetId' | 'assetVersion'>): string {
  const key = JSON.stringify([input.taskRunId, input.projectionId, input.assetId, input.assetVersion]);
  return `aur-${createHash('sha256').update(key).digest('hex').slice(0, 24)}`;
}

function asAssetUsageReceipt(userId: string, value: RecallJsonRecord): AssetUsageReceipt {
  const input = value as unknown as RecordAssetUsageReceiptInput;
  assertSafeInput(userId, input);
  if (
    value.schemaVersion !== 1
    || value.ownerId !== userId
    // Historical schema-v1 receipts used a different deterministic key
    // derivation. The id is an opaque event key, not an authorization input;
    // keep old records readable while still requiring the current safe format.
    || typeof value.id !== 'string'
    || !/^aur-[a-f0-9]{24}$/.test(value.id)
    || !Array.isArray(value.evidenceRefs)
    || typeof value.createdAt !== 'string'
    || (value.reason !== undefined && typeof value.reason !== 'string')
  ) throw new Error('malformed asset usage receipt');
  const evidenceRefs = normalizeEvidence(input);
  if (evidenceRefs.length !== value.evidenceRefs.length) throw new Error('malformed asset usage receipt');
  // Normalize historical key derivations in memory. This lets a later
  // contradicted receipt replace the same logical usage event and prevents
  // old and current ids from being counted as two separate events.
  return { ...value, id: receiptId(input), evidenceRefs } as AssetUsageReceipt;
}

export async function recordAssetUsageReceipt(
  userId: string,
  input: RecordAssetUsageReceiptInput,
): Promise<AssetUsageReceipt> {
  assertSafeInput(userId, input);
  const evidenceRefs = normalizeEvidence(input);
  const injection = await readInjectionReceipt(userId, input.injectionReceiptId);
  if (!injection) throw new Error('injection receipt not found');
  if (
    injection.taskRunId !== input.taskRunId
    || injection.assetId !== input.assetId
    || injection.assetVersion !== input.assetVersion
  ) throw new Error('injection receipt does not match asset usage');
  // agent_read 回执在工具调用时写入，天然没有投影 id；只对这个通道放行
  // 常量占位符，其余回执仍要求投影 id 逐字相等。
  const projectionIdMatchesInjection = injection.channel === 'agent_read' && injection.projectionId === undefined
    ? input.projectionId === AGENT_READ_PROJECTION_ID
    : injection.channel === 'runtime' && injection.projectionId === undefined
      ? input.projectionId === RUNTIME_PROJECTION_ID && !!input.resultSource
    : injection.projectionId === input.projectionId;
  if (!projectionIdMatchesInjection) throw new Error('injection receipt does not match asset usage');
  if (injection.status !== 'injected' && injection.status !== 'dispatched') {
    throw new Error('injection receipt did not inject asset');
  }
  if (injection.boundary !== input.boundary) throw new Error('injection receipt boundary mismatch');
  if (input.observationMethod && injection.channel !== 'agent_read' && injection.messageId !== input.messageId) {
    throw new Error('injection receipt does not match final output observation');
  }
  await verifyOutputObservation(userId, input);

  const id = receiptId(input);
  const reasonText = compactReason(input.reason);
  const record: AssetUsageReceipt = {
    schemaVersion: 1,
    ownerId: userId,
    id,
    taskRunId: input.taskRunId,
    projectionId: input.projectionId,
    assetId: input.assetId,
    assetVersion: input.assetVersion,
    injectionReceiptId: input.injectionReceiptId,
    status: input.status,
    evidenceRefs,
    evidenceKind: input.evidenceKind,
    boundary: input.boundary,
    ...(input.observationMethod ? {
      observationMethod: input.observationMethod, messageId: input.messageId, outputHash: input.outputHash,
      ...(input.outputCheckReceiptId ? { outputCheckReceiptId: input.outputCheckReceiptId } : {}),
      ...(input.reportFailure ? { reportFailure: input.reportFailure } : {}),
      ...(input.resultRefs ? { resultRefs: input.resultRefs, resultCoverage: input.resultCoverage } : {}),
      ...(input.outputEvidence ? { outputEvidence: input.outputEvidence } : {}),
      ...(input.resultSource ? { resultSource: input.resultSource } : {}),
    } : {}),
    ...(reasonText ? { reason: reasonText } : {}),
    createdAt: nowIso(),
  };

  const streamPath = recallJsonlPath(userId, 'asset-usage-receipts', 'events');
  return fileEditLock(streamPath).runExclusive(async () => {
    const existing = (await listAssetUsageReceipts(userId)).find((item) => item.id === id);
    if (existing) {
      // Only an independently persisted check may correct the model's earlier
      // self-report, and only for the same injected version and exact output.
      // Legacy receipts have no provenance and must not be guessed from prose.
      if (['applied', 'usage_unknown'].includes(existing.status) && existing.observationMethod === 'agent_reported'
        && ['model_assisted', 'result_coverage'].includes(String(input.observationMethod)) && input.status === 'usage_unknown'
        && existing.injectionReceiptId === input.injectionReceiptId
        && existing.messageId === input.messageId
        && (existing.outputHash === input.outputHash || input.observationMethod === 'result_coverage')) {
        await appendRecallJsonlRecord(userId, 'asset-usage-receipts', 'events', record);
        return record;
      }
      // A later message-bound explicit report can resolve an unknown event.
      // Never override user contradiction, or manufacture an effect proof.
      if (existing.status === 'usage_unknown' && input.status === 'applied'
        && input.evidenceKind === 'final_output' && input.boundary === 'real'
        // A delayed self-report cannot erase a completed independent check.
        && !['model_assisted', 'result_coverage'].includes(String(existing.observationMethod))
        && (existing.observationMethod !== 'agent_reported'
          || existing.injectionReceiptId === input.injectionReceiptId && existing.messageId === input.messageId && existing.outputHash === input.outputHash)) {
        await appendRecallJsonlRecord(userId, 'asset-usage-receipts', 'events', record);
        return record;
      }
      // 用户明确否定的 contradicted 可覆盖同键自动回执，读取同 id 的最后一条。
      if (input.status === 'contradicted' && existing.status !== 'contradicted') {
        await appendRecallJsonlRecord(userId, 'asset-usage-receipts', 'events', record);
        return record;
      }
      return existing;
    }
    await appendRecallJsonlRecord(userId, 'asset-usage-receipts', 'events', record);
    return record;
  });
}

export async function listAssetUsageReceipts(userId: string, taskRunId?: string): Promise<AssetUsageReceipt[]> {
  if (!safeId(userId) || (taskRunId !== undefined && !safeId(taskRunId))) {
    throw new Error('invalid asset usage receipt reference');
  }
  const records = (await listRecallJsonlRecords(userId, 'asset-usage-receipts', 'events', 0))
    .map((record) => asAssetUsageReceipt(userId, record));
  // 同 id 多条（负反馈覆盖 append 的产物）取末条：JSONL 顺序即写入顺序，
  // 消费方（run-evidence / task-closure / trace）只见最终状态，不双计。
  const latest = new Map<string, AssetUsageReceipt>();
  for (const record of records) latest.set(record.id, record);
  return [...latest.values()].filter((record) => taskRunId === undefined || record.taskRunId === taskRunId);
}

/** 「实际采用」证据查询。**只读、零写入。**
 *
 *  采用判据：只有 usage 回执同时满足
 *  `status === 'applied'` **且** `boundary === 'real'` 才算「实际采用」；
 *  `injected`/`dispatched`（注入回执）只是「被带入」，**不构成采用**；
 *  `considered_not_applicable`/`available_no_opportunity`/`contradicted`/
 *  `usage_unknown` 同样不构成采用依据——以上一律不出现在结果里。
 *
 *  读法复用 `listAssetUsageReceipts`（同 id 取末条：负反馈覆盖 append 的产物
 *  只留最终状态，不双计），不另写第二套判定；`taskRunIds` 为空数组返回空列表
 *  （**不是**全量）。结果顺序遵循流内首次出现顺序，不做额外排序。 */
export interface AppliedUsageReceipt {
  id: string;
  assetId: string;
  assetVersion: string;
  taskRunId: string;
  evidenceRefs: CognitionSourceRef[];
}

export async function listAppliedUsageReceipts(
  userId: string,
  query: { taskRunIds: string[]; assetId?: string },
): Promise<AppliedUsageReceipt[]> {
  if (
    !safeId(userId)
    || !query || typeof query !== 'object'
    || !Array.isArray(query.taskRunIds)
    || query.taskRunIds.some((taskRunId) => !safeId(taskRunId))
    || (query.assetId !== undefined && !safeId(query.assetId))
  ) throw new Error('invalid asset usage receipt query');
  const taskRunIds = new Set(query.taskRunIds);
  if (!taskRunIds.size) return [];
  return (await listAssetUsageReceipts(userId))
    .filter((receipt) => receipt.status === 'applied' && receipt.boundary === 'real')
    .filter((receipt) => taskRunIds.has(receipt.taskRunId))
    .filter((receipt) => query.assetId === undefined || receipt.assetId === query.assetId)
    .map((receipt) => ({
      id: receipt.id,
      assetId: receipt.assetId,
      assetVersion: receipt.assetVersion,
      taskRunId: receipt.taskRunId,
      evidenceRefs: [...receipt.evidenceRefs],
    }));
}

/** 采用回执的**视图投影**：资产详情要显示
 *  「实际采用」的逐条记录——同次任务、具体版本、执行事件类型、产物位置。回执本身
 *  只按 taskRunId 过滤，这里按 assetId 取（与 `listAbilityAssetVersionsWithUsage`
 *  同一读法：全量读后过滤，量级相同）。**只透传 ref 的 kind/id/title**，不含
 *  excerpt、不含绝对路径、不含资产正文——可读名由渲染层唯一解析器负责。 */
export interface AssetUsageReceiptView {
  observationMethod?: AssetUsageObservation['observationMethod'];
  reportFailure?: AssetUsageReportFailure;
  id: string;
  assetVersion: string;
  taskRunId: string;
  status: AssetUsageStatus;
  evidenceKind: AssetUsageEvidenceKind;
  evidence: Array<{ kind: string; id: string; title?: string }>;
  boundary: AssetUsageBoundary;
  createdAt: string;
}

export async function listAssetUsageReceiptViews(
  userId: string,
  assetId: string,
  limit = 50,
): Promise<AssetUsageReceiptView[]> {
  if (!safeId(userId) || !safeId(assetId)) throw new Error('invalid asset usage receipt query');
  const bounded = Number.isFinite(limit) ? Math.max(1, Math.min(200, Math.floor(limit))) : 50;
  return (await listAssetUsageReceipts(userId))
    .filter((receipt) => String(receipt.assetId || '') === assetId)
    .sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')))
    .slice(0, bounded)
    .map((receipt) => ({
      id: receipt.id,
      assetVersion: String(receipt.assetVersion || ''),
      taskRunId: String(receipt.taskRunId || ''),
      status: receipt.status,
      ...(receipt.observationMethod ? { observationMethod: receipt.observationMethod } : {}),
      ...(receipt.reportFailure ? { reportFailure: receipt.reportFailure } : {}),
      evidenceKind: receipt.evidenceKind,
      evidence: (receipt.evidenceRefs || []).slice(0, 5).map((ref) => ({
        kind: String(ref.kind || ''),
        id: String(ref.id || ''),
        ...(ref.title ? { title: String(ref.title) } : {}),
      })),
      boundary: receipt.boundary,
      createdAt: String(receipt.createdAt || ''),
    }));
}
