import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const mocks = vi.hoisted(() => ({
  configured: true,
  oauthExpired: null as string | null,
  getMessages: vi.fn(),
  getConversation: vi.fn(),
  buildRunner: vi.fn(),
  runModel: vi.fn(),
  saveCandidate: vi.fn(),
  readCandidate: vi.fn(),
  readHandoffReceipt: vi.fn(),
  readAbilityAsset: vi.fn(),
  listAbilityAssets: vi.fn(async () => []),
  promoteCandidate: vi.fn(),
  autoApplyCandidate: vi.fn(),
  prepareSkillDraft: vi.fn(),
  scheduleBootBackground: vi.fn(),
  detectLocalAgents: vi.fn(),
  runCliAgent: vi.fn(),
}));

vi.mock('../../../../src/main/features/auth', () => ({
  listEntriesForUser: async () => ({ entries: [] }),
  hasConfiguredModelForUser: () => ({ configured: mocks.configured }),
  getConfiguredModelOAuthExpiredMessageForUser: () => mocks.oauthExpired,

  hasConfiguredModel: () => ({ configured: mocks.configured }),
  getConfiguredModelOAuthExpiredMessage: () => mocks.oauthExpired,
}));
vi.mock('../../../../src/main/features/chats', () => ({
  getMessages: mocks.getMessages,
  getConversation: mocks.getConversation,
  listConversations: vi.fn(async () => []),
}));
vi.mock('../../../../src/main/model/core-agent/runner', () => ({ buildRunner: mocks.buildRunner }));
vi.mock('../../../../src/main/features/recall/candidate-service', () => ({
  saveRecallCandidate: mocks.saveCandidate,
  readRecallCandidate: mocks.readCandidate,
  readRecallAssetHandoffReceipt: mocks.readHandoffReceipt,
  promoteRecallCandidate: mocks.promoteCandidate,
  autoApplyRecallCandidate: mocks.autoApplyCandidate,
  isAutoCaptureEligible: (candidate: { status?: string }) => (
    candidate.status === 'pending_review' || candidate.status === 'failed'
  ),
}));
vi.mock('../../../../src/main/features/recall/asset-service', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../../src/main/features/recall/asset-service')>(),
  readAbilityAsset: mocks.readAbilityAsset,
  listAbilityAssets: mocks.listAbilityAssets,
}));
vi.mock('../../../../src/main/features/recall/skill-draft-service', () => ({
  prepareRecallSkillDraft: mocks.prepareSkillDraft,
}));
vi.mock('../../../../src/main/features/local_agents/registry', () => ({
  detectAll: mocks.detectLocalAgents,
}));
vi.mock('../../../../src/main/features/local_agents/runner', () => ({
  run: mocks.runCliAgent,
}));
vi.mock('../../../../src/main/util/boot_init', () => ({
  scheduleBootBackground: mocks.scheduleBootBackground,
  // personal_ontology_template_files 顶层调用 registerDeferred 注册模板部署；
  // 本测试不关心该流程，stub 为空实现避免 mock 缺 export 导致模块加载失败。
  registerDeferred: () => {},
}));

let tmpDir: string;
let previousRoot: string | undefined;

const messages = [
  {
    id: 'user-1',
    ts: '2026-08-01T00:01:00.000Z',
    from: 'user',
    to: ['commander'],
    text: 'Always keep decisions traceable.',
    attachments: ['/private/attachment.txt'],
  },
  {
    id: 'dispatch-1',
    ts: '2026-08-01T00:02:00.000Z',
    from: 'commander',
    to: ['worker'],
    text: 'hidden worker instructions',
    dispatch: true,
  },
  {
    id: 'failed-1',
    ts: '2026-08-01T00:03:00.000Z',
    from: 'commander',
    to: ['user'],
    text: 'failed model output',
    failure_kind: 'model',
  },
  {
    id: 'assistant-1',
    ts: '2026-08-01T00:04:00.000Z',
    from: 'commander',
    to: ['user'],
    text: 'The decision log is ready.',
    model_text: 'private internal model text',
    process: [{ type: 'progress', text: 'private tool trace' }],
    artifacts: [{ id: 'artifact-1', title: 'Decision log', agent_id: 'commander' }],
  },
] as any[];

const completedEvent = {
  run_id: 'run-1',
  user_id: 'capture-user',
  conversation_id: 'conv-1',
  status: 'completed' as const,
  started_at_ms: Date.parse('2026-08-01T00:00:00.000Z'),
  finished_at_ms: Date.parse('2026-08-01T00:10:00.000Z'),
};

const reviewableCandidateContract = {
  value: 'Reduces repeated work and keeps later reviews auditable.',
  suggestedAction: 'create' as const,
};

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cogseed-recall-capture-'));
  previousRoot = process.env.COGSEED_WORKSPACE_ROOT;
  process.env.COGSEED_WORKSPACE_ROOT = tmpDir;
  // 本套件显式选择 nightly 策略，不依赖历史默认值。
  const captureSettings = await import('../../../../src/main/features/recall/capture-settings');
  await captureSettings.updateRecallCaptureSettings('capture-user', { executionPolicy: 'nightly' });
  mocks.configured = true;
  mocks.oauthExpired = null;
  mocks.getMessages.mockReset().mockResolvedValue(messages);
  mocks.getConversation.mockResolvedValue({ conversation_id: 'conv-1', title: 'Decision work' });
  mocks.buildRunner.mockResolvedValue({ runner: { run: mocks.runModel } });
  mocks.runModel.mockResolvedValue({
    text: JSON.stringify({ candidates: [] }),
    content: [],
    meta: { aborted: false },
  });
  mocks.saveCandidate.mockReset().mockImplementation(async (_userId: string, input: { captureKey: string }) => ({
    id: `cand-${input.captureKey.slice(-1)}`,
    status: 'pending_review',
    ...input,
  }));
  // mock 消息须与 candidateUnavailableForWorkflow 的候选不可读错误一致。
  mocks.readCandidate.mockRejectedValue(new Error('recall candidate not found'));
  mocks.readHandoffReceipt.mockReset().mockResolvedValue(undefined);
  mocks.readAbilityAsset.mockReset().mockRejectedValue(new Error('recall ability asset not found'));
  mocks.promoteCandidate.mockImplementation(async (_userId: string, candidateId: string) => ({
    candidate: { id: candidateId, status: 'confirmed', promotedAssetId: 'aa-promoted' },
    asset: { id: 'aa-promoted' },
  }));
  mocks.autoApplyCandidate.mockReset().mockImplementation(async (_userId: string, candidateId: string) => ({
    candidate: { id: candidateId, status: 'confirmed', promotedAssetId: 'aa-auto' },
    asset: { id: 'aa-auto', type: 'rule', status: 'active' },
  }));
  mocks.prepareSkillDraft.mockReset().mockResolvedValue({ status: 'draft', assetId: 'aa-promoted' });
  mocks.detectLocalAgents.mockReset().mockResolvedValue([]);
  mocks.runCliAgent.mockReset().mockResolvedValue({ runId: 'recall-cli', status: 'failed' });
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

