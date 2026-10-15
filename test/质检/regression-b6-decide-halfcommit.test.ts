import { createNightlyCandidateFixture } from '../helpers/nightly-formation-fixture';
/**
 * 回归（批次 b6 · P-r2-6）：decideWithoutAsset 跨文件半提交的补偿回填。
 *
 * 现场链路（candidate-service.ts decideWithoutAsset）：
 *  - updater 锁内先 writeReviewDecision（认知账本，独立文件）再把候选主档
 *    置 rejected/deferred/ignored——两段跨文件写，主档段失败时账本已有决定
 *    而候选仍 pending（「已处理历史」与待办矛盾，待议清单 P-r2-6）；
 *  - 修复（拍板「写侧补偿回填 failure_code」）：主档写失败且账本已落时，
 *    补偿把候选标 failed(decision_write_failed)（可重试：重新决定走新幂等键），
 *    补偿失败只 warn，原错误优先上抛；账本未落（updater 早退/复核拒绝）不补偿。
 *
 * 手法：mock recall/store 的 updateRecallJsonRecord——对 candidates 集合的
 * 第一次更新（即决定写本身）执行真实 updater（让锁内的账本写真实落盘）后抛
 * 模拟写失败；后续调用放行真实实现。补偿写因此真实落盘，可断言终态。
 * 对照组证明非半提交路径（证据不足拒绝）不被误补偿。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

let tmpDir: string;
let previousRoot: string | undefined;

const halfCommit = vi.hoisted(() => ({ failNextCandidateUpdate: false }));

vi.mock('../../src/main/features/recall/store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/main/features/recall/store')>();
  return {
    ...actual,
    updateRecallJsonRecord: async (
      userId: string,
      collection: string,
      recordId: string,
      updater: (current: unknown) => unknown,
    ) => {
      if (collection === 'candidates' && halfCommit.failNextCandidateUpdate) {
        halfCommit.failNextCandidateUpdate = false;
        // 跑真实 updater：锁内的 writeReviewDecision 真实落账（半提交前半），
        // 然后模拟主档落盘失败（半提交后半）。
        const current = await actual.readRecallJsonRecord(userId, collection, recordId);
        await updater(current);
        throw new Error('simulated candidate record write failure (regression-b6)');
      }
      return actual.updateRecallJsonRecord(userId, collection, recordId, updater as never);
    },
  };
});

beforeEach(() => {
  vi.resetModules();
  halfCommit.failNextCandidateUpdate = false;
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cogseed-reg-b6-halfcommit-'));
  previousRoot = process.env.COGSEED_WORKSPACE_ROOT;
  process.env.COGSEED_WORKSPACE_ROOT = tmpDir;
});

afterEach(() => {
  if (previousRoot === undefined) delete process.env.COGSEED_WORKSPACE_ROOT;
  else process.env.COGSEED_WORKSPACE_ROOT = previousRoot;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function modules() {
  return import('../../src/main/features/recall/candidate-service');
}

async function pendingCandidate() {
  const candidates = await modules();
  return createNightlyCandidateFixture('user-a', {
    judgment: 'Keep a rollback plan before releasing any boundary change.',
    summary: 'Rollback plan before releases',
    suggestedType: 'rule',
    applicableWhen: ['Release review'],
    forbiddenWhen: ['Informal discussion'],
    suggestedScope: 'review,project',
    suggestedAction: 'create',
    sourceRefs: [{ kind: 'conversation', id: 'conv-b6-halfcommit' }],
  });
}

describe('regression b6 › decideWithoutAsset 半提交补偿（P-r2-6）', () => {
  it('主档写失败且账本已落 → 补偿回填 failed(decision_write_failed)，原错误上抛', async () => {
    const candidates = await modules();
    const candidate = await pendingCandidate();
    expect(candidate.status).toBe('pending_review');

    halfCommit.failNextCandidateUpdate = true;
    await expect(candidates.rejectRecallCandidate('user-a', candidate.id, '用户拒绝'))
      .rejects.toThrow(/simulated candidate record write failure/);

    // 补偿生效：候选不再 pending 矛盾挂着，而是 failed + 明确失败码（可重试口径）。
    const after = await candidates.readRecallCandidate('user-a', candidate.id);
    expect(after.status).toBe('failed');
    expect(after.failureCode).toBe('decision_write_failed');
    expect(String(after.failureMessage || '')).toContain('simulated candidate record write failure');

    // 前半确实落账：认知账本里有这条 reject 决定（半提交的证据链）。
    const { listReviewDecisions } = await import('../../src/main/features/cognition/review-decision');
    const decisions = await listReviewDecisions('user-a', `recall_candidate:${candidate.id}`);
    expect(decisions.some((decision) => decision.decision_type === 'reject')).toBe(true);

    // 重试自愈：重新决定（新一轮写）正常落终态。
    const retried = await candidates.rejectRecallCandidate('user-a', candidate.id, '重试拒绝');
    expect(retried.status).toBe('rejected');
  });

  it('对照组：账本未落的幂等早退（终态候选再决定）不触发补偿，终态不被覆写', async () => {
    const candidates = await modules();
    const candidate = await pendingCandidate();
    const rejected = await candidates.rejectRecallCandidate('user-a', candidate.id, '先正常拒绝');
    expect(rejected.status).toBe('rejected');

    // 终态候选再决定：updater 锁内幂等返回原记录，账本不写。此时主档写失败
    // （模拟）也不该补偿——补偿只在「账本已落」的半提交里成立，且终态绝不能
    // 被覆写成 failed。
    halfCommit.failNextCandidateUpdate = true;
    await expect(candidates.rejectRecallCandidate('user-a', candidate.id, '重复决定'))
      .rejects.toThrow(/simulated candidate record write failure/);
    const after = await candidates.readRecallCandidate('user-a', candidate.id);
    expect(after.status).toBe('rejected');
    expect(after.failureCode).toBeUndefined();
  });
});
