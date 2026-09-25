/**
 * meeting_refs — 会议引用包 `MeetingAssetPack`（specs/013 · FR-010 / US-502 / T011）
 *
 * 是什么：一份会议文档引用了哪些资产、**引用时是哪一版**。三场景（纠错依据/
 * 纪要双引用/待办引用）共用这一份冻结来源（data-model §1.2）。
 *
 * 三条硬纪律（specs/013 不变量）：
 *   1. **冻结版不变味**（SC-004）：`version`/`title`/`type` 一旦写入永不回写；
 *      重复 attach 只刷 `at`/`via`，**不覆盖既有版本**（否则等于偷偷升版）。
 *      版本取值表达式与投影逐字一致：`String(asset.activeVersion || asset.version || '1')`
 *      （`recall/context-projection.ts` buildExplicitAssetView 的 assetVersions 构造，
 *      2026-09-25 实测 :767）。
 *   2. **准入判据复用既有函数，不新写一套**：`readAbilityAsset`（存在性）+
 *      `evaluateAssetRuntimeEligibility`（`formal-assets/runtime` 的统一准入闸，
 *      用户主动挑选语义 = `silentDefaultInjection:false`，与 buildExplicitAssetView
 *      的无 agentId 分支同一套；阻断原因用既有 `assetRuntimeBlockRule` 收敛成
 *      规则标识）。失败一律**码化**，渲染层按码翻四语规则名。
 *   3. **不存资产正文**：条目只有 id/版本（≤…）/标题（≤120）/类型/来源/时间
 *      （隐私边界 D20；读时派生 stale/available 是 T037 的活，本模块不落库状态）。
 *
 * 存储：`<uid>/cloud/cogseed/transcript/meeting-refs/<docKey>.json`（与词表同域，
 * research D2）；`docKey` 派生复用 meeting_doc 的确定性函数。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { createLogger } from '../logger';
import { safeId } from '../storage';
import { userMeetingRefsDir } from '../paths';
import { docKeyForDocId, MAX_DOC_ID_CHARS, MeetingDocError } from './meeting_doc';
import { readAbilityAsset } from './recall/asset-service';
import {
  assetRuntimeBlockRule,
  evaluateAssetRuntimeEligibility,
} from './recall/formal-assets/runtime';
import type { RecallAbilityAssetRecord } from './recall/candidate-service';

const log = createLogger('meeting-refs');

export const MEETING_REF_SCHEMA_VERSION = 1;
/** 引用条数上限（data-model §1.2：同一 assetId 只留一条，不同资产有界 100）。 */
export const MAX_MEETING_ASSET_REFS = 100;
/** 标题快照上限（对齐 source-service 的标题上限）。 */
const MAX_TITLE_CHARS = 120;

export type MeetingRefVia = 'attach' | 'conclusion' | 'action_draft';
export type MeetingAssetType = 'personal' | 'rule' | 'template' | 'skill_method' | 'fact';

/**
 * 会议侧引用包错误（失败一律码化 + 归因，见 `contracts/tool-contract.md` §5；
 * 渲染层按码翻四语，不上屏英文原文、不露内部 id）。
 */
export type MeetingRefErrorCode =
  | 'invalid_doc_id'      // schema
  | 'invalid_asset_id'    // schema
  | 'invalid_via'         // schema
  | 'asset_missing'       // data
  | 'asset_inactive'      // permission/data
  | 'asset_ineligible'    // permission（按规则标识翻规则名）
  | 'ref_pack_full';      // data

export class MeetingRefError extends Error {
  constructor(
    message: string,
    readonly code: MeetingRefErrorCode,
    /** 准入被哪条既有规则拦的（`assetRuntimeBlockRule` 的稳定标识，非用户文案）。 */
    readonly blockRule?: string,
  ) {
    super(message);
    this.name = 'MeetingRefError';
  }
}

export interface MeetingAssetRef {
  assetId: string;
  /** **冻结版**：引用时的在用版。取值表达式与既有投影逐字一致（文件头纪律 1）。 */
  version: string;
  /** 引用时的标题快照（≤120）。资产后来改名，这里仍是当时名（不变味）。 */
  title: string;
  /** 引用时的类型快照。 */
  type: MeetingAssetType;
  /** 引用来源：谁把它引起来的。 */
  via: MeetingRefVia;
  /** 引用建立/最近确认时间。 */
  at: string;
}

