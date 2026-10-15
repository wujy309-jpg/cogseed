/** Read final text deliverables from the persisted message's trusted produced list. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isPathAllowed, canonicalizePath } from '../../util/path-sandbox';
import { chatAttachmentDirForConversation } from '../../util/project-layout';
import { getWorkspacePath } from '../user_workspace';
import { getConversation } from '../chats';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const formats = new Set(['.md', '.markdown', '.txt', '.csv', '.tsv', '.json']);
export interface PersistedResultContent {
  text: string;
  refs: Array<{ kind: 'message' | 'file'; id: string; contentHash?: string; contentRange?: { start: number; end: number }; status: 'readable' | 'unverified' }>;
  coverage: { complete: boolean; totalFiles: number; readableFiles: number };
}

export async function readPersistedResultContent(userId: string, cid: string, message: {
  id: string; text?: string; produced?: unknown[];
}): Promise<PersistedResultContent> {
  const text = String(message.text || '');
  const refs: PersistedResultContent['refs'] = [{ kind: 'message', id: message.id, contentHash: hash(text), contentRange: { start: 0, end: text.length }, status: 'readable' }];
  const files = [...new Set((message.produced || []).filter((value): value is string => typeof value === 'string' && !!value.trim()))];
  if (!files.length) return { text, refs, coverage: { complete: true, totalFiles: 0, readableFiles: 0 } };
  let roots: string[] = [];
  try {
    const conversation = await getConversation(userId, cid);
    if (conversation) roots = [getWorkspacePath(userId, conversation.project_id || undefined), chatAttachmentDirForConversation(userId, cid)].filter(Boolean);
  } catch { /* Missing scope cannot grant filesystem access. */ }
  let combined = text;
  let readableFiles = 0, bytes = 0;
  for (const [index, file] of files.entries()) {
    const id = 'result-' + hash(JSON.stringify([cid, message.id, path.resolve(file)])).slice(0, 24);
    const row: PersistedResultContent['refs'][number] = { kind: 'file', id, status: 'unverified' };
    refs.push(row);
    if (index >= 12 || !formats.has(path.extname(file).toLowerCase()) || !isPathAllowed(file, roots)) continue;
    try {
      const actual = canonicalizePath(file), before = await fs.stat(actual);
      if (!before.isFile() || before.size > 96_000 || bytes + before.size > 96_000) continue;
      const content = new TextDecoder('utf-8', { fatal: true }).decode(await fs.readFile(actual));
      const after = await fs.stat(actual);
      if (!isPathAllowed(file, roots) || canonicalizePath(file) !== actual || before.dev !== after.dev || before.ino !== after.ino
        || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) continue;
      row.status = 'readable'; row.contentHash = hash(content); readableFiles++; bytes += after.size;
      const prefix = `\n\n[Persisted file ${id}]\n`;
      row.contentRange = { start: combined.length + prefix.length, end: combined.length + prefix.length + content.length };
      combined += `${prefix}${content}\n[End persisted file ${id}]`;
    } catch { /* Unsupported, removed or changing results stay unverified. */ }
  }
  return { text: combined, refs, coverage: { complete: readableFiles === files.length, totalFiles: files.length, readableFiles } };
}
