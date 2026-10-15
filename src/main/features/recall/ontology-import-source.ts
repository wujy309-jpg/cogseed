/** Immutable imported source text; derived candidates never replace the original. */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { recallJsonRecordPath } from './paths';
import { readRecallJsonRecord, updateRecallJsonRecord } from './store';
import type { RecallJsonRecord } from './types';
import { OntologyError } from '../cognition/ontology/model';

const COLLECTION = 'ontology-import-sources';
export interface OntologyImportSource extends RecallJsonRecord {
  schemaVersion: 1; name: string; text: string; createdAt: string; fingerprint: string;
}
export async function saveOntologyImportSource(userId: string, name: string, text: string): Promise<OntologyImportSource> {
  if (!name.trim() || name.length > 240 || !text.trim() || text.length > 100000) throw new OntologyError('invalid_input', 'invalid imported source');
  const fingerprint = createHash('sha256').update(JSON.stringify([name, text])).digest('hex');
  const id = `ontimport-${fingerprint}`;
  return await updateRecallJsonRecord(userId, COLLECTION, id, current => {
    if (current && (current.fingerprint !== fingerprint || current.text !== text || current.name !== name)) throw new OntologyError('store_corrupt', 'imported source fingerprint mismatch');
    return current || { schemaVersion: 1, ownerId: userId, id, name, text, fingerprint, createdAt: new Date().toISOString() };
  }) as OntologyImportSource;
}
export async function readOntologyImportSource(userId: string, id: string): Promise<OntologyImportSource> {
  if (!/^ontimport-[a-f0-9]{64}$/.test(id)) throw new OntologyError('invalid_input', 'invalid imported source id');
  const record = await readRecallJsonRecord(userId, COLLECTION, id);
  if (!record || record.ownerId !== userId || record.schemaVersion !== 1 || typeof record.text !== 'string' || typeof record.name !== 'string'
    || createHash('sha256').update(JSON.stringify([record.name, record.text])).digest('hex') !== record.fingerprint) throw new OntologyError('not_found', 'imported source unavailable');
  return record as OntologyImportSource;
}
export async function listOntologyImportSources(userId: string): Promise<OntologyImportSource[]> {
  const dir = path.dirname(recallJsonRecordPath(userId, COLLECTION, 'index'));
  let names: string[];
  try { names = await fs.readdir(dir); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  const rows: OntologyImportSource[] = [];
  for (const name of names.sort()) if (/^ontimport-[a-f0-9]{64}\.json$/.test(name)) rows.push(await readOntologyImportSource(userId, name.slice(0, -5)));
  return rows;
}
