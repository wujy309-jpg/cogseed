import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { captureSummaryModelResponse } from '../../../helpers/capture-summary-model';
import { drainMainRuntimeForTest } from '../../../helpers/drain-main-runtime';
const mocks = vi.hoisted(() => ({ run: vi.fn(), runSummary: vi.fn(), buildRunner: vi.fn(), getMessages: vi.fn(), getMessagesPage: vi.fn(), getConversation: vi.fn(), listConversations: vi.fn() }));
vi.mock('../../../../src/main/features/auth', () => ({ hasConfiguredModel: () => ({ configured: true }), getConfiguredModelOAuthExpiredMessage: () => null }));
vi.mock('../../../../src/main/features/chats', () => ({ getMessages: mocks.getMessages, getMessagesPage: mocks.getMessagesPage, getConversation: mocks.getConversation, listConversations: mocks.listConversations }));
vi.mock('../../../../src/main/model/core-agent/runner', () => ({ buildRunner: mocks.buildRunner }));
vi.mock('../../../../src/main/features/recall/asset-title-suggestion', () => ({ suggestAbilityAssetTitle: async () => ({ title: '项目会议议程' }) }));
vi.mock('../../../../src/main/features/kb_embed', () => ({ closeEmbedder: vi.fn(), embedQuery: async (text: string) => { const digest = createHash('sha256').update(text).digest(); return Array.from({ length: 512 }, (_, i) => (digest[i % 32] / 255 - 0.5) * 0.2); } }));
vi.mock('../../../../src/main/util/boot_init', () => ({ registerDeferred: () => {}, scheduleBootBackground: () => ({ cancel: vi.fn(), promise: new Promise(() => {}) }) }));
let root: string, previousRoot: string | undefined;
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  mocks.buildRunner.mockImplementation(async (options) => ({ runner: { run: options.sessionId.startsWith('memory-summary-') ? mocks.runSummary : mocks.run } }));
  mocks.runSummary.mockReset().mockImplementation(captureSummaryModelResponse);
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 9, 12, 3));
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cogseed-auto-night-integration-'));
  previousRoot = process.env.COGSEED_WORKSPACE_ROOT; process.env.COGSEED_WORKSPACE_ROOT = root;
  mocks.getConversation.mockResolvedValue({ conversation_id: 'conv-night', title: '项目会议准备', space_id: 'space-night' });
  mocks.getMessages.mockResolvedValue([
    { id: 'message-user', ts: '2026-10-11T00:01:00.000Z', from: 'user', to: ['commander'], text: '请在后续项目会议反复复用以下会议准备模板：会议目标、背景事实、三个待决策问题、负责人和下一步行动。' },
    { id: 'message-assistant', ts: '2026-10-11T00:02:00.000Z', from: 'commander', to: ['user'], text: '这是一份适用于后续项目会议的可复用模板：会议目标、背景事实、三个待决策问题、负责人和下一步行动。' },
  ]);
  mocks.getMessagesPage.mockImplementation(async () => ({ history: await mocks.getMessages(), nextCursor: null }));
  mocks.listConversations.mockResolvedValue([{ conversation_id: 'conv-night', title: 'Project meeting', updated_at: '2026-10-11T00:02:00.000Z' }]);
  mocks.run.mockResolvedValue({ text: JSON.stringify({ candidates: [{ judgment: '会议准备模板：会议目标、背景事实、三个待决策问题、负责人和下一步行动。', value: '供后续项目会议复用，减少重复准备并使决策责任清晰。', summary: '项目会议议程', suggestedType: 'template', suggestedScope: 'general', suggestedAction: 'create', risk: 'low', evidence: ['m1'] }] }), meta: { aborted: false } });
});
afterEach(async () => { vi.useRealTimers(); await drainMainRuntimeForTest('capture-user'); if (previousRoot === undefined) delete process.env.COGSEED_WORKSPACE_ROOT; else process.env.COGSEED_WORKSPACE_ROOT = previousRoot; fs.rmSync(root, { recursive: true, force: true }); });
it('uses real candidate persistence after context summary, value judgment and extraction while formal assets await user confirmation', async () => {
  mocks.getConversation.mockResolvedValue({ conversation_id: 'conv-night', title: 'Project meeting', space_id: 'space-night', project_id: 'project-night' });
  const settings = await import('../../../../src/main/features/recall/capture-settings');
  const paths = await import('../../../../src/main/features/recall/paths');
  const capture = await import('../../../../src/main/features/recall/capture-service');
  const candidates = await import('../../../../src/main/features/recall/candidate-service');
  const assets = await import('../../../../src/main/features/recall/asset-service');
  // The default manual policy preserves the complete nightly proposal for review.
  await settings.updateRecallCaptureSettings('capture-user', { autoApproval: false });
  const { appendJsonlAtomic } = await import('../../../../src/main/storage');
  const { conversationMessageFile } = await import('../../../../src/main/util/project-layout');
  for (const message of await mocks.getMessages()) await appendJsonlAtomic(conversationMessageFile('capture-user', 'conv-night'), message);
  const stop = capture.startRecallCaptureOrchestrator();
  const window = new Date(2026, 9, 12, 3).toISOString();
  await capture.runNightlyCaptureSweep('capture-user', window, await settings.readRecallCaptureSettings('capture-user'));
  const directory = path.dirname(paths.recallJsonRecordPath('capture-user', 'captures', 'placeholder'));
  const [name] = fs.readdirSync(directory);
  const queued = await capture.readRecallCapture('capture-user', name.replace(/\.json$/, ''));
  const original = (await mocks.getMessages())[0].text;
  mocks.run.mockResolvedValueOnce({ text: JSON.stringify({ eligible: true, reason: 'Reusable user-supplied meeting structure',
    evidence: [{ messageId: 'message-user', quote: original }] }), meta: {} });
  const result = await capture.runRecallCapture('capture-user', queued.id);
  stop();
  const saved = await candidates.listRecallCandidates('capture-user');
  expect(saved).toHaveLength(1);
  expect(mocks.runSummary).toHaveBeenCalledTimes(1);
  expect(mocks.run).toHaveBeenCalledTimes(2);
  expect(mocks.buildRunner.mock.calls.map(call => call[0].sessionId)).toEqual([
    expect.stringMatching(/memory-summary/), expect.stringMatching(/memory-value/), expect.stringMatching(/memory-extract/),
  ]);
  expect(result.contextSummary?.coverage).toMatchObject({ messageCount: 2 });
  expect(result.status).toBe('review_ready');
  expect(saved[0]).toMatchObject({ status: 'pending_review', scopePolicy: { workspaceIds: ['space-night'], projectIds: ['project-night'] },
    captureProvenance: { pipeline: 'nightly_conversation', valueJudgment: { eligible: true }, extractionCompletedAt: expect.any(String) } });
  expect(saved[0].promotedAssetId).toBeUndefined();
  expect(await assets.listAbilityAssets('capture-user')).toHaveLength(0);
  expect(candidates).not.toHaveProperty('approveNewNightlyRecallCandidate');
});

