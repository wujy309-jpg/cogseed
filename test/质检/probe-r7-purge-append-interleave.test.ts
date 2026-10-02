/**
 * 探针 r7（边界测试员 · 本遍循环第 2 轮，编号顺延 r6）→ 主题：并发与时序（迁移与写入交错 / 删除后复活）。
 *
 * 疑点（读码推演 + probe-sm2 的等价构造升级为真实链路复现）：
 * - removeRecallJsonlStream（recall/store.ts）purge 整条版本流时裸 fs.rm：
 *   不取 appendJsonlAtomic 的行锁（storage.ts _getLineLock），也不失效行数缓存。
 * - rollbackAbilityAsset / updateAbilityAsset / mergeAbilityAssets 的版本流 append
 *   都发生在 updateRecallJsonRecord（资产记录锁）**释放之后**——「主记录已写、
 *   append 在路上」的在途写真实存在。
 * - 交错序：rollback 的锁内 updater 完成（bump v3）→ purge 的 setStatus 拿锁落
 *   purged 墓碑 → removeRecallJsonlStream rm 掉流 → rollback 的 appendVersion 此刻
 *   才落地 → appendFile **重建流文件**并写入 v3 快照行 → purged 资产的版本流带
 *   正文复活，purged 终态拒绝一切写、无任何产品通道再清它（「内容与记录一并
 *   清除、不可恢复」破防）。
 *
 * 与 probe-sm2-purge-stream-lockless-rm 的差异：sm2 是「purge 完成后手动直调
 * appendJsonlAtomic 模拟在途写」的等价构造；本探针用 vi.mock 注入时序，让
 * rollback 与 purge 两条**产品代码路径**自行完成全部锁/校验/级联——排除「真实
 * 链路另有守卫挡住」的质疑。
 *
 * 对照组（用例 1，正常序）：先 rollback 完整落盘再 purge → 流被清空、无复活，
 * 证明复活正是「append 晚于 rm」的窗口所致。风格对齐 probe-r6-*。
 *
 * 收尾状态（2026-10-01，P-r2-3 拍板根治后改写启用）：修复把版本流追加收进
 * 资产主记录锁（appendAbilityAssetVersionLine：锁内重读记录、assertMutable-
 * AbilityAsset 复核后才落流），rm 走同把行锁（storage.removeJsonlStream）。
 * 主用例的注入口随之从 appendRecallJsonlRecord（修复后该点已在记录锁内，
 * 在锁内再跑 purge 会按设计互斥死等）改到 updateRecallJsonRecord 的**返回沿**：
 * 真实 update 落盘并释放锁之后、appendVersion 启动之前，正是修复前复活的
 * 那个窗口——修复后窗口内完整落地的 purge 必须让随后的追加被锁内复核拒绝，
 * 流不得重建。断言按修复后口径改写（拒绝 + 流不复活），不再 it.skip。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

vi.mock('../../src/main/features/kb_indexer', () => ({
  enqueue: () => {},
  kbEvents: { on: () => {}, off: () => {}, emit: () => {} },
}));
vi.mock('../../src/main/features/search', () => ({
  upsertContext: () => {},
  dropContext: () => {},
}));

// 时序钩子：rollback 的主记录段走 updateRecallJsonRecord（asset-service 调
// store 的真实写入口）——在该入口**完成并释放记录锁之后**、把结果交还调用方
// 之前，先完整跑一次 purge（落墓碑 + rm 流 + 级联）。这正是修复前「主记录已
// 写、appendVersion 在路上」的复活窗口；修复后 appendVersion 会在自己的记录
// 锁临界段内重读记录并做终态复核。
const g = globalThis as unknown as { __probeR7Hook?: () => Promise<void>; __probeR7Fired?: boolean };
vi.mock('../../src/main/features/recall/store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/main/features/recall/store')>();
  return {
    ...actual,
    updateRecallJsonRecord: async (...args: Parameters<typeof actual.updateRecallJsonRecord>) => {
      const result = await actual.updateRecallJsonRecord(...args);
      if (g.__probeR7Hook && !g.__probeR7Fired) {
        g.__probeR7Fired = true;
        await g.__probeR7Hook();
      }
      return result;
    },
  };
});

let tmpDir: string;
let prevWs: string | undefined;
const UID = 'probe-r7-interleave';

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cogseed-probe-r7-'));
  prevWs = process.env.COGSEED_WORKSPACE_ROOT;
  process.env.COGSEED_WORKSPACE_ROOT = tmpDir;
  g.__probeR7Hook = undefined;
  g.__probeR7Fired = false;
  vi.resetModules();
});

afterEach(() => {
  process.env.COGSEED_WORKSPACE_ROOT = prevWs;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const ASSET_ID = 'aa-p7inter01';
const ACT = { actor: 'user' as const, reason: 'probe' };

async function loadAssets() {
  return import('../../src/main/features/recall/asset-service');
}

function versionStreamFile(id: string): string {
  return path.join(tmpDir, UID, 'cloud', 'recall', 'jsonl', 'ability-asset-versions', `${id}.jsonl`);
}

/** v1 起、update 出 v2（当前 v2，可回滚到 v1）。 */
async function seedAtV2() {
  const assets = await loadAssets();
  const now = new Date().toISOString();
  await assets.createAbilityAsset(UID, {
    schemaVersion: 2, ownerId: UID, id: ASSET_ID, candidateId: `cand-${ASSET_ID}`,
    sourceCandidateIds: [`cand-${ASSET_ID}`], reviewDecisionId: 'rd_prober7seed01',
    type: 'personal', title: '资产 r7', statement: '第一版正文（回滚目标）。',
    evidenceRefs: [{ kind: 'conversation', id: `conv-${ASSET_ID}` }], scope: 'general', status: 'active',
    lifecycleStatus: 'user_confirmed_unverified', maturity: 'bud', version: '1',
    createdAt: now, updatedAt: now,
  }, { actor: 'user', reason: 'probe seed' });
  const updated = await assets.updateAbilityAsset(UID, ASSET_ID, { title: '资产 r7 v2', reason: 'bump 2', actor: 'user' });
  expect(updated.version).toBe('2');
  return assets;
}

