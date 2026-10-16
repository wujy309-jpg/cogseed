import { seedStoredAbilityAsset } from '../helpers/stored-ability-asset';
/** 清除级联发生 IO 失败后的可重入性；无故障路径作为对照。 */
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
const UID = 'probe-r5-purge';

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cogseed-probe-r5a-'));
  prevWs = process.env.COGSEED_WORKSPACE_ROOT;
  process.env.COGSEED_WORKSPACE_ROOT = tmpDir;
  vi.resetModules();
});

afterEach(() => {
  try { fs.chmodSync(versionsDir(), 0o755); } catch { /* 目录可能不存在 */ }
  process.env.COGSEED_WORKSPACE_ROOT = prevWs;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function assetFile(id: string): string {
  return path.join(tmpDir, UID, 'cloud', 'recall', 'records', 'ability-assets', `${id}.json`);
}
function versionsDir(): string {
  return path.join(tmpDir, UID, 'cloud', 'recall', 'jsonl', 'ability-asset-versions');
}
function versionsFile(id: string): string {
  return path.join(versionsDir(), `${id}.jsonl`);
}

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

describe('purge 级联中途失败后的可重入性', () => {
  it.skip('级联 IO 失败后墓碑已落盘，重试被拒且版本流正文残留', async () => {
    const assets = await loadAssets();
    await mkAsset('aa-p5a');
    // 追加第二个版本，让版本流里有正文本可被清除
    await assets.updateAbilityAsset(UID, 'aa-p5a', { statement: '版本二正文r5。', reason: 'r', actor: 'user' } as any);
    const stream = versionsFile('aa-p5a');
    expect(fs.existsSync(stream)).toBe(true);
    expect(fs.readFileSync(stream, 'utf8')).toContain('版本二正文r5。');

    // 制造级联失败：版本流目录只读 → fs.rm 抛 EPERM/EACCES（主记录目录不受影响）
    fs.chmodSync(versionsDir(), 0o555);
    await expect(assets.purgeAbilityAsset(UID, 'aa-p5a', ACT)).rejects.toThrow();

    // setStatus 已先行把主记录落成墓碑（正文已从主记录清空）
    const raw = JSON.parse(fs.readFileSync(assetFile('aa-p5a'), 'utf8')) as { status: string; statement: string };
    expect(raw.status).toBe('purged');
    expect(raw.statement).toBe('');

    // 恢复可写后重试：入口终态守卫拒绝（与 store.ts「清除要可重入」注释相悖）
    fs.chmodSync(versionsDir(), 0o755);
    await expect(assets.purgeAbilityAsset(UID, 'aa-p5a', ACT)).rejects.toThrow(/has been purged/);

    // 保留期清扫只扫 status==='deleted'：purged 残留永远不会再被触碰
    const retention = await import('../../src/main/features/recall/asset-retention-service');
    const sweep = await retention.runAbilityAssetRetentionSweep(UID);
    expect(sweep.purged).not.toContain('aa-p5a');
    expect(sweep.failed.map((f) => f.assetId)).not.toContain('aa-p5a');

    // 正文仍残留在版本流里，且无任何产品路径可再清除它
    expect(fs.readFileSync(stream, 'utf8')).toContain('版本二正文r5。');
  });

  it('对照组：无 IO 故障时 purge 正常清空版本流（证明上例残留是失败+不可重试所致）', async () => {
    const assets = await loadAssets();
    await mkAsset('aa-p5a2');
    await assets.deleteAbilityAsset(UID, 'aa-p5a2', ACT);
    await assets.purgeAbilityAsset(UID, 'aa-p5a2', ACT);
    expect(fs.existsSync(versionsFile('aa-p5a2'))).toBe(false);
    expect(await assets.listAbilityAssetVersions(UID, 'aa-p5a2')).toEqual([]);
  });
});