it('automatically completes a supported preference while an independent topic remains unresolved', async () => {
  const quote = '我以后希望回答先给结论，再列出关键依据，并明确标注尚未验证的内容。';
  const question = '另外，部署窗口具体安排在哪一天？这个问题还没有确定。';
  mocks.getConversation.mockResolvedValue({ conversation_id: 'conv-night', title: '回答偏好和部署讨论' });
  mocks.getMessages.mockResolvedValue([
    { id: 'message-user', ts: '2026-10-11T00:01:00.000Z', from: 'user', to: ['commander'], text: quote },
    { id: 'message-unresolved', ts: '2026-10-11T00:02:00.000Z', from: 'user', to: ['commander'], text: question },
    { id: 'message-assistant', ts: '2026-10-11T00:03:00.000Z', from: 'commander', to: ['user'], text: '回答偏好已明确；部署窗口需要另外核对。' },
  ]);
  mocks.runSummary.mockImplementation(async (input: { message: string }) => {
    const request = JSON.parse(input.message);
    if (request.stage === 'chunk') return { text: JSON.stringify({
      coveredIds: request.segments.map((entry: any) => entry.id),
      topics: request.segments.filter((entry: any) => entry.role === 'user').map((entry: any) => ({
        title: entry.messageId === 'message-user' ? '长期回答偏好' : '部署时间待定', content: entry.text,
        conditions: [], unresolved: entry.messageId === 'message-user' ? [] : ['部署时间仍待核对'],
        attribution: entry.messageId === 'message-user' ? 'user_requirement' : 'source_observation',
        evidence: [{ messageId: entry.messageId, quote: entry.text }],
      })),
    }), meta: {} };
    return { text: JSON.stringify({ coveredIds: request.inputs.map((entry: any) => entry.id),
      topics: request.inputs.flatMap((entry: any) => entry.topics.map((topic: any) => ({ ...topic, id: undefined, inputIds: [topic.id] }))) }), meta: {} };
  });
  mocks.run.mockReset()
    .mockResolvedValueOnce({ text: JSON.stringify({ eligible: true, reason: '明确的长期回答偏好可以用于后续沟通', evidence: [{ messageId: 'message-user', quote }] }), meta: {} })
    .mockResolvedValueOnce({ text: JSON.stringify({ candidates: [{ judgment: quote, value: '长期保持清晰表达和证据边界，提升后续沟通效率。', summary: '回答结构偏好', suggestedType: 'personal', suggestedScope: 'general', suggestedAction: 'create', risk: 'low', evidence: ['m1'] }] }), meta: {} })
    .mockResolvedValueOnce({ text: JSON.stringify({ supported: true, noUnsupportedClaims: true, scopePreserved: true,
      finalDecisionPreserved: true, priorContentPreserved: true, evidence: [{ label: 'm1', quote }] }), meta: {} });
  const settings = await import('../../../../src/main/features/recall/capture-settings');
  const capture = await import('../../../../src/main/features/recall/capture-service');
  const paths = await import('../../../../src/main/features/recall/paths');
  const candidates = await import('../../../../src/main/features/recall/candidate-service');
  const journal = await import('../../../../src/main/features/cognition/review-decision');
  await settings.updateRecallCaptureSettings('capture-user', { autoApproval: true });
  const { appendJsonlAtomic } = await import('../../../../src/main/storage');
  const { conversationMessageFile } = await import('../../../../src/main/util/project-layout');
  for (const message of await mocks.getMessages()) await appendJsonlAtomic(conversationMessageFile('capture-user', 'conv-night'), message);
  const stop = capture.startRecallCaptureOrchestrator();
  try {
    await capture.runNightlyCaptureSweep('capture-user', new Date(2026, 9, 12, 3).toISOString(), await settings.readRecallCaptureSettings('capture-user'));
    const directory = path.dirname(paths.recallJsonRecordPath('capture-user', 'captures', 'placeholder'));
    const [file] = fs.readdirSync(directory);
    const result = await capture.runRecallCapture('capture-user', file.replace(/\.json$/, ''));
    expect(result.status).toBe('completed');
    expect(result.contextSummary?.topics.some(topic => topic.unresolved.length > 0)).toBe(true);
    const [candidate] = await candidates.listRecallCandidates('capture-user');
    expect(candidate).toMatchObject({ status: 'confirmed', autoReview: { eligible: true } });
    expect(await journal.readReviewDecision('capture-user', `recall_candidate:${candidate.id}`, candidate.reviewDecisionId)).toMatchObject({ actor: 'system', decision: 'automatic low-risk approval' });
  } finally { stop(); }
});
