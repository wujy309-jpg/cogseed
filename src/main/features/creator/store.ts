import * as fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import {
  userCreatorAuditFile,
  userCreatorDraftFile,
  userCreatorOperationJournalFile,
  userCreatorPresetStateFile,
  userCreatorPresetsDir,
  userCreatorPresetVersionsDir,
  userCreatorPresetVersionFile,
} from '../../paths';
import * as storage from '../../storage';
import { fileEditLock } from '../../util/locks';
import { sanitizeLogTextForUpload } from '../../util/log-sanitize';
import { validateCreatorPresetManifest } from './schema';
import type { CreatorPresetManifestV1 } from './types';

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/;
const CANONICAL_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const SENSITIVE_AUDIT_KEY = /api.?key|token|secret|password|private.?key|authorization|endpoint|base.?url|command|shell|import.?path/i;
const MAX_REDACTION_DEPTH = 20;
const OPERATION_CORRUPT = 'creator_operation_journal_corrupt';

export interface CreatorPresetDraft {
  schemaVersion: 1;
  draftId: string;
  manifest: CreatorPresetManifestV1;
  updatedAt: string;
}

export interface CreatorPresetState {
  schemaVersion: 1;
  presetId: string;
  activeVersion?: string;
  previousActiveVersion?: string;
  updatedAt?: string;
}

export interface CreatorPresetSummary {
  presetId: string;
  version: string;
  activeVersion?: string;
  previousActiveVersion?: string;
  displayName: string;
  description: string;
  presetType: CreatorPresetManifestV1['presetType'];
  updatedAt?: string;
}

export interface CreatorAuditRecord {
  schemaVersion: 1;
  auditId: string;
  event: string;
  createdAt: string;
  presetId?: string;
  version?: string;
  draftId?: string;
  metadata?: unknown;
}

export interface CreatorAuditInput {
  event: string;
  presetId?: string;
  version?: string;
  draftId?: string;
  metadata?: unknown;
}

type CreatorMutation =
  | { kind: 'draft.save'; draft: CreatorPresetDraft }
  | { kind: 'preset.publish'; draftId: string; manifest: CreatorPresetManifestV1 }
  | { kind: 'preset.activate' | 'preset.rollback'; state: CreatorPresetState };

interface CreatorOperation {
  schemaVersion: 1;
  operationId: string;
  createdAt: string;
  mutation: CreatorMutation;
  audit: CreatorAuditRecord;
}

type CreatorOperationJournalRecord =
  | { schemaVersion: 1; recordType: 'prepared'; operation: CreatorOperation }
  | { schemaVersion: 1; recordType: 'completed'; operationId: string; completedAt: string };

function isEnoent(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && IDENTIFIER.test(value);
}

function assertIdentifier(value: unknown, label: string): asserts value is string {
  if (!isIdentifier(value)) throw new Error(`creator_invalid_${label}`);
}

function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !CANONICAL_TIMESTAMP.test(value)) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function assertPlainObject(value: unknown, errorCode: string): asserts value is Record<string, unknown> {
  if (!isPlainObject(value)) throw new Error(errorCode);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = new Set(allowed);
  return Object.keys(value).every((key) => keys.has(key));
}

async function readJsonStrict(filePath: string, corruptError: string): Promise<unknown | null> {
  let text: string;
  try {
    text = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (isEnoent(error)) return null;
    throw error;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(corruptError);
  }
}

function validateDraft(value: unknown, errorCode = 'creator_draft_corrupt'): CreatorPresetDraft {
  assertPlainObject(value, errorCode);
  if (
    !hasOnlyKeys(value, ['schemaVersion', 'draftId', 'manifest', 'updatedAt'])
    || value.schemaVersion !== 1
    || !isIdentifier(value.draftId)
    || !isCanonicalTimestamp(value.updatedAt)
  ) throw new Error(errorCode);
  const manifest = validateCreatorPresetManifest(value.manifest);
  if (!manifest.ok) throw new Error(errorCode);
  return {
    schemaVersion: 1,
    draftId: value.draftId,
    manifest: manifest.value,
    updatedAt: value.updatedAt,
  };
}

