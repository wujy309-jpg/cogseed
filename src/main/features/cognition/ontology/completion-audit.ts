/** Completion is derived from canonical commits, never from a generated document or model assertion. */
import { readSlice } from '../../group_chat/visibility';
import { readOntologyDocument } from './service';
export async function auditConversationOntologyCompletion(userId: string, cid: string, sourceMessageId?: string) {
  const users = (await readSlice(userId, cid, 'commander')).filter(message => message.from === 'user');
  const latest = sourceMessageId ? users.find(message => message.id === sourceMessageId) : users.at(-1);
  if (!latest) return { required: false, saved: false };
  let request = latest.text || '';
  if (/^(?:继续|继续吧|接着|continue|go on)[\s。.!！]*$/i.test(request)) request = users.slice(0,-1).reverse().find(message => /(?:创建|建立|保存|更新|修正|纠正|回填|记住|记一下)/.test(message.text || ''))?.text || '';
  const required = users.some(message => /(?:本体|ontology)/i.test(message.text || ''))
    && !/(?:仅分析|只分析|不要保存|不保存|解释一下|为什么|如何)/.test(request)
    && /(?:创建|建立|保存|更新|修正|纠正|回填|记住|记一下|create|save|update|correct|remember)/i.test(request);
  if (!required) return { required: false, saved: false };
  const since = Date.parse(latest.ts), doc = readOntologyDocument(userId);
  const commits = doc.history.filter(entry => entry.after.source.label.startsWith(`会话 ${cid}/`) && Date.parse(entry.recordedAt) >= since);
  return { required: true, saved: commits.length > 0, revision: doc.revision, changedIds: [...new Set(commits.map(entry=>entry.after.id))] };
}
