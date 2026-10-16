/** Host-qualified recall candidates only. One optional batch clarifies meaning;
 * no verdict can broaden scope, revive a source or authorize an operation. */
import { z } from 'zod';
import { prompts } from '../../prompts/loader';
import { readAbilityAsset } from './asset-service';
import { runRecallCaptureModel } from './capture-model-routing';
import { readRecallCaptureSettings } from './capture-settings';
import { resolveRecallCaptureModelCandidates } from './capture-model-selection';
import type { RecallAbilityAssetRecord } from './candidate-service';
import type { AssetScopeContext } from './scope-policy';
export const decisionSchema = z.object({ assetId: z.string(), version: z.string(),
  verdict: z.enum(['applicable', 'not_applicable', 'uncertain']), reason: z.string().trim().min(1).max(2000),
  taskQuote: z.string().min(1).max(1000), assetQuote: z.string().min(1).max(1000),
  rank: z.number().int().min(0).max(100),
}).strict();
export type SemanticApplicabilityDecision = z.infer<typeof decisionSchema>;
const version = (asset: RecallAbilityAssetRecord) => String(asset.activeVersion || asset.version);
const uniqueLiteral = (text: string, quote: string) => !!quote.trim() && text.indexOf(quote) >= 0
  && text.indexOf(quote, text.indexOf(quote) + 1) < 0;
export function parseSemanticApplicability(raw: string, task: string, assets: RecallAbilityAssetRecord[]): SemanticApplicabilityDecision[] {
  if (raw.length > 32_000) throw new Error('semantic selection response too large');
  const result = z.object({ decisions: z.array(decisionSchema).max(12) }).strict()
    .parse(JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')));
  if (result.decisions.length !== assets.length) throw new Error('incomplete semantic selection');
  const seen = new Set<string>();
  for (const row of result.decisions) {
    const asset = assets.find(asset => asset.id === row.assetId && version(asset) === row.version);
    const content = asset && [asset.statement, ...(asset.applicableWhen || []), ...(asset.forbiddenWhen || [])].join('\n');
    if (!asset || seen.has(asset.id) || !uniqueLiteral(task, row.taskQuote) || !uniqueLiteral(content!, row.assetQuote)) throw new Error('unresolved semantic selection evidence');
    seen.add(asset.id);
  }
  return result.decisions;
}
export function ambiguousRecallAssetIds(assets: RecallAbilityAssetRecord[], task: string): Set<string> {
  const lower = task.toLocaleLowerCase();
  const ambiguous = new Set<string>();
  for (const asset of assets) {
    // Exact matches keep their existing path. Free-text conditions that did
    // not literally match need meaning adjudication, not a guessed exclusion.
    if ((asset.applicableWhen?.length && !asset.applicableWhen.some(value => lower.includes(value.toLocaleLowerCase())))
      || (asset.forbiddenWhen?.length && !asset.forbiddenWhen.some(value => lower.includes(value.toLocaleLowerCase())))) ambiguous.add(asset.id);
    if (assets.some(other => other.id !== asset.id && other.statement !== asset.statement
      && other.title.normalize('NFKC').trim().toLocaleLowerCase() === asset.title.normalize('NFKC').trim().toLocaleLowerCase())) ambiguous.add(asset.id);
    if (asset.relations?.some(relation => relation.kind === 'conflicts_with' && assets.some(other => other.id === relation.assetId))) ambiguous.add(asset.id);
  }
  return ambiguous;
}
export async function assessSemanticApplicability(userId: string, task: string, assets: RecallAbilityAssetRecord[],
  context: AssetScopeContext, assess?: (message: string) => Promise<string>): Promise<SemanticApplicabilityDecision[]> {
  const { filterRecallAssetsForAgentRead } = await import('./prompt-injection');
  const unchanged = async () => {
    for (const asset of assets) {
      const current = await readAbilityAsset(userId, asset.id);
      if (JSON.stringify(current) !== JSON.stringify(asset)
        || !(await filterRecallAssetsForAgentRead(userId, [current], { ...context, taskText: task })).length) throw new Error('semantic selection snapshot changed');
    }
  };
  const candidate = (asset: RecallAbilityAssetRecord) => ({
    assetId: asset.id, version: version(asset), title: asset.title, statement: asset.statement,
    applicableWhen: asset.applicableWhen, forbiddenWhen: asset.forbiddenWhen, scope: asset.scope,
    scopePolicy: asset.scopePolicy, ontologyRefs: asset.ontologyRefs, relations: asset.relations,
  });
  const titleKey = (asset: RecallAbilityAssetRecord) => asset.title.normalize('NFKC').trim().toLocaleLowerCase();
  const messageFor = (batch: RecallAbilityAssetRecord[]) => JSON.stringify({ currentTask: task, hostScope: context,
    currentTime: new Date().toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    candidates: batch.map(candidate),
    // Cross-batch conflicts must remain visible. These are comparison context,
    // not extra decisions or an expanded authority grant.
    comparisonCandidates: assets.filter(other => !batch.includes(other) && batch.some(asset => titleKey(asset) === titleKey(other)
      || asset.relations?.some(relation => relation.assetId === other.id && relation.kind === 'conflicts_with')
      || other.relations?.some(relation => relation.assetId === asset.id && relation.kind === 'conflicts_with'))).map(candidate),
  });
  const decisions: SemanticApplicabilityDecision[] = [];
  for (let offset = 0; offset < assets.length;) {
    let batch = assets.slice(offset, offset + 12);
    while (batch.length > 1 && messageFor(batch).length > 96_000) batch = batch.slice(0, -1);
    const message = messageFor(batch);
    if (message.length > 96_000) throw new Error('complete semantic selection exceeds input budget');
    // Embedding and earlier batches may have awaited IO. Check again before
    // any private body crosses the model boundary, not only after its reply.
    await unchanged();
    const text = assess ? await assess(message) : await (async () => {
      const settings = await readRecallCaptureSettings(userId);
      const modelCandidates = await resolveRecallCaptureModelCandidates(userId, settings.modelCandidates);
      await unchanged();
      const { result } = await runRecallCaptureModel(userId, { sessionId: `one-shot-recall-applicability-${Date.now()}-${offset}`,
        systemPrompt: prompts.load('cognition_semantic_applicability'), message, modelCandidates,
        shouldContinue: async () => { try { await unchanged(); return true; } catch { return false; } } });
      if (result.meta.aborted || result.meta.error) throw new Error('semantic selection unavailable');
      return result.text;
    })();
    decisions.push(...parseSemanticApplicability(text, task, batch));
    await unchanged();
    offset += batch.length;
  }
  return decisions;
}
