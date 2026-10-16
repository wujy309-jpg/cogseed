/** One model adapter; authorization and atomic writes belong to the feature. */
import type { AgentTool, ToolContext } from '#core-agent';
import { editCognition, type CognitionEditHost, type CognitionEditInput } from '../../features/cognition/edit-service';
export function createCognitionEditTools(host: CognitionEditHost): AgentTool[] {
  return [{
    name: 'edit_cognition',
    description: '按当前用户明确指令修改已有认知资产或本体。先用 read_ability_asset(mode=manage) 或 cognition_ontology_query(mode=manage) 看正文和版本。精确字段/唯一片段补丁可直接保存；缺完整本人决定或 AI 改写时，主进程展示完整正文与条件并请用户确认一次。共享规则正文自动与拥有认知同次保存。不会创建候选/新资产，不恢复暂停，不扩大默认使用授权；明确本人确认的新版本在原范围内继续用于普通后续任务。mode=propose 只预览不保存。',
    inputSchema: { type: 'object', properties: {
      target: { type: 'object', properties: { assetId: { type: 'string' }, ontologyRecordId: { type: 'string' } }, additionalProperties: false, description: '唯一已有目标，二选一；ID 来自管理读取。' },
      fields: { type: 'object', additionalProperties: true, description: '只传实际要改的新值，不要把读取到的旧正文放进fields作基线（版本基线用expectedVersion）。资产：title/statement/scope/scopePolicy/applicableWhen/forbiddenWhen/tags。本体按记录类型修改 name/description/requirement/condition/effect/strength/exception/aliases 等；事实用 object/subjectId/certainty。没给的字段保留。正文整体改写用fields.statement；若用replaceText改片段，则不要再传fields.statement：正文这两种表示必须二选一。' },
      replaceText: { type: 'object', properties: { before: { type: 'string' }, after: { type: 'string' } }, required: ['before', 'after'], additionalProperties: false, description: '只修改正文一个精确且唯一的原片段。使用它就不要再传fields.statement（包括旧正文）；整体正文新值与片段补丁必须二选一。其他没要求改的正文保持不变。' },
      ontologyChanges: { type: 'array', items: { type: 'object', additionalProperties: true }, description: '可选，同次保存的已有关联本体命令；必须给记录版本，不允许 create。额外影响会完整确认。' },
      expectedVersion: { type: 'string', description: '管理读取返回的最新版；本体记录也以字符串传数字。' },
      expectedActiveVersion: { type: 'string' }, expectedOntologyRevision: { type: 'number' },
      factIntent: { type: 'string', enum: ['correct', 'change'], description: 'correct 更正原记录（缺省）；change 表示现实从某日改变，保留历史有效期。' },
      effectiveFrom: { type: 'string', description: 'change 时必填，按原事实日/月精度。' },
      mode: { type: 'string', enum: ['apply_if_authorized', 'propose'], description: '普通用户编辑（包括需要你起草或润色的AI改写）使用 apply_if_authorized（缺省）：宿主核对后，必要时会展示完整修改并等待用户一次确认，再保存。不要仅因AI起草而选propose，也不要在对话中另问一遍确认。只有用户明确要求“先看方案/只预览/暂不保存”时才用propose；它只返回预览文字，不发起审批也不保存。' }, reason: { type: 'string' },
    }, required: ['target', 'reason'], additionalProperties: false },
    async execute(input: Record<string, unknown>, context?: ToolContext) {
      try {
        const result = await editCognition(host.userId, { ...host, signal: context?.signal ?? host.signal,
          onCommitStarted: context?.beginAtomicCommit ?? host.onCommitStarted }, input as unknown as CognitionEditInput);
        return { content: JSON.stringify(result), ...(result.status === 'blocked' ? { isError: true } : {}) };
      } catch (error) { return { content: `edit_cognition: ${error instanceof Error ? error.message : '修改失败'}`, isError: true }; }
    },
  }];
}