function validateState(value: unknown, presetId: string, errorCode = 'creator_preset_state_corrupt'): CreatorPresetState {
  assertPlainObject(value, errorCode);
  if (
    !hasOnlyKeys(value, ['schemaVersion', 'presetId', 'activeVersion', 'previousActiveVersion', 'updatedAt'])
    || value.schemaVersion !== 1
    || value.presetId !== presetId
    || !isIdentifier(value.presetId)
    || (value.activeVersion !== undefined && !isIdentifier(value.activeVersion))
    || (value.previousActiveVersion !== undefined && !isIdentifier(value.previousActiveVersion))
    || (value.updatedAt !== undefined && !isCanonicalTimestamp(value.updatedAt))
  ) throw new Error(errorCode);
  const activeVersion = value.activeVersion as string | undefined;
  const previousActiveVersion = value.previousActiveVersion as string | undefined;
  const updatedAt = value.updatedAt as string | undefined;
  return {
    schemaVersion: 1,
    presetId,
    ...(activeVersion !== undefined ? { activeVersion } : {}),
    ...(previousActiveVersion !== undefined ? { previousActiveVersion } : {}),
    ...(updatedAt !== undefined ? { updatedAt } : {}),
  };
}

function validateAuditRecord(value: unknown, errorCode = 'creator_audit_corrupt'): CreatorAuditRecord {
  assertPlainObject(value, errorCode);
  if (
    !hasOnlyKeys(value, ['schemaVersion', 'auditId', 'event', 'createdAt', 'presetId', 'version', 'draftId', 'metadata'])
    || value.schemaVersion !== 1
    || !isIdentifier(value.auditId)
    || !isIdentifier(value.event)
    || !isCanonicalTimestamp(value.createdAt)
    || (value.presetId !== undefined && !isIdentifier(value.presetId))
    || (value.version !== undefined && !isIdentifier(value.version))
    || (value.draftId !== undefined && !isIdentifier(value.draftId))
  ) throw new Error(errorCode);
  const presetId = value.presetId as string | undefined;
  const version = value.version as string | undefined;
  const draftId = value.draftId as string | undefined;
  return {
    schemaVersion: 1,
    auditId: value.auditId,
    event: value.event,
    createdAt: value.createdAt,
    ...(presetId !== undefined ? { presetId } : {}),
    ...(version !== undefined ? { version } : {}),
    ...(draftId !== undefined ? { draftId } : {}),
    ...(Object.prototype.hasOwnProperty.call(value, 'metadata') ? { metadata: value.metadata } : {}),
  };
}

function validatePersistedManifest(
  value: unknown,
  presetId: string,
  version: string,
  errorCode = 'creator_preset_version_corrupt',
): CreatorPresetManifestV1 {
  const result = validateCreatorPresetManifest(value);
  if (!result.ok || result.value.presetId !== presetId || result.value.version !== version) {
    throw new Error(errorCode);
  }
  return result.value;
}

function redactAuditValue(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (depth > MAX_REDACTION_DEPTH) return '[REDACTED]';
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') return sanitizeLogTextForUpload(value);
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol') return undefined;
  const objectValue = value as object;
  if (seen.has(objectValue)) return '[REDACTED]';
  seen.add(objectValue);
  if (Array.isArray(value)) return value.map((entry) => redactAuditValue(entry, depth + 1, seen));
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    output[key] = SENSITIVE_AUDIT_KEY.test(key) ? '[REDACTED]' : redactAuditValue(entry, depth + 1, seen);
  }
  return output;
}

function createAuditRecord(input: CreatorAuditInput): CreatorAuditRecord {
  if (!isIdentifier(input.event)) throw new Error('creator_invalid_audit_event');
  if (input.presetId !== undefined) assertIdentifier(input.presetId, 'preset_id');
  if (input.version !== undefined) assertIdentifier(input.version, 'version');
  if (input.draftId !== undefined) assertIdentifier(input.draftId, 'draft_id');
  return {
    schemaVersion: 1,
    auditId: randomUUID(),
    event: input.event,
    createdAt: new Date().toISOString(),
    ...(input.presetId !== undefined ? { presetId: input.presetId } : {}),
    ...(input.version !== undefined ? { version: input.version } : {}),
    ...(input.draftId !== undefined ? { draftId: input.draftId } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, 'metadata') ? { metadata: redactAuditValue(input.metadata) } : {}),
  };
}

