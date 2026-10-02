/**
 * cognition_kernel/object-model — 统一认知库的对象模型（S3）。
 *
 * 四类内容里的三类在本库物理存储：
 *   assertion（关于我的断言）｜rule（规则）｜bundle（能力包：模板+方法）
 * experience 物理留 KSTAR 线、task_local 留项目作用域——两者只经 resolve()
 * 联合读，不进本库（B 路线总览 v0.2 §2.1 边界声明）。
 *
 * 生命周期语义吸收自 recall 资产线（版本链/软删/并入去向），断言语义吸收自
 * po v2 的 PoValue（asOf/verified/restricted/groupId+fieldName 槽位）。
 */

import type { ContentHome, DeltaEvidenceRef } from './types';

export type CognitionObjectKind = 'assertion' | 'rule' | 'bundle';
export type BundleKind = 'template' | 'method';
export type CognitionObjectStatus = 'active' | 'paused' | 'archived' | 'deleted';

export interface CognitionObject {
  id: string;
  kind: CognitionObjectKind;
  home: ContentHome;
  /** assertion：字段人类名；rule/bundle：标题。 */
  title: string;
  /** assertion：值文本；rule：判断语句；bundle：正文（结构/步骤）。 */
  statement: string;
  origin: string;
  status: CognitionObjectStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
  /** assertion 槽位（本体分组+字段）。 */
  groupId?: string;
  fieldName?: string;
  /** 信息截至年月 YYYY-MM。 */
  asOf?: string;
  verified?: boolean | 'independent';
  ruleKind?: 'operation' | 'preference' | 'constraint';
  applicableWhen?: string;
  forbiddenWhen?: string;
  bundleKind?: BundleKind;
  sensitivity?: 'normal' | 'sensitive';
  restricted?: boolean;
  project?: string;
  source?: string;
  scope?: string;
  evidenceRefs?: DeltaEvidenceRef[];
  /** 软删时间（remove 不物理清，purge 才清）。 */
  deletedAt?: string;
  /** 并入去向（merge 语义保留在版本链之外的事实指针）。 */
  mergedIntoId?: string;
}

export interface CognitionStoreDocument {
  schemaVersion: 1;
  objects: Record<string, CognitionObject>;
  /** 已落地 Delta 的精确重放索引：deltaId → true（有界 FIFO；防同一 Delta 双提交/崩溃重试双落地）。 */
  appliedDeltas: Record<string, true>;
  appliedOrder: string[];
  updatedAt: string;
}

export const COGNITION_STORE_SCHEMA_VERSION = 1 as const;
export const APPLIED_DELTA_INDEX_MAX = 500;

/** 家 → 本库物理形态；experience/task_local 返回 null（不在本库）。 */
export function homeToObjectShape(
  home: ContentHome,
): { kind: CognitionObjectKind; bundleKind?: BundleKind } | null {
  switch (home) {
    case 'personal_fact':
      return { kind: 'assertion' };
    case 'rule':
      return { kind: 'rule' };
    case 'template':
      return { kind: 'bundle', bundleKind: 'template' };
    case 'method':
      return { kind: 'bundle', bundleKind: 'method' };
    default:
      return null;
  }
}

