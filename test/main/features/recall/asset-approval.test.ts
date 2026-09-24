/**
 * 审批提议（specs/008 US-406 / T033–T040）。
 *
 * 守四条：
 *   ① 实质变化**零静默发布**：`pending`/`deferred` 期间资产内容与版本分毫不动；
 *   ② 确认时**版本重检**：资产已被改过 → 保持待处理、不静默覆盖；
 *   ③ `defer` 进待确认清单不丢；`reject` 留档且同变更不再重复提交；
 *   ④ 卡片是提议不是锁：有待处理卡片不阻塞资产正常使用。
 *
 * 卡片下发走 `port` 注入（与 KSTAR 复盘卡同款），所以这里用假 port 验载荷，
 * 不必拉起整条 group_chat。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

let tmpDir: string;
let previousRoot: string | undefined;
const RULE_BOUNDARY = { applicableWhen: ['performing governed work'], forbiddenWhen: ['outside the governed scope'] };

beforeEach(() => {
  vi.resetModules();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cogseed-asset-approval-'));
  previousRoot = process.env.COGSEED_WORKSPACE_ROOT;
  process.env.COGSEED_WORKSPACE_ROOT = tmpDir;
});
afterEach(() => {
  if (previousRoot === undefined) delete process.env.COGSEED_WORKSPACE_ROOT;
  else process.env.COGSEED_WORKSPACE_ROOT = previousRoot;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function modules() {
  const [candidates, assets, approval, card, inbox, adapter] = await Promise.all([
    import('../../../../src/main/features/recall/candidate-service'),
    import('../../../../src/main/features/recall/asset-service'),
    import('../../../../src/main/features/recall/asset-approval-service'),
    import('../../../../src/main/features/recall/asset-approval-card'),
    import('../../../../src/main/features/recall/formal-assets/inbox'),
    import('../../../../src/main/features/cognition/inbox-adapter'),
  ]);
  return { candidates, assets, approval, card, inbox, adapter };
}

async function seedAsset(uid: string, judgment = '发布前必须核对回滚方案。') {
  const { candidates } = await modules();
  const candidate = await candidates.saveRecallCandidate(uid, {
    judgment,
    suggestedType: 'rule', ...RULE_BOUNDARY, suggestedScope: 'architecture',
    sourceRefs: [{ kind: 'execution', id: 'exec-approval' }],
  });
  return (await candidates.promoteRecallCandidate(uid, candidate.id, { actor: 'user' })).asset;
}

async function proposeStatementChange(uid: string, assetId: string, baselineVersion: string, statement: string) {
  const { approval } = await modules();
  return approval.createAssetChangeProposal(uid, {
    assetId,
    baselineVersion,
    fields: ['statement'],
    payload: { statement },
    before: 'statement=12 字',
    after: `statement=${statement.length} 字`,
    reason: 'AI 依据：同类任务的实际结果提示这句话该更具体',
  });
}

describe('提议实体与状态机（T033）', () => {
  it('建提议不改资产：pending 期间内容与版本分毫不动，也不阻塞正常使用', async () => {
    const uid = 'user-propose';
    const { assets, approval } = await modules();
    const asset = await seedAsset(uid);
    const { proposal, created } = await proposeStatementChange(uid, asset.id, asset.version, '更具体的正文。');
    expect(created).toBe(true);
    expect(proposal.state).toBe('pending');

    const after = await assets.readAbilityAsset(uid, asset.id);
    expect(after.statement).toBe(asset.statement);
    expect(after.version).toBe(asset.version);
    expect(after.status).toBe('active');
    // 提议不是锁：资产照常可用（还在 active、还在清单里）。
    const listed = await assets.listAbilityAssets(uid);
    expect(listed.some((row) => row.id === asset.id && row.status === 'active')).toBe(true);
    // 提案本身进台账（AI 提出这件事也要留痕）。
    const rows = await assets.listAbilityAssetAudit(uid, asset.id);
    const proposed = rows.find((row) => row.action === 'approval_proposed')!;
    expect(proposed.actor).toBe('ai');
    expect(String(proposed.note)).toContain(proposal.id);
  });

  it('同一变更不重复提交（去重），字段顺序不同也算同一次', async () => {
    const uid = 'user-dedupe';
    const { approval } = await modules();
    const asset = await seedAsset(uid);
    const first = await proposeStatementChange(uid, asset.id, asset.version, '同一个正文。');
    expect(first.created).toBe(true);
    const again = await approval.createAssetChangeProposal(uid, {
      assetId: asset.id,
      baselineVersion: asset.version,
      fields: ['statement'],
      payload: { statement: '同一个正文。' },
      before: 'x', after: 'y', reason: '再来一次',
    });
    expect(again.created).toBe(false);
    expect(again.proposal.id).toBe(first.proposal.id);
  });

  it('字段集不同 = 另一次变更，不去重', async () => {
    const uid = 'user-dedupe-fields';
    const { approval } = await modules();
    const asset = await seedAsset(uid);
    const first = await proposeStatementChange(uid, asset.id, asset.version, '同一个正文。');
    const wider = await approval.createAssetChangeProposal(uid, {
      assetId: asset.id,
      baselineVersion: asset.version,
      fields: ['statement', 'scope'],
      payload: { statement: '同一个正文。', scope: 'review' },
      before: 'x', after: 'y', reason: '连范围一起改',
    });
    expect(wider.created).toBe(true);
    expect(wider.proposal.id).not.toBe(first.proposal.id);
  });
});

describe('三态处置（T036）', () => {
  it('确认更新：按确认内容生效 + 台账两行（AI 提出 / 用户确认）', async () => {
    const uid = 'user-confirm';
    const { assets, approval } = await modules();
    const asset = await seedAsset(uid);
    const { proposal } = await proposeStatementChange(uid, asset.id, asset.version, '确认后生效的正文。');

    const result = await approval.decideAssetChangeProposal(uid, proposal.id, 'confirm');
    expect(result.ok).toBe(true);
    expect(result.state).toBe('confirmed');
    const after = await assets.readAbilityAsset(uid, asset.id);
    expect(after.statement).toBe('确认后生效的正文。');
    expect(after.version).not.toBe(asset.version);

    const rows = await assets.listAbilityAssetAudit(uid, asset.id);
    // 生效那一行 actor=user：是用户点了"确认更新"才落地的，不是 AI 自己动的手。
    const updated = rows.find((row) => row.action === 'updated')!;
    expect(updated.actor).toBe('user');
    expect(String(updated.reason)).toContain(proposal.id);
    expect(rows.some((row) => row.action === 'approval_confirmed' && row.actor === 'user')).toBe(true);
    // AI 的作者身份留在提议那一行。
    expect(rows.find((row) => row.action === 'approval_proposed')!.actor).toBe('ai');
  });

  it('确认时版本重检不一致：保持待处理、不静默覆盖', async () => {
    const uid = 'user-conflict';
    const { assets, approval } = await modules();
    const asset = await seedAsset(uid);
    const { proposal } = await proposeStatementChange(uid, asset.id, asset.version, 'AI 想改成的正文。');
    // 用户（或别处）先改了这条资产。
    await assets.updateAbilityAsset(uid, asset.id, { statement: '用户自己改过的正文。', reason: 'user edit', actor: 'user' });

    const result = await approval.decideAssetChangeProposal(uid, proposal.id, 'confirm');
    expect(result.ok).toBe(false);
    expect(result.state).toBe('pending');
    expect(result.versionConflict).toMatchObject({ baselineVersion: '1' });
    // 资产保持用户改后的内容，AI 的提议没有被套上去。
    expect((await assets.readAbilityAsset(uid, asset.id)).statement).toBe('用户自己改过的正文。');
    expect((await approval.readAssetChangeProposal(uid, proposal.id))!.state).toBe('pending');
    const rows = await assets.listAbilityAssetAudit(uid, asset.id);
    expect(String(rows.find((row) => row.action === 'approval_confirmed' && String(row.reason).includes('未生效'))?.note)).toContain(proposal.id);
  });

  it('稍后处理：进待确认清单，不丢', async () => {
    const uid = 'user-defer';
    const { assets, approval, inbox, adapter } = await modules();
    const asset = await seedAsset(uid);
    const { proposal } = await proposeStatementChange(uid, asset.id, asset.version, '稍后再说。');

    const result = await approval.decideAssetChangeProposal(uid, proposal.id, 'defer');
    expect(result.ok).toBe(true);
    expect(result.state).toBe('deferred');
    // 内容照旧没变。
    expect((await assets.readAbilityAsset(uid, asset.id)).statement).toBe(asset.statement);

    // 纯函数层：待处理/稍后的提议都进清单（"稍后不丢"就靠这条）。
    const items = inbox.buildCognitionInbox({
      assets: [], candidates: [], unavailableSourceIds: new Set(),
      pendingAssetChanges: [{ proposalId: proposal.id, assetId: asset.id, title: asset.title }],
    });
    const entry = items.find((row) => row.kind === 'asset_change_pending')!;
    expect(entry.id).toBe(`proposal:${proposal.id}`);
    expect(entry.urgency).toBe('confirm');
    expect(entry.assetId).toBe(asset.id);

    // 处置通道：清单里的这条能直接确认。
    const resolved = await adapter.resolveCognitionInboxItem(uid, { id: `proposal:${proposal.id}`, action: 'accept' });
    expect(resolved).toMatchObject({ ok: true, target: 'asset_change_proposal', status: 'confirmed' });
    expect((await assets.readAbilityAsset(uid, asset.id)).statement).toBe('稍后再说。');
  });

  it('拒绝：留档 + 同一变更不再重复提交', async () => {
    const uid = 'user-reject';
    const { assets, approval } = await modules();
    const asset = await seedAsset(uid);
    const { proposal } = await proposeStatementChange(uid, asset.id, asset.version, '会被拒的正文。');

    const result = await approval.decideAssetChangeProposal(uid, proposal.id, 'reject');
    expect(result.ok).toBe(true);
    expect(result.state).toBe('rejected');
    expect((await assets.readAbilityAsset(uid, asset.id)).statement).toBe(asset.statement);
    expect((await assets.listAbilityAssetAudit(uid, asset.id)).some((row) => row.action === 'approval_rejected')).toBe(true);

    // 同一变更再来一次：不再生成新卡片。
    const again = await proposeStatementChange(uid, asset.id, asset.version, '会被拒的正文。');
    expect(again.created).toBe(false);
    expect(again.proposal.state).toBe('rejected');
    // 已处置过的提议不能再被处置一次。
    expect((await approval.decideAssetChangeProposal(uid, proposal.id, 'confirm')).ok).toBe(false);
  });

  it('用户编辑卡片内容：按编辑后的内容生效，编辑本身进台账', async () => {
    const uid = 'user-edit-card';
    const { assets, approval } = await modules();
    const asset = await seedAsset(uid);
    const { proposal } = await proposeStatementChange(uid, asset.id, asset.version, 'AI 原来的写法。');

    const edited = await approval.editAssetChangeProposal(uid, proposal.id, { statement: '用户改过的写法。' });
    expect(edited.payload.statement).toBe('用户改过的写法。');
    expect(edited.state).toBe('pending');
    const rowsAfterEdit = await assets.listAbilityAssetAudit(uid, asset.id);
    const editRow = rowsAfterEdit.find((row) => row.action === 'approval_edited')!;
    expect(editRow.actor).toBe('user');
    // 编辑不改资产（还没确认）。
    expect((await assets.readAbilityAsset(uid, asset.id)).statement).toBe(asset.statement);

    await approval.decideAssetChangeProposal(uid, proposal.id, 'confirm');
    expect((await assets.readAbilityAsset(uid, asset.id)).statement).toBe('用户改过的写法。');
  });
});

describe('版本语义对齐 specs/015 US-702（T040）', () => {
  it('确认前 v1 不变；确认后形成 v2，历史引用仍读 v1、新任务读 v2', async () => {
    const uid = 'user-version-semantics';
    const { assets, approval } = await modules();
    const asset = await seedAsset(uid);
    const v1Statement = asset.statement;
    const { proposal } = await proposeStatementChange(uid, asset.id, asset.version, '确认后的第二版正文。');

    // 确认前：v1 不变。
    const beforeConfirm = await assets.readAbilityAsset(uid, asset.id);
    expect(beforeConfirm.version).toBe('1');
    expect(beforeConfirm.statement).toBe(v1Statement);

    await approval.decideAssetChangeProposal(uid, proposal.id, 'confirm');
    const after = await assets.readAbilityAsset(uid, asset.id);
    // 确认后：同一资产形成 v2（内容是新版）。
    expect(after.version).toBe('2');
    expect(after.activeVersion).toBe('2');
    expect(after.statement).toBe('确认后的第二版正文。');
    // 历史引用仍读 v1：已冻结版本的内容快照原样在，没被这次更新改写。
    const v1Snapshot = await assets.readAbilityAssetVersionSnapshot(uid, asset.id, '1');
    expect(v1Snapshot?.statement).toBe(v1Statement);
    // 版本链完整可溯（v1 与 v2 都在）。
    expect((await assets.listAbilityAssetVersions(uid, asset.id)).map((row) => row.version)).toEqual(['1', '2']);
  });

  it('稍后处理与拒绝都保持 v1 不变且提议留档（"保持原版"= 拒绝）', async () => {
    const uid = 'user-keep-v1';
    const { assets, approval } = await modules();
    // 两条基线必须彼此不同：晋升通道有相似度闸门（近重复候选会被正当拦下）。
    const baselines = {
      defer: '把长会议压成三条可执行结论。',
      reject: '导出报表一律带上生成时间戳。',
    } as const;
    for (const decision of ['defer', 'reject'] as const) {
      const asset = await seedAsset(uid, baselines[decision]);
      const { proposal } = await proposeStatementChange(uid, asset.id, asset.version, '不该生效的正文。');
      const result = await approval.decideAssetChangeProposal(uid, proposal.id, decision);
      expect(result.state, decision).toBe(decision === 'defer' ? 'deferred' : 'rejected');
      const after = await assets.readAbilityAsset(uid, asset.id);
      expect(after.version, decision).toBe('1');
      expect(after.statement, decision).toBe(asset.statement);
      // 提议留档（不丢）。
      expect((await approval.readAssetChangeProposal(uid, proposal.id))!.state).toBe(result.state);
    }
  });
});

describe('卡片载荷与下发（T034 / T038）', () => {
  it('载荷形状与契约一致：kind/proposalId/diff/reason/三操作', async () => {
    const uid = 'user-card';
    const { approval, card } = await modules();
    const asset = await seedAsset(uid);
    const { proposal } = await proposeStatementChange(uid, asset.id, asset.version, '卡片载荷。');

    const payload = card.buildAssetChangeApprovalCard(proposal, asset.title);
    expect(payload.kind).toBe('asset_change_approval');
    expect(payload.proposalId).toBe(proposal.id);
    expect(payload.assetId).toBe(asset.id);
    expect(payload.assetTitle).toBe(asset.title);
    expect(payload.baselineVersion).toBe('1');
    expect(payload.diff).toMatchObject({ fields: ['statement'] });
    expect(payload.diff.before).toContain('statement=');
    expect(payload.reason).toContain('同类任务的实际结果');
    // 按钮名与已定口径一致（不用"立即采用"）。
    expect(payload.actions).toEqual(['confirm', 'defer', 'reject']);
  });

  it('下发走注入的 port，文案带资产名与依据', async () => {
    const uid = 'user-card-port';
    const { approval, card } = await modules();
    const asset = await seedAsset(uid);
    const { proposal } = await proposeStatementChange(uid, asset.id, asset.version, '下发测试。');
    const sent: Array<{ cid: string; text: string; kind: string }> = [];
    const posted = await card.postAssetChangeApprovalCard(uid, 'conv-1', proposal, asset.title, {
      send: async (payload) => {
        sent.push({ cid: payload.cid, text: payload.text, kind: payload.asset_change_approval_card.kind });
        return { id: 'msg-1' };
      },
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ cid: 'conv-1', kind: 'asset_change_approval' });
    expect(sent[0].text).toContain(asset.title);
    expect(sent[0].text).toContain('同类任务的实际结果');
    expect(posted.msg.id).toBe('msg-1');
  });

  it('回填卡片消息 id，供回执定位', async () => {
    const uid = 'user-card-attach';
    const { approval } = await modules();
    const asset = await seedAsset(uid);
    const { proposal } = await proposeStatementChange(uid, asset.id, asset.version, '回填测试。');
    await approval.attachAssetChangeProposalCard(uid, proposal.id, 'msg-9');
    expect((await approval.readAssetChangeProposal(uid, proposal.id))!.cardMessageId).toBe('msg-9');
  });
});
