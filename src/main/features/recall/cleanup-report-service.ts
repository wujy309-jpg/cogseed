/**
 * 混乱内容大扫除与整理报告（specs/008 US-403）。
 *
 * 大扫除 = 对资产库做一轮批量整理，产出**逐项可核对、逐项可回滚**的整理报告。
 *
 * 三条硬口径：
 *   ① **只做不改变含义的整理**。改标题的空白/标点、把正文一字不差的同类型资产
 *      并成一条——这些不需要理解语义。凡是需要判断"这两条是不是一个意思""这条
 *      该归到哪类"的，一律进 `uncertain[]` 转待确认，**不擅自处置**。
 *   ② **补标签/归类在 Epic 2（012）落地前跳过并如实标注**：资产没有标签字段，
 *      跳过就是跳过，不在报告里假装做过，也不映射到 `assetType` 或 `familyName`。
 *   ③ **`items[]` 与台账一一对应、每项可单独回滚**：每项带 `ledgerRef`（台账行）
 *      与 `rollbackAnchor`（回滚到哪一版），沿用 US-404 已建的锚点机制。
 *
 * 中断恢复：报告**先落盘再逐项执行**，每执行完一项就写回报告——中断时已执行项
 * 全部有台账、可逐项回滚，未执行项保持原状，不会产生"改了一半没记账"的半状态。
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { createLogger } from '../../logger';
import { safeId } from '../../storage';
import { recallJsonRecordPath } from './paths';
import { readRecallJsonRecord, updateRecallJsonRecord, writeRecallJsonRecord } from './store';
import type { RecallJsonRecord } from './types';
import {
  abilityAssetActiveVersion,
  listAbilityAssetAudit,
  listAbilityAssets,
  mergeAbilityAssets,
  updateAbilityAsset,
} from './asset-service';
import type { RecallAbilityAssetRecord } from './candidate-service';

const log = createLogger('recall.asset-cleanup');

export type CleanupItemKind = 'title_normalized' | 'merged_duplicate';
export type CleanupItemStatus = 'applied' | 'skipped' | 'uncertain' | 'failed';

export interface CleanupReportItem {
  assetId: string;
  kind: CleanupItemKind;
  status: CleanupItemStatus;
  before: string;
  after: string;
  reason: string;
  /** 本次改动写下的台账行 id（items[] 与台账一一对应的凭据）。 */
  ledgerRef?: string;
  /** 一步回滚锚点（改前在用版）。 */
  rollbackAnchor?: string;
  /** 合并项：被并入的目标。 */
  mergedIntoAssetId?: string;
  /** 失败/跳过的原因（如实写，不掩饰）。 */
  note?: string;
}

export interface CleanupUncertainItem {
  assetId: string;
  title?: string;
  /** 拿不准的是什么（用户据此决定要不要管）。 */
  question: string;
  reason: string;
  /** 用户处置后置位；未处置时缺省。 */
  decision?: 'dismissed' | 'deferred';
}

export interface CleanupReport extends RecallJsonRecord {
  id: string;
  trigger: 'user' | 'inspection';
  scope: { spaceId?: string; assetType?: string };
  items: CleanupReportItem[];
  uncertain: CleanupUncertainItem[];
  /** 本轮明确跳过的步骤（如 Epic 2 未落地时的补标签/归类）。 */
  skippedSteps: string[];
  createdAt: string;
  finishedAt?: string;
  /** 中断（异常/取消）时置位：已执行项仍然有效且可回滚。 */
  interrupted?: boolean;
  scanned: number;
}

function reportsDirectory(userId: string): string {
  return path.dirname(recallJsonRecordPath(userId, 'cleanup-reports', 'placeholder'));
}

function asReport(value: RecallJsonRecord): CleanupReport {
  if (
    typeof value.trigger !== 'string'
    || !Array.isArray(value.items) || !Array.isArray(value.uncertain)
    || typeof value.createdAt !== 'string'
    || !value.scope || typeof value.scope !== 'object' || Array.isArray(value.scope)
  ) throw new Error('malformed cleanup report');
  return {
    ...value,
    skippedSteps: Array.isArray(value.skippedSteps) ? value.skippedSteps as string[] : [],
    scanned: Number(value.scanned) || 0,
  } as CleanupReport;
}

