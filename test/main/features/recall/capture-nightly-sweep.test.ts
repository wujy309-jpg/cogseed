import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { captureSummaryModelResponse, captureSummaryModelResponseWithEvidence } from '../../../helpers/capture-summary-model';

const mocks = vi.hoisted(() => ({
  listConversations: vi.fn(), getMessagesPage: vi.fn(), getConversation: vi.fn(),
  isQuiescent: vi.fn(() => true), scheduleBootBackground: vi.fn(),
  buildRunner: vi.fn(), runModel: vi.fn(), runSummary: vi.fn(), saveCandidate: vi.fn(), oauthExpired: null as string | null,
}));
vi.mock('../../../../src/main/features/chats', () => ({
  listConversations: mocks.listConversations, getMessagesPage: mocks.getMessagesPage,
  getConversation: mocks.getConversation, getMessages: vi.fn(),
}));
vi.mock('../../../../src/main/features/group_chat/bus', () => ({
  isQuiescent: mocks.isQuiescent, subscribeTaskTerminals: () => () => {}, subscribe: () => () => {},
}));
vi.mock('../../../../src/main/features/auth', () => ({
  hasConfiguredModel: () => ({ configured: true }), getConfiguredModelOAuthExpiredMessage: () => mocks.oauthExpired,
}));
vi.mock('../../../../src/main/model/core-agent/runner', () => ({ buildRunner: mocks.buildRunner }));
vi.mock('../../../../src/main/features/recall/candidate-service', () => ({
  saveRecallCandidate: mocks.saveCandidate, readRecallCandidate: vi.fn(), readRecallAssetHandoffReceipt: vi.fn(),
  promoteRecallCandidate: vi.fn(), isAutoCaptureEligible: (candidate: { status: string }) => candidate.status === 'pending_review',
}));
vi.mock('../../../../src/main/util/boot_init', () => ({
  scheduleBootBackground: mocks.scheduleBootBackground, registerDeferred: () => {},
}));
let tmpDir: string;
let previousRoot: string | undefined;
const USER = 'nightly-user';
const at = (day: number, hour = 12) => new Date(2026, 9, day, hour).toISOString();
const WINDOW = at(12, 3);
const row = (id: string, day = 11, role = 'user', text = 'Always keep decisions traceable.') => ({
  id, ts: at(day), from: role === 'user' ? 'user' : 'commander', to: ['user'], text,
});
const conversation = (cid = 'cid', day = 11) => ({ conversation_id: cid, title: 'Report decisions', kind: 'normal', updated_at: at(day), project_id: 'project-1' });

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(WINDOW));
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nightly-cognition-'));
  previousRoot = process.env.COGSEED_WORKSPACE_ROOT;
  process.env.COGSEED_WORKSPACE_ROOT = tmpDir;
  mocks.oauthExpired = null;
  mocks.isQuiescent.mockReturnValue(true);
  mocks.scheduleBootBackground.mockImplementation(() => ({ cancel: vi.fn(), promise: new Promise(() => {}) }));
  mocks.listConversations.mockResolvedValue([conversation()]);
  mocks.getConversation.mockResolvedValue(conversation());
  mocks.getMessagesPage.mockResolvedValue({ history: [row('u1'), row('a1', 11, 'assistant')], nextCursor: null });
  mocks.buildRunner.mockImplementation(async (options) => ({ runner: { run: options.sessionId.startsWith('memory-summary-') ? mocks.runSummary : mocks.runModel } }));
  mocks.runSummary.mockReset().mockImplementation(captureSummaryModelResponse);
  mocks.runModel.mockReset();
  mocks.saveCandidate.mockReset();
});
afterEach(async () => {
  vi.useRealTimers();
  (await import('../../../../src/main/features/recall/capture-service')).startRecallCaptureOrchestrator()();
  const events = await import('../../../../src/main/features/recall/store-events');
  events.setCognitionChangeBroadcaster(null); events.resetCognitionChangeStateForTests();
  if (previousRoot === undefined) delete process.env.COGSEED_WORKSPACE_ROOT;
  else process.env.COGSEED_WORKSPACE_ROOT = previousRoot;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
async function api() {
  const capture = await import('../../../../src/main/features/recall/capture-service');
  const store = await import('../../../../src/main/features/recall/store');
  const settings = await import('../../../../src/main/features/recall/capture-settings');
  capture.startRecallCaptureOrchestrator();
  return { ...capture, ...store, settings: await settings.readRecallCaptureSettings(USER) };
}
async function records() {
  const paths = await import('../../../../src/main/features/recall/paths');
  const dir = path.dirname(paths.recallJsonRecordPath(USER, 'captures', 'placeholder'));
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter(name => name.endsWith('.json')).map(name => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'))) : [];
}
const answer = (value: unknown) => ({ text: JSON.stringify(value), meta: {} });
const positive = { eligible: true, reason: 'A durable traceability rule', evidence: [{ messageId: 'u1', quote: 'Always keep decisions traceable.' }] };

describe('the sole nightly cognition pipeline', () => {
  it('manual sweep bypasses the nightly window and reviews the due day', async () => {
    vi.setSystemTime(new Date(at(12, 20)));
    const capture = await api();
    const settingsMod = await import('../../../../src/main/features/recall/capture-settings');
    const settings = await settingsMod.readRecallCaptureSettings(USER);
    expect(await capture.runNightlyCaptureSweep(USER, at(12, 3), settings))
      .toMatchObject({ ran: false, reason: 'outside_nightly_window' });
    expect(await capture.runManualCaptureSweep(USER)).toMatchObject({ ran: true, reviewDay: '2026-10-12' });
    expect(await capture.readRecallNightlySweep(USER)).toMatchObject({ reviewWindow: { reviewDay: '2026-10-12' } });
    expect(await records()).toEqual([]);
    vi.setSystemTime(new Date(at(12, 1)));
    expect(await capture.runManualCaptureSweep(USER)).toMatchObject({ ran: true, reviewDay: '2026-10-11' });
    expect((await records()).some(record => record.reviewDay === '2026-10-11')).toBe(true);
    const captureTasks = mocks.scheduleBootBackground.mock.calls.filter(call => String(call[0]).startsWith('recall:capture:'));
    expect(captureTasks.length).toBeGreaterThan(0);
    expect(captureTasks.every(call => (call[3] as { preferIdle?: boolean }).preferIdle === false)).toBe(true);
  });
  it('uses the same explicit model sequence in summary, judgment and extraction despite an unrelated expired OAuth account', async () => {
    const capture = await api();
    const settings = await import('../../../../src/main/features/recall/capture-settings');
    const routes = [{ provider: 'openai', model: 'first' }, { provider: 'anthropic', model: 'second' }];
    await settings.updateRecallCaptureSettings(USER, { modelCandidates: routes });
    mocks.oauthExpired = 'unrelated account expired';
    const attempts: string[] = [];
    mocks.buildRunner.mockImplementation(async params => ({ runner: { run: async input => {
      const stage = params.sessionId.split('-')[1];
      const route = params.modelCandidates[0];
      attempts.push(`${stage}:${route.model}`);
      if (route.model === 'first') return { text: 'partial', meta: { error: { kind: 'provider_error', message: '503 service unavailable' } } };
      params.onCandidateChosen({ providerId: route.provider, modelId: route.model });
      return stage === 'summary' ? captureSummaryModelResponse(input) : answer(stage === 'value' ? positive : { candidates: [] });
    } } }));
    await capture.runNightlyCaptureSweep(USER, WINDOW, await settings.readRecallCaptureSettings(USER));
    const result = await capture.runRecallCapture(USER, (await records())[0].id);
    expect(result.status).toBe('no_candidate');
    expect(attempts).toEqual(['summary:first', 'summary:second', 'value:first', 'value:second', 'extract:first', 'extract:second']);
    expect(result.modelUsage).toMatchObject(routes[1]);
    expect(mocks.saveCandidate).not.toHaveBeenCalled();
  });
  it('lets the normal global runner resolve usable credentials despite an unrelated expired OAuth account', async () => {
    const capture = await api();
    mocks.oauthExpired = 'unrelated account expired';
    mocks.runModel.mockResolvedValue(answer({ eligible: false, reason: 'No durable value', evidence: [] }));
    await capture.runNightlyCaptureSweep(USER, WINDOW, capture.settings);
    expect((await capture.runRecallCapture(USER, (await records())[0].id)).status).toBe('no_candidate');
    expect(mocks.buildRunner).toHaveBeenCalledTimes(2);
  });
  it('settles an interrupted nightly window for later work instead of recording a model failure', async () => {
    const capture = await api();
    const settings = await import('../../../../src/main/features/recall/capture-settings');
    await settings.updateRecallCaptureSettings(USER, { modelCandidates: [{ provider: 'openai', model: 'first' }, { provider: 'anthropic', model: 'second' }] });
    mocks.runSummary.mockImplementationOnce(async () => {
      vi.setSystemTime(new Date(2026, 9, 12, 7));
      return { text: 'partial', meta: { error: { kind: 'provider_error', message: '503 service unavailable' } } };
    });
    await capture.runNightlyCaptureSweep(USER, WINDOW, await settings.readRecallCaptureSettings(USER));
    const result = await capture.runRecallCapture(USER, (await records())[0].id);
    expect(result.status).not.toBe('failed');
    expect(result.errorCode).toBeUndefined();
    expect(mocks.buildRunner).toHaveBeenCalledTimes(1);
  });
  it('freezes the previous complete local natural day and excludes older and current-day messages', async () => {
    const capture = await api();
    mocks.getMessagesPage.mockResolvedValue({ history: [row('old', 10), row('u1'), row('a1', 11, 'assistant'), row('today', 12)], nextCursor: null });
    expect(capture.nightlyReviewDay(WINDOW)).toMatchObject({ key: '2026-10-11', start: new Date(2026, 9, 11), end: new Date(2026, 9, 12) });
    await capture.runNightlyCaptureSweep(USER, WINDOW, capture.settings);
    expect((await records()).map(record => record.messageIds)).toEqual([['u1', 'a1']]);
    expect(mocks.runModel).not.toHaveBeenCalled();
    // Another tick cannot admit the same day/range again.
    expect(await capture.runNightlyCaptureSweep(USER, WINDOW, capture.settings)).toMatchObject({ queued: 0 });
    expect(await records()).toHaveLength(1);
  });
  it('does no all-history catch-up and preserves existing processed historical captures', async () => {
    const capture = await api();
    mocks.listConversations.mockResolvedValue([conversation('old', 1)]);
    await capture.runNightlyCaptureSweep(USER, WINDOW, capture.settings);
    expect(mocks.getMessagesPage).not.toHaveBeenCalled();
    expect(await records()).toHaveLength(0);
  });
  it('bounds admission cursors to the current day while retaining admitted ranges and retry history', async () => {
    const capture = await api();
    await capture.runNightlyCaptureSweep(USER, WINDOW, capture.settings);
    const admitted = (await records())[0];
    expect((await capture.readRecallNightlySweep(USER))?.cursors).toHaveProperty('2026-10-11:cid');
    vi.setSystemTime(new Date(2026, 9, 13, 3));
    mocks.listConversations.mockResolvedValue([]);
    await capture.runNightlyCaptureSweep(USER, at(13, 3), capture.settings);
    expect((await capture.readRecallNightlySweep(USER))?.cursors).toEqual({});
    expect(await capture.readRecallCapture(USER, admitted.id)).toMatchObject({ messageIds: ['u1', 'a1'], reviewDay: '2026-10-11', status: 'queued' });
    expect(mocks.getMessagesPage).toHaveBeenCalledTimes(1);
  });
  it('filters trivial conversations locally before queuing a model task', async () => {
    const capture = await api();
    mocks.getMessagesPage.mockResolvedValue({ history: [row('u1', 11, 'user', '谢谢'), row('a1', 11, 'assistant', '不客气')], nextCursor: null });
    const result = await capture.runNightlyCaptureSweep(USER, WINDOW, capture.settings);
    expect(result).toMatchObject({ queued: 0 });
    expect((await records())[0]).toMatchObject({ status: 'no_candidate', visibility: 'internal', screeningStatus: 'filtered' });
    expect(mocks.buildRunner).not.toHaveBeenCalled();
  });
  it('defers active conversations without consuming their progress', async () => {
    const capture = await api(); mocks.isQuiescent.mockReturnValue(false);
    expect(await capture.runNightlyCaptureSweep(USER, WINDOW, capture.settings)).toMatchObject({ deferred: 1 });
    expect(await records()).toHaveLength(0);
    mocks.isQuiescent.mockReturnValue(true);
    expect(await capture.runNightlyCaptureSweep(USER, WINDOW, capture.settings)).toMatchObject({ queued: 1 });
  });
  it('resumes a busy range next night without admitting other historical conversations', async () => {
    let capture = await api();
    mocks.isQuiescent.mockReturnValue(false);
    await capture.runNightlyCaptureSweep(USER, WINDOW, capture.settings);
    expect((await capture.readRecallNightlySweep(USER))?.pendingRanges).toMatchObject({
      '2026-10-11:cid': { start: new Date(2026, 9, 11).toISOString(), end: new Date(2026, 9, 12).toISOString() },
    });
    capture.startRecallCaptureOrchestrator()();
    vi.resetModules();
    capture = await api();
    vi.setSystemTime(new Date(2026, 9, 13, 3));
    mocks.isQuiescent.mockReturnValue(true);
    mocks.listConversations.mockResolvedValue([conversation('unadmitted', 10)]);
    mocks.getMessagesPage.mockResolvedValue({ history: [row('u1'), row('a1', 11, 'assistant'), row('later', 12)], nextCursor: null });
    expect(await capture.runNightlyCaptureSweep(USER, at(13, 3), capture.settings)).toMatchObject({ queued: 1 });
    expect(await records()).toEqual([expect.objectContaining({
      conversationId: 'cid', reviewDay: '2026-10-11', messageIds: ['u1', 'a1'],
      reviewDayStart: new Date(2026, 9, 11).toISOString(), reviewDayEnd: new Date(2026, 9, 12).toISOString(),
    })]);
    expect((await capture.readRecallNightlySweep(USER))?.pendingRanges).toEqual({});
    expect(mocks.getMessagesPage).toHaveBeenCalledTimes(1);
    expect(mocks.buildRunner).not.toHaveBeenCalled();
  });
  it('keeps unreadable admitted ranges across a failed next-night inventory read', async () => {
    const capture = await api();
    mocks.getMessagesPage.mockRejectedValueOnce(new Error('source temporarily unreadable'));
    expect(await capture.runNightlyCaptureSweep(USER, WINDOW, capture.settings)).toMatchObject({ deferred: 1 });
    vi.setSystemTime(new Date(2026, 9, 13, 3));
    mocks.listConversations.mockRejectedValueOnce(new Error('inventory unavailable'));
    expect(await capture.runNightlyCaptureSweep(USER, at(13, 3), capture.settings)).toMatchObject({ error: 'sweep_failed' });
    expect((await capture.readRecallNightlySweep(USER))?.pendingRanges).toHaveProperty('2026-10-11:cid');
    mocks.listConversations.mockResolvedValue([]);
    expect(await capture.runNightlyCaptureSweep(USER, at(13, 3), capture.settings)).toMatchObject({ queued: 1 });
    expect((await records())[0].messageIds).toEqual(['u1', 'a1']);
  });
  it('does not admit a range after the sweep is cancelled during its source read', async () => {
    const capture = await api();
    const controller = new AbortController();
    mocks.getMessagesPage.mockImplementationOnce(async () => {
      controller.abort();
      return { history: [row('u1')], nextCursor: null };
    });
    await capture.runNightlyCaptureSweep(USER, WINDOW, capture.settings, controller.signal);
    expect(await records()).toHaveLength(0);
    expect((await capture.readRecallNightlySweep(USER))?.pendingRanges).toHaveProperty('2026-10-11:cid');
    expect(mocks.buildRunner).not.toHaveBeenCalled();
  });
  it('uses the persisted absolute window when a resumed window has different local calendar boundaries', async () => {
    const capture = await api();
    const start = at(10, 16), end = at(11, 16);
    await capture.updateRecallJsonRecord(USER, 'capture-sweep', 'nightly', () => ({
      schemaVersion: 1, ownerId: USER, id: 'nightly', baselineAt: start, cursors: {},
      reviewWindow: { reviewDay: '2026-10-11', start, end, ranForWindow: WINDOW },
    }));
    mocks.getMessagesPage.mockResolvedValue({ history: [row('in-frozen-day', 11), row('outside-frozen-day', 11, 'assistant', 'Always use the source.')
      ].map((message, index) => index ? { ...message, ts: at(11, 18) } : message), nextCursor: null });
    await capture.runNightlyCaptureSweep(USER, WINDOW, capture.settings);
    expect((await records())[0]).toMatchObject({ messageIds: ['in-frozen-day'], reviewDayStart: start, reviewDayEnd: end });
  });
  it('handles more than 2000 messages by paging only until the day boundary and loses no batch IDs', async () => {
    const capture = await api();
    const all = Array.from({ length: 2050 }, (_, i) => row(`m${i}`, 11, i % 2 ? 'assistant' : 'user'));
    mocks.getMessagesPage.mockImplementation(async (_user, _cid, _limit, before) => before === undefined
      ? { history: all.slice(1800), nextCursor: 1800 }
      : { history: [row('past', 10), ...all.slice(0, 1800)], nextCursor: 100 });
    await capture.runNightlyCaptureSweep(USER, WINDOW, capture.settings);
    const ids = (await records()).flatMap(record => record.messageIds);
    expect(new Set(ids)).toEqual(new Set(all.map(message => message.id)));
    expect(ids).toHaveLength(all.length);
    expect(mocks.getMessagesPage).toHaveBeenCalledTimes(2);
  });
  it('summarizes context before value judgment; a negative decision never calls asset extraction', async () => {
    const capture = await api(); await capture.runNightlyCaptureSweep(USER, WINDOW, capture.settings);
    mocks.runModel.mockResolvedValue(answer({ eligible: false, reason: 'one-time status', evidence: [] }));
    const result = await capture.runRecallCapture(USER, (await records())[0].id);
    expect(result).toMatchObject({ status: 'no_candidate', visibility: 'internal', valueJudgment: { eligible: false } });
    expect(mocks.runSummary).toHaveBeenCalledTimes(1);
    expect(mocks.buildRunner).toHaveBeenCalledTimes(2);
    expect(mocks.buildRunner.mock.calls[0][0].sessionId).toMatch(/memory-summary/);
    expect(mocks.buildRunner.mock.calls[1][0].sessionId).toMatch(/memory-value/);
    expect(mocks.saveCandidate).not.toHaveBeenCalled();
  });
  it('makes independent summary/value/extraction calls and persists completed provenance on concrete suggestions', async () => {
    const capture = await api(); await capture.runNightlyCaptureSweep(USER, WINDOW, capture.settings);
    mocks.runModel.mockResolvedValueOnce(answer(positive)).mockResolvedValueOnce(answer({ candidates: [{
      judgment: 'Always keep decisions traceable.', summary: 'Preserve traceable decisions in future work.',
      value: 'Makes future decisions auditable through their original source.', suggestedType: 'rule',
      suggestedScope: 'project', suggestedAction: 'create', risk: 'low', evidence: ['m1'],
      applicableWhen: ['When recording decisions'], forbiddenWhen: ['When no original source is available'],
    }] }));
    mocks.saveCandidate.mockImplementation(async (_user, input) => ({ ...input, id: 'candidate-1', status: 'pending_review' }));
    const result = await capture.runRecallCapture(USER, (await records())[0].id);
    expect(result.status).toBe('review_ready');
    expect(mocks.runModel).toHaveBeenCalledTimes(2);
    expect(mocks.buildRunner.mock.calls.map(call => call[0].sessionId)).toEqual([
      expect.stringMatching(/memory-summary/), expect.stringMatching(/memory-value/), expect.stringMatching(/memory-extract/),
    ]);
    expect(mocks.runSummary).toHaveBeenCalledTimes(1);
    expect(result.contextSummary).toMatchObject({ completedAt: expect.any(String), coverage: { messageCount: 2 } });
    const judgmentInput = JSON.parse(mocks.runModel.mock.calls[0][0].message);
    expect(judgmentInput.summary).toEqual(result.contextSummary?.topics);
    expect(judgmentInput.messages).toEqual([expect.objectContaining({ id: 'u1', excerpts: [positive.evidence[0].quote] })]);
    expect(result.extractionCompletedAt).toBeTruthy();
    expect(mocks.saveCandidate.mock.calls[0][1].captureProvenance).toMatchObject({
      pipeline: 'nightly_conversation', captureId: result.id, messageIds: ['u1', 'a1'],
      extractionCompletedAt: result.extractionCompletedAt,
      valueJudgment: { eligible: true, evidence: [{ messageId: 'u1', sourceId: expect.any(String), quote: 'Always keep decisions traceable.' }] },
    });
    expect(result.autoApprovalEpoch).toBeUndefined();
  });
  it('retains extraction proof and group identity when persistence resumes after a partial save', async () => {
    const capture = await api();
    await capture.runNightlyCaptureSweep(USER, WINDOW, capture.settings);
    const proposal = { judgment: 'Always keep decisions traceable.', summary: 'Traceable decisions',
      value: 'Future decisions remain auditable.', suggestedType: 'rule', suggestedScope: 'project',
      suggestedAction: 'create', risk: 'low', evidence: ['m1'],
      applicableWhen: ['When recording decisions'], forbiddenWhen: ['Without original evidence'] };
    mocks.runModel.mockResolvedValueOnce(answer(positive)).mockResolvedValueOnce(answer({ candidates: [proposal] }));
    let saved: any;
    mocks.saveCandidate.mockImplementation(async (_user, input) => {
      saved = { ...input, id: 'first-group', status: 'pending_review' };
      throw new Error('interrupted after candidate commit but before return');
    });
    const failed = await capture.runRecallCapture(USER, (await records())[0].id);
    expect(failed).toMatchObject({ status: 'failed', errorCode: 'candidate_save_failed' });
    const store = await import('../../../../src/main/features/recall/store');
    await store.updateRecallJsonRecord(USER, 'captures', failed.id, raw => ({ ...raw!, status: 'queued' }));
    vi.setSystemTime(new Date(at(12, 4)));
    mocks.runModel.mockResolvedValue(answer({ candidates: [proposal] }));
    mocks.saveCandidate.mockImplementation(async () => saved);
    const resumed = await capture.runRecallCapture(USER, failed.id);
    expect(resumed).toMatchObject({ status: 'review_ready', candidateIds: ['first-group'],
      extractionCompletedAt: saved.captureProvenance.extractionCompletedAt });
    expect(mocks.saveCandidate.mock.calls[1][1].captureKey).toBe(saved.captureKey);
    expect(mocks.saveCandidate.mock.calls[1][1].captureProvenance).toEqual(saved.captureProvenance);
    expect(mocks.runSummary).toHaveBeenCalledTimes(1);
  });
  it('admits feedback on an already-covered historical answer through the same next-night pipeline', async () => {
    const capture = await api(); await capture.runNightlyCaptureSweep(USER, WINDOW, capture.settings);
    mocks.runModel.mockResolvedValue(answer({ eligible: false, reason: 'No new durable understanding.', evidence: [] }));
    await capture.runRecallCapture(USER, (await records())[0].id);
    const feedback = await import('../../../../src/main/features/recall/nightly-feedback');
    await feedback.queueNightlyFeedback(USER, { conversationId: 'cid', messageId: 'a1', assetId: 'aa-test-feedback', assetVersion: '1', taskRunId: 'synthetic-turn', feedback: 'negative' });
    vi.setSystemTime(new Date(at(13, 3)));
    await capture.runNightlyCaptureSweep(USER, at(13, 3), capture.settings);
    const feedbackCapture = (await records()).find(record => record.feedbackRevision);
    expect(feedbackCapture).toMatchObject({ status: 'queued', reviewDay: '2026-10-11', feedbackObservations: [expect.objectContaining({ feedback: 'negative', assetVersion: '1' })] });
    const result = await capture.runRecallCapture(USER, feedbackCapture.id);
    expect(result.status).toBe('no_candidate');
    expect(result.autoApprovalEpoch).toBeUndefined();
    const summaryInput = JSON.parse(mocks.runSummary.mock.calls.at(-1)![0].message);
    expect(summaryInput.segments.find((segment: any) => segment.messageId === 'a1').observations).toEqual([expect.objectContaining({ feedback: 'negative' })]);
    expect(await feedback.queuedNightlyFeedback(USER)).toEqual([]);
    expect(mocks.saveCandidate).not.toHaveBeenCalled();
  });
  it('extracts an explicit ontology-only group through the same nightly evidence gates', async () => {
    const capture = await api();
    await capture.runNightlyCaptureSweep(USER, WINDOW, capture.settings);
    mocks.runModel.mockResolvedValueOnce(answer(positive)).mockResolvedValueOnce(answer({ proposalVersion: 2, proposals: [{
      id: 'traceability', target: 'ontology',
      explanation: { description: 'Always keep decisions traceable.', summary: 'Traceable decision records',
        value: 'Future project decisions can be checked against their original evidence.', suggestedScope: 'project', risk: 'low', evidence: ['m1'] },
      ontologyChanges: { reason: 'The user explicitly requires source checks for project decisions.', evidence: ['m1'], actions: [
        { intent: 'create', recordId: 'project-module', sourceLabel: 'Explicit project traceability requirement',
          record: { kind: 'module', name: 'Project decisions', description: '', scope: { kind: 'project', id: 'project-1' } } },
        { intent: 'create', recordId: 'traceability-rule', sourceLabel: 'Explicit project traceability requirement',
          record: { kind: 'rule', moduleId: 'project-module', name: 'Traceable decisions', requirement: 'Always keep decisions traceable.',
            strength: 'suggestion', condition: null, effect: { kind: 'note' }, exception: '' } },
      ] },
    }] }));
    mocks.saveCandidate.mockImplementation(async (_user, input) => ({ ...input, id: 'ontology-candidate', status: 'pending_review' }));
    const result = await capture.runRecallCapture(USER, (await records())[0].id);
    expect(result).toMatchObject({ status: 'review_ready', candidateIds: ['ontology-candidate'] });
    expect(mocks.saveCandidate.mock.calls[0][1]).toMatchObject({ proposalTarget: 'ontology', formationProposalId: 'traceability',
      judgment: 'Always keep decisions traceable.', ontologyFormation: { blockedReasons: [], requiresTReview: true } });
    expect(mocks.saveCandidate.mock.calls[0][1].ontologyFormation.refs.some(ref => ref.sharedBody)).toBe(false);
  });
  it('keeps invalid/fabricated value decisions internal and does not invoke extraction', async () => {
    const capture = await api(); await capture.runNightlyCaptureSweep(USER, WINDOW, capture.settings);
    mocks.runModel.mockResolvedValue(answer({ ...positive, evidence: [{ messageId: 'a1', quote: 'Always keep decisions traceable.' }] }));
    const result = await capture.runRecallCapture(USER, (await records())[0].id);
    expect(result).toMatchObject({ status: 'failed', visibility: 'internal', errorCode: 'value_judgment_failed' });
    expect(mocks.runModel).toHaveBeenCalledTimes(1);
    expect(capture.captureBucket(result)).toBe('silent');
  });
  it('submits all complete long messages to summary chunks and merges before value judgment', async () => {
    const capture = await api();
    const source = Array.from({ length: 41 }, (_, index) => row(`full-${index}`, 11,
      index === 0 ? 'user' : 'assistant', `${index}:` + 'Complete source material. '.repeat(1_600)
        + `END-${index}` + (index === 0 ? '\nAlways keep decisions traceable in future work.' : '')));
    mocks.getMessagesPage.mockResolvedValue({ history: source, nextCursor: null });
    await capture.runNightlyCaptureSweep(USER, WINDOW, capture.settings);
    const [record] = await records();
    expect(record.messageIds).toEqual(source.map(message => message.id));
    expect(await records()).toHaveLength(1);
    mocks.runModel.mockResolvedValue(answer({ eligible: false, reason: 'No durable value', evidence: [] }));
    const result = await capture.runRecallCapture(USER, record.id);
    const inputs = mocks.runSummary.mock.calls.map(call => JSON.parse(call[0].message));
    const segments = inputs.filter(input => input.stage === 'chunk').flatMap(input => input.segments);
    for (const message of source) {
      const submitted = segments.filter(segment => segment.messageId === message.id)
        .sort((left, right) => left.start - right.start);
      expect(submitted.map(segment => segment.text).join('')).toBe(message.text);
    }
    expect(inputs.some(input => input.stage === 'merge')).toBe(true);
    expect(result.contextSummary?.coverage).toMatchObject({ messageCount: source.length,
      sourceChars: source.reduce((sum, message) => sum + message.text.length, 0) });
    expect(mocks.runModel).toHaveBeenCalledTimes(1);
    expect(mocks.saveCandidate).not.toHaveBeenCalled();
  });
  it('includes previous-day long assistant continuations with earlier user context kept outside discovery', async () => {
    const capture = await api();
    const prior = row('previous-user', 10, 'user', 'Always use this reusable migration rollback checklist for every schema migration.');
    const fresh = Array.from({ length: 36 }, (_, index) => row(`continuation-${index}`, 11, 'assistant',
      `Assistant continuation ${index}: ` + 'Verify rollback before deployment. '.repeat(300) + `TAIL-${index}`));
    mocks.getMessagesPage.mockResolvedValue({ history: [prior, ...fresh], nextCursor: null });
    await capture.runNightlyCaptureSweep(USER, WINDOW, capture.settings);
    const [record] = await records();
    expect(record.messageIds).toEqual(fresh.map(message => message.id));
    expect(record.contextMessageIds).toContain(prior.id);
    mocks.runModel.mockResolvedValue(answer({ eligible: false, reason: 'Assistant proposals need review', evidence: [] }));
    await capture.runRecallCapture(USER, record.id);
    const segments = mocks.runSummary.mock.calls.map(call => JSON.parse(call[0].message))
      .filter(input => input.stage === 'chunk').flatMap(input => input.segments);
    expect(segments.filter(segment => segment.messageId === prior.id)).toEqual([
      expect.objectContaining({ text: prior.text, discovery: false }),
    ]);
    for (const message of fresh) {
      const slices = segments.filter(segment => segment.messageId === message.id);
      expect(slices.every(segment => segment.discovery === true)).toBe(true);
      expect(slices.map(segment => segment.text).join('')).toBe(message.text);
    }
  });
  it('keeps failed or fabricated context summaries internal without value judgment or candidates', async () => {
    const capture = await api(); await capture.runNightlyCaptureSweep(USER, WINDOW, capture.settings);
    mocks.runSummary.mockImplementationOnce(async input => {
      const response = captureSummaryModelResponse(input);
      const output = JSON.parse(response.text);
      output.topics[0].evidence[0].quote = 'Fabricated quote absent from the original source';
      return answer(output);
    });
    const result = await capture.runRecallCapture(USER, (await records())[0].id);
    expect(result).toMatchObject({ status: 'failed', visibility: 'internal', errorCode: 'summary_failed' });
    expect(result.contextSummary).toBeUndefined();
    expect(mocks.runModel).not.toHaveBeenCalled();
    expect(mocks.saveCandidate).not.toHaveBeenCalled();
  });
  it('does not treat an aborted summary as completed even when it contains valid output', async () => {
    const capture = await api(); await capture.runNightlyCaptureSweep(USER, WINDOW, capture.settings);
    mocks.runSummary.mockImplementationOnce(async input => ({ ...captureSummaryModelResponse(input), meta: { aborted: true } }));
    const result = await capture.runRecallCapture(USER, (await records())[0].id);
    expect(result.contextSummary).toBeUndefined();
    expect(result.candidateIds).toEqual([]);
    expect(mocks.runModel).not.toHaveBeenCalled();
    expect(mocks.saveCandidate).not.toHaveBeenCalled();
  });
  it.each(['password = example-secret-value', '"api_key": "example-secret-value"'])('rejects sensitive summary copies without removing original chat: %s', async secretFixture => {
    const capture = await api();
    const original = `Always keep decisions traceable. Test-only sample: ${secretFixture}`;
    mocks.getMessagesPage.mockResolvedValue({ history: [row('u1', 11, 'user', original), row('a1', 11, 'assistant')], nextCursor: null });
    mocks.runSummary.mockImplementation(input => captureSummaryModelResponseWithEvidence(input, [secretFixture]));
    await capture.runNightlyCaptureSweep(USER, WINDOW, capture.settings);
    const result = await capture.runRecallCapture(USER, (await records())[0].id);
    expect(result).toMatchObject({ status: 'failed', visibility: 'internal', errorCode: 'summary_sensitive_content', candidateIds: [] });
    expect(result.contextSummary).toBeUndefined();
    expect(result.summaryCheckpoint).toBeUndefined();
    expect(mocks.runSummary).toHaveBeenCalledTimes(1);
    expect(mocks.runModel).not.toHaveBeenCalled();
    expect(mocks.saveCandidate).not.toHaveBeenCalled();
    const persisted = await records();
    expect(persisted[0].contextSummary).toBeUndefined();
    expect(persisted[0].summaryCheckpoint).toBeUndefined();
    expect(JSON.stringify(persisted)).not.toContain(secretFixture);
    const originalPage = await mocks.getMessagesPage(USER, 'cid');
    expect(originalPage.history[0].text).toBe(original);
  });
  it.each(['contextSummary', 'summaryCheckpoint'] as const)('discards a structurally valid sensitive persisted %s before rebuilding', async cachedField => {
    const capture = await api();
    const secretFixture = 'password = example-secret-value';
    const original = `Always keep decisions traceable. Test-only sample: ${secretFixture}`;
    const source = [row('u1', 11, 'user', original), row('a1', 11, 'assistant')];
    mocks.getMessagesPage.mockResolvedValue({ history: source, nextCursor: null });
    await capture.runNightlyCaptureSweep(USER, WINDOW, capture.settings);
    const record = (await records())[0];
    const summaries = await import('../../../../src/main/features/recall/capture-context-summary');
    let checkpoint: import('../../../../src/main/features/recall/capture-context-summary').CaptureContextCheckpoint | undefined;
    const summary = await summaries.summarizeCaptureContext(source.map(message => ({
      id: message.id, role: message.from === 'user' ? 'user' : 'assistant', text: message.text, discovery: true,
    })), {
      run: async message => captureSummaryModelResponseWithEvidence({ message }, [secretFixture]).text,
      onCheckpoint: progress => { checkpoint = progress; },
    });
    expect(checkpoint).toBeDefined();
    await capture.updateRecallJsonRecord(USER, 'captures', record.id, current => ({ ...current!,
      ...(cachedField === 'contextSummary' ? { contextSummary: summary } : { summaryCheckpoint: checkpoint }),
    }));
    expect(JSON.stringify(await records())).toContain(secretFixture);
    mocks.runSummary.mockImplementation(input => captureSummaryModelResponseWithEvidence(input, [secretFixture]));
    const result = await capture.runRecallCapture(USER, record.id);
    expect(result).toMatchObject({ status: 'failed', visibility: 'internal', errorCode: 'summary_sensitive_content', candidateIds: [] });
    expect(mocks.runSummary).toHaveBeenCalledTimes(1);
    expect(mocks.runModel).not.toHaveBeenCalled();
    expect(mocks.saveCandidate).not.toHaveBeenCalled();
    expect(result.contextSummary).toBeUndefined();
    expect(result.summaryCheckpoint).toBeUndefined();
    const persisted = await records();
    expect(persisted[0].contextSummary).toBeUndefined();
    expect(persisted[0].summaryCheckpoint).toBeUndefined();
    expect(JSON.stringify(persisted)).not.toContain(secretFixture);
  });
  it('re-summarizes and rejudges legacy eligible decisions that lack the source summary', async () => {
    const capture = await api(); await capture.runNightlyCaptureSweep(USER, WINDOW, capture.settings);
    const record = (await records())[0];
    await capture.updateRecallJsonRecord(USER, 'captures', record.id, current => ({ ...current!,
      valueJudgment: { ...positive, judgedAt: WINDOW, evidence: [{ ...positive.evidence[0], sourceId: 'legacy-source' }] },
    }));
    mocks.runModel.mockResolvedValue(answer({ eligible: false, reason: 'Rejudged after complete summary', evidence: [] }));
    const result = await capture.runRecallCapture(USER, record.id);
    expect(mocks.runSummary).toHaveBeenCalledTimes(1);
    expect(mocks.runModel).toHaveBeenCalledTimes(1);
    expect(mocks.buildRunner.mock.calls.map(call => call[0].sessionId)).toEqual([
      expect.stringMatching(/memory-summary/), expect.stringMatching(/memory-value/),
    ]);
    expect(result).toMatchObject({ status: 'no_candidate', valueJudgment: { eligible: false } });
    expect(mocks.saveCandidate).not.toHaveBeenCalled();
  });
  it('retries a persisted range only on the next night within the attempt limit, without rescanning old messages', async () => {
    const capture = await api(); await capture.runNightlyCaptureSweep(USER, WINDOW, capture.settings);
    const record = (await records())[0];
    await capture.updateRecallJsonRecord(USER, 'captures', record.id, current => ({ ...current!, status: 'failed', attempt: 2, lastAttemptReviewDay: '2026-10-10' }));
    expect(await capture.runNightlyCaptureSweep(USER, WINDOW, capture.settings)).toMatchObject({ retried: 1, queued: 0 });
    await capture.updateRecallJsonRecord(USER, 'captures', record.id, current => ({ ...current!, status: 'failed', attempt: 3 }));
    expect(await capture.runNightlyCaptureSweep(USER, WINDOW, capture.settings)).toMatchObject({ retried: 0 });
    expect(await records()).toHaveLength(1);
  });
  it('does not consume new daily messages merely because an old manual or cancelled task mentions them', async () => {
    const capture = await api();
    const now = new Date().toISOString();
    await capture.updateRecallJsonRecord(USER, 'captures', 'old-manual', () => ({
      schemaVersion: 1, taxonomyVersion: 2, ownerId: USER, id: 'old-manual', conversationId: 'cid',
      terminalRunId: 'old-run', anchorMessageId: 'u1', messageIds: ['u1', 'a1'],
      executionPolicy: 'manual', status: 'waiting_manual', attempt: 1, candidateIds: [],
      visibility: 'visible', screeningStatus: 'qualified', createdAt: now, updatedAt: now,
    }));
    expect(await capture.runNightlyCaptureSweep(USER, WINDOW, capture.settings)).toMatchObject({ queued: 1 });
    expect(await records()).toHaveLength(2);
  });
  it('a value decision for one quoted topic cannot extract a different user topic', async () => {
    const capture = await api();
    const source = 'Always keep decisions traceable. For one temporary task generate a calendar meeting agenda.';
    mocks.getMessagesPage.mockResolvedValue({ history: [row('u1', 11, 'user', source), row('a1', 11, 'assistant')], nextCursor: null });
    await capture.runNightlyCaptureSweep(USER, WINDOW, capture.settings);
    mocks.runModel.mockResolvedValueOnce(answer(positive)).mockResolvedValueOnce(answer({ candidates: [{
      judgment: '会议准备模板：会议目标、背景事实、三个待决策问题、负责人和下一步行动。',
      summary: '项目会议议程', value: '供后续项目会议复用，减少重复准备并使决策责任清晰。',
      suggestedType: 'template', suggestedScope: 'project', suggestedAction: 'create', evidence: ['m1'],
    }] })).mockResolvedValueOnce(answer({
      supported: false, noUnsupportedClaims: false, scopePreserved: false,
      finalDecisionPreserved: false, priorContentPreserved: false, evidence: [],
    }));
    const screening = await import('../../../../src/main/features/recall/capture-value-screening');
    expect(screening.assessRecallCandidateClassification({
      judgment: '会议准备模板：会议目标、背景事实、三个待决策问题、负责人和下一步行动。',
      summary: '项目会议议程', value: '供后续项目会议复用，减少重复准备并使决策责任清晰。',
      suggestedType: 'template', suggestedScope: 'project', suggestedAction: 'create', valueProvided: true, actionProvided: true,
    }).ok).toBe(true);
    const result = await capture.runRecallCapture(USER, (await records())[0].id);
    expect(result.status).toBe('no_candidate');
    expect(mocks.runModel).toHaveBeenCalledTimes(3);
    expect(JSON.parse(mocks.runModel.mock.calls[1][0].message).messages[0].text).toBe(source);
    expect(JSON.parse(mocks.runModel.mock.calls[2][0].message).approvedUserSources[0].approvedQuotes).toEqual([positive.evidence[0].quote]);
    expect(mocks.saveCandidate).not.toHaveBeenCalled();
  });
  it('keeps later scope restrictions and corrections in extraction even when value cites only the earlier requirement', async () => {
    const capture = await api();
    const correction = '仅限项目甲。以前英文记错了，一直是中文。';
    const source = [row('u1'), row('a1', 11, 'assistant'), row('u2', 11, 'user', correction)];
    mocks.getMessagesPage.mockResolvedValue({ history: source, nextCursor: null });
    mocks.runSummary.mockImplementation(input => captureSummaryModelResponseWithEvidence(input,
      [positive.evidence[0].quote, correction]));
    await capture.runNightlyCaptureSweep(USER, WINDOW, capture.settings);
    mocks.runModel.mockResolvedValueOnce(answer(positive)).mockResolvedValueOnce(answer({ candidates: [] }));
    const result = await capture.runRecallCapture(USER, (await records())[0].id);
    expect(mocks.runModel).toHaveBeenCalledTimes(2);
    const input = JSON.parse(mocks.runModel.mock.calls[1][0].message);
    expect(input.summary).toEqual(result.contextSummary?.topics);
    expect(input.approvedEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ messageId: 'u1', quote: positive.evidence[0].quote }),
    ]));
    expect(input.messages.map(message => message.id)).toEqual(source.map(message => message.id));
    expect(input.messages.find(message => message.id === 'u2').text).toBe(correction);
    expect(JSON.stringify(input.summary)).toContain(correction);
  });
  it('bounds positive long-source extraction input while preserving the final correction and approved source evidence', async () => {
    const capture = await api();
    const correction = '仅限项目甲。以前英文记错了，一直是中文。';
    const longText = positive.evidence[0].quote + '\n' + 'Source discussion with full details. '.repeat(6_000);
    const source = [row('u1', 11, 'user', longText), row('a1', 11, 'assistant'), row('u2', 11, 'user', correction)];
    mocks.getMessagesPage.mockResolvedValue({ history: source, nextCursor: null });
    mocks.runSummary.mockImplementation(input => captureSummaryModelResponseWithEvidence(input,
      [positive.evidence[0].quote, correction]));
    await capture.runNightlyCaptureSweep(USER, WINDOW, capture.settings);
    mocks.runModel.mockResolvedValueOnce(answer(positive)).mockResolvedValueOnce(answer({ candidates: [] }));
    const result = await capture.runRecallCapture(USER, (await records())[0].id);
    expect(mocks.runModel).toHaveBeenCalledTimes(2);
    const raw = mocks.runModel.mock.calls[1][0].message;
    expect(raw.length).toBeLessThanOrEqual(96_000);
    const input = JSON.parse(raw);
    expect(input.summary).toEqual(result.contextSummary?.topics);
    expect(input.approvedEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ messageId: 'u1', quote: positive.evidence[0].quote }),
    ]));
    expect(input.messages.find(message => message.id === 'u1')).toMatchObject({ excerpt: true });
    const excerpt = input.messages.find(message => message.id === 'u1');
    expect(excerpt.text).toContain(positive.evidence[0].quote);
    expect(excerpt.sourceSpans).toEqual(expect.arrayContaining([
      expect.objectContaining({ start: 0, end: expect.any(Number) }),
    ]));
    for (const span of excerpt.sourceSpans) {
      expect(excerpt.text).toContain(longText.slice(span.start, span.end));
    }
    expect(input.messages.find(message => message.id === 'u2').text).toBe(correction);
    expect(JSON.stringify(input.summary)).toContain(correction);
    expect(result.contextSummary?.coverage.sourceChars).toBe(source.reduce((sum, message) => sum + message.text.length, 0));
  });
  it('configuration failures remain internal and consume at most one retry in each later night', async () => {
    const capture = await api(); await capture.runNightlyCaptureSweep(USER, WINDOW, capture.settings);
    const record = (await records())[0];
    await capture.updateRecallJsonRecord(USER, 'captures', record.id, current => ({ ...current!, status: 'configuration_required' }));
    expect(await capture.runNightlyCaptureSweep(USER, WINDOW, capture.settings)).toMatchObject({ retried: 0 });
    mocks.listConversations.mockResolvedValue([]);
    const nextWindow = at(13, 3);
    vi.setSystemTime(new Date(nextWindow));
    expect(await capture.runNightlyCaptureSweep(USER, nextWindow, capture.settings)).toMatchObject({ retried: 1 });
    await capture.updateRecallJsonRecord(USER, 'captures', record.id, current => ({ ...current!, status: 'configuration_required' }));
    expect(await capture.runNightlyCaptureSweep(USER, nextWindow, capture.settings)).toMatchObject({ retried: 0 });
    expect((await records())[0]).toMatchObject({ attempt: 2, lastAttemptReviewDay: '2026-10-12' });
  });
  it('a cross-midnight window continues to review the day frozen at its start', async () => {
    const capture = await api();
    const settings = await import('../../../../src/main/features/recall/capture-settings');
    await settings.updateRecallCaptureSettings(USER, { nightlyStart: '22:00', nightlyEnd: '02:00' });
    vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 12, 1));
    mocks.getMessagesPage.mockResolvedValue({ history: [row('u1', 10), row('a1', 10, 'assistant'), row('current-night', 11)], nextCursor: null });
    const stop = capture.startNightlyCaptureSweepLoop(USER);
    const callback = mocks.scheduleBootBackground.mock.calls.at(-1)![1];
    await callback(new AbortController().signal);
    stop.stop(); vi.useRealTimers();
    expect((await records())[0]).toMatchObject({ reviewDay: '2026-10-10', messageIds: ['u1', 'a1'] });
  });
  it.each([false, true])('recovers an interrupted user confirmation outside discovery without model work (discovery disabled: %s)', async disabled => {
    const capture = await api();
    await capture.runNightlyCaptureSweep(USER, WINDOW, capture.settings);
    const record = (await records())[0];
    await capture.updateRecallJsonRecord(USER, 'captures', record.id, current => ({ ...current!,
      status: 'writing', candidateIds: ['candidate-a'], writingCandidateId: 'candidate-a', stage: 'asset_write' }));
    vi.setSystemTime(new Date(2026, 9, 12, 12));
    if (disabled) {
      const settings = await import('../../../../src/main/features/recall/capture-settings');
      await settings.updateRecallCaptureSettings(USER, { enabled: false });
    }
    expect(await capture.recoverRecallCaptures(USER)).toBe(0);
    expect(await capture.readRecallCapture(USER, record.id)).toMatchObject({ status: 'review_ready', errorCode: 'asset_write_interrupted' });
    expect((await capture.readRecallCapture(USER, record.id)).writingCandidateId).toBeUndefined();
    expect(mocks.runModel).not.toHaveBeenCalled();
  });

  it('missed windows and daytime startup never scan conversations or spend model calls', async () => {
    const capture = await api();
    vi.setSystemTime(new Date(2026, 9, 12, 12));
    const settings = await import('../../../../src/main/features/recall/capture-settings');
    await capture.updateRecallJsonRecord(USER, 'capture-settings', 'settings', () => ({ ...capture.settings, catchUpMissed: true }));
    expect(await capture.recoverRecallCaptures(USER)).toBe(0);
    expect(await capture.runNightlyCaptureSweep(USER, WINDOW, await settings.readRecallCaptureSettings(USER)))
      .toMatchObject({ ran: false, reason: 'outside_nightly_window' });
    const loop = capture.startNightlyCaptureSweepLoop(USER);
    const callback = mocks.scheduleBootBackground.mock.calls.at(-1)![1];
    await callback(new AbortController().signal); loop.stop();
    expect(mocks.listConversations).not.toHaveBeenCalled();
    expect(mocks.getMessagesPage).not.toHaveBeenCalled();
    expect(mocks.runModel).not.toHaveBeenCalled();
    expect(await records()).toHaveLength(0);
  });
  it('does not renew a model task after the window closes; its saved range resumes next night', async () => {
    const capture = await api();
    let resolveTask!: () => void;
    mocks.scheduleBootBackground.mockImplementation(() => ({ cancel: vi.fn(),
      promise: new Promise<void>(resolve => { resolveTask = resolve; }) }));
    await capture.runNightlyCaptureSweep(USER, WINDOW, capture.settings);
    const record = (await records())[0];
    const callback = mocks.scheduleBootBackground.mock.calls[0][1];
    vi.setSystemTime(new Date(2026, 9, 12, 12));
    await callback(new AbortController().signal);
    resolveTask(); await new Promise(resolve => setImmediate(resolve));
    expect(mocks.scheduleBootBackground).toHaveBeenCalledTimes(1);
    expect(mocks.runModel).not.toHaveBeenCalled();
    expect((await records())[0]).toMatchObject({ status: 'queued', attempt: 1 });
    capture.scheduleRecallCapture(USER, record.id);
    expect(await capture.recoverRecallCaptures(USER)).toBe(0);
    await new Promise(resolve => setImmediate(resolve));
    expect(mocks.scheduleBootBackground).toHaveBeenCalledTimes(1);
    mocks.listConversations.mockResolvedValue([]); mocks.getMessagesPage.mockClear();
    vi.setSystemTime(new Date(2026, 9, 13, 3));
    await capture.runNightlyCaptureSweep(USER, at(13, 3), capture.settings);
    expect(mocks.scheduleBootBackground).toHaveBeenCalledTimes(2);
    expect(mocks.getMessagesPage).not.toHaveBeenCalled();
    mocks.runModel.mockResolvedValue(answer({ eligible: false, reason: 'No durable value', evidence: [] }));
    expect(await capture.runRecallCapture(USER, record.id)).toMatchObject({ status: 'no_candidate' });
  });
  it('night startup recovers a previously persisted interrupted range without daytime model admission', async () => {
    const capture = await api(); await capture.runNightlyCaptureSweep(USER, WINDOW, capture.settings);
    const record = (await records())[0];
    await capture.updateRecallJsonRecord(USER, 'captures', record.id, current => ({ ...current!, status: 'extracting' }));
    vi.setSystemTime(new Date(2026, 9, 12, 12));
    expect(await capture.recoverRecallCaptures(USER)).toBe(0);
    expect((await records())[0].status).toBe('extracting');
    expect(mocks.runModel).not.toHaveBeenCalled();
    vi.setSystemTime(new Date(2026, 9, 13, 3));
    expect(await capture.recoverRecallCaptures(USER)).toBe(1);
    expect((await records())[0].status).toBe('queued');
  });
  it('does not start extraction in daytime when the value model crosses the window boundary', async () => {
    const capture = await api(); await capture.runNightlyCaptureSweep(USER, WINDOW, capture.settings);
    mocks.runModel.mockImplementationOnce(async () => {
      vi.setSystemTime(new Date(2026, 9, 12, 6)); return answer(positive);
    });
    const record = (await records())[0];
    expect(await capture.runRecallCapture(USER, record.id)).toMatchObject({ status: 'queued', valueJudgment: { eligible: true } });
    expect(mocks.runModel).toHaveBeenCalledTimes(1);
    expect(mocks.saveCandidate).not.toHaveBeenCalled();
  });
  it('checkpoints a summary crossing the night boundary and resumes it before value judgment next night', async () => {
    const capture = await api(); await capture.runNightlyCaptureSweep(USER, WINDOW, capture.settings);
    mocks.runSummary.mockImplementationOnce(async input => {
      vi.setSystemTime(new Date(2026, 9, 12, 6));
      return captureSummaryModelResponse(input);
    });
    const record = (await records())[0];
    const interrupted = await capture.runRecallCapture(USER, record.id);
    expect(interrupted).toMatchObject({ status: 'queued', summaryCheckpoint: { chunks: [expect.any(Object)] } });
    expect(interrupted.contextSummary).toBeUndefined();
    expect(mocks.runModel).not.toHaveBeenCalled();
    expect(mocks.saveCandidate).not.toHaveBeenCalled();
    vi.setSystemTime(new Date(2026, 9, 13, 3));
    mocks.runModel.mockResolvedValue(answer({ eligible: false, reason: 'No durable value', evidence: [] }));
    const resumed = await capture.runRecallCapture(USER, record.id);
    expect(resumed).toMatchObject({ status: 'no_candidate', contextSummary: { completedAt: expect.any(String) } });
    expect(mocks.runSummary).toHaveBeenCalledTimes(1);
    expect(mocks.runModel).toHaveBeenCalledTimes(1);
    expect(mocks.saveCandidate).not.toHaveBeenCalled();
  });
  it('keeps the completed summary checkpoint when its stage budget is exhausted and resumes next night', async () => {
    const capture = await api();
    const text = 'Always keep decisions traceable. ' + 'Synthetic bounded context sentence. '.repeat(1_500);
    mocks.getMessagesPage.mockResolvedValue({ history: [row('u1', 11, 'user', text), row('a1', 11, 'assistant')], nextCursor: null });
    await capture.runNightlyCaptureSweep(USER, WINDOW, capture.settings);
    const budgets = await import('../../../../src/main/features/recall/capture-model-budget');
    const store = await import('../../../../src/main/features/recall/store');
    const key = 'night-' + budgets.captureBudgetWindowKey(new Date(), capture.settings.nightlyStart);
    await store.writeRecallJsonRecord(USER, 'capture-model-budgets', key, { schemaVersion: 1, ownerId: USER, id: key,
      calls: budgets.CAPTURE_NIGHT_LIMITS.stageCalls - 1, inputChars: 0, reportedTokens: 0, unknownUsageCalls: budgets.CAPTURE_NIGHT_LIMITS.stageCalls - 1, billingStatus: 'unavailable', updatedAt: new Date().toISOString(),
      stages: { summary: { calls: budgets.CAPTURE_NIGHT_LIMITS.stageCalls - 1, inputChars: 0, reportedTokens: 0 } } });
    const record = (await records())[0];
    const held = await capture.runRecallCapture(USER, record.id);
    expect(held).toMatchObject({ status: 'queued', summaryCheckpoint: { chunks: [expect.any(Object)] } });
    expect(held.contextSummary).toBeUndefined();
    expect(mocks.runSummary).toHaveBeenCalledTimes(1);
    expect(mocks.runModel).not.toHaveBeenCalled();
    expect(mocks.saveCandidate).not.toHaveBeenCalled();
    const spent = await budgets.readCaptureModelBudget(USER);
    expect(spent).toMatchObject({ calls: budgets.CAPTURE_NIGHT_LIMITS.stageCalls, unknownUsageCalls: budgets.CAPTURE_NIGHT_LIMITS.stageCalls, billingStatus: 'unavailable' });
    vi.setSystemTime(new Date(2026, 9, 13, 3));
    mocks.runModel.mockResolvedValue(answer({ eligible: false, reason: 'No durable value', evidence: [] }));
    const resumed = await capture.runRecallCapture(USER, record.id);
    expect(resumed).toMatchObject({ status: 'no_candidate', contextSummary: { completedAt: expect.any(String) } });
    expect(mocks.runSummary.mock.calls.length).toBeGreaterThan(1);
    expect(mocks.runModel).toHaveBeenCalledTimes(1);
  });
  it('refuses an inconsistent budget ledger before model dispatch instead of treating it as an empty budget', async () => {
    const capture = await api(); await capture.runNightlyCaptureSweep(USER, WINDOW, capture.settings);
    const budgets = await import('../../../../src/main/features/recall/capture-model-budget');
    const store = await import('../../../../src/main/features/recall/store');
    const key = 'night-' + budgets.captureBudgetWindowKey(new Date(), capture.settings.nightlyStart);
    await store.writeRecallJsonRecord(USER, 'capture-model-budgets', key, { schemaVersion: 1, ownerId: USER, id: key,
      calls: 0, inputChars: 0, reportedTokens: 0, unknownUsageCalls: 0, billingStatus: 'unavailable', updatedAt: new Date().toISOString(),
      stages: { summary: { calls: 1, inputChars: 0, reportedTokens: 0 } } });
    const result = await capture.runRecallCapture(USER, (await records())[0].id);
    expect(result).toMatchObject({ status: 'failed', errorCode: 'summary_failed' });
    expect(mocks.runSummary).not.toHaveBeenCalled();
    expect(mocks.runModel).not.toHaveBeenCalled();
    expect(await store.readRecallJsonRecord(USER, 'capture-model-budgets', key)).toMatchObject({ calls: 0, stages: { summary: { calls: 1 } } });
  });
  it('terminal completion never creates a capture or subscribes an automatic producer', async () => {
    const capture = await api();
    expect(capture).not.toHaveProperty('queueRecallCaptureFromTerminal');
    for (const method of ['queueManualRecallCaptureFromConversation', 'startHistoricalRecallCapture', 'runRecallCaptureNow', 'retryRecallCapture', 'pauseRecallCapture', 'resumeRecallCapture', 'cancelRecallCapture', 'retryRecallCapturesBatch', 'runRecallCapturesNowBatch']) {
      expect(capture).not.toHaveProperty(method);
    }
    expect(await records()).toHaveLength(0);
  });
  it('does not present legacy scan counts as results of the new summary/value/extraction pipeline', async () => {
    const capture = await api();
    const legacy = { schemaVersion: 1, ownerId: USER, id: 'nightly', baselineAt: WINDOW, cursors: {},
      lastRunAt: WINDOW, lastResult: { ranForWindow: WINDOW, finishedAt: WINDOW, scanned: 59, queued: 0, deferred: 0, retried: 0, skipped: 59, failed: 0 } };
    await capture.writeRecallJsonRecord(USER, 'capture-sweep', 'nightly', legacy);
    expect(await capture.readRecallNightlySweep(USER)).toMatchObject({ lastResult: undefined, lastRunAt: undefined });
    expect(await capture.readRecallJsonRecord(USER, 'capture-sweep', 'nightly')).toEqual(legacy);
    await capture.runNightlyCaptureSweep(USER, WINDOW, capture.settings);
    expect((await capture.readRecallNightlySweep(USER))?.lastResult).toMatchObject({ pipelineVersion: 2, reviewDay: '2026-10-11' });
  });

});
