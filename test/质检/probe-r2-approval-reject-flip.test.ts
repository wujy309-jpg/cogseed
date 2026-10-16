import { createNightlyCandidateFixture } from '../helpers/nightly-formation-fixture';
/** Concurrent approval/rejection must preserve the winning terminal decision.
 * Hold the asset write lock so a queued confirmation overlaps a rejection.
 * The confirmation must return a conflict and compensate any applied content,
 * preserving version history, the rejected proposal and an accurate audit. */
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
const RULE_BOUNDARY = { applicableWhen: ['performing governed work'], forbiddenWhen: ['outside the governed scope'] };

beforeEach(() => {
  vi.resetModules();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cogseed-probe-r2-apr-'));
  previousRoot = process.env.COGSEED_WORKSPACE_ROOT;
  process.env.COGSEED_WORKSPACE_ROOT = tmpDir;
});
afterEach(() => {
  if (previousRoot === undefined) delete process.env.COGSEED_WORKSPACE_ROOT;
  else process.env.COGSEED_WORKSPACE_ROOT = previousRoot;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const UID = 'probe-r2-apr';

async function modules() {
  const [candidates, assets, approval] = await Promise.all([
    import('../../src/main/features/recall/candidate-service'),
    import('../../src/main/features/recall/asset-service'),
    import('../../src/main/features/recall/asset-approval-service'),
  ]);
  return { candidates, assets, approval };
}

async function seedAsset() {
  const { candidates } = await modules();
  const candidate = await createNightlyCandidateFixture(UID, {
    judgment: '发布前必须核对回滚方案。',
    summary: '审批竞态基线样本',
    suggestedType: 'rule', ...RULE_BOUNDARY, suggestedScope: 'architecture',
    sourceRefs: [{ kind: 'execution', id: 'exec-apr-race' }],
  });
  return (await candidates.promoteRecallCandidate(UID, candidate.id, { actor: 'user' })).asset;
}

async function proposeChange(assetId: string, statement: string) {
  const { approval } = await modules();
  return approval.createAssetChangeProposal(UID, {
    assetId,
    baselineVersion: '1',
    fields: ['statement'],
    payload: { statement },
    before: 'statement=旧',
    after: `statement=${statement.length} 字`,
    reason: '探针：并发拒绝翻转',
  });
}

describe('探针 r2 › 审批提议终态预检在锁外：reject 被 confirm 交错翻转', () => {
  it('对照组：串行 reject → confirm 时预检生效，内容不应用、提议保持 rejected', async () => {
    const { assets, approval } = await modules();
    const asset = await seedAsset();
    const proposalId = (await proposeChange(asset.id, '被拒绝的提议内容。')).proposal.id;
    const rejected = await approval.decideAssetChangeProposal(UID, proposalId, 'reject');
    expect(rejected.ok).toBe(true);
    expect(rejected.state).toBe('rejected');
    const late = await approval.decideAssetChangeProposal(UID, proposalId, 'confirm');
    expect(late.ok).toBe(false);
    expect(late.state).toBe('rejected');
    expect((await assets.readAbilityAsset(UID, asset.id)).statement).toBe(asset.statement);
    expect((await assets.readAbilityAsset(UID, asset.id)).version).toBe('1');
  });

  it('confirm 预检后排队期间 reject 落盘 → confirm 失败回执、被拒内容按提议前取值回滚、终态保持 rejected', async () => {
    const { assets, approval } = await modules();
    const asset = await seedAsset();
    const proposalId = (await proposeChange(asset.id, '被拒绝的提议内容。')).proposal.id;
    const { recallJsonRecordPath } = await import('../../src/main/features/recall/paths');
    const { fileEditLock } = await import('../../src/main/util/locks');
    const assetPath = recallJsonRecordPath(UID, 'ability-assets', asset.id);

    // 确定性时序：先持资产文件锁，confirm 的 updateAbilityAsset 在锁上排队
    // （锁外预检已通过，真正的拦截靠锁内 CAS + 补偿回滚）。
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const holder = fileEditLock(assetPath).runExclusive(() => gate);
    await new Promise((r) => setTimeout(r, 5));

    const confirmP = approval.decideAssetChangeProposal(UID, proposalId, 'confirm');
    await new Promise((r) => setTimeout(r, 25));

    // 持锁期间用户在另一张卡/窗口点了拒绝（提议集合是另一把锁，不受 gate 影响）。
    const rejected = await approval.decideAssetChangeProposal(UID, proposalId, 'reject');
    expect(rejected.ok).toBe(true);
    expect(rejected.state).toBe('rejected');

    release();
    await holder;
    const confirmed = await confirmP;

    // 修复后：confirm 如实失败（并发拒绝赢了），不返回 ok:true。
    expect(confirmed.ok).toBe(false);
    expect(confirmed.state).toBe('rejected');
    expect(confirmed.appliedVersion).toBeUndefined();
    // 资产正文被补偿回滚：内容回到提议前的值（版本号会再 bump 一次——
    // v2 是被拒内容的短暂写入，v3 是回滚，补偿≠抹掉版本历史）。
    const after = await assets.readAbilityAsset(UID, asset.id);
    expect(after.statement).toBe(asset.statement);
    expect(after.version).toBe('3');
    // 提议终态保持 rejected（不被 confirmed 覆盖）。
    const final = await approval.readAssetChangeProposal(UID, proposalId);
    expect(final?.state).toBe('rejected');
    // 审计如实：拒绝行在场；确认行记录的是冲突+回滚，不是生效。
    const audit = await assets.listAbilityAssetAudit(UID, asset.id);
    const actions = audit.map((a) => a.action);
    expect(actions).toContain('approval_rejected');
    expect(String(audit.find((a) => a.action === 'approval_confirmed')?.reason)).toContain('回滚');
  });
});
