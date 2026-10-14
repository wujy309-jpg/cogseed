/** Bounded comparison context for nightly extraction, not a runtime-use grant.
 * Search the entire readable active pool before applying the prompt budget.
 * Lexical matches only choose records to compare; they never prove identity,
 * entailment or that an update is justified. Preserve complete record bodies. */
import { listAbilityAssets, readAbilityAssetVersionSnapshot } from './asset-service';
import type { RecallAbilityAssetRecord } from './candidate-service';
import type { CaptureContextSummary } from './capture-context-summary';
import { isAssetScopeAllowed, type AssetScopeContext } from './scope-policy';
import { tokenize } from '../search/tokenize';
import { cosineScore, embedForDedup, SEMANTIC_RELATED_THRESHOLD } from './similarity';

export interface CaptureExistingAssetsInput {
  summary?: Pick<CaptureContextSummary, 'topics'>;
  approvedEvidence?: readonly { quote: string }[];
  /** Actual source context. Missing restricted dimensions remain fail-closed. */
  sourceScope?: AssetScopeContext & { taskText?: string; scope?: string };
  maxAssets?: number;
  /** Serialized assets-array character budget; a record is never sliced to fit. */
  maxChars?: number;
}
export type CaptureExistingAsset = Pick<RecallAbilityAssetRecord,
  'id' | 'title' | 'statement' | 'type' | 'scope' | 'scopePolicy'
  | 'applicableWhen' | 'forbiddenWhen' | 'evidenceRefs'> & { version: string };
export interface CaptureExistingAssetsResult {
  assets: CaptureExistingAsset[];
  /** Total means active heads admitted by the current source context, before
   * count/character budgets. Unavailable active snapshots are counted separately;
   * excluded scopes and disabled sources are never disclosed. */
  coverage: { total: number; selected: number; truncated: boolean; unavailable: number;
    semantic?: 'complete' | 'unavailable' | 'not_needed' };
}

const terms = (text: string): Set<string> => new Set(tokenize(text.normalize('NFKC')).filter(token => token.length > 1));
const recent = (a: RecallAbilityAssetRecord, b: RecallAbilityAssetRecord): number =>
  String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')) || a.id.localeCompare(b.id);
function limit(value: number | undefined, fallback: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new Error('invalid capture comparison budget');
  return value;
}

