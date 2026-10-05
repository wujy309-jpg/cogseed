import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

vi.mock('../../../src/main/features/recall/store-events', () => ({ notifyCognitionWrite: vi.fn() }));
vi.mock('../../../src/main/logger', () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }));

const userId = 'ontology-handoff-user';
let root: string, previousRoot: string | undefined;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'cogseed-ontology-handoff-')); previousRoot = process.env.COGSEED_WORKSPACE_ROOT; process.env.COGSEED_WORKSPACE_ROOT = root; vi.resetModules(); });
afterEach(() => { vi.restoreAllMocks(); if (previousRoot === undefined) delete process.env.COGSEED_WORKSPACE_ROOT; else process.env.COGSEED_WORKSPACE_ROOT = previousRoot; fs.rmSync(root, { recursive: true, force: true }); });

function candidate(id = 'candidate-report-fact', scopePolicy?: Record<string, unknown>) {
  const now = new Date().toISOString();
  return { schemaVersion: 1, ownerId: userId, id, contentFormatVersion: 1, taxonomyVersion: 2,
    status: 'pending_review', judgment: 'CogSeed 项目的负责人是林青', value: 'CogSeed 项目的负责人是林青', summary: '项目负责人',
    suggestedType: 'fact', suggestedScope: 'general', sourceRefs: [], evidenceRefs: [], suggestedAction: 'create', risk: 'low', origin: 'manual',
    ...(scopePolicy ? { scopePolicy } : {}), expiresAt: new Date(Date.now() + 60_000).toISOString(), createdAt: now, updatedAt: now };
}

async function seedOntology() {
  const { commitOntologyCommand } = await import('../../../src/main/features/cognition/ontology/service');
  const create = (recordId: string, record: Record<string, unknown>) => ({ intent: 'create', recordId, record, sourceLabel: '用户确认' });
  await commitOntologyCommand(userId, { commandId: 'handoff-seed', expectedRevision: 0, actions: [
    create('project-module', { kind: 'module', name: 'CogSeed 项目', description: '', scope: { kind: 'project', id: 'project-a' } }),
    create('project-type', { kind: 'definition', moduleId: 'project-module', name: '项目', description: '', definitionKind: 'type', subjectTypes: [], objectTypes: [], valueType: 'entity', cardinality: 'many', cardinalityAnchor: 'subject' }),
    create('person-type', { kind: 'definition', moduleId: 'project-module', name: '人物', description: '', definitionKind: 'type', subjectTypes: [], objectTypes: [], valueType: 'entity', cardinality: 'many', cardinalityAnchor: 'subject' }),
    create('owner-definition', { kind: 'definition', moduleId: 'project-module', name: '负责人', description: '', definitionKind: 'relation', subjectTypes: ['project-type'], objectTypes: ['person-type'], valueType: 'entity', cardinality: 'one', cardinalityAnchor: 'subject' }),
    create('project-object', { kind: 'entity', moduleId: 'project-module', typeId: 'project-type', name: 'CogSeed', description: '', aliases: [], identityStatus: 'confirmed' }),
    create('person-object', { kind: 'entity', moduleId: 'project-module', typeId: 'person-type', name: '林青', description: '', aliases: [], identityStatus: 'confirmed' }),
  ] });
}

