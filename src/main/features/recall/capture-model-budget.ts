/** Operational limits and usage, never cognition or permission authority. */
import { fileEditLock } from '../../util/locks';
import { recallJsonRecordPath } from './paths';
import { readRecallCaptureSettings } from './capture-settings';
import { readRecallJsonRecord, updateRecallJsonRecord } from './store';
import type { RecallJsonRecord } from './types';

export type CaptureModelStage = 'summary' | 'value' | 'extraction' | 'grounding' | 'uncertainty' | 'automatic_support';
export interface CaptureModelBudgetContext { jobId: string; stage: CaptureModelStage }
export const CAPTURE_NIGHT_LIMITS = Object.freeze({ calls: 200, stageCalls: 80, inputChars: 6_000_000, reportedTokens: 1_000_000 });
interface BudgetRecord extends RecallJsonRecord {
  calls: number; inputChars: number; reportedTokens: number; unknownUsageCalls: number;
  stages: Partial<Record<CaptureModelStage, { calls: number; inputChars: number; reportedTokens: number }>>;
  updatedAt: string; billingStatus: 'unavailable';
}
export function captureBudgetWindowKey(now: Date, nightlyStart: string): string {
  const [hour, minute] = nightlyStart.split(':').map(Number);
  const start = new Date(now); start.setHours(hour, minute, 0, 0);
  if (now < start) start.setDate(start.getDate() - 1);
  return `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
}
function held(): never {
  throw Object.assign(new Error('nightly capture model budget exhausted; keep checkpoint for the next night'),
    { code: 'ABORT_ERR', reason: 'capture_budget_exhausted' });
}
function assertCounters(current: BudgetRecord): void {
  if (![current.calls, current.inputChars, current.reportedTokens, current.unknownUsageCalls].every(value => Number.isSafeInteger(value) && value >= 0)
    || !current.stages || typeof current.stages !== 'object' || Array.isArray(current.stages)
    || current.unknownUsageCalls > current.calls) throw new Error('capture model budget unreadable');
  const totals = { calls: 0, inputChars: 0, reportedTokens: 0 };
  for (const stage of Object.values(current.stages)) {
    if (!stage || ![stage.calls, stage.inputChars, stage.reportedTokens].every(value => Number.isSafeInteger(value) && value >= 0))
      throw new Error('capture stage budget unreadable');
    for (const key of ['calls', 'inputChars', 'reportedTokens'] as const) totals[key] += stage[key];
  }
  if (Object.entries(totals).some(([key, count]) => current[key] !== count)) throw new Error('capture model budget inconsistent');
}
/** Reserve before dispatch. A crash keeps the reservation: never spend again
 * merely because a provider response or usage acknowledgment was lost. Existing
 * per-model retries remain bounded by the runner and are included in its usage
 * when available; dispatch counts are not advertised as provider attempt counts. */
export async function withCaptureModelBudget<T>(userId: string, context: CaptureModelBudgetContext,
  inputChars: number, run: () => Promise<T>, usage: (result: T) => { totalTokens?: number } | undefined = () => undefined): Promise<T> {
  if (!Number.isSafeInteger(inputChars) || inputChars < 0) throw new Error('invalid capture input size');
  return fileEditLock(recallJsonRecordPath(userId, 'capture-model-budgets', 'dispatch')).runExclusive(async () => {
    const settings = await readRecallCaptureSettings(userId);
    const id = 'night-' + captureBudgetWindowKey(new Date(), settings.nightlyStart);
    const now = new Date().toISOString();
    await updateRecallJsonRecord(userId, 'capture-model-budgets', id, raw => {
      const row = raw as BudgetRecord | undefined;
      const current = row || { schemaVersion: 1, ownerId: userId, id, calls: 0, inputChars: 0, reportedTokens: 0,
        unknownUsageCalls: 0, stages: {}, updatedAt: now, billingStatus: 'unavailable' } as BudgetRecord;
      // A malformed ledger is not an empty budget.
      assertCounters(current);
      const stage = current.stages[context.stage] || { calls: 0, inputChars: 0, reportedTokens: 0 };
      if (![stage.calls, stage.inputChars, stage.reportedTokens].every(value => Number.isSafeInteger(value) && value >= 0)) throw new Error('capture stage budget unreadable');
      if (current.calls >= CAPTURE_NIGHT_LIMITS.calls || stage.calls >= CAPTURE_NIGHT_LIMITS.stageCalls
        || current.inputChars + inputChars > CAPTURE_NIGHT_LIMITS.inputChars || current.reportedTokens >= CAPTURE_NIGHT_LIMITS.reportedTokens) held();
      return { ...current, calls: current.calls + 1, inputChars: current.inputChars + inputChars,
        unknownUsageCalls: current.unknownUsageCalls + 1, updatedAt: now,
        stages: { ...current.stages, [context.stage]: { ...stage, calls: stage.calls + 1, inputChars: stage.inputChars + inputChars } } };
    });
    const result = await run();
    const tokens = usage(result)?.totalTokens;
    if (Number.isSafeInteger(tokens) && Number(tokens) > 0) await updateRecallJsonRecord(userId, 'capture-model-budgets', id, raw => {
      const current = raw as BudgetRecord, stage = current.stages[context.stage]!;
      return { ...current, reportedTokens: current.reportedTokens + Number(tokens), unknownUsageCalls: current.unknownUsageCalls - 1,
        updatedAt: new Date().toISOString(), stages: { ...current.stages, [context.stage]: { ...stage, reportedTokens: stage.reportedTokens + Number(tokens) } } };
    });
    return result;
  });
}

export async function readCaptureModelBudget(userId: string) {
  const settings = await readRecallCaptureSettings(userId);
  const windowKey = captureBudgetWindowKey(new Date(), settings.nightlyStart);
  const record = await readRecallJsonRecord(userId, 'capture-model-budgets', 'night-' + windowKey) as BudgetRecord | undefined;
  if (record) assertCounters(record);
  return { windowKey, recorded: !!record, limits: CAPTURE_NIGHT_LIMITS, calls: record?.calls || 0, inputChars: record?.inputChars || 0,
    reportedTokens: record?.reportedTokens || 0, unknownUsageCalls: record?.unknownUsageCalls || 0,
    billingStatus: 'unavailable', stages: record?.stages || {} };
}
