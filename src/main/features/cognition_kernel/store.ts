/**
 * cognition_kernel/store — 统一认知库存储内核（S3）。
 *
 * 单一事实源：`<uid>/cloud/cognition/cognition-store.json`（object-model.ts 的
 * CognitionStoreDocument）。一切写入皆 Delta：唯一写入口 applyCognitionDeltas
 * （锁 → 加载 → 坏档门 → 纯函数落地 → 原子写主档 → 版本流追加 → 台账追加）。
 *
 * 工程骨架吸收 po v2（文件锁/坏档三件套/原子写/schemaVersion）与 recall
 * （每对象 append-only 版本流 jsonl）。落盘形态=单 JSON 主档+版本流+台账，
 * 不做事件溯源——云同步单元保持单文件（B 路线总览 v0.2 §2.2）。
 *
 * 本模块是可剥离内核：只依赖 node fs 与仓内基础层（storage/paths/locks/
 * corrupt-guard/logger），不 import electron/ipc/renderer/索引器——索引与
 * 通知钩子在消费面重接（S4）时以注入方式挂回。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileEditLock } from '../../util/locks';
import { corruptRecordFor, readTextGuarded, reportCorruptFile } from '../../util/corrupt-guard';
import { userCognitionDir } from '../../paths';
import { genId12, nowIso, safeId } from '../../storage';
import { createLogger } from '../../logger';
import type { CognitionDelta } from './types';
import { validateDelta } from './delta';
import {
  COGNITION_STORE_SCHEMA_VERSION,
  APPLIED_DELTA_INDEX_MAX,
  DEFAULT_HOME_REGISTRY,
  type CognitionObject,
  type CognitionObjectKind,
  type CognitionStoreDocument,
  type HomeRegistryEntry,
  emptyCognitionStore,
  findAssertionSlot,
  normalizeCognitionStoreDocument,
  storeShapeForHomes,
  validateHomeRegistry,
} from './object-model';

const log = createLogger('cognition-store');

/** 坏档三件套的业务域名（恢复通道按 domain 寻址，与 po / ontology-candidates 并列）。 */
export const COGNITION_STORE_CORRUPT_DOMAIN = 'cognition-store';

const VERSIONS_DIR = 'cognition-versions';
const AUDIT_FILE = 'cognition-audit.jsonl';
const AUDIT_SUMMARY_MAX_CHARS = 200;
const VERSION_LINE_MAX = 5000;

export function cognitionStorePath(uid: string): string {
  return path.join(userCognitionDir(uid), 'cognition-store.json');
}

function versionsDir(uid: string): string {
  return path.join(userCognitionDir(uid), VERSIONS_DIR);
}

function versionStreamPath(uid: string, objectId: string): string {
  return path.join(versionsDir(uid), `${objectId}.jsonl`);
}

export function cognitionAuditPath(uid: string): string {
  return path.join(userCognitionDir(uid), AUDIT_FILE);
}

// ── 读取 ─────────────────────────────────────────────────────────────────

/**
 * 同步加载：坏档三件套读侧（copy 备份 + 登记拒写 latch）后返回空库供展示；
 * ENOENT → 空库（懒创建，读路径零副作用、永不写盘）。
 */
export function loadCognitionStoreSync(uid: string): CognitionStoreDocument {
  if (!safeId(uid)) return emptyCognitionStore();
  const filePath = cognitionStorePath(uid);
  if (!fs.existsSync(filePath)) return emptyCognitionStore();
  const guarded = readTextGuarded(filePath, { domain: COGNITION_STORE_CORRUPT_DOMAIN });
  if (guarded.status === 'corrupt') return emptyCognitionStore();
  if (guarded.status !== 'ok') return emptyCognitionStore();
  try {
    const parsed = JSON.parse(guarded.text) as Record<string, unknown>;
    if (parsed.schemaVersion !== COGNITION_STORE_SCHEMA_VERSION) {
      // 版本不符属「未来档」：按坏档处理（不猜结构），等迁移通道升版。
      reportCorruptFile(filePath, `unsupported schemaVersion ${String(parsed.schemaVersion)}`, {
        domain: COGNITION_STORE_CORRUPT_DOMAIN,
      });
      return emptyCognitionStore();
    }
    return normalizeCognitionStoreDocument(parsed);
  } catch (err) {
    reportCorruptFile(filePath, `bad JSON: ${(err as Error).message}`, {
      domain: COGNITION_STORE_CORRUPT_DOMAIN,
    });
    log.warn('cognition store unreadable; corrupt-guard engaged', { uid, error: (err as Error).message });
    return emptyCognitionStore();
  }
}

