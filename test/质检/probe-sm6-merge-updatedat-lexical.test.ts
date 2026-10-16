import { seedStoredAbilityAsset } from '../helpers/stored-ability-asset';
/** 非法 updatedAt 对归并新旧内容选择的影响。 */
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
const UID = 'probe-sm6-ux';

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cogseed-probe-sm6b-'));
  prevWs = process.env.COGSEED_WORKSPACE_ROOT;
  process.env.COGSEED_WORKSPACE_ROOT = tmpDir;
  vi.resetModules();
});

afterEach(() => {
  process.env.COGSEED_WORKSPACE_ROOT = prevWs;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function mkAsset(id: string, statement: string) {
  const assets = await import('../../src/main/features/recall/asset-service');
  const now = new Date().toISOString();
  return seedStoredAbilityAsset(UID, {
    schemaVersion: 2, ownerId: UID, id, candidateId: `cand-${id}`,
    sourceCandidateIds: [`cand-${id}`], reviewDecisionId: `rd_prob${id.slice(-6)}`.padEnd(16, 'x'),
    type: 'personal', title: `资产 ${id}`, statement,
    evidenceRefs: [{ kind: 'conversation', id: `conv-${id}` }], scope: 'general', status: 'active',
    lifecycleStatus: 'user_confirmed_unverified', maturity: 'bud', version: '1',
    createdAt: now, updatedAt: now,
  }, { actor: 'user', reason: 'probe seed' });
}

const ACT = { actor: 'user' as const, reason: 'probe' };

describe('merge sourceNewer 字符串比较对乱串 updatedAt 方向判错', () => {
  it.skip('源 updatedAt 非法时，归并将旧源内容覆盖目标在用版', async () => {
    const assets = await import('../../src/main/features/recall/asset-service');
    const { writeRecallJsonRecord, readRecallJsonRecord } = await import('../../src/main/features/recall/store');
    await mkAsset('aa-ux-src1', 'source 的旧正文。');
    await mkAsset('aa-ux-tgt1', 'target 的新正文。');
    // 直改盘：模拟迁移/导入遗留的乱串 updatedAt（asAsset 只查 typeof 放行）。
    const raw = await readRecallJsonRecord(UID, 'ability-assets', 'aa-ux-src1');
    await writeRecallJsonRecord(UID, 'ability-assets', 'aa-ux-src1', { ...raw, updatedAt: 'zzz' } as never);

    await assets.mergeAbilityAssets(UID, 'aa-ux-src1', 'aa-ux-tgt1', ACT);

    const target = await assets.readAbilityAsset(UID, 'aa-ux-tgt1');
    // 'zzz' > '2026-...' 字符串比较判 source 较新 → 旧正文铺上在用版（内容回退）。
    expect(target.statement).toBe('source 的旧正文。');
  });

  it('对照组：正常 ISO 时间戳、source 确实更旧时，merge 不铺 source 正文（方向机制正确）', async () => {
    const assets = await import('../../src/main/features/recall/asset-service');
    await mkAsset('aa-ux-src2', 'source 的旧正文。');
    await mkAsset('aa-ux-tgt2', 'target 的新正文。');
    // source 的 updatedAt 改成确实更早的 ISO 时间。
    const { writeRecallJsonRecord, readRecallJsonRecord } = await import('../../src/main/features/recall/store');
    const raw = await readRecallJsonRecord(UID, 'ability-assets', 'aa-ux-src2');
    await writeRecallJsonRecord(UID, 'ability-assets', 'aa-ux-src2', {
      ...raw, updatedAt: '2020-01-01T00:00:00.000Z',
    } as never);

    await assets.mergeAbilityAssets(UID, 'aa-ux-src2', 'aa-ux-tgt2', ACT);

    const target = await assets.readAbilityAsset(UID, 'aa-ux-tgt2');
    expect(target.statement).toBe('target 的新正文。');
  });
});
