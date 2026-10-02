/**
 * 探针（状态机审计员 · 本轮，sm6）：purge 墓碑漏清「验证三件套」
 * （validationCount / consecutiveFailures / lastValidatedAt）——P-r1-4（前遍，
 * tags/scope/causalRule/learningProvenance 四字段漏清）之外的同性质新成员。
 *
 * 读码链：
 *  - recordAbilityAssetValidation（asset-service.ts:1970-1971）给活资产写
 *    validationCount/consecutiveFailures/lastValidatedAt（带验证历史的资产常见）；
 *  - purgeAbilityAsset 的 mutate 清单（:1352-1377 共 17 字段）不含三件套；
 *    对照 :1374-1376 清 maturity 的理由「成熟度是对已清除内容的效果声明，
 *    墓碑不该继续声称这条已验证」——validationCount>0 + lastValidatedAt 正是
 *    「已验证 N 次、最近验证于 X」的效果声明，同性质却漏清；
 *  - purged 终态拒一切写入（setStatus :1038 assertNotPurged）→ 残留永不可清除
 *    （与 P-r1-4 的「永不可清除」同款）。
 *
 * 手法：纯顺序链路——建资产 → 记一次成功验证 → delete → purge → 断言墓碑
 * 仍带 validationCount=1 与 lastValidatedAt。对照组断言 maturity 确实被清
 * （既有 17 字段清单生效，缺口恰只有三件套族）。
 *
 * 回归 sm6（收尾改名自 probe-sm6-purge-validation-residue.test.ts · 2026-10-01 记账员）：
 * F-r4-7 已修——purge mutate 清单补清验证三件套（validationCount/consecutiveFailures/
 * lastValidatedAt）。主用例由记账员按修复后口径翻转断言（基线 1 failed 消除）；
 * 修复员正式回归在 test/main/features/recall/asset-lifecycle-redteam.test.ts
 * （maturity 用例扩展覆盖三件套）。
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
const UID = 'probe-sm6-pv';

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cogseed-probe-sm6-'));
  prevWs = process.env.COGSEED_WORKSPACE_ROOT;
  process.env.COGSEED_WORKSPACE_ROOT = tmpDir;
  vi.resetModules();
});

afterEach(() => {
  process.env.COGSEED_WORKSPACE_ROOT = prevWs;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const ACT = { actor: 'user' as const, reason: 'probe' };

describe('回归 sm6 › purge 墓碑清验证三件套（F-r4-7 已修）', () => {
  it('回归：带验证历史的资产 purge 后墓碑不再带 validationCount/lastValidatedAt（效果声明清空）', async () => {
    const assets = await import('../../src/main/features/recall/asset-service');
    const now = new Date().toISOString();
    const id = 'aa-pv-purge01';
    await assets.createAbilityAsset(UID, {
      schemaVersion: 2, ownerId: UID, id, candidateId: `cand-${id}`,
      sourceCandidateIds: [`cand-${id}`], reviewDecisionId: 'rd_probepv00001x',
      type: 'personal', title: '资产 pv', statement: '可验证的陈述。',
      evidenceRefs: [{ kind: 'conversation', id: `conv-${id}` }], scope: 'general', status: 'active',
      lifecycleStatus: 'user_confirmed_unverified', maturity: 'bud', version: '1',
      createdAt: now, updatedAt: now,
    }, ACT);
    await assets.recordAbilityAssetValidation(UID, id, 'success');
    const validated = await assets.readAbilityAsset(UID, id);
    expect(validated.validationCount).toBe(1);
    expect(validated.lastValidatedAt).toBeTruthy();

    await assets.deleteAbilityAsset(UID, id, ACT);
    await assets.purgeAbilityAsset(UID, id, { actor: 'user', reason: 'probe purge' });

    const tomb = await assets.readAbilityAsset(UID, id);
    expect(tomb.status).toBe('purged');
    expect(tomb.title).toBe(''); // 对照：正文确已清
    expect(tomb.maturity).toBeUndefined(); // 对照：maturity 效果声明确已清
    // F-r4-7 修复后：验证三件套与 maturity 同被清——墓碑不替已清除内容背书。
    expect(tomb.validationCount).toBeUndefined();
    expect(tomb.consecutiveFailures).toBeUndefined();
    expect(tomb.lastValidatedAt).toBeUndefined();
    // 终态拒写：任何通道都清不掉它（setStatus 首行 assertNotPurged）。
    await expect(assets.updateAbilityAsset(UID, id, { statement: 'x', reason: 'try', actor: 'user' }))
      .rejects.toThrow(/has been purged/);
  });
});
