import { safeId } from '../../storage';
import { getConversation, getMessages } from '../chats';
import { readRecallCandidate } from './candidate-service';
import { readAbilityAsset } from './asset-service';
import { isCognitionSourceEnabled } from './source-control';
import { normalizeCognitionSourceRef, type CognitionSourceRef } from './source-service';

export interface ReviewEvidenceItem {
  ref: CognitionSourceRef;
  state: 'available' | 'unavailable' | 'unrecorded' | 'read_failed';
  title?: string;
  excerpt?: string;
  excerptKind?: 'recorded' | 'conversation_context';
  conversationId?: string;
}

/** Read only sources already attached to an owned candidate/asset. Excerpts are
 * a transient review projection, never copied into the metadata-only catalog. */
export async function readReviewEvidence(
  userId: string,
  query: { candidateId?: string; assetId?: string },
): Promise<ReviewEvidenceItem[]> {
  if (Boolean(query.candidateId) === Boolean(query.assetId)) throw new Error('one review target is required');
  const id = query.candidateId || query.assetId;
  if (!safeId(id)) throw new Error('invalid review target id');
  const record = query.candidateId
    ? await readRecallCandidate(userId, query.candidateId)
    : await readAbilityAsset(userId, query.assetId!);
  const refs = record.evidenceRefs || ('sourceRefs' in record ? record.sourceRefs : []) || [];
  const seen = new Set<string>();
  const picked = (refs as CognitionSourceRef[]).filter(ref => {
    const key = `${ref.kind}:${ref.id}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }).slice(0, 100);
  return Promise.all(picked.map(async (ref): Promise<ReviewEvidenceItem> => {
    const { excerpt: _storedExcerpt, ...metadata } = ref;
    const base = { ref: metadata };
    if (ref.degraded) return { ...base, state: 'unavailable' };
    // The source-control domain uses canonical v2 discriminants.
    if (ref.kind !== 'conversation') return { ...base, state: 'unrecorded' };
    try {
      if (!(await isCognitionSourceEnabled(userId, ref))) return { ...base, state: 'unavailable' };
      // Message references use hashed locators; do not guess a parent session.
      if (ref.subtype === 'message' || !safeId(ref.id)) return { ...base, state: 'unrecorded' };
      const conversation = await getConversation(userId, ref.id);
      if (!conversation || conversation.deleted_at) return { ...base, state: 'unavailable' };
      const recorded = typeof ref.excerpt === 'string' ? ref.excerpt : '';
      const messages = recorded ? [] : await getMessages(userId, ref.id, 50);
      const at = Date.parse(String(record.createdAt || ''));
      const before = messages.filter(message => message.from === 'user' && message.text
        && !message.system_kind && (!Number.isFinite(at) || Date.parse(message.ts) <= at));
      const context = before.slice(-2).map(message => message.text.trim()).join('\n');
      const excerpt = normalizeCognitionSourceRef({ ...ref, excerpt: recorded || context }).excerpt;
      return {
        ...base, state: 'available', title: conversation.title || ref.title,
        conversationId: conversation.conversation_id,
        ...(excerpt ? { excerpt, excerptKind: recorded ? 'recorded' : 'conversation_context' } : {}),
      };
    } catch {
      return { ...base, state: 'read_failed' };
    }
  }));
}