export async function readCleanupReport(userId: string, reportId: string): Promise<CleanupReport | undefined> {
  if (!safeId(reportId)) throw new Error('invalid cleanup report id');
  const raw = await readRecallJsonRecord(userId, 'cleanup-reports', reportId);
  return raw ? asReport(raw) : undefined;
}

export async function listCleanupReports(userId: string, limit = 20): Promise<CleanupReport[]> {
  let names: string[];
  try {
    names = await fs.readdir(reportsDirectory(userId));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const records = await Promise.all(names
    .filter((name) => name.endsWith('.json') && safeId(name.slice(0, -5)))
    .map((name) => readRecallJsonRecord(userId, 'cleanup-reports', name.slice(0, -5))));
  return records
    .filter((raw): raw is RecallJsonRecord => Boolean(raw))
    .flatMap((raw) => {
      try { return [asReport(raw)]; } catch { return []; }
    })
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, Math.max(1, Math.min(100, limit)));
}

async function patchReport(
  userId: string,
  reportId: string,
  patch: (report: CleanupReport) => Partial<CleanupReport>,
): Promise<CleanupReport> {
  const updated = await updateRecallJsonRecord(userId, 'cleanup-reports', reportId, (raw) => {
    if (!raw) throw new Error('cleanup report not found');
    return { ...asReport(raw), ...patch(asReport(raw)) } as RecallJsonRecord;
  });
  return asReport(updated);
}

/** 只留"改名不改意"的规范化：首尾空白、内部连续空白、结尾的句读符号。
 *
 *  真机上**空白那一类基本已经打不中**：候选判断与资产写入口都会 collapse + trim
 *  空白（`boundedText` / `bounded`），所以能落盘的"不规范"主要是**结尾句读**
 *  （'。'、'、'、'；'、','）与历史遗留记录。这一步因此不是空转，但也不该被
 *  当成主力——它的价值是"顺手把标点收干净"，不是"修标题"。 */
export function normalizeAssetTitle(title: string): string {
  return String(title || '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[。、；;,\s]+$/, '')
    .trim();
}

/** 正文比对用的归一文本：空白与结尾标点不算差异（"一字不差"按这个口径）。 */
function comparableStatement(statement: string): string {
  return String(statement || '').replace(/\s+/g, ' ').trim();
}

/** 近重复判据：同类型、正文不同但字面高度重叠。**只用来提醒**（进 uncertain），
 *  不用来自动合并——"看起来像"不是"就是一个意思"，那需要人来判。
 *  导出给后台巡检复用：同一件事只该有一套判据（两处各写一份迟早给出不同答案）。 */
export function nearDuplicateScore(left: string, right: string): number {
  const bigrams = (text: string): Set<string> => {
    const flat = comparableStatement(text).toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    const out = new Set<string>();
    for (let index = 0; index + 2 <= flat.length; index += 1) out.add(flat.slice(index, index + 2));
    return out;
  };
  const a = bigrams(left);
  const b = bigrams(right);
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const gram of a) if (b.has(gram)) shared += 1;
  return shared / Math.min(a.size, b.size);
}

/** 近重复的提醒阈值：够高才提醒，避免把"同一类里的不同规则"也报成疑似重复。 */
const NEAR_DUPLICATE_THRESHOLD = 0.8;
/** 单轮参与两两比对的资产上限：超过就只做逐条规范化，不硬算（宁可少报）。 */
const NEAR_DUPLICATE_SCAN_LIMIT = 200;

export interface RunCleanupOptions {
  trigger?: 'user' | 'inspection';
  scope?: { spaceId?: string; assetType?: string };
}

/**
 * 跑一轮大扫除。**先建报告再逐项执行**，每项落盘后才算执行完——中断时报告如实
 * 反映"做到哪了"，已执行项可逐项回滚。
 */
