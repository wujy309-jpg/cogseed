/**
 * cognition_kernel/slots — 本体轴与资产轴槽位（438 P1/P2，2026-10-07）。
 *
 * 任务包的三轴槽位里，personal 轴由 resolve.ts 取值；本文件补另外两轴：
 *   ontology 轴：按"对象名 × 关系名"绑定本体断言（同一权威读口 readOntologyView
 *               + queryOntologyFacts，范围可见性与任务查询同规）；规则槽位按
 *               关键词绑定适用规则。缺事实 → 缺口（P2 在对话里问、走本体命令落库）。
 *   asset 轴：  按类型＋标题绑定方法／规则／模板能力资产（listAbilityAssets +
 *               任务期准入，与 resolve.ts 同口）。缺资产不算缺口——如实报告即可。
 *
 * P2 rememberOntologySlotAnswer：用户在对话里答了本体轴缺口的答案后，经
 * commitOntologyCommand（本体唯一提交口）落地；同名对象绝不自动合并，身份
 * 含糊直接报错让模型去问用户。写完回读同一槽位，闭环可验证。
 */

import type { AssetSlotRef, OntologySlotRef } from './task_field_packs';
import type { MissingReason, RecallAgentReadContextLike } from './types';

const MAX_STATEMENT = 200;

export type SlotAxis = 'personal' | 'ontology' | 'asset';

export interface OntologySlotBound {
  slot: string;
  kind: 'fact' | 'rule';
  moduleId: string;
  recordId: string;
  version: number;
  /** 人可读的一句话（不进回执，只进 check 输出）。 */
  statement: string;
  /** fact＝'unknown' 表示存在记录但生效起点未确认（不当作已确认事实）。 */
  truth: 'true' | 'unknown';
  /** 命中于规则槽位时的适用状态。 */
  match?: 'matched' | 'unknown' | 'not_matched';
}

export interface OntologySlotMissing {
  slot: string;
  required: boolean;
  reason: MissingReason;
  /** 为什么缺的补充说明（同名未区分 / 未绑定主体等）。 */
  note?: string;
}

export interface OntologySlotResolution {
  bound: OntologySlotBound[];
  missing: OntologySlotMissing[];
}

export interface AssetSlotBound {
  slot: string;
  assetId: string;
  title: string;
  version: string;
}

export interface AssetSlotMissing {
  slot: string;
  required: boolean;
  reason: MissingReason;
}

export interface AssetSlotResolution {
  bound: AssetSlotBound[];
  missing: AssetSlotMissing[];
}

export interface ResolveSlotOptions {
  context?: RecallAgentReadContextLike;
  /** fact 槽位的主体绑定：slot → 主体对象名（模型从任务上下文给出，如"项目甲"）。 */
  subjects?: Record<string, string>;
  /** 查询哪一天的现实事实，缺省为今天。 */
  at?: string;
}