function validateOperation(value: unknown): CreatorOperation {
  assertPlainObject(value, OPERATION_CORRUPT);
  if (
    !hasOnlyKeys(value, ['schemaVersion', 'operationId', 'createdAt', 'mutation', 'audit'])
    || value.schemaVersion !== 1
    || !isIdentifier(value.operationId)
    || !isCanonicalTimestamp(value.createdAt)
  ) throw new Error(OPERATION_CORRUPT);
  const audit = validateAuditRecord(value.audit, OPERATION_CORRUPT);
  assertPlainObject(value.mutation, OPERATION_CORRUPT);
  const mutation = value.mutation;
  let validatedMutation: CreatorMutation;
  if (mutation.kind === 'draft.save') {
    if (!hasOnlyKeys(mutation, ['kind', 'draft'])) throw new Error(OPERATION_CORRUPT);
    validatedMutation = { kind: 'draft.save', draft: validateDraft(mutation.draft, OPERATION_CORRUPT) };
    if (audit.event !== 'draft.saved' || audit.draftId !== validatedMutation.draft.draftId || audit.presetId !== validatedMutation.draft.manifest.presetId) {
      throw new Error(OPERATION_CORRUPT);
    }
  } else if (mutation.kind === 'preset.publish') {
    if (!hasOnlyKeys(mutation, ['kind', 'draftId', 'manifest']) || !isIdentifier(mutation.draftId)) throw new Error(OPERATION_CORRUPT);
    const rawManifest = mutation.manifest;
    assertPlainObject(rawManifest, OPERATION_CORRUPT);
    if (!isIdentifier(rawManifest.presetId) || !isIdentifier(rawManifest.version)) throw new Error(OPERATION_CORRUPT);
    const manifest = validatePersistedManifest(rawManifest, rawManifest.presetId, rawManifest.version, OPERATION_CORRUPT);
    validatedMutation = { kind: 'preset.publish', draftId: mutation.draftId, manifest };
    if (audit.event !== 'preset.version_published' || audit.draftId !== mutation.draftId || audit.presetId !== manifest.presetId || audit.version !== manifest.version) {
      throw new Error(OPERATION_CORRUPT);
    }
  } else if (mutation.kind === 'preset.activate' || mutation.kind === 'preset.rollback') {
    if (!hasOnlyKeys(mutation, ['kind', 'state'])) throw new Error(OPERATION_CORRUPT);
    assertPlainObject(mutation.state, OPERATION_CORRUPT);
    if (!isIdentifier(mutation.state.presetId)) throw new Error(OPERATION_CORRUPT);
    const state = validateState(mutation.state, mutation.state.presetId, OPERATION_CORRUPT);
    validatedMutation = { kind: mutation.kind, state };
    const expectedEvent = mutation.kind === 'preset.activate' ? 'preset.activated' : 'preset.rolled_back';
    if (audit.event !== expectedEvent || audit.presetId !== state.presetId || audit.version !== state.activeVersion) {
      throw new Error(OPERATION_CORRUPT);
    }
  } else {
    throw new Error(OPERATION_CORRUPT);
  }
  return {
    schemaVersion: 1,
    operationId: value.operationId,
    createdAt: value.createdAt,
    mutation: validatedMutation,
    audit,
  };
}

function validateJournalRecord(value: unknown): CreatorOperationJournalRecord {
  assertPlainObject(value, OPERATION_CORRUPT);
  if (value.schemaVersion !== 1) throw new Error(OPERATION_CORRUPT);
  if (value.recordType === 'prepared') {
    if (!hasOnlyKeys(value, ['schemaVersion', 'recordType', 'operation'])) throw new Error(OPERATION_CORRUPT);
    return { schemaVersion: 1, recordType: 'prepared', operation: validateOperation(value.operation) };
  }
  if (value.recordType === 'completed') {
    if (
      !hasOnlyKeys(value, ['schemaVersion', 'recordType', 'operationId', 'completedAt'])
      || !isIdentifier(value.operationId)
      || !isCanonicalTimestamp(value.completedAt)
    ) throw new Error(OPERATION_CORRUPT);
    return { schemaVersion: 1, recordType: 'completed', operationId: value.operationId, completedAt: value.completedAt };
  }
  throw new Error(OPERATION_CORRUPT);
}

