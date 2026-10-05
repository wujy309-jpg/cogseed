/**
 * cognition_kernel/gap — 缺口引擎与回填（S2）。
 *
 * 一次任务开工前的一圈：
 *   任务包声明要哪些字段 → 取件窗口（resolve.ts）算"已有/缺" → 缺的转成一次提问
 *   → 用户答完 → 按来源回填档案（正式资产/手编本体交给其拥有者，普通内核字段用
 *     origin='gap'、status='applied' 的 Delta）
 *   → 同一个任务再跑，缺口消失。
 *
 * 分工：本文件只做"算缺口 + 回填"；取值的规则全在 resolve.ts，受管来源不能
 * 直接通过 Delta 改写。统一存储桥保持正式业务记录与派生对象一致；普通回填
 * 断言按 fieldName 寻址。来源、版本或治理状态变化时要求重新检查。
 */

import { buildDelta } from './delta';
import { resolvePersonalFields } from './resolve';
import type { TaskFieldPack } from './task_field_packs';
import type {
  CognitionDelta,
  DeltaEvidenceRef,
  MissingReason,
  PersonalFieldResolution,
  ResolvePersonalFieldsRequest,
} from './types';

import { withCognitionTransition } from '../cognition_bridge';

export interface FieldGap {
  fieldName: string;
  groupId?: string;
  required: boolean;
  /** 为什么缺——直接来自取件窗口，四种原因对应四种不同的用户动作。 */
  reason: MissingReason;
  /** 给用户看的提问文案（界面直接用，不再拼接）。 */
  question: string;
  /** 用户该做什么（回答 / 改设置 / 先治理 / 重填）。 */
  action: 'answer' | 'open_settings' | 'open_inbox' | 'refill';
}

export interface TaskFieldCheck {
  packId: string;
  packTitle: string;
  resolution: PersonalFieldResolution;
  /** 只含必需且取不到的字段（非必需字段缺失仍记录在 resolution.missing 里）。 */
  gaps: FieldGap[];
  boundCount: number;
  totalCount: number;
}

const GAP_PRESENTATION: Record<MissingReason, { question: (field: string) => string; action: FieldGap['action'] }> = {
  no_value: { question: (field) => '请补充：' + field, action: 'answer' },
  restricted: {
    question: (field) => field + ' 标了「仅自己可见」，需要在设置里放开才能用于任务',
    action: 'open_settings',
  },
  not_authorized: {
    question: (field) => field + ' 的来源已被暂停或超出适用范围，请先在待处理里处理',
    action: 'open_inbox',
  },
  stale: { question: (field) => field + ' 的来源已不存在，请重新填一次', action: 'refill' },
};

/** 算一次任务的字段缺口（只读；缺什么、为什么缺、该怎么问）。 */
export async function checkTaskFields(
  uid: string,
  pack: TaskFieldPack,
  context?: ResolvePersonalFieldsRequest['context'],
): Promise<TaskFieldCheck> {
  const resolution = await resolvePersonalFields(uid, {
    fields: pack.fields,
    ...(context ? { context } : {}),
  });
  const gaps: FieldGap[] = [];
  for (const miss of resolution.missing) {
    if (!miss.required) continue;
    const presentation = GAP_PRESENTATION[miss.reason] ?? GAP_PRESENTATION.no_value;
    gaps.push({
      fieldName: miss.fieldName,
      ...(miss.groupId ? { groupId: miss.groupId } : {}),
      required: true,
      reason: miss.reason,
      question: presentation.question(miss.fieldName),
      action: presentation.action,
    });
  }
  return {
    packId: pack.id,
    packTitle: pack.title,
    resolution,
    gaps,
    boundCount: resolution.bound.length,
    totalCount: pack.fields.length,
  };
}

export interface BackfillFieldInput {
  fieldName: string;
  value: string;
  /** 默认写进「关于我」分组；显式指定则用指定的。 */
  groupTitle?: string;
  expectedVersion?: string;
  expectedUpdatedAt?: string;
  expectedValue?: string;
  sourceId?: string;
  context?: ResolvePersonalFieldsRequest['context'];
  /** 回答来自哪次任务 / 哪张卡（进 delta.evidenceRefs）。 */
  evidenceRefs?: readonly DeltaEvidenceRef[];
}

export interface BackfillFieldResult {
  ok: boolean;
  error?: string;
  /** 落地的那条改动记录（origin='gap' + status='applied'）。 */
  delta?: CognitionDelta;
  /** 写入来源编号：正式资产、本体值或内核对象。 */
  objectId?: string;
  /** 值本来就在（重复回答）——幂等，不算失败。 */
  duplicate?: boolean;
  version?: string;
}

/**
 * 把用户对缺口的一次回答写进档案。
 *
 * 幂等：同字段同内容重复回答返回 duplicate=true 且不改数据（对齐 poAddValue 的
 * duplicate value 拒绝），用户不会因为多点一次看到报错。
 */