export async function runAssetCleanup(userId: string, options: RunCleanupOptions = {}): Promise<CleanupReport> {
  const scope = options.scope || {};
  const reportId = `cr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const createdAt = new Date().toISOString();
  const skippedSteps: string[] = [];
  const all = await listAbilityAssets(userId);
  let pool = all.filter((asset) => asset.status !== 'purged');
  if (scope.spaceId) pool = pool.filter((asset) => asset.spaceId === scope.spaceId);
  if (scope.assetType) pool = pool.filter((asset) => asset.type === scope.assetType);

  // 补标签与归类都以 Epic 2（012）的标签字段为前提：未先行时**跳过并如实标注**，
  // 不映射到 assetType / familyName（那是另一套语义），也不静默当做过。
  skippedSteps.push('补标签（标签系统尚未落地，待 Epic 2 / 012）');
  skippedSteps.push('归类（同上：归类依赖标签字段）');

  await writeRecallJsonRecord(userId, 'cleanup-reports', reportId, {
    schemaVersion: 1,
    ownerId: userId,
    id: reportId,
    trigger: options.trigger || 'user',
    scope: { ...(scope.spaceId ? { spaceId: scope.spaceId } : {}), ...(scope.assetType ? { assetType: scope.assetType } : {}) },
    items: [],
    uncertain: [],
    skippedSteps,
    createdAt,
    scanned: pool.length,
  } satisfies CleanupReport);

  const items: CleanupReportItem[] = [];
  const uncertain: CleanupUncertainItem[] = [];

  try {
    // ① 命名规范化：只动空白与结尾标点，不碰任何字面含义。
    for (const asset of pool) {
      const normalized = normalizeAssetTitle(asset.title);
      if (!normalized || normalized === asset.title) continue;
      const anchor = abilityAssetActiveVersion(asset);
      try {
        // actor='user'：这一轮是**用户发起**的，机械步骤由系统代执行。用 'system'
        // 会撞"自动线必须带评审交接"的闸门，而给大扫除凭空造一个评审决定会污染
        // appliedReviewDecisionIds（与到期清理那次同一个理由）；台账的 reason 里
        // 写着报告号，谁发起的、哪一轮，一目了然。
        await updateAbilityAsset(userId, asset.id, {
          title: normalized,
          reason: `大扫除：标题规范化（${reportId}）`,
          actor: 'user',
        });
        const ledgerRef = await lastAuditId(userId, asset.id);
        const item: CleanupReportItem = {
          assetId: asset.id,
          kind: 'title_normalized',
          status: 'applied',
          before: asset.title,
          after: normalized,
          reason: '标题只有空白或结尾标点不规范（含义未变）',
          ...(ledgerRef ? { ledgerRef } : {}),
          rollbackAnchor: anchor,
        };
        items.push(item);
        await patchReport(userId, reportId, (report) => ({ items: [...report.items, item] }));
      } catch (error) {
        const failed: CleanupReportItem = {
          assetId: asset.id,
          kind: 'title_normalized',
          status: 'failed',
          before: asset.title,
          after: normalized,
          reason: '标题规范化',
          note: (error as Error).message,
        };
        items.push(failed);
        await patchReport(userId, reportId, (report) => ({ items: [...report.items, failed] }));
        log.warn('cleanup title normalization failed', { assetId: asset.id, error: (error as Error).message });
      }
    }

    // ② 去重合并：**只并正文一字不差的同类型在用资产**（这不需要理解语义）。
    //    顺序：保留较新的那条，把较旧的并进去（source = 较旧）。
    const active = pool.filter((asset) => asset.status === 'active');
    const byStatement = new Map<string, RecallAbilityAssetRecord[]>();
    for (const asset of active) {
      const key = `${asset.type}\u0000${comparableStatement(asset.statement)}`;
      const group = byStatement.get(key) || [];
      group.push(asset);
      byStatement.set(key, group);
    }
    const mergedIds = new Set<string>();
    for (const group of byStatement.values()) {
      if (group.length < 2) continue;
      const ordered = [...group].sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
      const target = ordered[0];
      for (const source of ordered.slice(1)) {
        if (mergedIds.has(source.id) || source.id === target.id) continue;
        const anchor = abilityAssetActiveVersion(target);
        try {
          await mergeAbilityAssets(userId, source.id, target.id, {
            actor: 'user',
            reason: `大扫除：正文一字不差的重复资产归并（${reportId}）`,
          });
          const ledgerRef = await lastAuditId(userId, target.id);
          const item: CleanupReportItem = {
            assetId: source.id,
            kind: 'merged_duplicate',
            status: 'applied',
            before: `独立条目（v${anchor}）`,
            after: `并入 ${target.id}`,
            reason: '正文与类型完全相同（一字不差），不需要判断语义',
            ...(ledgerRef ? { ledgerRef } : {}),
            rollbackAnchor: anchor,
            mergedIntoAssetId: target.id,
          };
          items.push(item);
          mergedIds.add(source.id);
          await patchReport(userId, reportId, (report) => ({ items: [...report.items, item] }));
        } catch (error) {
          const failed: CleanupReportItem = {
            assetId: source.id,
            kind: 'merged_duplicate',
            status: 'failed',
            before: '独立条目',
            after: `并入 ${target.id}`,
            reason: '重复资产归并',
            note: (error as Error).message,
          };
          items.push(failed);
          await patchReport(userId, reportId, (report) => ({ items: [...report.items, failed] }));
          log.warn('cleanup merge failed', { sourceAssetId: source.id, error: (error as Error).message });
        }
      }
    }

    // ③ 疑似重复（正文不同但字面高度重叠）：**这是含义判断，交给用户**。
    const candidates = pool.filter((asset) => !mergedIds.has(asset.id)).slice(0, NEAR_DUPLICATE_SCAN_LIMIT);
    for (let i = 0; i < candidates.length; i += 1) {
      for (let j = i + 1; j < candidates.length; j += 1) {
        const left = candidates[i];
        const right = candidates[j];
        if (left.type !== right.type) continue;
        if (compareAndMaybeUncertain(left, right, uncertain)) {
          const entry = uncertain[uncertain.length - 1];
          await patchReport(userId, reportId, (report) => ({ uncertain: [...report.uncertain, entry] }));
        }
      }
    }

    return await patchReport(userId, reportId, () => ({ finishedAt: new Date().toISOString(), items, uncertain }));
  } catch (error) {
    // 中断：报告如实反映已执行的部分，已执行项全部有台账、可逐项回滚。
    log.warn('cleanup interrupted', { reportId, error: (error as Error).message });
    return await patchReport(userId, reportId, () => ({
      items,
      uncertain,
      interrupted: true,
      finishedAt: new Date().toISOString(),
    }));
  }
}

/** 命中近重复就推一条 uncertain（返回 true 表示推了）。 */
function compareAndMaybeUncertain(
  left: RecallAbilityAssetRecord,
  right: RecallAbilityAssetRecord,
  uncertain: CleanupUncertainItem[],
): boolean {
  const score = nearDuplicateScore(left.statement, right.statement);
  if (score < NEAR_DUPLICATE_THRESHOLD) return false;
  const older = String(left.updatedAt) <= String(right.updatedAt) ? left : right;
  const newer = older.id === left.id ? right : left;
  uncertain.push({
    assetId: older.id,
    ...(older.title ? { title: older.title } : {}),
    question: `这条和「${String(newer.title || newer.id).slice(0, 40)}」看字面很像（${Math.round(score * 100)}%），要不要合并？`,
    reason: '正文不同但高度重叠：是不是同一个意思需要人来判，系统不擅自合并。',
  });
  return true;
}

async function lastAuditId(userId: string, assetId: string): Promise<string | undefined> {
  try {
    const rows = await listAbilityAssetAudit(userId, assetId);
    const last = rows[rows.length - 1];
    return typeof last?.id === 'string' ? last.id : undefined;
  } catch {
    return undefined;
  }
}

/** 用户对"拿不准项"的处置：`dismissed`（不管它）/ `deferred`（回头再看）。 */
export async function decideCleanupUncertainItem(
  userId: string,
  reportId: string,
  assetId: string,
  decision: 'dismissed' | 'deferred',
): Promise<CleanupReport> {
  if (!safeId(assetId)) throw new Error('invalid ability asset id');
  const report = await readCleanupReport(userId, reportId);
  if (!report) throw new Error('cleanup report not found');
  if (!report.uncertain.some((entry) => entry.assetId === assetId)) {
    throw new Error('cleanup uncertain item not found');
  }
  return patchReport(userId, reportId, (current) => ({
    uncertain: current.uncertain.map((entry) => (
      entry.assetId === assetId ? { ...entry, decision } : entry
    )),
  }));
}

/** 未处置的拿不准项 → 待确认清单条目（`id` 前缀 `cleanup:` 供处置通道识别）。 */
export function pendingCleanupUncertainItems(
  reports: readonly CleanupReport[],
): Array<{ reportId: string; assetId: string; title?: string; question: string }> {
  return reports.flatMap((report) => report.uncertain
    .filter((entry) => !entry.decision)
    .map((entry) => ({
      reportId: report.id,
      assetId: entry.assetId,
      ...(entry.title ? { title: entry.title } : {}),
      question: entry.question,
    })));
}