async function captureModule(reviewPolicy: 'auto' | 'manual' = 'manual') {
  const capture = await import('../../../../src/main/features/recall/capture-service');
  const settings = await import('../../../../src/main/features/recall/capture-settings');
  await settings.updateRecallCaptureSettings('capture-user', { reviewPolicy });
  return capture;
}

/** 有界条件等待：固定 sleep 会让用例结果取决于机器负载。 */
async function waitUntil(probe: () => boolean, what: string, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (probe()) return;
    if (Date.now() >= deadline) throw new Error(`timed out after ${timeoutMs}ms waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** 终态编排器是「读设置闸门 → 决定是否入队」的异步链。等每个终态事件的闸门判定
 *  真正 resolve（含判定后的延续），调用方才能断言入队与否——这既覆盖转发路径，
 *  也覆盖「判定完成但不转发」的负例，不再依赖 20ms 猜测。 */
async function waitForGate(
  spy: { mock: { results: Array<{ type: string; value: unknown }> } },
  expected: number,
): Promise<void> {
  await waitUntil(() => spy.mock.results.length >= expected, `${expected} terminal gate reads`);
  await Promise.all(spy.mock.results.map((result) => (
    result.type === 'return' ? result.value : undefined
  )));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** Historical processed snapshots are fixtures, not new automatic producers. */
async function seedHistoricalCapture(cid = 'conv-1') {
  const store = await import('../../../../src/main/features/recall/store');
  const now = new Date().toISOString();
  return store.updateRecallJsonRecord('capture-user', 'captures', `legacy-${cid}`, () => ({
    schemaVersion: 1, taxonomyVersion: 2, ownerId: 'capture-user', id: `legacy-${cid}`,
    conversationId: cid, terminalRunId: 'historical-run', anchorMessageId: 'user-1',
    messageIds: ['user-1', 'commander-1'], executionPolicy: 'nightly',
    visibility: 'visible', screeningStatus: 'qualified', status: 'queued', attempt: 1,
    candidateIds: [], createdAt: now, updatedAt: now,
  }));
}

describe('Recall conversation capture', () => {

  it('keeps complete visible successful messages without truncating long replies', async () => {
    const capture = await captureModule();
    const selected = capture.selectCaptureMessages([
      ...messages,
      {
        id: 'assistant-large',
        ts: '2026-08-01T00:05:00.000Z',
        from: 'commander',
        to: ['user'],
        text: 'x'.repeat(50_000) + 'LONG_REPLY_END',
      },
    ] as any, completedEvent.started_at_ms, completedEvent.finished_at_ms);

    expect(selected.map((message) => message.id)).toEqual(['user-1', 'assistant-1', 'assistant-large']);
    expect(selected.at(-1)?.text).toBe('x'.repeat(50_000) + 'LONG_REPLY_END');
    expect(JSON.stringify(selected)).not.toContain('hidden worker instructions');
    expect(JSON.stringify(selected)).not.toContain('failed model output');
    expect(JSON.stringify(selected)).not.toContain('private internal model text');
    expect(JSON.stringify(selected)).not.toContain('private tool trace');
    expect(JSON.stringify(selected)).not.toContain('/private/attachment.txt');
  });

  it('retains every message and full text in a long conversation beyond 32 messages', async () => {
    const capture = await captureModule();
    const source = Array.from({ length: 65 }, (_, index) => ({
      id: `long-${index}`, ts: '2026-08-01T00:01:00.000Z',
      from: index === 0 ? 'user' : 'commander', to: ['user'],
      text: `${index}:` + '完整正文'.repeat(2_000) + `:tail-${index}`,
    }));
    const selected = capture.selectCaptureMessages(source as any, completedEvent.started_at_ms, completedEvent.finished_at_ms);
    expect(selected.map(message => message.id)).toEqual(source.map(message => message.id));
    expect(selected.map(message => message.text)).toEqual(source.map(message => message.text));
  });

  it('excludes internal senders while retaining real Agent replies', async () => {
    const capture = await captureModule();
    const selected = capture.selectCaptureMessages([
      { id: 'user-policy', ts: '2026-08-01T00:01:00.000Z', from: 'user', text: 'Keep this decision.' },
      { id: 'system-policy', ts: '2026-08-01T00:02:00.000Z', from: 'system', text: 'internal status' },
      { id: 'tool-policy', ts: '2026-08-01T00:03:00.000Z', from: 'tool', text: 'internal tool output' },
      { id: 'process-policy', ts: '2026-08-01T00:04:00.000Z', from: 'process', text: 'internal process output' },
      { id: 'agent-policy', ts: '2026-08-01T00:05:00.000Z', from: 'research-agent', text: 'The reusable decision is complete.' },
    ] as any, completedEvent.started_at_ms, completedEvent.finished_at_ms);

    expect(selected.map((message) => [message.id, message.role])).toEqual([
      ['user-policy', 'user'],
      ['agent-policy', 'assistant'],
    ]);
  });

  it('keeps second-precision messages when the terminal run starts later in the same second', async () => {
    const capture = await captureModule();
    const selected = capture.selectCaptureMessages([
      {
        id: 'user-second-precision',
        ts: '2026-08-06T17:27:47',
        from: 'user',
        to: ['commander'],
        text: 'Start this task.',
      },
      {
        id: 'assistant-second-precision',
        ts: '2026-08-06T17:27:48',
        from: 'commander',
        to: ['user'],
        text: 'The task is complete.',
      },
    ] as any, Date.parse('2026-08-06T17:27:47.519'), Date.parse('2026-08-06T17:27:48.900'));

    expect(selected.map((message) => message.id)).toEqual([
      'user-second-precision',
      'assistant-second-precision',
    ]);
  });

  it('uses terminal message ids to exclude adjacent runs in the same second', async () => {
    const capture = await captureModule();
    const selected = capture.selectCaptureMessages([
      {
        id: 'previous-user',
        ts: '2026-08-06T17:27:47',
        from: 'user',
        to: ['commander'],
        text: 'Previous task.',
      },
      {
        id: 'current-user',
        ts: '2026-08-06T17:27:47',
        from: 'user',
        to: ['commander'],
        text: 'Current task.',
      },
      {
        id: 'current-assistant',
        ts: '2026-08-06T17:27:48',
        from: 'commander',
        to: ['user'],
        text: 'Current task complete.',
      },
      {
        id: 'next-user',
        ts: '2026-08-06T17:27:48',
        from: 'user',
        to: ['commander'],
        text: 'Next task.',
      },
    ] as any,
    Date.parse('2026-08-06T17:27:47.519'),
    Date.parse('2026-08-06T17:27:48.900'),
    'current-user',
    'current-assistant');

    expect(selected.map((message) => message.id)).toEqual([
      'current-user',
      'current-assistant',
    ]);
  });

  it('derives completed workflow state from terminal candidates without rewriting the capture', async () => {
    const capture = await captureModule();
    const queued = await seedHistoricalCapture();
    const store = await import('../../../../src/main/features/recall/store');
    await store.updateRecallJsonRecord('capture-user', 'captures', queued!.id, (current) => ({
      ...current!,
      status: 'review_ready',
      visibility: 'visible',
      screeningStatus: 'qualified',
      stage: 'candidate_save',
      candidateIds: ['cand-promoted', 'cand-rejected'],
    }));
    mocks.readCandidate.mockImplementation(async (_userId: string, candidateId: string) => (
      candidateId === 'cand-promoted'
        ? {
            id: candidateId,
            status: 'confirmed',
            promotedAssetId: 'aa-promoted',
            reviewDecisionId: 'rd_promoted0000000000000000',
          }
        : { id: candidateId, status: 'rejected' }
    ));
    mocks.readAbilityAsset.mockResolvedValue({
      id: 'aa-promoted',
      candidateId: 'cand-promoted',
      reviewDecisionId: 'rd_laterupdate0000000000000',
      type: 'rule',
      version: '2',
      scope: 'workspace-current',
      evidenceRefs: [{ kind: 'conversation', id: 'conv-later' }],
    });
    mocks.readHandoffReceipt.mockResolvedValue({
      assetId: 'aa-promoted',
      assetType: 'rule',
      version: '1',
      lifecycleStatus: 'user_confirmed_unverified',
      scope: 'project',
      sourceRefs: [{ kind: 'conversation', id: 'conv-1' }, { kind: 'artifact_file', id: 'artifact-1' }],
      reviewDecisionId: 'rd_promoted0000000000000000',
    });
    const paths = await import('../../../../src/main/features/recall/paths');
    const storedPath = paths.recallJsonRecordPath('capture-user', 'captures', queued!.id);
    const beforeRead = fs.readFileSync(storedPath, 'utf8');

    const completedPage = await capture.queryRecallCaptures('capture-user', { statuses: ['completed'] });
    const reviewPage = await capture.queryRecallCaptures('capture-user', { statuses: ['review_ready'] });
    const detail = await capture.readRecallCaptureWorkflow('capture-user', queued!.id);

    expect(completedPage.captures).toHaveLength(1);
    expect(completedPage.captures[0]).toMatchObject({
      status: 'review_ready',
      workflowStatus: 'completed',
      displayStatus: 'completed',
      displayReason: 'review_completed',
      reviewSummary: { total: 2, pending: 0, deferred: 0, promoted: 1, rejected: 1, missing: 0 },
      linkedAssetIds: ['aa-promoted'],
      confirmedAssetReceipts: [{
        assetId: 'aa-promoted',
        assetType: 'rule',
        version: '1',
        scope: 'project',
        sourceRefCount: 2,
        reviewDecisionId: 'rd_promoted0000000000000000',
      }],
      nextAction: 'view_assets',
      actions: expect.arrayContaining(['view_assets', 'open_conversation']),
    });
    expect(completedPage.captures[0].stage).toBeUndefined();
    expect(completedPage.counts).toMatchObject({ completed: 1, review: 0 });
    expect(reviewPage.captures).toHaveLength(0);
    expect(detail.workflowStatus).toBe('completed');
    await expect(capture.readRecallCapture('capture-user', queued!.id)).resolves.toMatchObject({
      status: 'review_ready',
      stage: undefined,
    });
    expect(fs.readFileSync(storedPath, 'utf8')).toBe(beforeRead);
  });

  it('keeps a confirmed candidate history diagnosable when its formal asset is unavailable', async () => {
    const capture = await captureModule();
    const queued = await seedHistoricalCapture();
    const store = await import('../../../../src/main/features/recall/store');
    await store.updateRecallJsonRecord('capture-user', 'captures', queued!.id, (current) => ({
      ...current!,
      status: 'review_ready',
      visibility: 'visible',
      screeningStatus: 'qualified',
      candidateIds: ['cand-missing-asset'],
    }));
    mocks.readCandidate.mockResolvedValue({
      id: 'cand-missing-asset',
      status: 'confirmed',
      promotedAssetId: 'aa-missing',
      reviewDecisionId: 'rd_missingasset000000000000',
    });
    mocks.readAbilityAsset.mockRejectedValue(new Error('recall ability asset not found'));

    await expect(capture.readRecallCaptureWorkflow('capture-user', queued!.id)).resolves.toMatchObject({
      workflowStatus: 'failed',
      reviewSummary: { total: 1, promoted: 0, missing: 1 },
      linkedAssetIds: [],
      confirmedAssetReceipts: [],
      nextAction: 'none',
    });
  });

  it('inlines candidate outcomes into the workflow record for detail rendering', async () => {
    // 渲染层候选队列（review-queue 视图）只含最近 5 条
    // 处理记录，旧任务详情按 candidateIds join 队列全落空 →「整理结果」误报
    // 空态。summarize 全量读池后必须把候选投影内联进 workflow 记录（与
    // confirmedAssetReceipts 同先例），列表与单条读口都要带。
    const capture = await captureModule();
    const queued = await seedHistoricalCapture();
    const store = await import('../../../../src/main/features/recall/store');
    await store.updateRecallJsonRecord('capture-user', 'captures', queued!.id, (current) => ({
      ...current!,
      status: 'review_ready',
      visibility: 'visible',
      screeningStatus: 'qualified',
      candidateIds: ['cand-old-rejected'],
    }));
    mocks.readCandidate.mockResolvedValue({
      id: 'cand-old-rejected',
      status: 'rejected',
      summary: '旧任务的被拒候选',
      judgment: '队列窗口外的判断全文。',
      suggestedType: 'rule',
      suggestedScope: 'general',
      sourceRefs: [],
      evidenceRefs: [{ kind: 'conversation', id: 'conv-1' }],
    });
    const expectedOutcome = {
      id: 'cand-old-rejected',
      status: 'rejected',
      summary: '旧任务的被拒候选',
      judgment: '队列窗口外的判断全文。',
      suggestedType: 'rule',
      suggestedScope: 'general',
      sourceRefs: [],
      evidenceRefs: [{ kind: 'conversation', id: 'conv-1' }],
      capabilities: expect.any(Object),
    };
    // 单条读口（整理详情页数据源）。
    await expect(capture.readRecallCaptureWorkflow('capture-user', queued!.id)).resolves.toMatchObject({
      candidateOutcomes: [expectedOutcome],
    });
    // 列表读口（详情页从列表行取记录，两路同源）。派生 workflowStatus=
    // completed（唯一候选已拒），按派生态过滤取回。
    const page = await capture.queryRecallCaptures('capture-user', { statuses: ['completed'] });
    expect(page.captures[0]).toMatchObject({ candidateOutcomes: [expectedOutcome] });
    // 读不到的候选（missing）不进投影，由 reviewSummary.missing 如实计数。
    mocks.readCandidate.mockResolvedValue(undefined);
    await expect(capture.readRecallCaptureWorkflow('capture-user', queued!.id)).resolves.toMatchObject({
      candidateOutcomes: [],
      reviewSummary: expect.objectContaining({ missing: 1 }),
    });
  });

  it('keeps a confirmed candidate history diagnosable when its immutable handoff receipt is unavailable', async () => {
    const capture = await captureModule();
    const queued = await seedHistoricalCapture();
    const store = await import('../../../../src/main/features/recall/store');
    await store.updateRecallJsonRecord('capture-user', 'captures', queued!.id, (current) => ({
      ...current!,
      status: 'review_ready',
      visibility: 'visible',
      screeningStatus: 'qualified',
      candidateIds: ['cand-missing-receipt'],
    }));
    mocks.readCandidate.mockResolvedValue({
      id: 'cand-missing-receipt',
      status: 'confirmed',
      promotedAssetId: 'aa-without-receipt',
      reviewDecisionId: 'rd_missingreceipt0000000000',
    });
    mocks.readAbilityAsset.mockResolvedValue({
      id: 'aa-without-receipt',
      candidateId: 'cand-missing-receipt',
      type: 'rule',
    });
    mocks.readHandoffReceipt.mockResolvedValue(undefined);

    await expect(capture.readRecallCaptureWorkflow('capture-user', queued!.id)).resolves.toMatchObject({
      workflowStatus: 'failed',
      reviewSummary: { total: 1, promoted: 0, missing: 1 },
      linkedAssetIds: [],
      confirmedAssetReceipts: [],
      nextAction: 'none',
    });
    expect(mocks.readHandoffReceipt).toHaveBeenCalledWith(
      'capture-user',
      'cand-missing-receipt',
      'rd_missingreceipt0000000000',
    );
  });

  it('snapshot freezes terminal counts: post-terminal candidate drift never flips a completed capture', async () => {
    const capture = await captureModule();
    const queued = await seedHistoricalCapture();
    const store = await import('../../../../src/main/features/recall/store');
    // 终态时点：唯一候选被拒绝 → pending 0，任务 completed，快照固化。
    await store.updateRecallJsonRecord('capture-user', 'captures', queued!.id, (current) => ({
      ...current!,
      status: 'completed',
      visibility: 'visible',
      screeningStatus: 'qualified',
      candidateIds: ['cand-x'],
      reviewSnapshot: { total: 1, pending: 0, deferred: 0, promoted: 0, rejected: 1, missing: 0 },
    }));
    // 读取时点漂移：候选被 defer 冷却过期归一回 pending_review——无快照的
    // 现算口径会把 completed 翻成 failed（状态随时间自动劣化）。
    mocks.readCandidate.mockImplementation(async (_userId: string, candidateId: string) => (
      { id: candidateId, status: 'pending_review' }
    ));

    const page = await capture.queryRecallCaptures('capture-user', { statuses: ['completed'] });
    expect(page.captures[0]).toMatchObject({
      workflowStatus: 'completed',
      reviewSummary: { total: 1, pending: 0, deferred: 0, promoted: 0, rejected: 1, missing: 0 },
    });
  });

  it('keeps pending candidates in review while deferred candidates stay quiet', async () => {
    const capture = await captureModule();
    const queued = await seedHistoricalCapture();
    const store = await import('../../../../src/main/features/recall/store');
    await store.updateRecallJsonRecord('capture-user', 'captures', queued!.id, (current) => ({
      ...current!,
      status: 'review_ready',
      visibility: 'visible',
      screeningStatus: 'qualified',
      candidateIds: ['cand-pending', 'cand-deferred'],
    }));
    mocks.readCandidate.mockImplementation(async (_userId: string, candidateId: string) => (
      candidateId === 'cand-pending'
        ? { id: candidateId, status: 'pending_review' }
        : { id: candidateId, status: 'deferred' }
    ));

    const reviewPage = await capture.queryRecallCaptures('capture-user', { statuses: ['review_ready'] });
    const completedPage = await capture.queryRecallCaptures('capture-user', { statuses: ['completed'] });

    expect(reviewPage.captures[0]).toMatchObject({
      workflowStatus: 'review_ready',
      displayStatus: 'review_ready',
      displayReason: 'review_pending',
      reviewSummary: { total: 1, pending: 1, deferred: 0, promoted: 0, rejected: 0, missing: 0 },
      linkedAssetIds: [],
      nextAction: 'review_candidates',
      actions: expect.arrayContaining(['review_candidates', 'open_conversation']),
    });
    expect(reviewPage.counts).toMatchObject({ completed: 0, review: 1 });
    expect(completedPage.captures).toHaveLength(0);
  });

  it('reports missing historical candidate references without reintroducing user retry tasks', async () => {
    const capture = await captureModule();
    const queued = await seedHistoricalCapture();
    const store = await import('../../../../src/main/features/recall/store');
    await store.updateRecallJsonRecord('capture-user', 'captures', queued!.id, (current) => ({
      ...current!,
      status: 'review_ready',
      visibility: 'visible',
      screeningStatus: 'qualified',
      candidateIds: ['cand-missing'],
    }));
    mocks.readCandidate.mockRejectedValue(new Error('recall candidate not found'));

    const failedPage = await capture.queryRecallCaptures('capture-user', { statuses: ['failed'] });

    expect(failedPage.captures[0]).toMatchObject({
      status: 'review_ready',
      workflowStatus: 'failed',
      displayStatus: 'failed',
      displayReason: 'capture_failed',
      reviewSummary: { total: 1, pending: 0, deferred: 0, promoted: 0, rejected: 0, missing: 1 },
      linkedAssetIds: [],
      nextAction: 'none',
      actions: [],
    });
    expect(capture).not.toHaveProperty('retryRecallCapture');
  });

  it('maps no-candidate captures to the completed workflow filter', async () => {
    const capture = await captureModule();
    const queued = await seedHistoricalCapture();
    const store = await import('../../../../src/main/features/recall/store');
    await store.updateRecallJsonRecord('capture-user', 'captures', queued!.id, (current) => ({
      ...current!,
      status: 'no_candidate',
      visibility: 'visible',
      screeningStatus: 'qualified',
      candidateIds: [],
    }));

    const completedPage = await capture.queryRecallCaptures('capture-user', { statuses: ['completed'], scope: 'all' });

    expect(completedPage.captures[0]).toMatchObject({
      status: 'no_candidate',
      workflowStatus: 'completed',
      displayStatus: 'completed',
      displayReason: 'no_candidate',
      reviewSummary: { total: 0, pending: 0, deferred: 0, promoted: 0, rejected: 0, missing: 0 },
      linkedAssetIds: [],
      nextAction: 'none',
    });
    expect(completedPage.counts.completed).toBe(0);
  });

  it('passes the review decision and formal-asset receipt through candidate confirmation', async () => {
    const capture = await captureModule();
    const promoted = {
      candidate: {
        id: 'cand-receipt',
        status: 'confirmed',
        promotedAssetId: 'aa-receipt',
        reviewDecisionId: 'rd_receipt0000000000000000',
      },
      asset: { id: 'aa-receipt', type: 'rule', status: 'active' },
      decision: {
        decision_id: 'rd_receipt0000000000000000',
        target_ref: 'recall_candidate:cand-receipt',
        decision_type: 'accept',
        decision: 'accept',
        actor: 'user',
        timestamp: '2026-08-14T00:00:00.000Z',
      },
      receipt: {
        assetId: 'aa-receipt',
        assetType: 'rule',
        version: '1',
        lifecycleStatus: 'user_confirmed_unverified',
        scope: 'project',
        sourceRefs: [{ kind: 'conversation', id: 'conv-1' }],
        reviewDecisionId: 'rd_receipt0000000000000000',
      },
    };
    mocks.readCandidate.mockResolvedValueOnce({ id: 'cand-receipt', status: 'pending_review', proposalTarget: 'cognition' });
    mocks.promoteCandidate.mockResolvedValueOnce(promoted);

    await expect(capture.promoteRecallCaptureCandidate('capture-user', 'cand-receipt'))
      .resolves.toEqual(promoted);
    expect(mocks.promoteCandidate).toHaveBeenCalledWith('capture-user', 'cand-receipt', {
      actor: 'user',
      riskAcknowledged: undefined,
    });
  });

  it('persists the approved candidate write phase and completes after the asset is stored', async () => {
    const capture = await captureModule();
    const queued = await seedHistoricalCapture();
    const store = await import('../../../../src/main/features/recall/store');
    await store.updateRecallJsonRecord('capture-user', 'captures', queued!.id, (current) => ({
      ...current!,
      status: 'review_ready',
      visibility: 'visible',
      screeningStatus: 'qualified',
      candidateIds: ['cand-write'],
    }));

    let markWriteStarted!: () => void;
    let releaseWrite!: () => void;
    let promoted = false;
    const writeStarted = new Promise<void>((resolve) => { markWriteStarted = resolve; });
    const writeGate = new Promise<void>((resolve) => { releaseWrite = resolve; });
    mocks.readCandidate.mockImplementation(async (_userId: string, candidateId: string) => ({
      id: candidateId,
      status: promoted ? 'confirmed' : 'pending_review',
      ...(promoted ? {
        promotedAssetId: 'aa-write',
        reviewDecisionId: 'rd_write000000000000000000',
      } : {}),
    }));
    mocks.readAbilityAsset.mockResolvedValue({
      id: 'aa-write',
      candidateId: 'cand-write',
      type: 'rule',
    });
    mocks.readHandoffReceipt.mockResolvedValue({
      assetId: 'aa-write',
      assetType: 'rule',
      version: '1',
      lifecycleStatus: 'user_confirmed_unverified',
      scope: 'project',
      sourceRefs: [{ kind: 'conversation', id: 'conv-1' }],
      reviewDecisionId: 'rd_write000000000000000000',
    });
    mocks.promoteCandidate.mockImplementationOnce(async (_userId: string, candidateId: string) => {
      markWriteStarted();
      await writeGate;
      promoted = true;
      return {
        candidate: {
          id: candidateId,
          status: 'confirmed',
          promotedAssetId: 'aa-write',
          reviewDecisionId: 'rd_write000000000000000000',
        },
        asset: { id: 'aa-write' },
        decision: { decision_id: 'rd_write000000000000000000' },
        receipt: {
          assetId: 'aa-write',
          assetType: 'rule',
          version: '1',
          lifecycleStatus: 'user_confirmed_unverified',
          scope: 'project',
          sourceRefs: [{ kind: 'conversation', id: 'conv-1' }],
          reviewDecisionId: 'rd_write000000000000000000',
        },
      };
    });

    const writingPromise = capture.promoteRecallCaptureCandidate('capture-user', 'cand-write');
    await writeStarted;
    await expect(capture.readRecallCaptureWorkflow('capture-user', queued!.id)).resolves.toMatchObject({
      status: 'writing',
      stage: 'asset_write',
      writingCandidateId: 'cand-write',
      displayStatus: 'writing',
      displayReason: 'asset_write',
      actions: [],
    });
    expect(capture).not.toHaveProperty('cancelRecallCapture');

    releaseWrite();
    await expect(writingPromise).resolves.toMatchObject({ asset: { id: 'aa-write' } });
    await expect(capture.readRecallCaptureWorkflow('capture-user', queued!.id)).resolves.toMatchObject({
      status: 'review_ready',
      workflowStatus: 'completed',
      displayStatus: 'completed',
      linkedAssetIds: ['aa-write'],
    });
  });

  it('skips malformed candidates individually and rejects batches above 64 candidates', async () => {
    const capture = await captureModule();
    const validLabels = new Set(['m1']);
    const good = { judgment: 'x', summary: 'x', suggestedType: 'rule', suggestedScope: 'x', evidence: ['m1'] };

    // A single malformed candidate no longer kills the batch: it is skipped
    // and the remaining valid candidates survive.
    expect(capture.parseRecallCaptureOutput(JSON.stringify({ candidates: [
      { ...good, summary: null },                // missing title → skipped
      good,                                       // valid → kept
      { ...good, evidence: ['m2'] },              // unknown evidence → skipped
    ] }), validLabels)).toHaveLength(1);

    // All-malformed batch → empty result (not an exception).
    expect(capture.parseRecallCaptureOutput(JSON.stringify({ candidates: [{
      judgment: 'x', summary: 'x', suggestedType: 'other', suggestedScope: 'x', evidence: ['missing'],
    }] }), validLabels)).toEqual([]);

    // A complete-day summary may produce more than the former three proposals.
    expect(capture.parseRecallCaptureOutput(JSON.stringify({
      candidates: Array.from({ length: 4 }, (_, index) => ({ ...good, summary: `topic-${index}` })),
    }), validLabels)).toHaveLength(4);

    // The 64-topic limit is still rejected as a whole when exceeded.
    expect(() => capture.parseRecallCaptureOutput(JSON.stringify({ candidates: Array.from({ length: 65 }, () => ({})) }), validLabels))
      .toThrow(/candidate count/i);
  });

  it('tolerates markdown fences and prose wrapping around the JSON (model habit)', async () => {
    const capture = await captureModule();
    const validLabels = new Set(['m1']);
    const payload = JSON.stringify({ candidates: [{
      judgment: 'keep the four-part announcement structure',
      summary: '公告五段式',
      suggestedType: 'template',
      suggestedScope: 'general',
      suggestedAction: 'create',
      risk: 'low',
      evidence: ['m1'],
    }] });

    // ```json 围栏包裹
    const fenced = capture.parseRecallCaptureOutput(`\`\`\`json\n${payload}\n\`\`\``, validLabels);
    expect(fenced).toHaveLength(1);
    expect(fenced[0]).toMatchObject({ suggestedType: 'cognition', summary: '公告五段式' });
    // 前后散文说明
    const prosey = capture.parseRecallCaptureOutput(`Here is the result:\n${payload}\nHope this helps!`, validLabels);
    expect(prosey).toHaveLength(1);
    expect(prosey[0].evidence).toEqual(['m1']);
    // 围栏 + 散文混合
    const mixed = capture.parseRecallCaptureOutput(`Sure!\n\`\`\`\n${payload}\n\`\`\`\nDone.`, validLabels);
    expect(mixed).toHaveLength(1);
  });

  it('still rejects non-JSON garbage even after tolerance (no balanced object)', async () => {
    const capture = await captureModule();
    const validLabels = new Set(['m1']);
    expect(() => capture.parseRecallCaptureOutput('just some text without braces', validLabels))
      .toThrow(/not strict JSON/i);
    expect(() => capture.parseRecallCaptureOutput('```json\nnot json at all\n```', validLabels))
      .toThrow(/not strict JSON/i);
  });

  it('treats empty-string optional fields as absent (model habit of blanking unused fields)', async () => {
    const capture = await captureModule();
    const validLabels = new Set(['m1']);
    // 模型对不需要的字段（targetAssetId/uncertainty）给空串，不应判失败
    const parsed = capture.parseRecallCaptureOutput(JSON.stringify({ candidates: [{
      judgment: 'multi-format output preference',
      value: 'produce Word/MD/PPT/XLSX/HTML together',
      summary: '多格式输出偏好',
      suggestedType: 'rule',
      suggestedScope: '文档生成类任务',
      suggestedAction: 'create',
      targetAssetId: '',
      risk: 'low',
      evidence: ['m1'],
      uncertainty: '',
    }] }), validLabels);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      suggestedType: 'cognition',
      suggestedAction: 'create',
      evidence: ['m1'],
    });
    expect(parsed[0]).not.toHaveProperty('targetAssetId');
    expect(parsed[0]).not.toHaveProperty('uncertainty');
  });

  it('drops wrong-typed optional fields instead of killing the candidate', async () => {
    const capture = await captureModule();
    const validLabels = new Set(['m1']);
    // 模型偶尔把 uncertainty 给成数字/对象（"uncertainty": 0.5），或把
    // targetAssetId 给成非字符串：这些 optional 字段应被忽略，候选保留。
    const parsed = capture.parseRecallCaptureOutput(JSON.stringify({ candidates: [{
      judgment: 'user prefers Chinese comments with a purpose line at function head',
      summary: '中文注释习惯',
      suggestedType: 'personal',
      suggestedScope: 'code',
      suggestedAction: 'create',
      risk: 'low',
      uncertainty: 0.5,
      targetAssetId: { id: 'aa-1' },
      evidence: ['m1'],
    }] }), validLabels);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      suggestedType: 'cognition',
      summary: '中文注释习惯',
    });
    expect(parsed[0]).not.toHaveProperty('uncertainty');
    expect(parsed[0]).not.toHaveProperty('targetAssetId');
    // 超长 optional 字符串同样降级为 absent，不杀候选
    const longUncertainty = capture.parseRecallCaptureOutput(JSON.stringify({ candidates: [{
      judgment: 'x', summary: 'x', suggestedType: 'rule', suggestedScope: 'x',
      uncertainty: 'u'.repeat(1_001), evidence: ['m1'],
    }] }), validLabels);
    expect(longUncertainty).toHaveLength(1);
    expect(longUncertainty[0]).not.toHaveProperty('uncertainty');
  });

  it('retains complete structured content without requiring or trusting a model category', async () => {
    const capture = await captureModule();
    const judgment = 'When preparing a migration:\n\n1. Record the current schema and affected callers.\n2. Prepare and exercise the rollback plan.\n3. Check that the rollback restores the prior state.\n\nUse this process for schema changes; read-only queries do not require a deployment plan.';
    const item = { judgment, value: 'Lets a later release recover from a migration failure.',
      summary: 'Migration recovery preparation', suggestedScope: 'code', suggestedAction: 'create', risk: 'low',
      applicableWhen: ['schema migration'], forbiddenWhen: ['read-only query'], evidence: ['m1'] };
    const results = capture.parseRecallCaptureOutput(JSON.stringify({ candidates: [
      item, { ...item, suggestedType: 'rule' }, { ...item, suggestedType: 'invented_category' },
    ] }), new Set(['m1']));
    expect(results).toHaveLength(3);
    for (const result of results) expect(result).toMatchObject({
      suggestedType: 'cognition', judgment, applicableWhen: item.applicableWhen, forbiddenWhen: item.forbiddenWhen,
    });
    expect(capture.parseRecallCaptureOutput(JSON.stringify({ candidates: [{ ...item, judgment: 'x'.repeat(4001) }] }), new Set(['m1'])))
      .toEqual([]);
  });
});

