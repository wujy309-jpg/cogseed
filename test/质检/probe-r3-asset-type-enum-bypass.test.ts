import { createNightlyCandidateFixture } from '../helpers/nightly-formation-fixture';
/**
 * 资产更新的 type 枚举边界：写入口必须拒绝五种合法类型以外的值，且拒绝
 * 后磁盘和读回值保持不变。读侧仍允许读取存量值，以便修复已有异常记录。
 *
 * personal 本身是合法类型，枚举校验不能决定从其他类型转为 personal 后
 * 是否具有画像投影资格。最后一个挂起用例保留该独立路径的观察断言；它不是
 * 枚举拒绝用例，也不将画像投影资格的变化算作本测试覆盖的修复。
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
  const candidate = await createNightlyCandidateFixture(UID, {
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

describe('资产 type 枚举校验与 personal 投影资格边界', () => {
  it('对照组：maturity 非法枚举被拒（同域枚举门先例在）', async () => {
    const assets = await import('../../src/main/features/recall/asset-service');
    const asset = await seedRuleAsset();
    await expect(assets.setAbilityAssetMaturity(UID, asset.id, 'hyperdimensional' as never)).rejects.toThrow(/invalid ability asset maturity/);
  });

  it('update 写入任意 type 字符串被写侧五枚举闸拒绝，盘上与读回保持原值', async () => {
    const assets = await import('../../src/main/features/recall/asset-service');
    const asset = await seedRuleAsset();
    // 写侧五枚举闸与 maturity 集合校验一样拒绝非法值。
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

  it.skip('待确认投影资格：改为合法 type=personal 后，画像投影吸收该资产正文', async () => {
    // personal 是合法枚举；本用例保留其投影行为的观察断言，不能用非法值
    // 被拒绝来证明合法类型变更后的投影资格安全。
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
    // writeProfileEntry 不再写 USER.md，但投影记录和 syncAsset 模板字段路由
    // 仍存在。夹具未安装角色模板，因此这里只观察台账是否吸收该资产。
    const hit = records.find((r) => r.assetId === asset.id);
    expect(hit).toBeTruthy();
    expect(hit!.status).not.toBe('failed');
  });
});