// ── 纯函数落地器 ─────────────────────────────────────────────────────────

export type DeltaApplyResult =
  | { applied: true; objectId: string; op: CognitionDelta['op'] }
  | { applied: false; reason: string; duplicate?: boolean };

/** 硬失败（非重复跳过）才让整批回滚；duplicate 是合法的幂等跳过。 */
function isDeltaFailure(r: DeltaApplyResult): r is Extract<DeltaApplyResult, { applied: false }> {
  return r.applied === false && r.duplicate !== true;
}

function rememberAppliedDelta(doc: CognitionStoreDocument, delta: CognitionDelta): void {
  // 幂等口径=按 deltaId 精确重放去重（双提交/崩溃重试）；槽位键（idempotencyKey）
  // 是候选池「同槽只留最新提议」的语义，不用于存储侧——同一对象的后续变更
  // 是新 Delta，必须放行（2026-10-02 修正：首版误用槽位键导致 set→set 升版被吞）。
  doc.appliedDeltas[delta.deltaId] = true;
  doc.appliedOrder.push(delta.deltaId);
  while (doc.appliedOrder.length > APPLIED_DELTA_INDEX_MAX) {
    const oldest = doc.appliedOrder.shift();
    if (oldest) delete doc.appliedDeltas[oldest];
  }
}

function newObject(
  delta: CognitionDelta,
  shape: { kind: CognitionObjectKind; bundleKind?: string },
  now: string,
): CognitionObject | null {
  const id = delta.target.objectId?.trim() || `co-${genId12()}`;
  const isAssertion = shape.kind === 'assertion';
  return {
    id,
    kind: shape.kind,
    home: delta.target.home,
    title: (isAssertion ? delta.target.fieldName ?? delta.after ?? '' : delta.after ?? '').slice(0, 200),
    statement: delta.after ?? '',
    origin: delta.origin,
    status: 'active',
    version: 1,
    createdAt: now,
    updatedAt: now,
    ...(delta.target.groupId ? { groupId: delta.target.groupId } : {}),
    ...(delta.target.fieldName ? { fieldName: delta.target.fieldName } : {}),
    ...(shape.bundleKind ? { bundleKind: shape.bundleKind as CognitionObject['bundleKind'] } : {}),
    ...(delta.evidenceRefs.length ? { evidenceRefs: [...delta.evidenceRefs] } : {}),
  };
}

/**
 * 单个 Delta 的纯落地（不碰盘）。op 语义：
 *  add=新建对象；update=按 objectId 改 statement/title 并升版；
 *  set=断言槽位 (groupId,fieldName) 赋值（无则建）；remove=软删（留墓碑）。
 * 幂等：同一 idempotencyKey 重复落地 → duplicate 跳过；status≠applied 一律拒收
 *（proposed 属候选池，不进本库）。
 */
export function applyCognitionDelta(doc: CognitionStoreDocument, delta: CognitionDelta): DeltaApplyResult {
  const knownHomes = new Set<string>(doc.homes.map((entry) => entry.home));
  const checked = validateDelta(delta, knownHomes);
  if (checked.ok === false) {
    return { applied: false, reason: `invalid delta: ${checked.reason}` };
  }
  if (delta.status !== 'applied') {
    return { applied: false, reason: `delta status '${delta.status}' not appliable (proposed 属候选池)` };
  }
  if (doc.appliedDeltas[delta.deltaId]) {
    return { applied: false, reason: 'delta already applied (exact replay)', duplicate: true };
  }
  const objectId0 = delta.target.objectId?.trim() ?? '';
  if (objectId0 && !safeId(objectId0)) {
    return { applied: false, reason: 'invalid objectId' };
  }
  const shape = storeShapeForHomes(doc.homes, delta.target.home);
  if (!shape) {
    return { applied: false, reason: `家 '${delta.target.home}' 不可存（experience/task_local 类只判不存，走各自支撑位）` };
  }
  const now = new Date().toISOString();

  let objectId = delta.target.objectId?.trim() || '';
  if (delta.op === 'add') {
    if (objectId && doc.objects[objectId]) {
      return { applied: false, reason: `object ${objectId} already exists` };
    }
    const created = newObject(delta, shape, now);
    if (!created) return { applied: false, reason: 'cannot build object from delta' };
    objectId = created.id;
    doc.objects[objectId] = created;
  } else if (delta.op === 'set') {
    if (shape.kind !== 'assertion') {
      return { applied: false, reason: 'op set 只用于断言槽位（rule/bundle 用 update）' };
    }
    const slot = findAssertionSlot(doc, delta.target.groupId, delta.target.fieldName ?? '');
    if (slot) {
      if (slot.managedSource) return { applied: false, reason: 'source-managed slot; use canonical business API' };
      slot.statement = delta.after ?? '';
      slot.updatedAt = now;
      slot.version += 1;
      objectId = slot.id;
    } else {
      const created = newObject(delta, shape, now);
      if (!created) return { applied: false, reason: 'cannot build assertion from delta' };
      objectId = created.id;
      doc.objects[objectId] = created;
    }
  } else {
    // update / remove：必须能定位对象（objectId 或断言槽位）。
    let target: CognitionObject | undefined =
      (objectId && doc.objects[objectId]) || undefined;
    if (!target && shape.kind === 'assertion') {
      target = findAssertionSlot(doc, delta.target.groupId, delta.target.fieldName ?? '');
    }
    if (!target) return { applied: false, reason: `object not found: ${objectId || delta.target.fieldName || '?'}` };
    objectId = target.id;
    if (target.managedSource) return { applied: false, reason: 'source-managed object; use canonical business API' };
    if (delta.op === 'update') {
      if (target.status === 'deleted') return { applied: false, reason: `object ${objectId} 已删除，先恢复再改` };
      target.statement = delta.after ?? '';
      if (delta.target.fieldName) target.fieldName = delta.target.fieldName;
      target.updatedAt = now;
      target.version += 1;
    } else {
      target.status = 'deleted';
      target.deletedAt = now;
      target.updatedAt = now;
    }
  }
  rememberAppliedDelta(doc, delta);
  doc.updatedAt = now;
  return { applied: true, objectId, op: delta.op };
}

