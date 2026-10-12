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
  subscribe: () => () => {},
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
/** 相对 now 的小时数 → ISO。 */
const isoAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();

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

/** 预置一条过去基线的清扫记录（模拟早期安装：基线之前的历史不回扫，
 *  基线之后有更新的会话应当入队）。 */
async function seedSweepBaseline(baselineIso: string) {
  const store = await import('../../../../src/main/features/recall/store');
  await store.updateRecallJsonRecord(USER, 'capture-sweep', 'nightly', () => ({
    schemaVersion: 1,
    ownerId: USER,
    id: 'nightly',
    baselineAt: baselineIso,
    cursors: {},
  } as never));
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

afterEach(async () => {
  const events = await import('../../../../src/main/features/recall/store-events');
  events.setCognitionChangeBroadcaster(null);
  events.resetCognitionChangeStateForTests();
  vi.useRealTimers();
  if (previousRoot === undefined) delete process.env.COGSEED_WORKSPACE_ROOT;
  else process.env.COGSEED_WORKSPACE_ROOT = previousRoot;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function sweepModules() {
  const capture = await import('../../../../src/main/features/recall/capture-service');
  const settings = await import('../../../../src/main/features/recall/capture-settings');
  const stats = await import('../../../../src/main/features/recall/capture-stats');
  await settings.updateRecallCaptureSettings(USER, { executionPolicy: 'nightly' });
  return { capture, settings, stats };
}

async function nightlySettings() {
  const { settings } = await sweepModules();
  return settings.readRecallCaptureSettings(USER);
}

describe('nightly capture sweep (U01)', () => {
  it.each(['completed', 'failed'] as const)('broadcasts running and cleared runtime for a %s sweep', async (outcome) => {
    const { capture, settings } = await sweepModules();
    const policy = await settings.readRecallCaptureSettings(USER);
    const events = await import('../../../../src/main/features/recall/store-events');
    events.resetCognitionChangeStateForTests();
    const runtimeNotices: Array<{ running: boolean; startedAt?: string }> = [];
    events.setCognitionChangeBroadcaster(notice => {
      if (notice.collection === 'capture-sweep') runtimeNotices.push(capture.readRecallNightlySweepRuntime(USER));
    });
    let finishListing!: (rows: Array<Record<string, unknown>>) => void;
    let failListing!: (error: Error) => void;
    mocks.listConversations.mockImplementationOnce(() => new Promise((resolve, reject) => {
      finishListing = resolve;
      failListing = reject;
    }));
    const running = capture.runNightlyCaptureSweep(USER, T0, policy);
    await vi.waitFor(() => expect(runtimeNotices).toHaveLength(1));
    expect(runtimeNotices[0]).toMatchObject({ running: true, startedAt: expect.any(String) });
    if (outcome === 'failed') failListing(new Error('conversation listing unavailable'));
    else finishListing([]);
    const result = await running;
    expect(result).toMatchObject({ ran: true, ...(outcome === 'failed' ? { error: 'conversation listing unavailable' } : { failed: 0 }) });
    await vi.waitFor(() => expect(runtimeNotices.at(-1)).toEqual({ running: false, startedAt: undefined }));
    const sweep = await capture.readRecallNightlySweep(USER);
    expect(sweep?.lastResult).toMatchObject(outcome === 'failed' ? { error: 'conversation listing unavailable' } : { scanned: 0, queued: 0 });
  });

  it('does not backscan conversations updated before the first sweep baseline', async () => {
    const { capture } = await sweepModules();
    // 无预置记录：首轮创建基线=当前时刻，此前任何更新都早于基线 → 跳过。
    mocks.listConversations.mockResolvedValue([
      conversation('conv-old', isoAgo(24 * 7)),
    ]);
    mocks.getMessages.mockResolvedValue(messages(
      { id: 'u1', ts: isoAgo(24 * 7 + 1), role: 'user' },
      { id: 'a1', ts: isoAgo(24 * 7), role: 'assistant' },
    ));
    const result = await capture.runNightlyCaptureSweep(USER, T0, await nightlySettings());
    expect(result.ran).toBe(true);
    if (!result.ran) return;
    expect(result.queued).toBe(0);
    expect(result.skipped).toBe(1);
    const sweep = await capture.readRecallNightlySweep(USER);
    expect(sweep?.cursors['conv-old']).toBeUndefined();
  });

  it('queues an incremental capture for conversations updated after a past baseline and records the cursor', async () => {
    const { capture } = await sweepModules();
    await seedSweepBaseline(isoAgo(24 * 7));
    mocks.listConversations.mockResolvedValue([conversation('conv-x', isoAgo(1))]);
    mocks.getMessages.mockResolvedValue(messages(
      { id: 'u1', ts: isoAgo(1.1), role: 'user' },
      { id: 'a1', ts: isoAgo(1), role: 'assistant' },
    ));
    const first = await capture.runNightlyCaptureSweep(USER, T0, await nightlySettings());
    expect(first.ran).toBe(true);
    if (!first.ran) return;
    expect(first.queued).toBe(1);
    const sweep = await capture.readRecallNightlySweep(USER);
    expect(sweep?.cursors['conv-x']).toMatchObject({ state: 'covered', throughMessageId: 'a1' });
    // 无新消息的下一轮：跳过且不重复建 capture。
    const second = await capture.runNightlyCaptureSweep(USER, '2026-10-09T02:00:00.000Z', await nightlySettings());
    expect(second.ran).toBe(true);
    if (!second.ran) return;
    expect(second.queued).toBe(0);
    expect(second.skipped).toBe(1);
  });

  it('defers active conversations without advancing the cursor', async () => {
    const { capture } = await sweepModules();
    await seedSweepBaseline(isoAgo(24 * 7));
    mocks.listConversations.mockResolvedValue([conversation('conv-active', isoAgo(1))]);
    mocks.getMessages.mockResolvedValue(messages(
      { id: 'u1', ts: isoAgo(1.1), role: 'user' },
      { id: 'a1', ts: isoAgo(1), role: 'assistant' },
    ));
    mocks.isQuiescent.mockReturnValue(false);
    const result = await capture.runNightlyCaptureSweep(USER, T0, await nightlySettings());
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
    const { capture } = await sweepModules();
    await seedSweepBaseline(isoAgo(24 * 7));
    mocks.listConversations.mockResolvedValue([conversation('conv-failed', isoAgo(0.9))]);
    mocks.getMessages.mockResolvedValue(messages(
      { id: 'u1', ts: isoAgo(1.1), role: 'user' },
      { id: 'a1', ts: isoAgo(1), role: 'assistant' },
    ));
    // 第一轮建 capture（scheduled）。
    await capture.runNightlyCaptureSweep(USER, T0, await nightlySettings());
    const sweepAfterFirst = await capture.readRecallNightlySweep(USER);
    expect(sweepAfterFirst?.cursors['conv-failed']).toMatchObject({ state: 'covered' });
    const created = await capture.queryRecallCaptures(USER, { scope: 'all', limit: 10 });
    expect(created.captures.length).toBe(1);
    // 人工把它打成 failed（attempt=1）。
    const store = await import('../../../../src/main/features/recall/store');
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
    await seedSweepBaseline(isoAgo(24 * 7));
    mocks.listConversations.mockResolvedValue([conversation('conv-paused', isoAgo(1))]);
    mocks.getMessages.mockResolvedValue(messages(
      { id: 'u1', ts: isoAgo(1.1), role: 'user' },
      { id: 'a1', ts: isoAgo(1), role: 'assistant' },
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
    await seedSweepBaseline(isoAgo(24 * 7));
    mocks.listConversations.mockResolvedValue([conversation('conv-stats', isoAgo(1))]);
    mocks.getMessages.mockResolvedValue(messages(
      { id: 'u1', ts: isoAgo(1.1), role: 'user' },
      { id: 'a1', ts: isoAgo(1), role: 'assistant' },
    ));
    await capture.runNightlyCaptureSweep(USER, T0, await nightlySettings());
    const totals = await stats.readRecallCaptureStats(USER);
    expect(totals.sweeps).toBe(1);
    expect(totals.conversationsScanned).toBe(1);
    // 递归定位统计文件（存储布局以实现为准），断言只含计数、不含原文。
    const statFile = (() => {
      const found: string[] = [];
      const walk = (dir: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) walk(full);
          else if (entry.name === 'capture-stats.json') found.push(full);
        }
      };
      walk(tmpDir);
      return found[0];
    })();
    expect(statFile).toBeTruthy();
    expect(fs.readFileSync(statFile!, 'utf8')).not.toContain('Message u1');
  });
});
