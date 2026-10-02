/**
 * 探针（本轮红队-数据与注入）：资产版本流（JSONL）一条坏行让该资产的版本管理全灭。
 *
 * 读码链路：
 *  - store.ts listRecallJsonlRecords :240-259 对空行/非法 JSON/校验失败**逐行 throw**
 *    （无逐条降级）；
 *  - asset-service.ts listAbilityAssetVersions :1800-1801 直接消费该函数；同函数的
 *    消费方还有 rollback :1464、select :1535、deleteVersion :1595、merge :1648、
 *    readAbilityAssetVersionSnapshot :1866、initializeAbilityAsset :547——一条坏行
 *    （云同步撕裂的半行/手改）让该资产版本列表、回滚、选版、删版、归并、按号读
 *    快照全部 reject，且产品内无任何「跳过坏行/修复流」通道，坏行永存；
 *  - 口径断层：同域单文件集合 listAbilityAssets（F-r4-1 修）/ listExperiences
 *    （F-r3-1 修）都已「逐条降级、好条目照常列出」，唯独版本流是整流拒绝。
 *
 * 触发链：appendJsonlAtomic 用 appendFile 追加（storage.ts:234，锁内原子但非崩溃
 * 原子），云同步冲突/崩溃可撕裂末行——与前遍 P-r1-8（po JSON 坏档）同一触发面。
 *
 * 收尾状态（2026-10-01 记账员）→ **同日 b6 回滚员回滚**：P-r1-87 读侧逐行
 * 降级曾落地启用本主用例，但坏行跳过把「corrupt 必须传播」变成「当作缺失
 * 证据」，kstar 四件（improvement-admission / improvement-association /
 * run-evidence / task-closure 的 fail-closed 与降级审计契约）相对基线翻红，
 * 读侧已按回滚令恢复整流拒绝（store.test.ts 四例同步恢复 throw 断言）。
 * 本主用例恢复挂起；append 侧 repairTornTail 防拼接保留（对照组不依赖）。
 * 重新落地读侧降级时须先裁决 kstar「证据不可读 ≠ 证据缺失」契约，
 * 断言随读侧一并反转。
 * 断言漏洞现状的用例 it.skip 注明编号，拍板修复后反转/改写断言启用；
 * 对照组（无竞态/无坏档时守卫与正常路径有效）不依赖漏洞，保留 active。
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
const UID = 'probe-r1-vs';

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cogseed-probe-r1vs-'));
  prevWs = process.env.COGSEED_WORKSPACE_ROOT;
  process.env.COGSEED_WORKSPACE_ROOT = tmpDir;
  vi.resetModules();
});

afterEach(() => {
  process.env.COGSEED_WORKSPACE_ROOT = prevWs;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const ACT = { actor: 'user' as const, reason: 'probe' };

async function mkRuleAsset(id: string, statement: string) {
  const { createAbilityAsset } = await import('../../src/main/features/recall/asset-service');
  const now = new Date().toISOString();
  return createAbilityAsset(UID, {
    schemaVersion: 2, ownerId: UID, id, candidateId: `cand-${id}`,
    sourceCandidateIds: [`cand-${id}`], reviewDecisionId: `rd_probe${id.slice(-6)}`.padEnd(16, 'x'),
    type: 'rule', title: '演示纪律', statement,
    evidenceRefs: [{ kind: 'conversation', id: `conv-${id}` }], scope: 'general', status: 'active',
    lifecycleStatus: 'user_confirmed_unverified', maturity: 'bud', version: '1',
    createdAt: now, updatedAt: now,
  }, { reason: 'probe', actor: 'user' });
}

async function mod() {
  const assets = await import('../../src/main/features/recall/asset-service');
  const { recallJsonlPath } = await import('../../src/main/features/recall/paths');
  return { assets, recallJsonlPath };
}

describe('探针 r1 › 版本流坏行：版本管理整流拒绝且无自愈', () => {
  it('对照组：无坏行时版本链/删版/按号读快照全部正常', async () => {
    const { assets, recallJsonlPath } = await mod();
    const a = await mkRuleAsset('aa-vs-ctl', '对照组正文 v1');
    await assets.updateAbilityAsset(UID, a.id, { title: '演示纪律', statement: '对照组正文 v2', ...ACT });
    const versions = await assets.listAbilityAssetVersions(UID, a.id);
    expect(versions.map((v) => v.version)).toEqual(['1', '2']);
    const snap = await assets.readAbilityAssetVersionSnapshot(UID, a.id, '1');
    expect((snap as { statement?: string }).statement).toBe('对照组正文 v1');
    await expect(assets.deleteAbilityAssetVersion(UID, a.id, '1', ACT)).resolves.toBeUndefined();
    expect((await assets.listAbilityAssetVersions(UID, a.id)).map((v) => v.version)).toEqual(['2']);
    expect(recallJsonlPath(UID, 'ability-asset-versions', a.id)).toContain('ability-asset-versions');
  });

  // b6 回滚：P-r1-87 读侧逐行降级已按回滚令恢复整流拒绝（kstar fail-closed
  // 契约冲突，见文件头注），本主用例断言的降级行为暂不成立，恢复挂起。
  it.skip('【待议 P-r1-87（b6 回滚：读侧与 kstar fail-closed 契约冲突）】流尾一条撕裂半行 → 版本管理逐行降级照常可用，新版本不再被坏行吞掉', async () => {
    const { assets, recallJsonlPath } = await mod();
    const victim = await mkRuleAsset('aa-vs-bad', '受害资产正文 v1');
    await assets.updateAbilityAsset(UID, victim.id, { title: '演示纪律', statement: '受害资产正文 v2', ...ACT });
    const bystander = await mkRuleAsset('aa-vs-ok', '旁观资产正文 v1');
    const streamPath = recallJsonlPath(UID, 'ability-asset-versions', victim.id);

    // 模拟云同步撕裂：流尾追加半截 JSON 行（appendFile 非崩溃原子 + 同步冲突即可产生）。
    fs.appendFileSync(streamPath, '{"schemaVersion":1,"ownerId":"' + UID + '","id":"torn');
    const lines = fs.readFileSync(streamPath, 'utf8').trim().split('\n');
    expect(lines.length).toBe(3); // v1 + v2 + 坏行

    // ① 版本列表逐行降级（P-r1-87 修）：坏行只作废它自己，好行照常列出。
    expect((await assets.listAbilityAssetVersions(UID, victim.id)).map((v) => v.version)).toEqual(['1', '2']);
    // ② 按号读快照可用。
    const snap2 = await assets.readAbilityAssetVersionSnapshot(UID, victim.id, '2');
    expect(String((snap2 as { statement?: string }).statement)).toBe('受害资产正文 v2');
    // ③ 回滚可用（回滚到 v1 → 追加 v3 快照）。
    const rolledBack = await assets.rollbackAbilityAsset(UID, victim.id, '1', ACT);
    expect(rolledBack.statement).toBe('受害资产正文 v1');
    expect((await assets.listAbilityAssetVersions(UID, victim.id)).map((v) => v.version)).toEqual(['1', '2', '3']);

    // ④ append 防拼接（P-r1-87 修）：撕裂行没有换行结尾，追加新版本前先补
    //    换行隔离——v3 是独立行，不再被坏行吞掉；撕裂字节原样保留在盘上。
    const raw = fs.readFileSync(streamPath, 'utf8');
    expect(raw).not.toContain('"id":"torn{"schemaVersion"');
    expect(raw).toContain('"id":"torn\n');
    // 内容更新（追加 v4）也走同一防拼接通道。
    await assets.updateAbilityAsset(UID, victim.id, { title: '演示纪律', statement: '受害资产正文 v4', ...ACT });
    expect((await assets.listAbilityAssetVersions(UID, victim.id)).map((v) => v.version)).toEqual(['1', '2', '3', '4']);

    // ⑤ 物理删版仍拒绝：removeJsonlRecords 逐行 parse 坏行即 throw——压缩/
    //    删除是破坏性重写，不能静默丢弃无法解析的未知字节（口径保持严格，
    //    与读侧降级不冲突：读得出≠可安全物理重写）。
    await expect(assets.deleteAbilityAssetVersion(UID, victim.id, '1', ACT)).rejects.toThrow(/not JSON/i);
    expect((await assets.listAbilityAssetVersions(UID, victim.id)).map((v) => v.version)).toEqual(['1', '2', '3', '4']);

    // 影响面按资产隔离：旁观资产版本链正常；受害资产**主记录**读写不受坏行影响。
    expect((await assets.listAbilityAssetVersions(UID, bystander.id)).map((v) => v.version)).toEqual(['1']);
    expect((await assets.readAbilityAsset(UID, victim.id)).statement).toBe('受害资产正文 v4');

    // 盘外手工修复仍可行（撕裂行整体剔除），产品内读侧已不需要它。
    const rawFinal = fs.readFileSync(streamPath, 'utf8');
    const repaired = rawFinal.split('\n').filter((line) => {
      if (!line.trim()) return false;
      try { JSON.parse(line); return true; } catch { return false; }
    }).map((line) => JSON.stringify(JSON.parse(line) as unknown)).join('\n') + '\n';
    fs.writeFileSync(streamPath, repaired);
    expect((await assets.listAbilityAssetVersions(UID, victim.id)).map((v) => v.version)).toEqual(['1', '2', '3', '4']);
  });
});