/** Empty extraction results retain the model's stated reason. Distinguish an
 * explicit no-candidate verdict from a batch whose proposed candidates all
 * failed parsing, so callers can diagnose the appropriate source or schema. */
describe('空返回的可解释性', () => {
  const labels = new Set(['m1']);

  it('模型显式判空时带回它给的理由，并如实记 emittedCount=0', async () => {
    const capture = await import('../../../../src/main/features/recall/capture-service');
    const result = capture.parseRecallCaptureResult(
      JSON.stringify({ candidates: [], reason: '这轮只是复述已知信息，没有新的可沉淀内容。' }),
      labels,
    );
    expect(result.candidates).toEqual([]);
    expect(result.emittedCount).toBe(0);
    expect(result.noCandidateReason).toBe('这轮只是复述已知信息，没有新的可沉淀内容。');
  });

  it('模型没给理由时不编造——字段缺席而不是填空字符串', async () => {
    const capture = await import('../../../../src/main/features/recall/capture-service');
    const result = capture.parseRecallCaptureResult(JSON.stringify({ candidates: [] }), labels);
    expect(result.emittedCount).toBe(0);
    expect(result.noCandidateReason).toBeUndefined();
  });

  it('候选被逐条丢弃时 emittedCount 保留模型声称的条数——据此可区分两种空', async () => {
    const capture = await import('../../../../src/main/features/recall/capture-service');
    // 缺少必需标题：该条不能假装已生成完整建议。
    const result = capture.parseRecallCaptureResult(
      JSON.stringify({ candidates: [{ judgment: 'x', suggestedType: 'method', evidence: ['m1'] }] }),
      labels,
    );
    expect(result.candidates).toEqual([]);
    expect(result.emittedCount).toBe(1);
  });

  it('旧口径 parseRecallCaptureOutput 仍只交出候选数组', async () => {
    const capture = await import('../../../../src/main/features/recall/capture-service');
    expect(capture.parseRecallCaptureOutput(JSON.stringify({ candidates: [] }), labels)).toEqual([]);
  });
});

