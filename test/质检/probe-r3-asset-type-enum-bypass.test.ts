/**
 * 探针（本轮红队-数据与注入，主题：契约对齐/导入接口注入非法结构）：
 * recall.assets.update 通道对 type 字段零枚举校验——AbilityAssetType 五枚举
 * （candidate-service.ts:86 'personal'|'rule'|'template'|'skill_method'|'fact'）
 * 在写侧（updateAbilityAsset :832 直写）与读侧（asAsset :188-198 校验清单无
 * type）双向缺席，非法 type 落盘透传；伪造 type='personal' 可把任意资产正文
 * 送进个人画像投影（每轮 system prompt 的画像块）。
 *
 * 同函数口径分裂铁证：status/maturity 在 asAsset 有集合校验、evidenceRefs/
 * ontologyRefs/scopePolicy/semantics 在 update 有 normalize、reviewDecisionId
 * 有正则——唯独 type 两头都没有。对照先例：F-r2-1（poAddValue ruleKind 零枚举
 * 校验，判 fix）同款病。
 *
 * 危害链（type='personal' 伪造）：
 *  updateAbilityAsset(type:'personal') → reconcilePersonalProfileProjection
 *  （asset-service.ts:657-661 canProject=type==='personal'）→
 *  schedulePersonalProfileSync → isEligiblePersonalAsset
 *  （personal-profile-sync.ts:161-166 只看 type/status/reviewDecisionId/statement）
 *  → syncProfileMemoryAsset :219 仅 L3 凭证扫描、无注入扫描 → statement 进
 *  画像记忆投影集合。
 *
 * 收尾状态（2026-10-01 记账员）：对应待议 **P-r3-12（写侧五枚举闸 / +读侧 asAsset 补枚举 / type 不可变化或投影资格追加条件三档待拍板；personal 合法值链与非法值链根因不同须分别拍板）**——
 * 断言漏洞/分裂现状的用例 it.skip 注明编号，拍板修复后反转/改写断言启用；
 * 对照组（合法路径/既有契约在）不依赖漏洞，保留 active。
 *
 * 执行状态（2026-10-02 批 7）：卡 v2.1 拍板「写侧五枚举闸（最小）+存量巡检」
 * 已落——updateAbilityAsset 入口加 ABILITY_ASSET_TYPES 五枚举闸；存量巡检
 * scripts/audit-asset-type-inventory.mjs 跑过本机数据（2 条记录全部合法）。
 * 非法值用例已反转启用为「闸拒绝」断言；personal 合法值链维持 skip 留档
 * （枚举闸修不掉，卡上明确此局限，待投影资格单独立项）。
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
let previousRoot: string | undefined;
const UID = 'probe-r3-ty';
const RULE_BOUNDARY = { applicableWhen: ['performing governed work'], forbiddenWhen: ['outside the governed scope'] };

beforeEach(() => {
  vi.resetModules();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cogseed-probe-r3ty-'));
  previousRoot = process.env.COGSEED_WORKSPACE_ROOT;
  process.env.COGSEED_WORKSPACE_ROOT = tmpDir;
});
afterEach(() => {
  if (previousRoot === undefined) delete process.env.COGSEED_WORKSPACE_ROOT;
  else process.env.COGSEED_WORKSPACE_ROOT = previousRoot;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const ACT = { actor: 'user' as const, reason: 'probe' };

async function seedRuleAsset() {
  const candidates = await import('../../src/main/features/recall/candidate-service');
  const candidate = await candidates.saveRecallCandidate(UID, {
    judgment: '发布前必须核对回滚方案。',
    summary: 'type 枚举探针基线',
    suggestedType: 'rule', ...RULE_BOUNDARY, suggestedScope: 'architecture',
    sourceRefs: [{ kind: 'execution', id: 'exec-type-probe' }],
  });
  return (await candidates.promoteRecallCandidate(UID, candidate.id, { actor: 'user' })).asset;
}

function profileMemoryDir(): string {
  // 同步拿路径：paths 是纯函数模块，import() 在用例内已加载过，这里用
  // createRequire 避免 ESM 下 require 不存在。
  const { createRequire } = require('node:module') as { createRequire: (id: string) => NodeRequire };
  const req = createRequire(import.meta.url);
  const { recallJsonRecordPath } = req('../../src/main/features/recall/paths');
  return path.dirname(recallJsonRecordPath(UID, 'personal-profile-memory-projections', 'placeholder'));
}

describe('探针 r3 › 资产 type 枚举双向缺席：非法值落盘透传 + personal 伪造进画像', () => {
  it('对照组：maturity 非法枚举被拒（同域枚举门先例在）', async () => {
    const assets = await import('../../src/main/features/recall/asset-service');
    const asset = await seedRuleAsset();
    await expect(assets.setAbilityAssetMaturity(UID, asset.id, 'hyperdimensional' as never)).rejects.toThrow(/invalid ability asset maturity/);
  });

  it('【P-r3-12 已修·启用】update 写入任意 type 字符串被写侧五枚举闸拒绝，盘上与读回保持原值', async () => {
    const assets = await import('../../src/main/features/recall/asset-service');
    const asset = await seedRuleAsset();
    // 写侧五枚举闸（P-r3-12，对照 maturity 集合校验先例）：非法 type 拒绝。
    await expect(assets.updateAbilityAsset(UID, asset.id, { type: 'hyperdimensional' as never, ...ACT }))
      .rejects.toThrow(/invalid ability asset type/);
    // 读侧刻意不补枚举（存量非法值要读得出才可修复）——本条资产 type 未变。
    const reloaded = await assets.readAbilityAsset(UID, asset.id);
    expect(reloaded.type).toBe('rule');
    // 盘上 JSON 原文不受拒绝影响。
    const { recallJsonRecordPath } = await import('../../src/main/features/recall/paths');
    const raw = JSON.parse(fs.readFileSync(recallJsonRecordPath(UID, 'ability-assets', asset.id), 'utf8')) as { type: string };
    expect(raw.type).toBe('rule');
  });

  it.skip('【P-r3-12 留档】伪造 type=personal → 画像投影吸收该资产正文（合法值链，枚举闸修不掉）', async () => {
    // 卡 v2.1 拍板：写侧五枚举闸（最小案）——枚举闸只拦非法值，personal 是
    // 合法值，这条「rule 改 personal 进画像」的链路明确不在本条修法内（改投影
    // 资格/type 不可变化两案被弃）。用例保持漏洞现状断言、留档待投影资格
    // 单独立项后反转。
    const assets = await import('../../src/main/features/recall/asset-service');
    const asset = await seedRuleAsset();
    // update 完成路径内 reconcile → await schedulePersonalProfileSync（:661），
    // 返回即已同步。
    await assets.updateAbilityAsset(UID, asset.id, { type: 'personal', ...ACT });

    const dir = profileMemoryDir();
    expect(fs.existsSync(dir)).toBe(true);
    const files = fs.readdirSync(dir).filter((n) => n.endsWith('.json'));
    expect(files.length).toBeGreaterThan(0);
    const records = files.map((n) => JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8')) as Record<string, unknown>);
    // 投影台账真实吸收了这条被伪造 type 的资产（正文直写 USER.md 的
    // writeProfileEntry 已于 2026-09-22 退役为 no-op，但 isEligiblePersonalAsset
    // 判定、投影记录与模板字段路由线 syncAsset 仍在——正文进角色模板字段值
    // （appendRoleTemplateFieldValue 真实写）是剩余通道，本探针环境未装模板故
    // 只断言台账吸收）。
    const hit = records.find((r) => r.assetId === asset.id);
    expect(hit).toBeTruthy();
    expect(hit!.status).not.toBe('failed');
  });
});
