import * as cognitionKernel from '../features/cognition_kernel';
import * as cognition from '../features/cognition';
import { generateCognitionDraft } from '../features/cognition/capture-draft';
import { extractOntologyImportFile, submitOntologyImport } from '../features/cognition/ontology/import-text';
import { commitCandidateOntologyRecords, completeCandidateOntologyHandoff } from '../features/cognition/ontology/candidate-handoff';
import { commitOntologyCommand, previewOntologyCommand, readOntologyDocument, readOntologyView } from '../features/cognition/ontology/service';
import { buildOntologyExport } from '../features/cognition/ontology/export';
import { listOntologyUsageReceipts } from '../features/cognition/ontology/usage-receipt';
import { extractOntologyImportCandidates } from '../features/cognition/ontology/import-extraction';
import { readOntologyImportSource } from '../features/cognition/ontology/import-source';
import { moduleCanUse } from '../features/cognition/ontology/commands';
import { ontologyRecordsKnownAt, queryOntologyFacts, queryOntologyGraph, queryOntologyRules, searchOntologyRecords } from '../features/cognition/ontology/query';
import { OntologyError, type OntologyDocument } from '../features/cognition/ontology/model';
import { getCurrentUiLang, getRendererTables } from '../i18n';
import { safeId } from '../storage';
import { BrowserWindow, dialog } from 'electron';

interface IpcContext {
  userId: string;
}

type Payload = Record<string, unknown>;

function requiredId(value: unknown, field: string): string {
  if (!safeId(value) || typeof value !== 'string' || value.length > 160) {
    throw new Error(`invalid cognition ${field}`);
  }
  return value;
}

function positiveInteger(value: unknown, field: string, fallback: number): number {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`invalid cognition ${field}`);
  return parsed;
}

function pageSize(value: unknown): number {
  const parsed = positiveInteger(value, 'page size', cognition.DEFAULT_COGNITION_PAGE_SIZE);
  if (parsed > cognition.MAX_COGNITION_PAGE_SIZE) throw new Error('invalid cognition page size');
  return parsed;
}

function ontologyId(value: unknown, field: string): string {
  if (!safeId(value) || typeof value !== 'string' || value.length > 160) throw new OntologyError('invalid_input', `invalid ${field}`);
  return value;
}
function ontologyText(value: unknown, field: string, max = 500): string {
  if (typeof value !== 'string' || value.trim().length > max) throw new OntologyError('invalid_input', `invalid ${field}`);
  return value.trim();
}
function ontologyRawText(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || value.length > max || !value.trim()) throw new OntologyError('invalid_input', `invalid ${field}`);
  return value;
}
function ontologyRevision(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new OntologyError('invalid_input', 'invalid knowledge revision');
  return parsed;
}
function ontologyBox(doc: OntologyDocument, moduleId: string, box: string) {
  const module = doc.records[moduleId];
  if (!module || module.kind !== 'module') throw new OntologyError('not_found', 'ontology module unavailable');
  const records = Object.values(doc.records).filter(record => record.status === 'active' && (
    record.kind === 'module' ? record.id === moduleId : record.moduleId === moduleId
  ));
  const matched = box === 'T' ? records.filter(r => r.kind === 'definition' && r.definitionKind !== 'relation')
    : box === 'A' ? records.filter(r => r.kind === 'entity' || r.kind === 'assertion')
      : box === 'R' ? records.filter(r => r.kind === 'reference' || r.kind === 'rule' || (r.kind === 'definition' && r.definitionKind === 'relation'))
        : null;
  if (!matched) throw new OntologyError('invalid_input', 'ontology box must be T, A or R');
  return matched;
}