describe('Recall 候选经确认后整理到本体', () => {
  it('逐批提交带候选来源的本体记录，完成后关闭待办并支持幂等恢复', async () => {
    const store = await import('../../../src/main/features/recall/store');
    const handoff = await import('../../../src/main/features/cognition/ontology/candidate-handoff');
    const ontology = await import('../../../src/main/features/cognition/ontology/service');
    await seedOntology();
    await store.writeRecallJsonRecord(userId, 'candidates', 'candidate-report-fact', candidate());

    const first = await handoff.commitCandidateOntologyRecords(userId, { candidateId: 'candidate-report-fact', moduleId: 'project-module', batchId: 'batch-owner-1', command: {
      commandId: 'renderer-command-1', expectedRevision: 1, actions: [{ intent: 'create', recordId: 'owner-from-candidate', sourceLabel: '页面表单',
        record: { kind: 'assertion', moduleId: 'project-module', subjectId: 'project-object', definitionId: 'owner-definition', object: { kind: 'entity', id: 'person-object' },
          validity: { from: '2026-10-01', until: null, precision: 'day', timezone: 'Asia/Shanghai' } } }],
    } });
    expect(first.candidate.status).toBe('pending_review');
    expect(first.candidate.ontologyHandoff?.status).toBe('in_progress');
    expect(first.handoff.recordIds).toContain('owner-from-candidate');
    expect(ontology.readOntologyDocument(userId).records['owner-from-candidate']).toMatchObject({ source: { kind: 'candidate', recordId: 'candidate-report-fact' } });

    const second = await handoff.commitCandidateOntologyRecords(userId, { candidateId: 'candidate-report-fact', moduleId: 'project-module', batchId: 'batch-recipient-2', command: {
      commandId: 'renderer-command-2', expectedRevision: 2, actions: [{ intent: 'create', recordId: 'recipient-rule-from-candidate', sourceLabel: '页面表单',
        record: { kind: 'rule', moduleId: 'project-module', name: '周报通知负责人', requirement: '周报完成后通知负责人', strength: 'required',
          condition: { kind: 'task', field: 'purpose', equals: 'weekly_report' }, effect: { kind: 'include_recipient', entityId: 'person-object' }, exception: '' } }],
    } });
    expect(second.candidate.ontologyHandoff?.recordIds).toEqual(expect.arrayContaining(['owner-from-candidate', 'recipient-rule-from-candidate']));
    const completed = await handoff.completeCandidateOntologyHandoff(userId, 'candidate-report-fact');
    expect(completed.candidate.status).toBe('integrated');
    expect(completed.candidate.ontologyHandoff?.status).toBe('integrated');
    expect(completed.candidate.reviewDecisionId).toMatch(/^rd_/);
    expect((await handoff.completeCandidateOntologyHandoff(userId, 'candidate-report-fact')).duplicate).toBe(true);
  });

  it('不允许把受限项目候选整理进另一个项目的本体', async () => {
    const store = await import('../../../src/main/features/recall/store');
    const handoff = await import('../../../src/main/features/cognition/ontology/candidate-handoff');
    const ontology = await import('../../../src/main/features/cognition/ontology/service');
    await seedOntology();
    await store.writeRecallJsonRecord(userId, 'candidates', 'candidate-scoped-fact', candidate('candidate-scoped-fact', { projectIds: ['project-b'] }));
    const before = ontology.readOntologyDocument(userId).revision;
    await expect(handoff.commitCandidateOntologyRecords(userId, { candidateId: 'candidate-scoped-fact', moduleId: 'project-module', batchId: 'scope-batch', command: {
      commandId: 'renderer-scope-command', expectedRevision: before, actions: [{ intent: 'create', recordId: 'restricted-fact', sourceLabel: '页面表单',
        record: { kind: 'assertion', moduleId: 'project-module', subjectId: 'project-object', definitionId: 'owner-definition', object: { kind: 'entity', id: 'person-object' },
          validity: { from: '2026-10-01', until: null, precision: 'day', timezone: 'Asia/Shanghai' } } }],
    } })).rejects.toMatchObject({ code: 'not_authorized' });
    expect(ontology.readOntologyDocument(userId).revision).toBe(before);
  });

  it('高风险候选必须由界面显式确认后才能写入', async () => {
    const store = await import('../../../src/main/features/recall/store');
    const handoff = await import('../../../src/main/features/cognition/ontology/candidate-handoff');
    const ontology = await import('../../../src/main/features/cognition/ontology/service');
    await seedOntology();
    const risky = candidate('candidate-high-risk');
    risky.risk = 'high';
    await store.writeRecallJsonRecord(userId, 'candidates', risky.id, risky);
    const before = ontology.readOntologyDocument(userId).revision;
    const command = { commandId: 'renderer-high-risk-command', expectedRevision: before, actions: [{ intent: 'create', recordId: 'high-risk-fact', sourceLabel: '页面表单',
      record: { kind: 'assertion', moduleId: 'project-module', subjectId: 'project-object', definitionId: 'owner-definition', object: { kind: 'entity', id: 'person-object' },
        validity: { from: '2026-10-01', until: null, precision: 'day', timezone: 'Asia/Shanghai' } } }] };
    await expect(handoff.commitCandidateOntologyRecords(userId, { candidateId: risky.id, moduleId: 'project-module', batchId: 'high-risk-batch', command }))
      .rejects.toMatchObject({ code: 'risk_ack_required' });
    expect(ontology.readOntologyDocument(userId).revision).toBe(before);
    const saved = await handoff.commitCandidateOntologyRecords(userId, { candidateId: risky.id, moduleId: 'project-module', batchId: 'high-risk-batch', riskAcknowledged: true, command });
    expect(saved.handoff.recordIds).toContain('high-risk-fact');
  });
});
