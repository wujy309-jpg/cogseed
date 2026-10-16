/** Host-owned execution → persisted reply → produced-content binding.
 * Old executions remain text-only; new unbound or changed results fail closed. */
import { isDeepStrictEqual } from 'node:util';
import { readJsonl } from '../../storage';
import { conversationMessageReadFile } from '../../util/project-layout';
import * as executions from '../execution-records';
import { readPersistedResultContent, type PersistedResultContent } from './persisted-result-content';

interface ResultMessage { id: string; text?: string; from?: string; turn_id?: string; turn_end?: boolean; produced?: unknown[]; deleted_at?: string; failure_kind?: string }

function refsMatch(current: PersistedResultContent['refs'], expected: PersistedResultContent['refs']): boolean {
  // Existing plain-text bindings predate raw-byte integrity. Preserve their
  // original text-hash contract rather than invalidating history on upgrade.
  return isDeepStrictEqual(current.map((ref, index) => {
    const result = { ...ref };
    if (expected[index]?.sourceHash === undefined) delete result.sourceHash;
    return result;
  }), expected);
}

export async function bindExecutionResultMessage(userId: string, executionId: string, cid: string, message: ResultMessage): Promise<void> {
  const record = await executions.read(userId, executionId);
  if (record.resultMessage !== 'pending') return;
  if (record.status !== 'completed' || record.conversationId !== cid || !message.turn_end
    || executionId !== `turn-${message.turn_id}` || (record.agentId && record.agentId !== message.from)) {
    throw new Error('execution reply identity mismatch');
  }
  const content = await readPersistedResultContent(userId, cid, message);
  await executions.bindCompletedResultMessage(userId, executionId, cid, { id: message.id, refs: content.refs });
}

/** Anonymous workers have no UI message. The bus supplies its settled text
 * and trusted produced list; they survive deletion of the throwaway session. */
export async function bindExecutionResultOutput(userId: string, executionId: string, cid: string, actorId: string,
  text: string, produced: string[]): Promise<void> {
  const record = await executions.read(userId, executionId);
  if (record.resultOutput !== 'pending') return;
  if (record.status !== 'completed' || record.conversationId !== cid || record.agentId !== actorId || !record.resultRef)
    throw new Error('execution output identity mismatch');
  const content = await readPersistedResultContent(userId, cid, { id: executionId, text, produced, sourceKind: 'execution_output' });
  await executions.bindCompletedResultOutput(userId, executionId, { schemaVersion: 1, executionId,
    conversationId: cid, agentId: actorId, resultRef: record.resultRef, text, produced, refs: content.refs });
}

export async function readExecutionResultContent(userId: string, record: executions.ExecutionRecord): Promise<PersistedResultContent> {
  if (record.resultOutput) {
    const recovered = await executions.readCompletedResultOutput(userId, record.executionId);
    const content = await readPersistedResultContent(userId, recovered.manifest.conversationId, {
      id: record.executionId, text: recovered.manifest.text, produced: recovered.manifest.produced, sourceKind: 'execution_output',
    });
    if (!content.coverage.complete || recovered.record.resultOutput === 'pending'
      || !refsMatch(content.refs, recovered.record.resultOutput?.refs || [])) throw new Error('persisted execution output changed or incomplete');
    return content;
  }
  if (!record.resultMessage) {
    const text = await executions.readResult(userId, record.executionId, record.resultRef!);
    return { text, refs: [], coverage: { complete: true, totalFiles: 0, readableFiles: 0 } };
  }
  if (!record.conversationId) throw new Error('execution reply not bound');
  const rows = [...new Map((await readJsonl<ResultMessage>(conversationMessageReadFile(userId, record.conversationId), 0))
    .map(row => [row.id, row])).values()];
  if (record.resultMessage === 'pending') {
    // A crash after transcript persistence but before the binding needs no
    // agent rerun. Only one official, successful host reply can repair it.
    const eligible = rows.filter(row => !row.deleted_at && !row.failure_kind && row.turn_end
      && record.executionId === `turn-${row.turn_id}` && (!record.agentId || record.agentId === row.from));
    if (eligible.length !== 1) throw new Error('execution reply not bound');
    await bindExecutionResultMessage(userId, record.executionId, record.conversationId, eligible[0]);
    record = await executions.read(userId, record.executionId);
  }
  const message = rows.find(row => row.id === (record.resultMessage as { id: string }).id && !row.deleted_at && !row.failure_kind);
  if (!message || record.executionId !== `turn-${message.turn_id}` || !message.turn_end
    || (record.agentId && record.agentId !== message.from)) throw new Error('persisted execution reply unavailable');
  const content = await readPersistedResultContent(userId, record.conversationId, message);
  if (!content.coverage.complete || record.resultMessage === 'pending' || !refsMatch(content.refs, record.resultMessage?.refs || [])) {
    throw new Error('persisted execution result changed or incomplete');
  }
  return content;
}
