import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const mocks = vi.hoisted(() => ({
  listConversations: vi.fn(async () => [] as Array<Record<string, unknown>>),
  getMessages: vi.fn(async () => [] as Array<Record<string, unknown>>),
  getConversation: vi.fn(async () => undefined),
  isQuiescent: vi.fn((): boolean => true),
  scheduleBootBackground: vi.fn(),
}));

vi.mock('../../../../src/main/features/chats', () => ({
  getMessages: mocks.getMessages,
  getConversation: mocks.getConversation,
  listConversations: mocks.listConversations,
}));
vi.mock('../../../../src/main/features/group_chat/bus', () => ({
  isQuiescent: mocks.isQuiescent,
  subscribeTaskTerminals: () => () => {},
}));
vi.mock('../../../../src/main/features/auth', () => ({
  hasConfiguredModel: () => ({ configured: true }),
  getConfiguredModelOAuthExpiredMessage: () => null,
}));
vi.mock('../../../../src/main/util/boot_init', () => ({
  scheduleBootBackground: mocks.scheduleBootBackground,
  registerDeferred: () => {},
}));

let tmpDir: string;
let previousRoot: string | undefined;

const USER = 'sweep-user';
const T0 = '2026-10-08T02:30:00.000Z';

function conversation(cid: string, updatedIso: string) {
  return { conversation_id: cid, title: `Conv ${cid}`, kind: 'normal', updated_at: updatedIso };
}

function messages(...items: Array<{ id: string; ts: string; role: 'user' | 'assistant' }>) {
  return items.map((item) => ({
    id: item.id,
    ts: item.ts,
    from: item.role === 'user' ? 'user' : 'commander',
    to: item.role === 'user' ? ['commander'] : ['user'],
    text: `Message ${item.id}`,
  }));
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cogseed-recall-sweep-'));
  previousRoot = process.env.COGSEED_WORKSPACE_ROOT;
  process.env.COGSEED_WORKSPACE_ROOT = tmpDir;
  mocks.isQuiescent.mockReturnValue(true);
  mocks.scheduleBootBackground.mockImplementation(() => ({
    cancel: vi.fn(),
    promise: new Promise<void>(() => {}),
  }));
});

