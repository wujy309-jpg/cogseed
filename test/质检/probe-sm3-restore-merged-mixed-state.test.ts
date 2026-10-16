import { seedStoredAbilityAsset } from '../helpers/stored-ability-asset';
/** 恢复已归并源时的 active 状态、归并去向及再次归并一致性。 */
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

describe('restore 已归并 source 的混合态', () => {
  it.skip('归并后恢复源：状态为 active 但归并去向残留，无法再次归并', async () => {
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
