/**
 * 探针（本轮红队-数据与注入，主题：并发与时序/迁移与写入交错）：经验域
 * mergeExperiences 两段非原子——target 段落盘后 source 段抛错（F-r1-25 新增的
 * 锁内终态复核是新的可达中断点），merge 整体 reject 但 target 已吸收 mergedFrom
 * +台账，半完成痕迹不回滚、永不可收口。
 *
 * 读码链路（experience-service.ts，F-r1-25 修复后）：
 *  - ① target 段 :578-604 与 ② source 段 :606-628 是两次独立的
 *    updateRecallJsonRecord（各自文件锁，跨记录非事务）；
 *  - source 段 updater 首行 assertMutableExperience（:610）——窗口期内 source
 *    被归档即抛错。此时 **target 段已落盘**：mergedFrom 多出一条指向 source 的
 *    entry（:585-591 快照冻结）、台账多一条 merged_from（:595-601）；
 *  - merge 整体 rejects，用户以为「没合并」，但 target 的家谱/台账已声称合并过；
 *  - 永不可收口：source 已是 archived 终态（无出弧，:453-456 assertMutable 拦
 *    resume 一切），这条 merge 永远无法重试完成；target 里的 mergedFrom 永久
 *    指向一条从未置 merged 的记录（家谱失真）。重试也不行——即使 source 可恢
 *    复，target 段的 entry 是无条件 push（:594 仅 inherited 按 seen 去重，entry
 *    本身不去重），会叠出重复条目。
 *
 * 对照资产域同族：P-r1-18（mergeAbilityAssets 三段非原子的中断残留）已议的是
 * 版本流撞号/IO 失败路径；本条是终态守卫抛错路径 + mergedFrom 语义撒谎，独立面。
 *
 * 收尾状态（2026-10-01 记账员）：对应待议 **P-r2-38（拍板：interrupted 标志+幂等重试）**——
 * 主用例已随修复启用（断言改写：中断痕迹如实带 interrupted、不声称完成）；
 * 对照组（无竞态/串行序时链路正常）不依赖漏洞，保留 active。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

let tmpDir: string;
let previousRoot: string | undefined;
const UID = 'user-exp-merge-r2';

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cogseed-exp-merge-r2-'));
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
    source: { episodeId: `kse-${id}`, taskGoal: `任务-${id}`, taskType: 'code' as const, taskStatus: 'confirmed' },
    experienceType: 'lesson' as const,
    title,
    body: `${title}：先备份再执行变更。`,
    scope: 'code',
    verification: { state: 'confirmed' as const, outcome: 'met_expected' as const, deltaR: 0.1, confidence: 0.7 },
    evidenceRefs: [{ kind: 'conversation' as const, id: `conv-${id}` }],
    learningProvenance: { projectionId: `prj-${id}`, episodeId: `kse-${id}`, ruleRefs: [], attribution: 'execution_gap' as const },
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

function readRaw(recallJsonRecordPath: (uid: string, c: string, id: string) => string, id: string) {
  return JSON.parse(fs.readFileSync(recallJsonRecordPath(UID, 'experiences', id), 'utf8')) as Record<string, unknown>;
}

describe('探针 r2 › 经验 merge 两段非原子：source 段抛错后 target 半完成痕迹不回滚', () => {
  it('对照组：无并发时完整 merge 成功，target 家谱干净单条、source 置 merged', async () => {
    const { svc } = await setup();
    await svc.createExperience(UID, mkExperience('exp-src-ok', '正常源'));
    await svc.createExperience(UID, mkExperience('exp-tgt-ok', '正常靶'));
    const merged = await svc.mergeExperiences(UID, 'exp-src-ok', 'exp-tgt-ok');
    expect(merged.target.mergedFrom?.length).toBe(1);
    expect(merged.source.status).toBe('merged');
  });

  it('【P-r2-38 已修】target 段落盘后 source 段遇终态抛错 → merge rejects 且 target 的 mergedFrom/台账如实带 interrupted，不声称完成', async () => {
    const { svc, recallJsonRecordPath, fileEditLock } = await setup();
    await svc.createExperience(UID, mkExperience('exp-src-p', '中断源'));
    await svc.createExperience(UID, mkExperience('exp-tgt-p', '中断靶'));
    const srcPath = recallJsonRecordPath(UID, 'experiences', 'exp-src-p');

    // 确定性时序：持 source 文件锁——target 段（另一把锁）先完成落盘，
    // source 段在 gate 上排队。
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const holder = fileEditLock(srcPath).runExclusive(() => gate);
    await new Promise((r) => setTimeout(r, 5));

    const mergeP = svc.mergeExperiences(UID, 'exp-src-p', 'exp-tgt-p', '中断窗口探针');
    await new Promise((r) => setTimeout(r, 25));

    // 持锁期间 source 被归档（另一路径）。
    const raw = JSON.parse(fs.readFileSync(srcPath, 'utf8')) as Record<string, unknown>;
    expect(raw.status).toBe('active');
    fs.writeFileSync(srcPath, JSON.stringify({
      ...raw,
      status: 'archived',
      archiveReason: '窗口期归档',
      archivedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));

    release();
    await holder;
    // F-r1-25 生效：source 段抛 terminal，merge 整体 rejects。
    await expect(mergeP).rejects.toThrow(/terminal/);

    // 修复后（interrupted 标志如实化）：target 段的落盘保留——entry 与台账都在，
    // 但都带 interrupted=true——家谱如实记「合并开始过、未完成」，不再声称
    // 一条从未完成的合并已经并进来了。
    const target = readRaw(recallJsonRecordPath, 'exp-tgt-p');
    const mf = target.mergedFrom as Array<{ id: string; interrupted?: boolean }> | undefined;
    expect(Array.isArray(mf) && mf.some((e) => e.id === 'exp-src-p' && e.interrupted === true)).toBe(true);
    expect((target.history as Array<{ action?: string; interrupted?: boolean }>)
      .some((h) => h.action === 'merged_from' && h.interrupted === true)).toBe(true);

    // source 已 archived 终态（resume 也被拒）：这条 merge 无法重试完成是终态纪律
    // （archived 无出弧），但 target 侧的 interrupted 标志把「未完成」如实留在盘上。
    await expect(svc.setExperienceStatus(UID, 'exp-src-p', 'resume')).rejects.toThrow(/terminal/);
    await expect(svc.mergeExperiences(UID, 'exp-src-p', 'exp-tgt-p')).rejects.toThrow(/terminal/);
    const stillInterrupted = readRaw(recallJsonRecordPath, 'exp-tgt-p');
    expect(((stillInterrupted.mergedFrom as Array<{ id: string; interrupted?: boolean }>) || [])
      .some((e) => e.id === 'exp-src-p' && e.interrupted === true)).toBe(true);
  });
});