export async function backfillFieldValue(uid: string, input: BackfillFieldInput): Promise<BackfillFieldResult> {
  const fieldName = String(input?.fieldName ?? '').trim().slice(0, 200);
  const value = String(input?.value ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 2000);
  if (!fieldName) return { ok: false, error: 'field name required' };
  if (!value) return { ok: false, error: 'empty value' };
  void input.groupTitle; // 兼容入参保留：回填断言按 fieldName 全局寻址，不再选 po 分组

  const { loadCognitionStoreSync, applyCognitionDeltas } = await import('./store');

  const delta = buildDelta({
    op: 'set',
    target: { home: 'personal_fact', fieldName },
    origin: 'gap',
    after: value,
    evidenceRefs: input.evidenceRefs ?? [],
    status: 'applied',
  });

  return withCognitionTransition(uid, async () => {
    const resolution = await resolvePersonalFields(uid, { fields: [{ fieldName }], context: input.context });
    const missing = resolution.missing[0];
    if (missing && missing.reason !== 'no_value') return { ok: false, error: missing.reason };
    const bound = resolution.bound[0];
    if (input.sourceId && bound?.sourceId !== input.sourceId) return { ok: false, error: 'field source changed; check again' };
    if (input.expectedUpdatedAt && bound?.updatedAt !== input.expectedUpdatedAt) return { ok: false, error: 'field changed; check again' };
    if (input.expectedValue !== undefined && bound?.value !== input.expectedValue) return { ok: false, error: 'field changed; check again' };
    const doc = loadCognitionStoreSync(uid);
    const slot = (bound ? doc.objects[bound.sourceId] : undefined) ?? Object.values(doc.objects).find(o => o.kind === 'assertion' && o.fieldName === fieldName && o.status !== 'deleted'
      && (bound ? o.managedSource?.endsWith(`:${bound.sourceId}`) : !o.groupId));
    if (bound?.disputed && !input.sourceId) return { ok: false, error: 'field conflict; choose source before updating' };
    if (slot && (slot.status !== 'active' || slot.restricted)) return { ok: false, error: slot.restricted ? 'restricted' : 'not_authorized' };
    if (bound?.source === 'personal_asset' || slot?.managedSource?.startsWith('recall:')) {
      const { readAbilityAsset, updateAbilityAsset } = await import('../recall/asset-service');
      const asset = await readAbilityAsset(uid, bound?.source === 'personal_asset' ? bound.sourceId : slot!.managedSource!.slice('recall:'.length));
      if (input.expectedVersion && asset.version !== input.expectedVersion) return { ok: false, error: 'field version conflict; check again' };
      const { evaluateRecallAssetAgentReadEligibility, recallAssetAgentReadBlockReasons } = await import('../recall/prompt-injection');
      if (asset.type !== 'personal' || asset.status !== 'active' || recallAssetAgentReadBlockReasons(await evaluateRecallAssetAgentReadEligibility(uid, asset, input.context)).length) return { ok: false, error: 'not_authorized' };
      if (asset.statement === value) return { ok: true, duplicate: true, objectId: asset.id, version: asset.version };
      const updated = await updateAbilityAsset(uid, asset.id, { statement: value, expectedVersion: input.expectedVersion ?? asset.version,
        actor: 'user', reason: 'User explicitly corrected this personal field in conversation' });
      return { ok: true, objectId: updated.id, version: updated.version };
    }
    if (bound?.source === 'ontology_value' && !doc.objects[bound.sourceId]) {
      const { loadPoDocSync } = await import('../po/store');
      const { poUpdateValue } = await import('../po/api');
      const group = loadPoDocSync(uid).groups.find(g => g.values.some(v => v.id === bound.sourceId));
      if (!group) return { ok: false, error: 'field source missing' };
      const original = group.values.find(v => v.id === bound.sourceId)!;
      if (original.restricted) return { ok: false, error: 'restricted' };
      if (input.expectedUpdatedAt && original.updatedAt !== input.expectedUpdatedAt) return { ok: false, error: 'field changed; check again' };
      if (original.text === value) return { ok: true, duplicate: true, objectId: bound.sourceId };
      const result = await poUpdateValue(uid, group.id, bound.sourceId, { text: value });
      return { ...result, objectId: bound.sourceId };
    }
    if (slot?.managedSource?.startsWith('po:')) {
      // The compatibility object is derived; mutate the owning ontology value only.
      const { loadPoDocSync } = await import('../po/store');
      const { poUpdateValue } = await import('../po/api');
      for (const group of loadPoDocSync(uid).groups) {
        const original = group.values.find(v => slot.managedSource === `po:${group.id}:${v.id}`);
        if (!original) continue;
        if (original.restricted) return { ok: false, error: 'restricted' };
        if (input.expectedUpdatedAt && original.updatedAt !== input.expectedUpdatedAt) return { ok: false, error: 'field changed; check again' };
        if (original.text === value) return { ok: true, duplicate: true, objectId: slot.id };
        return { ...await poUpdateValue(uid, group.id, original.id, { text: value }), objectId: slot.id };
      }
      return { ok: false, error: 'field source missing' };
    }
    if (slot?.managedSource) return { ok: false, error: 'field source unavailable' };
    if (slot?.statement === value) return { ok: true, duplicate: true, delta, objectId: slot.id };
    const result = await applyCognitionDeltas(uid, [delta]);
    if (!result.ok) return { ok: false, error: result.error ?? 'backfill failed' };
    const first = result.results[0];
    if (first.applied === false) return { ok: false, error: first.reason };
    return { ok: true, delta, objectId: first.objectId };
  });
}
