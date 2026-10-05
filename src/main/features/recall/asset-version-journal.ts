/** A version snapshot travels in the same atomic record commit as its content.
 * The append-only ledger may lag; its pending snapshots are durable and replayable. */
import type { RecallJsonRecord } from './types';
export const ASSET_VERSION_SNAPSHOT_FIELDS = ['title', 'statement', 'type', 'scope', 'scopePolicy', 'evidenceRefs',
  'learningSignal', 'learningProvenance', 'ontologyRefs', 'relations', 'derivedFrom', 'applicableWhen', 'forbiddenWhen',
  'sourceSessionIds', 'status', 'maturity', 'version', 'definition'] as const;
export function assetVersionSnapshot(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(ASSET_VERSION_SNAPSHOT_FIELDS.filter(k => record[k] !== undefined).map(k => [k, record[k]]));
}
export function pendingAssetVersions(record: RecallJsonRecord | undefined): RecallJsonRecord[] {
  const rows = record?.pendingVersionSnapshots;
  if (rows === undefined) return [];
  if (!Array.isArray(rows) || rows.some(row => !row || typeof row !== 'object' || row.ownerId !== record?.ownerId
    || row.assetId !== record?.id || row.id !== `${record?.id}-v${row.version}` || !/^\d+$/.test(String(row.version))
    || !row.snapshot || typeof row.snapshot !== 'object' || Array.isArray(row.snapshot)
    || String(row.snapshot.version) !== String(row.version) || typeof row.snapshot.title !== 'string'
    || typeof row.snapshot.statement !== 'string' || !['personal', 'rule', 'template', 'skill_method', 'fact'].includes(String(row.snapshot.type)))) throw new Error('invalid pending asset version snapshots');
  return rows;
}
export function withPendingAssetVersion(current: RecallJsonRecord | undefined, next: RecallJsonRecord): RecallJsonRecord {
  if (next.status === 'purged') { const clean = { ...next }; delete clean.pendingVersionSnapshots; return clean; }
  if (!['personal', 'rule', 'template', 'skill_method', 'fact'].includes(String(next.type))
    || typeof next.title !== 'string' || typeof next.statement !== 'string' || !/^\d+$/.test(String(next.version))
    ) return next;
  const pending = pendingAssetVersions(current);
  if (current?.version === next.version) return pending.length ? { ...next, pendingVersionSnapshots: pending } : next;
  const line = { schemaVersion: 1, ownerId: next.ownerId, id: `${next.id}-v${next.version}`, assetId: next.id,
    version: String(next.version), at: String(next.updatedAt || new Date().toISOString()), snapshot: assetVersionSnapshot(next) };
  return { ...next, pendingVersionSnapshots: [...pending.filter(row => row.version !== line.version), line] };
}
