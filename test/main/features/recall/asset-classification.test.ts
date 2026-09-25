/**
 * 批量敏感级分级（specs/010 T008 / US-305）。
 *
 * 守四条：
 *   ① 逐条写入、逐条版本递增、逐条台账（不静默批量覆盖）；
 *   ② 幂等——已是指定档位的进 skipped[]，不写版本、不记账；
 *   ③ 部分失败不阻断其余，且逐条如实出现在 failed[]；
 *   ④ 失败的条目不计为成功（applied 与 failed 不重叠）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

let tmpDir: string;
let previousRoot: string | undefined;

beforeEach(() => {
  vi.resetModules();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cogseed-classify-'));
  previousRoot = process.env.COGSEED_WORKSPACE_ROOT;
  process.env.COGSEED_WORKSPACE_ROOT = tmpDir;
});
afterEach(() => {
  if (previousRoot === undefined) delete process.env.COGSEED_WORKSPACE_ROOT;
  else process.env.COGSEED_WORKSPACE_ROOT = previousRoot;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const UID = 'u-classify';
const RULE_BOUNDARY = { applicableWhen: ['performing governed work'], forbiddenWhen: ['outside the governed scope'] };

async function modules() {
  const [classification, candidates, assets, store] = await Promise.all([
    import('../../../../src/main/features/recall/asset-classification-service'),
    import('../../../../src/main/features/recall/candidate-service'),
    import('../../../../src/main/features/recall/asset-service'),
    import('../../../../src/main/features/recall/store'),
  ]);
  return { classification, candidates, assets, store };
}

const SAMPLE_JUDGMENTS = [
  '季度评审要提前两周约齐所有评审人并锁定议程。',
  '线上数据导出必须走审批工单并附脱敏说明。',
  '接口变更要先发公告再动实现，两者不得同一天。',
  '新人上手第一周只读不写，第二周起配对操作。',
  '跨团队依赖要在排期前书面确认接口归属。',
];

let seedSeq = 0;
async function seedAsset(uid: string, sensitivity?: string) {
  const { candidates } = await modules();
  seedSeq += 1;
  const candidate = await candidates.saveRecallCandidate(uid, {
    judgment: SAMPLE_JUDGMENTS[seedSeq % SAMPLE_JUDGMENTS.length],
    suggestedType: 'rule', ...RULE_BOUNDARY, suggestedScope: 'architecture',
    ...(sensitivity ? { suggestedSensitivity: sensitivity } : {}),
    sourceRefs: [{ kind: 'execution', id: `exec-classify-${seedSeq}` }],
  });
  return (await candidates.promoteRecallCandidate(uid, candidate.id, { actor: 'user' })).asset;
}

describe('batch classification service (specs/010 T008)', () => {
  it('writes each asset with its own version bump and ledger row', async () => {
    const { classification, assets } = await modules();
    const a1 = await seedAsset(UID);
    const a2 = await seedAsset(UID);
    const before1 = Number((await assets.readAbilityAsset(UID, a1.id)).version);
    const result = await classification.classifyAbilityAssets(UID, [a1.id, a2.id], 'L1');
    expect(result.applied).toHaveLength(2);
    // 逐条版本递增：新版本号逐条可回读。
    for (const entry of result.applied) {
      const asset = await assets.readAbilityAsset(UID, entry.assetId);
      expect(asset.sensitivity).toBe('L1');
      expect(asset.version).toBe(entry.version);
      expect(Number(asset.version)).toBeGreaterThan(entry.assetId === a1.id ? before1 : 1);
    }
    // 台账逐条（每条资产自己的 updated 行 + 用户 actor + 依据；不产生"批量"审计动作）。
    const ledger1 = await fs.promises.readFile(
      path.join(tmpDir, UID, 'cloud', 'recall', 'jsonl', 'ability-asset-audit', `${a1.id}.jsonl`), 'utf8');
    const rows1 = ledger1.trim().split('\n').map((line) => JSON.parse(line));
    const classifyRow = rows1.find((row) => row.action === 'updated'
      && String(row.reason || '').includes('敏感级'));
    expect(classifyRow).toBeTruthy();
    expect(classifyRow.actor).toBe('user');
  });

  it('skips assets already at the target level without writing or recording', async () => {
    const { classification, assets, store } = await modules();
    const a1 = await seedAsset(UID);
    const first = await classification.classifyAbilityAssets(UID, [a1.id], 'L1');
    expect(first.skipped).toEqual([]);
    const versionBefore = (await assets.readAbilityAsset(UID, a1.id)).version;
    const second = await classification.classifyAbilityAssets(UID, [a1.id], 'L1');
    expect(second.applied).toEqual([]);
    expect(second.failed).toEqual([]);
    expect(second.skipped).toEqual([a1.id]);
    // 幂等：重复提交不产生新版本。
    expect((await assets.readAbilityAsset(UID, a1.id)).version).toBe(versionBefore);
  });

  it('reports per-item failures without blocking the rest, and never counts them as applied', async () => {
    const { classification } = await modules();
    const good = await seedAsset(UID);
    const result = await classification.classifyAbilityAssets(UID, [good.id, 'aa-missing', '../bad'], 'L2');
    expect(result.applied.map((entry) => entry.assetId)).toEqual([good.id]);
    expect(result.failed).toHaveLength(2);
    expect(result.failed.map((entry) => entry.assetId)).toEqual(['aa-missing', '../bad']);
    expect(result.skipped).toEqual([]);
    // 失败条目不出现在成功名单里。
    for (const failure of result.failed) {
      expect(result.applied.map((entry) => entry.assetId)).not.toContain(failure.assetId);
    }
  });

  it('rejects invalid levels at the boundary before touching any asset', async () => {
    const { classification } = await modules();
    expect(classification.isSensitivityLevel('L0')).toBe(true);
    expect(classification.isSensitivityLevel('L3')).toBe(false);
    // @ts-expect-error — IPC 层负责形状校验，features 层对畸形值保持拒绝。
    await expect(classification.classifyAbilityAssets(UID, ['aa-1'], 'L9')).rejects.toBeTruthy();
  });
});
