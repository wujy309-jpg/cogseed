import { readUnifiedOntologyCandidates, persistOntologyCandidates } from './cognition_bridge';
import { fileEditLock } from '../util/locks';
/**
 * Personal Ontology Candidates — 个人本体候选审阅功能。
 *
 * 从技能 `personal-ontology-candidate-builder` 产出的候选台账中读取候选列表，
 * 支持 UI 层展示、确认/驳回操作。候选数据存储在 `<uid>/local/ontology_candidates/`。
 *
 * 数据格式（人读 markdown，不是 JSON）：
 * - `candidates.md`     —— 当前待确认的候选池（本模块读写）
 * - `blocked_items.md`  —— 阻断项（技能生成，本模块只读，用于展示）
 *
 * 关键设计：候选不是「打个状态戳」就算完事。
 * - 确认一条候选 = 把它从候选池挪走，真正写入 `features/memory.ts`
 *   管理的 `USER.md`（个人画像）或 `MEMORY.md`（共享事实）——这才是
 *   会被塞进每次对话 system prompt、让 AI 真正「记住」的地方。
 * - 驳回一条候选 = 直接从候选池移除，不进入任何记忆。
 * 所以候选池里只会有「待确认」的条目，不需要 status/confirmed_at 之类的
 * 状态字段——存在于文件里 == 待确认，被处理过 == 从文件里消失。
 */

import * as fs from 'node:fs';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import { userLocalRoot, userOntologyGroupsDir } from '../paths';
import { writeTextAtomicSync, safeId, nowIso, readJsonSync } from '../storage';
import { notifyCognitionWrite } from './recall/store-events';
import { addEntry as addMemoryEntry, addEntryTransactional, addRoleTemplateMemoryEntry } from './memory';
import { listGroups } from './personal_ontology_groups';
import { routeCandidateToField } from './personal_ontology_router';
import {
  listTemplateFileCatalog,
  listFieldsByRef,
  appendFieldValueToRef,
  appendFlowEntryToRef,
  buildContentRef,
  splitContentRef,
  isTemplateFileText,
  parseTemplateContent,
  type TemplateSection,
} from './personal_ontology_template_files';
import { createLogger } from '../logger';
import {
  CorruptFileError,
  assertNotCorrupt,
  readTextGuarded,
} from '../util/corrupt-guard';
import type { FieldTargetStatus } from './personal_ontology_contract';

const log = createLogger('personal-ontology-candidates');

/** 坏档三件套的业务域名（恢复通道 cognition.corrupt.* 按 domain 寻址）。 */
export const CANDIDATES_CORRUPT_DOMAIN = 'ontology-candidates';

/** "选择去向"控件：确认一条候选时可以同时/分别写入全局记忆和任意数量的记忆
 *  分组，两者不互斥。`toGlobalMemory` 缺省为 true（向后兼容旧的单一去向行为）；
 *  `toGroupIds` 缺省为空数组（不写任何分组）。`targetField`（可选）：建议字段
 *  名（来自候选的 `target_field` / 用户在下拉里改选）——有坑填坑、没坑进流水区。 */
export interface ConfirmDestinations {
  toGlobalMemory?: boolean;
  toGroupIds?: string[];
  targetField?: string;
  /** 二期 D5：来源项目 id。确认落盘时附加到字段值（`@proj:<pid>`），展示层按项目过滤。 */
  projectId?: string;
}

/** Per-destination outcome, so the UI can tell "全局记忆写入失败" apart from
 *  "某个分组写入失败" and show them separately. */
export interface ConfirmCandidateResult {
  /** True once the candidate was actually placed somewhere (global memory
   *  and/or at least one group) and removed from the pending pool. False
   *  means every requested destination failed — the candidate stays in the
   *  pool, exactly like the pre-existing single-target behavior. */
  ok: boolean;
  error?: string;
  /** 冲突门命中时的矛盾集（specs/014 US-902）：error='conflict_detected' 时
   *  非空——每条一个「可能与现有值矛盾」的对端（字段 + 现有值）。 */
  conflicts?: Array<{ groupId: string; field: string; existingValue: string }>;
  globalMemory?: { ok: boolean; error?: string };
  groups?: Array<{ groupId: string; ok: boolean; error?: string }>;
  /** 阶段 B：每条填坑尝试（appendFieldValue）的结果；`ok:false` = 该组无此
   *  字段，已回退流水区（流水区结果在 `groups` 里）。无 targetField 时缺省。 */
  fieldWrites?: Array<{
    groupId: string;
    /** 候选/用户给的字段名（原样回显，不是换算后的名字）。 */
    fieldName: string;
    ok: boolean;
    error?: string;
    /**
     * 历史名换算的结果分档。产品行为不变（命不中一律回退流水区），但**回退的
     * 原因不再被吞成一句 `field not found`** —— 退役、歧义、认不出是三种不同的
     * 处置，日志/回执里分不出来就没法查。缺省（无 targetField 时）不带。
     */
    targetStatus?: FieldTargetStatus;
    /** 换算后真正写入的字段名；仅在与 fieldName 不同时出现。 */
    resolvedFieldName?: string;
  }>;
}

/** 候选类型。`preference`（偏好）是一等公民，不再藏在 relation 里。 */
export type CandidateKind = 'preference' | 'instance' | 'property' | 'relation' | 'rule';

/** 这条候选确认后应该进哪本记忆——对应 `features/memory.ts` 的两个用户级存储：
 *  `user`   → USER.md   （个人画像/偏好，跨 agent 生效，容量较小）
 *  `shared` → MEMORY.md （更泛化的事实/规则，跨项目跨 agent，容量稍大） */
export type MemoryTargetScope = 'user' | 'shared';

/** 敏感度级别：standard = 常规注入 prompt，restricted = 存但不注入 LLM，
 *  sensitive = 加密/额外保护（本版仅占位，暂与 restricted 行为一致）。 */
export type SensitivityLevel = 'standard' | 'restricted' | 'sensitive';

/** 写入者身份：标识候选由谁产出（用户手动/LLM 提取/技能生成）。 */
export type WriteActor = 'user' | 'llm' | 'skill';

export interface CandidateUpdate {
  candidate_id: string;
  kind: CandidateKind;
  confidence: 'low' | 'medium' | 'high';
  /** 一句人话摘要，卡片上直接展示，不再是原始 JSON payload。 */
  summary: string;
  /** 确认后写入哪本记忆。 */
  memory_scope: MemoryTargetScope;
  /** 确认后真正写进 USER.md/MEMORY.md 的精炼文本；缺省时回退用 summary。 */
  memory_text?: string;
  /** 可选：定位路径，方便浏览/以后做图谱视图，非必需。 */
  registry_like_path?: string;
  /** 可选：相对当前记忆的差异说明。 */
  diff_summary?: string;
  /** 阶段 B（可选）：建议字段名（技能预判，`- 建议字段:` 行）。确认时 App 预选，
   *  用户可在下拉里改；目标分组无此字段时回退流水区。 */
  target_field?: string;
  source_memory_refs: string[];
  /** 二期 D5：来源项目 id（候选进池时标记，`- 来源项目:` 行）。确认落盘附加
   *  `@proj:<pid>`；dest.projectId 显式传入时覆盖（用户/UI 意图优先）。 */
  project_id?: string;
  /** M3：敏感度级别。缺省 `standard`（兼容旧数据）。 */
  sensitivity?: SensitivityLevel;
  /** M3：写入者身份。缺省 `llm`（候选多由技能/LLM 产出）。 */
  write_actor?: WriteActor;
  /** M3：候选记录时间（ISO 8601）。缺省空字符串（旧数据无此字段）。 */
  recorded_time?: string;
}

