import { createNightlyCandidateFixture } from '../../../helpers/nightly-formation-fixture';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * P-r3-39 回归：decide 通道的「当前版本号」此前只靠正则从
 * updateAbilityAsset 的英文错误文案提取（`/current v(\d+)/`）——措辞一变
 * 就静默提取失败，渲染层拿到「v3 → v」的残缺提示。修复：提取失败时重读
 * 资产真实版本兜底。本文件 mock 掉 updateAbilityAsset 抛一个「措辞漂移后」
 * 的冲突错误（不含 `current vN` 形态），验证兜底重读给出真实版本号。
 */
vi.mock('../../../../src/main/features/recall/asset-service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/main/features/recall/asset-service')>();
  return {
    ...actual,
    updateAbilityAsset: () => Promise.reject(new Error('ability asset version conflict: stale optimistic lock, refresh and retry')),
  };
});

let tmpDir: string;
let previousRoot: string | undefined;
const RULE_BOUNDARY = { applicableWhen: ['performing governed work'], forbiddenWhen: ['outside the governed scope'] };
const UID = 'user-reread';

beforeEach(() => {
  vi.resetModules();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cogseed-approval-reread-'));
  previousRoot = process.env.COGSEED_WORKSPACE_ROOT;
  process.env.COGSEED_WORKSPACE_ROOT = tmpDir;
});
afterEach(() => {
  if (previousRoot === undefined) delete process.env.COGSEED_WORKSPACE_ROOT;
  else process.env.COGSEED_WORKSPACE_ROOT = previousRoot;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('P-r3-39 版本提取失败兜底重读', () => {
  it('正则失配（措辞漂移）时 currentVersion 来自资产记录的真实版本，不是空串', async () => {
    const candidates = await import('../../../../src/main/features/recall/candidate-service');
    const approval = await import('../../../../src/main/features/recall/asset-approval-service');
    const candidate = await createNightlyCandidateFixture(UID, {
      judgment: '发布前必须核对回滚方案。',
      summary: '兜底重读基线',
      suggestedType: 'rule', ...RULE_BOUNDARY, suggestedScope: 'architecture',
      sourceRefs: [{ kind: 'execution', id: 'exec-reread' }],
    });
    const { asset } = await candidates.promoteRecallCandidate(UID, candidate.id, { actor: 'user' });
    const { proposal } = await approval.createAssetChangeProposal(UID, {
      assetId: asset.id,
      baselineVersion: asset.version,
      fields: ['statement'],
      payload: { statement: 'AI 想改成的正文。' },
      before: 'statement=12 字',
      after: 'statement=9 字',
      reason: 'AI 依据：同类任务的实际结果提示这句话该更具体',
    });

    const result = await approval.decideAssetChangeProposal(UID, proposal.id, 'confirm');
    // 冲突即作废路径照常走通（superseded），版本号不再依赖错误文案。
    expect(result.ok).toBe(false);
    expect(result.state).toBe('superseded');
    expect(result.versionConflict).toMatchObject({
      baselineVersion: asset.version,
      currentVersion: asset.version,
    });
    expect(result.versionConflict!.currentVersion).not.toBe('');
  });
});
