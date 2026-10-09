/** Explicit human correction → document-scoped glossary, using verified conversation evidence. */
import type { AgentTool } from '#core-agent';
import { z } from 'zod';
import { verifyConversationEvidence } from '../../features/cognition/ontology/conversation-commands';
import { rememberConfirmedPairs, loadGlossary, saveGlossary } from '../../features/transcript_glossary';
import { readOntologyDocument } from '../../features/cognition/ontology/service';
import { ontologyModuleVisibleToTask } from '../../features/cognition/ontology/query';
import type { ResolvePersonalFieldsRequest } from '../../features/cognition_kernel/types';
import { fileEditLock } from '../../util/locks';
import { userTranscriptGlossaryFile } from '../../paths';

export function createTranscriptMemoryTools(options: { userId: string; cid?: string; allowConversationWrite?: boolean; context?: ResolvePersonalFieldsRequest['context'] }): AgentTool[] {
  if (!options.cid || !options.allowConversationWrite) return [];
  const tools: AgentTool[] = [{ name: 'transcript_remember_correction', executionMode: 'sequential',
    description: '用户明确确认转写错误的正确写法后，保存到该对话文档范围的纠错词表。correct 必须出现在真实用户原话 quote 中；推断或不知道不能保存为确认纠错。wrong 必须在指定用户附件中出现。返回真实保存条目及 scope；不代表已改写原文件。默认只用于当前对话附件（docId=chat:会话ID），不扩大为全局纠错。先保存规范本体对象，再用本工具记住明确的错形→规范写法；只改文件不等于记住。',
    inputSchema: { type: 'object', properties: { wrong: { type: 'string', maxLength: 160 }, correct: { type: 'string', maxLength: 160 }, attachmentName: { type: 'string' }, sourceMessageId: { type: 'string' }, confirmationMessageId: { type: 'string' }, moduleId: { type: 'string' }, entityId: { type: 'string' }, quote: { type: 'string', maxLength: 2000 } }, required: ['wrong','correct','attachmentName','sourceMessageId','confirmationMessageId','quote'], additionalProperties: false },
    async execute(raw) {
      try {
        const input = z.object({ wrong: z.string().trim().min(1).max(160), correct: z.string().trim().min(1).max(160), attachmentName: z.string(), sourceMessageId: z.string(), confirmationMessageId: z.string(), moduleId: z.string().optional(), entityId: z.string().optional(), quote: z.string() }).strict().parse(raw);
        if (!input.quote.includes(input.correct) || /(?:不知道|不清楚|猜测|可能是|疑为|不确定|don't know|not sure)/i.test(input.quote)) throw new Error('exact human confirmation required');
        await verifyConversationEvidence(options.userId, options.cid!, { messageId: input.confirmationMessageId, quote: input.quote, certainty: 'confirmed' });
        await verifyConversationEvidence(options.userId, options.cid!, { messageId: input.sourceMessageId, quote: input.wrong, attachmentName: input.attachmentName, certainty: 'confirmed' });
        const docId = `chat:${options.cid}`;
        const ontology = readOntologyDocument(options.userId);
        const module = input.moduleId ? ontology.records[input.moduleId] : null;
        const entity = input.entityId ? ontology.records[input.entityId] : null;
        if (input.moduleId && (!module || module.kind !== 'module' || module.status !== 'active' || !ontologyModuleVisibleToTask(module, options.context)
          || !entity || entity.kind !== 'entity' || entity.moduleId !== module.id || entity.access !== 'task' || entity.status !== 'active' || entity.identityStatus !== 'confirmed'
          || entity.certainty && entity.certainty !== 'confirmed' || (entity.name !== input.correct && !entity.aliases.includes(input.correct)))) throw new Error('confirmed canonical entity required');
        if (entity?.kind === 'entity' && entity.aliases.includes(input.wrong) && !/(?:应为|应写|改成|替换为|统一写|统一用|correct to|replace with)/i.test(input.quote)) throw new Error('this is an accepted alias, not a confirmed transcription error');
        const scene = module ? `ontology:${module.id}` : '';

        const output = await fileEditLock(userTranscriptGlossaryFile(options.userId)).runExclusive(async () => {
          const existing = loadGlossary(options.userId).entries.find(entry => entry.wrong === input.wrong && entry.correct === input.correct && entry.scope.docIds.includes(docId) && !entry.scope.global && entry.status === 'active');
          if (existing && (!scene || existing.scope.scenarioTags.includes(scene))) return { duplicate: true, entries: [existing] };
          const before = loadGlossary(options.userId).entries.find(entry => entry.wrong === input.wrong && entry.correct === input.correct);
          const saved = existing ? { skipped: 0 } : rememberConfirmedPairs(options.userId, [{ wrong: input.wrong, correct: input.correct }], { docId });
          if (saved.skipped) throw new Error('correction was not saved');
          const file = loadGlossary(options.userId);
          const updated = file.entries.find(entry => entry.wrong === input.wrong && entry.correct === input.correct);
          if (updated) {
            updated.scope.docIds = [...new Set([...(before?.scope.docIds || []), docId])];
            updated.scope.scenarioTags = [...new Set([...(before?.scope.scenarioTags || []), ...(scene ? [scene] : [])])];
            updated.scope.global = before?.scope.global || false;
            if (module && entity) updated.ontologyRef = { groupId: module.id, fieldId: entity.id };
            saveGlossary(options.userId, file);
          }
          const entries = loadGlossary(options.userId).entries.filter(entry => entry.wrong === input.wrong && entry.correct === input.correct && entry.scope.docIds.includes(docId));
          if (!entries.length) throw new Error('correction read-back failed');
          return { duplicate: false, entries };
        });
        return { content: JSON.stringify({ saved: true, docId, ...output, policy: 'Only this conversation document scope. No original file was overwritten.' }) };
      } catch (error) { return { content: JSON.stringify({ saved: false, error: error instanceof Error ? error.message : 'correction save failed' }), isError: true }; }
    },
  }];
  tools.push({ name: 'transcript_corrections_query', executionMode: 'parallel',
    description: '修正会议转写前读取已确认的纠错对和本体规范名称。moduleId 表示本次会议对应的正式本体；仅返回当前会话或该本体场景中的确认纠错，未知/推断实体不作规范名称。结果只提供依据，不代表已改写文件。',
    inputSchema: { type: 'object', properties: { moduleId: { type: 'string' } }, additionalProperties: false },
    async execute(input) {
      try {
        const ontology = readOntologyDocument(options.userId), module = typeof input.moduleId === 'string' ? ontology.records[input.moduleId] : null;
        if (input.moduleId && (!module || module.kind !== 'module' || module.status !== 'active' || !ontologyModuleVisibleToTask(module, options.context))) throw new Error('module outside task scope');
        const entries = loadGlossary(options.userId).entries.filter(entry => {
          if (entry.ontologyRef) { const linked = ontology.records[entry.ontologyRef.fieldId]; if (!linked || linked.kind !== 'entity' || linked.access !== 'task' || linked.status !== 'active' || linked.identityStatus !== 'confirmed' || linked.certainty && linked.certainty !== 'confirmed' || linked.name !== entry.correct && !linked.aliases.includes(entry.correct)) return false; }
          return entry.status === 'active' && (entry.scope.global || entry.scope.docIds.includes(`chat:${options.cid}`) || module && entry.scope.scenarioTags.includes(`ontology:${module.id}`)); });
        const canonicalNames = Object.values(ontology.records).filter(record => record.kind === 'entity' && record.moduleId === module?.id && record.access === 'task' && record.status === 'active' && record.identityStatus === 'confirmed' && (!record.certainty || record.certainty === 'confirmed')).map(record => ({ id: record.id, name: record.kind === 'entity' ? record.name : '', aliases: record.kind === 'entity' ? record.aliases : [], version: record.version }));
        return { content: JSON.stringify({ entries, canonicalNames, policy: 'Confirmed evidence only; do not infer speaker identities or extend correction scope.' }) };
      } catch (error) { return { content: JSON.stringify({ error: error instanceof Error ? error.message : 'query failed' }), isError: true }; }
    },
  });
  return tools;
}
