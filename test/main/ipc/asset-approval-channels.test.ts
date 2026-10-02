import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as os from 'node:os';
import { trustedIpcSender } from '../../helpers/trusted-ipc-sender';

/**
 * recall.assets.approval.* 两通道 IPC 薄层契约测试（P-r3-33 补断层；对照
 * po-channels.test.ts 的同款契约模式）。
 *
 * 覆盖 src/main/ipc/index.ts 的 approval.read / approval.decide 两通道。
 * IPC 只做入参校验转调 features（Constitution II）：
 * ① 通道已注册（不是 unknown channel）；
 * ② payload 塞 uid 不改变转调入参（用户身份只来自 ctx.userId）；
 * ③ 三道校验拒绝非法入参（bad proposalId / 枚举外 decision / 非法 payload）；
 * ④ 合法参数按形状透传（decide 的 payload 选项：undefined 不传键）且回执
 *    键集不增删——尤其服务层 ok:false（versionConflict / 已处置）必须原样
 *    到达渲染层，不得被 IPC 薄层的成功外衣伪装成 ok:true（通道回执 ok 由
 *    decideAssetChangeProposal 自带，IPC 层不硬编码）。
 */

type InvokeFn = (event: unknown, req: { channel: string; payload?: unknown }) => Promise<any>;
let invokeHandler: InvokeFn | null = null;
const TEST_UID = 'uApprovalIpc';
const ATTACKER_UID = 'attacker';

const approvalFeature = {
  readAssetChangeProposal: vi.fn(async () => ({ id: 'ap-x', state: 'pending' })),
  decideAssetChangeProposal: vi.fn(async () => ({ ok: true, state: 'confirmed', appliedVersion: 'v3' })),
};

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: InvokeFn) => { if (channel === 'cogseed.invoke') invokeHandler = fn; }, on: vi.fn() },
  shell: { openExternal: vi.fn(async () => undefined), showItemInFolder: vi.fn() },
  BrowserWindow: { getFocusedWindow: vi.fn(() => null), getAllWindows: vi.fn(() => []) },
  dialog: { showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })) },
  app: { getPath: vi.fn(() => os.tmpdir()), isPackaged: false },
}));
vi.mock('../../../src/main/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  logFromRenderer: vi.fn(),
}));
vi.mock('../../../src/main/features/recall/asset-approval-service', () => approvalFeature);

beforeEach(async () => {
  process.env.COGSEED_WORKSPACE_ROOT = os.tmpdir();
  invokeHandler = null;
  vi.resetModules();
  vi.clearAllMocks();
  vi.doMock('../../../src/main/ipc/local_agents', () => ({ invokeHandlers: {} }));
  const users = await import('../../../src/main/features/users');
  users.activateUser(TEST_UID);
  const ipc = await import('../../../src/main/ipc/index');
  ipc.register();
});

function call(channel: string, payload: unknown = {}) {
  if (!invokeHandler) throw new Error('invoke handler not registered');
  return invokeHandler({ sender: trustedIpcSender() }, { channel, payload });
}

const PID = 'ap-0123456789abcdef01234567';

