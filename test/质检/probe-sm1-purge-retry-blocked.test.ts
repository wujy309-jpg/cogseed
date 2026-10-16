/** 墓碑已提交但冻结副本未清理时的重试恢复边界。 */
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
const UID = 'probe-sm1-purge';

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cogseed-probe-sm1p-'));
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
  return assets.createAbilityAsset(UID, {
    schemaVersion: 2, ownerId: UID, id, candidateId: `cand-${id}`,
    sourceCandidateIds: [`cand-${id}`], reviewDecisionId: `rd_probe${id.slice(-6)}`.padEnd(16, 'x'),
    type: 'personal', title: `资产 ${id}`, statement: `陈述 ${id}。`,
    evidenceRefs: [{ kind: 'conversation', id: `conv-${id}` }], scope: 'general', status: 'active',
    lifecycleStatus: 'user_confirmed_unverified', maturity: 'bud', version: '1',
    createdAt: now, updatedAt: now,
  }, { actor: 'user', reason: 'probe seed' });
}

const ACT = { actor: 'user' as const, reason: 'probe' };

describe('purge 生命周期断链', () => {
  it.skip('墓碑已落、级联残留未清时：重试 purge 被 assertNotPurged 挡住，投影冻结副本无通道可清', async () => {
    const assets = await loadAssets();
    await mkAsset('aa-sm1');
    await assets.deleteAbilityAsset(UID, 'aa-sm1', ACT);
    // 第一次 purge 正常完成 = setStatus 落墓碑的等价终态。
    const purged = await assets.purgeAbilityAsset(UID, 'aa-sm1', ACT);
    expect(purged.status).toBe('purged');

    // 构造「级联中途失败」的等价残留：一个引用该资产的投影文件，冻结副本里
    // 带正文（对应第一次 purge 的 cascadePurgeAssetReferences 未完成状态）。
    const projDir = path.join(tmpDir, UID, 'cloud', 'recall', 'records', 'projections');
    fs.mkdirSync(projDir, { recursive: true });
    const projPath = path.join(projDir, 'pj-sm1.json');
    fs.writeFileSync(projPath, JSON.stringify({
      schemaVersion: 1, ownerId: UID, id: 'pj-sm1',
      taskRunId: 'tr-sm1', purpose: 'task', assetIds: ['aa-sm1'],
      assetVersions: { 'aa-sm1': '1' },
      assetVersionSnapshots: { 'aa-sm1': { version: '1', snapshot: { statement: '正文残留' } } },
      status: 'confirmed', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }));

    // 重试 purge：在 setStatus 的 assertNotPurged 即被拒——级联段（含
    // clearAssetFromAllProjections）永远执行不到。
    await expect(assets.purgeAbilityAsset(UID, 'aa-sm1', ACT))
      .rejects.toThrow(/has been purged/);

    // 残留原样滞留：没有第二个产品入口能清它。
    const left = JSON.parse(fs.readFileSync(projPath, 'utf8'));
    expect(left.assetVersionSnapshots['aa-sm1'].snapshot.statement).toBe('正文残留');
  });
});