export async function selectCaptureExistingAssets(userId: string, input: CaptureExistingAssetsInput = {}): Promise<CaptureExistingAssetsResult> {
  const maxAssets = limit(input.maxAssets, 20, 100);
  const maxChars = limit(input.maxChars, 24_000, 128_000);
  const query = [
    ...(input.summary?.topics || []).flatMap(topic => [topic.title, topic.content, ...topic.conditions]),
    ...(input.approvedEvidence || []).map(evidence => evidence.quote),
  ].filter(Boolean).join('\n');
  const queryTerms = terms(query);
  const context = { ...input.sourceScope, taskText: input.sourceScope?.taskText || query };
  // Read only through the user-scoped canonical API. Do not open or copy source
  // files: evidence refs and the current access policy travel with each result.
  const scoped = (await listAbilityAssets(userId)).filter(asset => asset.ownerId === userId
    && asset.status === 'active' && isAssetScopeAllowed(asset.scopePolicy, {
      ...context, purpose: context.purpose || context.taskText,
    }));
  // Load the existing admission seam only when extraction is running; importing
  // its projection orchestration at module initialization would enlarge cycles.
  const { filterRecallAssetsForAgentRead } = await import('./prompt-injection');
  const active = await filterRecallAssetsForAgentRead(userId, scoped, context);
  let unavailable = 0;
  let sourceExcludedAfterSnapshot = 0;
  const readable: Array<{ record: RecallAbilityAssetRecord; snapshot: CaptureExistingAsset; titleTerms: Set<string>; bodyTerms: Set<string> }> = [];
  for (const record of active) {
    const version = String(record.activeVersion || record.version);
    let content = record;
    if (version !== String(record.version)) {
      // Historical selection mirrors content into the head record, while scope
      // grants stay current. Re-read the immutable active snapshot for certainty.
      const snapshot = await readAbilityAssetVersionSnapshot(userId, record.id, version);
      if (!snapshot || typeof snapshot.statement !== 'string' || !snapshot.statement.trim()) { unavailable++; continue; }
      content = { ...record, ...snapshot, status: record.status, maturity: record.maturity,
        lifecycleStatus: record.lifecycleStatus, scopePolicy: record.scopePolicy, scope: record.scope, title: record.title };
      // Current access remains authoritative, but a historical body may refer
      // to different sources. Its own source controls must still allow reading.
      if (!(await filterRecallAssetsForAgentRead(userId, [content], context)).length) { sourceExcludedAfterSnapshot++; continue; }
    }
    if (!content.statement.trim()) { unavailable++; continue; }
    const snapshot: CaptureExistingAsset = {
      id: record.id, title: record.title, statement: content.statement,
      type: content.type, scope: record.scope, version,
      evidenceRefs: content.evidenceRefs,
      ...(record.scopePolicy ? { scopePolicy: record.scopePolicy } : {}),
      ...(content.applicableWhen ? { applicableWhen: content.applicableWhen } : {}),
      ...(content.forbiddenWhen ? { forbiddenWhen: content.forbiddenWhen } : {}),
    };
    readable.push({ record, snapshot, titleTerms: terms(snapshot.title),
      bodyTerms: terms([snapshot.statement, ...(snapshot.applicableWhen || []), ...(snapshot.forbiddenWhen || [])].join('\n')) });
  }
  const frequency = new Map<string, number>();
  for (const item of readable) for (const term of queryTerms)
    if (item.titleTerms.has(term) || item.bodyTerms.has(term)) frequency.set(term, (frequency.get(term) || 0) + 1);
  const weight = (term: string): number => Math.log(1 + (readable.length + 1) / ((frequency.get(term) || 0) + 1));
  const score = (item: typeof readable[number]): number => [...queryTerms].reduce((sum, term) => sum
    + weight(term) * ((item.titleTerms.has(term) ? 2 : 0) + (item.bodyTerms.has(term) ? 1 : 0)), 0);
  const semanticScores = new Map<string, number>();
  let semantic: NonNullable<CaptureExistingAssetsResult['coverage']['semantic']> = 'not_needed';
  // When the entire readable pool fits, comparing all complete records needs
  // no embedding. Otherwise reuse the source-safe, full-body cached embedding
  // seam; lexical fallback remains explicitly incomplete semantic comparison.
  const poolChars = readable.reduce((total, item) => total + JSON.stringify(item.snapshot).length + 1, 2);
  if (queryTerms.size && (readable.length > maxAssets || poolChars > maxChars)) {
    semantic = 'complete';
    const queryVector = await embedForDedup(userId, query);
    if (!queryVector) semantic = 'unavailable';
    else for (const item of readable) {
      const vector = await embedForDedup(userId, JSON.stringify({ statement: item.snapshot.statement,
        applicableWhen: item.snapshot.applicableWhen, forbiddenWhen: item.snapshot.forbiddenWhen, scope: item.snapshot.scope }));
      if (!vector) { semantic = 'unavailable'; continue; }
      semanticScores.set(item.snapshot.id, cosineScore(queryVector, vector));
    }
  }
  const ranked = readable.map(item => ({ ...item, score: score(item), semanticScore: semanticScores.get(item.snapshot.id) || 0 }))
    .sort((a, b) => Number(b.semanticScore >= SEMANTIC_RELATED_THRESHOLD) - Number(a.semanticScore >= SEMANTIC_RELATED_THRESHOLD)
      || (a.semanticScore >= SEMANTIC_RELATED_THRESHOLD && b.semanticScore >= SEMANTIC_RELATED_THRESHOLD ? b.semanticScore - a.semanticScore : 0)
      || b.score - a.score || recent(a.record, b.record));
  const assets: CaptureExistingAsset[] = [];
  let chars = 2;
  for (const item of ranked) {
    const size = JSON.stringify(item.snapshot).length + (assets.length ? 1 : 0);
    if (chars + size > maxChars) continue;
    assets.push(item.snapshot); chars += size;
    if (assets.length >= maxAssets) break;
  }
  const total = active.length - sourceExcludedAfterSnapshot;
  return { assets, coverage: { total, selected: assets.length,
    truncated: assets.length < total, unavailable, semantic } };
}
