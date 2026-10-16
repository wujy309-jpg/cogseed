/** 彻底清除后的墓碑语义字段残留；覆盖 causalRule、tags、scope 及来源信息。 */
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
const UID = 'probe-r1-purge';

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cogseed-probe-r1p-'));
  prevWs = process.env.COGSEED_WORKSPACE_ROOT;
  process.env.COGSEED_WORKSPACE_ROOT = tmpDir;
  vi.resetModules();
});

afterEach(() => {
  process.env.COGSEED_WORKSPACE_ROOT = prevWs;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function assetFile(id: string): string {
  return path.join(tmpDir, UID, 'cloud', 'recall', 'records', 'ability-assets', `${id}.json`);
}

async function loadAssets() {
  return import('../../src/main/features/recall/asset-service');
}

async function mkAsset(id: string) {
  const assets = await loadAssets();
  const now = new Date().toISOString();
  return assets.createAbilityAsset(UID, {
    schemaVersion: 2, ownerId: UID, id, candidateId: `cand-${id}`,
    sourceCandidateIds: [`cand-${id}`], reviewDecisionId: `rd_probe${id.slice(-6)}`.padEnd(16, 'x'),
    type: 'personal', title: '演示纪律', statement: `陈述 ${id}。`,
    evidenceRefs: [{ kind: 'conversation', id: `conv-${id}` }], scope: 'general', status: 'active',
    lifecycleStatus: 'user_confirmed_unverified', maturity: 'bud', version: '1',
    createdAt: now, updatedAt: now,
  }, { actor: 'user', reason: 'probe seed' });
}

const ACT = { actor: 'user' as const, reason: 'probe' };

describe('purge 墓碑可识别内容残留', () => {
  it.skip('purge 后 causalRule/tags/scope/learningProvenance 原样留在墓碑上（对照组：title/statement/familyName 已清）', async () => {
    const assets = await loadAssets();
    await mkAsset('aa-purge-residue');

    // 手工把四类可识别内容写上资产（模拟晋升时冻结的因果规则 + 用户打的标签、
    // 手写的 scope、复盘归因明细——都是产品真实写路径会产生的字段）
    const rawPath = assetFile('aa-purge-residue');
    const raw = JSON.parse(fs.readFileSync(rawPath, 'utf8'));
    raw.causalRule = {
      cause: '在客户演示环境执行部署脚本',
      effect: '演示数据被覆盖，客户当场看到内部测试记录',
      mitigation: '演示环境一律先打快照再执行任何写操作',
      severity: 'high',
      deltaR: -0.5,
    };
    raw.tags = ['客户演示', '部署纪律'];
    raw.scope = '适用于所有对外演示环境';
    raw.familyName = '部署族';
    raw.learningProvenance = {
      projectionId: 'proj-1', episodeId: 'ep-1', ruleRefs: [],
      attribution: 'execution_gap',
      actionDelta: { missingTools: [], unexpectedTools: [], missingActors: [], unexpectedActors: [], missingPlanSteps: ['先打快照'], extraActions: [], failedActions: [], orderMismatch: false },
    };
    fs.writeFileSync(rawPath, JSON.stringify(raw));

    // 走真实生命周期：delete → purge（到期清扫同款路径）
    await assets.deleteAbilityAsset(UID, 'aa-purge-residue', ACT);
    const purged = await assets.purgeAbilityAsset(UID, 'aa-purge-residue', ACT);
    expect(purged.status).toBe('purged');

    // 对照组：清单内字段确实清了
    expect(purged.title).toBe('');
    expect(purged.statement).toBe('');
    expect((purged as unknown as Record<string, unknown>).familyName).toBeUndefined();
    expect(purged.evidenceRefs).toEqual([]);

    // 发现主体：四类内容原样留在墓碑上
    const residue = purged as unknown as Record<string, unknown>;
    expect(residue.causalRule).toEqual(raw.causalRule);
    expect(residue.tags).toEqual(['客户演示', '部署纪律']);
    expect(residue.scope).toBe('适用于所有对外演示环境');
    expect(residue.learningProvenance).toBeDefined();

    // 盘上同样残留（不是只在返回值里）
    const onDisk = JSON.parse(fs.readFileSync(rawPath, 'utf8'));
    expect(onDisk.causalRule).toEqual(raw.causalRule);
    expect(onDisk.tags).toEqual(['客户演示', '部署纪律']);
    expect(onDisk.scope).toBe('适用于所有对外演示环境');

    // 墓碑读回口径：asAsset purged 分支原样透传（历史回执读墓碑能看到这些内容）
    const tomb = await assets.readAbilityAsset(UID, 'aa-purge-residue');
    const tombResidue = tomb as unknown as Record<string, unknown>;
    expect(tombResidue.causalRule).toEqual(raw.causalRule);
    expect(tombResidue.tags).toEqual(['客户演示', '部署纪律']);
  });
});
