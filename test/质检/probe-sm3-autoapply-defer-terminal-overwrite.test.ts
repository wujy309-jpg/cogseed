/**
 * 探针（状态机审计员 · 新循环第 3 轮）：autoApplyRecallCandidate 的语义复核
 * defer 分支锁内不复核候选终态——用户已处置（rejected/ignored/confirmed）的
 * 候选被系统后台覆写成 deferred，终态复活回待办。
 *
 * 读码链（candidate-service.ts）：
 *  - autoApplyRecallCandidate :1834 readRecallCandidate（锁外读）→ :1848
 *    isAutoCaptureEligible 检查（锁外快照）→ :1859 await reviewCandidateSemantically
 *    （模型级调用，秒级窗口）→ :1866 writeReviewDecision(defer, system) →
 *    :1875 updateRecallJsonRecord 的 updater **只有 `if (!current) return undefined`，
 *    无 isTerminalCandidate 复核**，直接 `{...current, status:'deferred', ...}` 落盘；
 *  - 对照同文件三个状态写入口全部锁内复核终态：updateRecallCandidate :1657
 *    （terminal throw）、resumeRecallCandidate :1749（terminal throw）、
 *    decideWithoutAsset :1788（terminal 幂等返回原记录）、promoteRecallCandidate
 *    :2475/:2476（confirmed 幂等 / terminal throw）——唯独语义复核 defer 分支漏。
 *
 * 危害：rejected/ignored（用户明确拒绝/忽略）被覆写成 deferred（非终态）回到
 * 待办；confirmed（已建资产）被覆写后可 resume→再确认，造成状态与资产脱钩。
 *
 * 手法：mock reviewCandidateSemantically 返回手动控制的 pending promise——挂起
 * 期间用 rejectRecallCandidate（用户侧合法处置）把候选置终态，再 resolve MEDIUM
 * finding，断言 autoApply 落盘后的终态。对照组证明入口检查本身有效。
 *
 * 收尾状态（2026-10-01 记账员）：对应待议 **P-r1-97（锁内幂等复核 vs 整体复用 decideWithoutAsset 两案待拍板）**——
 * 断言漏洞现状的用例 it.skip 注明编号，拍板修复后反转/改写断言启用；
 * 对照组（无竞态/无坏档时守卫与正常路径有效）不依赖漏洞，保留 active。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

vi.mock('../../src/main/features/kb_embed', () => ({
  embedQuery: async (text: string) => {
    const digest = createHash('sha256').update(text).digest();
    return Array.from({ length: 512 }, (_, i) => (digest[i % 32] / 255 - 0.5) * 0.2);
  },
}));

type Resolve<T> = (value: T) => void;
const semanticReviewMock = vi.hoisted(() => ({
  reviewCandidateSemantically: vi.fn(),
}));
vi.mock('../../src/main/features/cognition/semantic-review', () => ({
  reviewCandidateSemantically: semanticReviewMock.reviewCandidateSemantically,
}));

let tmpDir: string;
let previousRoot: string | undefined;

beforeEach(() => {
  vi.resetModules();
  semanticReviewMock.reviewCandidateSemantically.mockReset();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cogseed-probe-sm3a-'));
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
  const candidates = await import('../../src/main/features/recall/candidate-service');
  return candidates.saveRecallCandidate('user-a', {
    judgment: 'Keep architecture decisions in a decision log before changing runtime boundaries.',
    summary: 'Use decision logs for architecture changes',
    suggestedType: 'rule',
    applicableWhen: ['Architecture review and runtime-boundary changes'],
    forbiddenWhen: ['Informal brainstorming without a decision'],
    suggestedScope: 'review,project',
    suggestedAction: 'create',
    sourceRefs: [{ kind: 'conversation', id: 'conv-sm3-terminal' }],
  });
}

describe('probe sm3 › autoApply 语义复核 defer 分支锁内终态覆写', () => {
  it('对照组：用户先拒绝（无竞态），autoApply 入口检查拒绝处理终态候选', async () => {
    const candidates = await modules();
    const candidate = await pendingCandidate();
    const rejected = await candidates.rejectRecallCandidate('user-a', candidate.id, '用户不要');
    expect(rejected.status).toBe('rejected');
    semanticReviewMock.reviewCandidateSemantically.mockResolvedValue({ ok: true, findings: [] });
    await expect(candidates.autoApplyRecallCandidate('user-a', candidate.id))
      .rejects.toThrow(/not ready for automatic capture/i);
    const after = await candidates.readRecallCandidate('user-a', candidate.id);
    expect(after.status).toBe('rejected');
  });

  it('【已修 P-r1-97】主用例：语义复核挂起期间候选被用户拒绝，defer 分支锁内复核终态、不再覆写 rejected', async () => {
    const candidates = await modules();
    const candidate = await pendingCandidate();

    // 手动控制语义复核：挂起 → 期间用户拒绝 → 再 resolve MEDIUM finding。
    let releaseReview: Resolve<{ ok: true; findings: Array<{ rule: string; level: string; field: string; snippet: string; suggested_fix: string }> }>;
    const gate = new Promise<void>((resolve) => {
      semanticReviewMock.reviewCandidateSemantically.mockImplementationOnce(async () => {
        resolve(); // 已进入模型调用窗口
        await new Promise((r) => { releaseReview = r as Resolve<unknown>; });
        return {
          ok: true,
          findings: [{ rule: 'semantic_sensitive_personal_data', level: 'MEDIUM', field: 'semantic', snippet: 'phone number', suggested_fix: 'Remove the personal identifier' }],
        };
      });
    });

    const applying = candidates.autoApplyRecallCandidate('user-a', candidate.id);
    await gate; // autoApply 已过 :1848 入口检查、正在 :1859 模型调用中

    // 窗口内用户合法处置：拒绝（pending_review → rejected 终态落盘）。
    const rejected = await candidates.rejectRecallCandidate('user-a', candidate.id, '用户不要');
    expect(rejected.status).toBe('rejected');

    releaseReview!({ ok: true } as never);
    await applying;

    // 终态断言（修复后）：defer 分支锁内幂等复核终态——rejected 保持终态，
    // 不被覆写成 deferred，也不落 semantic_review_flagged 的失败码。
    const after = await candidates.readRecallCandidate('user-a', candidate.id);
    expect(after.status).toBe('rejected');
    expect(after.failureCode).toBeUndefined();
  });
});
