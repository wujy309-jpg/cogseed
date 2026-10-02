/**
 * 探针 r6（边界测试员 · 本遍循环第 2 轮，编号顺延 r5）→ 主题：版本组终态一致性。
 *
 * 疑点（读码推演，asset-service.ts:1584-1623）：deleteAbilityAssetVersion 的
 * 「在用版本不可删」检查（:1593-1597）读的是**锁外**的资产快照；检查通过后
 * 到物理删除（:1619 removeRecallJsonlRecords，持 jsonl 流文件锁）之间隔着
 * 全量投影枚举 + 逐投影 updateRecallJsonRecord（各持投影记录锁）的大窗口。
 * 并发的 selectAbilityAssetVersion 改 activeVersion 走的是**资产记录文件锁**
 * ——两把锁互不互斥。交错序：delete 检查时 active=v3（要删的 v2 非在用，放行）
 * → select 把 activeVersion 落成 v2 → delete 物理删掉 v2 → 终态：资产声称
 * 在用 v2，版本流里却没有 v2，违反 :1577 注释「在用版本不可删（删除即资产
 * 内容变空）」的自留承诺，readAbilityAssetVersionSnapshot 从此拿 null。
 *
 * 时序注入手法：vi.mock 掉 context-projection.listAllConfirmedProjections——
 * 该调用点（:1604）位于 active 检查（:1597）之后、removeRecallJsonlRecords
 * （:1619）之前，在 mock 里同步执行一次 selectAbilityAssetVersion 即可 100%
 * 确定性地复现并发交错，不依赖真实赛跑的时序运气。
 *
 * 对照组（用例 1，无竞态）：select 先完整落盘，再 delete 同一版本 → 守卫正确
 * 拒绝。证明守卫本身有效、主用例的红正是窗口竞态所致。风格对齐
 * probe-r5-purge-earlyreturn-guard-bypass.test.ts。
 *
 * 收尾状态（2026-10-01 记账员）：对应待议 **P-r1-86（delete 检查+删除同锁且 select 锁内重校 vs 专用 per-asset 操作锁，实现切分待拍板）**——
 * 断言漏洞现状的用例 it.skip 注明编号，拍板修复后反转/改写断言启用；
 * 对照组（无竞态/无坏档时守卫与正常路径有效）不依赖漏洞，保留 active。
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

// 时序注入钩子：挂在 globalThis 上绕开 vi.mock 工厂的 hoisting 限制。
// deleteAbilityAssetVersion 在 active 检查之后调用 listAllConfirmedProjections，
// 钩子在此刻执行「并发对手方」selectAbilityAssetVersion，然后放行原实现。
type ProbeHook = (uid: string) => Promise<void> | undefined;
const g = globalThis as unknown as { __probeR6Hook?: ProbeHook; __probeR6Calls?: number };
vi.mock('../../src/main/features/recall/context-projection', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/main/features/recall/context-projection')>();
  return {
    ...actual,
    listAllConfirmedProjections: async (uid: string) => {
      g.__probeR6Calls = (g.__probeR6Calls || 0) + 1;
      if (g.__probeR6Hook) await g.__probeR6Hook(uid);
      return actual.listAllConfirmedProjections(uid);
    },
  };
});

let tmpDir: string;
let prevWs: string | undefined;
const UID = 'probe-r6-race';

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cogseed-probe-r6a-'));
  prevWs = process.env.COGSEED_WORKSPACE_ROOT;
  process.env.COGSEED_WORKSPACE_ROOT = tmpDir;
  g.__probeR6Hook = undefined;
  g.__probeR6Calls = 0;
  vi.resetModules();
});

afterEach(() => {
  process.env.COGSEED_WORKSPACE_ROOT = prevWs;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function loadAssets() {
  return import('../../src/main/features/recall/asset-service');
}

const ASSET_ID = 'aa-p6race01';

async function seedThreeVersions() {
  const assets = await loadAssets();
  const now = new Date().toISOString();
  await assets.createAbilityAsset(UID, {
    schemaVersion: 2, ownerId: UID, id: ASSET_ID, candidateId: `cand-${ASSET_ID}`,
    sourceCandidateIds: [`cand-${ASSET_ID}`], reviewDecisionId: 'rd_prober6seed01',
    type: 'personal', title: '资产 r6', statement: '第一版正文。',
    evidenceRefs: [{ kind: 'conversation', id: `conv-${ASSET_ID}` }], scope: 'general', status: 'active',
    lifecycleStatus: 'user_confirmed_unverified', maturity: 'bud', version: '1',
    createdAt: now, updatedAt: now,
  }, { actor: 'user', reason: 'probe seed' });
  // bump 到 v2、v3（update 每次 append 一版；无投影时刷新为 no-op）
  await assets.updateAbilityAsset(UID, ASSET_ID, { title: '资产 r6 v2', reason: 'bump 2', actor: 'user' });
  const afterV3 = await assets.updateAbilityAsset(UID, ASSET_ID, { title: '资产 r6 v3', reason: 'bump 3', actor: 'user' });
  expect(afterV3.version).toBe('3');
  const versions = await assets.listAbilityAssetVersions(UID, ASSET_ID);
  expect(versions.map((v) => v.version)).toEqual(['1', '2', '3']);
  return assets;
}

describe('probe r6 › deleteAbilityAssetVersion 的「在用版本不可删」检查在锁外（竞态）', () => {
  it('对照组：select 先落盘，delete 同版本被守卫拒绝（无竞态时守卫有效）', async () => {
    const assets = await seedThreeVersions();
    const selected = await assets.selectAbilityAssetVersion(UID, ASSET_ID, '2', { actor: 'user', reason: '切 v2 为在用' });
    expect(String(selected.activeVersion || selected.version)).toBe('2');
    await expect(
      assets.deleteAbilityAssetVersion(UID, ASSET_ID, '2', { actor: 'user', reason: '删在用版' }),
    ).rejects.toThrow(/cannot delete the active version/);
    const versions = await assets.listAbilityAssetVersions(UID, ASSET_ID);
    expect(versions.map((v) => v.version)).toContain('2');
  });

  it('【已修 P-r1-86】竞态主用例：delete 检查+删除同锁后，窗口内的 select 被锁内重校拒绝，在用版本不蒸发', async () => {
    const assets = await seedThreeVersions();
    // 并发对手方：在 delete 的锁定窗口内（投影冻结段）发起 select——修复后
    // delete 全程持资产记录锁，select 的记录写在同一把锁上排队，delete 先
    // 完成、select 随后锁内重列版本流发现 v2 已删而拒绝。钩子不能 await
    // select（那会与 delete 互等成死锁），发射后由主用例收尾统一断言。
    let selectPromise: Promise<unknown> | undefined;
    g.__probeR6Hook = async () => {
      selectPromise = assets.selectAbilityAssetVersion(UID, ASSET_ID, '2', { actor: 'user', reason: '竞态对手方' });
    };
    // delete v2：锁内复核时 active=v3 放行；物理删除在锁内完成。
    await assets.deleteAbilityAssetVersion(UID, ASSET_ID, '2', { actor: 'user', reason: '删 v2' });
    expect(g.__probeR6Calls).toBeGreaterThan(0); // 钩子确实在锁内窗口被调用
    expect(selectPromise).toBeDefined();
    // 排队的 select 在 delete 释放锁后运行：锁内重校发现 v2 已物理删除 → 拒绝。
    await expect(selectPromise).rejects.toThrow(/version not found/i);

    const asset = await assets.readAbilityAsset(UID, ASSET_ID);
    const versions = await assets.listAbilityAssetVersions(UID, ASSET_ID);
    // 终态断言（修复后）：在用版仍是 v3（select 未生效），v2 已删且没有任何
    // 指针指向蒸发版本——「在用版本不可删」的自留承诺成立。
    expect(String(asset.activeVersion || asset.version)).toBe('3');
    expect(versions.map((v) => v.version)).toEqual(['1', '3']);
    await expect(assets.readAbilityAssetVersionSnapshot(UID, ASSET_ID, '2')).resolves.toBeNull();
  });
});