export interface MeetingAssetPack {
  schemaVersion: 1;
  docId: string;
  /** 有界 100；同一 assetId 只保留最新一次引用（重复引用不叠条目，只刷新 at/via）。 */
  assetRefs: MeetingAssetRef[];
  createdAt: string;
  updatedAt: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function meetingRefsFile(uid: string, docId: string): string {
  return path.join(userMeetingRefsDir(uid), `${docKeyForDocId(docId)}.json`);
}

function emptyPack(docId: string): MeetingAssetPack {
  const at = nowIso();
  return { schemaVersion: MEETING_REF_SCHEMA_VERSION, docId, assetRefs: [], createdAt: at, updatedAt: at };
}

function readPack(uid: string, docId: string): MeetingAssetPack | null {
  const file = meetingRefsFile(uid, docId);
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<MeetingAssetPack>;
    if (!raw || typeof raw !== 'object' || raw.docId !== docId) return null;
    if (raw.schemaVersion !== MEETING_REF_SCHEMA_VERSION) {
      log.warn('meeting ref pack unknown schema version; treated as missing', { schemaVersion: raw.schemaVersion });
      return null;
    }
    if (!Array.isArray(raw.assetRefs)) return null;
    return raw as MeetingAssetPack;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code !== 'ENOENT') log.warn('meeting ref pack unreadable; treated as missing', { code });
    return null;
  }
}

