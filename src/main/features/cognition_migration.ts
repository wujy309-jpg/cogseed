/**
 * cognition_migration — 旧双库 → 统一认知库的一次性迁移（S3-e，host 侧适配）。
 *
 * 本模块**不属于可剥离内核**（D11）：它 import po 与 recall 的读接口做桥接。
 * 迁移三源：
 *   A. po v2 主档值（loadPoDocSync 已含 v1 markdown 一次性导入）→ 断言
 *      （带 assetId 的投影值跳过——归属由来源资产侧迁移，见 B）；
 *   B. recall 正式资产 records/ability-assets → personal/fact=断言、rule=规则、
 *      template/skill_method=能力包；资产若在 po 里有投影值（assetId 对上），
 *      断言落该投影的 (groupId, fieldName) 槽位——「同一内容两处账」就此合一；
 *   C. 双候选池的未结清候选 → 统一池 proposed 条目（originalRef 留原 id）。
 *
 * 安全纪律：真实运行前先整目录备份（cognition + recall → cognition-migration-backup-<ts>）；
 * 幂等可重跑（槽位/指纹/objectId 三重查重）；差异报告落用户数据目录。
 * dryRun 只算不写。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createLogger } from '../logger';
import { userCognitionDir, userCloudRoot } from '../paths';
import { nowIso, safeId } from '../storage';
import { loadPoDocSync } from './po/store';
import { listCandidates } from './personal_ontology_candidates';
import {
  applyCognitionDeltas,
  loadCognitionStoreSync,
} from './cognition_kernel/store';
import { submitToPool } from './cognition_kernel/pool';
import { buildDelta, deltaFingerprint } from './cognition_kernel/delta';
import type { CognitionDelta } from './cognition_kernel/types';
import type { CognitionObject, CognitionStoreDocument } from './cognition_kernel/object-model';

const log = createLogger('cognition-migration');

const ASSET_TYPE_TO_HOME: Record<string, string> = {
  personal: 'personal_fact',
  fact: 'personal_fact',
  rule: 'rule',
  template: 'template',
  skill_method: 'method',
};

/** recall 候选的未结清态（终态的已被处置过，不迁移）。 */
const ACTIVE_CANDIDATE_STATUSES = new Set(['observed', 'weak_observation', 'pending_review', 'deferred']);

export interface MigrationReport {
  at: string;
  dryRun: boolean;
  backupDir?: string;
  poValues: { total: number; migrated: number; skippedProjection: number; skippedEmpty: number; slotMerged: number };
  assets: { total: number; migrated: number; skippedTerminal: number; fingerprintMerged: number; byType: Record<string, number> };
  candidates: { recallMigrated: number; poMigrated: number; skippedTerminal: number };
  errors: string[];
}

interface PlannedDelta {
  delta: CognitionDelta;
  /** 重跑查重键：objectId / 槽位 / 指纹（三重）。 */
  objectId?: string;
  slot?: string;
  fingerprint: string;
  status?: CognitionObject['status'];
}

function recallRecordsDir(uid: string, collection: string): string {
  return path.join(userCloudRoot(uid), 'recall', 'records', collection);
}

