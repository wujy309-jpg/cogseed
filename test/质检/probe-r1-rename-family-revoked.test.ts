/** 族重命名对 revoked/deleted 成员的终态保护。 */
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

let tmpDir: string;
let prevWs: string | undefined;
const UID = 'probe-r1-fam';

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cogseed-probe-r1fam-'));
  prevWs = process.env.COGSEED_WORKSPACE_ROOT;
  process.env.COGSEED_WORKSPACE_ROOT = tmpDir;
  vi.resetModules();
});

afterEach(() => {
  process.env.COGSEED_WORKSPACE_ROOT = prevWs;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const ACT = { actor: 'user' as const, reason: 'probe' };

function assetFile(id: string): string {
  return path.join(tmpDir, UID, 'cloud', 'recall', 'records', 'ability-assets', `${id}.json`);
}

async function mkAsset(id: string) {
  const { createAbilityAsset } = await import('../../src/main/features/recall/asset-service');
  const now = new Date().toISOString();
  return createAbilityAsset(UID, {
    schemaVersion: 2, ownerId: UID, id, candidateId: `cand-${id}`,
    sourceCandidateIds: [`cand-${id}`], reviewDecisionId: `rd_probe${id.slice(-6)}`.padEnd(16, 'x'),
    type: 'personal', title: '演示资产', statement: `陈述 ${id}。`,
    evidenceRefs: [{ kind: 'conversation', id: `conv-${id}` }], scope: 'general', status: 'active',
    lifecycleStatus: 'user_confirmed_unverified', maturity: 'bud', version: '1',
    createdAt: now, updatedAt: now,
  }, ACT);
}

/** 手工写 same_family 关系（模拟挂族写入的真实产物形态
 *  asset.relations = [{ kind: 'same_family', assetId }]，family.ts:251 的读法）。 */
function writeRelations(id: string, peerIds: string[], extra: Record<string, unknown> = {}) {
  const file = assetFile(id);
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  raw.relations = peerIds.map((peer) => ({ kind: 'same_family', assetId: peer }));
  Object.assign(raw, extra);
  fs.writeFileSync(file, JSON.stringify(raw));
}

describe('renameAssetFamily 改写 revoked 终态资产', () => {
  it.skip('revoked 成员被连带改 familyName + 刷新 updatedAt（对照组：deleted 成员被跳过）', async () => {
    const assets = await import('../../src/main/features/recall/asset-service');
    const { renameAssetFamily } = await import('../../src/main/features/recall/family');

    // 族一：revoked + active 互指；族二：deleted + active 互指
    await mkAsset('aa-fam-revoked');
    await mkAsset('aa-fam-live');
    await mkAsset('aa-fam-del');
    await mkAsset('aa-fam-del-live');
    const revokedAt = new Date('2026-01-01T00:00:00.000Z').toISOString();
    writeRelations('aa-fam-revoked', ['aa-fam-live'], { updatedAt: revokedAt });
    writeRelations('aa-fam-live', ['aa-fam-revoked']);
    writeRelations('aa-fam-del', ['aa-fam-del-live']);
    writeRelations('aa-fam-del-live', ['aa-fam-del']);

    await assets.revokeAbilityAsset(UID, 'aa-fam-revoked', ACT);
    await assets.deleteAbilityAsset(UID, 'aa-fam-del', ACT);

    // 以 active 资产为锚改族名（正常用户操作：给活资产族改名）
    const renamed = await renameAssetFamily(UID, 'aa-fam-live', '新族名');

    // 发现主体：revoked 终态资产进了改名清单并被改写
    expect(renamed).toContain('aa-fam-revoked');
    const tomb = await assets.readAbilityAsset(UID, 'aa-fam-revoked');
    expect((tomb as unknown as Record<string, unknown>).familyName).toBe('新族名');
    // updatedAt 从固 定旧值被刷新（影响 listAbilityAssets 的 updatedAt 降序排序）
    expect(tomb.updatedAt).not.toBe(revokedAt);

    // 对照组：deleted 成员被 :242 的过滤挡住，未被改写
    const deleted = await assets.readAbilityAsset(UID, 'aa-fam-del');
    expect((deleted as unknown as Record<string, unknown>).familyName).toBeUndefined();

    // 对照组：统一终态守卫在本域的既有口径——单笔通道对 revoked 一律拒绝
    await expect(assets.updateAbilityAsset(UID, 'aa-fam-revoked', {
      statement: '绕过尝试', actor: 'user', reason: 'probe',
    })).rejects.toThrow(/revoked ability asset cannot be changed/);
  });
});