describe('probe r7 › rollback 在途 append 与 purge 删流的交错：purged 版本流复活', () => {
  it('对照组：先 rollback 完整落盘再 purge → 流被清空、无复活（正常序干净）', async () => {
    const assets = await seedAtV2();
    const rolled = await assets.rollbackAbilityAsset(UID, ASSET_ID, '1', ACT);
    expect(rolled.version).toBe('3');
    expect((await assets.listAbilityAssetVersions(UID, ASSET_ID)).length).toBe(3);

    await assets.purgeAbilityAsset(UID, ASSET_ID, ACT);
    const purged = await assets.readAbilityAsset(UID, ASSET_ID);
    expect(purged.status).toBe('purged');
    expect(purged.statement).toBe('');
    expect(await assets.listAbilityAssetVersions(UID, ASSET_ID)).toEqual([]);
  });

  it('【P-r2-3 已根治】交错主用例：purge 在主记录落盘后、版本追加前完整落地 → 追加被锁内复核拒绝、流不复活', async () => {
    const assets = await seedAtV2();
    // 钩子在 seed 完成后才武装：只命中 rollback 自己的主记录段（一次性），
    // purge 内部的 setStatus 写不会被二次注入。
    g.__probeR7Hook = async () => {
      // 此刻 rollback 的 v3 已写进主记录（锁已释放）、appendVersion 尚未启动。
      // 并发对手方 purge 完整执行：墓碑 + rm 流（流里此刻只有 v1/v2 行）+ 级联。
      await assets.purgeAbilityAsset(UID, ASSET_ID, ACT);
      const purged = await assets.readAbilityAsset(UID, ASSET_ID);
      expect(purged.status).toBe('purged'); // purge 真实落盘
      expect(fs.existsSync(versionStreamFile(ASSET_ID))).toBe(false); // 流已删净
    };
    // 修复后终态：appendVersion 在记录锁临界段内重读主记录，发现 purged 墓碑
    // 即拒绝追加——rollback 整体以「资产已被彻底清除」失败，而不是把 v3 快照
    // 写回复活流（修复前此处成功返回、流带正文复活且永不可清）。
    await expect(assets.rollbackAbilityAsset(UID, ASSET_ID, '1', ACT)).rejects.toThrow(/purged/);
    expect(g.__probeR7Fired).toBe(true); // 钩子确实在主记录落盘与追加之间触发

    // 终态断言：主记录是墓碑，版本流没有被在途 append 重建——盘上无正文残留。
    const purged = await assets.readAbilityAsset(UID, ASSET_ID);
    expect(purged.status).toBe('purged');
    expect(purged.statement).toBe('');
    expect(fs.existsSync(versionStreamFile(ASSET_ID))).toBe(false);
    expect(await assets.listAbilityAssetVersions(UID, ASSET_ID)).toEqual([]);
    // purged 终态拒绝一切写：重试 purge 被 assertNotPurged 挡（终态口径不变）。
    await expect(assets.purgeAbilityAsset(UID, ASSET_ID, ACT)).rejects.toThrow(/purged/);
  });
});