afterEach(() => {
  vi.useRealTimers();
  if (previousRoot === undefined) delete process.env.COGSEED_WORKSPACE_ROOT;
  else process.env.COGSEED_WORKSPACE_ROOT = previousRoot;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function sweepModules() {
  const capture = await import('../../../../src/main/features/recall/capture-service');
  const settings = await import('../../../../src/main/features/recall/capture-settings');
  const stats = await import('../../../../src/main/features/recall/capture-stats');
  const store = await import('../../../../src/main/features/recall/store');
  await settings.updateRecallCaptureSettings(USER, { executionPolicy: 'nightly' });
  return { capture, settings, stats, store };
}

async function nightlySettings() {
  const { settings } = await sweepModules();
  return settings.readRecallCaptureSettings(USER);
}

describe('nightly capture sweep (U01)', () => {
  it('does not backscan conversations updated before the first sweep baseline', async () => {
    const { capture } = await sweepModules();
    mocks.listConversations.mockResolvedValue([
      conversation('conv-old', '2026-10-01T10:00:00.000Z'),
    ]);
    mocks.getMessages.mockResolvedValue(messages(
      { id: 'u1', ts: '2026-10-01T10:00:00.000Z', role: 'user' },
      { id: 'a1', ts: '2026-10-01T10:01:00.000Z', role: 'assistant' },
    ));
    const result = await capture.runNightlyCaptureSweep(USER, T0, await nightlySettings());
    expect(result.ran).toBe(true);
    if (!result.ran) return;
    expect(result.queued).toBe(0);
    expect(result.skipped).toBe(1);
    const sweep = await capture.readRecallNightlySweep(USER);
    expect(sweep?.cursors['conv-old']).toBeUndefined();
  });

  it('queues an incremental capture for conversations updated after the baseline and records the cursor', async () => {
    const { capture } = await sweepModules();
    mocks.listConversations.mockResolvedValue([
      conversation('conv-old', '2026-10-01T10:00:00.000Z'),
    ]);
    mocks.getMessages.mockResolvedValue(messages(
      { id: 'u1', ts: '2026-10-01T10:00:00.000Z', role: 'user' },
      { id: 'a1', ts: '2026-10-01T10:01:00.000Z', role: 'assistant' },
    ));
    await capture.runNightlyCaptureSweep(USER, T0, await nightlySettings());

    // 基线之后产生新消息：第二次窗口应建增量 capture。
    mocks.listConversations.mockResolvedValue([
      conversation('conv-old', '2026-10-08T02:10:00.000Z'),
    ]);
    mocks.getMessages.mockResolvedValue(messages(
      { id: 'u1', ts: '2026-10-01T10:00:00.000Z', role: 'user' },
      { id: 'a1', ts: '2026-10-01T10:01:00.000Z', role: 'assistant' },
      { id: 'u2', ts: '2026-10-08T02:09:00.000Z', role: 'user' },
      { id: 'a2', ts: '2026-10-08T02:10:00.000Z', role: 'assistant' },
    ));
    const second = await capture.runNightlyCaptureSweep(USER, '2026-10-09T02:00:00.000Z', await nightlySettings());
    expect(second.ran).toBe(true);
    if (!second.ran) return;
    expect(second.queued).toBe(1);
    const sweep = await capture.readRecallNightlySweep(USER);
    expect(sweep?.cursors['conv-old']).toMatchObject({
      state: 'covered',
      throughMessageId: 'a2',
    });
    // 第三次窗口无新消息：跳过且不重复建 capture。
    const third = await capture.runNightlyCaptureSweep(USER, '2026-10-10T02:00:00.000Z', await nightlySettings());
    expect(third.ran).toBe(true);
    if (!third.ran) return;
    expect(third.queued).toBe(0);
    expect(third.skipped).toBe(1);
  });

  it('defers active conversations without advancing the cursor', async () => {
    const { capture } = await sweepModules();
    mocks.listConversations.mockResolvedValue([
      conversation('conv-active', '2026-10-08T02:10:00.000Z'),
    ]);
    mocks.getMessages.mockResolvedValue(messages(
      { id: 'u1', ts: '2026-10-08T02:09:00.000Z', role: 'user' },
      { id: 'a1', ts: '2026-10-08T02:10:00.000Z', role: 'assistant' },
    ));
    // 基线建立：第一轮把会话标记延后。
    await capture.runNightlyCaptureSweep(USER, T0, await nightlySettings());
    mocks.isQuiescent.mockReturnValue(false);
    mocks.listConversations.mockResolvedValue([
      conversation('conv-active', '2026-10-08T03:00:00.000Z'),
    ]);
    const result = await capture.runNightlyCaptureSweep(USER, '2026-10-09T02:00:00.000Z', await nightlySettings());
    expect(result.ran).toBe(true);
    if (!result.ran) return;
    expect(result.deferred).toBe(1);
    expect(result.queued).toBe(0);
    const sweep = await capture.readRecallNightlySweep(USER);
    expect(sweep?.cursors['conv-active']).toMatchObject({ state: 'deferred' });
    // 活跃结束后下一轮补上。
    mocks.isQuiescent.mockReturnValue(true);
    const later = await capture.runNightlyCaptureSweep(USER, '2026-10-10T02:00:00.000Z', await nightlySettings());
    expect(later.ran).toBe(true);
    if (!later.ran) return;
    expect(later.queued).toBe(1);
  });

  it('retries failed automatic captures a bounded number of nights and then stops', async () => {
    const { capture, store } = await sweepModules();
    mocks.listConversations.mockResolvedValue([
      conversation('conv-failed', '2026-10-08T02:10:00.000Z'),
    ]);
    const failedMessages = messages(
      { id: 'u1', ts: '2026-10-08T02:09:00.000Z', role: 'user' },
      { id: 'a1', ts: '2026-10-08T02:10:00.000Z', role: 'assistant' },
    );
    mocks.getMessages.mockResolvedValue(failedMessages);
    // 第一轮建 capture（scheduled）。
    await capture.runNightlyCaptureSweep(USER, T0, await nightlySettings());
    // 人工把它打成 failed（attempt=1）。
    const sweepAfterFirst = await capture.readRecallNightlySweep(USER);
    expect(sweepAfterFirst?.cursors['conv-failed']).toMatchObject({ state: 'covered' });
    const created = await capture.queryRecallCaptures(USER, { scope: 'all', limit: 10 });
    expect(created.captures.length).toBe(1);
    await store.updateRecallJsonRecord(USER, 'captures', created.captures[0].id, (current) => ({
      ...current,
      status: 'failed',
      errorCode: 'model_failed',
    }));
    // 第二夜：失败覆盖最新消息 → 有限重试（attempt 2）。
    const second = await capture.runNightlyCaptureSweep(USER, '2026-10-09T02:00:00.000Z', await nightlySettings());
    expect(second.ran).toBe(true);
    if (second.ran) expect(second.retried).toBe(1);
    const afterRetry = await capture.queryRecallCaptures(USER, { scope: 'all', limit: 10 });
    expect(afterRetry.captures[0]).toMatchObject({ status: 'queued' });
    // 再次失败并耗尽重试上限：不再自动重试，cursor 记 failed。
    await store.updateRecallJsonRecord(USER, 'captures', afterRetry.captures[0].id, (current) => ({
      ...current,
      status: 'failed',
      errorCode: 'model_failed',
      attempt: 3,
    }));
    const third = await capture.runNightlyCaptureSweep(USER, '2026-10-10T02:00:00.000Z', await nightlySettings());
    expect(third.ran).toBe(true);
    if (third.ran) expect(third.retried).toBe(0);
    const sweep = await capture.readRecallNightlySweep(USER);
    expect(sweep?.cursors['conv-failed']).toMatchObject({
      state: 'failed',
      errorCode: 'model_failed',
    });
  });

  it('marks disabled conversation sources as ignored without queuing', async () => {
    const { capture } = await sweepModules();
    const control = await import('../../../../src/main/features/recall/source-control');
    mocks.listConversations.mockResolvedValue([
      conversation('conv-paused', '2026-10-08T02:10:00.000Z'),
    ]);
    mocks.getMessages.mockResolvedValue(messages(
      { id: 'u1', ts: '2026-10-08T02:09:00.000Z', role: 'user' },
      { id: 'a1', ts: '2026-10-08T02:10:00.000Z', role: 'assistant' },
    ));
    // 旧显式暂停不能被默认夜间无声覆盖：来源标记 paused 后清扫跳过。
    await control.pauseCognitionSource(USER, {
      kind: 'conversation',
      id: 'conv-paused',
      subtype: 'session',
      scope: 'conversation',
    });
    const result = await capture.runNightlyCaptureSweep(USER, T0, await nightlySettings());
    expect(result.ran).toBe(true);
    if (!result.ran) return;
    expect(result.queued).toBe(0);
    const sweep = await capture.readRecallNightlySweep(USER);
    expect(sweep?.cursors['conv-paused']).toMatchObject({ state: 'ignored' });
  });

  it('records aggregate stats without leaking message content', async () => {
    const { capture, stats } = await sweepModules();
    mocks.listConversations.mockResolvedValue([
      conversation('conv-stats', '2026-10-08T02:10:00.000Z'),
    ]);
    mocks.getMessages.mockResolvedValue(messages(
      { id: 'u1', ts: '2026-10-08T02:09:00.000Z', role: 'user' },
      { id: 'a1', ts: '2026-10-08T02:10:00.000Z', role: 'assistant' },
    ));
    await capture.runNightlyCaptureSweep(USER, T0, await nightlySettings());
    const totals = await stats.readRecallCaptureStats(USER);
    expect(totals.sweeps).toBe(1);
    expect(totals.conversationsScanned).toBe(1);
    const raw = fs.readFileSync(
      path.join(tmpDir, 'data', USER, 'cloud', 'recall', 'records', 'capture-settings', 'capture-stats.json'),
      'utf8',
    );
    expect(raw).not.toContain('Message u1');
  });
});