async function readJsonlRecords(filePath: string, corruptError: string): Promise<unknown[]> {
  let bytes: Buffer;
  try {
    bytes = await fs.readFile(filePath);
  } catch (error) {
    if (isEnoent(error)) return [];
    throw error;
  }
  const records: unknown[] = [];
  let lineStart = 0;
  for (let index = 0; index < bytes.length; index += 1) {
    if (bytes[index] !== 0x0a) continue;
    const line = bytes.subarray(lineStart, index).toString('utf8');
    if (!line.trim()) throw new Error(corruptError);
    try {
      records.push(JSON.parse(line) as unknown);
    } catch {
      throw new Error(corruptError);
    }
    lineStart = index + 1;
  }

  if (lineStart < bytes.length) {
    const fragment = bytes.subarray(lineStart).toString('utf8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(fragment) as unknown;
    } catch {
      // Only a non-newline-terminated final fragment is repairable. Every
      // complete row above has already been parsed, so malformed middle rows
      // can never be hidden by this truncation.
      await fs.truncate(filePath, lineStart);
      storage.invalidateLineCount(filePath);
      return records;
    }
    records.push(parsed);
    await fs.appendFile(filePath, '\n', 'utf8');
  }
  return records;
}

async function readAuditInternal(userId: string): Promise<CreatorAuditRecord[]> {
  const rows = await readJsonlRecords(userCreatorAuditFile(userId), 'creator_audit_corrupt');
  return rows.map((row) => validateAuditRecord(row));
}

async function repairFinalJsonlFragment(filePath: string): Promise<void> {
  let handle: fs.FileHandle;
  try {
    handle = await fs.open(filePath, 'r+');
  } catch (error) {
    if (isEnoent(error)) return;
    throw error;
  }
  try {
    const { size } = await handle.stat();
    if (size === 0) return;
    const lastByte = Buffer.allocUnsafe(1);
    const lastRead = await handle.read(lastByte, 0, 1, size - 1);
    if (lastRead.bytesRead !== 1) throw new Error('creator_audit_io_error');
    if (lastByte[0] === 0x0a) return;

    const chunks: Buffer[] = [];
    let cursor = size;
    let lineStart = 0;
    while (cursor > 0) {
      const blockStart = Math.max(0, cursor - 8_192);
      const block = Buffer.allocUnsafe(cursor - blockStart);
      let bytesRead = 0;
      while (bytesRead < block.length) {
        const read = await handle.read(block, bytesRead, block.length - bytesRead, blockStart + bytesRead);
        if (read.bytesRead === 0) throw new Error('creator_audit_io_error');
        bytesRead += read.bytesRead;
      }
      const bytes = block.subarray(0, bytesRead);
      let newline = -1;
      for (let index = bytes.length - 1; index >= 0; index -= 1) {
        if (bytes[index] === 0x0a) {
          newline = index;
          break;
        }
      }
      if (newline >= 0) {
        lineStart = blockStart + newline + 1;
        chunks.unshift(bytes.subarray(newline + 1));
        break;
      }
      chunks.unshift(bytes);
      cursor = blockStart;
    }

    const fragment = Buffer.concat(chunks).toString('utf8');
    let validFragment = true;
    try {
      JSON.parse(fragment);
    } catch {
      validFragment = false;
    }
    if (validFragment) {
      const write = await handle.write(Buffer.from('\n'), 0, 1, size);
      if (write.bytesWritten !== 1) throw new Error('creator_audit_io_error');
    } else {
      await handle.truncate(lineStart);
      storage.invalidateLineCount(filePath);
    }
  } finally {
    await handle.close();
  }
}