export function emptyCognitionStore(): CognitionStoreDocument {
  return {
    schemaVersion: COGNITION_STORE_SCHEMA_VERSION,
    objects: {},
    appliedDeltas: {},
    appliedOrder: [],
    updatedAt: new Date().toISOString(),
  };
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function optionalStr(value: unknown): string | undefined {
  const s = str(value).trim();
  return s ? s : undefined;
}

/** 防御性归一：字段级容错（单字段坏不拖垮整档），形状不对的对象剔除。 */
export function normalizeCognitionObject(raw: unknown): CognitionObject | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id).trim();
  const kind = str(r.kind);
  if (!id || (kind !== 'assertion' && kind !== 'rule' && kind !== 'bundle')) return null;
  const status = str(r.status, 'active');
  return {
    id,
    kind,
    home: str(r.home) as ContentHome,
    title: str(r.title),
    statement: str(r.statement),
    origin: str(r.origin, 'import'),
    status: status === 'paused' || status === 'archived' || status === 'deleted' ? status : 'active',
    version: Number.isFinite(r.version) && (r.version as number) > 0 ? Math.floor(r.version as number) : 1,
    createdAt: str(r.createdAt, new Date().toISOString()),
    updatedAt: str(r.updatedAt, new Date().toISOString()),
    ...(optionalStr(r.groupId) ? { groupId: optionalStr(r.groupId) } : {}),
    ...(optionalStr(r.fieldName) ? { fieldName: optionalStr(r.fieldName) } : {}),
    ...(optionalStr(r.asOf) ? { asOf: optionalStr(r.asOf) } : {}),
    ...(r.verified === true || r.verified === 'independent' ? { verified: r.verified } : {}),
    ...(optionalStr(r.ruleKind) && ['operation', 'preference', 'constraint'].includes(str(r.ruleKind))
      ? { ruleKind: str(r.ruleKind) as CognitionObject['ruleKind'] }
      : {}),
    ...(optionalStr(r.applicableWhen) ? { applicableWhen: optionalStr(r.applicableWhen) } : {}),
    ...(optionalStr(r.forbiddenWhen) ? { forbiddenWhen: optionalStr(r.forbiddenWhen) } : {}),
    ...(optionalStr(r.bundleKind) && ['template', 'method'].includes(str(r.bundleKind))
      ? { bundleKind: str(r.bundleKind) as BundleKind }
      : {}),
    ...(r.sensitivity === 'sensitive' ? { sensitivity: 'sensitive' } : {}),
    ...(r.restricted === true ? { restricted: true } : {}),
    ...(optionalStr(r.project) ? { project: optionalStr(r.project) } : {}),
    ...(optionalStr(r.source) ? { source: optionalStr(r.source) } : {}),
    ...(optionalStr(r.scope) ? { scope: optionalStr(r.scope) } : {}),
    ...(Array.isArray(r.evidenceRefs) ? { evidenceRefs: r.evidenceRefs as DeltaEvidenceRef[] } : {}),
    ...(optionalStr(r.deletedAt) ? { deletedAt: optionalStr(r.deletedAt) } : {}),
    ...(optionalStr(r.mergedIntoId) ? { mergedIntoId: optionalStr(r.mergedIntoId) } : {}),
  };
}

export function normalizeCognitionStoreDocument(raw: unknown): CognitionStoreDocument {
  const doc = emptyCognitionStore();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return doc;
  const r = raw as Record<string, unknown>;
  const objects: Record<string, CognitionObject> = {};
  if (r.objects && typeof r.objects === 'object' && !Array.isArray(r.objects)) {
    for (const [id, value] of Object.entries(r.objects as Record<string, unknown>)) {
      const normalized = normalizeCognitionObject(value);
      if (normalized && normalized.id === id) objects[id] = normalized;
    }
  }
  if (r.appliedDeltas && typeof r.appliedDeltas === 'object' && !Array.isArray(r.appliedDeltas)) {
    for (const deltaId of Object.keys(r.appliedDeltas as Record<string, unknown>)) {
      if (deltaId) {
        doc.appliedDeltas[deltaId] = true;
        doc.appliedOrder.push(deltaId);
      }
    }
  }
  doc.updatedAt = str(r.updatedAt, doc.updatedAt);
  return { ...doc, objects };
}

/** assertion 槽位寻址：同 (groupId, fieldName) 只有一条活对象。 */
export function findAssertionSlot(
  doc: CognitionStoreDocument,
  groupId: string | undefined,
  fieldName: string,
): CognitionObject | undefined {
  const gid = groupId ?? '';
  return Object.values(doc.objects).find(
    (o) =>
      o.kind === 'assertion' &&
      o.status !== 'deleted' &&
      (o.groupId ?? '') === gid &&
      o.fieldName === fieldName,
  );
}
