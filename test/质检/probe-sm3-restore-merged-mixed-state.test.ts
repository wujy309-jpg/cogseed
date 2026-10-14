import { seedStoredAbilityAsset } from '../helpers/stored-ability-asset';
/**
 * 探针（状态机审计员 · 新循环第 3 轮）：restoreAbilityAsset 不区分「用户归档」
 * 与「归并归档」——已归并（mergedIntoAssetId 在身）的 source 被 restore 成
 * active 后，mergedIntoAssetId 残留，形成 active+已归并混合态，且 merge 预检
 * （asset-service.ts:1643 `if (source.mergedIntoAssetId) throw already been
 * merged`）永久拒绝再归并，用户面对重复知识失去去重通道。
 *
 * 读码链：
 *  - mergeAbilityAssets :1775 source 归档时写 status='archived' +
 *    mergedIntoAssetId=target；
 *  - restoreAbilityAsset :1437-1444 guard 只认 `status === 'archived' ||
 *    'deleted'`（归并后的 archived 同样放行），mutate 只清 deletedAt，
 *    mergedIntoAssetId 不动；
 *  - 对照 setStatus 矩阵：restore(archived→active) 本身是合法弧——缺口在
 *    后置条件：跃迁后「已并入他人」的标记与 active 状态并存，语义矛盾。
 *
 * 手法：纯顺序链路（无竞态）——建两资产 → merge → restore source → 断言
 * 混合态 + 再归并被拒。对照组：普通（非归并）archived 资产 restore 后可正常
 * 再归并，证明通道断是 mergedIntoAssetId 残留所致。
 *
 * 收尾状态（2026-10-01 记账员）：对应待议 **P-r1-98（restore 顺带清标记=归并可逆 vs 拒绝 restore 已归并=归并单向，产品语义两档相反待拍板）**——
 * 断言漏洞现状的用例 it.skip 注明编号，拍板修复后反转/改写断言启用；
 * 对照组（无竞态/无坏档时守卫与正常路径有效）不依赖漏洞，保留 active。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

let tmpDir: string;
let prevWs: string | undefined;
const UID = 'probe-sm3b';

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cogseed-probe-sm3b-'));
  prevWs = process.env.COGSEED_WORKSPACE_ROOT;
  process.env.COGSEED_WORKSPACE_ROOT = tmpDir;
  vi.resetModules();
});

afterEach(() => {
  process.env.COGSEED_WORKSPACE_ROOT = prevWs;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function loadAssets() {
  return import('../../src/main/features/recall/asset-service');
}

async function mkAsset(id: string) {
  const assets = await loadAssets();
  const now = new Date().toISOString();
  return seedStoredAbilityAsset(UID, {
    schemaVersion: 2, ownerId: UID, id, candidateId: `cand-${id}`,
    sourceCandidateIds: [`cand-${id}`], reviewDecisionId: `rd_probe${id.slice(-6)}`.padEnd(16, 'x'),
    type: 'personal', title: `资产 ${id}`, statement: `陈述 ${id}。`,
    evidenceRefs: [{ kind: 'conversation', id: `conv-${id}` }], scope: 'general', status: 'active',
    lifecycleStatus: 'user_confirmed_unverified', maturity: 'bud', version: '1',
    createdAt: now, updatedAt: now,
  }, { actor: 'user', reason: 'probe seed' });
}

const ACT = { actor: 'user' as const, reason: 'probe' };

describe('probe sm3 › restore 已归并 source 的混合态', () => {
  it.skip('【待议 P-r1-98】主用例：merge 后 restore source → active 但 mergedIntoAssetId 残留，且无法再次归并', async () => {
    const assets = await loadAssets();
    await mkAsset('aa-msrc1');
    await mkAsset('aa-mtgt1');
    await assets.mergeAbilityAssets(UID, 'aa-msrc1', 'aa-mtgt1', ACT);
    const mergedSource = await assets.readAbilityAsset(UID, 'aa-msrc1');
    expect(mergedSource.status).toBe('archived');
    expect(mergedSource.mergedIntoAssetId).toBe('aa-mtgt1');

    // restore：archived 是合法恢复源，放行。
    const restored = await assets.restoreAbilityAsset(UID, 'aa-msrc1', ACT);
    expect(restored.status).toBe('active');
    // 混合态：active 资产身上仍挂着「已并入 aa-mtgt1」的标记。
    expect(restored.mergedIntoAssetId).toBe('aa-mtgt1');

    // 去重通道断：merge 预检按 mergedIntoAssetId 永久拒绝。
    await expect(
      assets.mergeAbilityAssets(UID, 'aa-msrc1', 'aa-mtgt1', ACT),
    ).rejects.toThrow(/already been merged/);
  });

  it('对照组：普通（非归并）archived 资产 restore 后可正常归并（通道在）', async () => {
    const assets = await loadAssets();
    await mkAsset('aa-msrc2');
    await mkAsset('aa-mtgt2');
    await assets.archiveAbilityAsset(UID, 'aa-msrc2', ACT);
    const restored = await assets.restoreAbilityAsset(UID, 'aa-msrc2', ACT);
    expect(restored.status).toBe('active');
    expect(restored.mergedIntoAssetId).toBeUndefined();
    await expect(
      assets.mergeAbilityAssets(UID, 'aa-msrc2', 'aa-mtgt2', ACT),
    ).resolves.toBeTruthy();
  });
});
