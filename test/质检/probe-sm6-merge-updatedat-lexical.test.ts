import { seedStoredAbilityAsset } from '../helpers/stored-ability-asset';
/**
 * 探针（状态机审计员 · 本轮，sm6）：asAsset 对 updatedAt 只查 typeof 不查
 * Date.parse（对照 deletedAt :197-198 / lastValidatedAt :221 均有格式门），
 * 非 ISO 乱串 updatedAt 的记录是「合法」记录；mergeAbilityAssets :1680 的
 * sourceNewer 用**纯字符串比较**判新旧——乱串记录参与归并时方向判错：
 * 实际更旧的 source 被判「较新」，其旧正文铺上 target 在用版（内容回退，
 * target 用户刚改的新正文被覆盖），activeVersion 指向旧快照。
 *
 * 触发面：正常写入恒 toISOString（统一格式）；乱串只能来自迁移工具/导入/
 * 手改——asAsset 不拦、list 不跳过（非 malformed），merge 照常放行。
 *
 * 手法：建两资产 → 直改 source.updatedAt='zzz'（模拟坏档/导入遗留）→
 * merge(source→target) → 断言 target 在用正文被 source 旧文覆盖（方向判错）。
 * 对照组：两资产均正常 ISO 时间戳、source 确实更旧 → merge 后 target 正文
 * 不变（!sourceNewer 分支），证明方向机制本身正确、坑只在字符串比较。
 *
 * 收尾状态（2026-10-01 记账员）：对应待议 **P-r4-36（merge 改 Date.parse 数值比较+不可解析走保守分支 / asAsset 补格式门 / 组合三案待拍板）**——
 * 断言漏洞现状的用例 it.skip 注明编号，拍板修复后反转/改写断言启用；
 * 对照组（干净输入/正常序时防线与链路正常）不依赖漏洞，保留 active。
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

describe('probe sm6 › merge sourceNewer 字符串比较对乱串 updatedAt 方向判错', () => {
  it.skip('【待议 P-r4-36】主用例：source.updatedAt 为乱串（asAsset 放行）时，更旧的 source 内容铺上 target 在用版', async () => {
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