async function appendAuditRecordFresh(userId: string, record: CreatorAuditRecord): Promise<CreatorAuditRecord> {
  const auditFile = userCreatorAuditFile(userId);
  await repairFinalJsonlFragment(auditFile);
  await storage.appendJsonl(auditFile, record);
  return record;
}

async function appendAuditRecordForRecovery(userId: string, record: CreatorAuditRecord): Promise<CreatorAuditRecord> {
  const auditFile = userCreatorAuditFile(userId);
  return fileEditLock(auditFile).runExclusive(async () => {
    const records = await readAuditInternal(userId);
    const existing = records.find((candidate) => candidate.auditId === record.auditId);
    if (existing) {
      if (!isDeepStrictEqual(existing, record)) throw new Error('creator_audit_corrupt');
      return existing;
    }
    await storage.appendJsonl(auditFile, record);
    return record;
  });
}

async function readDraftInternal(userId: string, draftId: string): Promise<CreatorPresetDraft | null> {
  const raw = await readJsonStrict(userCreatorDraftFile(userId, draftId), 'creator_draft_corrupt');
  return raw === null ? null : validateDraft(raw);
}

async function readPresetVersionInternal(userId: string, presetId: string, version: string): Promise<CreatorPresetManifestV1 | null> {
  const raw = await readJsonStrict(userCreatorPresetVersionFile(userId, presetId, version), 'creator_preset_version_corrupt');
  return raw === null ? null : validatePersistedManifest(raw, presetId, version);
}

async function readPresetStateInternal(userId: string, presetId: string): Promise<CreatorPresetState> {
  const raw = await readJsonStrict(userCreatorPresetStateFile(userId, presetId), 'creator_preset_state_corrupt');
  return raw === null ? { schemaVersion: 1, presetId } : validateState(raw, presetId);
}

async function applyOperationMutation(userId: string, mutation: CreatorMutation): Promise<void> {
  if (mutation.kind === 'draft.save') {
    await storage.writeJson(userCreatorDraftFile(userId, mutation.draft.draftId), mutation.draft);
    return;
  }
  if (mutation.kind === 'preset.publish') {
    const file = userCreatorPresetVersionFile(userId, mutation.manifest.presetId, mutation.manifest.version);
    const existing = await readJsonStrict(file, 'creator_preset_version_corrupt');
    if (existing === null) {
      await storage.writeJson(file, mutation.manifest);
      return;
    }
    const validated = validatePersistedManifest(existing, mutation.manifest.presetId, mutation.manifest.version);
    if (!isDeepStrictEqual(validated, mutation.manifest)) throw new Error('creator_operation_conflict');
    return;
  }
  await storage.writeJson(userCreatorPresetStateFile(userId, mutation.state.presetId), mutation.state);
}

async function appendJournalRecord(userId: string, record: CreatorOperationJournalRecord): Promise<void> {
  await storage.appendJsonl(userCreatorOperationJournalFile(userId), record);
}

async function replayOperation(userId: string, operation: CreatorOperation, recovering: boolean): Promise<void> {
  await applyOperationMutation(userId, operation.mutation);
  if (recovering) await appendAuditRecordForRecovery(userId, operation.audit);
  else await appendAuditRecordFresh(userId, operation.audit);
  await appendJournalRecord(userId, {
    schemaVersion: 1,
    recordType: 'completed',
    operationId: operation.operationId,
    completedAt: new Date().toISOString(),
  });
}

async function pendingOperations(userId: string): Promise<CreatorOperation[]> {
  const rawRecords = await readJsonlRecords(userCreatorOperationJournalFile(userId), OPERATION_CORRUPT);
  const pending = new Map<string, CreatorOperation>();
  const completed = new Set<string>();
  for (const raw of rawRecords) {
    const record = validateJournalRecord(raw);
    if (record.recordType === 'prepared') {
      if (pending.has(record.operation.operationId) || completed.has(record.operation.operationId)) throw new Error(OPERATION_CORRUPT);
      pending.set(record.operation.operationId, record.operation);
    } else {
      if (!pending.has(record.operationId) || completed.has(record.operationId)) throw new Error(OPERATION_CORRUPT);
      pending.delete(record.operationId);
      completed.add(record.operationId);
    }
  }
  return [...pending.values()];
}

