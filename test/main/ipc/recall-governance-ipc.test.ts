/**
 * 治理待办 IPC 契约（specs/010 T012 / T021 / T024）。
 *
 *   - `cognition.inbox.list`：返回体加法携带 `groups`（组序恒定、与 items 同源，
 *     唯一例外是未分级聚合）；
 *   - `cognition.inbox.resolve`：写路径把乐观版本撞车翻译成稳定码
 *     `version_conflict`（不静默覆盖、不落终态）；
 *   - `recall.assets.sensitivity.batch`：只校验形状 + 转调 features（空数组/
 *     超限/非法 id/非法档位一律拒绝，不返回「成功 0 条」）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as os from 'node:os';
import { trustedIpcSender } from '../../helpers/trusted-ipc-sender';

type InvokeFn = (event: unknown, request: { channel: string; payload?: unknown }) => Promise<{ ok: boolean } & Record<string, unknown>>;
let invokeHandler: InvokeFn | null = null;
const UID = 'uGovernanceIpc';

const inboxMock = vi.hoisted(() => ({
  listCognitionInbox: vi.fn(async () => [] as unknown[]),
  resolveCognitionInboxItem: vi.fn(async () => ({ ok: true, target: 'asset', status: 'classified' })),
  groupCognitionInbox: vi.fn(),
}));

const classificationMock = vi.hoisted(() => ({
  classifyAbilityAssets: vi.fn(async (_uid: string, ids: string[], level: string) => ({
    ok: true, applied: ids.map((assetId) => ({ assetId, level, version: '2' })), failed: [], skipped: [],
  })),
}));

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: InvokeFn) => { if (channel === 'cogseed.invoke') invokeHandler = fn; }, on: vi.fn() },
  shell: { openExternal: vi.fn(async () => undefined), showItemInFolder: vi.fn() },
  BrowserWindow: { getFocusedWindow: vi.fn(() => null), getAllWindows: vi.fn(() => []) },
  dialog: { showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })) },
  app: { getPath: vi.fn(() => os.tmpdir()), isPackaged: false },
}));
vi.mock('../../../src/main/logger', () => ({ createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }), logFromRenderer: vi.fn() }));
vi.mock('../../../src/main/features/cognition', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../src/main/features/cognition')>();
  return { ...original, listCognitionInbox: inboxMock.listCognitionInbox, resolveCognitionInboxItem: inboxMock.resolveCognitionInboxItem };
});
vi.mock('../../../src/main/features/recall/asset-classification-service', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../src/main/features/recall/asset-classification-service')>();
  return { ...original, classifyAbilityAssets: classificationMock.classifyAbilityAssets };
});

beforeEach(async () => {
  process.env.COGSEED_WORKSPACE_ROOT = os.tmpdir();
  invokeHandler = null;
  vi.resetModules();
  vi.clearAllMocks();
  // clearAllMocks 只清调用记录，不清实现——上一条用例的 mockRejectedValue
  // 会漏到下一条，这里显式恢复默认实现。
  inboxMock.listCognitionInbox.mockImplementation(async () => [] as unknown[]);
  inboxMock.resolveCognitionInboxItem.mockImplementation(async () => ({ ok: true, target: 'asset', status: 'classified' }));
  vi.doMock('../../../src/main/ipc/local_agents', () => ({ invokeHandlers: {} }));
  const users = await import('../../../src/main/features/users');
  users.activateUser(UID);
  (await import('../../../src/main/ipc/index')).register();
});
afterEach(() => vi.resetModules());

function call(channel: string, payload: unknown = {}) {
  if (!invokeHandler) throw new Error('missing handler');
  return invokeHandler({ sender: trustedIpcSender() }, { channel, payload });
}

describe('ipc › cognition.inbox.list（groups 加法扩展，specs/010 T012）', () => {
  it('返回体同时带 items/total/groups，缺省不报错', async () => {
    inboxMock.listCognitionInbox.mockResolvedValue([]);
    const res = await call('cognition.inbox.list');
    expect(res.ok).toBe(true);
    expect(res.total).toBe(0);
    expect(res.groups).toEqual([]);
  });

  it('groups 的分区顺序恒定、flatMap 与 items 同源（聚合除外）', async () => {
    const items = [
      { id: 'conflict:c1', kind: 'classification_conflict', urgency: 'confirm', title: 'A' },
      { id: 'sensitivity:aa-1', kind: 'sensitivity_unclassified', urgency: 'confirm', title: 'a1', assetId: 'aa-1' },
      { id: 'sensitivity:aa-2', kind: 'sensitivity_unclassified', urgency: 'confirm', title: 'a2', assetId: 'aa-2' },
      { id: 'candidate:c2', kind: 'candidate_pending_review', urgency: 'low_disturbance', title: 'b' },
    ];
    inboxMock.listCognitionInbox.mockResolvedValue(items);
    const res = await call('cognition.inbox.list');
    expect(res.ok).toBe(true);
    expect(res.total).toBe(4);
    const groups = res.groups as Array<{ category: string; count: number; total: number; items: Array<{ id: string; aggregate?: { assetIds: string[] } }> }>;
    // 组序恒为 conflict → escalation → boundary → unclassified → other（出现的那些）。
    const order = ['conflict', 'escalation', 'boundary', 'unclassified', 'other'];
    const indexes = groups.map((group) => order.indexOf(group.category));
    expect([...indexes].sort((a, b) => a - b)).toEqual(indexes);
    expect(groups[0].category).toBe('conflict');
    // 未分级聚合：count=1、total=2、assetIds 覆盖两条。
    const unclassified = groups.find((group) => group.category === 'unclassified')!;
    expect(unclassified.count).toBe(1);
    expect(unclassified.total).toBe(2);
    expect(unclassified.items[0].aggregate?.assetIds.sort()).toEqual(['aa-1', 'aa-2']);
    // items 与 groups 的关系：聚合外的条目逐一直达。
    const flatIds = groups.flatMap((group) => group.items).flatMap((item) => (item.aggregate ? item.aggregate.assetIds : [item.id]));
    for (const id of items.map((item) => item.id.replace(/^sensitivity:/, ''))) expect(flatIds).toContain(id);
  });
});

describe('ipc › cognition.inbox.resolve（specs/010 T021：版本冲突的稳定码）', () => {
  it('写路径的乐观版本撞车翻译成 version_conflict，不静默覆盖', async () => {
    // 模拟真实适配器的 settle() 产物：错误码挂在 Error 上（inboxResolveError），
    // IPC 包装层负责透出成 { ok:false, code }。
    const conflict = Object.assign(new Error('ability asset version conflict: expected v2, current v3'), { code: 'version_conflict' });
    inboxMock.resolveCognitionInboxItem.mockRejectedValue(conflict);
    await expect(call('cognition.inbox.resolve', { id: 'sensitivity-up:aa-1', action: 'reject' }))
      .resolves.toMatchObject({ ok: false, code: 'version_conflict' });
  });

  it('新参数形状：level 枚举、条件列表 ≤32、targetAssetId 过 safeId、assetIds 去重 ≤200', async () => {
    await expect(call('cognition.inbox.resolve', { id: 'sensitivity:aa-1', action: 'classify', level: 'L9' }))
      .resolves.toMatchObject({ ok: false });
    await expect(call('cognition.inbox.resolve', { id: 'rule-boundary:aa-1', action: 'set_boundary', applicableWhen: Array(33).fill('x') }))
      .resolves.toMatchObject({ ok: false });
    await expect(call('cognition.inbox.resolve', { id: 'inspection:k', action: 'keep', targetAssetId: '../bad' }))
      .resolves.toMatchObject({ ok: false });
    // 超限按**去重后**计（契约口径）：201 个重复 id 去重后合法，201 个不同 id 才拒。
    await expect(call('cognition.inbox.resolve', { id: 'sensitivity-batch:x', action: 'classify', assetIds: Array.from({ length: 201 }, (_, i) => `aa-${i}`) }))
      .resolves.toMatchObject({ ok: false });
    // 合法形态透传（含去重后的名单）。
    await expect(call('cognition.inbox.resolve', {
      id: 'sensitivity-batch:x', action: 'classify', level: 'L1', assetIds: ['aa-1', 'aa-1', 'aa-2'],
    })).resolves.toMatchObject({ ok: true });
    expect(inboxMock.resolveCognitionInboxItem).toHaveBeenCalledWith(UID, expect.objectContaining({ assetIds: ['aa-1', 'aa-2'] }));
  });
});

describe('ipc › recall.assets.sensitivity.batch（specs/010 T024）', () => {
  it('合法入参转调 features 并原样返回逐条结果', async () => {
    const res = await call('recall.assets.sensitivity.batch', { assetIds: ['aa-1', 'aa-2'], level: 'L0' });
    expect(res.ok).toBe(true);
    expect(classificationMock.classifyAbilityAssets).toHaveBeenCalledWith(UID, ['aa-1', 'aa-2'], 'L0', undefined);
    expect((res.applied as unknown[])).toHaveLength(2);
  });

  it('空数组 / 超限 / 非法 id / 非法档位一律拒绝（不返回「成功 0 条」）', async () => {
    for (const payload of [
      { assetIds: [], level: 'L0' },
      { assetIds: Array.from({ length: 201 }, (_, i) => `aa-${i}`), level: 'L0' },
      { assetIds: ['../bad'], level: 'L0' },
      { assetIds: ['aa-1'], level: 'L9' },
      { assetIds: ['aa-1'] },
    ]) {
      await expect(call('recall.assets.sensitivity.batch', payload)).resolves.toMatchObject({ ok: false });
    }
    expect(classificationMock.classifyAbilityAssets).not.toHaveBeenCalled();
  });

  it('入参去重后转调（重复 id 不放大批量）', async () => {
    await call('recall.assets.sensitivity.batch', { assetIds: ['aa-1', 'aa-1', 'aa-2'], level: 'L2' });
    expect(classificationMock.classifyAbilityAssets).toHaveBeenCalledWith(UID, ['aa-1', 'aa-2'], 'L2', undefined);
  });
});
