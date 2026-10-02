/**
 * 回归（批次 b6 · P-r1-78 + P-r2-17）：promoteRecallCandidate 的并发收口。
 *
 * P-r1-78 冲突扫描池级原子化：冲突扫描（同文本不同类型互斥）此前在任何锁外，
 * 两条同文本不同类型的 failed 候选（failed 在扫描排除表里，互相看不见对方）
 * 并发重试可双双穿过冲突门再各自 confirmed。修复=扫描（锁内新鲜读）与晋升
 * 提交纳入 candidate-locks/promote 池级互斥锁（照 save 的池锁先例）。
 *
 * P-r2-17 标题 LLM 外移锁外：晋升 updater 此前全程持候选记录锁，summary
 * 不合规时在锁内调 suggestAbilityAssetTitle（LLM，秒级）。修复=标题在所有
 * 锁之外预计算，锁内仅当正文与预计算依据一致时沿用。
 *
 * 手法：
 *  - P-r1-78：预持两条候选的记录锁 → 同时启动两次 promote（双方都完成锁外
 *    预读、卡在提交前）→ 放锁。旧代码双方扫描都发生在对方提交前 → 双双
 *    confirmed；新代码池锁串行化，后进者锁内新鲜读看到先到者已 confirmed
 *    → 冲突拒绝。断言恰好一成一败，败者带冲突理由且不被覆写。
 *  - P-r2-17：起标题 mock 被调用时探测候选记录锁是否空闲（50ms 竞速）。
 *    旧代码 LLM 在记录锁内调用 → 探测超时；新代码锁外 → 探测成功。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const titleProbe = vi.hoisted(() => ({
  calls: 0,
  recordLockFreeDuringCall: [] as boolean[],
}));

vi.mock('../../src/main/features/recall/asset-title-suggestion', () => ({
  suggestAbilityAssetTitle: async () => {
    titleProbe.calls += 1;
    // 探测此刻候选记录锁是否空闲：runExclusive 排队即视为被占。
    const { fileEditLock } = await import('../../src/main/util/locks');
    const free = await Promise.race([
      fileEditLock(globalThis.__b6TitleLockPath as string).runExclusive(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 50)),
    ]);
    titleProbe.recordLockFreeDuringCall.push(free);
    return { title: '模型重起的并发样本标题' };
  },
}));

vi.mock('../../src/main/features/kb_embed', () => ({
  closeEmbedder: vi.fn(),
  embedQuery: async (text: string) => {
    const digest = createHash('sha256').update(text).digest();
    return Array.from({ length: 512 }, (_, i) => (digest[i % 32] / 255 - 0.5) * 0.2);
  },
}));

declare global {
  // eslint-disable-next-line no-var
  var __b6TitleLockPath: string | undefined;
}

let tmpDir: string;
let previousRoot: string | undefined;

beforeEach(() => {
  vi.resetModules();
  titleProbe.calls = 0;
  titleProbe.recordLockFreeDuringCall.length = 0;
  globalThis.__b6TitleLockPath = undefined;
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cogseed-reg-b6-promote-'));
  previousRoot = process.env.COGSEED_WORKSPACE_ROOT;
  process.env.COGSEED_WORKSPACE_ROOT = tmpDir;
});

afterEach(() => {
  if (previousRoot === undefined) delete process.env.COGSEED_WORKSPACE_ROOT;
  else process.env.COGSEED_WORKSPACE_ROOT = previousRoot;
  globalThis.__b6TitleLockPath = undefined;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const SAME_TEXT = 'Archive the migration ledger before swapping the storage engine.';

async function modules() {
  const candidates = await import('../../src/main/features/recall/candidate-service');
  const store = await import('../../src/main/features/recall/store');
  const paths = await import('../../src/main/features/recall/paths');
  const locks = await import('../../src/main/util/locks');
  return { candidates, store, paths, locks };
}

async function seedCandidate(type: 'rule' | 'fact') {
  const { candidates } = await modules();
  return candidates.saveRecallCandidate('user-a', {
    judgment: SAME_TEXT,
    summary: `Migration ledger habit (${type})`,
    suggestedType: type,
    applicableWhen: ['Storage migration review'],
    forbiddenWhen: ['Informal chat'],
    suggestedScope: 'project',
    suggestedAction: 'create',
    sourceRefs: [{ kind: 'execution', id: `exec-b6-${type}` }],
  });
}

describe('regression b6 › promote 并发收口（P-r1-78 / P-r2-17）', () => {
  it('P-r1-78：同文本不同类型的 failed 候选并发重试，池级锁保证恰好一条穿过冲突门', async () => {
    const { candidates, store, paths, locks } = await modules();
    const ruleCandidate = await seedCandidate('rule');
    const factCandidate = await seedCandidate('fact');
    // 双双置 failed（冲突扫描排除表里的状态）：并发重试的入口形态。
    for (const id of [ruleCandidate.id, factCandidate.id]) {
      await store.updateRecallJsonRecord('user-a', 'candidates', id, (current) => ({
        ...(current as Record<string, unknown>),
        status: 'failed',
      }));
    }

    // 预持两条记录锁，让两次 promote 都停在提交前（扫描/预读已完成），
    // 再放行——把「双方都在对方提交前扫描」的交错钉死成确定性时序。
    const rulePath = paths.recallJsonRecordPath('user-a', 'candidates', ruleCandidate.id);
    const factPath = paths.recallJsonRecordPath('user-a', 'candidates', factCandidate.id);
    let releaseRule!: () => void;
    let releaseFact!: () => void;
    const ruleGate = new Promise<void>((resolve) => { releaseRule = resolve; });
    const factGate = new Promise<void>((resolve) => { releaseFact = resolve; });
    const held = [
      locks.fileEditLock(rulePath).runExclusive(() => ruleGate),
      locks.fileEditLock(factPath).runExclusive(() => factGate),
    ];
    await new Promise((r) => setTimeout(r, 5));

    const promoteRule = candidates.promoteRecallCandidate('user-a', ruleCandidate.id, { actor: 'user' });
    const promoteFact = candidates.promoteRecallCandidate('user-a', factCandidate.id, { actor: 'user' });
    // 双方都已越过锁外预读、卡在池锁/记录锁队列上。
    await new Promise((r) => setTimeout(r, 20));
    releaseRule();
    releaseFact();
    await Promise.all(held);

    const settled = await Promise.allSettled([promoteRule, promoteFact]);
    const fulfilled = settled.filter((entry) => entry.status === 'fulfilled');
    const rejected = settled.filter((entry) => entry.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(String((rejected[0] as PromiseRejectedResult).reason)).toMatch(/same wording already exists under another asset type/i);

    // 败者不被覆写成 confirmed，仍停在 failed（可重试），也不产生资产。
    const loserId = rejected[0] === settled[0] ? ruleCandidate.id : factCandidate.id;
    const loser = await candidates.readRecallCandidate('user-a', loserId);
    expect(loser.status).toBe('failed');

    const winner = fulfilled[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof candidates.promoteRecallCandidate>>>;
    expect(winner.value.candidate.status).toBe('confirmed');
    expect(winner.value.asset.type).toBe(winner.value.candidate.suggestedType);
  });

  it('P-r2-17：起标题（LLM）在候选记录锁之外调用', async () => {
    const { candidates, paths } = await modules();
    // 无 summary → 兜底正文首句对正文不合规 → 必走起标题链。
    const saved = await candidates.saveRecallCandidate('user-a', {
      judgment: 'Capture the incident timeline before restarting a failed service.',
      suggestedType: 'rule',
      applicableWhen: ['Incident review'],
      forbiddenWhen: ['Routine restart'],
      suggestedScope: 'project',
      suggestedAction: 'create',
      sourceRefs: [{ kind: 'execution', id: 'exec-b6-title' }],
    });
    globalThis.__b6TitleLockPath = paths.recallJsonRecordPath('user-a', 'candidates', saved.id);

    const promoted = await candidates.promoteRecallCandidate('user-a', saved.id, { actor: 'user' });
    expect(promoted.asset.title).toBe('模型重起的并发样本标题');
    expect(titleProbe.calls).toBe(1);
    // 起标题发生在候选记录锁之外：探测在 50ms 内拿到锁。
    expect(titleProbe.recordLockFreeDuringCall[0]).toBe(true);
  });
});
