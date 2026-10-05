import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

vi.mock('../../../src/main/features/recall/store-events', () => ({ notifyCognitionWrite: vi.fn() }));
vi.mock('../../../src/main/logger', () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }));

const userId = 'po-candidate-transfer-user';
let root: string, previousRoot: string | undefined;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cogseed-po-candidate-transfer-'));
  previousRoot = process.env.COGSEED_WORKSPACE_ROOT;
  process.env.COGSEED_WORKSPACE_ROOT = root;
  vi.resetModules();
});
afterEach(() => {
  vi.restoreAllMocks();
  if (previousRoot === undefined) delete process.env.COGSEED_WORKSPACE_ROOT;
  else process.env.COGSEED_WORKSPACE_ROOT = previousRoot;
  fs.rmSync(root, { recursive: true, force: true });
});

describe('旧个人本体候选转入 Recall 共同审核', () => {
  it('用户请求后才转移，重复请求幂等，之后仍要在共同审核里确认', async () => {
    const po = await import('../../../src/main/features/personal_ontology_candidates');
    const recall = await import('../../../src/main/features/recall/candidate-service');
    const candidate = { candidate_id: 'legacy-po-relation', kind: 'relation' as const, confidence: 'high' as const,
      summary: '项目负责人', memory_scope: 'shared' as const, memory_text: 'CogSeed 项目的负责人是林青。',
      source_memory_refs: ['source-note-1'], project_id: 'project-a', write_actor: 'skill' as const };
    await po.addCandidate(userId, candidate);

    const first = await po.transferCandidateToRecall(userId, candidate.candidate_id);
    expect(first.sourceRemoved).toBe(true);
    expect(first.candidate).toMatchObject({ status: 'pending_review', suggestedType: 'fact', judgment: candidate.memory_text,
      scopePolicy: { projectIds: ['project-a'] }, captureKey: expect.stringMatching(/^po-candidate-/) });
    expect((await po.listCandidates(userId)).candidate_updates).toEqual([]);
    expect((await recall.readRecallCandidate(userId, first.candidate.id)).status).toBe('pending_review');

    const retry = await po.transferCandidateToRecall(userId, candidate.candidate_id);
    expect(retry.candidate.id).toBe(first.candidate.id);
    expect(retry.sourceRemoved).toBe(false);
    expect((await recall.listRecallCandidates(userId)).filter(row => row.captureKey === first.candidate.captureKey)).toHaveLength(1);
  });

  it('受限旧候选不会转成可能进入任务的 Recall 候选，也不从旧池移除', async () => {
    const po = await import('../../../src/main/features/personal_ontology_candidates');
    const recall = await import('../../../src/main/features/recall/candidate-service');
    const candidate = { candidate_id: 'legacy-po-private', kind: 'preference' as const, confidence: 'medium' as const,
      summary: '私人健康资料', memory_scope: 'user' as const, memory_text: '私人健康资料正文。',
      source_memory_refs: [], sensitivity: 'restricted' as const, write_actor: 'user' as const };
    await po.addCandidate(userId, candidate);

    await expect(po.transferCandidateToRecall(userId, candidate.candidate_id)).rejects.toMatchObject({ code: 'legacy_candidate_restricted' });
    expect((await po.listCandidates(userId)).candidate_updates.map(row => row.candidate_id)).toEqual([candidate.candidate_id]);
    expect(await recall.listRecallCandidates(userId)).toEqual([]);
  });
});