async function compactSettledJournal(userId: string): Promise<void> {
  if ((await pendingOperations(userId)).length > 0) return;
  const journalFile = userCreatorOperationJournalFile(userId);
  await fs.rm(journalFile, { force: true });
  storage.invalidateLineCount(journalFile);
}

async function recoverOperationsUnlocked(userId: string): Promise<number> {
  const pending = await pendingOperations(userId);
  for (const operation of pending) await replayOperation(userId, operation, true);
  await compactSettledJournal(userId);
  return pending.length;
}

function createOperation(mutation: CreatorMutation, auditInput: CreatorAuditInput): CreatorOperation {
  const createdAt = new Date().toISOString();
  return {
    schemaVersion: 1,
    operationId: randomUUID(),
    createdAt,
    mutation,
    audit: createAuditRecord(auditInput),
  };
}

async function commitOperationUnlocked(userId: string, operation: CreatorOperation): Promise<void> {
  await appendJournalRecord(userId, { schemaVersion: 1, recordType: 'prepared', operation });
  await replayOperation(userId, operation, false);
  await compactSettledJournal(userId);
}

async function withCreatorStoreLock<T>(userId: string, action: () => Promise<T>): Promise<T> {
  return fileEditLock(userCreatorOperationJournalFile(userId)).runExclusive(async () => {
    await recoverOperationsUnlocked(userId);
    return action();
  });
}

export async function recoverCreatorStoreOperations(userId: string): Promise<number> {
  return fileEditLock(userCreatorOperationJournalFile(userId)).runExclusive(() => recoverOperationsUnlocked(userId));
}

export async function saveCreatorDraft(userId: string, draft: CreatorPresetDraft): Promise<CreatorPresetDraft> {
  const validated = validateDraft(draft);
  return withCreatorStoreLock(userId, async () => {
    await commitOperationUnlocked(userId, createOperation(
      { kind: 'draft.save', draft: validated },
      { event: 'draft.saved', draftId: validated.draftId, presetId: validated.manifest.presetId },
    ));
    return validated;
  });
}

export async function readCreatorDraft(userId: string, draftId: string): Promise<CreatorPresetDraft | null> {
  assertIdentifier(draftId, 'draft_id');
  return withCreatorStoreLock(userId, () => readDraftInternal(userId, draftId));
}

export async function publishCreatorPresetVersion(
  userId: string,
  draftId: string,
  version: string,
): Promise<CreatorPresetManifestV1> {
  assertIdentifier(draftId, 'draft_id');
  assertIdentifier(version, 'version');
  return withCreatorStoreLock(userId, async () => {
    const draft = await readDraftInternal(userId, draftId);
    if (!draft) throw new Error('creator_draft_not_found');
    const candidate = { ...draft.manifest, version };
    const result = validateCreatorPresetManifest(candidate);
    if (!result.ok) throw new Error('creator_preset_version_invalid');
    if (await readPresetVersionInternal(userId, result.value.presetId, version)) {
      throw new Error('creator_preset_version_exists');
    }
    await commitOperationUnlocked(userId, createOperation(
      { kind: 'preset.publish', draftId, manifest: result.value },
      { event: 'preset.version_published', draftId, presetId: result.value.presetId, version },
    ));
    return result.value;
  });
}

export async function readCreatorPresetVersion(
  userId: string,
  presetId: string,
  version: string,
): Promise<CreatorPresetManifestV1 | null> {
  assertIdentifier(presetId, 'preset_id');
  assertIdentifier(version, 'version');
  return withCreatorStoreLock(userId, () => readPresetVersionInternal(userId, presetId, version));
}

export async function readCreatorPresetState(userId: string, presetId: string): Promise<CreatorPresetState> {
  assertIdentifier(presetId, 'preset_id');
  return withCreatorStoreLock(userId, () => readPresetStateInternal(userId, presetId));
}

