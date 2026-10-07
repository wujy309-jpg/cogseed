/**
 * cognition_kernel/bound_receipt — 绑定回执（438 P0，2026-10-07）。
 *
 * 六级证据刻度（retrieved→eligible→bound→projected→consumed→effective）中
 * bound 档的落盘载体：personal_fields_check 每次真实体检后，把"这次任务绑到了
 * 哪些字段值（assetId@version 指针）、还缺哪些槽（四因）"记成一条 JSONL。
 *
 * 纪律（沿用 query-receipt 家规）：
 *   - 只存指针与版本，绝不存字段值或提问正文（value/asOf/updatedAt 不进回执）；
 *   - 无真实回合（turnId）不记录；
 *   - 写时严格校验、读时宽松跳过坏档；
 *   - 回执失败只 warn，不阻断工具结果（接线处保证）。
 *
 * P1 计划：axis 扩到 ontology/asset 两轴、taskRunId 换真实运行 ID；P2 补
 * filled 事件（缺口问答回填后闭环可度量）。填写回执是记账，不是准入——
 * 不证明投影、采用或执行。
 */

import { genId12, safeId } from '../../storage';
import { appendRecallJsonlRecord, listRecallJsonlRecords } from '../recall/store';
import type { RecallJsonRecord } from '../recall/types';
import type { MissingReason, PersonalFieldSource } from './types';
import type { TaskFieldCheck } from './gap';

const COLLECTION = 'cognition-bound-receipts';
const FILE_KEY = 'events';
const MAX_SLOTS = 64;
const ID_PATTERN = /^cbound-[A-Za-z0-9_-]{8,40}$/;
const MISSING_REASONS: readonly MissingReason[] = ['no_value', 'restricted', 'not_authorized', 'stale'];

export interface BoundSlotRef {
  slot: string;
  axis: 'personal';
  source: PersonalFieldSource;
  /** 值的权威指针（PoValue.id 或 asset.id）——只存指针，不存值文本。 */
  sourceId: string;
  version?: string;
  revision?: string;
}

export interface MissingSlotRef {
  slot: string;
  axis: 'personal';
  reason: MissingReason;
  required: boolean;
}

export interface CognitionBoundReceipt extends RecallJsonRecord {
  schemaVersion: 1;
  /** P0 以对话回合 ID 充当运行标识；P1 换真实 taskRunId 后旧回执仍按此字段读。 */
  taskRunId: string;
  packId: string;
  status: 'checked';
  policyVersion: string;
  bound: BoundSlotRef[];
  missing: MissingSlotRef[];
  boundCount: number;
  totalCount: number;
  createdAt: string;
}

function validSlot(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 60;
}

function toBoundRef(field: { fieldName: string; source: PersonalFieldSource; sourceId: string; version?: string; revision?: string }): BoundSlotRef {
  if (!validSlot(field.fieldName) || !validSlot(field.source) || !validSlot(field.sourceId)) {
    throw new Error('invalid bound slot reference');
  }
  return {
    slot: field.fieldName,
    axis: 'personal',
    source: field.source,
    sourceId: field.sourceId,
    ...(field.version ? { version: field.version } : {}),
    ...(field.revision ? { revision: field.revision } : {}),
  };
}

function toMissingRef(field: { fieldName: string; reason: MissingReason; required: boolean }): MissingSlotRef {
  if (!validSlot(field.fieldName) || !MISSING_REASONS.includes(field.reason)) {
    throw new Error('invalid missing slot reference');
  }
  return { slot: field.fieldName, axis: 'personal', reason: field.reason, required: field.required === true };
}

