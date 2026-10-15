/** 按任务时间、对象和显式模块引用读取本体；查询不会保存任务临时安排。 */
import type { AgentTool } from '#core-agent';
import { OntologyError, validateOntologyId } from '../../features/cognition/ontology/model';
import { readOntologyView } from '../../features/cognition/ontology/service';
import { assessOntologySources, ontologyWithAdmittedSources } from '../../features/cognition/ontology/source-admission';
import { ontologyModuleVisibleToTask, queryOntologyFacts, queryOntologyRules, searchOntologyRecords } from '../../features/cognition/ontology/query';
import { resolveOntologyRecordForModule } from '../../features/cognition/ontology/commands';
import { recordOntologyQueryReadReceipt, type OntologyQueryReadRef } from '../../features/cognition/ontology/query-receipt';
import type { ResolvePersonalFieldsRequest } from '../../features/cognition_kernel/types';
import { createLogger } from '../../logger';
import { logErrorRef, maskId } from '../../util/log-redact';

const log = createLogger('ontology-query');
function queryReadRef(row: Record<string, unknown>, kind: OntologyQueryReadRef['kind']): OntologyQueryReadRef | undefined {
  const module = row.module && typeof row.module === 'object' ? row.module as Record<string, unknown> : {};
  const source = row.source && typeof row.source === 'object' ? row.source as Record<string, unknown> : {};
  const sourceKind = source.kind;
  const recordVersion = Number(source.version);
  if (typeof module.id !== 'string' || typeof source.recordId !== 'string'
    || !['user', 'candidate', 'legacy'].includes(String(sourceKind)) || !Number.isSafeInteger(recordVersion)) return undefined;
  return { moduleId: module.id, recordId: source.recordId, recordVersion, kind, sourceKind: sourceKind as OntologyQueryReadRef['sourceKind'] };
}