export interface BlockedItem {
  source_ref: string;
  reason: string;
  required_fix: string;
}

export interface CandidatesData {
  candidate_updates: CandidateUpdate[];
  blocked_items: BlockedItem[];
  /** 坏档如实上报（P-r2-7 读侧结构化错误，失败≠空态）：池文件读错被拒时
   *  给渲染层展示「文件损坏+恢复入口」的依据；无坏档时缺省。 */
  corrupt?: { reason: string; at: string };
}

function candidatesDir(uid: string): string {
  return path.join(userLocalRoot(uid), 'ontology_candidates');
}

/** 候选池主档路径（cognition.corrupt.* 恢复通道按 domain 寻址时主进程用）。 */
export function candidatesMdPath(uid: string): string {
  return path.join(candidatesDir(uid), 'candidates.md');
}

function legacyCandidatesJsonPath(uid: string): string {
  return path.join(candidatesDir(uid), 'candidates.json');
}

function blockedItemsMdPath(uid: string): string {
  return path.join(candidatesDir(uid), 'blocked_items.md');
}

function readTextSafe(filePath: string): string {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

// ── candidates.md 解析/序列化 ────────────────────────────────────────────

const CANDIDATE_FIELD_LABELS: Record<string, string> = {
  '类型': 'kind',
  '置信度': 'confidence',
  '摘要': 'summary',
  '记忆去向': 'memory_scope',
  '记忆文本': 'memory_text',
  '路径': 'registry_like_path',
  '差异': 'diff_summary',
  '建议字段': 'target_field',
  '来源': 'source_memory_refs',
  '来源项目': 'project_id',
  '敏感度': 'sensitivity',
  '写入者': 'write_actor',
  '记录时间': 'recorded_time',
};

const VALID_KINDS: CandidateKind[] = ['preference', 'instance', 'property', 'relation', 'rule'];
const VALID_CONFIDENCE = ['low', 'medium', 'high'];
const VALID_SENSITIVITY: SensitivityLevel[] = ['standard', 'restricted', 'sensitive'];
const VALID_WRITE_ACTORS: WriteActor[] = ['user', 'llm', 'skill'];

function coerceKind(v: unknown): CandidateKind {
  return (VALID_KINDS as string[]).includes(String(v)) ? (v as CandidateKind) : 'instance';
}

function coerceConfidence(v: unknown): 'low' | 'medium' | 'high' {
  return (VALID_CONFIDENCE.includes(String(v)) ? v : 'medium') as 'low' | 'medium' | 'high';
}

function coerceSensitivity(v: unknown): SensitivityLevel {
  return (VALID_SENSITIVITY as string[]).includes(String(v)) ? (v as SensitivityLevel) : 'standard';
}

function coerceWriteActor(v: unknown): WriteActor {
  return (VALID_WRITE_ACTORS as string[]).includes(String(v)) ? (v as WriteActor) : 'llm';
}

function coerceMemoryScope(v: unknown): MemoryTargetScope {
  return String(v) === 'shared' ? 'shared' : 'user';
}

/** 把 candidates.md 解析成结构化候选数组。格式约定见 `serializeCandidatesMarkdown`。 */
export function parseCandidatesMarkdown(text: string): CandidateUpdate[] {
  const blocks = text.split(/\n(?=###\s+\S)/).map(b => b.trim()).filter(b => b.startsWith('### '));
  const out: CandidateUpdate[] = [];
  for (const block of blocks) {
    const lines = block.split('\n');
    const header = lines[0].match(/^###\s+(\S+)/);
    if (!header) continue;
    const raw: Record<string, string> = {};
    for (let i = 1; i < lines.length; i++) {
      const m = lines[i].match(/^-\s*([^:：]+)[:：]\s*(.*)$/);
      if (!m) continue;
      const field = CANDIDATE_FIELD_LABELS[m[1].trim()];
      if (field) raw[field] = m[2].trim();
    }
    const candidateId = header[1];
    if (!candidateId) continue;
    out.push({
      candidate_id: candidateId,
      kind: coerceKind(raw.kind),
      confidence: coerceConfidence(raw.confidence),
      summary: raw.summary || '',
      memory_scope: coerceMemoryScope(raw.memory_scope),
      memory_text: raw.memory_text || raw.summary || '',
      sensitivity: coerceSensitivity(raw.sensitivity),
      write_actor: coerceWriteActor(raw.write_actor),
      recorded_time: raw.recorded_time || '',
      ...(raw.registry_like_path ? { registry_like_path: raw.registry_like_path } : {}),
      ...(raw.diff_summary ? { diff_summary: raw.diff_summary } : {}),
      ...(raw.target_field ? { target_field: raw.target_field } : {}),
      ...(raw.project_id ? { project_id: raw.project_id } : {}),
      source_memory_refs: raw.source_memory_refs
        ? raw.source_memory_refs.split(',').map(s => s.trim()).filter(Boolean)
        : [],
    });
  }
  return out;
}

/**
 * 候选方言拍平（P-r1-27，决策卡拍板）：`candidates.md` 的字段值是单行
 * `- 字段: 值` 列表，多行值无法往返——续行被解析器静默丢弃（截断），形如
 * `- 类型: x` 的续行更会覆盖字段（kind 污染改变落库分档），confirm 再把
 * 截断值写库固化。序列化侧统一拍平成单行（换行/制表折叠为单空格，有损
 * 归一）——与 recall/personal-profile-sync.ts 投影拍平同款先例。
 */
function flattenInline(value: unknown): string {
  return String(value ?? '').replace(/[\r\n]+/g, ' ').replace(/[\t ]+/g, ' ').trim();
}

/** 把候选数组序列化成人读 markdown。技能产出内容也应遵循这个格式。
 *  所有自由文本字段值先经 flattenInline 拍平：落盘即单行，往返不再截断。 */
export function serializeCandidatesMarkdown(candidates: CandidateUpdate[]): string {
  const header = `# 个人本体候选（待确认）\n\n> 最后更新: ${nowIso()} | 共 ${candidates.length} 条待确认\n`;
  if (!candidates.length) return `${header}\n暂无待确认候选。\n`;
  const blocks = candidates.map(c => {
    const summary = flattenInline(c.summary);
    const memoryText = flattenInline(c.memory_text);
    const registryPath = flattenInline(c.registry_like_path);
    const diffSummary = flattenInline(c.diff_summary);
    const targetField = flattenInline(c.target_field);
    const projectId = flattenInline(c.project_id);
    const recordedTime = flattenInline(c.recorded_time);
    const sourceRefs = (c.source_memory_refs || []).map(flattenInline).filter(Boolean);
    const lines = [`### ${c.candidate_id}`];
    lines.push(`- 类型: ${c.kind}`);
    lines.push(`- 置信度: ${c.confidence}`);
    if (summary) lines.push(`- 摘要: ${summary}`);
    lines.push(`- 记忆去向: ${c.memory_scope}`);
    if (memoryText) lines.push(`- 记忆文本: ${memoryText}`);
    if (registryPath) lines.push(`- 路径: ${registryPath}`);
    if (diffSummary) lines.push(`- 差异: ${diffSummary}`);
    if (targetField) lines.push(`- 建议字段: ${targetField}`);
    if (projectId) lines.push(`- 来源项目: ${projectId}`);
    if (c.sensitivity && c.sensitivity !== 'standard') lines.push(`- 敏感度: ${c.sensitivity}`);
    if (c.write_actor && c.write_actor !== 'llm') lines.push(`- 写入者: ${c.write_actor}`);
    if (recordedTime) lines.push(`- 记录时间: ${recordedTime}`);
    if (sourceRefs.length) lines.push(`- 来源: ${sourceRefs.join(', ')}`);
    return lines.join('\n');
  });
  return `${header}\n${blocks.join('\n\n')}\n`;
}

// ── blocked_items.md 解析（只读，技能产出，本模块不写它）────────────────

function parseBlockedItemsMarkdown(text: string): BlockedItem[] {
  const blocks = text.split(/\n(?=###\s+\S)/).map(b => b.trim()).filter(b => b.startsWith('### '));
  const out: BlockedItem[] = [];
  for (const block of blocks) {
    const lines = block.split('\n');
    const header = lines[0].match(/^###\s+(.+)$/);
    if (!header) continue;
    let reason = '';
    let requiredFix = '';
    for (let i = 1; i < lines.length; i++) {
      const m = lines[i].match(/^-\s*([^:：]+)[:：]\s*(.*)$/);
      if (!m) continue;
      const label = m[1].trim();
      if (label === '原因') reason = m[2].trim();
      if (label === '修复建议') requiredFix = m[2].trim();
    }
    const sourceRef = header[1].trim();
    if (sourceRef) out.push({ source_ref: sourceRef, reason, required_fix: requiredFix });
  }
  return out;
}

// ── 旧版 candidates.json 一次性迁移 ───────────────────────────────────────
// 早期版本把候选存成 JSON，且「确认」只是打个状态标记，从未真正写入记忆。
// 首次以新格式读取时，就地迁移一次：已确认的直接补写进记忆（弥补历史欠账），
// 已驳回的丢弃，待确认的转换格式保留。迁移后把旧文件重命名为 .bak，不删除。

interface LegacyCandidate {
  candidate_id: string;
  kind?: string;
  confidence?: string;
  status?: string;
  diff_summary?: string;
  identity_scope_decision?: string;
  source_memory_refs?: string[];
  registry_like_path?: string;
  payload?: unknown;
}

interface LegacyCandidatesJson {
  candidate_updates?: LegacyCandidate[];
}

function legacySummaryFor(c: LegacyCandidate): string {
  if (c.diff_summary) return c.diff_summary;
  try { return JSON.stringify(c.payload).slice(0, 200); } catch { return c.candidate_id; }
}

// b6 回滚注（P-r2-11 async 化 → 恢复同步）：readCandidates/migrate 曾转
// async（补写走事务通道），但 await 让出点打破了 rejectCandidate「read→
// splice→write 全同步原子」的既有契约（probe-r2-candidate-lostwrite 用例 3
// 实证交错丢写复发），已按回滚令恢复同步形态。可重放加固（补写全部成功才
// 动池文件）保留；shared 补写退回同步 addMemoryEntry（事务化随 async 化
// 一并回滚，重新落地须与 reject 原子性一起裁决——例如把迁移挪出读路径）。
// writeCandidateToDestinations 的 addEntryTransactional（confirm 路径）不
// 在读路径，保留。
function migrateLegacyJsonIfPresent(uid: string): void {
  const mdPath = candidatesMdPath(uid);
  const jsonPath = legacyCandidatesJsonPath(uid);
  if (fs.existsSync(mdPath) || !fs.existsSync(jsonPath)) return;

  try {
    const legacy = readJsonSync<LegacyCandidatesJson>(jsonPath);
    const items = Array.isArray(legacy.candidate_updates) ? legacy.candidate_updates : [];
    const kept: CandidateUpdate[] = [];
    const backfills: Array<{ scope: MemoryTargetScope; summary: string; candidateId: string }> = [];
    let migratedToMemory = 0;

    for (const c of items) {
      if (!c || !c.candidate_id) continue;
      if (c.status === 'rejected') continue; // 驳回过的直接丢弃

      const summary = legacySummaryFor(c);
      const scope: MemoryTargetScope = c.identity_scope_decision === 'personal_global' ? 'user' : 'shared';

      if (c.status === 'confirmed') {
        // 历史欠账：之前「确认」只打了状态戳，从未真正写入记忆。这里补写。
        backfills.push({ scope, summary, candidateId: c.candidate_id });
        continue;
      }

      // pending → 转换格式，保留在候选池里
      kept.push({
        candidate_id: c.candidate_id,
        kind: coerceKind(c.kind),
        confidence: coerceConfidence(c.confidence),
        summary,
        memory_scope: scope,
        memory_text: summary,
        ...(c.registry_like_path ? { registry_like_path: c.registry_like_path } : {}),
        ...(c.diff_summary ? { diff_summary: c.diff_summary } : {}),
        source_memory_refs: Array.isArray(c.source_memory_refs) ? c.source_memory_refs : [],
      });
    }

    // P-r2-11 可重放加固（b6 回滚后保留）：补写全部成功才动池文件——任何一条
    // 补写失败都不写 candidates.md、不 rename，旧 json 原样保留，迁移可重放
    // （重放时已写入的条目由 addEntry 的文本去重幂等吸收）。修复前「补写失败
    // 也照样 rename」会让该条记忆永久丢失且无重放路径。
    // 注：补写曾改走 addEntryTransactional（事务通道），随「readCandidates
    // async 化」回滚一并退回同步 addMemoryEntry——重新事务化须与 reject 同步
    // 原子性一起裁决（见函数头 b6 回滚注）。
    let backfillFailed = false;
    for (const backfill of backfills) {
      try {
        const res = addMemoryEntry(uid, backfill.scope === 'user' ? 'user' : 'memory', backfill.summary);
        if (res.ok) migratedToMemory++;
        else {
          backfillFailed = true;
          log.warn('legacy confirmed candidate migration write failed', {
            uid, candidateId: backfill.candidateId, error: res.error,
          });
        }
      } catch (err) {
        backfillFailed = true;
        log.warn('legacy confirmed candidate migration write threw', {
          uid, candidateId: backfill.candidateId, error: (err as Error).message,
        });
      }
    }
    if (backfillFailed) return;

    writeTextAtomicSync(mdPath, serializeCandidatesMarkdown(kept));
    try {
      fs.renameSync(jsonPath, `${jsonPath}.bak`);
    } catch (err) {
      // mdPath 在迁移前不存在（迁移条件即 !exists），删掉它恢复迁移前状态，
      // 否则下次读取会被 exists(mdPath) 挡住、迁移永远无法重放。
      try { fs.rmSync(mdPath, { force: true }); } catch { /* 尽力而为 */ }
      throw err;
    }
    log.info('migrated legacy candidates.json', { uid, kept: kept.length, migratedToMemory });
  } catch (err) {
    log.warn('legacy candidates.json migration failed', { uid, error: (err as Error).message });
  }
}

// ── 读写 ─────────────────────────────────────────────────────────────────

/**
 * 读候选池（P-r2-7 三件套）：只吞**真 ENOENT**（空池初始化）；其它读错
 * （磁盘故障/权限等）先 copy `.corrupt-<ts>` 备份再抛 CorruptFileError——
 * 不再吞成空表让下一次写（含后台回流投放）全量覆写、候选池静默清空。
 */
// 2026-10-03：列表读取仍同步；异步持久化由池文件锁串行化读改写。
// 确认的目标写入可等待模型/其他业务，收尾重读池并只移除目标，避免旧数组覆写。
function readCandidates(uid: string): CandidateUpdate[] {
  const unified = readUnifiedOntologyCandidates(uid);
  if (unified) return unified as unknown as CandidateUpdate[];
  migrateLegacyJsonIfPresent(uid);
  const guarded = readTextGuarded(candidatesMdPath(uid), { domain: CANDIDATES_CORRUPT_DOMAIN });
  if (guarded.status === 'corrupt') throw new CorruptFileError(guarded.record);
  return parseCandidatesMarkdown(guarded.status === 'ok' ? guarded.text : '');
}

async function writeCandidates(uid: string, candidates: CandidateUpdate[]): Promise<void> {
  // 写侧门：坏档登记在案即拒绝（备份被移走不影响判定；恢复/重置后才可写）。
  assertNotCorrupt(candidatesMdPath(uid));
  await persistOntologyCandidates(uid, candidates as unknown as Record<string, unknown>[], async () => {
    writeTextAtomicSync(candidatesMdPath(uid), serializeCandidatesMarkdown(candidates));
  });
  notifyCognitionWrite(uid, 'ontology-candidates', 'update');
}

function readBlockedItems(uid: string): BlockedItem[] {
  return parseBlockedItemsMarkdown(readTextSafe(blockedItemsMdPath(uid)));
}

/**
 * 读取候选列表 + 阻断项。文件不存在时返回空数组（首次读取会顺带触发旧数据迁移）。
 * 池文件坏档（非 ENOENT 读错）时不再吞成空表：corrupt 字段如实带回坏档信息，
 * 渲染层据此出「从备份恢复/重置」入口（写侧此时已被 corrupt-guard 拒绝）。
 */
export async function listCandidates(uid: string): Promise<CandidatesData> {
  if (!safeId(uid)) throw new Error('invalid uid');
  let candidates: CandidateUpdate[] = [];
  let corrupt: CandidatesData['corrupt'];
  try {
    candidates = readCandidates(uid);
  } catch (err) {
    if (!(err instanceof CorruptFileError)) throw err;
    corrupt = { reason: err.record.reason, at: err.record.at };
  }
  return {
    candidate_updates: candidates,
    blocked_items: readBlockedItems(uid),
    ...(corrupt ? { corrupt } : {}),
  };
}

export interface AddCandidateInput extends Partial<CandidateUpdate> {
  summary: string;
}

/**
 * Append a single candidate produced by an expert-team member.
 *
 * A caller-supplied candidate_id is an idempotency key: the latest payload
 * replaces the existing row instead of creating a duplicate.
 */
async function addCandidateUnlocked(
  uid: string,
  input: AddCandidateInput,
): Promise<{ ok: true; candidate: CandidateUpdate; candidates: CandidateUpdate[] }> {
  if (!safeId(uid)) throw new Error('invalid uid');
  const summary = typeof input?.summary === 'string' ? input.summary.trim() : '';
  const memoryText = typeof input?.memory_text === 'string' ? input.memory_text.trim() : '';
  if (!summary && !memoryText) throw new Error('candidate has no text');

  const candidateId = typeof input?.candidate_id === 'string' && input.candidate_id
    ? input.candidate_id
    : `c_${crypto.randomBytes(8).toString('hex')}`;
  if (!safeId(candidateId)) throw new Error('invalid candidate id');

  const candidate: CandidateUpdate = {
    candidate_id: candidateId,
    kind: coerceKind(input.kind),
    confidence: input.confidence === undefined ? 'medium' : coerceConfidence(input.confidence),
    summary: summary || memoryText,
    memory_scope: coerceMemoryScope(input.memory_scope),
    ...(memoryText ? { memory_text: memoryText } : {}),
    ...(typeof input.registry_like_path === 'string' && input.registry_like_path.trim()
      ? { registry_like_path: input.registry_like_path.trim() }
      : {}),
    ...(typeof input.diff_summary === 'string' && input.diff_summary.trim()
      ? { diff_summary: input.diff_summary.trim() }
      : {}),
    ...(typeof input.target_field === 'string' && input.target_field.trim()
      ? { target_field: input.target_field.trim() }
      : {}),
    source_memory_refs: Array.isArray(input.source_memory_refs)
      ? input.source_memory_refs.filter((ref): ref is string => typeof ref === 'string' && !!ref)
      : [],
    ...(typeof input.project_id === 'string' && input.project_id.trim()
      ? { project_id: input.project_id.trim() }
      : {}),
    sensitivity: input.sensitivity === undefined ? 'standard' : coerceSensitivity(input.sensitivity),
    write_actor: input.write_actor === undefined ? 'llm' : coerceWriteActor(input.write_actor),
    recorded_time: typeof input.recorded_time === 'string' && input.recorded_time.trim()
      ? input.recorded_time.trim()
      : nowIso(),
  };

  const candidates = readCandidates(uid);
  const index = candidates.findIndex((item) => item.candidate_id === candidateId);
  if (index >= 0) candidates[index] = candidate;
  else candidates.push(candidate);
  await writeCandidates(uid, candidates);
  return { ok: true, candidate, candidates };
}

/** P-r1-31：onboarding 批量入池函数 addCandidates（连同其私有映射
 *  OnboardingCandidate / mapOnboardingType）已删——生产零调用，注释描述的
 *  onboarding 第 4 步流程不存在；单条入池走 addCandidate（回流线
 *  ontology-backflow 也用它）。 */

/**
 * 判断 groupId 是否模板文件组（阶段 D：台账带 template_id 且文件携带
 * `> 模板:` 元信息行）。是 → 返回 template_id + 解析出的分节（含字段与流水）；
 * 否 → null。模板文件是模板组的唯一事实来源；候选路由必须按分节寻址，
 * 双区解析器会把分节式文件误当纯文本流水（fields 恒空），导致“有坑填坑”判断失真。
 */
async function resolveTemplateGroupSections(
  uid: string,
  groupId: string,
): Promise<{ template_id: string; sections: TemplateSection[] } | null> {
  try {
    const groups = await listGroups(uid);
    const meta = groups.find((g) => g.group_id === groupId);
    if (!meta || !meta.template_id) return null;
    const rel = meta.rel_path || `.personal_ontology_groups/${meta.template_id}.md`;
    const abs = path.join(userOntologyGroupsDir(uid), rel.replace(/^\.personal_ontology_groups\//, ''));
    const text = fs.readFileSync(abs, 'utf8');
    if (!isTemplateFileText(text)) return null;
    return { template_id: meta.template_id, sections: parseTemplateContent(text).sections };
  } catch {
    return null;
  }
}

/**
 * 候选的「建议字段」→ 当前 schema 下的真实落点。
 *
 * `target_field` 是**长期存在候选池里**的一个裸字段名（`- 建议字段:` 行，候选生成
 * 那一刻的 schema）。候选还没确认、角色模板先做了 rename / move 迁移时，拿旧字面量
 * 去文件里找只会落空 —— 值退回流水区、预选无声消失。这里在消费的那一刻做一次换算。
 *
 * **候选文件本身不动**：不重写 candidates.md，不批量迁移存量，换算只发生在读取侧。
 *
 * 换算走 PO contract 的 resolveRoleTemplateFieldTarget（唯一那道 identity 阶梯），
 * 这里不自建第二套名字兼容逻辑。普通记忆分组没有角色模板 schema，原样返回。
 */
async function resolveCandidateFieldTarget(
  uid: string,
  groupRef: string,
  targetField: string,
): Promise<{ ref: string; fieldName: string; section?: string; status: FieldTargetStatus; resolved: boolean }> {
  const { groupId: baseId, section } = splitContentRef(groupRef);
  const tpl = await resolveTemplateGroupSections(uid, baseId);
  // 普通组：没有角色模板 schema，无从换算，行为与改动前完全一致。
  if (!tpl) return { ref: groupRef, fieldName: targetField, status: 'current_name', resolved: true };

  const { resolveRoleTemplateFieldTarget, isResolvedFieldTarget } =
    await import('./personal_ontology_contract');
  // 复合 ref 自带分节上下文；模板整组（候选没有分节概念）则不给，让它走全模板解析。
  const res = resolveRoleTemplateFieldTarget(tpl.template_id, targetField, section || undefined);
  // 认不出 / 退役 / 歧义 → 不是可写落点。**必须在这里断掉**：候选自动通道只填
  // T-box 声明过的坑，不得顺手写用户自建字段，也不得复活退役字段。
  if (!isResolvedFieldTarget(res)) {
    return { ref: groupRef, fieldName: targetField, status: res.status, resolved: false };
  }
  return {
    ref: section ? buildContentRef(baseId, res.section as string) : groupRef,
    fieldName: res.fieldName as string,
    section: res.section,
    status: res.status,
    resolved: true,
  };
}

/** 命不中落点时的可观测记录：四种原因分开，不吞成一句 field not found。 */
function recordFieldTargetMiss(
  result: ConfirmCandidateResult,
  uid: string,
  candidateId: string,
  groupId: string,
  targetField: string,
  status: FieldTargetStatus,
): void {
  result.fieldWrites!.push({
    groupId, fieldName: targetField, ok: false, error: 'field not found', targetStatus: status,
  });
  log.warn('candidate field target unresolved, falling back to flow', {
    uid, candidateId, groupId, targetField, targetStatus: status,
  });
}

/**
 * 把一条候选实际写入所有请求的去向（全局记忆 + 0..N 个记忆分组）。不改候选池，
 * 纯粹的“写”这一步 —— 候选池的增删由调用方（confirmCandidate）
 * 负责，方便批量场景复用同一份落地逻辑。
 *
 * 容错风格：一个去向失败不影响其余去向。只要至少一个去向
 * 写入成功，就认为这条候选“已处理”，应该从池里移除；如果全部去向都失败
 * （或没有任何去向被请求），候选保留在池里，不会静默丢失。
 */
async function writeCandidateToDestinations(
  uid: string,
  candidate: CandidateUpdate,
  dest: ConfirmDestinations,
  source = '候选',
  userPickedRole = false,
  opts: ConfirmCandidateOptions = {},
): Promise<ConfirmCandidateResult> {
  const text = (candidate.memory_text || candidate.summary || '').trim();
  if (!text) return { ok: false, error: 'candidate has no memory text' };
  // 确认时刻的 asof（蓝图 R26）：用户此刻认可这条值正确 → 落时间锚，
  // 12 个月后超龄提示自然生效。仅字段值路径携带；流水区条目本就是带时间
  // 语义的追加日志，不重复标。
  const confirmAsOf = new Date().toISOString().slice(0, 7);

  const wantsGlobal = dest.toGlobalMemory !== false; // default true — back-compat
  const groupIds = Array.isArray(dest.toGroupIds) ? dest.toGroupIds.filter(Boolean) : [];

  const result: ConfirmCandidateResult = { ok: false };
  let anySucceeded = false;

  if (wantsGlobal) {
    // 双轨（2026-09-19 记忆退役衔接债收口）：画像主源已切资产库——已有
    // personal 生效资产时 USER.md 不再被注入，确认内容写旧文件=白确认。
    // 有画像资产 → 投 recall 候选并立即以用户身份晋升（走 promote 的语义
    // 查重门，与 09-19 认知资产终态同链路）；空 → 回退旧文件路径（新用户
    // 兼容，与 formatForSystemPrompt 的自然切换同哲学）。
    let assetTrack: { ok: boolean; error?: string } | null = null;
    try {
      const { listAbilityAssets } = await import('./recall/asset-service');
      const hasPersonal = (await listAbilityAssets(uid))
        .some((a) => a && a.type === 'personal' && a.status === 'active');
      if (hasPersonal) {
        const { saveRecallCandidate, promoteRecallCandidate } =
          await import('./recall/candidate-service');
        // 候选 kind → 资产 type：规则类成 rule（R-Box 断言形状），其余
        // （偏好/实例/属性/关系）都归 personal 画像（A-Box 断言形状）。
        const suggestedType = candidate.kind === 'rule' ? 'rule' : 'personal';
        const saved = await saveRecallCandidate(uid, {
          judgment: text,
          // 本体回流=用户已确认的历史候选原文：豁免入池正文闸门。
          rawStatement: true,
          value: text,
          // 标题一等化（设计 3.2）：本体候选自带 summary 时作为晋升标题优先
          // 传入；缺省则由晋升链的起标题兜底处理（不再吃正文首句兜底）。
          ...(candidate.summary ? { summary: candidate.summary } : {}),
          suggestedType,
          suggestedScope: 'general',
          suggestedAction: 'create',
          sourceRefs: [{ kind: 'memory', id: 'ontology-candidate', title: '个人本体候选确认' }],
        });
        try {
          await promoteRecallCandidate(uid, saved.id, { actor: 'user' });
          assetTrack = { ok: true };
        } catch (promoteErr) {
          const errCode = (promoteErr as { code?: string })?.code;
          if (errCode === 'recall_candidate_similar_asset') {
            // 语义查重拦下：库里已有讲同一件事的资产（回流候选确认必然
            // 撞上源资产）。用户意图是「内容进全局记忆」——已有资产承载
            // 即意图已满足，不重复建第二条散资产。
            log.info('candidate confirm merged into existing asset by semantic gate', {
              uid, candidateId: candidate.candidate_id,
            });
            assetTrack = { ok: true };
          } else if (errCode) {
            assetTrack = { ok: false, error: (promoteErr as Error).message || errCode };
          } else {
            throw promoteErr;
          }
        }
      }
    } catch (err) {
      assetTrack = { ok: false, error: (err as Error)?.message || String(err) };
    }
    if (assetTrack) {
      result.globalMemory = assetTrack;
      if (assetTrack.ok) anySucceeded = true;
      else log.warn('candidate asset-track confirm failed', { uid, candidateId: candidate.candidate_id, error: assetTrack.error });
    } else {
      const target = candidate.memory_scope === 'shared' ? 'memory' : 'user';
      // 角色标签：只有**用户显式选了角色模板**（去向含模板组）时，全局记忆条目才附带
      // 来源标记；LLM 自动加入的模板去向（userPickedRole=false）不打标签 —— 否则
      // 用户从未关联的角色会在卸载时连带归档/删除其全局记忆（A-4）。
      let roleTemplateId: string | undefined;
      if (userPickedRole) {
        for (const gid of groupIds) {
          const tpl = await resolveTemplateGroupSections(uid, gid.split('::')[0]);
          if (tpl) { roleTemplateId = tpl.template_id; break; }
        }
      }
      // P-r2-11：shared MEMORY.md 的确认写入必须走事务通道（与整文件回滚
      // 互斥，裸写会被并发事务的回滚整段抹掉）；USER.md / 模板独立文件不跨
      // cognition 事务，保持直写。只包全局记忆写这一段——本函数后续的分组
      // 写入会拿组文件锁，不得在持有 memory 事务时再拿组锁（锁序固定为
      // 组锁 → memory 事务，反向嵌套会死锁）。
      const res = roleTemplateId
        ? addRoleTemplateMemoryEntry(uid, target, roleTemplateId, text)
        : target === 'memory'
          ? await addEntryTransactional(uid, 'memory', text)
          : addMemoryEntry(uid, target, text);
      result.globalMemory = { ok: res.ok, ...(res.error ? { error: res.error } : {}) };
      if (res.ok) anySucceeded = true;
      else log.warn('candidate global-memory write blocked', { uid, candidateId: candidate.candidate_id, error: res.error });
    }
  }

  // 写入前冲突门（specs/014 US-902 / T013）：只拦**字段值写入**——流水区 /
  // 全局记忆路径不拦（B6①：AC 只覆盖「确认候选、写入字段值时」）。命中且
  // 未 acknowledgeConflict → 零写入、候选留在池里（不静默，SC-002）。
  if (groupIds.length && dest.targetField) {
    const { precheckFieldValueConflict } = await import('./recall/ontology-conflicts');
    const gated: Array<{ groupId: string; field: string; existingValue: string }> = [];
    for (const groupId of groupIds) {
      const target = await resolveCandidateFieldTarget(uid, groupId, dest.targetField);
      if (!target.resolved) continue;
      const pre = await precheckFieldValueConflict(uid, target.ref, target.fieldName, text);
      if (pre.degraded) {
        log.info('conflict gate degraded: embedding unavailable, letting through', {
          uid, groupId, field: target.fieldName,
        });
      }
      for (const conflict of pre.conflicts) {
        gated.push({ groupId, field: conflict.field, existingValue: conflict.existingValue });
      }
    }
    if (gated.length && !opts.acknowledgeConflict) {
      return { ok: false, error: 'conflict_detected', conflicts: gated };
    }
    // acknowledgeConflict=true 走到这里 = 已重新预检（写入时刻为准，I-8），放行。
  }

  if (groupIds.length) {
    for (const groupId of groupIds) {
      // 模板文件组：候选没有分节概念，跨分节路由 —— targetField 命中该模板
      // 某分节的字段 → 写那个分节；未命中 / 无 targetField → 回退首个分节
      // 流水区（模板文件没有整组流水区；数据不丢，可后续升格）。
      const tpl = await resolveTemplateGroupSections(uid, groupId);
      if (tpl && tpl.sections.length) {
        // 候选自动通道的白名单：只填模板 T-box 声明过的字段（“有坑填坑”）；
        // 自定义字段只能由用户手动升格创建，候选不得顺手建坑。判据与历史名换算
        // 都来自 contract（单一实现）；模板未知 / 认不出 → 不放行。
        if (dest.targetField) {
          if (!result.fieldWrites) result.fieldWrites = [];
          const target = await resolveCandidateFieldTarget(uid, groupId, dest.targetField);
          // 先按 catalog 当前分节找，再退回“文件里哪一节有这个字段就写哪一节”——
          // 后者是换算之前的既有行为，实例文件与 catalog 暂时不同步时不该变坏。
          const has = (sec: TemplateSection) =>
            Object.prototype.hasOwnProperty.call(sec.fields, target.fieldName);
          const sec = !target.resolved
            ? undefined
            : tpl.sections.find((x) => has(x) && x.title === target.section) || tpl.sections.find(has);
          if (sec) {
            const res = await appendFieldValueToRef(uid, `${groupId}::${sec.title}`, target.fieldName, text, source, dest.projectId ?? candidate.project_id, confirmAsOf);
            result.fieldWrites.push({
              groupId,
              fieldName: dest.targetField as string,
              ok: res.ok,
              targetStatus: target.status,
              ...(target.fieldName !== dest.targetField ? { resolvedFieldName: target.fieldName } : {}),
              ...(res.error ? { error: res.error } : {}),
            });
            if (res.ok) anySucceeded = true;
            else log.warn('candidate template field write failed', { uid, candidateId: candidate.candidate_id, groupId, error: res.error });
            continue; // 已尝试填坑，不再写流水区
          }
          recordFieldTargetMiss(result, uid, candidate.candidate_id, groupId, dest.targetField, target.status);
        }
        const res = await appendFlowEntryToRef(uid, `${groupId}::${tpl.sections[0].title}`, text);
        if (!result.groups) result.groups = [];
        result.groups.push({ groupId, ok: res.ok, ...(res.error ? { error: res.error } : {}) });
        if (res.ok) anySucceeded = true;
        else log.warn('candidate template flow write failed', { uid, candidateId: candidate.candidate_id, groupId, error: res.error });
        continue;
      }

      // 阶段 B/D 路由：有 targetField → 先判该去向有没有这个“坑”（模板分节
      // 字段或普通组实例字段，见 listFieldsByRef），有 → appendFieldValueToRef
      // （多值追加+[候选]/[智能]来源）；没有 → 回退流水区 appendFlowEntryToRef。
      // 无 targetField → 直接流水区（旧行为）。
      // 裁决说明：任务书 §3.3 的“返回 field not found 则回退”通过 listFieldsByRef
      // 预检查实现，避免与 §3.2“appendFieldValue 字段小节不存在则创建”冲突。
      if (dest.targetField) {
        if (!result.fieldWrites) result.fieldWrites = [];
        // 复合 ref（gid::分节）指向的是模板分节，历史名要先换算；普通组原样。
        const target = await resolveCandidateFieldTarget(uid, groupId, dest.targetField);
        let fieldExists = false;
        try {
          const fieldsRes = target.resolved ? await listFieldsByRef(uid, target.ref) : undefined;
          fieldExists = !!fieldsRes?.fields?.some((f) => f.name === target.fieldName);
        } catch {
          fieldExists = false;
        }
        if (fieldExists) {
          const res = await appendFieldValueToRef(uid, target.ref, target.fieldName, text, source, dest.projectId ?? candidate.project_id, confirmAsOf);
          result.fieldWrites.push({
            groupId,
            fieldName: dest.targetField as string,
            ok: res.ok,
            targetStatus: target.status,
            ...(target.fieldName !== dest.targetField ? { resolvedFieldName: target.fieldName } : {}),
            ...(res.error ? { error: res.error } : {}),
          });
          if (res.ok) anySucceeded = true;
          else log.warn('candidate field write failed', { uid, candidateId: candidate.candidate_id, groupId, error: res.error });
          continue; // 已尝试填坑，不再写流水区
        }
        recordFieldTargetMiss(result, uid, candidate.candidate_id, groupId, dest.targetField, target.status);
      }
      const res = await appendFlowEntryToRef(uid, groupId, text);
      if (!result.groups) result.groups = [];
      result.groups.push({ groupId, ok: res.ok, ...(res.error ? { error: res.error } : {}) });
      if (res.ok) anySucceeded = true;
      else log.warn('candidate group write failed', { uid, candidateId: candidate.candidate_id, groupId, error: res.error });
    }
  }

  result.ok = anySucceeded;
  if (!anySucceeded && !result.error) {
    result.error = wantsGlobal || groupIds.length ? 'all destinations failed' : 'no destination selected';
  }
  return result;
}

export interface ConfirmCandidateOptions {
  /** 确认时经一轮 LLM 识别路由：没显式指定字段的候选，由 LLM 判断填哪个模板组
   *  字段（来源标「智能」）；拿不准/失败回退流水区。默认关闭（老行为）。 */
  routeWithLlm?: boolean;
  /** 写入前冲突门的越过标记（specs/014 US-902）：渲染层在冲突对话里点了
   *  「仍然写入」才带 true——**重新预检后**放行（以写入时刻为准，I-8）。 */
  acknowledgeConflict?: boolean;
}

/**
 * LLM 路由解析：routeWithLlm 且候选未显式指定 targetField 时，调 LLM 判断
 * 填哪个模板文件分节的哪个字段。用户已指定字段 → 不覆盖（用户意图优先）。
 * 命中模板分节 → toGroupIds push 复合 id（`groupId::分节`，分节编码在内，
 * 无需新增 targetSection 参数）；命中普通组 → 仅设 targetField（预检查兜底）。
 * 返回生效的 dest + 来源标记（'智能' 或 '候选'）。
 */
async function resolveLlmRoute(
  uid: string,
  candidate: CandidateUpdate,
  dest: ConfirmDestinations,
  opts: ConfirmCandidateOptions,
): Promise<{ effectiveDest: ConfirmDestinations; source: string; userPickedRole: boolean }> {
  // 用户是否显式选过角色模板（原始 dest 含模板组）。LLM 分支 3 自动加入的模板
  // 不算 —— 那只是"自动归位"，用户没有主动关联该角色。
  const userPickedRole = (dest.toGroupIds || []).some((id) => {
    if (id.includes('::')) return false; // 复合 id 是分节，不是模板组本身
    return true;
  });
  if (!opts.routeWithLlm || dest.targetField) return { effectiveDest: dest, source: '候选', userPickedRole };
  const text = (candidate.memory_text || candidate.summary || '').trim();
  if (!text) return { effectiveDest: dest, source: '候选', userPickedRole };

  const catalog = await listTemplateFileCatalog(uid);
  if (!catalog.length) return { effectiveDest: dest, source: '候选', userPickedRole };
  const decision = await routeCandidateToField(uid, text, catalog);
  if (decision.action !== 'field' || !decision.group_title || !decision.field_name) {
    return { effectiveDest: dest, source: '候选', userPickedRole }; // flow → 维持原 dest（流水区）
  }

  const dest2: ConfirmDestinations = { ...dest, toGroupIds: dest.toGroupIds ? [...dest.toGroupIds] : [] };

  // 1) 用户已选模板分节（复合 id）→ 字段必须在该分节内
  for (const ref of dest2.toGroupIds) {
    const { groupId, section } = splitContentRef(ref);
    if (!section) continue;
    const entry = catalog.find((e) => e.group_id === groupId);
    if (entry && entry.sections.some((s) => s.title === section && s.fields.includes(decision.field_name))) {
      dest2.targetField = decision.field_name;
      return { effectiveDest: dest2, source: '智能', userPickedRole };
    }
  }
  // 2) 用户已选普通组（title 匹配）→ 建议字段，最终由 listFieldsByRef 预检查兜底
  const groups = await listGroups(uid);
  if (dest2.toGroupIds.some((id) =>
    groups.some((g) => g.group_id === id && !g.template_id && g.title === decision.group_title),
  )) {
    dest2.targetField = decision.field_name;
    return { effectiveDest: dest2, source: '智能', userPickedRole };
  }
  // 2b) 用户只选了角色（模板组纯 group_id，未展开到分节）→ 在该角色模板内找分节，
  //     命中则把去向收窄到该分节复合 id + 目标字段（LLM 自动归位）。
  for (const id of dest2.toGroupIds) {
    if (id.includes('::')) continue; // 已是复合 id，走上面的分节分支
    const entry = catalog.find((e) => e.group_id === id);
    if (!entry) continue;
    const sec = entry.sections.find((s) => s.title === decision.group_title && s.fields.includes(decision.field_name));
    if (sec) {
      dest2.toGroupIds = dest2.toGroupIds.filter((x) => x !== id);
      dest2.toGroupIds.push(buildContentRef(id, sec.title));
      dest2.targetField = decision.field_name;
      return { effectiveDest: dest2, source: '智能', userPickedRole };
    }
  }
  // 3) 用户没选组 → 找第一个含该分节.字段的模板文件，自动加入（复合 id）
  if (!dest2.toGroupIds.length) {
    const hit = catalog.find((e) =>
      e.sections.some((s) => s.title === decision.group_title && s.fields.includes(decision.field_name)),
    );
    if (hit) {
      dest2.toGroupIds.push(buildContentRef(hit.group_id, decision.group_title));
      dest2.targetField = decision.field_name;
      return { effectiveDest: dest2, source: '智能', userPickedRole: false };
    }
  }
  return { effectiveDest: dest, source: '候选', userPickedRole };
}

/**
 * 确认一个候选：写入所有请求的去向（默认只写全局记忆，向后兼容旧行为），
 * 至少一个去向成功即从候选池移除；全部失败则保留在池里，不会静默丢失。
 * `opts.routeWithLlm` 开启时先做一轮 LLM 对号入座路由（见 resolveLlmRoute）。
 */
async function confirmCandidateUnlocked(
  uid: string,
  candidateId: string,
  dest: ConfirmDestinations = {},
  opts: ConfirmCandidateOptions = {},
): Promise<ConfirmCandidateResult> {
  if (!safeId(uid) || !candidateId) throw new Error('invalid uid or candidateId');

  const candidates = readCandidates(uid);
  const idx = candidates.findIndex(c => c.candidate_id === candidateId);
  if (idx === -1) {
    log.warn('confirmCandidate: candidate not found', { uid, candidateId });
    return { ok: false, error: 'candidate not found' };
  }

  const candidate = candidates[idx];
  const { effectiveDest, source, userPickedRole } = await resolveLlmRoute(uid, candidate, dest, opts);
  const result = await writeCandidateToDestinations(uid, candidate, effectiveDest, source, userPickedRole, opts);
  if (!result.ok) return result;

  await fileEditLock(candidatesMdPath(uid)).runExclusive(async () => {
    const latest = readCandidates(uid);
    await writeCandidates(uid, latest.filter(c => c.candidate_id !== candidateId));
  });
  log.info('candidate confirmed and written to destinations', {
    uid, candidateId,
    globalMemory: result.globalMemory?.ok,
    groupCount: result.groups?.length || 0,
    fieldCount: result.fieldWrites?.length || 0,
    source,
  });
  return result;
}

/**
 * 驳回一个候选：直接从候选池移除，不写入任何记忆。
 */
async function rejectCandidateUnlocked(uid: string, candidateId: string, reason?: string): Promise<{ ok: boolean }> {
  if (!safeId(uid) || !candidateId) throw new Error('invalid uid or candidateId');

  const candidates = readCandidates(uid);
  const idx = candidates.findIndex(c => c.candidate_id === candidateId);
  if (idx === -1) {
    log.warn('rejectCandidate: candidate not found', { uid, candidateId });
    return { ok: false };
  }

  candidates.splice(idx, 1);
  await writeCandidates(uid, candidates);
  log.info('candidate rejected', { uid, candidateId, reason });
  return { ok: true };
}

/**
 * 批量驳回。
 */
async function rejectCandidatesUnlocked(uid: string, candidateIds: string[], reason?: string): Promise<{ ok: boolean; rejectedCount: number }> {
  if (!safeId(uid)) throw new Error('invalid uid');
  if (!Array.isArray(candidateIds) || !candidateIds.length) return { ok: true, rejectedCount: 0 };

  const candidates = readCandidates(uid);
  const idSet = new Set(candidateIds);
  const remaining = candidates.filter(c => !idSet.has(c.candidate_id));
  const rejectedCount = candidates.length - remaining.length;

  if (rejectedCount > 0) {
    await writeCandidates(uid, remaining);
    log.info('candidates batch rejected', { uid, rejectedCount, reason });
  }

  return { ok: true, rejectedCount };
}

/**
 * 按记忆文本驳回（P-r1-29 兜存量）：purge 级联里，带资产正文全文的回流
 * 候选不止 `asset-backflow-<assetId>` 一条 id——回流池满、id 之外的历史
 * 投放都可能留下同文 pending 候选，确认即复活已 purge 的正文。这里把
 * memory_text 与给定正文全文相等（拍平空白后）的候选一并驳回。
 *
 * 只做全文相等，不做包含匹配：包含会把用户自己的相近记忆一起清掉。
 * 空文本直接返回——空串与任何候选都不该匹配。
 */
async function rejectCandidatesByTextUnlocked(
  uid: string,
  text: string,
  reason?: string,
): Promise<{ ok: boolean; rejectedCount: number }> {
  if (!safeId(uid)) throw new Error('invalid uid');
  const needle = flattenInline(text);
  if (!needle) return { ok: true, rejectedCount: 0 };

  const candidates = readCandidates(uid);
  const remaining = candidates.filter(c => flattenInline(c.memory_text) !== needle);
  const rejectedCount = candidates.length - remaining.length;

  if (rejectedCount > 0) {
    await writeCandidates(uid, remaining);
    log.info('candidates rejected by text match (purge cascade)', { uid, rejectedCount, reason });
  }

  return { ok: true, rejectedCount };
}

/** 同一候选池读改写串行化；确认跨 await 不再覆盖期间新增/驳回。 */
export const addCandidate = (...args: Parameters<typeof addCandidateUnlocked>): ReturnType<typeof addCandidateUnlocked> => {
  if (!safeId(args[0])) return Promise.reject(new Error('invalid uid'));
  return fileEditLock(candidatesMdPath(args[0])).runExclusive(() => addCandidateUnlocked(...args));
};

/** 同一候选的重复确认串行化；等待期间不占池锁，收尾在池锁内重读。 */
export const confirmCandidate = (...args: Parameters<typeof confirmCandidateUnlocked>): ReturnType<typeof confirmCandidateUnlocked> => {
  if (!safeId(args[0])) return Promise.reject(new Error('invalid uid'));
  return fileEditLock(candidatesMdPath(args[0]) + ':confirm:' + args[1]).runExclusive(() => confirmCandidateUnlocked(...args));
};

/** 同一候选池读改写串行化；确认跨 await 不再覆盖期间新增/驳回。 */
export const rejectCandidate = (...args: Parameters<typeof rejectCandidateUnlocked>): ReturnType<typeof rejectCandidateUnlocked> => {
  if (!safeId(args[0])) return Promise.reject(new Error('invalid uid'));
  return fileEditLock(candidatesMdPath(args[0])).runExclusive(() => rejectCandidateUnlocked(...args));
};

/** 同一候选池读改写串行化；确认跨 await 不再覆盖期间新增/驳回。 */
export const rejectCandidates = (...args: Parameters<typeof rejectCandidatesUnlocked>): ReturnType<typeof rejectCandidatesUnlocked> => {
  if (!safeId(args[0])) return Promise.reject(new Error('invalid uid'));
  return fileEditLock(candidatesMdPath(args[0])).runExclusive(() => rejectCandidatesUnlocked(...args));
};

/** 同一候选池读改写串行化；确认跨 await 不再覆盖期间新增/驳回。 */
export const rejectCandidatesByText = (...args: Parameters<typeof rejectCandidatesByTextUnlocked>): ReturnType<typeof rejectCandidatesByTextUnlocked> => {
  if (!safeId(args[0])) return Promise.reject(new Error('invalid uid'));
  return fileEditLock(candidatesMdPath(args[0])).runExclusive(() => rejectCandidatesByTextUnlocked(...args));
};
