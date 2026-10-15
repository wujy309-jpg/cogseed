import { seedStoredAbilityAsset } from '../helpers/stored-ability-asset';
/**
 * 探针（本轮红队-越权与状态）：runExperienceMigration 判据→物理迁出窗口不复核资产状态。
 *
 * 读码链路（experience-migration.ts）：
 *  - 逐条执行序 = readAbilityAsset :452（**无锁直读**，store.ts
 *    readExistingRecallRecord 不走 fileEditLock）→ migrationVerdict :460（终态/
 *    provenance 判据，基于锁外快照）→ ① freezeAssetIntoConfirmedProjections :467
 *    → ② writeExperienceForAsset :475（写 `exp-mig-<assetId>` 经验，持**经验记录锁**）
 *    → ③ removeAssetRecordAndVersions :482 持资产记录锁 fs.rm 主记录 + 删版本流；
 *  - removeAssetRecordAndVersions（:339-346）锁内**只做 rm，零状态复核**——
 *    migrationVerdict 自己的注释（:62「deleted/purged/revoked：删除是用户意图，
 *    不迁」）与 deleteAbilityAsset 的 30 天保留期承诺（restore 可回 active）都
 *    只在锁外快照上检查过一次；
 *  - 对照：同域 setExperienceStatus / setExperienceType / archiveExperience 的
 *    updater 全部锁内复核 assertMutableExperience（本轮同题发现 1 的先例）、
 *    asset-service 迁移函数锁内 asAsset + assertMutableAbilityAsset（本遍 F-r2
 *    修复先例）——唯独经验迁移的迁出段漏。
 *
 * 危害：窗口期内（①②两段真实 IO 之间）用户 deleteAbilityAsset 落盘 → 迁移照常
 * 物理删除已删资产的主记录与版本流：保留期/restore 承诺被静默打破（restore 从此
 * not found），且不走 purge 级联（回流候选/使用回执等引用面照旧残留）。
 *
 * 手法：writeExperienceForAsset 的经验 id 是确定性的 `exp-mig-<assetId>`——预持
 * 该路径的 fileEditLock 把迁移精确卡在 ②与③之间（与 exp-merge 探针同款确定性
 * 时序，不依赖真实赛跑运气），持锁期间走**真实** deleteAbilityAsset。
 *
 * 收尾状态（2026-10-01 记账员）：对应待议 **P-r1-89（迁出锁内终态复核主修唯一，分叉在已写成的 exp-mig 经验条目去留待拍板）**——
 * 断言漏洞现状的用例 it.skip 注明编号，拍板修复后反转/改写断言启用；
 * 对照组（无竞态/无坏档时守卫与正常路径有效）不依赖漏洞，保留 active。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

let tmpDir: string;
let previousRoot: string | undefined;
const UID = 'user-mig-toctou-r1';
const ASSET = 'ast-mig-toctou';

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cogseed-mig-toctou-r1-'));
  previousRoot = process.env.COGSEED_WORKSPACE_ROOT;
  process.env.COGSEED_WORKSPACE_ROOT = tmpDir;
  vi.resetModules();
});

afterEach(() => {
  if (previousRoot === undefined) delete process.env.COGSEED_WORKSPACE_ROOT;
  else process.env.COGSEED_WORKSPACE_ROOT = previousRoot;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function setup() {
  const users = await import('../../src/main/features/users');
  users.activateUser(UID);
  const assets = await import('../../src/main/features/recall/asset-service');
  const migration = await import('../../src/main/features/recall/experience-migration');
  const { recallJsonRecordPath } = await import('../../src/main/features/recall/paths');
  const { fileEditLock } = await import('../../src/main/util/locks');
  return { assets, migration, recallJsonRecordPath, fileEditLock };
}

/** KSTAR 经验类资产夹具（照 experience-migration.test.ts 同款：带
 *  learningProvenance 的判据正例，以测试 helper 预置历史记录）。 */
async function seedAsset(status: 'active' | 'deleted') {
  const { assets } = await setup();
  const now = new Date().toISOString();
  return seedStoredAbilityAsset(UID, {
    schemaVersion: 1,
    ownerId: UID,
    id: ASSET,
    candidateId: `cand-${ASSET}`,
    title: `经验资产-${ASSET}`,
    statement: `发布前必须核对回滚方案（${ASSET}）`,
    type: 'rule',
    scope: 'project',
    evidenceRefs: [{ kind: 'execution', id: `exec-${ASSET}` }],
    reviewDecisionId: 'legacy-untracked',
    lifecycleStatus: 'system_precipitated_unverified',
    status,
    maturity: 'transfer_validated',
    version: '1',
    learningProvenance: {
      projectionId: `prj-${ASSET}`,
      episodeId: `kse-${ASSET}`,
      ruleRefs: [],
      attribution: 'execution_gap' as const,
    },
    createdAt: now,
    updatedAt: now,
  }, 'migration toctou probe fixture');
}

