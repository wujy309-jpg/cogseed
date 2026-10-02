/**
 * 探针（本轮红队-越权与状态 · 并发与时序）：mergeExperiences 的
 * experienceType 一致性检查只在锁外快照上做——窗口期内改类型即跨类型合并落盘。
 *
 * 读码链路（experience-service.ts）：
 *  - :572-574 「必须同 experienceType」预检基于 readRecallJsonRecord 的**无锁直读**
 *    （store.ts readExistingRecallRecord 不走 fileEditLock）；
 *  - F-r1-25（上轮）给两段 updater 补的是 assertMutableExperience（终态复核），
 *    **没有复核类型**——修复记录自认「experienceType 锁内一致性复核未做……属
 *    另一独立 TOCTOU 窗口，留待检测线另行立项」（round-1-修复.md F-r1-25 段）；
 *  - setExperienceType（:497-524）是用户随时可改类型的合法通道（IPC
 *    recall.experiences.setType 真实可达），与 merge 并发即交错。
 *
 * 危害：E5 契约明文「必须同 experienceType：跨类型合并会把『教训』并进『流程』，
 * 静默做掉等于替用户改判，所以宁可拒绝（契约 E5 的两条不变量之一）」——窗口期
 * 内类型被改后，target updater 只挡终态不挡类型，跨类型合并静默落盘。
 *
 * 手法：持 target 文件锁 → 排队一次真实 setExperienceType（改 workflow）→ 启动
 * merge（锁外读双双 lesson、预检通过、target updater 排在 setType 之后）→ 放锁
 * → setType 先落盘、merge 随后在 workflow 的 target 上铺 mergedFrom。全程确定性。
 *
 * 收尾状态（2026-10-01 记账员）：对应待议 **P-r2-16（只修实证 target 侧 vs 对称收口 source 侧镜像窗口，覆盖范围待拍板）**——
 * 断言漏洞现状的主用例 it.skip 注明编号，拍板修复后反转/改写断言启用；
 * 对照组（无竞态/串行序时链路正常）不依赖漏洞，保留 active。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

let tmpDir: string;
let previousRoot: string | undefined;
const UID = 'user-exp-merge-type-r2';

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cogseed-exp-merge-type-r2-'));
  previousRoot = process.env.COGSEED_WORKSPACE_ROOT;
  process.env.COGSEED_WORKSPACE_ROOT = tmpDir;
  vi.resetModules();
});

afterEach(() => {
  if (previousRoot === undefined) delete process.env.COGSEED_WORKSPACE_ROOT;
  else process.env.COGSEED_WORKSPACE_ROOT = previousRoot;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function mkExperience(id: string, title: string, experienceType: 'lesson' | 'workflow') {
  const now = new Date().toISOString();
  return {
    id,
    source: {
      episodeId: `kse-${id}`,
      taskGoal: `任务-${id}`,
      taskType: 'code' as const,
      taskStatus: 'confirmed',
    },
    experienceType,
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

describe('探针 r2 › 经验 merge 的 experienceType 一致性检查在锁外（TOCTOU）', () => {
  it('对照组：无并发时跨类型 merge 被拒（lesson → workflow）', async () => {
    const { svc } = await setup();
    await svc.createExperience(UID, mkExperience('exp-src-tc', '对照组源', 'lesson'));
    await svc.createExperience(UID, mkExperience('exp-tgt-tc', '对照组靶', 'workflow'));
    await expect(svc.mergeExperiences(UID, 'exp-src-tc', 'exp-tgt-tc')).rejects.toThrow(/same experienceType/);
  });

  it('【已修 P-r2-16】target 侧：预检通过后、target 落盘前类型被改 → 锁内复核拒绝，跨类型合并不再落盘', async () => {
    const { svc, recallJsonRecordPath, fileEditLock } = await setup();
    await svc.createExperience(UID, mkExperience('exp-src-tw', '并发源', 'lesson'));
    await svc.createExperience(UID, mkExperience('exp-tgt-tw', '并发靶', 'lesson'));
    const recPath = recallJsonRecordPath(UID, 'experiences', 'exp-tgt-tw');

    // 确定性时序：持 target 锁，先排队一次真实改类型，再启动 merge。
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const holder = fileEditLock(recPath).runExclusive(() => gate);
    await new Promise((r) => setTimeout(r, 5));

    const typeP = svc.setExperienceType(UID, 'exp-tgt-tw', 'workflow', '并发改类型');
    await new Promise((r) => setTimeout(r, 5));
    // merge 的锁外预读发生在此刻：双双 lesson、类型一致、预检通过，
    // 其 target updater 排在 setType 之后（锁内看到的已是 workflow）。
    const mergeP = svc.mergeExperiences(UID, 'exp-src-tw', 'exp-tgt-tw', '并发窗口探针');
    await new Promise((r) => setTimeout(r, 25));

    release();
    await holder;
    await typeP;
    // 修复后：target updater 锁内复核类型，分叉即拒绝。
    await expect(mergeP).rejects.toThrow(/same experienceType/);

    const disk = readRawDisk(recallJsonRecordPath, 'exp-tgt-tw');
    expect(disk.experienceType).toBe('workflow');
    // 跨类型合并不再落盘：target 无 mergedFrom 铺入。
    const mergedFrom = disk.mergedFrom as Array<{ id: string }> | undefined;
    expect(Array.isArray(mergedFrom) && mergedFrom.some((e) => e.id === 'exp-src-tw')).toBe(false);
    // source 侧未置 merged（② 段没跑到），两条记录都还各自完整可处置。
    const src = readRawDisk(recallJsonRecordPath, 'exp-src-tw');
    expect(src.status).toBe('active');
    expect(src.mergedIntoExperienceId).toBeUndefined();
  });

  it('【已修 P-r2-16】source 侧镜像窗口：预检通过后、source 落盘前 source 类型被改 → source 段锁内复核拒绝，interrupted entry 如实记未完成', async () => {
    const { svc, recallJsonRecordPath, fileEditLock } = await setup();
    await svc.createExperience(UID, mkExperience('exp-src-sm', '镜像源', 'lesson'));
    await svc.createExperience(UID, mkExperience('exp-tgt-sm', '镜像靶', 'lesson'));
    // source 在预检后被改类型：①段（target 铺 entry）用的是锁外快照照常通过，
    // 卡点在 ②source 段——持 source 锁排队一次真实改类型，让 ② 的锁内读看到
    // 新类型。
    const srcPath = recallJsonRecordPath(UID, 'experiences', 'exp-src-sm');
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const holder = fileEditLock(srcPath).runExclusive(() => gate);
    await new Promise((r) => setTimeout(r, 5));

    const typeP = svc.setExperienceType(UID, 'exp-src-sm', 'workflow', '镜像窗口改类型');
    await new Promise((r) => setTimeout(r, 5));
    const mergeP = svc.mergeExperiences(UID, 'exp-src-sm', 'exp-tgt-sm', '镜像窗口探针');
    await new Promise((r) => setTimeout(r, 25));

    release();
    await holder;
    await typeP;
    // source 段锁内复核：锁内 source 类型（workflow）≠ target 类型（lesson）
    // → 拒绝，跨类型合并不成立。
    await expect(mergeP).rejects.toThrow(/same experienceType/);

    // source 未被置 merged，类型保持用户改的 workflow。
    const src = readRawDisk(recallJsonRecordPath, 'exp-src-sm');
    expect(src.status).toBe('active');
    expect(src.experienceType).toBe('workflow');
    // target 侧留下 interrupted entry（①已铺、②拒绝）——家谱如实记
    // 「合并进行中未完成」，重试由入口对账自愈（幂等口径）。
    const tgt = readRawDisk(recallJsonRecordPath, 'exp-tgt-sm');
    const mergedFrom = tgt.mergedFrom as Array<{ id: string; interrupted?: boolean }> | undefined;
    expect(Array.isArray(mergedFrom) && mergedFrom.some((e) => e.id === 'exp-src-sm' && e.interrupted === true)).toBe(true);
  });
});
