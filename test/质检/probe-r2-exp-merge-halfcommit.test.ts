/**
 * 探针（本轮红队-越权与状态 · 并发与时序）：mergeExperiences 两段写非原子——
 * target 段落盘后 source 段在锁内终态复核处抛错，留下「半合并」持久不一致
 * （F-r1-25 修复引入的可观测后果：修复前 source 段无复核不抛错）。
 *
 * 读码链路（experience-service.ts）：
 *  - merge 执行序：① target updater（:578-604，锁=target 记录文件锁）落盘
 *    mergedFrom+台账 → ② source updater（:606-628，锁=source 记录文件锁）——
 *    两段是**两个不同文件锁上的独立写**，中间无任何事务；
 *  - F-r1-25 给 ② 补了锁内 assertMutableExperience（:610）：窗口期内 source
 *    被归档（另一用户路径 archiveExperience）时 ② 抛错——但 ① 已经落盘。
 *  - 终态：target.mergedFrom 含 source 条目 + merged_from 台账在，而 source 仍
 *    archived、无 mergedIntoExperienceId——家谱单向断裂；且 source 已终态，
 *    重试 merge 被 terminal 拒绝，**无产品通道自愈**（对照：source 未终态时重试
 *    可靠 target 段 seen-Set 幂等 + source 段补写自愈）。
 *
 * 危害口径：违反「每个动作台账一条、可追溯」的完整语义（target 侧记了一次从未
 * 完成的合并）；与资产域 merge 三段非原子（前遍 P-r1-18 族）同族，但经验域的
 * ② 抛错路径是 F-r1-25 修复后**新可观测**——修复让 source 不再被强改终态（正确），
 * 代价是半合并态浮出水面。
 *
 * 手法：持 source 记录锁把 ② 卡在队列上（① 无竞争正常先行落盘），持锁期间
 * 直改盘置 archived（照 regression-r1-exp-merge-terminal-leak 被认可的先例，
 * 模拟窗口期内并发归档已落盘），放锁后 ② 复核即抛。
 *
 * 收尾状态（2026-10-01 记账员）：对应待议 **P-r2-38（拍板：interrupted 标志+幂等重试；并档占位 P-r2-46 同题）**——
 * 主用例已随修复启用（断言改写：半完成痕迹如实带 interrupted、entry 不重复）；
 * 对照组（无竞态/串行序时链路正常）不依赖漏洞，保留 active。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

let tmpDir: string;
let previousRoot: string | undefined;
const UID = 'user-exp-merge-half-r2';

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cogseed-exp-merge-half-r2-'));
  previousRoot = process.env.COGSEED_WORKSPACE_ROOT;
  process.env.COGSEED_WORKSPACE_ROOT = tmpDir;
  vi.resetModules();
});

afterEach(() => {
  if (previousRoot === undefined) delete process.env.COGSEED_WORKSPACE_ROOT;
  else process.env.COGSEED_WORKSPACE_ROOT = previousRoot;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function mkExperience(id: string, title: string) {
  const now = new Date().toISOString();
  return {
    id,
    source: {
      episodeId: `kse-${id}`,
      taskGoal: `任务-${id}`,
      taskType: 'code' as const,
      taskStatus: 'confirmed',
    },
    experienceType: 'lesson' as const,
    title,
    body: `${title}：先备份再执行变更。`,
    scope: 'code',
    verification: {
      state: 'confirmed' as const,
      outcome: 'met_expected' as const,
      deltaR: 0.1,
      confidence: 0.7,
    },
    evidenceRefs: [{ kind: 'conversation' as const, id: `conv-${id}` }],
    learningProvenance: {
      projectionId: `prj-${id}`,
      episodeId: `kse-${id}`,
      ruleRefs: [],
      attribution: 'execution_gap' as const,
    },
    status: 'active' as const,
    createdAt: now,
    updatedAt: now,
  };
}

async function setup() {
  const users = await import('../../src/main/features/users');
  users.activateUser(UID);
  const svc = await import('../../src/main/features/recall/experience-service');
  const { recallJsonRecordPath } = await import('../../src/main/features/recall/paths');
  const { fileEditLock } = await import('../../src/main/util/locks');
  return { svc, recallJsonRecordPath, fileEditLock };
}

function readRawDisk(recallJsonRecordPath: (uid: string, c: string, id: string) => string, id: string) {
  return JSON.parse(fs.readFileSync(recallJsonRecordPath(UID, 'experiences', id), 'utf8')) as Record<string, unknown>;
}

describe('探针 r2 › 经验 merge 两段非原子：source 段窗口失败留半合并', () => {
  it('对照组：无并发时两段都成功（target 吸收 + source 置 merged 各就各位）', async () => {
    const { svc, recallJsonRecordPath } = await setup();
    await svc.createExperience(UID, mkExperience('exp-src-hc', '对照组源'));
    await svc.createExperience(UID, mkExperience('exp-tgt-hc', '对照组靶'));
    const merged = await svc.mergeExperiences(UID, 'exp-src-hc', 'exp-tgt-hc');
    expect(merged.source.status).toBe('merged');
    const tgt = readRawDisk(recallJsonRecordPath, 'exp-tgt-hc');
    expect((tgt.mergedFrom as Array<{ id: string }>).some((e) => e.id === 'exp-src-hc')).toBe(true);
  });

  it('【P-r2-38/P-r2-46 已修】target 段落盘后 source 在窗口期被归档 → merge rejects，半完成痕迹如实带 interrupted（不声称完成）', async () => {
    const { svc, recallJsonRecordPath, fileEditLock } = await setup();
    await svc.createExperience(UID, mkExperience('exp-src-hh', '并发源'));
    await svc.createExperience(UID, mkExperience('exp-tgt-hh', '并发靶'));
    const srcPath = recallJsonRecordPath(UID, 'experiences', 'exp-src-hh');

    // 持 source 记录锁：merge 的 ① target 段无竞争先行落盘，② source 段排队。
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const holder = fileEditLock(srcPath).runExclusive(() => gate);
    await new Promise((r) => setTimeout(r, 5));

    const mergeP = svc.mergeExperiences(UID, 'exp-src-hh', 'exp-tgt-hh', '半合并探针');
    await new Promise((r) => setTimeout(r, 30));
    // 此刻 ① 已落盘（target 侧已有 mergedFrom，带 interrupted），② 在 gate 上排队。

    // 持锁期间窗口内并发归档落盘（直改盘，先例手法）。
    const raw = JSON.parse(fs.readFileSync(srcPath, 'utf8')) as Record<string, unknown>;
    expect(raw.status).toBe('active');
    fs.writeFileSync(srcPath, JSON.stringify({
      ...raw,
      status: 'archived',
      archiveReason: '窗口期并发归档',
      archivedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));

    release();
    await holder;
    // ② 的锁内终态复核抛错（F-r1-25 修复本身正确：不再强改 archived→merged）。
    await expect(mergeP).rejects.toThrow(/terminal/);

    // 修复后：target 侧的痕迹**如实**——entry 与台账行都在，但带 interrupted=true，
    // 「家谱声称合并过」的失真不再；也不叠出重复条目（entry 恰一条）。
    const tgt = readRawDisk(recallJsonRecordPath, 'exp-tgt-hh');
    const mergedFrom = tgt.mergedFrom as Array<{ id: string; interrupted?: boolean }> | undefined;
    expect(mergedFrom?.filter((e) => e.id === 'exp-src-hh')).toHaveLength(1);
    expect(mergedFrom?.[0].interrupted).toBe(true);
    const history = tgt.history as Array<{ action: string; from?: string; interrupted?: boolean }>;
    expect(history.some((h) => h.action === 'merged_from' && h.from === 'exp-src-hh' && h.interrupted === true)).toBe(true);
    // source 侧未置 merged、无去向（两段不一致由 interrupted 标志如实表达）。
    const src = readRawDisk(recallJsonRecordPath, 'exp-src-hh');
    expect(src.status).toBe('archived');
    expect(src.mergedIntoExperienceId).toBeUndefined();

    // source 已终态：重试 merge 仍被 terminal 拒绝（archived 无出弧是终态纪律），
    // 但中断残留不再失真——interrupted 标志留在盘上如实标注「未完成」。
    await expect(svc.mergeExperiences(UID, 'exp-src-hh', 'exp-tgt-hh')).rejects.toThrow(/terminal/);
    const after = readRawDisk(recallJsonRecordPath, 'exp-tgt-hh');
    expect(((after.mergedFrom as Array<{ id: string; interrupted?: boolean }>) || [])
      .some((e) => e.id === 'exp-src-hh' && e.interrupted === true)).toBe(true);
  });
});