function userAction(reason: string) {
  return { actor: 'user' as const, reason };
}

describe('探针 r1 › 经验迁移判据→迁出窗口不复核资产状态（TOCTOU）', () => {
  it('对照组：无并发时 deleted 资产按判据跳过（terminal_status），保留期与 restore 都在', async () => {
    const { assets, migration, recallJsonRecordPath } = await setup();
    await seedAsset('active');
    // 走真实删除路径落 deletedAt（直接种子 deleted 态缺 deletedAt，保留期判过期）。
    const deleted = await assets.deleteAbilityAsset(UID, ASSET, userAction('对照组删除'));
    expect(deleted.status).toBe('deleted');

    const run = await migration.runExperienceMigration(UID, [ASSET]);
    expect(run.migrated).toBe(0);
    expect(run.details.some((d) => 'reason' in d && d.reason === 'terminal_status')).toBe(true);

    // 判据生效：主记录仍是 deleted 墓碑（保留期内），restore 可回 active。
    const recPath = recallJsonRecordPath(UID, 'ability-assets', ASSET);
    expect(fs.existsSync(recPath)).toBe(true);
    const restored = await assets.restoreAbilityAsset(UID, ASSET, userAction('对照组恢复'));
    expect(restored.status).toBe('active');
  });

  it('【已修 P-r1-89】判据通过后、物理迁出前资产被删除 → 锁内复核拒绝迁出，已写经验记 failed、保留期/restore 完好', async () => {
    const { assets, migration, recallJsonRecordPath, fileEditLock } = await setup();
    await seedAsset('active');
    const assetPath = recallJsonRecordPath(UID, 'ability-assets', ASSET);
    // writeExperienceForAsset 的经验 id 是确定性的 exp-mig-<assetId>（:341）。
    const expPath = recallJsonRecordPath(UID, 'experiences', `exp-mig-${ASSET}`);

    // 确定性时序：预持经验记录锁，把迁移卡在 ②写经验 与 ③物理迁出 之间。
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const holder = fileEditLock(expPath).runExclusive(() => gate);
    await new Promise((r) => setTimeout(r, 5));

    const runP = migration.runExperienceMigration(UID, [ASSET]);
    await new Promise((r) => setTimeout(r, 30));

    // 持锁期间走真实用户路径删除资产（资产记录锁空闲，立即完成落盘）。
    const deleted = await assets.deleteAbilityAsset(UID, ASSET, userAction('窗口期内用户删除'));
    expect(deleted.status).toBe('deleted');
    const onDisk = JSON.parse(fs.readFileSync(assetPath, 'utf8')) as Record<string, unknown>;
    expect(onDisk.status).toBe('deleted'); // 删除已先于迁出落盘

    release();
    await holder;
    const run = await runP;

    // 修复后（P-r1-89 拍板口径）：迁出段锁内复核终态——已删资产不物理迁出。
    // 本场景经验条目已写出（②在删除前完成）→ 记 failed（asset_removal_failed），
    // 不是 migrated、也不是 skipped。
    expect(run.migrated).toBe(0);
    expect(run.failed).toBe(1);
    expect(run.details.some((d) => 'reason' in d && d.reason === 'asset_removal_failed')).toBe(true);

    // 已删资产的主记录保留为墓碑：保留期内 restore 通道完好。
    expect(fs.existsSync(assetPath)).toBe(true);
    const kept = JSON.parse(fs.readFileSync(assetPath, 'utf8')) as Record<string, unknown>;
    expect(kept.status).toBe('deleted');
    const restored = await assets.restoreAbilityAsset(UID, ASSET, userAction('保留期内恢复'));
    expect(restored.status).toBe('active');

    // 而经验条目已写出（半迁如实可见——正是记 failed 而非 skipped 的依据）。
    expect(fs.existsSync(expPath)).toBe(true);
    const exp = JSON.parse(fs.readFileSync(expPath, 'utf8')) as Record<string, unknown>;
    expect(String(exp.body)).toContain('发布前必须核对回滚方案');
  });
});