async function listPresetSummariesInternal(userId: string): Promise<CreatorPresetSummary[]> {
  let entries: Array<{ name: string; isDirectory(): boolean }>;
  try {
    entries = await fs.readdir(userCreatorPresetsDir(userId), { withFileTypes: true });
  } catch (error) {
    if (isEnoent(error)) return [];
    throw error;
  }
  const summaries = await Promise.all(entries
    .filter((entry) => entry.isDirectory() && IDENTIFIER.test(entry.name))
    .map(async (entry): Promise<CreatorPresetSummary | null> => {
      const presetId = entry.name;
      const state = await readPresetStateInternal(userId, presetId);
      let versions: string[];
      try {
        versions = (await fs.readdir(userCreatorPresetVersionsDir(userId, presetId)))
          .filter((name) => name.endsWith('.json'))
          .map((name) => name.slice(0, -5))
          .filter((version) => IDENTIFIER.test(version))
          .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }));
      } catch (error) {
        if (isEnoent(error)) return null;
        throw error;
      }
      const version = state.activeVersion ?? versions[0];
      if (!version) return null;
      const manifest = await readPresetVersionInternal(userId, presetId, version);
      if (!manifest) return null;
      return {
        presetId,
        version,
        ...(state.activeVersion ? { activeVersion: state.activeVersion } : {}),
        ...(state.previousActiveVersion ? { previousActiveVersion: state.previousActiveVersion } : {}),
        displayName: manifest.displayName,
        description: manifest.description,
        presetType: manifest.presetType,
        ...(state.updatedAt ? { updatedAt: state.updatedAt } : {}),
      };
    }));
  return summaries
    .filter((summary): summary is CreatorPresetSummary => summary !== null)
    .sort((left, right) => left.presetId.localeCompare(right.presetId));
}

export async function listCreatorPresetSummaries(userId: string): Promise<CreatorPresetSummary[]> {
  return withCreatorStoreLock(userId, () => listPresetSummariesInternal(userId));
}

export async function activateCreatorPresetVersion(
  userId: string,
  presetId: string,
  version: string,
): Promise<CreatorPresetState> {
  assertIdentifier(presetId, 'preset_id');
  assertIdentifier(version, 'version');
  return withCreatorStoreLock(userId, async () => {
    if (!await readPresetVersionInternal(userId, presetId, version)) throw new Error('creator_preset_version_not_found');
    const current = await readPresetStateInternal(userId, presetId);
    const next: CreatorPresetState = {
      schemaVersion: 1,
      presetId,
      activeVersion: version,
      ...(current.activeVersion && current.activeVersion !== version
        ? { previousActiveVersion: current.activeVersion }
        : current.previousActiveVersion ? { previousActiveVersion: current.previousActiveVersion } : {}),
      updatedAt: new Date().toISOString(),
    };
    await commitOperationUnlocked(userId, createOperation(
      { kind: 'preset.activate', state: next },
      { event: 'preset.activated', presetId, version },
    ));
    return next;
  });
}

export async function rollbackCreatorPreset(
  userId: string,
  presetId: string,
  version: string,
): Promise<CreatorPresetState> {
  assertIdentifier(presetId, 'preset_id');
  assertIdentifier(version, 'version');
  return withCreatorStoreLock(userId, async () => {
    if (!await readPresetVersionInternal(userId, presetId, version)) throw new Error('creator_preset_version_not_found');
    const current = await readPresetStateInternal(userId, presetId);
    const next: CreatorPresetState = {
      schemaVersion: 1,
      presetId,
      activeVersion: version,
      ...(current.activeVersion && current.activeVersion !== version ? { previousActiveVersion: current.activeVersion } : {}),
      updatedAt: new Date().toISOString(),
    };
    await commitOperationUnlocked(userId, createOperation(
      { kind: 'preset.rollback', state: next },
      { event: 'preset.rolled_back', presetId, version, metadata: { fromVersion: current.activeVersion } },
    ));
    return next;
  });
}

export async function appendCreatorAudit(userId: string, input: CreatorAuditInput): Promise<CreatorAuditRecord> {
  return withCreatorStoreLock(userId, async () => appendAuditRecordFresh(userId, createAuditRecord(input)));
}

export async function listCreatorAudit(userId: string): Promise<CreatorAuditRecord[]> {
  return withCreatorStoreLock(userId, () => readAuditInternal(userId));
}
