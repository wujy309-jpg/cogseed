/**
 * 个人字段「取件 / 记住」工具（2026-10-02 S2；438 P1/P2 扩三轴，2026-10-07）。
 *
 * 为什么需要它：任务开工前要用到用户的个人字段（报销要工号/卡号/审批人…）。
 * 这条链原先被做成了一个独立的"待填写表单"页面，子安 2026-10-02 明确否决：
 * **这些字段必须在 AI 执行过程中于对话里问、由用户在对话里答**，不该有独立界面。
 *
 *   - `personal_fields_check`    任务包要哪些槽位（三轴）/ 现在有哪些 / 还缺哪些（只读）
 *   - `personal_field_remember`  个人轴答案写档案（走改动记录单）＋filled 回执
 *   - `ontology_slot_remember`   本体轴答案走本体命令落库（同名不合并）＋filled 回执
 *
 * 纪律：check 只读，不得据它推断用户偏好；两个 remember 必须在用户于对话中
 * **明确回答之后**调用，禁止自行编造值（宁可不填也不要写错——档案是长期记忆）。
 */

import type { CognitionSaveReceipt } from '../client';
import type { AgentTool } from '#core-agent';
import { createLogger } from '../../logger';
import {
  backfillFieldValue,
  checkTaskFields,
  getTaskFieldPack,
  recordCognitionBoundReceipt,
  recordCognitionFilledReceipt,
  rememberOntologySlotAnswer,
  TASK_FIELD_PACKS,
} from '../../features/cognition_kernel';
import { logErrorRef, maskId } from '../../util/log-redact';

import { recordAssetAgentReads } from '../../features/recall/agent-read-accounting';
import type { ResolvePersonalFieldsRequest } from '../../features/cognition_kernel/types';
import { createTranscriptMemoryTools } from './transcript-memory-tools';
import { createOntologyTools } from './ontology-tools';
const log = createLogger('cognition-kernel-tools');

const PACK_IDS = Object.keys(TASK_FIELD_PACKS);
const MAX_VALUE_CHARS = 2000;

export interface CognitionKernelToolsOpts {
  userId: string;
  turnId?: string;
  /** 真实任务运行 ID（群聊 run）；缺省回退 turnId 记账。 */
  taskRunId?: string;
  cid?: string;
  allowConversationWrite?: boolean;
  onCognitionSaveReceipt?: (receipt: CognitionSaveReceipt) => void | Promise<void>;
  spaceId?: string;
  context?: ResolvePersonalFieldsRequest['context'];
  observed?: Map<string, { sourceId: string; version?: string; expectedUpdatedAt?: string; expectedValue?: string }>;
}

function packIdOf(input: Record<string, unknown>): string {
  return String(input.pack ?? '').trim();
}