// ── 持久化（唯一写入口）─────────────────────────────────────────────────

export interface ApplyDeltasOutcome {
  ok: boolean;
  error?: string;
  results: DeltaApplyResult[];
  appliedCount: number;
}

interface VersionLine {
  at: string;
  deltaId: string;
  op: string;
  version: number;
  origin: string;
  before?: string;
  after?: string;
}

function appendJsonl(filePath: string, line: unknown, maxChars: number): void {
  const text = JSON.stringify(line);
  if (text.length > maxChars) return; // 超长行整体不写（台账/版本流宁可缺行不可坏行）
  fs.appendFileSync(filePath, text + '\n', 'utf8');
}

function summary(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > AUDIT_SUMMARY_MAX_CHARS ? `${t.slice(0, AUDIT_SUMMARY_MAX_CHARS)}…` : t;
}

/**
 * 唯一写入口：文件锁内 加载→坏档门→逐个纯落地→原子写主档→版本流→台账。
 * 全批原子语义：任何一个 Delta 非法/失败都不落盘（要么全生效，要么全不动）。
 */
export async function applyCognitionDeltas(uid: string, deltas: readonly CognitionDelta[]): Promise<ApplyDeltasOutcome> {
  if (!safeId(uid)) return { ok: false, error: 'invalid uid', results: [], appliedCount: 0 };
  const filePath = cognitionStorePath(uid);
  return fileEditLock(filePath).runExclusive(async () => {
    const doc = loadCognitionStoreSync(uid);
    const corrupt = corruptRecordFor(filePath);
    if (corrupt) {
      log.warn('cognition store corrupt; write refused', { uid, reason: corrupt.reason });
      return { ok: false, error: `cognition store corrupt; write refused (${corrupt.reason}); use backup recovery`, results: [], appliedCount: 0 };
    }
    // 先在副本上全批落地，全部成功才替换文档（全或无）。
    const draft: CognitionStoreDocument = JSON.parse(JSON.stringify(doc)) as CognitionStoreDocument;
    const results: DeltaApplyResult[] = [];
    const touched = new Map<string, CognitionDelta>();
    for (const delta of deltas) {
      const result = applyCognitionDelta(draft, delta);
      results.push(result);
      if (result.applied) touched.set(result.objectId, delta);
    }
    const hardFailure = results.find(isDeltaFailure);
    if (hardFailure) {
      return { ok: false, error: hardFailure.reason, results, appliedCount: 0 };
    }
    if (touched.size === 0) {
      return { ok: true, results, appliedCount: 0 };
    }
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    writeStoreFileSync(filePath, draft);
    for (const [objectId, delta] of touched) {
      const object = draft.objects[objectId];
      if (!object || !safeId(objectId)) continue;
      try {
        const streamPath = versionStreamPath(uid, objectId);
        fs.mkdirSync(path.dirname(streamPath), { recursive: true });
        const line: VersionLine = {
          at: object.updatedAt,
          deltaId: delta.deltaId,
          op: delta.op,
          version: object.version,
          origin: delta.origin,
          ...(delta.before !== undefined && delta.before !== null ? { before: delta.before } : {}),
          ...(delta.after !== undefined && delta.after !== null ? { after: delta.after } : {}),
        };
        appendJsonl(streamPath, line, VERSION_LINE_MAX);
      } catch (err) {
        log.warn('cognition version stream append failed (best effort)', { uid, objectId, error: (err as Error).message });
      }
    }
    try {
      appendJsonl(
        cognitionAuditPath(uid),
        {
          at: nowIso(),
          ops: [...touched.entries()].map(([objectId, d]) => ({
            objectId,
            op: d.op,
            home: d.target.home,
            origin: d.origin,
            summary: summary(d.after ?? d.before ?? d.deltaId),
          })),
        },
        VERSION_LINE_MAX,
      );
    } catch (err) {
      log.warn('cognition audit append failed (best effort)', { uid, error: (err as Error).message });
    }
    return { ok: true, results, appliedCount: touched.size };
  });
}

