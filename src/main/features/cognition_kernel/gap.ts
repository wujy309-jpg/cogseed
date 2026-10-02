/**
 * cognition_kernel/gap — 缺口引擎与回填（S2）。
 *
 * 一次任务开工前的一圈：
 *   任务包声明要哪些字段 → 取件窗口（resolve.ts）算"已有/缺" → 缺的转成一次提问
 *   → 用户答完 → 立刻回填档案（Delta 形态：origin='gap' 记录"它为什么存在"，
 *     status='applied' 记录"用户当场答的，立即生效"）
 *   → 同一个任务再跑，缺口消失。
 *
 * 分工：本文件只做"算缺口 + 回填"；取值的规则全在 resolve.ts，写入走统一库
 * Delta 落地器（2026-10-02 回归轮切换：旧版双写 po 会被库优先遮蔽成过期值——
 * 迁移后用户的新回答反而不生效）。回填断言为无组槽位（fieldName 寻址），
 * 同名旧账字段在 resolve 读侧被遮蔽，无需再动 po。
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

const DEFAULT_GROUP_TITLE = '关于我';

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
  /** 回答来自哪次任务 / 哪张卡（进 delta.evidenceRefs）。 */
  evidenceRefs?: readonly DeltaEvidenceRef[];
}

export interface BackfillFieldResult {
  ok: boolean;
  error?: string;
  /** 落地的那条改动记录（origin='gap' + status='applied'）。 */
  delta?: CognitionDelta;
  /** 统一库对象 id（2026-10-02 起 po 的 groupId/fieldId/valueId 退役）。 */
  objectId?: string;
  /** 值本来就在（重复回答）——幂等，不算失败。 */
  duplicate?: boolean;
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

  // 幂等：同字段同内容重复回答 → 不改数据不算失败（用户多点一次不报错）。
  const doc = loadCognitionStoreSync(uid);
  const existing = Object.values(doc.objects).find(
    (o) => o.kind === 'assertion' && o.status !== 'deleted' && o.fieldName === fieldName && o.statement === value,
  );
  if (existing) {
    return { ok: true, duplicate: true, delta, objectId: existing.id };
  }

  const result = await applyCognitionDeltas(uid, [delta]);
  if (!result.ok) return { ok: false, error: result.error ?? 'backfill failed' };
  const first = result.results[0];
  if (first.applied === false) return { ok: false, error: first.reason };
  return { ok: true, delta, objectId: first.objectId };
}