describe('ipc › recall.assets.approval.* 两通道（薄层契约）', () => {
  it('两通道已注册（不是 unknown channel）', async () => {
    const read = await call('recall.assets.approval.read', { proposalId: PID });
    expect(read.ok).toBe(true);
    const decide = await call('recall.assets.approval.decide', { proposalId: PID, decision: 'confirm' });
    expect(decide.ok).toBe(true);
  });

  it('payload 塞 uid 不改变转调入参：身份只来自 ctx.userId', async () => {
    approvalFeature.readAssetChangeProposal.mockClear();
    approvalFeature.decideAssetChangeProposal.mockClear();
    await call('recall.assets.approval.read', { proposalId: PID, uid: ATTACKER_UID });
    await call('recall.assets.approval.decide', { proposalId: PID, decision: 'reject', uid: ATTACKER_UID });
    for (const fn of [approvalFeature.readAssetChangeProposal, approvalFeature.decideAssetChangeProposal]) {
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn.mock.calls[0][0]).toBe(TEST_UID);
      expect(JSON.stringify(fn.mock.calls[0])).not.toContain(ATTACKER_UID);
    }
  });

  it('三道校验拒绝非法入参（bad proposalId / 枚举外 decision / 非法 payload）', async () => {
    const invalid: Array<{ channel: string; payload: any; errorIncludes?: string }> = [
      { channel: 'recall.assets.approval.read', payload: { proposalId: '' } },
      { channel: 'recall.assets.approval.read', payload: { proposalId: '../evil' } },
      { channel: 'recall.assets.approval.read', payload: { proposalId: 'bad id!' } },
      { channel: 'recall.assets.approval.decide', payload: { proposalId: '../evil', decision: 'confirm' } },
      { channel: 'recall.assets.approval.decide', payload: { proposalId: PID, decision: 'explode' } },
      { channel: 'recall.assets.approval.decide', payload: { proposalId: PID } },
      { channel: 'recall.assets.approval.decide', payload: { proposalId: PID, decision: null } },
      { channel: 'recall.assets.approval.decide', payload: { proposalId: PID, decision: 'confirm', payload: null } },
      { channel: 'recall.assets.approval.decide', payload: { proposalId: PID, decision: 'confirm', payload: ['array'] } },
      { channel: 'recall.assets.approval.decide', payload: { proposalId: PID, decision: 'confirm', payload: 'string' } },
    ];
    for (const c of invalid) {
      const res = await call(c.channel, c.payload);
      expect(res.ok, `${c.channel} ${JSON.stringify(c.payload)}`).toBe(false);
      expect(typeof res.error, `${c.channel} ${JSON.stringify(c.payload)}`).toBe('string');
      expect(res.error.length, `${c.channel} ${JSON.stringify(c.payload)}`).toBeGreaterThan(0);
    }
    // 全部被入口校验拦下：没有一次触达 features。
    expect(approvalFeature.readAssetChangeProposal).toHaveBeenCalledTimes(0);
    expect(approvalFeature.decideAssetChangeProposal).toHaveBeenCalledTimes(0);
  });

  it('read：合法透传（首参 ctx.userId）且回执键集不增删（{ok,proposal}）', async () => {
    const proposal = { id: PID, state: 'pending' };
    approvalFeature.readAssetChangeProposal.mockClear();
    approvalFeature.readAssetChangeProposal.mockResolvedValue(proposal as any);
    const res = await call('recall.assets.approval.read', { proposalId: PID });
    expect(approvalFeature.readAssetChangeProposal).toHaveBeenCalledWith(TEST_UID, PID);
    expect(res).toEqual({ ok: true, proposal });
    expect(Object.keys(res).sort()).toEqual(['ok', 'proposal']);
  });

  it('read：提议不存在 → ok:false 带 error（不返回空壳）', async () => {
    approvalFeature.readAssetChangeProposal.mockClear();
    approvalFeature.readAssetChangeProposal.mockResolvedValue(null);
    const res = await call('recall.assets.approval.read', { proposalId: PID });
    expect(res.ok).toBe(false);
    expect(String(res.error)).toContain('not found');
  });

  it('decide：合法参数透传（payload 未传时不向服务层传 payload 键）且回执键集不增删', async () => {
    approvalFeature.decideAssetChangeProposal.mockClear();
    approvalFeature.decideAssetChangeProposal.mockResolvedValue({ ok: true, state: 'confirmed', appliedVersion: 'v3' });
    const res = await call('recall.assets.approval.decide', { proposalId: PID, decision: 'confirm' });
    expect(approvalFeature.decideAssetChangeProposal).toHaveBeenCalledWith(TEST_UID, PID, 'confirm', {});
    expect(res).toEqual({ ok: true, state: 'confirmed', appliedVersion: 'v3' });
    expect(Object.keys(res).sort()).toEqual(['appliedVersion', 'ok', 'state']);

    approvalFeature.decideAssetChangeProposal.mockClear();
    const edited = { title: '改后标题' };
    await call('recall.assets.approval.decide', { proposalId: PID, decision: 'confirm', payload: edited });
    expect(approvalFeature.decideAssetChangeProposal).toHaveBeenCalledWith(TEST_UID, PID, 'confirm', { payload: edited });
  });

  it('decide：服务层 ok:false（versionConflict / 已处置）原样到达渲染层，不被伪装成成功', async () => {
    // 已处置回执（decideAssetChangeProposal 三分支共用的 alreadyDecided 形状）。
    approvalFeature.decideAssetChangeProposal.mockClear();
    approvalFeature.decideAssetChangeProposal.mockResolvedValue({ ok: false, state: 'rejected', message: '这条提议已经处置过了。' });
    const decided = await call('recall.assets.approval.decide', { proposalId: PID, decision: 'reject' });
    expect(decided.ok).toBe(false);
    expect(decided.state).toBe('rejected');
    expect(Object.keys(decided).sort()).toEqual(['message', 'ok', 'state']);

    // 版本冲突回执（P-r1-74 冲突即作废重提：渲染层靠 versionConflict 键落终态作废）。
    approvalFeature.decideAssetChangeProposal.mockClear();
    approvalFeature.decideAssetChangeProposal.mockResolvedValue({
      ok: false, state: 'pending', versionConflict: { baselineVersion: 'v2', currentVersion: 'v3' },
    });
    const conflict = await call('recall.assets.approval.decide', { proposalId: PID, decision: 'confirm' });
    expect(conflict.ok).toBe(false);
    expect(conflict.versionConflict).toEqual({ baselineVersion: 'v2', currentVersion: 'v3' });
  });
});