function todayLocal(): string {
  const now = new Date(), pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function clip(text: string): string {
  return text.length > MAX_STATEMENT ? text.slice(0, MAX_STATEMENT) + '…' : text;
}

async function statementOf(doc: import('../cognition/ontology/model').OntologyDocument, assertion: import('../cognition/ontology/model').OntologyAssertion): Promise<string> {
  const { resolveOntologyRecordForModule } = await import('../cognition/ontology/commands');
  const subject = resolveOntologyRecordForModule(doc, assertion.moduleId, assertion.subjectId);
  const definition = resolveOntologyRecordForModule(doc, assertion.moduleId, assertion.definitionId);
  const object = assertion.object.kind === 'entity'
    ? resolveOntologyRecordForModule(doc, assertion.moduleId, assertion.object.id)
    : null;
  const objectLabel = object && (object.kind === 'entity' || object.kind === 'definition' || object.kind === 'rule') ? object.name
    : assertion.object.kind === 'literal' ? String(assertion.object.value) : assertion.object.id;
  return clip(`${subject?.kind === 'entity' ? subject.name : assertion.subjectId} · ${definition?.kind === 'definition' ? definition.name : assertion.definitionId} · ${objectLabel}`);
}

/** 解析本体轴槽位（只读；同一权威读口，范围可见性与任务侧本体查询一致）。 */
export async function resolveOntologySlots(
  uid: string,
  slots: readonly OntologySlotRef[],
  options: ResolveSlotOptions = {},
): Promise<OntologySlotResolution> {
  const bound: OntologySlotBound[] = [];
  const missing: OntologySlotMissing[] = [];
  if (!slots.length) return { bound, missing };
  const { readOntologyView } = await import('../cognition/ontology/service');
  const { ontologyModuleVisibleToTask, queryOntologyFacts, queryOntologyRules } = await import('../cognition/ontology/query');
  const doc = await readOntologyView(uid);
  const at = options.at && /^\d{4}-\d{2}-\d{2}$/.test(options.at) ? options.at : todayLocal();
  const visibleModules = Object.values(doc.records).filter((r): r is Extract<typeof r, { kind: 'module' }> =>
    r.kind === 'module' && r.status === 'active' && ontologyModuleVisibleToTask(r, options.context));
  const visibleModuleIds = new Set(visibleModules.map(m => m.id));
  const visibleEntity = (r: Extract<import('../cognition/ontology/model').OntologyRecord, { kind: 'entity' }>) => {
    const module = doc.records[r.moduleId];
    return module?.kind === 'module' && module.status === 'active' && visibleModuleIds.has(module.id);
  };

  for (const slot of slots) {
    const required = slot.required !== false;
    if (slot.kind === 'rule') {
      const keyword = String(slot.ruleKeyword ?? slot.slot).trim();
      for (const module of visibleModules) {
        if (slot.moduleId && module.id !== slot.moduleId) continue;
        for (const hit of queryOntologyRules(doc, { moduleId: module.id, task: { at } })) {
          if (!hit.rule.name.includes(keyword) && !hit.rule.requirement.includes(keyword)) continue;
          bound.push({ slot: slot.slot, kind: 'rule', moduleId: hit.rule.moduleId, recordId: hit.rule.id,
            version: hit.rule.version, statement: clip(`${hit.rule.name}：${hit.rule.requirement}`),
            truth: 'true', match: hit.match });
        }
      }
      // 没有适用规则不是缺口：如实返回空即可，不逼用户造规则。
      continue;
    }

    // fact 槽位
    const relationName = String(slot.relation ?? '').trim();
    const definitions = Object.values(doc.records).filter((r): r is Extract<typeof r, { kind: 'definition' }> =>
      r.kind === 'definition' && r.status === 'active' && r.definitionKind !== 'type'
      && r.name === relationName && (!slot.moduleId || r.moduleId === slot.moduleId));
    if (!relationName || !definitions.length) {
      missing.push({ slot: slot.slot, required, reason: 'no_value', note: relationName ? undefined : '槽位声明缺少关系名' });
      continue;
    }
    const subjectName = String(options.subjects?.[slot.slot] ?? '').trim();
    if (slot.subjectRequired !== false && !subjectName) {
      missing.push({ slot: slot.slot, required, reason: 'no_value', note: '需要先确定是哪个对象（主体）' });
      continue;
    }
    const entities = subjectName
      ? Object.values(doc.records).filter((r): r is Extract<typeof r, { kind: 'entity' }> =>
        r.kind === 'entity' && r.status === 'active' && r.identityStatus === 'confirmed'
        && (r.name === subjectName || r.aliases.includes(subjectName)) && visibleEntity(r))
      : [];
    if (subjectName && entities.length !== 1) {
      missing.push({ slot: slot.slot, required, reason: 'no_value',
        note: entities.length ? `同名对象有 ${entities.length} 个，未区分身份，不能自动合并` : `没有找到对象「${subjectName}」` });
      continue;
    }
    const usableDefinitions = definitions.filter(d => visibleModuleIds.has(d.moduleId));
    if (!usableDefinitions.length) {
      missing.push({ slot: slot.slot, required, reason: 'not_authorized', note: '关系定义不在当前任务可见范围内' });
      continue;
    }
    const hits: OntologySlotBound[] = [];
    for (const definition of usableDefinitions) {
      const subjectIds = entities.length ? [entities[0].id] : undefined;
      for (const subjectId of subjectIds ?? [undefined]) {
        try {
          const queried = queryOntologyFacts(doc, { moduleId: definition.moduleId,
            ...(subjectId ? { subjectId } : {}), definitionId: definition.id, at });
          const fact = queried.matched[0] ?? queried.uncertain[0];
          if (!fact) continue;
          hits.push({ slot: slot.slot, kind: 'fact', moduleId: fact.moduleId, recordId: fact.id,
            version: fact.version, statement: await statementOf(doc, fact),
            truth: queried.matched.length ? 'true' : 'unknown' });
        } catch { /* 模块不可用按缺值处理，不让单槽砸整次体检 */ }
      }
    }
    if (!hits.length) {
      missing.push({ slot: slot.slot, required, reason: 'no_value' });
      continue;
    }
    hits.sort((a, b) => b.version - a.version);
    bound.push(...hits.slice(0, 1));
  }
  return { bound, missing };
}

/** 解析方法资产轴槽位（只读；与 personal 资产同一准入口）。 */
export async function resolveAssetSlots(
  uid: string,
  slots: readonly AssetSlotRef[],
  context?: RecallAgentReadContextLike,
): Promise<AssetSlotResolution> {
  const bound: AssetSlotBound[] = [];
  const missing: AssetSlotMissing[] = [];
  if (!slots.length) return { bound, missing };
  const { listAbilityAssets } = await import('../recall/asset-service');
  const { filterRecallAssetsForAgentRead } = await import('../recall/prompt-injection');
  const assets = (await listAbilityAssets(uid)).filter(a => a.status === 'active');
  let eligibleIds: Set<string> | undefined;
  try {
    const eligible = await filterRecallAssetsForAgentRead(uid, assets, (context ?? {}) as Parameters<typeof filterRecallAssetsForAgentRead>[2]);
    eligibleIds = new Set(eligible.map(a => a.id));
  } catch {
    // 准入判定失败按"全部不可用"处理：宁少取，不越权。此前 catch 后
    // eligibleIds 保持 undefined，下方 `!eligibleIds ||` 会把它反向解读成
    // 「全部放行」，与注释语义相反。
    eligibleIds = new Set();
  }
  for (const slot of slots) {
    const required = slot.required !== false;
    const title = String(slot.title ?? '').trim();
    const matches = assets.filter(a => a.type === slot.assetType && String(a.title ?? '') === title);
    if (!matches.length) {
      missing.push({ slot: slot.slot, required, reason: 'no_value' });
      continue;
    }
    const eligible = matches.filter(a => !eligibleIds || eligibleIds.has(a.id));
    if (!eligible.length) {
      missing.push({ slot: slot.slot, required, reason: 'not_authorized' });
      continue;
    }
    const sorted = [...eligible].sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')));
    const asset = sorted[0];
    bound.push({ slot: slot.slot, assetId: asset.id, title: asset.title,
      version: String(asset.activeVersion ?? asset.version ?? '') });
  }
  return { bound, missing };
}

// ── P2：本体轴缺口的回答落库（走本体命令唯一提交口，不直写） ─────────────────

export interface RememberOntologySlotInput {
  slot: string;
  /** 主体对象名（如"项目甲"）；必须能唯一定位，同名不自动合并。 */
  subjectName: string;
  relationName: string;
  /** 关系指向对象的名字（valueType=entity 时必填）。 */
  objectName?: string;
  /** 字面值（valueType≠entity 时必填）。 */
  literalValue?: string;
  /** 现实变更生效日（YYYY-MM-DD，默认今天）；纠错时忽略。 */
  from?: string;
  /** create＝新增并存；change＝现实变更（单值关系换人）；correct＝此前记错。 */
  intent?: 'create' | 'change' | 'correct';
  context?: RecallAgentReadContextLike;
}

export interface RememberOntologySlotResult {
  ok: boolean;
  error?: string;
  duplicate?: boolean;
  moduleId?: string;
  recordId?: string;
  version?: number;
}

interface ResolvedTarget {
  doc: import('../cognition/ontology/model').OntologyDocument;
  subjectId: string;
  definitionId: string;
  definitionModuleId: string;
  object: import('../cognition/ontology/model').OntologyValue;
}

async function resolveWriteTarget(uid: string, input: RememberOntologySlotInput): Promise<ResolvedTarget> {
  const { readOntologyDocument } = await import('../cognition/ontology/service');
  const { ontologyModuleVisibleToTask } = await import('../cognition/ontology/query');
  const doc = readOntologyDocument(uid);
  const visible = (moduleId: string) => {
    const module = doc.records[moduleId];
    return module?.kind === 'module' && module.status === 'active' && ontologyModuleVisibleToTask(module, input.context);
  };
  const findEntities = (name: string) => Object.values(doc.records).filter((r): r is Extract<typeof r, { kind: 'entity' }> =>
    r.kind === 'entity' && r.status === 'active' && r.identityStatus === 'confirmed'
    && (r.name === name || r.aliases.includes(name)) && visible(r.moduleId));
  const describe = (rows: Array<{ id: string; moduleId: string; name: string }>) =>
    rows.slice(0, 5).map(row => `${row.name}（${row.moduleId}）`).join('、');

  const subjectName = String(input.subjectName ?? '').trim();
  if (!subjectName) throw new Error('subject_required');
  const subjects = findEntities(subjectName);
  if (!subjects.length) {
    const near = Object.values(doc.records).filter((r): r is Extract<typeof r, { kind: 'entity' }> =>
      r.kind === 'entity' && r.status === 'active' && r.name.includes(subjectName) && visible(r.moduleId));
    throw new Error(near.length ? `subject_not_found;相近对象：${describe(near)}` : 'subject_not_found');
  }
  if (subjects.length > 1) throw new Error(`ambiguous_subject;同名对象：${describe(subjects)}`);

  const relationName = String(input.relationName ?? '').trim();
  const definitions = Object.values(doc.records).filter((r): r is Extract<typeof r, { kind: 'definition' }> =>
    r.kind === 'definition' && r.status === 'active' && r.definitionKind !== 'type' && r.name === relationName);
  const inScope = definitions.filter(d => visible(d.moduleId));
  if (!inScope.length) throw new Error(definitions.length ? 'relation_not_authorized' : 'relation_not_found');
  const local = inScope.filter(d => d.moduleId === subjects[0].moduleId);
  const definition = (local.length ? local : inScope).length === 1 ? (local.length ? local : inScope)[0] : undefined;
  if (!definition) throw new Error(`ambiguous_relation;同名关系分布于多个本体，请指定 moduleId`);

  let object: import('../cognition/ontology/model').OntologyValue;
  if (definition.valueType === 'entity') {
    const objectName = String(input.objectName ?? '').trim();
    if (!objectName) throw new Error('object_required');
    const objects = findEntities(objectName);
    if (!objects.length) throw new Error('object_not_found');
    if (objects.length > 1) throw new Error(`ambiguous_object;同名对象：${describe(objects)}`);
    object = { kind: 'entity', id: objects[0].id };
  } else {
    const raw = String(input.literalValue ?? '').trim();
    if (!raw) throw new Error('literal_required');
    if (definition.valueType === 'number') {
      const value = Number(raw);
      if (!Number.isFinite(value)) throw new Error('literal_type_mismatch');
      object = { kind: 'literal', valueType: 'number', value };
    } else if (definition.valueType === 'boolean') {
      if (raw !== 'true' && raw !== 'false') throw new Error('literal_type_mismatch');
      object = { kind: 'literal', valueType: 'boolean', value: raw === 'true' };
    } else {
      object = { kind: 'literal', valueType: definition.valueType, value: raw };
    }
  }
  return { doc, subjectId: subjects[0].id, definitionId: definition.id, definitionModuleId: definition.moduleId, object };
}

/**
 * 把用户对本体轴缺口的一次回答写进本体（对话内明确回答＝直接提交路径，
 * 但仍过身份、类型、冲突、基线校验；一切经 commitOntologyCommand）。
 */
export async function rememberOntologySlotAnswer(uid: string, input: RememberOntologySlotInput): Promise<RememberOntologySlotResult> {
  const slot = String(input?.slot ?? '').trim();
  if (!slot) return { ok: false, error: 'slot required' };
  let target: ResolvedTarget;
  try {
    target = await resolveWriteTarget(uid, input);
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
  const { commitOntologyCommand } = await import('../cognition/ontology/service');
  const { isCalendarDate } = await import('../cognition/ontology/model');
  const { createHash } = await import('node:crypto');

  const intent = input.intent === 'correct' ? 'correct' : input.intent === 'change' ? 'change' : 'create';
  const day = todayLocal();
  const from = input.from && isCalendarDate(input.from) ? input.from : day;
  const sameSlotActive = Object.values(target.doc.records).filter((r): r is Extract<typeof r, { kind: 'assertion' }> =>
    r.kind === 'assertion' && r.status === 'active' && r.subjectId === target.subjectId && r.definitionId === target.definitionId)
    .sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')));
  const objectKey = JSON.stringify(target.object);
  if (sameSlotActive.some(r => JSON.stringify(r.object) === objectKey)) {
    const existing = sameSlotActive.find(r => JSON.stringify(r.object) === objectKey)!;
    return { ok: true, duplicate: true, moduleId: existing.moduleId, recordId: existing.id, version: existing.version };
  }

  const commandId = 'gap-' + createHash('sha256')
    .update([uid, slot, target.subjectId, target.definitionId, objectKey, intent, from].join('|')).digest('hex').slice(0, 24);
  const sourceLabel = '用户在任务对话中的回答';
  const assertionBase = {
    kind: 'assertion' as const,
    moduleId: target.definitionModuleId,
    subjectId: target.subjectId,
    definitionId: target.definitionId,
    object: target.object,
    validity: { from, until: null, precision: 'day' as const, timezone: 'Asia/Shanghai' },
  };
  let action: import('../cognition/ontology/commands').OntologyAction;
  if (!sameSlotActive.length || intent === 'create') {
    action = { intent: 'create', record: { ...assertionBase }, sourceLabel };
  } else {
    const previous = sameSlotActive[0];
    action = intent === 'change'
      ? { intent: 'change', recordId: previous.id, expectedVersion: previous.version, effectiveFrom: from, object: target.object, sourceLabel }
      : { intent: 'correct', recordId: previous.id, expectedVersion: previous.version, object: target.object, sourceLabel };
  }
  try {
    const receipt = await commitOntologyCommand(uid, { commandId, expectedRevision: target.doc.revision, actions: [action] });
    // create：changedIds[0]＝新断言；change/correct：末位＝后继断言（前位是闭合/纠正的旧记录）。
    const recordId = action.intent === 'create'
      ? receipt.receipt.changedIds[0]
      : receipt.receipt.changedIds.at(-1) ?? receipt.receipt.changedIds[0];
    const fresh = recordId
      ? (await import('../cognition/ontology/service')).readOntologyDocument(uid).records[recordId]
      : undefined;
    return { ok: true, moduleId: target.definitionModuleId, recordId,
      version: fresh && 'version' in fresh ? fresh.version : undefined,
      ...(receipt.duplicate ? { duplicate: true } : {}) };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}
