/**
 * 个人字段「取件 / 记住」工具（2026-10-02 S2）。
 *
 * 为什么需要它：任务开工前要用到用户的个人字段（报销要工号/卡号/审批人…）。
 * 这条链原先被做成了一个独立的"待填写表单"页面，子安 2026-10-02 明确否决：
 * **这些字段必须在 AI 执行过程中于对话里问、由用户在对话里答**，不该有独立界面。
 *
 *   - `personal_fields_check`    任务包要哪些字段 / 现在有哪些 / 还缺哪些（只读）
 *   - `personal_field_remember`  把用户在对话里给出的答案写进档案（走改动记录单）
 *
 * 纪律：check 只读，不得据它推断用户偏好；remember 必须在用户于对话中**明确回答
 * 之后**调用，禁止自行编造字段值（宁可不填也不要写错——档案是长期记忆）。
 */

import type { AgentTool } from '#core-agent';
import { createLogger } from '../../logger';
import {
  backfillFieldValue,
  checkTaskFields,
  getTaskFieldPack,
  recordCognitionBoundReceipt,
  TASK_FIELD_PACKS,
} from '../../features/cognition_kernel';
import { logErrorRef, maskId } from '../../util/log-redact';

import { recordAssetAgentReads } from '../../features/recall/agent-read-accounting';
import type { ResolvePersonalFieldsRequest } from '../../features/cognition_kernel/types';
import { createOntologyTools } from './ontology-tools';
const log = createLogger('cognition-kernel-tools');

const PACK_IDS = Object.keys(TASK_FIELD_PACKS);
const MAX_VALUE_CHARS = 2000;

export interface CognitionKernelToolsOpts {
  userId: string;
  turnId?: string;
  cid?: string;
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
      '查一个任务类型开工前需要的个人字段：哪些已有、哪些还缺。'
      + '报销用 pack="expense"，招投标用 pack="bid"。'
      + '对缺的字段，要在对话里直接问用户（一条一条问，不要一次抛整张表），'
      + '拿到回答后调用 personal_field_remember 记住。已有字段直接用，不要重复问。',
    inputSchema: {
      type: 'object',
      properties: {
        pack: { type: 'string', enum: PACK_IDS, description: 'Task field pack id (expense / bid).' },
      },
      required: ['pack'],
      additionalProperties: false,
    },
    async execute(input) {
      const packId = packIdOf(input);
      const pack = getTaskFieldPack(packId);
      if (!pack) return { content: 'personal_fields_check: 未知的任务字段包，可选：' + PACK_IDS.join(' / '), isError: true };
      try {
        const check = await checkTaskFields(userId, pack, opts.context);
        for (const field of check.resolution.bound) opts.observed?.set(field.fieldName, { sourceId: field.sourceId, version: field.revision ?? field.version,
          // Ontology timestamps have second precision; also bind the value so
          // two edits in the same second cannot overwrite an old observation.
          ...(!field.version ? { expectedUpdatedAt: field.updatedAt, expectedValue: field.value } : {}) });
        await recordAssetAgentReads(opts, check.resolution.bound.flatMap(field => field.source === 'personal_asset' && field.version
          ? [{ assetId: field.sourceId, assetVersion: field.version }] : []));
        try {
          await recordCognitionBoundReceipt(userId, opts.turnId, pack.id, check);
        } catch (error) {
          log.warn('personal fields bound receipt failed', { userId: maskId(userId), turnId: maskId(opts.turnId), pack: packId, error: logErrorRef(error as Error) });
        }
        const result = {
          pack: pack.id,
          title: pack.title,
          total: check.totalCount,
          boundCount: check.boundCount,
          bound: check.resolution.bound.map((field) => ({ field: field.fieldName, value: field.value, source: field.source, sourceId: field.sourceId, ...(field.version ? { version: field.version, revision: field.revision ?? field.version } : {}) })),
          missing: check.gaps.map((gap) => ({ field: gap.fieldName, ask: gap.question, action: gap.action })),
        };
        return { content: JSON.stringify(result, null, 2) };
      } catch (error) {
        log.warn('personal fields check failed', { userId: maskId(userId), pack: packId, error: logErrorRef(error as Error) });
        return { content: 'personal_fields_check: 读取个人字段失败', isError: true };
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
      },
      required: ['field', 'value'],
      additionalProperties: false,
    },
    async execute(input) {
      const field = String(input.field ?? '').trim();
      const value = String(input.value ?? '').trim();
      if (!field || !value) return { content: 'personal_field_remember: field 与 value 都不能为空', isError: true };
      if (value.length > MAX_VALUE_CHARS) return { content: 'personal_field_remember: 值过长，请先精简', isError: true };
      try {
        const result = await backfillFieldValue(userId, { fieldName: field, value, context: opts.context, ...opts.observed?.get(field), expectedVersion: opts.observed?.get(field)?.version });
        if (!result.ok) return { content: 'personal_field_remember: 写入失败（' + String(result.error || 'unknown') + '）', isError: true };
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

/** 组装本模块的工具（只读 check + 写入 remember）。 */
export function createCognitionKernelTools(opts: CognitionKernelToolsOpts): AgentTool[] {
  const scoped = { ...opts, observed: new Map<string, { sourceId: string; version?: string; expectedUpdatedAt?: string; expectedValue?: string }>() };
  return [createFieldsCheckTool(scoped), createFieldRememberTool(scoped), ...createOntologyTools({ userId: opts.userId, turnId: opts.turnId, context: opts.context })];
}