function readJsonRecords(dir: string): Array<Record<string, unknown>> {
  try {
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        try {
          return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .filter((r): r is Record<string, unknown> => r !== null);
  } catch {
    return [];
  }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function statementOfAsset(asset: Record<string, unknown>): string {
  const statement = text(asset.statement);
  return statement || text(asset.title);
}

/** 目标库三重查重（幂等重跑的依据）。 */
function alreadyPresent(doc: CognitionStoreDocument, planned: PlannedDelta): boolean {
  if (planned.objectId && doc.objects[planned.objectId]) return true;
  if (planned.slot) {
    const [groupId, fieldName] = planned.slot.split('||');
    const hit = Object.values(doc.objects).find(
      (o) => o.kind === 'assertion' && o.status !== 'deleted' && (o.groupId ?? '') === groupId && o.fieldName === fieldName,
    );
    if (hit) return true;
  }
  if (planned.fingerprint) {
    const hit = Object.values(doc.objects).find((o) => deltaFingerprint(o.statement) === planned.fingerprint);
    if (hit) return true;
  }
  return false;
}

/** 迁移主入口。永不抛错：单项失败进 errors，整批继续。 */
export async function migrateLegacyCognition(uid: string, options?: { dryRun?: boolean }): Promise<MigrationReport> {
  const dryRun = options?.dryRun === true;
  const report: MigrationReport = {
    at: nowIso(),
    dryRun,
    poValues: { total: 0, migrated: 0, skippedProjection: 0, skippedEmpty: 0, slotMerged: 0 },
    assets: { total: 0, migrated: 0, skippedTerminal: 0, fingerprintMerged: 0, byType: {} },
    candidates: { recallMigrated: 0, poMigrated: 0, skippedTerminal: 0 },
    errors: [],
  };
  if (!safeId(uid)) {
    report.errors.push('invalid uid');
    return report;
  }

  const target = loadCognitionStoreSync(uid);
  const planned: PlannedDelta[] = [];
  const projectionSlots = new Map<string, { groupId: string; fieldName: string }>();

  // ── 源 A：po v2 值 ───────────────────────────────────────────────────
  try {
    const doc = loadPoDocSync(uid);
    for (const group of doc.groups) {
      const fieldById = new Map(group.fields.map((f) => [f.id, f.name]));
      for (const value of group.values) {
        report.poValues.total += 1;
        const fieldName = fieldById.get(value.fieldId) ?? '';
        const body = text(value.text);
        if (value.assetId) {
          // 投影值：正文归属来源资产（源 B 用它落槽），本处跳过。
          projectionSlots.set(value.assetId, { groupId: group.id, fieldName });
          report.poValues.skippedProjection += 1;
          continue;
        }
        if (!body) {
          report.poValues.skippedEmpty += 1;
          continue;
        }
        const slot = `${group.id}||${fieldName}`;
        if (planned.some((p) => p.slot === slot)) {
          report.poValues.slotMerged += 1;
          continue;
        }
        planned.push({
          delta: buildDelta({
            op: 'set',
            target: { home: 'personal_fact', groupId: group.id, fieldName: fieldName || value.id },
            origin: 'import',
            after: body,
            status: 'applied',
          }),
          slot,
          fingerprint: deltaFingerprint(body),
        });
        report.poValues.migrated += 1;
      }
    }
  } catch (err) {
    report.errors.push(`po values: ${(err as Error).message}`);
  }

  // ── 源 B：recall 正式资产 ───────────────────────────────────────────
  const assets = readJsonRecords(recallRecordsDir(uid, 'ability-assets'));
  for (const asset of assets) {
    const id = text(asset.id);
    const type = text(asset.type);
    const status = text(asset.status);
    report.assets.total += 1;
    report.assets.byType[type] = (report.assets.byType[type] ?? 0) + 1;
    if (!id || !type || !(type in ASSET_TYPE_TO_HOME)) continue;
    if (status === 'deleted' || status === 'purged' || status === 'revoked') {
      report.assets.skippedTerminal += 1;
      continue;
    }
    const statement = statementOfAsset(asset);
    if (!statement) continue;
    const fingerprint = deltaFingerprint(statement);
    if (planned.some((p) => p.fingerprint === fingerprint)) {
      report.assets.fingerprintMerged += 1;
      continue;
    }
    const home = ASSET_TYPE_TO_HOME[type];
    const projection = projectionSlots.get(id);
    const applicable = Array.isArray(asset.applicableWhen) ? asset.applicableWhen.filter((s) => typeof s === 'string').join('；') : '';
    const forbidden = Array.isArray(asset.forbiddenWhen) ? asset.forbiddenWhen.filter((s) => typeof s === 'string').join('；') : '';
    const after = [statement, applicable ? `适用：${applicable}` : '', forbidden ? `禁止：${forbidden}` : '']
      .filter(Boolean)
      .join('\n')
      .replace(/\n/g, ' ');
    const planned2: PlannedDelta = {
      delta: buildDelta({
        op: home === 'personal_fact' && projection ? 'set' : 'add',
        target: {
          home: home as never,
          ...(home === 'personal_fact' && projection
            ? { groupId: projection.groupId, fieldName: projection.fieldName }
            : {}),
          ...(home === 'personal_fact' && !projection && text(asset.title) ? { fieldName: text(asset.title) } : {}),
          ...(home !== 'personal_fact' ? { objectId: id } : {}),
        },
        origin: 'import',
        after,
        status: 'applied',
      }),
      ...(home !== 'personal_fact' ? { objectId: id } : {}),
      ...(home === 'personal_fact' && projection ? { slot: `${projection.groupId}||${projection.fieldName}` } : {}),
      fingerprint,
    };
    planned.push(planned2);
    report.assets.migrated += 1;
  }

  // ── 落地（全批一次写；dryRun 到此为止）────────────────────────────
  const toApply = planned.filter((p) => !alreadyPresent(target, p));
  if (!dryRun && toApply.length) {
    // 备份先行：cognition + recall 整目录快照到 cloud 下的兄弟目录（不能放进
    // 被备份目录自身）；幂等重跑不重复备份破坏首次现场。
    try {
      const backupDir = path.join(userCloudRoot(uid), `cognition-migration-backup-${report.at.replace(/[:.]/g, '-')}`);
      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
        fs.cpSync(userCognitionDir(uid), path.join(backupDir, 'cognition'), { recursive: true });
        fs.cpSync(path.join(userCloudRoot(uid), 'recall'), path.join(backupDir, 'recall'), { recursive: true });
      }
      report.backupDir = backupDir;
    } catch (err) {
      report.errors.push(`backup failed: ${(err as Error).message}`);
      return report; // 备份失败不迁移（安全纪律优先）
    }
    const BATCH = 200;
    for (let i = 0; i < toApply.length; i += BATCH) {
      const batch = toApply.slice(i, i + BATCH).map((p) => p.delta);
      const result = await applyCognitionDeltas(uid, batch);
      if (!result.ok) {
        report.errors.push(`batch ${i / BATCH}: ${result.error ?? 'unknown'}`);
        break;
      }
    }
  }
  if (!dryRun && !report.errors.length) {
    // 迁移后置标记（S4 接线前补）：restricted（仅自己可见）语义不经 Delta 文本
    // 通道，迁移报告里保留原始值清单，S4 隐私编辑面据此补标记——不静默丢失。
    // （本版迁移的 poValues 统计已含 skippedProjection/明细，报告文件即证据。）
  }

  // ── 源 C：双候选池未结清项 → 统一池（真实运行才提交）─────────────
  if (!dryRun) {
    // 重跑查重：池内已有同 originalRef 的活条目（pending/deferred）则跳过——
    // 候选是裸 add（无槽位），池的槽位顶替语义管不到，须按来源 id 查。
    const { loadPoolSync } = await import('./cognition_kernel/pool');
    const activeRefs = new Set(
      loadPoolSync(uid)
        .items.filter((item) => item.status === 'pending' || item.status === 'deferred')
        .filter((item) => item.originalRef)
        .map((item) => `${item.originalRef?.kind}:${item.originalRef?.id}`),
    );
    const recallCandidates = readJsonRecords(recallRecordsDir(uid, 'candidates'));
    for (const candidate of recallCandidates) {
      const status = text(candidate.status);
      if (!ACTIVE_CANDIDATE_STATUSES.has(status)) {
        report.candidates.skippedTerminal += 1;
        continue;
      }
      const statement = text(candidate.value) || text(candidate.summary) || text(candidate.judgment);
      if (!statement) continue;
      if (activeRefs.has(`recall_candidate:${text(candidate.id)}`)) continue;
      const suggested = text(candidate.suggestedType);
      const home = suggested in ASSET_TYPE_TO_HOME ? ASSET_TYPE_TO_HOME[suggested] : 'personal_fact';
      const delta = buildDelta({
        op: 'add',
        target: { home: home as never },
        origin: 'import',
        after: statement,
        status: 'proposed',
      });
      const submit = await submitToPool(uid, delta, { sourceKind: 'import', originalRef: { kind: 'recall_candidate', id: text(candidate.id) } });
      if (submit.ok) report.candidates.recallMigrated += 1;
      else report.errors.push(`recall candidate ${text(candidate.id)}: ${submit.error}`);
    }
    try {
      const poCandidates = await listCandidates(uid);
      for (const candidate of poCandidates.candidate_updates ?? []) {
        if (activeRefs.has(`po_candidate:${text(candidate.candidate_id)}`)) continue;
        const statement = text(candidate.memory_text) || text(candidate.summary);
        if (!statement) continue;
        const delta = buildDelta({
          op: 'set',
          target: { home: 'personal_fact', ...(text(candidate.target_field) ? { fieldName: text(candidate.target_field) } : {}) },
          origin: 'import',
          after: statement,
          status: 'proposed',
        });
        const submit = await submitToPool(uid, delta, { sourceKind: 'import', originalRef: { kind: 'po_candidate', id: text(candidate.candidate_id) } });
        if (submit.ok) report.candidates.poMigrated += 1;
        else report.errors.push(`po candidate ${text(candidate.candidate_id)}: ${submit.error}`);
      }
    } catch (err) {
      report.errors.push(`po candidates: ${(err as Error).message}`);
    }
  }

  // 报告落盘（含 dryRun，便于先看差异再实跑）。
  try {
    const reportPath = path.join(userCognitionDir(uid), `migration-report-${report.at.replace(/[:.]/g, '-')}.json`);
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify({ ...report, plannedCount: planned.length, appliedCount: toApply.length }, null, 2), 'utf8');
  } catch (err) {
    log.warn('migration report write failed', { uid, error: (err as Error).message });
  }
  return { ...report, poValues: report.poValues, assets: report.assets, candidates: report.candidates, errors: report.errors };
}
