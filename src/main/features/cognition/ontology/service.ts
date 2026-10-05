/** 本体提交与读取复用认知主档、transition → document锁和坏档拒写。 */
import { withCognitionTransition } from '../../cognition_bridge';
import { cognitionStorePath, editCognitionDocument, loadCognitionStoreSync } from '../../cognition_kernel/store';
import { corruptRecordFor } from '../../../util/corrupt-guard';
import { notifyCognitionWrite } from '../../recall/store-events';
import { applyOntologyCommand, type OntologyCommandOutcome, type OntologyCommandSourceOverride } from './commands';
import { emptyOntologyDocument, OntologyError, validateOntologyDocument, type OntologyDocument } from './model';

export function readOntologyDocument(userId: string): OntologyDocument {
  const empty = emptyOntologyDocument(userId);
  const doc = loadCognitionStoreSync(userId);
  if (corruptRecordFor(cognitionStorePath(userId))) throw new OntologyError('store_corrupt', 'cognition store unreadable; ontology read refused');
  if (!doc.ontology) return empty;
  const result = validateOntologyDocument(doc.ontology);
  if (result.ownerId !== userId) throw new OntologyError('store_corrupt', 'ontology owner mismatch');
  return result;
}
export async function readOntologyView(userId: string): Promise<OntologyDocument> {
  const canonical = readOntologyDocument(userId);
  const legacy = await import('./legacy-view');
  return legacy.readOntologyWithLegacyView(canonical, userId);
}
export function previewOntologyCommand(userId: string, input: unknown): OntologyCommandOutcome {
  return applyOntologyCommand(readOntologyDocument(userId), input, new Date().toISOString());
}
export async function commitOntologyCommand(userId: string, input: unknown, sourceOverride?: OntologyCommandSourceOverride): Promise<Omit<OntologyCommandOutcome, 'document'>> {
  let result: OntologyCommandOutcome;
  try {
    await withCognitionTransition(userId, () => editCognitionDocument(userId, doc => {
      const current = doc.ontology ?? emptyOntologyDocument(userId);
      if (current.ownerId !== userId) throw new OntologyError('store_corrupt', 'ontology owner mismatch');
      result = applyOntologyCommand(current, input, new Date().toISOString(), sourceOverride);
      if (result.duplicate) return false;
      if (Buffer.byteLength(JSON.stringify(result.document), 'utf8') > 16 * 1024 * 1024)
        throw new OntologyError('capacity_exceeded', 'ontology document exceeds size limit');
      doc.ontology = result.document;
    }));
  } catch (error) {
    if (error instanceof OntologyError) throw error;
    if (corruptRecordFor(cognitionStorePath(userId))) throw new OntologyError('store_corrupt', 'cognition store corrupt; ontology write refused');
    throw new OntologyError('commit_failed', 'ontology commit failed');
  }
  if (!result.duplicate) notifyCognitionWrite(userId, 'ontology', 'update');
  return { receipt: result.receipt, duplicate: result.duplicate };
}
