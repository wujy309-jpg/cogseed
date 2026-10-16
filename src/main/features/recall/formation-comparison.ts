/** Optional source-bound comparison evidence. It is a review explanation, never
 * a save grant; current sources, target versions and approvals remain authoritative. */
import type { CaptureExistingAsset, CaptureExistingAssetsResult } from './capture-existing-assets';
import { z } from 'zod';
export const formationComparisonSchema = z.object({
  relation: z.enum(['new', 'duplicate', 'evidence', 'exception', 'correction', 'changed', 'ambiguous']),
  reason: z.string().trim().min(1).max(2000),
  targetAssetId: z.string().regex(/^[A-Za-z0-9_-]+$/).max(160).optional(),
  targetVersion: z.string().regex(/^\d{1,9}$/).optional(),
  targetQuote: z.string().min(1).max(1000).optional(),
}).strict();
export type FormationComparison = z.infer<typeof formationComparisonSchema> & { coverage?: CaptureExistingAssetsResult['coverage'] };
export function validateFormationComparison(raw: unknown, assets: CaptureExistingAsset[], coverage: CaptureExistingAssetsResult['coverage']): FormationComparison {
  const row = formationComparisonSchema.parse(raw);
  if (row.relation === 'new') {
    if (row.targetAssetId || row.targetVersion || row.targetQuote || coverage.truncated || coverage.unavailable) throw new Error('new identity comparison incomplete');
  } else if (row.relation !== 'ambiguous' || row.targetAssetId || row.targetVersion || row.targetQuote) {
    const target = assets.find(asset => asset.id === row.targetAssetId && asset.version === row.targetVersion);
    if (!target || !row.targetQuote?.trim() || !target.statement.includes(row.targetQuote)) throw new Error('comparison target evidence unavailable');
  }
  return { ...row, coverage };
}
