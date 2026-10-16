import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

let root: string;
const uid = 'timeline-snapshot-user';
beforeEach(async () => {
  vi.resetModules();
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'cogseed-timeline-snapshot-'));
  vi.stubEnv('COGSEED_WORKSPACE_ROOT', root);
});
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); await fs.rm(root, { recursive: true, force: true }); });
async function fixture() {
  const journal = await import('../../../../src/main/features/recall/asset-version-journal');
  const raw = journal.withPendingAssetVersion(undefined, { schemaVersion: 2, ownerId: uid, id: 'aa-snapshot', candidateId: 'old-candidate',
    reviewDecisionId: 'old-review', type: 'cognition', contentCategory: 'method', title: '已保存的方法', statement: '先核对来源，再保存完整成果。',
    evidenceRefs: [], origin: 'manual', status: 'active', maturity: 'bud', scope: 'general', version: '1',
    createdAt: '2026-10-15T00:00:00.000Z', updatedAt: '2026-10-15T00:00:00.000Z' });
  const bridge = await import('../../../../src/main/features/cognition_bridge');
  await bridge.replaceCognitionSources(uid, { mode: 'unified', revision: 1, records: { 'ability-assets': { [raw.id]: raw }, candidates: {} },
    po: { groups: [], trash: [] }, pendingProjection: false, migratedAt: '2026-10-15T00:00:00.000Z' });
  const assets = await import('../../../../src/main/features/recall/asset-service');
  return { assets, head: await assets.readAbilityAsset(uid, raw.id) };
}
it('reuses a same-request head without losing a committed pending version or changing the default caller contract', async () => {
  const { assets, head } = await fixture();
  const store = await import('../../../../src/main/features/recall/store');
  const reads = vi.spyOn(store, 'readRecallJsonRecord');
  const ordinary = await assets.listAbilityAssetVersions(uid, head.id);
  expect(reads).toHaveBeenCalledTimes(1);
  reads.mockClear();
  const shared = await assets.listAbilityAssetVersions(uid, head.id, head);
  expect(reads).not.toHaveBeenCalled();
  expect(shared).toEqual(ordinary);
  expect(shared).toEqual([expect.objectContaining({ version: '1', snapshot: expect.objectContaining({ statement: head.statement }) })]);
});
it('refuses a supplied head belonging to a different user or asset', async () => {
  const { assets, head } = await fixture();
  await expect(assets.listAbilityAssetVersions(uid, head.id, { ...head, ownerId: 'other-user' })).rejects.toThrow('identity mismatch');
  await expect(assets.listAbilityAssetVersions(uid, head.id, { ...head, id: 'aa-other' })).rejects.toThrow('identity mismatch');
});