describe('本体建议必须属于候选', () => {
  // A retained synthetic provider shape. Preserve its
  // separate ownership/shape faults; the host must not assign this sibling to
  // its singleton candidate or silently drop it as unrelated metadata.
  const actualWrongNesting = {
    candidates: [{
      judgment: '用户自2026-10-15起更新其已保存的复杂技术回答长期偏好：一般复杂技术问题依然先直接说明结论，再解释关键理由与依据，两个部分分别使用“结论”和“关键原因”作为标题；排查故障时为例外——先列出已观察到的证据和待确认点，再给诊断结论。例外仅适用于排查故障，不改变一般问题的顺序。保留必要证据和未验证标记，不先铺很长的背景，不推断其他人的偏好，不改写引用原文。用户本人声明：这只是长期要求，没有证据表明效果已改善（效果未验证）。（此为对2026-10-14起偏好的更新，被更新的一般顺序仍然有效。）',
      value: '回答该用户的复杂技术问题时按更新后的顺序和标题组织；排查故障场景使用证据优先的例外顺序，避免误用一般顺序。',
      contentCategory: 'preference', summary: '复杂技术回答偏好更新：排查故障例外', suggestedScope: 'general',
      applicableWhen: ['向该用户回答一般复杂技术问题（先结论后理由）', '向该用户排查故障（先证据与待确认点，再诊断结论）', '自2026-10-15起'],
      forbiddenWhen: ['不推断其他人的偏好', '不改写引用原文', '不先铺很长的背景', '不将例外扩大到排查故障以外', '不作为效果已验证的规则使用'],
      suggestedAction: 'update', targetAssetId: 'aa-a07b7ea0c00c8d7d79a1b1fb', risk: 'low', evidence: ['m1'],
      uncertainty: '用户声明该偏好效果未验证，保留此未验证状态。',
    }],
    existingAssetsCoverageNote: 'total 1 selected 1 truncated false',
    ontologyChanges: { reason: '用户更新已保存偏好，需同步更新A断言（历史变更）与R规则正文。', evidence: ['m1'], actions: [
      { intent: 'change', recordId: 'pref-conclusion-first-assertion', expectedVersion: 1, effectiveFrom: '2026-10-15',
        sourceLabel: '用户2026-10-15明确更新偏好，增加排查故障例外', object: { kind: 'literal', valueType: 'text',
          value: '从2026-10-15起，我本人的长期表达偏好是：一般复杂技术问题先直接说明结论，再解释关键理由与依据，两部分分别使用“结论”和“关键原因”标题；排查故障时先列出已观察到的证据和待确认点，再给诊断结论。例外仅适用于排查故障，不改变一般问题的顺序。保留必要证据和未验证标记，不先铺很长的背景，不推断其他人的偏好，也不改写引用原文；没有证据表明效果已改善。' } },
      { intent: 'update', recordId: 'pref-conclusion-first-rule', expectedVersion: 2,
        sourceLabel: '用户2026-10-15明确更新偏好，增加排查故障例外', patch: { requirementSource: 'cognition_body',
          exception: '仅适用于向该用户回答复杂技术问题；排查故障时按例外顺序；不推断他人偏好，不改写引用原文；效果未经验证。' } },
    ], refs: [{ moduleId: 'personal', recordId: 'pref-conclusion-first-assertion' },
      { moduleId: 'personal', recordId: 'pref-conclusion-first-rule', versionPolicy: 'current', sharedBody: true }], identityEvidence: [] },
  };
  it('对singleton顶层本体计划报格式错误，不替模型分配所属或假装已完整解析', async () => {
    const capture = await import('../../../../src/main/features/recall/capture-service');
    expect(() => capture.parseRecallCaptureResult(JSON.stringify(actualWrongNesting), new Set(['m1'])))
      .toThrow('ontologyChanges must belong inside its candidate');
    expect(actualWrongNesting.candidates[0]).not.toHaveProperty('ontologyChanges');
    expect(actualWrongNesting.ontologyChanges.actions).toHaveLength(2);
  });
  it.each([{}, [], '', false, 0, 'cognition_body'])('任何非空未所属计划都不能混同普通metadata：%j', async unowned => {
    const capture = await import('../../../../src/main/features/recall/capture-service');
    for (const candidates of [actualWrongNesting.candidates, [], [...actualWrongNesting.candidates, ...actualWrongNesting.candidates]]) {
      expect(() => capture.parseRecallCaptureResult(JSON.stringify({ candidates, ontologyChanges: unowned }), new Set(['m1'])))
        .toThrow('ontologyChanges must belong inside its candidate');
    }
  });
  it('保留明确nested计划和旧无计划输出，null顶层字段与无权metadata不引入所属猜测', async () => {
    const capture = await import('../../../../src/main/features/recall/capture-service');
    const nested = { ...actualWrongNesting.candidates[0], ontologyChanges: actualWrongNesting.ontologyChanges };
    expect(capture.parseRecallCaptureResult(JSON.stringify({ candidates: [nested], ontologyChanges: null,
      existingAssetsCoverageNote: actualWrongNesting.existingAssetsCoverageNote }), new Set(['m1'])).candidates[0])
      .toMatchObject({ judgment: nested.judgment, ontologyChanges: actualWrongNesting.ontologyChanges });
    const legacy = capture.parseRecallCaptureResult(JSON.stringify({ candidates: actualWrongNesting.candidates,
      existingAssetsCoverageNote: actualWrongNesting.existingAssetsCoverageNote, commentary: 'provider annotation' }), new Set(['m1']));
    expect(legacy.candidates).toHaveLength(1);
    expect(legacy.candidates[0]).not.toHaveProperty('ontologyChanges');
  });
});

