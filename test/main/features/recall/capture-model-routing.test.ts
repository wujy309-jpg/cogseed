import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ buildRunner: vi.fn(), run: vi.fn(), thinking: 'auto' as 'auto' | 'high' }));
vi.mock('../../../../src/main/model/core-agent/runner', () => ({ buildRunner: mocks.buildRunner }));
vi.mock('../../../../src/main/features/config', () => ({ getThinkingLevel: () => mocks.thinking }));
import { runRecallCaptureModel } from '../../../../src/main/features/recall/capture-model-routing';
const routes = [{ provider: 'openai', model: 'first' }, { provider: 'anthropic', model: 'second' }];
const options = { sessionId: 'memory-test', systemPrompt: 'analyze', message: 'source', modelCandidates: routes };
const success = { text: 'complete response', meta: { aborted: false } };
beforeEach(() => {
  mocks.thinking = 'auto';
  mocks.run.mockReset().mockResolvedValue(success);
  mocks.buildRunner.mockReset().mockImplementation(async params => {
    const route = params.modelCandidates?.[0] || { provider: 'global', model: 'actual' };
    params.onCandidateChosen({ providerId: route.provider, modelId: route.model });
    return { runner: { run: mocks.run } };
  });
});
describe('nightly capture model routing', () => {
  it.each(['503 service unavailable', 'connection reset after response began', 'All configured model candidates failed after network retries'])('discards exhausted/partial response and advances once: %s', async message => {
    mocks.run.mockResolvedValueOnce({ text: 'partial uncommitted response', meta: {
      aborted: false, error: { kind: 'provider_error', message, code: message.startsWith('All') ? 'PROVIDER_NETWORK_EXHAUSTED' : undefined },
    } });
    const completed = await runRecallCaptureModel('user', options);
    expect(completed).toEqual({ result: success, chosen: routes[1] });
    expect(mocks.buildRunner.mock.calls.map(([params]) => params.modelCandidates)).toEqual([[routes[0]], [routes[1]]]);
    expect(mocks.run).toHaveBeenCalledTimes(2);
    expect(mocks.run.mock.calls[0][0]).not.toHaveProperty('thinkingLevel');
  });
  it('skips a removed credential without falling back to the global route', async () => {
    mocks.buildRunner.mockRejectedValueOnce(Object.assign(new Error('configured model unavailable'), { code: 'PROVIDER_AUTH_EXHAUSTED' }));
    expect((await runRecallCaptureModel('user', options)).chosen).toEqual(routes[1]);
    expect(mocks.run).toHaveBeenCalledTimes(1);
  });
  it.each([
    { kind: 'context_overflow', message: 'context too long' },
    { kind: 'provider_error', message: '400 invalid request' },
    { kind: 'provider_error', message: 'content policy violation' },
    { kind: 'provider_error', message: 'content policy violation: fetch failed' },
  ])('keeps deterministic/safety failures terminal: $message', async error => {
    const failed = { text: '', meta: { aborted: false, error } };
    mocks.run.mockResolvedValueOnce(failed);
    expect((await runRecallCaptureModel('user', options)).result).toEqual(failed);
    expect(mocks.buildRunner).toHaveBeenCalledTimes(1);
  });
  it('does not dispatch a successor after user cancellation or runner abort', async () => {
    const controller = new AbortController();
    mocks.run.mockImplementationOnce(async () => {
      controller.abort();
      return { text: 'partial', meta: { aborted: true, error: { kind: 'timeout', message: 'Run aborted' } } };
    });
    await runRecallCaptureModel('user', { ...options, signal: controller.signal });
    expect(mocks.buildRunner).toHaveBeenCalledTimes(1);
    mocks.buildRunner.mockClear();
    await expect(runRecallCaptureModel('user', { ...options, signal: controller.signal })).rejects.toMatchObject({ code: 'ABORT_ERR' });
    expect(mocks.buildRunner).not.toHaveBeenCalled();
  });
  it('stops before successor when the nightly window closes', async () => {
    mocks.run.mockResolvedValueOnce({ text: '', meta: { aborted: false, error: { kind: 'timeout', message: 'request timed out' } } });
    const shouldContinue = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await expect(runRecallCaptureModel('user', { ...options, shouldContinue })).rejects.toMatchObject({ code: 'ABORT_ERR' });
    expect(mocks.buildRunner).toHaveBeenCalledTimes(1);
  });
  it('applies the system reasoning preference to every fallback', async () => {
    mocks.thinking = 'high';
    mocks.run.mockResolvedValueOnce({ text: '', meta: { aborted: false, error: { kind: 'timeout', message: 'request timed out' } } });
    await runRecallCaptureModel('user', options);
    expect(mocks.run.mock.calls.map(([params]) => params.thinkingLevel)).toEqual(['high', 'high']);
  });
  it('uses the normal global route once when no explicit models are selected', async () => {
    expect((await runRecallCaptureModel('user', { ...options, modelCandidates: [] })).chosen).toEqual({ provider: 'global', model: 'actual' });
    expect(mocks.buildRunner.mock.calls[0][0]).not.toHaveProperty('modelCandidates');
  });
  it('passes explicit JSON mode through every existing fallback without changing reasoning or tool/session boundaries', async () => {
    mocks.thinking = 'high';
    mocks.run.mockResolvedValueOnce({ text: '', meta: { error: { kind: 'timeout', message: 'request timed out' } } });
    await runRecallCaptureModel('user', { ...options, responseFormat: 'json_object' });
    expect(mocks.buildRunner.mock.calls.map(([params]) => params)).toEqual([
      expect.objectContaining({ modelCandidates: [routes[0]], responseFormat: 'json_object', disableTools: true, ephemeralSession: true }),
      expect.objectContaining({ modelCandidates: [routes[1]], responseFormat: 'json_object', disableTools: true, ephemeralSession: true }),
    ]);
    expect(mocks.run.mock.calls.map(([params]) => params.thinkingLevel)).toEqual(['high', 'high']);
  });
  it('does not opt other capture stages into JSON mode implicitly', async () => {
    await runRecallCaptureModel('user', options);
    expect(mocks.buildRunner.mock.calls[0][0]).not.toHaveProperty('responseFormat');
  });
});