/** 读侧校验：输入已是落盘的 BoundSlotRef 形状（slot/source/sourceId），不是 resolve 的原始字段。 */
function parseBoundRef(value: unknown): BoundSlotRef {
  if (!value || typeof value !== 'object') throw new Error('invalid bound slot reference');
  const ref = value as Record<string, unknown>;
  if (!validSlot(ref.slot) || ref.axis !== 'personal' || !validSlot(ref.source) || !validSlot(ref.sourceId)) {
    throw new Error('invalid bound slot reference');
  }
  if (ref.version !== undefined && !validSlot(ref.version)) throw new Error('invalid bound slot reference');
  if (ref.revision !== undefined && !validSlot(ref.revision)) throw new Error('invalid bound slot reference');
  return {
    slot: ref.slot,
    axis: 'personal',
    source: ref.source as PersonalFieldSource,
    sourceId: ref.sourceId,
    ...(ref.version ? { version: ref.version as string } : {}),
    ...(ref.revision ? { revision: ref.revision as string } : {}),
  };
}

/** 读侧校验：输入已是落盘的 MissingSlotRef 形状。 */
function parseMissingRef(value: unknown): MissingSlotRef {
  if (!value || typeof value !== 'object') throw new Error('invalid missing slot reference');
  const ref = value as Record<string, unknown>;
  if (!validSlot(ref.slot) || ref.axis !== 'personal' || !MISSING_REASONS.includes(ref.reason as MissingReason)) {
    throw new Error('invalid missing slot reference');
  }
  return { slot: ref.slot, axis: 'personal', reason: ref.reason as MissingReason, required: ref.required === true };
}

/** 无真实回合不记账；包为空或槽位超限拒绝写（宁可不记也不记半截）。 */
export async function recordCognitionBoundReceipt(
  userId: string,
  turnId: string | undefined,
  packId: string,
  check: TaskFieldCheck,
): Promise<CognitionBoundReceipt | undefined> {
  if (!turnId) return undefined;
  if (!safeId(userId) || !safeId(turnId) || !validSlot(packId)) throw new Error('invalid cognition bound receipt owner or pack');
  const bound = check.resolution.bound.map(toBoundRef);
  const missing = check.resolution.missing.map(toMissingRef);
  if (bound.length + missing.length < 1) throw new Error('cognition bound receipt requires at least one slot');
  if (bound.length + missing.length > MAX_SLOTS) throw new Error('cognition bound receipt exceeds slot limit');
  const receipt: CognitionBoundReceipt = {
    schemaVersion: 1,
    ownerId: userId,
    id: `cbound-${genId12()}`,
    taskRunId: turnId,
    packId,
    status: 'checked',
    policyVersion: typeof check.resolution.policyVersion === 'string' ? check.resolution.policyVersion : '',
    bound,
    missing,
    boundCount: check.boundCount,
    totalCount: check.totalCount,
    createdAt: new Date().toISOString(),
  };
  await appendRecallJsonlRecord(userId, COLLECTION, FILE_KEY, receipt);
  return receipt;
}

/** 读回执（按回合过滤可选）；坏档跳过，不当作证据。 */
export async function listCognitionBoundReceipts(
  userId: string,
  taskRunId?: string,
): Promise<CognitionBoundReceipt[]> {
  if (!safeId(userId)) throw new Error('invalid cognition bound receipt owner');
  const values = await listRecallJsonlRecords(userId, COLLECTION, FILE_KEY, 0);
  const output: CognitionBoundReceipt[] = [];
  for (const value of values) {
    if (value.schemaVersion !== 1 || value.ownerId !== userId
      || typeof value.id !== 'string' || !ID_PATTERN.test(value.id)
      || value.status !== 'checked'
      || typeof value.taskRunId !== 'string' || typeof value.packId !== 'string'
      || typeof value.createdAt !== 'string'
      || !Array.isArray(value.bound) || !Array.isArray(value.missing)
      || value.bound.length + value.missing.length < 1 || value.bound.length + value.missing.length > MAX_SLOTS) continue;
    if (taskRunId && value.taskRunId !== taskRunId) continue;
    try {
      output.push({
        ...value,
        bound: value.bound.map(parseBoundRef),
        missing: value.missing.map(parseMissingRef),
      } as CognitionBoundReceipt);
    } catch { /* 历史坏档不是证据 */ }
  }
  return output;
}