describe('整理记录列表：scope / 分桶 / 标题回填 / 批量', () => {
  /** 造一条可见记录并直接改盘上字段（同会话手动创建会去重复用，多记录用不同 conversationId）。 */
  async function craftCapture(capture: typeof import('../../../../src/main/features/recall/capture-service'), conversationId: string, patch: Record<string, unknown>) {
    const created = await seedHistoricalCapture(conversationId);
    const store = await import('../../../../src/main/features/recall/store');
    await store.updateRecallJsonRecord('capture-user', 'captures', created.id, (current) => ({
      ...current!,
      ...patch,
    }));
    return created.id;
  }

  it('scope=all 拉入内部静默记录，且静默记录零候选读取（性能不变式）', async () => {
    const capture = await captureModule();
    const silentId = await craftCapture(capture, 'conv-1', {
      status: 'no_candidate',
      visibility: 'internal',
      screeningStatus: 'filtered',
      // 遗留数据即使带候选 id，静默路由也不读它——这是不变式要钉住的行为
      candidateIds: ['cand-silent'],
    });

    const visiblePage = await capture.queryRecallCaptures('capture-user', {});
    expect(visiblePage.captures.map((row) => row.id)).not.toContain(silentId);
    expect(visiblePage.buckets).toEqual({ attention: 0, active: 0, silent: 0, done: 0 });

    mocks.readCandidate.mockClear();
    const allPage = await capture.queryRecallCaptures('capture-user', { scope: 'all' });
    const silentRow = allPage.captures.find((row) => row.id === silentId);
    expect(silentRow).toMatchObject({
      // 无留存内容对用户就是"已完成"（行上显示的正是
      // 「已完成」），展示桶归 done；零读取路由（性能不变式）不受影响。
      bucket: 'done',
      workflowStatus: 'completed',
      displayStatus: 'completed',
      displayReason: 'no_candidate',
      nextAction: 'none',
      actions: [],
      reviewSummary: { total: 0, pending: 0, deferred: 0, promoted: 0, rejected: 0, missing: 0 },
    });
    expect(allPage.buckets).toEqual({ attention: 0, active: 0, silent: 0, done: 1 });
    expect(mocks.readCandidate).not.toHaveBeenCalled();
  });

  it('review_ready 的候选被全部处理完 → displayStatus 已完成 → 桶归 done（筛选与行一致）', async () => {
    const capture = await captureModule();
    const store = await import('../../../../src/main/features/recall/store');
    const created = await seedHistoricalCapture('conv-1');
    // 候选已全部终态（rejected）：summarize 会把 review_ready 修正为 completed。
    await store.updateRecallJsonRecord('capture-user', 'captures', created.id, (current) => ({
      ...current!,
      status: 'review_ready',
      candidateIds: ['cand-settled'],
    }));
    mocks.readCandidate.mockImplementation(async (_userId: string, candidateId: string) => ({
      id: candidateId, status: 'rejected',
    }));

    const page = await capture.queryRecallCaptures('capture-user', { scope: 'all' });
    const row = page.captures.find((item) => item.id === created.id);
    expect(row).toMatchObject({ status: 'review_ready', displayStatus: 'completed' });
    expect(row?.bucket).toBe('done');
    expect(page.buckets.done).toBe(1);
  });
});

describe('capture settings model runtime evidence', () => {
  it('reports installed CLI fallback and treats a failed detector as unknown', async () => {
    const service = await import('../../../../src/main/features/recall/capture-service');
    mocks.configured = false;
    const priorKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      mocks.detectLocalAgents.mockResolvedValue([{ type: 'claude', available: true, auth: { loggedIn: true } }]);
      expect(await service.readRecallCaptureModelRuntime()).toMatchObject({ channel: 'cli', cliAvailable: true, cliAgentId: 'claude', cliAuthenticated: true });
      mocks.detectLocalAgents.mockRejectedValue(new Error('detector failed'));
      expect(await service.readRecallCaptureModelRuntime()).toMatchObject({ runtimeStatus: 'unknown', available: undefined });
    } finally {
      if (priorKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = priorKey;
    }
  });
});