function writePack(uid: string, pack: MeetingAssetPack): void {
  const file = meetingRefsFile(uid, pack.docId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(pack, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function requireDocId(docId: string): string {
  const id = typeof docId === 'string' ? docId.trim() : '';
  if (!id || id.length > MAX_DOC_ID_CHARS) {
    throw new MeetingRefError('invalid meeting docId', 'invalid_doc_id');
  }
  return id;
}

function normalizeVia(via: unknown): MeetingRefVia {
  if (via === undefined || via === null || via === '') return 'attach';
  if (via === 'attach' || via === 'conclusion' || via === 'action_draft') return via;
  throw new MeetingRefError('invalid meeting ref via', 'invalid_via');
}

/**
 * 准入：`readAbilityAsset` + `evaluateAssetRuntimeEligibility`（既有判据，不新写）。
 * 失败码化：missing → `asset_missing`；非 active → `asset_inactive`；其余阻断 →
 * `asset_ineligible`（带 `assetRuntimeBlockRule` 的稳定规则标识）。
 *
 * 说明：与 buildExplicitAssetView 的差别只有一处——会议挂载不检查
 * `sourceAvailable`（来源撤权）：会议引用是**追溯指针**不是注入授权，撤权后
 * 该不该继续引用由读时的 `available`/`stale` 呈现如实说（T037/T039），不在
 * 写入侧静默拒绝（那会让"当时引用过"这一事实消失）。
 */
async function admitAsset(uid: string, assetId: string): Promise<RecallAbilityAssetRecord> {
  let asset: RecallAbilityAssetRecord;
  try {
    asset = await readAbilityAsset(uid, assetId);
  } catch {
    throw new MeetingRefError(`meeting ref asset missing: ${assetId}`, 'asset_missing');
  }
  if (asset.status !== 'active') {
    throw new MeetingRefError(`meeting ref asset not active: ${assetId}`, 'asset_inactive', assetRuntimeBlockRule(asset.status, ['status_not_active']));
  }
  const gate = evaluateAssetRuntimeEligibility({
    status: asset.status,
    maturity: asset.maturity,
    lifecycleStatus: asset.lifecycleStatus,
    scope: asset.scope,
    ...(asset.crossScopeConfirmedAt ? { crossScopeConfirmedAt: asset.crossScopeConfirmedAt } : {}),
    ...(asset.scopePolicy ? { scopePolicy: asset.scopePolicy } : {}),
    ...(asset.applicableWhen ? { applicableWhen: asset.applicableWhen } : {}),
    ...(asset.forbiddenWhen ? { forbiddenWhen: asset.forbiddenWhen } : {}),
    ...(asset.sensitivity ? { sensitivity: asset.sensitivity } : {}),
  }, {
    // 用户主动挂载（不是静默默认注入）：成熟度与适用条件不作硬门槛，
    // 权限与状态门照过——与 buildExplicitAssetView 的语义一致。
    silentDefaultInjection: false,
  });
  if (!gate.eligible && gate.reasons.length) {
    throw new MeetingRefError(
      `meeting ref asset ineligible: ${assetId}`,
      'asset_ineligible',
      assetRuntimeBlockRule(asset.status, gate.reasons),
    );
  }
  return asset;
}

export interface AttachMeetingAssetResult {
  /** 命中幂等分支时为刷新后的既有条目（version/title/type 保持冻结值）。 */
  ref: MeetingAssetRef;
  pack: MeetingAssetPack;
}

/**
 * 挂载/确认一条资产引用（用户发起；重复 attach 幂等：**不覆盖既有 version**，
 * 只刷 `at`/`via`）。冻结版表达式与投影逐字一致（文件头纪律 1）。
 */
export async function attachMeetingAsset(
  uid: string,
  docId: string,
  assetId: string,
  via: MeetingRefVia | undefined = 'attach',
): Promise<AttachMeetingAssetResult> {
  const id = requireDocId(docId);
  const asset = typeof assetId === 'string' && safeId(assetId) ? assetId : '';
  if (!asset) throw new MeetingRefError('invalid meeting assetId', 'invalid_asset_id');
  const viaValue = normalizeVia(via);
  // 先过准入（读现状），再进幂等分支——重复引用也要确认资产今天仍然可用。
  const record = await admitAsset(uid, asset);

  const pack = readPack(uid, id) ?? emptyPack(id);
  const at = nowIso();
  const existing = pack.assetRefs.find((ref) => ref.assetId === asset);
  if (existing) {
    // 冻结版不变味：version/title/type 一律保留写入时的值，只刷 at/via。
    existing.via = viaValue;
    existing.at = at;
    pack.updatedAt = at;
    writePack(uid, pack);
    return { ref: existing, pack };
  }
  if (pack.assetRefs.length >= MAX_MEETING_ASSET_REFS) {
    // 不静默挤掉最旧引用（那等于偷偷撤销用户建立过的引用）：如实拒绝。
    throw new MeetingRefError('meeting ref pack is full', 'ref_pack_full');
  }
  const ref: MeetingAssetRef = {
    assetId: asset,
    version: String(record.activeVersion || record.version || '1'),
    title: String(record.title ?? '').slice(0, MAX_TITLE_CHARS),
    type: record.type,
    via: viaValue,
    at,
  };
  pack.assetRefs.push(ref);
  pack.updatedAt = at;
  writePack(uid, pack);
  return { ref, pack };
}

/** 撤销一条资产引用（幂等：条目不存在时返回当前包，不报错）。 */
export async function detachMeetingAsset(
  uid: string,
  docId: string,
  assetId: string,
): Promise<MeetingAssetPack> {
  const id = requireDocId(docId);
  const asset = typeof assetId === 'string' && safeId(assetId) ? assetId : '';
  if (!asset) throw new MeetingRefError('invalid meeting assetId', 'invalid_asset_id');
  const pack = readPack(uid, id);
  if (!pack) return emptyPack(id);
  const before = pack.assetRefs.length;
  pack.assetRefs = pack.assetRefs.filter((ref) => ref.assetId !== asset);
  if (pack.assetRefs.length !== before) {
    pack.updatedAt = nowIso();
    writePack(uid, pack);
  }
  return pack;
}

/** 该文档的资产引用清单（只读；缺失 → 空数组。现状对比/stale 是读时派生，T037）。 */
export async function listMeetingAssetRefs(uid: string, docId: string): Promise<MeetingAssetRef[]> {
  const id = requireDocId(docId);
  const pack = readPack(uid, id);
  return pack ? [...pack.assetRefs] : [];
}

/** 该文档的引用包整体（缺失 → 空 pack；纪要双引用从同一份冻结取，T035 用）。 */
export async function readMeetingAssetPack(uid: string, docId: string): Promise<MeetingAssetPack> {
  const id = requireDocId(docId);
  return readPack(uid, id) ?? emptyPack(id);
}

// re-export：IPC 层（T013）与 meeting_conclusions（T035）共用同一套 docId 校验语义。
export { MeetingDocError };