function createFieldsCheckTool(opts: CognitionKernelToolsOpts): AgentTool {
  const userId = opts.userId;
  return {
    name: 'personal_fields_check',
    executionMode: 'parallel',
    description:
      '查一个任务类型开工前需要的认知槽位（三轴：个人字段／本体事实与规则／方法资产）：哪些已有、哪些还缺。'
      + '报销用 pack="expense"，招投标用 pack="bid"，周报用 pack="weekly_report"。'
      + '本体 fact 槽位需要主体时，用 subjects 告诉它这次任务针对哪个对象（如 {"周报-固定接收人":"项目甲"}）。'
      + '对缺的槽位，在对话里直接问用户（一条一条问，不要一次抛整张表），'
      + '个人字段答案调 personal_field_remember，本体事实答案调 ontology_slot_remember。'
      + '已有槽位直接用，不要重复问。缺方法资产不是缺口，如实告知用户即可。',
    inputSchema: {
      type: 'object',
      properties: {
        pack: { type: 'string', enum: PACK_IDS, description: 'Task slot pack id (expense / bid / weekly_report).' },
        subjects: {
          type: 'object',
          description: 'Optional. fact 槽位的主体绑定：槽位名 → 对象名（来自任务上下文）。',
          additionalProperties: { type: 'string', maxLength: 200 },
        },
      },
      required: ['pack'],
      additionalProperties: false,
    },
    async execute(input) {
      const packId = packIdOf(input);
      const pack = getTaskFieldPack(packId);
      if (!pack) return { content: 'personal_fields_check: 未知的任务槽位包，可选：' + PACK_IDS.join(' / '), isError: true };
      const subjects = input.subjects && typeof input.subjects === 'object'
        && !Array.isArray(input.subjects)
        ? Object.fromEntries(Object.entries(input.subjects as Record<string, unknown>)
          .map(([key, value]) => [key, String(value ?? '').trim().slice(0, 200)]))
        : undefined;
      try {
        const check = await checkTaskFields(userId, pack, opts.context, subjects);
        for (const field of check.resolution.bound) opts.observed?.set(field.fieldName, { sourceId: field.sourceId, version: field.revision ?? field.version,
          // Ontology timestamps have second precision; also bind the value so
          // two edits in the same second cannot overwrite an old observation.
          ...(!field.version ? { expectedUpdatedAt: field.updatedAt, expectedValue: field.value } : {}) });
        await recordAssetAgentReads(opts, check.resolution.bound.flatMap(field => field.source === 'personal_asset' && field.version
          ? [{ assetId: field.sourceId, assetVersion: field.version }] : []));
        try {
          await recordCognitionBoundReceipt(userId, opts.turnId, pack.id, check, opts.taskRunId);
        } catch (error) {
          log.warn('personal fields bound receipt failed', { userId: maskId(userId), turnId: maskId(opts.turnId), pack: packId, error: logErrorRef(error as Error) });
        }
        const result = {
          pack: pack.id,
          title: pack.title,
          total: check.totalCount,
          boundCount: check.boundCount,
          bound: check.resolution.bound.map((field) => ({ field: field.fieldName, value: field.value, source: field.source, sourceId: field.sourceId, ...(field.version ? { version: field.version, revision: field.revision ?? field.version } : {}) })),
          ontology: (check.ontology?.bound ?? []).map((hit) => ({ slot: hit.slot, kind: hit.kind, statement: hit.statement, moduleId: hit.moduleId, recordId: hit.recordId, version: hit.version, truth: hit.truth, ...(hit.match ? { match: hit.match } : {}) })),
          assets: (check.assets?.bound ?? []).map((hit) => ({ slot: hit.slot, assetId: hit.assetId, title: hit.title, version: hit.version })),
          assetMissing: (check.assets?.missing ?? []).map((miss) => ({ slot: miss.slot, reason: miss.reason, required: miss.required })),
          missing: check.gaps.map((gap) => ({ slot: gap.fieldName, axis: gap.axis, ask: gap.question, action: gap.action, reason: gap.reason, ...(gap.note ? { note: gap.note } : {}) })),
        };
        return { content: JSON.stringify(result, null, 2) };
      } catch (error) {
        log.warn('personal fields check failed', { userId: maskId(userId), pack: packId, error: logErrorRef(error as Error) });
        return { content: 'personal_fields_check: 读取认知槽位失败', isError: true };
      }
    },
  };
}

function createFieldRememberTool(opts: CognitionKernelToolsOpts): AgentTool {
  const userId = opts.userId;
  return {
    name: 'personal_field_remember',
    executionMode: 'sequential',
    description:
      '把用户在对话里回答的个人字段写进档案，下次同类任务不再问。'
      + 'field 用 personal_fields_check 给出的字段名，value 必须是用户这一轮的真实回答。'
      + '禁止编造或推断字段值；用户没答就继续问，不要调用本工具。',
    inputSchema: {
      type: 'object',
      properties: {
        field: { type: 'string', description: 'Field name exactly as returned by personal_fields_check.' },
        value: { type: 'string', description: 'The value the user just stated in the conversation.' },
        pack: { type: 'string', description: 'Optional. The pack id from personal_fields_check, for filled-receipt bookkeeping.' },
      },
      required: ['field', 'value'],
      additionalProperties: false,
    },
    async execute(input) {
      const field = String(input.field ?? '').trim();
      const value = String(input.value ?? '').trim();
      const packId = String(input.pack ?? '').trim();
      if (!field || !value) return { content: 'personal_field_remember: field 与 value 都不能为空', isError: true };
      if (value.length > MAX_VALUE_CHARS) return { content: 'personal_field_remember: 值过长，请先精简', isError: true };
      try {
        const result = await backfillFieldValue(userId, { fieldName: field, value, context: opts.context, ...opts.observed?.get(field), expectedVersion: opts.observed?.get(field)?.version });
        if (!result.ok) return { content: 'personal_field_remember: 写入失败（' + String(result.error || 'unknown') + '）', isError: true };
        try {
          await recordCognitionFilledReceipt(userId, opts.turnId, {
            slot: field, axis: 'personal', sourceId: result.objectId ?? field,
            ...(result.delta ? { source: 'ontology_value' as const } : {}),
            ...(result.version ? { version: String(result.version) } : {}),
            ...(packId ? { packId } : { packId: 'ad-hoc' }),
          }, opts.taskRunId);
        } catch (error) {
          log.warn('personal field filled receipt failed', { userId: maskId(userId), field, error: logErrorRef(error as Error) });
        }
        return {
          content: JSON.stringify({
            remembered: field,
            duplicate: result.duplicate === true,
            sourceId: result.objectId,
            version: result.version,
            message: result.duplicate ? '这一项档案里已经有了，未重复写入。' : '已记住，下次同类任务不会再问这个字段。',
          }),
        };
      } catch (error) {
        log.warn('personal field remember failed', { userId: maskId(userId), field, error: logErrorRef(error as Error) });
        return { content: 'personal_field_remember: 写入个人档案失败', isError: true };
      }
    },
  };
}

