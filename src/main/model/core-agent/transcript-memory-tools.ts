/** Read existing scoped correction pairs and canonical ontology names. */
import type { AgentTool } from '#core-agent';
import { loadGlossary } from '../../features/transcript_glossary';
import { readOntologyDocument } from '../../features/cognition/ontology/service';
import { ontologyModuleVisibleToTask } from '../../features/cognition/ontology/query';
import type { ResolvePersonalFieldsRequest } from '../../features/cognition_kernel/types';

export function createTranscriptMemoryTools(options: { userId: string; cid?: string; context?: ResolvePersonalFieldsRequest['context'] }): AgentTool[] {
  if (!options.cid) return [];
  const tools: AgentTool[] = [{ name: 'transcript_corrections_query', executionMode: 'parallel',
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
  }];
  return tools;
}
