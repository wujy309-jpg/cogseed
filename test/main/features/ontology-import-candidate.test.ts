import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const model = vi.hoisted(() => vi.fn());
vi.mock('../../../src/main/model/client', () => ({ chatWithModel: model }));
vi.mock('../../../src/main/features/recall/store-events', () => ({ notifyCognitionWrite: vi.fn() }));
vi.mock('../../../src/main/logger', () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }));

const userId = 'ontology-import-e2e-user';
let root: string, previousRoot: string | undefined;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cogseed-ontology-import-e2e-'));
  previousRoot = process.env.COGSEED_WORKSPACE_ROOT;
  process.env.COGSEED_WORKSPACE_ROOT = root;
  vi.resetModules();
  model.mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
  if (previousRoot === undefined) delete process.env.COGSEED_WORKSPACE_ROOT;
  else process.env.COGSEED_WORKSPACE_ROOT = previousRoot;
  fs.rmSync(root, { recursive: true, force: true });
});

describe('本机资料经共同候选治理进入本体', () => {
  it('提取文件后保留原文进入候选，用户逐步整理后保留候选来源', async () => {
    const filePath = path.join(root, '项目说明.md');
    const sourceText = 'CogSeed 项目的负责人是林青。此内容来自本机文件，需由用户核对后整理。';
    fs.writeFileSync(filePath, sourceText, 'utf8');
    const importing = await import('../../../src/main/features/cognition/ontology/import-text');
    const extracted = await importing.extractOntologyImportFile(filePath);
    const first = await importing.submitOntologyImport(userId, extracted.name, extracted.text, 'fact');
    const retry = await importing.submitOntologyImport(userId, extracted.name, extracted.text, 'fact');
    expect(first.submitted).toBe(1);
    expect(retry.candidateIds).toEqual(first.candidateIds);
    expect(fs.existsSync(filePath)).toBe(true);

    const candidates = await import('../../../src/main/features/recall/candidate-service');
    const candidate = await candidates.readRecallCandidate(userId, first.candidateIds[0]);
    expect(candidate).toMatchObject({ value: sourceText, suggestedType: 'fact', summary: '项目说明.md', origin: 'manual' });

    const ontology = await import('../../../src/main/features/cognition/ontology/service');
    const handoff = await import('../../../src/main/features/cognition/ontology/candidate-handoff');
    const create = (recordId: string, record: Record<string, unknown>) => ({ intent: 'create', recordId, record, sourceLabel: '用户确认' });
    await ontology.commitOntologyCommand(userId, { commandId: 'import-e2e-seed', expectedRevision: 0, actions: [
      create('project-module', { kind: 'module', name: 'CogSeed 项目', description: '', scope: { kind: 'personal' } }),
      create('person-type', { kind: 'definition', moduleId: 'project-module', name: '人物', description: '', definitionKind: 'type',
        subjectTypes: [], objectTypes: [], valueType: 'entity', cardinality: 'many', cardinalityAnchor: 'subject' }),
    ] });
    const committed = await handoff.commitCandidateOntologyRecords(userId, { candidateId: candidate.id, moduleId: 'project-module', batchId: 'import-e2e-batch',
      command: { commandId: 'import-e2e-command', expectedRevision: 1, actions: [{ intent: 'create', recordId: 'imported-person', sourceLabel: '本机文件候选经用户核对',
        record: { kind: 'entity', moduleId: 'project-module', typeId: 'person-type', name: '林青', description: 'CogSeed 项目的负责人', aliases: [], identityStatus: 'confirmed' } }] } });
    expect(ontology.readOntologyDocument(userId).records['imported-person']).toMatchObject({ source: { kind: 'candidate', recordId: candidate.id } });
    expect(committed.candidate.ontologyHandoff?.status).toBe('in_progress');
    expect((await handoff.completeCandidateOntologyHandoff(userId, candidate.id)).candidate.status).toBe('integrated');
  });
  it('模型建议经过真实共同候选存储，原文不可替换，重试不重复且未授权不写本体', async () => {
    const sourceText = '验收项目由林青负责。';
    const draft = { summary: '项目负责人', judgment: sourceText, quote: sourceText, suggestedType: 'fact' };
    model.mockResolvedValue({ ok: true, text: JSON.stringify({ candidates: [draft] }) });
    const importing = await import('../../../src/main/features/cognition/ontology/import-extraction');
    const first = await importing.extractOntologyImportCandidates(userId, '虚构资料.md', sourceText);
    const again = await importing.extractOntologyImportCandidates(userId, '虚构资料.md', sourceText);
    expect(again.candidateIds).toEqual(first.candidateIds);
    const candidates = await import('../../../src/main/features/recall/candidate-service');
    const candidate = await candidates.readRecallCandidate(userId, first.candidateIds[0]);
    expect(candidate.status).toBe('pending_review');
    expect(candidate.origin).not.toBe('manual');
    expect(candidate.sourceRefs).toEqual([expect.objectContaining({ id: first.sourceId, kind: 'artifact_file', sourceVersion: expect.any(String) })]);
    expect(candidate.evidenceSummary).toBe(sourceText);
    const sources = await import('../../../src/main/features/cognition/ontology/import-source');
    expect((await sources.readOntologyImportSource(userId, first.sourceId)).text).toBe(sourceText);
    const ontology = await import('../../../src/main/features/cognition/ontology/service');
    expect(Object.keys(ontology.readOntologyDocument(userId).records)).toHaveLength(0);
  });
  it('后一片提取失败时保留完整原文和前片候选，重试复用已提交建议', async () => {
    const sourceText = '验收项目由林青负责。' + '。'.repeat(3800);
    const draft = { summary: '负责人', judgment: '验收项目由林青负责。', quote: '验收项目由林青负责。', suggestedType: 'fact' };
    model.mockResolvedValueOnce({ ok: true, text: JSON.stringify({ candidates: [draft] }) }).mockResolvedValueOnce({ ok: false });
    const importing = await import('../../../src/main/features/cognition/ontology/import-extraction');
    let failure: any;
    try { await importing.extractOntologyImportCandidates(userId, '多片虚构资料.md', sourceText); } catch (error) { failure = error; }
    expect(failure).toMatchObject({ code: 'import_partial', details: { submitted: 1, completedParts: 1, totalParts: 2 } });
    const sources = await import('../../../src/main/features/cognition/ontology/import-source');
    expect((await sources.readOntologyImportSource(userId, failure.details.sourceId)).text).toBe(sourceText);
    model.mockResolvedValueOnce({ ok: true, text: JSON.stringify({ candidates: [draft] }) }).mockResolvedValueOnce({ ok: true, text: '{"candidates":[]}' });
    const retry = await importing.extractOntologyImportCandidates(userId, '多片虚构资料.md', sourceText);
    expect(retry.candidateIds).toEqual(failure.details.candidateIds);
  });

});
