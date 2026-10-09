/** Trusted conversation evidence → ordinary governed commands. No file is treated as a saved ontology. */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { z } from 'zod';
import { chatAttachmentDir } from '../../../paths';
import { safeId } from '../../../storage';
import { isPathAllowed } from '../../../util/path-sandbox';
import { readSlice } from '../../group_chat/visibility';
import { validateOntologyCommand, type OntologyAction } from './commands';
import { OntologyError, type OntologyRecord } from './model';
import { commitOntologyCommand, previewOntologyCommand, readOntologyDocument } from './service';
import { ontologyModuleVisibleToTask } from './query';
import type { ResolvePersonalFieldsRequest } from '../../cognition_kernel/types';

const evidenceSchema = z.object({ messageId: z.string().min(1).max(160), quote: z.string().trim().min(1).max(2000),
  attachmentName: z.string().max(240).optional(), certainty: z.enum(['confirmed', 'inferred', 'unknown']) }).strict();
export const conversationSaveSchema = z.object({ command: z.unknown(), evidence: z.array(evidenceSchema).min(1).max(50) }).strict();
export type ConversationEvidence = z.infer<typeof evidenceSchema>;
export interface ConversationWriteContext { cid: string; context?: ResolvePersonalFieldsRequest['context'] }

export async function verifyConversationEvidence(userId: string, cid: string, input: unknown): Promise<ConversationEvidence> {
  if (!safeId(cid)) throw new OntologyError('invalid_input', 'conversation id invalid');
  const evidence = evidenceSchema.parse(input);
  const messages = await readSlice(userId, cid, 'commander');
  const user = messages.find(message => message.from === 'user' && message.id === evidence.messageId);
  if (!user) throw new OntologyError('evidence_missing', 'source user message unavailable');
  let text = user.text || '';
  if (evidence.attachmentName) {
    if (!(user.attachments || []).includes(evidence.attachmentName) || path.basename(evidence.attachmentName) !== evidence.attachmentName)
      throw new OntologyError('evidence_missing', 'attachment was not supplied in the cited user message');
    const root = await fs.realpath(chatAttachmentDir(userId, cid));
    const file = await fs.realpath(path.join(root, evidence.attachmentName));
    if (!isPathAllowed(file, [root])) throw new OntologyError('not_authorized', 'attachment outside conversation');
    if ((await fs.stat(file)).size > 1024 * 1024) throw new OntologyError('invalid_input', 'evidence file too large');
    text = await fs.readFile(file, 'utf8');
  }
  if (!text.includes(evidence.quote)) throw new OntologyError('evidence_missing', 'quote does not match the source');
  return evidence;
}

