/**
 * 探针（本轮红队-越权与状态 · 数据完整性）：workspace-refs 单文件集合一条坏
 * JSON 让整个引用列表 throw——「一条坏档断一面」的第三处（F-r4-1 cognition
 * 整库拒、F-r3-1 experience 整列表拒都已修成逐条降级，此处同款未覆盖）。
 *
 * 读码链路：
 *  - listWorkspaceAssetReferences（workspace-refs.ts:64-69）：readdir 逐文件
 *    readRecallJsonRecord 后 **Promise.all 无 catch**——readExistingRecallRecord
 *    （recall/store.ts:86-93）对坏 JSON throw `malformed recall record: invalid
 *    JSON`（只放行 ENOENT）→ 一个坏引用文件让**整个**引用列表 rejects；
 *  - 消费方（爆炸半径）：①IPC recall.workspaceRefs.list（ipc/index.ts:3228，
 *    资产页空间引用 tab）；②context-projection.ts:539/:748/:1007——投影视图
 *    装配三处全量读（其中 :748/:1007 是注入/选版链）——坏一个引用文件，
 *    带 workspaceId 的投影构建/注入装配一并断；
 *  - 对照先例：listAbilityAssets（asset-service.ts 逐条 try/catch 降级，F-r4-1）、
 *    listExperiences（F-r3-1）、listAllConfirmedProjections（context-projection.ts
 *    :1196-1201 try/catch continue）——同仓三处同构消费方都已逐条降级，唯
 *    workspace-refs 漏。
 *
 * 预言：好引用 + 坏引用（截断 JSON）并存 → listWorkspaceAssetReferences 整体
 * rejects，好引用也不可见；剔除坏文件立即恢复。
 *
 * 2026-10-01 r4 修复员：F-r4-6 已修（照 listAbilityAssets / listExperiences /
 * 收尾（2026-10-01 记账员）：改名自 probe-r4-wsref-badfile-degrade.test.ts 收编回归——修复员已按预写口径翻转断言，改名后记账员亲跑全绿。
 * listRecallCandidates 口径逐条降级），漏洞用例已翻转为回归口径——坏档跳过、
 * 好引用照常列出；对照组不动。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

let tmpDir: string;
let previousRoot: string | undefined;
const UID = 'user-wsref-badfile-r4';

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cogseed-wsref-badfile-r4-'));
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
  const refs = await import('../../src/main/features/recall/workspace-refs');
  const assets = await import('../../src/main/features/recall/asset-service');
  const { recallJsonRecordPath } = await import('../../src/main/features/recall/paths');
  // addWorkspaceAssetReference 先 readAbilityAsset 校验资产在场（:52）——
  // 探针按真实链路先建资产。
  const now = new Date().toISOString();
  for (const suffix of ['1', '2']) {
    await assets.createAbilityAsset(UID, {
      schemaVersion: 2,
      ownerId: UID,
      id: `ast-good-${suffix}`,
      candidateId: `cand-wsref-${suffix}`,
      sourceCandidateIds: [`cand-wsref-${suffix}`],
      reviewDecisionId: `rd_wsref_probe_${suffix}`,
      type: 'rule',
      title: `引用探针资产${suffix}`,
      statement: `发布前核对回滚方案（wsref ${suffix}）。`,
      evidenceRefs: [{ kind: 'conversation', id: `conv-wsref-${suffix}` }],
      scope: 'project',
      status: 'active',
      lifecycleStatus: 'user_confirmed_unverified',
      maturity: 'bud',
      version: '1',
      createdAt: now,
      updatedAt: now,
    } as any, { actor: 'user', reason: 'wsref 探针创建' });
  }
  return { refs, recallJsonRecordPath };
}

describe('回归 r4 › workspace-refs 坏 JSON 逐条降级（F-r4-6 已修）', () => {
  it('对照组：两条好引用正常列出', async () => {
    const { refs } = await setup();
    await refs.addWorkspaceAssetReference(UID, { assetId: 'ast-good-1', workspaceId: 'wsp-a', scope: '只读引用' });
    await refs.addWorkspaceAssetReference(UID, { assetId: 'ast-good-2', workspaceId: 'wsp-b', scope: '编辑引用' });
    const list = await refs.listWorkspaceAssetReferences(UID);
    expect(list.length).toBe(2);
  });

  it('回归（F-r4-6 已修）：并存一条坏引用文件（截断 JSON）→ 坏档跳过，好引用照常列出', async () => {
    const { refs, recallJsonRecordPath } = await setup();
    await refs.addWorkspaceAssetReference(UID, { assetId: 'ast-good-1', workspaceId: 'wsp-a', scope: '只读引用' });

    // 模拟云同步撕裂另一条引用文件（写半截 JSON）。
    const badPath = recallJsonRecordPath(UID, 'workspace-refs', 'wsref-bad-torn-file');
    fs.mkdirSync(path.dirname(badPath), { recursive: true });
    fs.writeFileSync(badPath, '{"schemaVersion":2,"ownerId":"torn', 'utf8');

    // 修复前（漏洞）：一条坏档让整个列表 rejects（IPC 通道与投影装配三处同断）。
    // 修复后：坏条目降级跳过（照 listAbilityAssets/listExperiences 先例），
    // 好引用照常列出。
    const withBad = await refs.listWorkspaceAssetReferences(UID);
    expect(withBad.length).toBe(1);
    expect(withBad[0].assetId).toBe('ast-good-1');

    // 剔除坏文件后行为一致（坏档只影响自身、不拖累也不改变好引用可见性）。
    fs.rmSync(badPath);
    const list = await refs.listWorkspaceAssetReferences(UID);
    expect(list.length).toBe(1);
    expect(list[0].assetId).toBe('ast-good-1');
  });
});
