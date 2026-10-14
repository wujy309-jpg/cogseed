import { buildRunner } from '../../model/core-agent/runner';
import { classifyKeyFailure } from '../../model/core-agent/auth-error';
import { createLogger } from '../../logger';
import { getThinkingLevel } from '../config';
import type { RecallCaptureModelCandidate } from './capture-settings';
import { withCaptureModelBudget, type CaptureModelBudgetContext } from './capture-model-budget';

const log = createLogger('recall.capture-model-routing');
type ModelResult = Awaited<ReturnType<Awaited<ReturnType<typeof buildRunner>>['runner']['run']>>;

async function availabilityFailure(error: unknown): Promise<boolean> {
  const raw = error as { kind?: string; code?: string; message?: string };
  if (raw?.code === 'ABORT_ERR' || raw?.kind === 'context_overflow') return false;
  if (/^PROVIDER_(?:.*_EXHAUSTED|NO_FIRST_EVENT_TIMEOUT)$/.test(raw?.code || '')) return true;
  const normalizedError = error instanceof Error ? error : Object.assign(new Error(raw?.message || String(error)), raw);
  if (classifyKeyFailure(normalizedError)) return true;
  const { classifyTransientNetworkError, classifyRetryableError } = await import('#core-agent');
  // Permanent request/safety signals beat generic network wrappers.
  if (classifyRetryableError(normalizedError) === null) return false;
  return classifyTransientNetworkError(normalizedError) !== null;
}

/** A stage commits only a complete, validated response. The runner exhausts its
 * normal retries for ONE requested model before this boundary tries the next.
 * This also permits safe recovery from partial streams, unlike interactive chat
 * rotation which must preserve already-visible output. No tools or durable
 * sessions execute here, so discarded partial responses have no side effects. */
export async function runRecallCaptureModel(userId: string, options: {
  sessionId: string;
  systemPrompt: string;
  message: string;
  modelCandidates: readonly RecallCaptureModelCandidate[];
  signal?: AbortSignal;
  shouldContinue?: () => Promise<boolean>;
  responseFormat?: 'json_object';
  budget?: CaptureModelBudgetContext;
}): Promise<{ result: ModelResult; chosen?: RecallCaptureModelCandidate }> {
  const routes: Array<RecallCaptureModelCandidate | undefined> = options.modelCandidates.length
    ? [...options.modelCandidates] : [undefined];
  let lastError: unknown;
  for (let index = 0; index < routes.length; index++) {
    if (options.signal?.aborted || (options.shouldContinue && !await options.shouldContinue())) {
      throw Object.assign(new Error('Capture model run interrupted'), { code: 'ABORT_ERR' });
    }
    const route = routes[index];
    let chosen: RecallCaptureModelCandidate | undefined;
    try {
      const dispatch = async () => {
        if (options.signal?.aborted || options.budget && options.shouldContinue && !await options.shouldContinue())
          throw Object.assign(new Error('Capture model run interrupted'), { code: 'ABORT_ERR' });
        const { runner } = await buildRunner({ sessionId: options.sessionId, userId,
          systemPrompt: options.systemPrompt, disableTools: true, ephemeralSession: true, skillList: [],
          ...(options.responseFormat ? { responseFormat: options.responseFormat } : {}),
          ...(route ? { modelCandidates: [route] } : {}),
          onCandidateChosen: info => { chosen = { provider: info.providerId, model: info.modelId }; },
        });
        const thinkingLevel = getThinkingLevel(userId);
        return runner.run({ message: options.message, signal: options.signal, cacheRetention: 'none',
          ...(thinkingLevel === 'auto' ? {} : { thinkingLevel }) });
      };
      const result = options.budget ? await withCaptureModelBudget(userId, options.budget,
        options.systemPrompt.length + options.message.length, dispatch, result => result.meta.usage) : await dispatch();
      if (options.signal?.aborted || result.meta.aborted) return { result, chosen };
      if (!result.meta.error) {
        if (chosen) log.info('capture stage model completed', { provider: chosen.provider, model: chosen.model });
        return { result, chosen };
      }
      if (index === routes.length - 1 || !await availabilityFailure(result.meta.error)) return { result, chosen };
      lastError = result.meta.error;
    } catch (error) {
      if (options.signal?.aborted || index === routes.length - 1 || !await availabilityFailure(error)) throw error;
      lastError = error;
    }
    log.warn('capture stage model unavailable; trying next configured model', { candidate_index: index });
  }
  throw lastError;
}