function createOntologySlotRememberTool(opts: CognitionKernelToolsOpts): AgentTool {
  const userId = opts.userId;
  return {
    name: 'ontology_slot_remember',
    executionMode: 'sequential',
    description:
      '把用户在对话里回答的本体事实（personal_fields_check 缺的 ontology 槽位）写进本体。'
      + 'subjectName/relationName/objectName 用本体里已有的确切名称；同名对象会被拒绝并列出候选，先问用户是哪一个，不要猜。'
      + '现实换人用 intent="change"＋from（生效日），记错以前用 intent="correct"，新增并存（如多位接收人）用缺省 "create"。'
      + '禁止编造；用户没答就继续问。写入走本体命令并保留版本与来源。',
    inputSchema: {
      type: 'object',
      properties: {
        slot: { type: 'string', maxLength: 60, description: 'Slot name exactly as returned by personal_fields_check (missing[].slot with axis=ontology).' },
        subjectName: { type: 'string', maxLength: 200, description: 'Exact entity name in the ontology, e.g. 项目甲.' },
        relationName: { type: 'string', maxLength: 200, description: 'Exact relation/attribute definition name, e.g. 接收周报.' },
        objectName: { type: 'string', maxLength: 200, description: 'Target entity name when the relation points to an object (e.g. 王芳).' },
        literalValue: { type: 'string', maxLength: 2000, description: 'Literal value when the relation points to a text/number/boolean/date.' },
        from: { type: 'string', maxLength: 10, description: 'Optional. Effective date YYYY-MM-DD for a real-world change; defaults to today.' },
        intent: { type: 'string', enum: ['create', 'change', 'correct'], description: 'create=new coexisting fact; change=real-world change; correct=previous record was wrong.' },
        pack: { type: 'string', description: 'Optional. The pack id from personal_fields_check, for filled-receipt bookkeeping.' },
      },
      required: ['slot', 'subjectName', 'relationName'],
      additionalProperties: false,
    },
    async execute(input) {
      const slot = String(input.slot ?? '').trim();
      const packId = String(input.pack ?? '').trim() || 'ad-hoc';
      const intent = input.intent === 'change' || input.intent === 'correct' ? input.intent : 'create';
      try {
        const result = await rememberOntologySlotAnswer(userId, {
          slot,
          subjectName: String(input.subjectName ?? '').trim(),
          relationName: String(input.relationName ?? '').trim(),
          ...(input.objectName ? { objectName: String(input.objectName).trim() } : {}),
          ...(input.literalValue ? { literalValue: String(input.literalValue) } : {}),
          ...(input.from ? { from: String(input.from) } : {}),
          intent,
          context: opts.context,
        });
        if (!result.ok) return { content: 'ontology_slot_remember: 写入失败（' + String(result.error || 'unknown') + '）', isError: true };
        try {
          await recordCognitionFilledReceipt(userId, opts.turnId, {
            slot, axis: 'ontology', sourceId: result.recordId ?? slot,
            ...(result.moduleId ? { moduleId: result.moduleId } : {}),
            ...(result.version !== undefined ? { version: String(result.version) } : {}),
            packId,
          }, opts.taskRunId);
        } catch (error) {
          log.warn('ontology slot filled receipt failed', { userId: maskId(userId), slot, error: logErrorRef(error as Error) });
        }
        return {
          content: JSON.stringify({
            remembered: slot,
            duplicate: result.duplicate === true,
            moduleId: result.moduleId,
            recordId: result.recordId,
            version: result.version,
            message: result.duplicate ? '本体里已有这条事实，未重复写入。' : '已写入本体（带版本与来源），下次查询直接可绑。',
          }),
        };
      } catch (error) {
        log.warn('ontology slot remember failed', { userId: maskId(userId), slot, error: logErrorRef(error as Error) });
        return { content: 'ontology_slot_remember: 写入本体失败', isError: true };
      }
    },
  };
}

/** 组装本模块的工具（只读 check + 两个轴的 remember）。 */
export function createCognitionKernelTools(opts: CognitionKernelToolsOpts): AgentTool[] {
  const scoped = { ...opts, observed: new Map<string, { sourceId: string; version?: string; expectedUpdatedAt?: string; expectedValue?: string }>() };
  return [
    createFieldsCheckTool(scoped),
    createFieldRememberTool(scoped),
    createOntologySlotRememberTool(scoped),
    ...createTranscriptMemoryTools(opts),
    ...createOntologyTools({ userId: opts.userId, turnId: opts.turnId, cid: opts.cid, allowConversationWrite: opts.allowConversationWrite, onCognitionSaveReceipt: opts.onCognitionSaveReceipt, context: opts.context }),
  ];
}
