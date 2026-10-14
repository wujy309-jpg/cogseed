import { seedStoredAbilityAsset } from '../helpers/stored-ability-asset';
/**
 * 探针（本轮红队-越权与状态 · 数据完整性）：ability-asset-audit JSONL 一条坏行
 * 让该资产的审计整流拒绝——除 timeline 断外，更重的是 createAbilityAsset 幂等
 * 重放链（initializeAbilityAsset 读整条 audit 流）被阻断，且主记录已先行落盘，
 * 形成「资产在、初始化永不完成」的半初始化态，无自愈通道。
 *
 * 读码链路：
 *  - listAbilityAssetAudit（asset-service.ts:537-539）走 listRecallJsonlRecords
 *    （recall/store.ts:209-274）——逐行 JSON.parse 失败即整流 throw，无逐条降级；
 *  - initializeAbilityAsset（:546-551）：`const audit = await listAbilityAssetAudit(...)`
 *    ——**读整条流**只为判断是否补 'created' 行；
 *  - createAbilityAsset（:554-609）执行序：主记录 updateRecallJsonRecord 先落盘
 *    （:599-604）→ 再 initializeAbilityAsset（:608）——audit 坏行时 throw 发生在
 *    主记录落盘**之后**；同 id 幂等重放（晋升重试/审批卡重放）每次都走同样的
 *    读流 → 永远 throw；
 *  - 触发面与 P-r1-87（版本流坏行，待议）完全同构：appendJsonlAtomic 是锁内
 *    原子而非崩溃原子（appendFile 直拼），云同步冲突即可撕裂流尾；r2 数据与注入
 *    报告已声明「audit 流与版本流同构」但未立案——本探针补的是**写路径自愈
 *    阻断**这一面（版本流坏行只炸版本功能，audit 坏行连幂等重放/初始化都炸）。
 *
 * 预言：撕裂 audit 尾行 → ①listAbilityAssetAudit rejects（timeline 断）；
 * ②同 id 重放 createAbilityAsset rejects /invalid JSON/，主记录仍在盘上——
 * 资产存在但无法通过重放完成初始化，且无任何产品通道剔除坏行。
 *
 * 收尾状态（2026-10-01 记账员）：对应待议 **P-r4-14（initialize 轻量探测 / listRecallJsonlRecords 逐行降级 / 写侧自愈三案待拍板；与 P-r4-13 同根= r1 P-r1-87 jsonl 坏行族合并拍板）**——
 * 断言漏洞现状的用例 it.skip 注明编号，拍板修复后反转/改写断言启用；
 * 对照组（干净输入/正常序时防线与链路正常）不依赖漏洞，保留 active。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

let tmpDir: string;
let previousRoot: string | undefined;
const UID = 'user-audit-badline-r4';
const ASSET = 'aa-audit-badline';

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cogseed-audit-badline-r4-'));
  previousRoot = process.env.COGSEED_WORKSPACE_ROOT;
  process.env.COGSEED_WORKSPACE_ROOT = tmpDir;
  vi.resetModules();
});

afterEach(() => {
  if (previousRoot === undefined) delete process.env.COGSEED_WORKSPACE_ROOT;
  else process.env.COGSEED_WORKSPACE_ROOT = previousRoot;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function setup() {
  const users = await import('../../src/main/features/users');
  users.activateUser(UID);
  const assets = await import('../../src/main/features/recall/asset-service');
  const { recallJsonRecordPath, recallJsonlPath } = await import('../../src/main/features/recall/paths');
  return { assets, recallJsonRecordPath, recallJsonlPath };
}

function payload(now: string) {
  return {
    schemaVersion: 2,
    ownerId: UID,
    id: ASSET,
    candidateId: `cand-${ASSET}`,
    sourceCandidateIds: [`cand-${ASSET}`],
    reviewDecisionId: `rd_${ASSET.replace(/-/g, '_')}`,
    type: 'rule',
    title: '审计坏行探针资产',
    statement: '发布前核对回滚方案，坏档探针。',
    evidenceRefs: [{ kind: 'conversation', id: `conv-${ASSET}` }],
    scope: 'project',
    status: 'active',
    lifecycleStatus: 'user_confirmed_unverified',
    maturity: 'bud',
    version: '1',
    createdAt: now,
    updatedAt: now,
  } as any;
}

describe('探针 r4 › audit 流坏行：timeline 断 + 幂等重放自愈阻断（半初始化态）', () => {
  it('对照组：好 audit 流下同 id 重放幂等成功，不追加重复 created 行', async () => {
    const { assets } = await setup();
    const now = new Date().toISOString();
    const first = await seedStoredAbilityAsset(UID, payload(now), { actor: 'user', reason: '探针创建' });
    expect(first.id).toBe(ASSET);
    const audit1 = await assets.listAbilityAssetAudit(UID, ASSET);
    expect(audit1.length).toBeGreaterThanOrEqual(1);

    const replay = await assets.createAbilityAsset(UID, payload(now), { actor: 'user', reason: '幂等重放' });
    expect(replay.id).toBe(ASSET);
    const audit2 = await assets.listAbilityAssetAudit(UID, ASSET);
    expect(audit2.length).toBe(audit1.length); // 不重复补 created
  });

  it.skip('【待议 P-r4-14】漏洞：撕裂 audit 尾行后同 id 重放 rejects——主记录在盘、初始化永不完成、timeline 同断', async () => {
    const { assets, recallJsonlPath, recallJsonRecordPath } = await setup();
    const now = new Date().toISOString();
    await seedStoredAbilityAsset(UID, payload(now), { actor: 'user', reason: '探针创建' });

    // 模拟云同步撕裂 audit 流尾（appendFile 直拼无换行的半行——P-r1-87 同构触发面）。
    const auditPath = recallJsonlPath(UID, 'ability-asset-audit', ASSET);
    expect(fs.existsSync(auditPath)).toBe(true);
    fs.appendFileSync(auditPath, '{"schemaVersion":1,"ownerId":"torn', 'utf8');

    // ① timeline 读口：整流拒绝。
    await expect(assets.listAbilityAssetAudit(UID, ASSET)).rejects.toThrow(/invalid JSON/i);

    // ② 幂等重放（晋升重试/审批卡重放语义）：主记录已在前一次落盘，
    //    initializeAbilityAsset 读 audit 流即 throw——重放永远失败。
    //    修复后：重放应成功（audit 读侧逐条降级或 initialize 不再整读）。
    await expect(
      assets.createAbilityAsset(UID, payload(now), { actor: 'user', reason: '幂等重放被坏行阻断' }),
    ).rejects.toThrow(/invalid JSON/i);

    // ③ 半初始化态证据：主记录仍在盘上（第一次创建落的），资产「存在」。
    expect(fs.existsSync(recallJsonRecordPath(UID, 'ability-assets', ASSET))).toBe(true);
  });

  it.skip('【待议 P-r4-13/P-r4-14】同构面：撕裂版本流尾行同样阻断幂等重放（initializeAbilityAsset 另一行整读 versions 流）', async () => {
    const { assets, recallJsonlPath } = await setup();
    const now = new Date().toISOString();
    await seedStoredAbilityAsset(UID, payload(now), { actor: 'user', reason: '探针创建' });

    const versionsPath = recallJsonlPath(UID, 'ability-asset-versions', ASSET);
    expect(fs.existsSync(versionsPath)).toBe(true);
    fs.appendFileSync(versionsPath, '{"schemaVersion":1,"torn', 'utf8');

    // P-r1-87 已covers 版本功能四口 rejects；本用例补的是它未提的一面：
    // initializeAbilityAsset（:547）也整读 versions 流 → 幂等重放同样被阻断。
    await expect(
      assets.createAbilityAsset(UID, payload(now), { actor: 'user', reason: '版本流坏行阻断重放' }),
    ).rejects.toThrow(/invalid JSON/i);
  });
});