function writeStoreFileSync(filePath: string, doc: CognitionStoreDocument): void {
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(doc, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}

// ── 家注册表写口 ─────────────────────────────────────────────────────────

export interface ReplaceHomesOutcome {
  ok: boolean;
  error?: string;
  homes?: HomeRegistryEntry[];
}

/**
 * 家注册表写口（S4 消费面接 IPC/UI 用）：锁内 校验（id 唯一/合法、内置六家
 * 不可删、存储映射合法）→ 替换 homes → 原子写 + 台账。内置家的判据文案允许
 * 被覆盖（用户可改措辞），id 与存储映射以出厂为准不可漂移。
 */
export async function replaceCognitionHomes(uid: string, homes: readonly HomeRegistryEntry[]): Promise<ReplaceHomesOutcome> {
  if (!safeId(uid)) return { ok: false, error: 'invalid uid' };
  const validated = validateHomeRegistry(homes);
  if (validated.ok === false) return { ok: false, error: validated.reason };
  const filePath = cognitionStorePath(uid);
  return fileEditLock(filePath).runExclusive(async () => {
    const doc = loadCognitionStoreSync(uid);
    const corrupt = corruptRecordFor(filePath);
    if (corrupt) {
      return { ok: false, error: `cognition store corrupt; write refused (${corrupt.reason})` };
    }
    // 内置家的 pool/store 映射强制回出厂值（防注册表改写破坏存储语义）。
    const builtinById = new Map(DEFAULT_HOME_REGISTRY.map((entry) => [entry.home, entry]));
    const merged = homes.map((entry) => {
      const builtin = builtinById.get(entry.home);
      if (!builtin) return entry;
      return { ...entry, pool: builtin.pool, store: builtin.store, builtin: true as const };
    });
    doc.homes = merged;
    doc.updatedAt = nowIso();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    writeStoreFileSync(filePath, doc);
    try {
      appendJsonl(
        cognitionAuditPath(uid),
        { at: nowIso(), origin: 'user', ops: [{ objectId: '', op: 'homes.replace', home: '', summary: `homes=${merged.length}` }] },
        VERSION_LINE_MAX,
      );
    } catch {
      // 台账尽力而为
    }
    return { ok: true, homes: merged };
  });
}

// ── 读辅助（版本流/台账）────────────────────────────────────────────────

export interface CognitionVersionLine extends VersionLine {}

export function listCognitionVersions(uid: string, objectId: string): CognitionVersionLine[] {
  if (!safeId(uid) || !safeId(objectId)) return [];
  const p = versionStreamPath(uid, objectId);
  try {
    if (!fs.existsSync(p)) return [];
    return fs
      .readFileSync(p, 'utf8')
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => {
        try {
          return JSON.parse(line) as VersionLine;
        } catch {
          // 坏行跳过（读侧逐行降级），不拖垮整条流。
          return null;
        }
      })
      .filter((v): v is VersionLine => v !== null);
  } catch {
    return [];
  }
}

/** 兼容桥的原子入口：调用者提供已验证的来源快照，仍复用库锁、坏档拒写和原子落盘。
 * 变更不会伪造新内容版本；版本/审计 JSONL 由既有资产业务服务维护。 */
export async function editCognitionCompatibility(
  uid: string, edit: (doc: CognitionStoreDocument) => void,
): Promise<void> {
  if (!safeId(uid)) throw new Error('invalid uid');
  const filePath = cognitionStorePath(uid);
  await fileEditLock(filePath).runExclusive(async () => {
    const doc = loadCognitionStoreSync(uid);
    if (corruptRecordFor(filePath)) throw new Error('cognition store corrupt; compatibility write refused');
    edit(doc);
    doc.updatedAt = nowIso();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    writeStoreFileSync(filePath, doc);
  });
}