export interface OntologyToolsOptions {
  userId: string;
  turnId?: string;
  context?: ResolvePersonalFieldsRequest['context'];
}
type ToolInput = Record<string, unknown>;
function todayLocal(): string {
  const now = new Date(), pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
function ontologyCitation(moduleId: string, recordId: string, version: number): string {
  return `[[ontology:${moduleId}/${recordId}@${version}]]`;
}
const contains = (value: unknown, needle: string) => String(value ?? '').toLocaleLowerCase().includes(needle.toLocaleLowerCase());

export function createOntologyTools(options: OntologyToolsOptions): AgentTool[] {
  const tool: AgentTool = {
    name: 'cognition_ontology_query',
    executionMode: 'parallel',
    description:
      '查询用户的本体认知：按人物、项目或关系查当前与历史事实，并查看适用于本任务的规则。'
      + '有项目/工作区时给出 moduleId，或先用用户说过的名称填 query。'
      + '只读；临时任务安排不会保存。每条结果带来源和版本，unknown 表示开始时间或规则条件未确认。'
      + 'rule 的 matched 只表示条件匹配，不表示规则已经检查、采用或执行；default、required、suggestion 要按原等级说明。若 truncated 计数非零，结果不完整，不能据此断言所有要求均已覆盖。'
      + '仅自己可见的内容和其他项目/工作区的内容不会返回。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', maxLength: 200, description: '要查询的人物、项目、关系或主题；例如 CogSeed、负责人、周报接收人。' },
        moduleId: { type: 'string', maxLength: 160, description: '可选。此前查询结果中的本体 ID。' },
        at: { type: 'string', maxLength: 10, description: '可选。查询哪一天的现实事实，格式 YYYY-MM-DD；缺省为今天。' },
        purpose: { type: 'string', maxLength: 200, description: '可选。任务目的的简短标记，用于判断规则条件。' },
        taskKind: { type: 'string', maxLength: 200, description: '可选。任务类型，用于判断规则条件。' },
        entityId: { type: 'string', maxLength: 160, description: '可选。此任务涉及的对象 ID。' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    async execute(input: ToolInput) {
      try {
        const query = String(input.query ?? '').trim();
        if (!query || query.length > 200) throw new OntologyError('invalid_input', '请输入不超过200字的查询主题');
        for (const field of ['purpose', 'taskKind'] as const) if (typeof input[field] === 'string' && input[field]!.length > 200) throw new OntologyError('invalid_input', `${field} is too long`);
        const at = typeof input.at === 'string' && input.at ? input.at : todayLocal();
        let doc = await readOntologyView(options.userId);
        const sourceStatuses = await assessOntologySources(options.userId, doc, options.context);
        doc = ontologyWithAdmittedSources(doc, sourceStatuses);
        const candidateRows = searchOntologyRecords(doc, query);
        const modules = Object.values(doc.records).filter((r): r is Extract<typeof r, { kind: 'module' }> => r.kind === 'module'
          && r.status === 'active' && ontologyModuleVisibleToTask(r, options.context));
        let targetModules = modules;
        if (typeof input.moduleId === 'string' && input.moduleId) {
          const moduleId = validateOntologyId(input.moduleId), selected = doc.records[moduleId];
          if (!selected || selected.kind !== 'module' || !ontologyModuleVisibleToTask(selected, options.context))
            throw new OntologyError('not_authorized', '所选本体不存在或不属于当前任务范围');
          targetModules = [selected];
        } else {
          const moduleIds = new Set(candidateRows.flatMap(row => [row.kind === 'module' ? row.id : row.moduleId].filter((v): v is string => Boolean(v))));
          targetModules = modules.filter(module => moduleIds.has(module.id));
        }
        const entityIds = new Set(candidateRows.filter(row => row.kind === 'entity').map(row => row.id));
        const definitionIds = new Set(candidateRows.filter(row => row.kind === 'definition').map(row => row.id));
        const facts: Array<Record<string, unknown>> = [], uncertain: Array<Record<string, unknown>> = [], rules: Array<Record<string, unknown>> = [];
        for (const module of targetModules.slice(0, 50)) {
          const queried = queryOntologyFacts(doc, { moduleId: module.id, at });
          const relevant = (assertion: typeof queried.matched[number]) => {
            const definition = resolveOntologyRecordForModule(doc, module.id, assertion.definitionId);
            const subject = resolveOntologyRecordForModule(doc, module.id, assertion.subjectId);
            const object = assertion.object.kind === 'entity' ? resolveOntologyRecordForModule(doc, module.id, assertion.object.id) : null;
            const sourceModule = doc.records[assertion.moduleId];
            if (!sourceModule || sourceModule.kind !== 'module' || !ontologyModuleVisibleToTask(sourceModule, options.context)) return false;
            if (typeof input.moduleId === 'string' && input.moduleId) return true;
            return candidateRows.some(row => row.kind === 'module' && row.id === module.id) || entityIds.has(assertion.subjectId)
              || (assertion.object.kind === 'entity' && entityIds.has(assertion.object.id))
              || definitionIds.has(assertion.definitionId)
              || contains(definition?.kind === 'definition' ? definition.name : '', query)
              || contains(subject?.kind === 'entity' ? subject.name : '', query)
              || contains(object?.kind === 'entity' ? object.name : assertion.object.kind === 'literal' ? assertion.object.value : '', query);
          };
          const toFact = (assertion: typeof queried.matched[number], match: 'matched' | 'unknown') => {
            const subject = resolveOntologyRecordForModule(doc, module.id, assertion.subjectId), definition = resolveOntologyRecordForModule(doc, module.id, assertion.definitionId);
            const object = assertion.object.kind === 'entity' ? resolveOntologyRecordForModule(doc, module.id, assertion.object.id) : null;
            return { match, statement: `${subject?.kind === 'entity' ? subject.name : assertion.subjectId} · ${definition?.kind === 'definition' ? definition.name : assertion.definitionId} · ${object?.kind === 'entity' ? object.name : assertion.object.kind === 'literal' ? assertion.object.value : assertion.object.id}`,
              validity: assertion.validity, module: { id: assertion.moduleId, name: (doc.records[assertion.moduleId] as { name?: string })?.name },
              citation: ontologyCitation(assertion.moduleId, assertion.id, assertion.version),
              source: { recordId: assertion.id, version: assertion.version, label: assertion.source.label, kind: assertion.source.kind } };
          };
          for (const assertion of queried.matched.filter(relevant)) facts.push(toFact(assertion, 'matched'));
          for (const assertion of queried.uncertain.filter(relevant)) uncertain.push(toFact(assertion, 'unknown'));
          for (const result of queryOntologyRules(doc, { moduleId: module.id, task: {
            at,
            ...(typeof input.purpose === 'string' && input.purpose ? { purpose: input.purpose } : {}),
            ...(typeof input.taskKind === 'string' && input.taskKind ? { taskKind: input.taskKind } : {}),
            ...(typeof input.entityId === 'string' && input.entityId ? { entityId: validateOntologyId(input.entityId) } : {}),
          } })) {
            const sourceModule = doc.records[result.rule.moduleId];
            if (!sourceModule || sourceModule.kind !== 'module' || !ontologyModuleVisibleToTask(sourceModule, options.context)) continue;
            if (typeof input.moduleId !== 'string' && result.match === 'not_matched'
              && !contains(result.rule.name, query) && !contains(result.rule.requirement, query)) continue;
            const effect = result.rule.effect.kind === 'include_recipient'
              ? { ...result.rule.effect, entityName: (() => { const entity = resolveOntologyRecordForModule(doc, module.id, result.rule.effect.entityId); return entity?.kind === 'entity' ? entity.name : ''; })() }
              : result.rule.effect;
            rules.push({ name: result.rule.name, requirement: result.rule.requirement, strength: result.rule.strength,
              match: result.match, exception: result.rule.exception, effect,
              module: { id: result.rule.moduleId, name: sourceModule.name }, citation: ontologyCitation(result.rule.moduleId, result.rule.id, result.rule.version),
              source: { recordId: result.rule.id, version: result.rule.version, label: result.rule.source.label, kind: result.rule.source.kind } });
          }
        }
        const factLimit = 60, ruleLimit = 30;
        const visibleFacts = facts.slice(0, factLimit), visibleUncertainFacts = uncertain.slice(0, factLimit), visibleRules = rules.slice(0, ruleLimit);
        const choiceGroups = new Map<string, Array<{ value: string; match: string; recordId: string; moduleId: string; version: number; sourceKind: string }>>();
        for (const rule of visibleRules) {
          const effect = rule.effect as { kind?: string; key?: string; value?: string };
          if (effect.kind !== 'choice' || !effect.key || typeof effect.value !== 'string' || rule.match === 'not_matched') continue;
          choiceGroups.set(effect.key, [...(choiceGroups.get(effect.key) || []), { value: effect.value, match: String(rule.match),
            recordId: String((rule.source as { recordId?: string }).recordId || ''), moduleId: String((rule.module as { id?: string }).id || ''),
            version: Number((rule.source as { version?: number }).version || 0), sourceKind: String((rule.source as { kind?: string }).kind || '') }]);
        }
        const conflicts = [...choiceGroups].filter(([, entries]) => new Set(entries.map(item => item.value)).size > 1)
          .map(([key, entries]) => ({ key, values: [...new Set(entries.map(item => item.value))].slice(0, 10),
            state: entries.some(item => item.match === 'unknown') ? 'potential' : 'confirmed', sources: entries.slice(0, 10),
            omittedSourceCount: Math.max(0, entries.length - 10) }));
        let readReceiptId: string | undefined, readReceiptStatus: 'recorded' | 'unavailable' | 'no_turn_id' | 'no_result_refs' = 'no_turn_id';
        if (options.turnId) {
          try {
            const readRefs: OntologyQueryReadRef[] = [
              ...[...visibleFacts, ...visibleUncertainFacts].map(row => queryReadRef(row, 'assertion')),
              ...visibleRules.map(row => queryReadRef(row, 'rule')),
            ].filter((ref): ref is OntologyQueryReadRef => Boolean(ref));
            const receipt = await recordOntologyQueryReadReceipt(options.userId, options.turnId, readRefs);
            readReceiptId = receipt?.id;
            readReceiptStatus = receipt ? 'recorded' : 'no_result_refs';
          } catch (error) {
            readReceiptStatus = 'unavailable';
            log.warn('ontology query read receipt failed', { userId: maskId(options.userId), turnId: maskId(options.turnId), error: logErrorRef(error as Error) });
          }
        }
        return { content: JSON.stringify({ query, at, modules: targetModules.slice(0, 50).map(m => ({ id: m.id, name: m.name, scope: m.scope })),
          revision: doc.revision, records: Object.values(doc.records).filter(record => targetModules.some(module => (record.kind === 'module' ? record.id : record.moduleId) === module.id) && record.access === 'task' && record.status === 'active' && (record.kind !== 'assertion' || [...visibleFacts, ...visibleUncertainFacts].some(fact => (fact.source as { recordId?: string }).recordId === record.id))).slice(0, 100),
          facts: visibleFacts, uncertainFacts: visibleUncertainFacts, rules: visibleRules, conflicts, conflictsComplete: rules.length <= ruleLimit && targetModules.length <= 50,
          readReceipt: { status: readReceiptStatus, ...(readReceiptId ? { id: readReceiptId } : {}) },
          usageReceiptPolicy: 'If a fact or rule materially informs the final answer, copy its citation marker exactly into that answer. The host records use only when the same-turn query returned that exact version and the marker appears in the persisted reply. This does not prove external action execution or effectiveness.',
          truncated: { facts: Math.max(0, facts.length - factLimit), uncertainFacts: Math.max(0, uncertain.length - factLimit), rules: Math.max(0, rules.length - ruleLimit), modules: Math.max(0, targetModules.length - 50) },
          sourceCoverage: { complete: ![...sourceStatuses.values()].includes('unavailable') },
          useBoundary: 'The read receipt means this tool produced a result containing the cited record versions; it does not prove adoption or execution. A rule match does not mean rule execution. If any truncated count is nonzero or sourceCoverage.complete is false, this result is incomplete and cannot certify that all requirements were checked.' }, null, 2) };
      } catch (error) {
        return { content: `cognition_ontology_query: ${error instanceof Error ? error.message : '本体查询失败'}`, isError: true };
      }
    },
  };
  return [tool];
}