// 旧版 CognitionAsset 的全部自有入口（list/get/create/evidence.add/confirm/
// defer/reuse/capture）已下线：list 由 ipc/index.ts 以能力资产语义注册；
// 正式候选生产者走 recall.candidates.save 主链；遗留 store 只保留读用途
// （renderer 分页 + memory 可见性门控）。
export const invokeHandlers = {
  'cognition.capture.draft': async (payload: Payload, ctx: IpcContext) => {
    const conversationId = requiredId(payload.conversationId, 'conversation id');
    const messageId = requiredId(payload.messageId, 'message id');
    return generateCognitionDraft(ctx.userId, { conversationId, messageId });
  },

  'cognition.assets.page': async (payload: Payload, ctx: IpcContext) => ({
    page: await cognition.listCognitionAssetPage(
      ctx.userId,
      positiveInteger(payload.page, 'page', 1),
      pageSize(payload.pageSize),
    ),
  }),
  // ── 认知内核契约层（S2，2026-10-02）：合并收件箱 / 任务字段缺口 / 回填 ──
  // 只读聚合 + 缺值回填：回填走 po 的统一写路径，并回一张改动记录单（Delta）。
  // （总览通道随「总览页签」一并撤回：既有页面已各自承载那些信息，不另开页面。）
  'cognition.kernel.inbox': async (_payload: Payload, ctx: IpcContext) => cognitionKernel.readMergedInbox(ctx.userId),
  'cognition.kernel.taskFields': async ({ packId }: any = {}, ctx: IpcContext) => {
    const pack = cognitionKernel.getTaskFieldPack(String(packId ?? ''));
    if (!pack) throw new Error('unknown task field pack');
    return cognitionKernel.checkTaskFields(ctx.userId, pack);
  },
  'cognition.kernel.backfill': async ({ fieldName, value, groupTitle }: any = {}, ctx: IpcContext) => {
    if (typeof fieldName !== 'string' || !fieldName.trim()) throw new Error('invalid field name');
    if (typeof value !== 'string' || !value.trim()) throw new Error('invalid value');
    return cognitionKernel.backfillFieldValue(ctx.userId, {
      fieldName,
      value,
      ...(typeof groupTitle === 'string' && groupTitle.trim() ? { groupTitle } : {}),
    });
  },

  // ── 统一认知库（S3/S4-a）：存储快照、统一池、家注册表、迁移 ──────────────
  'cognition.store.snapshot': async (_payload: Payload, ctx: IpcContext) => {
    const doc = cognitionKernel.loadCognitionStoreSync(ctx.userId);
    return {
      objects: Object.values(doc.objects).map((o) => ({
        id: o.id,
        kind: o.kind,
        home: o.home,
        title: o.title,
        statement: o.statement,
        status: o.status,
        version: o.version,
        ...(o.fieldName ? { fieldName: o.fieldName } : {}),
        ...(o.groupId ? { groupId: o.groupId } : {}),
        ...(o.bundleKind ? { bundleKind: o.bundleKind } : {}),
        updatedAt: o.updatedAt,
      })),
      homes: doc.homes,
      updatedAt: doc.updatedAt,
    };
  },
  // 本体页面直接消费统一认知主档；保存和预览共用同一领域命令，不再写旧图谱文件。
  'cognition.ontology.snapshot': async (_payload: Payload, ctx: IpcContext) => ({ ontology: await readOntologyView(ctx.userId) }),
  'cognition.ontology.graph.query': async (payload: Payload, ctx: IpcContext) => ({
    graph: queryOntologyGraph(await readOntologyView(ctx.userId), {
      ...(typeof payload.moduleId === 'string' && payload.moduleId ? { moduleId: ontologyId(payload.moduleId, 'module id') } : {}),
      ...(typeof payload.at === 'string' && payload.at ? { at: payload.at } : {}),
      ...(typeof payload.focusId === 'string' && payload.focusId ? { focusId: ontologyId(payload.focusId, 'graph focus id') } : {}),
      ...(payload.contentScale !== undefined ? { contentScale: ontologyText(payload.contentScale, 'graph content scale', 20) as 'schema' | 'instances' } : {}),
      ...(typeof payload.includeRules === 'boolean' ? { includeRules: payload.includeRules } : {}),
      ...(payload.cursor ? { cursor: ontologyText(payload.cursor, 'graph cursor', 100) } : {}),
      ...(payload.definitionId ? { definitionId: ontologyId(payload.definitionId, 'graph relation') } : {}),
    }),
  }),
  'cognition.ontology.box.list': async (payload: Payload, ctx: IpcContext) => ({
    records: ontologyBox(await readOntologyView(ctx.userId), ontologyId(payload.moduleId, 'module id'), ontologyText(payload.box, 'box', 1)),
  }),
  'cognition.ontology.record.get': async (payload: Payload, ctx: IpcContext) => {
    const doc = await readOntologyView(ctx.userId), recordId = ontologyId(payload.recordId, 'record id');
    const record = doc.records[recordId];
    if (!record) throw new OntologyError('not_found', 'ontology record unavailable');
    if (typeof payload.moduleId === 'string' && payload.moduleId && !moduleCanUse(doc, ontologyId(payload.moduleId, 'module id'), record))
      throw new OntologyError('not_authorized', 'record is outside the selected ontology');
    return { record };
  },
  'cognition.ontology.search': async (payload: Payload, ctx: IpcContext) => ({
    results: searchOntologyRecords(await readOntologyView(ctx.userId), ontologyText(payload.query, 'query', 200),
      typeof payload.moduleId === 'string' && payload.moduleId ? ontologyId(payload.moduleId, 'module id') : undefined),
  }),
  'cognition.ontology.facts.query': async (payload: Payload, ctx: IpcContext) => ({
    facts: queryOntologyFacts(await readOntologyView(ctx.userId), {
      moduleId: ontologyId(payload.moduleId, 'module id'), at: ontologyText(payload.at, 'query date', 10),
      ...(typeof payload.subjectId === 'string' && payload.subjectId ? { subjectId: ontologyId(payload.subjectId, 'subject id') } : {}),
      ...(typeof payload.definitionId === 'string' && payload.definitionId ? { definitionId: ontologyId(payload.definitionId, 'definition id') } : {}),
      ...(typeof payload.knownAt === 'string' && payload.knownAt ? { knownAt: ontologyText(payload.knownAt, 'knowledge timestamp', 40) } : {}),
      ...(payload.knownRevision !== undefined ? { knownRevision: ontologyRevision(payload.knownRevision) } : {}),
    }),
  }),
  'cognition.ontology.rules.query': async (payload: Payload, ctx: IpcContext) => ({
    rules: queryOntologyRules(await readOntologyView(ctx.userId), { moduleId: ontologyId(payload.moduleId, 'module id'), task: {
      at: ontologyText(payload.at, 'query date', 10),
      ...(typeof payload.purpose === 'string' ? { purpose: ontologyText(payload.purpose, 'task purpose', 500) } : {}),
      ...(typeof payload.taskKind === 'string' ? { taskKind: ontologyText(payload.taskKind, 'task kind', 200) } : {}),
      ...(typeof payload.entityId === 'string' && payload.entityId ? { entityId: ontologyId(payload.entityId, 'entity id') } : {}),
      ...(typeof payload.knownAt === 'string' && payload.knownAt ? { knownAt: ontologyText(payload.knownAt, 'knowledge timestamp', 40) } : {}),
      ...(payload.knownRevision !== undefined ? { knownRevision: ontologyRevision(payload.knownRevision) } : {}),
    } }),
  }),
  'cognition.ontology.history.get': async (payload: Payload, ctx: IpcContext) => {
    const doc = await readOntologyView(ctx.userId), recordId = ontologyId(payload.recordId, 'record id');
    const limit = Math.min(500, positiveInteger(payload.limit, 'history limit', 100));
    const record = doc.records[recordId];
    if (!record) throw new OntologyError('not_found', 'ontology record unavailable');
    const relatedIds = new Set([recordId]);
    if (record?.kind === 'entity') for (const item of Object.values(doc.records)) {
      if (item.kind === 'assertion' && (item.subjectId === recordId || item.object.kind === 'entity' && item.object.id === recordId)) relatedIds.add(item.id);
    }
    const allHistory = doc.history.filter(row => relatedIds.has(row.after.id));
    const history = allHistory.slice(-limit).reverse();
    const usage = (await listOntologyUsageReceipts(ctx.userId)).filter(row => relatedIds.has(row.recordId)).slice(-limit).reverse();
    const version = payload.version === undefined ? undefined : positiveInteger(payload.version, 'record version', 1);
    const snapshot = version === undefined || version === record?.version ? record
      : [...doc.history].reverse().find(row => row.after.id === recordId && row.after.version === version)?.after;
    if (version !== undefined && !snapshot) throw new OntologyError('not_found', 'ontology version unavailable');
    return { history, record: snapshot || null, usage, historyTruncated: allHistory.length > limit };
  },
  'cognition.ontology.command.preview': async (payload: Payload, ctx: IpcContext) => {
    const outcome = previewOntologyCommand(ctx.userId, payload.command);
    return { receipt: outcome.receipt, duplicate: outcome.duplicate,
      changes: outcome.receipt.changedIds.map(id => outcome.document.records[id]) };
  },
  'cognition.ontology.command.commit': async (payload: Payload, ctx: IpcContext) => commitOntologyCommand(ctx.userId, payload.command),
  'cognition.ontology.candidate.commit': async (payload: Payload, ctx: IpcContext) => {
    if (payload.riskAcknowledged !== undefined && typeof payload.riskAcknowledged !== 'boolean')
      throw new OntologyError('invalid_input', 'risk acknowledgment must be boolean');
    return commitCandidateOntologyRecords(ctx.userId, {
      candidateId: ontologyId(payload.candidateId, 'candidate id'),
      moduleId: ontologyId(payload.moduleId, 'module id'),
      batchId: ontologyId(payload.batchId, 'candidate batch id'),
      ...(payload.riskAcknowledged === true ? { riskAcknowledged: true } : {}),
      command: payload.command,
    });
  },
  'cognition.ontology.candidate.complete': async (payload: Payload, ctx: IpcContext) =>
    completeCandidateOntologyHandoff(ctx.userId, ontologyId(payload.candidateId, 'candidate id')),
  'cognition.ontology.import.file': async (payload: Payload, ctx: IpcContext) => {
    if (payload.sourceId !== undefined) return { cancelled: false, ...await readOntologyImportSource(ctx.userId, ontologyId(payload.sourceId, 'source id')) };
    const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const labels = getRendererTables()[getCurrentUiLang()];
    const options = { title: labels['ontologyWorkspace.chooseImportFile'] || 'Choose a file', properties: ['openFile'] as Array<'openFile'>,
      filters: [{ name: labels['ontologyWorkspace.import'] || 'Documents', extensions: ['md', 'markdown', 'txt', 'pdf', 'docx'] }] };
    const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) return { cancelled: true };
    const imported = await extractOntologyImportFile(result.filePaths[0]);
    return { cancelled: false, ...imported };
  },
  'cognition.ontology.import.submit': async (payload: Payload, ctx: IpcContext) => {
    try {
    if (payload.mode !== undefined && !['source', 'extract'].includes(String(payload.mode))) throw new OntologyError('invalid_input', 'invalid import mode');
    if (payload.mode === 'extract') return extractOntologyImportCandidates(ctx.userId, ontologyText(payload.name, 'file name', 240), ontologyRawText(payload.text, 'import text', 100000));
    const allowedTypes = ['personal', 'fact', 'rule', 'template', 'skill_method'];
    if (payload.suggestedType !== undefined && !allowedTypes.includes(String(payload.suggestedType)))
      throw new OntologyError('invalid_input', 'unsupported ontology import type');
    return submitOntologyImport(ctx.userId, ontologyText(payload.name, 'file name', 240), ontologyRawText(payload.text, 'import text', 100_000),
      (payload.suggestedType || 'fact') as 'personal' | 'fact' | 'rule' | 'template' | 'skill_method');
    } catch (error) {
      if (error instanceof OntologyError) return { ok: false, code: error.code, error: error.message, details: error.details };
      throw error;
    }
  },
  'cognition.ontology.export': async (payload: Payload, ctx: IpcContext) => {
    const moduleId = payload.moduleId !== undefined ? ontologyId(payload.moduleId, 'ontology module id') : undefined;
    const { json, bytes } = await buildOntologyExport(ctx.userId, moduleId);
    const base = (moduleId ? moduleId : 'ontology').replace(/[\\/:*?"<>|\s]+/g, '-').slice(0, 40) || 'ontology';
    const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const options = { title: '导出本体 JSON 快照',
      defaultPath: `cogseed-ontology-${base}-${Date.now()}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }] };
    const result = parent ? await dialog.showSaveDialog(parent, options) : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return { ok: true, canceled: true };
    const fs = await import('node:fs');
    fs.writeFileSync(result.filePath, json, 'utf-8');
    return { ok: true, canceled: false, filePath: result.filePath, bytes };
  },
  'cognition.pool.list': async ({ status }: any = {}, ctx: IpcContext) => {
    const filter =
      status === 'pending' || status === 'deferred' || status === 'confirmed' || status === 'rejected'
        ? { status }
        : undefined;
    return cognitionKernel.listPool(ctx.userId, filter);
  },
  'cognition.pool.decide': async () => { throw new Error('Experimental pool is read-only; confirm through canonical cognition candidates'); },
  'cognition.pool.unrouted.list': async (_payload: Payload, ctx: IpcContext) => cognitionKernel.listUnrouted(ctx.userId),
  'cognition.pool.unrouted.decide': async () => { throw new Error('Experimental pool is read-only; submit through canonical cognition candidates'); },
  'cognition.homes.replace': async ({ homes }: any = {}, ctx: IpcContext) => {
    if (!Array.isArray(homes)) throw new Error('homes must be an array');
    return cognitionKernel.replaceCognitionHomes(ctx.userId, homes as never);
  },
  'cognition.migration.run': async ({ dryRun, activate, rollback }: any = {}, ctx: IpcContext) => {
    const { migrateLegacyCognition } = await import('../features/cognition_migration');
    if (rollback === true) {
      if (dryRun === true || activate === true) throw new Error('rollback cannot combine with dryRun/activate');
      const { rollbackCognitionAuthority } = await import('../features/cognition_bridge');
      await rollbackCognitionAuthority(ctx.userId);
      return { ok: true, mode: 'mirror' };
    }
    return migrateLegacyCognition(ctx.userId, { dryRun: dryRun === true, activate: activate === true });
  },

};
