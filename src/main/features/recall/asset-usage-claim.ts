import { safeId } from '../../storage';
import { createLogger } from '../../logger';
import { listInjectionReceipts } from './injection-receipt';
import { recordAssetUsageReceipt, type AssetUsageReceipt } from './asset-usage-receipt';
const log = createLogger('asset-usage-claim');

/** A model report is a pending claim, not a persisted adoption or effect proof. */
export interface AssetUsageClaim {
  assetId: string;
  assetVersion: string;
  outputExcerpt: string;
}

function version(value: string): string { return value.replace(/^v/, ''); }

function parseClaim(input: Record<string, unknown>): AssetUsageClaim {
  const assetId = typeof input.assetId === 'string' ? input.assetId.trim() : '';
  const assetVersion = typeof input.assetVersion === 'string' ? input.assetVersion.trim() : '';
  const outputExcerpt = typeof input.outputExcerpt === 'string' ? input.outputExcerpt.trim() : '';
  if (!safeId(assetId) || !/^v?\d+$/.test(assetVersion) || outputExcerpt.length < 12 || outputExcerpt.length > 500) {
    throw new Error('invalid asset usage claim');
  }
  return { assetId, assetVersion, outputExcerpt };
}

/** Valid claims whose evidence was only emitted in intermediate/tool responses
 * cannot be recorded; count them so the persisted reply can say so explicitly. */
export function countClaimsMissingFromFinalOutput(claims: AssetUsageClaim[], finalText: string): number {
  const seen = new Set<string>();
  for (const raw of claims) {
    let claim: AssetUsageClaim;
    try { claim = parseClaim(raw as unknown as Record<string, unknown>); } catch { continue; }
    if (finalText.includes(claim.outputExcerpt)) continue;
    seen.add(`${claim.assetId}:${version(claim.assetVersion)}`);
  }
  return seen.size;
}

export async function prepareAssetUsageClaim(userId: string, taskRunId: string, input: Record<string, unknown>, suppliedAssets: Array<{ assetId: string; assetVersion: string }>): Promise<AssetUsageClaim> {
  if (!safeId(userId) || !safeId(taskRunId)) throw new Error('asset usage requires a current turn');
  const claim = parseClaim(input);
  // Before final persistence there is no message-bound injection receipt yet.
  // This list comes from the host's actual prompt context, never tool input.
  const supplied = suppliedAssets.some((asset) => asset.assetId === claim.assetId
    && version(asset.assetVersion) === version(claim.assetVersion));
  if (!supplied) throw new Error('asset version was not supplied in this turn');
  return claim;
}

/** Called only after the host persists a successful final message and binds its
 * injection receipts. Evidence stores the message reference, never its excerpt. */
export async function finalizeAssetUsageClaims(userId: string, input: {
  taskRunId: string; messageId: string; finalText: string; claims: AssetUsageClaim[];
}): Promise<AssetUsageReceipt[]> {
  if (!safeId(input.taskRunId) || !safeId(input.messageId)) throw new Error('invalid asset usage final message');
  const injections = await listInjectionReceipts(userId, input.taskRunId);
  const recorded: AssetUsageReceipt[] = [];
  const seen = new Set<string>();
  for (const raw of input.claims) {
    let claim: AssetUsageClaim;
    try { claim = parseClaim(raw as unknown as Record<string, unknown>); } catch { continue; }
    if (!input.finalText.includes(claim.outputExcerpt)) continue;
    const injection = injections.find((receipt) => receipt.assetId === claim.assetId
      && version(receipt.assetVersion) === version(claim.assetVersion)
      && receipt.messageId === input.messageId && receipt.boundary === 'real'
      && !!receipt.projectionId && receipt.status === 'injected');
    if (!injection) continue;
    const key = `${injection.projectionId}:${injection.assetId}:${injection.assetVersion}`;
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      recorded.push(await recordAssetUsageReceipt(userId, {
      taskRunId: input.taskRunId, projectionId: injection.projectionId!,
      assetId: injection.assetId, assetVersion: injection.assetVersion, injectionReceiptId: injection.id,
      status: 'applied', evidenceKind: 'final_output', boundary: 'real',
      evidenceRefs: [{ kind: 'message', id: input.messageId, title: 'Asset-specific final output' }],
      reason: 'Model-reported adoption tied to this asset version and persisted final output; not effectiveness verification.',
      }));
    } catch {
      // One asset's storage failure must not drop other verifiable reports.
      log.warn('asset-specific adoption receipt write failed; remaining reports retained');
    }
  }
  return recorded;
}
