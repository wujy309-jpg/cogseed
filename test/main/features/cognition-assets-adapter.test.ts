import { beforeEach, describe, expect, it, vi } from 'vitest';

// P-r3-1/P-r1-2/P-r1-18（2026-10-01 死代码真删批）改写：
// 原 F-r1-23 回归测的是 enrichAssetCounts 的降级日志（候选池/回执读失败时
// 留 warn 痕）——该函数已随三个零消费计数字段（candidateCount/reuseCount/
// lastReusedAt）整体删除，降级面不复存在。本测试改钉新行为：
// ① 资产列表不再做候选池/回执的每列表关联读（P-r3-1：删的是计算本身，
//   而非修正计算）；
// ② skill 资产不再触发 skill 草稿读盘（原每个 skill 3-7 次读盘、含懒迁移
//   写副作用，服务对象 generatedSkillId/recallSkillDraft* 均零渲染消费）；
// ③ 输出形状不再含已删字段（lifecycleStatus 透传/恒空三字段/计数三件套）。

const { listCognitionCandidates, listCognitionReuseReceipts, readInstalledSkillForAsset, readRecallSkillDraft } = vi.hoisted(() => ({
  listCognitionCandidates: vi.fn(),
  listCognitionReuseReceipts: vi.fn(),
  readInstalledSkillForAsset: vi.fn(),
  readRecallSkillDraft: vi.fn(),
}));

vi.mock('../../../src/main/logger', () => ({
  createLogger: (scope: string) => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../../../src/main/features/cognition/candidates-adapter', () => ({
  listCognitionCandidates,
}));

vi.mock('../../../src/main/features/cognition/receipts-adapter', () => ({
  listCognitionReuseReceipts,
}));

vi.mock('../../../src/main/features/recall/skill-draft-service', () => ({
  readInstalledSkillForAsset,
  readRecallSkillDraft,
}));

vi.mock('../../../src/main/features/recall/formal-assets', () => ({
  // 一条 rule + 一条 skill_method：skill_method 是原读盘副作用的触发面。
  listFormalAssets: vi.fn(async () => [
    { record: {
      id: 'CA-RULE', type: 'rule', title: '回归用规则资产', statement: 'statement',
      version: 1, status: 'active', maturity: 'seed', ownerId: 'uRegress', scope: 'project',
      lifecycleStatus: 'user_confirmed', candidateId: 'cand-rule', evidenceRefs: [],
    } },
    { record: {
      id: 'CA-SKILL', type: 'skill_method', title: '回归用技能资产', statement: 'statement',
      version: 2, status: 'active', maturity: 'seed', ownerId: 'uRegress', scope: 'project',
      lifecycleStatus: 'user_confirmed', candidateId: 'cand-skill', evidenceRefs: [],
    } },
  ]),
}));

beforeEach(() => {
  listCognitionCandidates.mockClear();
  listCognitionReuseReceipts.mockClear();
  readInstalledSkillForAsset.mockClear();
  readRecallSkillDraft.mockClear();
});

describe('cognition assets-adapter 死代码真删后的形状（P-r3-1）', () => {
  it('列表不再做候选池/回执关联读，也不触发 skill 草稿读盘', async () => {
    const { listCognitionAssets } = await import('../../../src/main/features/cognition/assets-adapter');

    const assets = await listCognitionAssets('uRegress');

    expect(assets).toHaveLength(2);
    expect(listCognitionCandidates).not.toHaveBeenCalled();
    expect(listCognitionReuseReceipts).not.toHaveBeenCalled();
    expect(readInstalledSkillForAsset).not.toHaveBeenCalled();
    expect(readRecallSkillDraft).not.toHaveBeenCalled();
  });

  it('输出形状不含已删字段，保留渲染消费的 7 个基础字段面', async () => {
    const { listCognitionAssets } = await import('../../../src/main/features/cognition/assets-adapter');

    const assets = await listCognitionAssets('uRegress');
    const rule = assets.find((asset) => asset.id === 'CA-RULE')!;

    for (const removed of [
      'lifecycleStatus', 'candidateCount', 'reuseCount', 'lastReusedAt',
      'workspaceRefs', 'receiptRefs', 'baselineSkillRef',
      'generatedSkillId', 'recallSkillDraftStatus', 'recallSkillDraftErrorCode', 'recallSkillDraft',
    ]) {
      expect(rule).not.toHaveProperty(removed);
    }
    // 渲染层唯一消费方（conversation-info.js 认知资产段）在用的字段面保持不变。
    expect(rule).toMatchObject({
      id: 'CA-RULE', type: 'rule', category: 'rule', title: '回归用规则资产',
      summary: 'statement', source: 'recall_ability_asset', candidateRefs: ['cand-rule'],
    });
    expect(Array.isArray(rule.relationRefs)).toBe(true);
  });
});
