/** User-reviewed Recall candidates can be materialized as canonical ontology records. */
import { createHash } from 'node:crypto';
import { safeId } from '../../../storage';
import { evaluateCandidate, isCandidateBlocked } from '../gate';
import {
  markRecallCandidateIntegrated,
  readRecallCandidate,
  recordRecallCandidateOntologyProgress,
  withRecallCandidateReviewLock,
  type RecallCandidateOntologyHandoff,
} from '../../recall/candidate-service';
import { commitOntologyCommand, readOntologyDocument } from './service';
import { OntologyError, type OntologyModule } from './model';
import { validateOntologyCommand } from './commands';

function assertCandidateModuleScope(candidate: Awaited<ReturnType<typeof readRecallCandidate>>, module: OntologyModule): void {
  const policy = candidate.scopePolicy;
  if (!policy) return;
  if (policy.agentIds !== undefined || policy.roleIds !== undefined || policy.purposeTags !== undefined
    || policy.conversationKinds !== undefined || policy.fileKinds !== undefined) {
    throw new OntologyError('scope_not_representable', 'candidate access restrictions cannot be represented by this ontology module');
  }
  if (policy.projectIds !== undefined && (policy.workspaceIds !== undefined || policy.projectIds.length === 0
    || module.scope.kind !== 'project' || !module.scope.id || !policy.projectIds.includes(module.scope.id))) {
    throw new OntologyError('not_authorized', 'choose a project ontology inside the candidate access scope');
  }
  if (policy.workspaceIds !== undefined && (policy.workspaceIds.length === 0
    || module.scope.kind !== 'workspace' || !module.scope.id || !policy.workspaceIds.includes(module.scope.id))) {
    throw new OntologyError('not_authorized', 'choose a workspace ontology inside the candidate access scope');
  }
}

function candidateRecords(userId: string, candidateId: string) {
  const ontology = readOntologyDocument(userId);
  const records = Object.values(ontology.records).filter(record => record.source.kind === 'candidate' && record.source.recordId === candidateId);
  const history = ontology.history.filter(entry => entry.after.source.kind === 'candidate' && entry.after.source.recordId === candidateId);
  return { ontology, records, history };
}

function handoffFromRecords(input: ReturnType<typeof candidateRecords>): RecallCandidateOntologyHandoff | undefined {
  if (!input.records.length) return undefined;
  const moduleIds = [...new Set(input.records.flatMap(record => record.kind === 'module' ? [] : [record.moduleId]))];
  const recordIds = [...new Set(input.records.map(record => record.id))];
  if (!moduleIds.length || moduleIds.length > 20 || recordIds.length > 100) {
    throw new OntologyError('capacity_exceeded', 'candidate ontology handoff is too large');
  }
  const history = input.history.slice().sort((a, b) => a.revision - b.revision);
  const commandId = history[history.length - 1]?.commandId;
  if (!commandId) throw new OntologyError('store_corrupt', 'candidate-linked ontology records have no command history');
  return { status: 'in_progress', commandId, moduleIds, recordIds, ontologyRevision: input.ontology.revision,
    committedAt: history[history.length - 1].recordedAt };
}

export async function commitCandidateOntologyRecords(userId: string, input: {
  candidateId: string; moduleId: string; batchId: string; riskAcknowledged?: boolean; command: unknown;
}): Promise<{ candidate: Awaited<ReturnType<typeof readRecallCandidate>>; handoff: RecallCandidateOntologyHandoff; duplicate: boolean }> {
  if (!safeId(userId) || !safeId(input.candidateId) || !safeId(input.moduleId) || !safeId(input.batchId))
    throw new OntologyError('invalid_input', 'invalid ontology candidate handoff reference');
  if (input.riskAcknowledged !== undefined && typeof input.riskAcknowledged !== 'boolean')
    throw new OntologyError('invalid_input', 'invalid risk acknowledgment');
  return withRecallCandidateReviewLock(userId, async () => {
    const candidate = await readRecallCandidate(userId, input.candidateId);
    if (candidate.status === 'integrated' && candidate.ontologyHandoff) {
      return { candidate, handoff: candidate.ontologyHandoff, duplicate: true };
    }
    if (['confirmed', 'rejected', 'ignored', 'expired'].includes(candidate.status))
      throw new OntologyError('candidate_terminal', 'this candidate has already been handled');
    if (candidate.risk === 'high' && input.riskAcknowledged !== true)
      throw new OntologyError('risk_ack_required', 'high-risk candidates need explicit acknowledgment before ontology save');
    if (isCandidateBlocked(evaluateCandidate({ title: candidate.summary, summary: candidate.value, body: candidate.judgment })))
      throw new OntologyError('candidate_security_blocked', 'candidate content is blocked by the cognition security gate');

    const document = readOntologyDocument(userId), target = document.records[input.moduleId];
    if (!target || target.kind !== 'module' || target.status !== 'active' || target.source.kind === 'legacy')
      throw new OntologyError('not_found', 'select an active writable ontology');
    assertCandidateModuleScope(candidate, target);
    const command = validateOntologyCommand(input.command);
    if (command.actions.some(action => action.intent !== 'create'
      || action.record.kind === 'module'
      || String(action.record.moduleId || '') !== target.id)) {
      throw new OntologyError('invalid_input', 'candidate conversion may only create records inside the selected ontology');
    }
    const existing = candidateRecords(userId, candidate.id);
    if (existing.records.length + command.actions.length > 100)
      throw new OntologyError('capacity_exceeded', 'candidate conversion exceeds the 100-record review limit');
    for (const record of existing.records) {
      if (record.kind !== 'module' && record.moduleId !== target.id)
        throw new OntologyError('candidate_scope_conflict', 'this candidate already contains records in another ontology');
    }
    const commandId = `ontcand-${createHash('sha256').update(`${candidate.id}\n${target.id}\n${input.batchId}`).digest('hex').slice(0, 28)}`;
    const commandInput = { ...command, commandId };
    let commandReceipt = document.receipts[commandId];
    let duplicate = Boolean(commandReceipt);
    if (!commandReceipt) {
      const committed = await commitOntologyCommand(userId, commandInput, {
        kind: 'candidate', recordId: candidate.id, label: candidate.summary.slice(0, 200) || '待处理候选',
      });
      commandReceipt = committed.receipt;
      duplicate = committed.duplicate;
    }
    const saved = candidateRecords(userId, candidate.id);
    const handoff = handoffFromRecords(saved);
    if (!handoff) throw new OntologyError('commit_failed', 'candidate ontology records were not found after commit');
    const updatedCandidate = await recordRecallCandidateOntologyProgress(userId, candidate.id, handoff);
    return { candidate: updatedCandidate, handoff, duplicate };
  });
}

export async function completeCandidateOntologyHandoff(userId: string, candidateId: string) {
  if (!safeId(userId) || !safeId(candidateId)) throw new OntologyError('invalid_input', 'invalid ontology candidate reference');
  return withRecallCandidateReviewLock(userId, async () => {
    const candidate = await readRecallCandidate(userId, candidateId);
    if (candidate.status === 'integrated' && candidate.ontologyHandoff)
      return { candidate, handoff: candidate.ontologyHandoff, duplicate: true };
    const handoff = handoffFromRecords(candidateRecords(userId, candidateId));
    if (!handoff) throw new OntologyError('not_found', 'add at least one ontology record before completing this candidate');
    const completed = await markRecallCandidateIntegrated(userId, candidate.id, handoff);
    return { candidate: completed, handoff: completed.ontologyHandoff!, duplicate: false };
  });
}