export async function saveConversationOntology(userId: string, input: unknown, options: ConversationWriteContext) {
  const parsed = conversationSaveSchema.parse(input), command = validateOntologyCommand(parsed.command);
  if (parsed.evidence.length !== command.actions.length) throw new OntologyError('evidence_missing', 'each change requires its own evidence');
  const messages = await readSlice(userId, options.cid, 'commander');
  const users = messages.filter(message => message.from === 'user');
  // Authorization comes from human messages, not model-supplied booleans or attachment instructions.
  let authorizing = users.at(-1);
  if (/^(?:继续|继续吧|接着|continue|go on)[\s。.!！]*$/i.test(authorizing?.text || '')) authorizing = [...users].reverse().find(message => /(?:本体|ontology)/i.test(message.text || ''));
  if (!users.some(message => /(?:本体|ontology)/i.test(message.text || '')) || /(?:不要保存|不保存|仅分析|只分析|do not save|read.only)/i.test(authorizing?.text || '') || !authorizing || !/(?:创建|建立|保存|更新|修正|纠正|回填|记住|记一下|create|save|update|correct|remember)/i.test(authorizing.text || ''))
    throw new OntologyError('not_authorized', 'an explicit human save or correction request is required');
  const current = readOntologyDocument(userId);
  const actions: OntologyAction[] = [];
  for (const [index, action] of command.actions.entries()) {
    if (!['create', 'update', 'correct', 'change'].includes(action.intent)) throw new OntologyError('not_authorized', 'identity merge, deletion and access changes require their dedicated UI');
    let evidence = await verifyConversationEvidence(userId, options.cid, parsed.evidence[index]);
    const proposed = action.intent === 'create' ? action.record : action.intent === 'update' ? action.patch : {};
    // An explicit pending note on a schema item is still a tracked open question, not a confirmed meaning.
    if (/(?:待回填|含义未确认|含义不明|meaning unknown|pending clarification)/i.test(String(proposed.description || ''))) evidence = { ...evidence, certainty: 'unknown' };
    const certaintyLabel = evidence.certainty === 'confirmed' ? '已确认' : evidence.certainty === 'inferred' ? '推断待核对' : '待回填';
    const sourceLabel = `会话 ${options.cid}/${evidence.messageId} · ${certaintyLabel} · ${evidence.quote.slice(0, 70)}`.slice(0, 200);
    const data = action.intent === 'create' ? action.record : action.intent === 'update' ? action.patch : {};
    if (Object.hasOwn(data, 'access') && data.access !== 'task' || Object.hasOwn(data, 'status')) throw new OntologyError('not_authorized', 'conversation writes cannot change access or lifecycle');
    if (action.intent === 'create' && action.record.kind === 'reference') throw new OntologyError('not_authorized', 'cross-module references require the ontology UI');
    const record = action.intent === 'create' ? action.record : current.records[action.recordId];
    if (record && ['entity', 'assertion', 'rule'].includes(String(record.kind)) && evidence.certainty === 'confirmed' && /(?:不知道|不清楚|待确认|待回填|疑为|可能是|未确认|推断|猜测|not sure|unknown|inferred)/i.test(evidence.quote)) throw new OntologyError('confirmation_required', 'uncertain evidence cannot become a confirmed record');
    if (action.intent === 'create' && action.record.kind === 'module' && !current.receipts[`chat-${options.cid}-${command.commandId}`.slice(0,160)] && Object.values(current.records).some(existing => existing.kind === 'module' && existing.status === 'active' && existing.name === action.record.name && JSON.stringify(existing.scope) === JSON.stringify(action.record.scope) && existing.id !== action.recordId)) throw new OntologyError('already_exists', 'module already exists; query and update it rather than creating another');
    if (record?.kind === 'entity' && Array.isArray(proposed.aliases) && evidence.certainty === 'confirmed' && proposed.aliases.some(alias => typeof alias !== 'string' || !evidence.quote.includes(alias))) throw new OntologyError('confirmation_required', 'canonical aliases need direct evidence; ASR errors belong in the correction glossary');
    const module = record?.kind === 'module' ? record : current.records[String(record && 'moduleId' in record ? record.moduleId : '')];
    if (module && module.kind === 'module' && !ontologyModuleVisibleToTask({ ...module, access: module.access ?? 'task' } as Extract<OntologyRecord, { kind: 'module' }>, options.context))
      throw new OntologyError('not_authorized', 'ontology outside the current task scope');
    if (action.intent !== 'create' && (!record || record.access === 'owner_only')) throw new OntologyError('not_authorized', 'record unavailable for conversation editing');
    if (action.intent === 'update' && Object.hasOwn(action.patch, 'scope')) throw new OntologyError('not_authorized', 'scope changes require the ontology UI');
    if (action.intent === 'create') actions.push({ ...action, sourceLabel, record: { ...action.record, certainty: evidence.certainty,
      ...(action.record.kind === 'entity' && evidence.certainty !== 'confirmed' ? { identityStatus: 'unresolved' } : {}) } });
    else if (action.intent === 'update') {
      const identityPatch: Record<string, unknown> = {};
      if (record?.kind === 'entity') {
        if (evidence.certainty !== 'confirmed') identityPatch.identityStatus = 'unresolved';
        else if (record.identityStatus === 'unresolved') {
          const name = String(action.patch.name || record.name);
          if (!evidence.quote.includes(name) || ['不是', '不叫', '并非', 'not '].some(prefix => evidence.quote.includes(prefix + name)))
            throw new OntologyError('confirmation_required', 'resolving an unknown identity requires its exact positively confirmed name');
          identityPatch.identityStatus = 'confirmed';
        }
      }
      actions.push({ ...action, sourceLabel, patch: { ...action.patch, ...identityPatch, certainty: evidence.certainty } });
    }
    else if (action.intent === 'correct' || action.intent === 'change') actions.push({ ...action, sourceLabel, certainty: evidence.certainty });
  }
  const stamped = { ...command, commandId: `chat-${options.cid}-${command.commandId}`.slice(0, 160), actions };
  previewOntologyCommand(userId, stamped); // Whole-batch validation before any persistent change.
  const result = await commitOntologyCommand(userId, stamped);
  const saved = readOntologyDocument(userId);
  const records = result.receipt.changedIds.map(id => saved.records[id]);
  const moduleIds = [...new Set(records.map(record => record.kind === 'module' ? record.id : record.moduleId))];
  return { saved: true, duplicate: result.duplicate, receipt: result.receipt, moduleIds, records,
    citations: records.map(record => `[[ontology:${record.kind === 'module' ? record.id : record.moduleId}/${record.id}@${record.version}]]`),
    pendingIds: Object.values(saved.records).filter(record => moduleIds.includes(record.kind === 'module' ? record.id : record.moduleId) && record.certainty && record.certainty !== 'confirmed' && record.status === 'active').map(record => record.id),
    policy: 'Saved records were read back from the same store used by the ontology page. Inferred/unknown records are pending, not confirmed facts. A Markdown file alone never proves this save.' };
}
