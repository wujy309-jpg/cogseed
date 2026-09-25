/**
 * Personal Ontology Groups — “本体分组”存储层。
 *
 * 一个分组 = 一个独立的 markdown 文件，物理存放在 Library 树下的隐藏子目录
 * `<uid>/cloud/contexts/.personal_ontology_groups/`（复用 contexts.ts 的
 * “点前缀 = 隐藏”约定，见 CONTEXTS_IGNORE / hasHiddenContextPathSegment：
 * listContextsTree 和 rebuildIndex 都会跳过点前缀条目，所以这些文件不会出现在
 * 资料库树形浏览器或 `_INDEX.md` 里）。
 *
 * 为什么不复用 contexts.ts 的 writeContextFile / resolveContextFileAbsPath：
 * 那些对外 API 专门拒绝点前缀路径（hasHiddenContextPathSegment），是用来防止
 * 用户越权碰 `.kb/` 的安全闸门。既然本体分组故意要隐藏，就必然会被那道闸门拦下，
 * 所以这里独立抄一份简化版的路径校验 + 原子写入（同样用 writeTextAtomicSync），
 * 不经过 contexts.ts 的对外拦截规则。
 *
 * 安全代价（产品已确认接受，见需求交接文档第二节决策 6）：分组文件仍然物理落在
 * Library 树下，写入时这里会主动调用 `kb_indexer.enqueue` + `search.upsertContext`
 * （跟 contexts.ts 的写入路径一致），所以模型的 kb_search/kb_read 工具理论上能
 * 搜到、读到这些文件的内容，即使这一轮对话没有通过 @ 选中对应分组。这是已知且
 * 接受的行为，本模块不做“排除本体分组文件不被 kb 工具索引”的特殊处理。
 *
 * 数据格式（人读 markdown，风格参照 personal_ontology_candidates.ts）：
 * - `groups.md`      —— 分组元数据台账（group_id / title / 相对路径 / 时间戳 /
 *                        可选模板行 `- 模板: <template_id>@<version>`）
 * - `<group_id>.md`  —— 每个分组自己的内容文件。阶段 B 起支持“双区格式”：
 *                        `## 字段区`（`### <字段名>` 小节 + `- <值> [<来源>]`
 *                        多值行，挖空表单的“坑”）+ `## 流水区`（`§` 分隔追加的
 *                        条目）。旧纯文本文件（无字段区标题）全文按流水区解析，
 *                        首次“写字段”时才升级为双区格式（内容无损）。
 *
 * 范围边界（本期不做，见需求交接文档决策 10/11）：不接入资料库任意文档的选择；
 * 不支持“把 USER.md/MEMORY.md 旧条目后补进组”；不记录“被哪些历史对话引用过”。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { userOntologyGroupsDir } from '../paths';
import { writeTextAtomicSync, safeId, nowIso, genId12 } from '../storage';
import { ENTRY_SEPARATOR } from './memory';
import { getRoleTemplate, type PresetGroup } from './role_templates';
import * as search from './search';
import * as kbIndexer from './kb_indexer';
import { createLogger } from '../logger';

const log = createLogger('personal-ontology-groups');

// Same defensive cap contexts.ts applies to every Library file (its
// MAX_FILE_BYTES isn't exported, so this is a local copy of the same value —
// per decision 5, groups get no separate char/entry limit, only this).
const MAX_FILE_BYTES = 200 * 1024 * 1024;

// ── 双区格式常量 ──────────────────────────────────────────────────────────

export const FIELD_ZONE_HEADER = '## 字段区';
export const FLOW_ZONE_HEADER = '## 流水区';

/** 字段值来源：候选（技能预判）/ 手动（用户填写）/ 导入 / 智能（LLM 路由）。
 *  解析缺省/非法值归一化为 `手动`。 */
export const FIELD_VALUE_SOURCES = ['候选', '手动', '导入', '智能'] as const;
export type FieldValueSource = (typeof FIELD_VALUE_SOURCES)[number];

export interface GroupMeta {
  group_id: string;
  title: string;
  /** Relative to `userContextsDir(uid)`, e.g. `.personal_ontology_groups/<id>.md`. */
  rel_path: string;
  created_at: string;
  updated_at: string;
  /** 可选：来源角色模板（模板文件服务写入，`- 模板:` 台账行）。 */
  template_id?: string;
  template_version?: string;
  /** 运行时附加（IPC 层填充，不落盘）：模板显示名（如「学生」），供渲染层做层级展示。 */
  template_name?: string;
}

export interface GroupResult {
  ok: boolean;
  group?: GroupMeta;
  error?: string;
}

export interface SimpleResult {
  ok: boolean;
  error?: string;
}

export interface GroupContentResult {
  ok: boolean;
  content?: string;
  error?: string;
}

/** 单条字段值：`- <值> [<来源>]`，可选来源项目标记 `@proj:<pid>`（二期 D5），
 *  可选信息截至时间标记 `@asof:<YYYY-MM>`（2026-09-19 本体增强：值正确时
 *  所属的年月，对应蓝图 R26 时间完整性——相对表述保留原词，超龄标
 *  needs-refresh，机器不自动判死），可选核实标记 `@verified`（2026-09-20
 *  断言核实维度：用户亲手验证过这条值，对应蓝图五维度的核实状态。
 *  单档手动——只由用户点，确认写入不自动带，无使用回执不自动升）。 */
export interface FieldValue {
  value: string;
  source: string;
  /** 可选：来源项目 id（落盘 `@proj:<pid>`，展示层映射项目名）。缺省 = 全局/手动。 */
  project?: string;
  /** 可选：信息截至年月（落盘 `@asof:YYYY-MM`）。缺省 = 未标注（不参与时效判断）。 */
  asOf?: string;
  /** 可选：用户已核实（落盘 `@verified` 裸标记=有来源支持；`@verified:independent`
   *  =独立核实过——spec 007 两档，存量裸标向后兼容）。缺省 = 未核实。 */
  verified?: boolean | 'independent';
  /** 可选：规则分类（spec 007 T301，关系值/规则用）：operation 操作规则 /
   *  preference 偏好 / constraint 约束。落盘 `@kind:<v>`。缺省 = 未分类。 */
  ruleKind?: 'operation' | 'preference' | 'constraint';
  /** 可选：敏感性（spec 007 T302）：restricted 的值不进任务注入与世界模型
   *  ontologyFacts（授权切片地基）。落盘 `@restricted`。缺省 = standard。 */
  sensitivity?: 'restricted';
}

/** `@asof:` 合法年月：1900-2099 年 + 01-12 月。写错的（如 2026-13）不认作
 *  asOf 也不落 project——它显然是想写时间，落 project 会把笔误当项目 id。 */
const ASOF_MARKER_RE = /^asof:((?:19|20)\d{2})-(0[1-9]|1[0-2])$/;

/** asof 超龄判定（月差 > 12 = 可能过时）。12 个月是提醒阈值不是判死：稳定的
 *  事实（出生年）到龄也只标不改，删除/刷新权在用户。 */
export const ASOF_STALE_MONTHS = 12;

/** 纯函数：某条 asOf（YYYY-MM）距今是否超龄。非法输入返回 false（无从判断
 *  就不制造噪音，与"无 asof 不标"同一原则）。 */
export function isStaleAsOf(asOf: string | undefined, now: Date = new Date()): boolean {
  if (typeof asOf !== 'string') return false;
  const match = asOf.match(/^((?:19|20)\d{2})-(0[1-9]|1[0-2])$/);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const monthsSince = (now.getFullYear() - year) * 12 + (now.getMonth() + 1 - month);
  return monthsSince > ASOF_STALE_MONTHS;
}

/* ── 时间锚三态（specs/014 T005 / US-901，B1① 的「分开表达」）──────────────
 * 表单语义：时间栏预填现有值；用户没动 = 保留（缺省）；清空 = 显式删除
 * （clearAsOf）；填了新值 = 设置（asOf）。区分靠表单 dirty 检测，不靠猜。
 * M11：只校验格式（1900-2099 + 01-12），过去的合法日期**不拒收**——超龄
 * 是标记不是判死（isStaleAsOf 同一哲学）。 */

export interface AsOfControl {
  asOf?: string;
  clearAsOf?: boolean;
}

export type AsOfControlResolution =
  | { ok: true; mode: 'keep' | 'set' | 'clear'; asOf?: string }
  | { ok: false; error: 'invalid asof' | 'conflicting asof params' };

/** 三态裁决唯一处：格式复用 `ASOF_MARKER_RE` 的语义（`asof:` 前缀形式），
 *  不新写第二份正则口径。同时给 asOf + clearAsOf → 报错。 */
export function resolveAsOfControl(control: AsOfControl): AsOfControlResolution {
  const hasSet = control.asOf !== undefined;
  const hasClear = control.clearAsOf === true;
  if (hasSet && hasClear) return { ok: false, error: 'conflicting asof params' };
  if (hasSet) {
    const candidate = String(control.asOf ?? '').trim();
    if (!candidate) return { ok: false, error: 'invalid asof' };
    if (!ASOF_MARKER_RE.test(`asof:${candidate}`)) return { ok: false, error: 'invalid asof' };
    return { ok: true, mode: 'set', asOf: candidate };
  }
  if (hasClear) return { ok: true, mode: 'clear' };
  return { ok: true, mode: 'keep' };
}

/** 组内容文件的结构化视图：字段区（多值）+ 流水区（条目数组）。 */
export interface GroupContent {
  fields: Record<string, FieldValue[]>;
  entries: string[];
}

function groupsMdPath(uid: string): string {
  return path.join(userOntologyGroupsDir(uid), 'groups.md');
}

function groupFileRelPathFromContextsRoot(groupId: string): string {
  return `.personal_ontology_groups/${groupId}.md`;
}

/**
 * 按台账 meta 解析内容文件绝对路径。普通组行 rel_path 恒等于
 * `<groupId>.md`（与 resolveGroupFileAbsPath 一致）；模板文件行
 * （阶段 D）rel_path 是真实文件名（如 `student.md`），与 groupId 无关，
 * 必须按 rel_path 解析——否则读到的是一块不存在的 `<groupId>.md`。
 */
function resolveGroupFileAbsPathFromMeta(uid: string, meta: GroupMeta): string {
  const rel = meta.rel_path || groupFileRelPathFromContextsRoot(meta.group_id);
  const prefix = '.personal_ontology_groups/';
  if (rel.startsWith(prefix) && !rel.includes('..')) {
    return path.join(userOntologyGroupsDir(uid), rel.slice(prefix.length));
  }
  return resolveGroupFileAbsPath(uid, meta.group_id);
}

/**
 * Resolve a group's content-file absolute path with the same traversal
 * safety `contexts.ts::resolvePathForRoot` applies, minus the hidden-path
 * rejection (this whole directory IS the hidden one, by design). `groupId`
 * is always internally generated (`genId12`) and re-validated with `safeId`
 * here as defense in depth — never taken as a free-form user path segment.
 */
function resolveGroupFileAbsPath(uid: string, groupId: string): string {
  if (!safeId(groupId)) throw new Error('invalid group id');
  const root = path.resolve(userOntologyGroupsDir(uid));
  const abs = path.resolve(root, `${groupId}.md`);
  const rel = path.relative(root, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('path escapes ontology groups root');
  return abs;
}

function readTextSafe(filePath: string): string {
  try { return fs.readFileSync(filePath, 'utf8'); }
  catch { return ''; }
}

// ── 双区格式 parse/serialize（纯函数，可导出供测试）────────────────────────

/** 把流水区文本按 ENTRY_SEPARATOR 切成条目数组（逐段 trim、滤空）。 */
export function splitFlowEntries(text: string): string[] {
  return String(text ?? '')
    .split(ENTRY_SEPARATOR)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 匹配 `- <值> [<来源>]`（可选多个 `@` 标记：`@proj:<pid>` 项目、
 *  `@asof:<YYYY-MM>` 信息截至时间，顺序不限）；值内的 `\\[` 转义在此还原为 `[`。
 *  无 `[来源]` 后缀的裸值行也解析（来源默认 `手动`，任务书 §2.1）。
 *  `@proj:` 前缀剥离存 pid；`asof:` 前缀合法年月存 asOf、写错忽略（笔误的
 *  时间不该落进 project 冒充项目 id）；其他形态宽容保留原样（原行为）。 */
export function parseFieldValueLine(line: string): { value: string; source: string; project?: string; asOf?: string; verified?: boolean | 'independent'; ruleKind?: 'operation' | 'preference' | 'constraint'; sensitivity?: 'restricted' } | null {
  if (typeof line !== 'string') return null;
  const withSource = line.match(/^- (.+) \[(\S+)\]((?: @\S+)*)$/);
  if (withSource) {
    const out: { value: string; source: string; project?: string; asOf?: string; verified?: boolean | 'independent'; ruleKind?: 'operation' | 'preference' | 'constraint'; sensitivity?: 'restricted' } = {
      value: withSource[1].replace(/\\\[/g, '['),
      source: withSource[2],
    };
    const markers = withSource[3].match(/@(\S+)/g) || [];
    for (const raw of markers) {
      const marker = raw.slice(1);
      if (marker === 'verified') {
        out.verified = true; // 裸标记=有来源支持（存量兼容）；先于前缀判断，防掉进 project
      } else if (marker === 'verified:independent') {
        out.verified = 'independent'; // 独立核实过（两档中更强的一档）
      } else if (marker.startsWith('proj:')) {
        out.project = marker.slice('proj:'.length);
      } else if (marker.startsWith('asof:')) {
        if (ASOF_MARKER_RE.test(marker)) out.asOf = marker.slice('asof:'.length);
      } else if (marker === 'kind:operation' || marker === 'kind:preference' || marker === 'kind:constraint') {
        out.ruleKind = marker.slice('kind:'.length) as 'operation' | 'preference' | 'constraint';
      } else if (marker === 'restricted') {
        out.sensitivity = 'restricted';
      } else {
        out.project = marker;
      }
    }
    return out;
  }
  const bare = line.match(/^- (.+)$/);
  if (!bare) return null;
  return { value: bare[1].replace(/\\\[/g, '['), source: '手动' };
}

/** 序列化单条值行：值内 `[` 转义为 `\\[`，避免与来源标记冲突；带项目/截至
 *  时间/核实则依次追加 `@proj:<pid>`、`@asof:<YYYY-MM>`、`@verified`。 */
export function serializeFieldValueLine(fv: FieldValue): string {
  const base = `- ${String(fv.value).replace(/\[/g, '\\[')} [${fv.source}]`;
  const withProject = fv.project ? `${base} @proj:${fv.project}` : base;
  const withAsOf = fv.asOf ? `${withProject} @asof:${fv.asOf}` : withProject;
  let withVerified = withAsOf;
  if (fv.verified === 'independent') withVerified = `${withVerified} @verified:independent`;
  else if (fv.verified) withVerified = `${withVerified} @verified`;
  if (fv.ruleKind) withVerified = `${withVerified} @kind:${fv.ruleKind}`;
  if (fv.sensitivity === 'restricted') withVerified = `${withVerified} @restricted`;
  return withVerified;
}

/** 解析字段区文本（`## 字段区` 与 `## 流水区` 之间的部分）为字段表。 */
function parseFieldSections(zoneText: string, fields: Record<string, FieldValue[]>): void {
  const blocks = zoneText.split(/\n(?=###\s+\S)/);
  for (const block of blocks) {
    const lines = block.split('\n');
    const header = lines[0].match(/^###\s+(.+)$/);
    if (!header) continue;
    const fieldName = header[1].trim();
    if (!fieldName) continue;
    const values: FieldValue[] = [];
    for (let i = 1; i < lines.length; i++) {
      const parsed = parseFieldValueLine(lines[i]);
      if (parsed) values.push(parsed);
    }
    if (values.length) fields[fieldName] = values;
  }
}

/**
 * 解析组内容文件。无 `## 字段区` 标题 = 旧纯文本格式，全文按流水区解析
 * （fields 为空，entries 原样）。有双区标题则按字段区/流水区分区解析。
 */
export function parseGroupContent(text: string): GroupContent {
  const fields: Record<string, FieldValue[]> = {};
  const entries: string[] = [];
  const raw = String(text ?? '');

  const fieldIdx = raw.indexOf(FIELD_ZONE_HEADER);
  const flowIdx = raw.indexOf(FLOW_ZONE_HEADER);

  if (fieldIdx === -1) {
    // 旧格式：全文都是流水区
    entries.push(...splitFlowEntries(raw));
    return { fields, entries };
  }

  // 字段区：字段标题行之后到流水区标题（或文件尾）之间
  const fieldZoneStart = fieldIdx + FIELD_ZONE_HEADER.length;
  const fieldZoneEnd = flowIdx === -1 ? raw.length : flowIdx;
  parseFieldSections(raw.slice(fieldZoneStart, fieldZoneEnd), fields);

  // 流水区：流水标题行之后
  if (flowIdx !== -1) {
    entries.push(...splitFlowEntries(raw.slice(flowIdx + FLOW_ZONE_HEADER.length)));
  }
  return { fields, entries };
}

/**
 * 序列化组内容。有字段 → 输出双区格式（`## 字段区` + 字段块 + `---` +
 * `## 流水区` + 条目）；无字段 → 只输出流水条目（纯文本，保持旧行为等价）。
 */
export function serializeGroupContent(content: GroupContent): string {
  const fields = (content && content.fields) || {};
  const entries = (content && content.entries) || [];
  const fieldNames = Object.keys(fields);
  if (!fieldNames.length) {
    return entries.join(ENTRY_SEPARATOR);
  }

  const blocks = fieldNames.map((name) => {
    const lines = [`### ${name}`];
    for (const fv of fields[name] || []) {
      lines.push(serializeFieldValueLine(fv));
    }
    return lines.join('\n');
  });

  const parts: string[] = [FIELD_ZONE_HEADER, '', blocks.join('\n\n')];
  parts.push('', '---', '', FLOW_ZONE_HEADER);
  if (entries.length) parts.push('', entries.join(ENTRY_SEPARATOR));
  return parts.join('\n');
}

function normalizeSource(source: unknown): string {
  const v = String(source ?? '').trim();
  return (FIELD_VALUE_SOURCES as readonly string[]).includes(v) ? v : '手动';
}

export { normalizeSource };

// ── groups.md parse/serialize (人读 markdown 台账，风格同 candidates.md) ──

const GROUP_FIELD_LABELS: Record<string, string> = {
  '标题': 'title',
  '文件': 'rel_path',
  '创建时间': 'created_at',
  '更新时间': 'updated_at',
  '模板': 'template_ref',
};

/** 模板行合法格式：`<template_id>@<semver>`（id 只允许小写字母数字连字符下划线；
 *  版本支持标准 semver 预发布后缀，如 `1.1.0` / `0.2.0-review.1`）。 */
const TEMPLATE_REF_RE = /^([a-z0-9_-]+)@(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/;

/**
 * 这个版本串写进台账 `- 模板:` 行之后还能被读回来吗？
 *
 * 写入前必须过这一关：非法版本会让整行匹配不上 TEMPLATE_REF_RE，
 * 于是该行**整体失效**——group_id 与文件都还在，但它不再被当作模板行，
 * 模板静默退化成一个普通本体分组。判据从同一个正则派生，不另立一份。
 */
export function isValidTemplateVersion(version: string): boolean {
  return TEMPLATE_REF_RE.test(`x@${String(version ?? '')}`);
}

export function parseGroupsMarkdown(text: string): GroupMeta[] {
  const blocks = text.split(/\n(?=###\s+\S)/).map((b) => b.trim()).filter((b) => b.startsWith('### '));
  const out: GroupMeta[] = [];
  for (const block of blocks) {
    const lines = block.split('\n');
    const header = lines[0].match(/^###\s+(\S+)/);
    if (!header) continue;
    const raw: Record<string, string> = {};
    for (let i = 1; i < lines.length; i++) {
      const m = lines[i].match(/^-\s*([^:：]+)[:：]\s*(.*)$/);
      if (!m) continue;
      const field = GROUP_FIELD_LABELS[m[1].trim()];
      if (field) raw[field] = m[2].trim();
    }
    const groupId = header[1];
    if (!groupId) continue;
    const meta: GroupMeta = {
      group_id: groupId,
      title: raw.title || '',
      rel_path: raw.rel_path || groupFileRelPathFromContextsRoot(groupId),
      created_at: raw.created_at || '',
      updated_at: raw.updated_at || raw.created_at || '',
    };
    // 可选模板行：非法值按无模板处理并 log.warn（任务书 §2.2）
    if (raw.template_ref) {
      const tm = raw.template_ref.match(TEMPLATE_REF_RE);
      if (tm) {
        meta.template_id = tm[1];
        meta.template_version = tm[2];
      } else {
        log.warn('invalid template_ref in groups.md ignored', { uid: '', groupId, template_ref: raw.template_ref });
      }
    }
    out.push(meta);
  }
  return out;
}

export function serializeGroupsMarkdown(groups: GroupMeta[]): string {
  const header = `# 记忆分组\n\n> 最后更新: ${nowIso()} | 共 ${groups.length} 个分组\n`;
  if (!groups.length) return `${header}\n暂无分组。\n`;
  const blocks = groups.map((g) => {
    const lines = [`### ${g.group_id}`];
    lines.push(`- 标题: ${g.title}`);
    lines.push(`- 文件: ${g.rel_path}`);
    lines.push(`- 创建时间: ${g.created_at}`);
    lines.push(`- 更新时间: ${g.updated_at}`);
    if (g.template_id && g.template_version) {
      lines.push(`- 模板: ${g.template_id}@${g.template_version}`);
    }
    return lines.join('\n');
  });
  return `${header}\n${blocks.join('\n\n')}\n`;
}

function readGroups(uid: string): GroupMeta[] {
  return parseGroupsMarkdown(readTextSafe(groupsMdPath(uid)));
}

export { readGroups };

function writeGroups(uid: string, groups: GroupMeta[]): void {
  writeTextAtomicSync(groupsMdPath(uid), serializeGroupsMarkdown(groups));
}

export { writeGroups };

// ── kb-index side effects (mirrors contexts.ts's mutation → reindex hooks;
//    see the file header's decision-6 note for why this is intentional) ──

function notifyGroupUpserted(uid: string, relPath: string): void {
  try {
    search.upsertContext(uid, relPath);
    kbIndexer.enqueue(uid, relPath, 'upsert');
  } catch (err) {
    log.warn('kb reindex hook failed on group upsert', { error: (err as Error).message });
  }
}

function notifyGroupDeleted(uid: string, relPath: string): void {
  try {
    search.dropContext(uid, relPath);
    kbIndexer.enqueue(uid, relPath, 'delete');
  } catch (err) {
    log.warn('kb reindex hook failed on group delete', { error: (err as Error).message });
  }
}

export { notifyGroupUpserted, notifyGroupDeleted };

// ── 共享的“读改写”骨架：字段/流水操作统一走 parse → mutate → serialize → 原子写 ──

/** mutator 除变更语义外，可带回本次操作的 before/after 摘要（D12 台账用；
 *  摘要须已脱敏——受限值用 summarizeFieldValue。可选字段，既有 mutator 零破坏。 */
type Mutator = (content: GroupContent) => {
  changed?: boolean;
  ok?: boolean;
  error?: string;
  beforeSummary?: string;
  afterSummary?: string;
};

const HISTORY_DIR = '.history';
const HISTORY_MAX_PER_GROUP = 50;

function groupHistoryDir(uid: string, groupId: string): string {
  return path.join(userOntologyGroupsDir(uid), HISTORY_DIR, groupId);
}

export function snapshotGroupHistory(uid: string, groupId: string, text: string): void {
  try {
    if (!text.trim()) return; // 首次创建（原文为空）不留快照
    const dir = groupHistoryDir(uid, groupId);
    fs.mkdirSync(dir, { recursive: true });
    // C-008（spec 009 T005）：ISO 只到毫秒，同毫秒两次写入会落进同一个文件
    // 互相覆盖，静默丢一版快照。补定宽序号后缀 `-NN`：同毫秒递增、两位零
    // 填充——00~99 定宽保证「文件名字典序 = 写入时间序」（滚动淘汰按字典
    // 序删最旧因此依然正确）；同一毫秒超过 100 版时按自然位数继续增长
    // （-100、-101…），优先不丢数据。旧代码写的纯 ISO 文件名不迁移、继续
    // 可读（listGroupHistory 反解只看前 24 字符，见 T007）。
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    let seq = 0;
    let fileName = `${stamp}-${String(seq).padStart(2, '0')}.md`;
    while (fs.existsSync(path.join(dir, fileName))) {
      seq += 1;
      fileName = `${stamp}-${String(seq).padStart(2, '0')}.md`;
    }
    fs.writeFileSync(path.join(dir, fileName), text, 'utf8');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort();
    while (files.length > HISTORY_MAX_PER_GROUP) {
      fs.rmSync(path.join(dir, files.shift() as string));
    }
  } catch {
    // 历史快照失败不阻塞写入（尽力而为的审计层）。
  }
}

/** 组变更历史（新→旧）：[{ id, savedAt, bytes, preview, audit? }]。
 *  audit（spec 009 D12）是可选附加字段：这版快照对应那次写动作的台账摘要，
 *  取不到（无台账 / 时间配不上）就不带该键——旧消费方零破坏。 */
export interface GroupHistoryEntry {
  id: string;
  savedAt: string;
  bytes: number;
  preview: string;
  audit?: { action: string; field?: string; beforeSummary?: string; afterSummary?: string; at: string };
}

export function listGroupHistory(uid: string, groupId: string): GroupHistoryEntry[] {
  if (!safeId(uid) || !safeId(groupId)) return [];
  try {
    const dir = groupHistoryDir(uid, groupId);
    // 台账配对（D12）：快照是「写前留档」、台账行在写成功后追加，两者出自
    // 同一次写函数的前后脚（同毫秒或相邻毫秒），按 |Δt| 最小配对；同一组
    // 连续两次写操作的间隔（一次完整写盘）必然大于函数内快照→台账的间隔，
    // 所以最近邻配对稳定。配不上（阈值 2s）就不带 audit 字段。
    const auditPoints = readGroupAudit(uid, groupId)
      .map((line) => ({ line, ms: Date.parse(line.at) }))
      .filter((p) => !Number.isNaN(p.ms));
    return fs.readdirSync(dir)
      .filter((f) => f.endsWith('.md'))
      .sort()
      .reverse()
      .map((f) => {
        const text = fs.readFileSync(path.join(dir, f), 'utf8');
        // T007：只取文件名前 24 字符（= 定长 ISO 时间戳）反解，同毫秒序号
        // 后缀（-NN）与旧纯 ISO 文件名都不参与；还原按位置：4/7 是日期
        // 分隔，13/16 是时:分与分:秒的冒号，19 是毫秒点。此前 13↔19 写反，
        // 还原出 `T12.34:56:789Z` 这类无效时间，前端 new Date() 得 NaN。
        const savedAt = f.slice(0, 24).replace(/-/g, (m, i) => (i === 4 || i === 7 ? '-' : i === 13 || i === 16 ? ':' : i === 19 ? '.' : m));
        let audit: GroupHistoryEntry['audit'];
        const savedMs = Date.parse(savedAt);
        if (!Number.isNaN(savedMs)) {
          let best: GroupHistoryEntry['audit'] | undefined;
          let bestAbs = Number.POSITIVE_INFINITY;
          for (const p of auditPoints) {
            const abs = Math.abs(p.ms - savedMs);
            if (abs < bestAbs) {
              bestAbs = abs;
              best = {
                action: p.line.action,
                field: p.line.field,
                beforeSummary: p.line.beforeSummary,
                afterSummary: p.line.afterSummary,
                at: p.line.at,
              };
            }
          }
          if (best && bestAbs <= 2000) audit = best;
        }
        return {
          id: f.slice(0, -3),
          savedAt,
          bytes: Buffer.byteLength(text, 'utf8'),
          preview: text.replace(/\s+/g, ' ').slice(0, 80),
          ...(audit ? { audit } : {}),
        };
      });
  } catch {
    return [];
  }
}

// ── 已删除分组（spec 009 D5b / T025，待总控确认第 7 条·选项②）─────────────
//
// deleteGroup 只删 groups.md 行 + 内容文件，.history/<groupId>/ 目录（快照与
// 台账）刻意保留——这就是「已删除分组」的数据来源：历史目录还在、台账行已
// 没有的组。恢复复用 restoreGroupSnapshot 的「meta 缺失」分支（见其注释）。

/** D5b：「已删除分组」列表项（contracts/ipc.md §2）。 */
export interface DeletedGroupSummary {
  groupId: string;
  /** 最新一版快照的首个 `# 标题`；取不到 = 目录名（= groupId）。audit.jsonl 不是快照、不参与派生。 */
  title: string;
  /** 最新一版快照的 savedAt（近似删除时刻；正式删除时刻在台账 group_delete 行里）。 */
  deletedAt: string;
  /** 快照版数（只数 .md；台账文件不计入）。 */
  snapshotCount: number;
}

/** 从快照正文派生组标题：首个一级标题 `# xxx` 的文本；没有（普通组正文只有
 *  `## 字段区`/`## 流水区`，无一级标题）→ fallback。`## ` 不会误匹配
 *  （`^#\s` 只吃一个井号）。 */
function titleFromSnapshotText(text: string, fallback: string): string {
  const match = String(text ?? '').match(/^#[ \t]+(\S.*)$/m);
  const title = match ? match[1].trim() : '';
  return title || fallback;
}

/**
 * 「已删除分组」列表：.history/ 子目录名里、groups.md 台账已没有对应行的组。
 * 只列还有 `.md` 快照可恢复的（只剩 audit.jsonl 的目录无从恢复，不列）；
 * 仍在台账里的组是活组，也不列。无 .history 目录 / uid 非法 → 空数组，
 * 绝不 throw（contracts/ipc.md §2 失败分支①：`{ ok:true, deleted: [] }`）。
 */
export function listDeletedGroups(uid: string): DeletedGroupSummary[] {
  if (!safeId(uid)) return [];
  try {
    const root = path.join(userOntologyGroupsDir(uid), HISTORY_DIR);
    if (!fs.existsSync(root)) return [];
    const liveIds = new Set(readGroups(uid).map((g) => g.group_id));
    const out: DeletedGroupSummary[] = [];
    for (const name of fs.readdirSync(root)) {
      // groupId 一律经 safeId：目录名可能被外部写入，未过校验的名字不进
      // 列表（恢复入口也不接受它——restoreGroupSnapshot 入口同一道闸）。
      if (!safeId(name)) continue;
      if (liveIds.has(name)) continue;
      const history = listGroupHistory(uid, name);
      if (!history.length) continue;
      const newest = history[0];
      const newestText = fs.readFileSync(path.join(groupHistoryDir(uid, name), `${newest.id}.md`), 'utf8');
      out.push({
        groupId: name,
        title: titleFromSnapshotText(newestText, name),
        deletedAt: newest.savedAt,
        snapshotCount: history.length,
      });
    }
    // 最近删除的排前面（deletedAt 新 → 旧）；同刻按 groupId 稳定排序。
    out.sort((a, b) => (a.deletedAt < b.deletedAt ? 1 : a.deletedAt > b.deletedAt ? -1 : a.groupId.localeCompare(b.groupId)));
    return out;
  } catch {
    return [];
  }
}

/** 恢复某版快照：当前文本先快照（可再回滚回来），再写回快照内容。
 *  meta 缺失 = 已删除组（D5b）→ 重建 meta 后写回，组回到台账列表。 */
export async function restoreGroupSnapshot(uid: string, groupId: string, snapshotId: string): Promise<SimpleResult> {
  if (!safeId(uid) || !safeId(groupId)) return { ok: false, error: 'invalid uid or groupId' };
  // T007：形状放宽到契约形态 `^[0-9TZ-]{20,}(?:-\d{2})?$`（contracts/ipc.md
  // §3）——旧纯 ISO 名（24 字符）与同毫秒序号新名（…-NN）都放行；字符集
  // [0-9TZ-] 天然排除 `/` `\` `.` 空格与任何路径分隔符：**形状放宽、路径
  // 穿越不放宽**。
  if (!/^[0-9TZ-]{20,}(?:-\d{2})?$/.test(snapshotId)) return { ok: false, error: 'invalid snapshot id' };
  const snapPath = path.join(groupHistoryDir(uid, groupId), `${snapshotId}.md`);
  if (!fs.existsSync(snapPath)) return { ok: false, error: 'snapshot not found' };
  return mutateGroupContent(uid, groupId, () => ({ changed: false })) // 走常规校验取 abs
    .then(async () => {
      const groups = readGroups(uid);
      const meta = groups.find((g) => g.group_id === groupId);
      if (!meta) {
        // D5b（spec 009 T025）：meta 缺失 = 已删除组（.history/<groupId>/ 快照
        // 还在、groups.md 行已删）——不再直接失败，而是重建 meta（group_id
        // 沿用历史目录名、title 取快照首个 `# 标题`、rel_path 走既有规则）
        // → 写回快照内容 → 组回到台账列表。成功语义不变（仍是 { ok:true }）。
        const snapText = fs.readFileSync(snapPath, 'utf8');
        const abs = resolveGroupFileAbsPath(uid, groupId); // safeId + 防穿越（防御纵深）
        // 同名冲突（唯一新增错误码，contracts/ipc.md §2 失败分支③）：磁盘上
        // 同名 group_id 的内容文件还在（删除时 rm 失败 / 导入留下的孤儿文件）
        // ——它的内容不在任何快照里，恢复路径直接覆盖它等于无声数据损失，
        // 拒绝并把决定权交回用户（先处理那个文件，再恢复）。
        if (fs.existsSync(abs)) return { ok: false, error: 'group already exists' };
        const now = nowIso();
        const rebuilt: GroupMeta = {
          group_id: groupId,
          title: titleFromSnapshotText(snapText, groupId),
          rel_path: groupFileRelPathFromContextsRoot(groupId),
          created_at: now,
          updated_at: now,
        };
        try {
          fs.mkdirSync(path.dirname(abs), { recursive: true });
          writeTextAtomicSync(abs, snapText);
        } catch (err) {
          return { ok: false, error: (err as Error).message };
        }
        groups.push(rebuilt);
        writeGroups(uid, groups);
        notifyGroupUpserted(uid, rebuilt.rel_path);
        // D12：恢复动作记台账（reason = 恢复到哪版快照；零正文，同既有分支）。
        appendOntologyAudit(uid, groupId, 'snapshot_restore', { reason: snapshotId });
        return { ok: true };
      }
      const abs = resolveGroupFileAbsPathFromMeta(uid, meta);
      snapshotGroupHistory(uid, groupId, readTextSafe(abs)); // 当前版留档
      writeTextAtomicSync(abs, fs.readFileSync(snapPath, 'utf8'));
      groups[idxOf(groups, groupId)] = { ...groups[idxOf(groups, groupId)], updated_at: nowIso() };
      writeGroups(uid, groups);
      notifyGroupUpserted(uid, meta.rel_path);
      // 摘要台账（D12）：恢复动作的「依据」= 恢复到哪版快照。刻意不带正文
      // 摘要——快照内容可能含受限值，台账行零正文即零泄漏面。
      appendOntologyAudit(uid, groupId, 'snapshot_restore', { reason: snapshotId });
      return { ok: true };
    });
}

function idxOf(groups: GroupMeta[], groupId: string): number {
  return groups.findIndex((g) => g.group_id === groupId);
}

// ── 摘要台账（spec 009 D12 / SC-005）：.history/<groupId>/audit.jsonl ──────
//
// 追加式 JSONL，一行 = 一次成功写操作（changed:false / 失败分支不写，I-5）。
// 只存摘要（≤200 字）：正文永远只活在组内容文件与快照里。受限值
// （sensitivity === 'restricted'）只记 `[受限]` + 长度——脱敏由调用方在传入
// 前完成（summarizeFieldValue），本 helper 只负责截断（I-6）。写入尽力而为
// （try/catch 不阻塞主写路径，I-7）；快照滚动淘汰只数 .md，本文件不会被删。
// 不开放写 IPC（前端不可篡改）；读取仅作为 history.list 的可选附加字段。

const AUDIT_FILE_NAME = 'audit.jsonl';
const AUDIT_SUMMARY_MAX_CHARS = 200;

export interface OntologyAuditLine {
  at: string;
  actor: 'user';
  action: string;
  groupId: string;
  field?: string;
  beforeSummary?: string;
  afterSummary?: string;
  reason?: string;
}

export interface OntologyAuditOpts {
  field?: string;
  beforeSummary?: string;
  afterSummary?: string;
  reason?: string;
}

/** 受限值摘要：只记 `[受限]` + 长度，正文绝不进台账（I-6）。 */
function summarizeFieldValue(fv: FieldValue): string {
  return fv.sensitivity === 'restricted' ? `[受限] ${fv.value.length}` : fv.value;
}

/** 追加一行摘要台账（尽力而为：任何失败都被吞，绝不阻塞主写路径）。
 *  action 枚举（spec 009）：value_edit / value_remove / field_remove /
 *  value_add / entry_promote / group_rename / group_delete / snapshot_restore。 */
export function appendOntologyAudit(uid: string, groupId: string, action: string, opts?: OntologyAuditOpts): void {
  try {
    if (!safeId(uid) || !safeId(groupId)) return;
    const clip = (s?: string): string | undefined =>
      typeof s === 'string' ? s.slice(0, AUDIT_SUMMARY_MAX_CHARS) : undefined;
    const line: OntologyAuditLine = { at: new Date().toISOString(), actor: 'user', action, groupId };
    if (opts?.field) line.field = opts.field;
    const before = clip(opts?.beforeSummary);
    if (before !== undefined) line.beforeSummary = before;
    const after = clip(opts?.afterSummary);
    if (after !== undefined) line.afterSummary = after;
    const reason = clip(opts?.reason);
    if (reason !== undefined && reason !== '') line.reason = reason;
    const dir = groupHistoryDir(uid, groupId);
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, AUDIT_FILE_NAME), `${JSON.stringify(line)}\n`, 'utf8');
  } catch {
    // 台账尽力而为：失败不阻塞主写路径（与快照层同款）。
  }
}

/** 读取某组的台账行（无文件 / 坏行 / 任何失败 → 空数组，绝不 throw）。 */
export function readGroupAudit(uid: string, groupId: string): OntologyAuditLine[] {
  try {
    if (!safeId(uid) || !safeId(groupId)) return [];
    const text = readTextSafe(path.join(groupHistoryDir(uid, groupId), AUDIT_FILE_NAME));
    const out: OntologyAuditLine[] = [];
    for (const rawLine of text.split('\n')) {
      const line = rawLine.trim();
      if (!line) continue;
      try {
        const parsed = JSON.parse(line) as OntologyAuditLine;
        if (parsed && typeof parsed === 'object' && typeof parsed.action === 'string') out.push(parsed);
      } catch { /* 坏行跳过，不毁整个读取 */ }
    }
    return out;
  } catch {
    return [];
  }
}

async function mutateGroupContent(
  uid: string,
  groupId: string,
  mutator: Mutator,
  /** 传了 action 的调用方在实际写入成功后记一行摘要台账（D12）；不传
   *  （如 restoreGroupSnapshot 只借道校验）就不记。可选参数，既有调用方零破坏。 */
  audit?: { action: string; field?: string; reason?: string },
): Promise<SimpleResult> {
  if (!safeId(uid)) return { ok: false, error: 'invalid uid' };
  const groups = readGroups(uid);
  const idx = groups.findIndex((g) => g.group_id === groupId);
  if (idx === -1) return { ok: false, error: 'group not found' };

  let abs: string;
  try { abs = resolveGroupFileAbsPathFromMeta(uid, groups[idx]); }
  catch (err) { return { ok: false, error: (err as Error).message }; }

  const previousText = readTextSafe(abs);
  const content = parseGroupContent(previousText);
  const outcome = mutator(content);
  if (outcome.error || outcome.ok === false) return { ok: false, error: outcome.error || 'failed' };

  const next = serializeGroupContent(content);
  const bytes = Buffer.byteLength(next, 'utf8');
  if (bytes > MAX_FILE_BYTES) {
    return { ok: false, error: `file exceeds ${Math.round(MAX_FILE_BYTES / 1024 / 1024)}MB limit` };
  }

  if (next !== previousText) {
    // 变更历史（spec 007 T304，蓝图「变更集可回滚」）：覆盖前把原文快照进
    // .history/<groupId>/，上限滚动删最旧；恢复走 restoreGroupSnapshot。
    snapshotGroupHistory(uid, groupId, previousText);
  }

  try {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    writeTextAtomicSync(abs, next);
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }

  groups[idx] = { ...groups[idx], updated_at: nowIso() };
  writeGroups(uid, groups);
  if (audit && next !== previousText) {
    // 摘要台账（spec 009 D12）：只在「真的写入了」时记一行——changed:false
    // （无变化 / 幂等 no-op）与失败分支都不写（I-5）；尽力而为不阻塞返回。
    appendOntologyAudit(uid, groupId, audit.action, {
      field: audit.field,
      beforeSummary: outcome.beforeSummary,
      afterSummary: outcome.afterSummary,
      reason: audit.reason,
    });
  }
  notifyGroupUpserted(uid, groups[idx].rel_path);
  return { ok: true };
}

// ── Public API ──────────────────────────────────────────────────────────

export async function listGroups(uid: string): Promise<GroupMeta[]> {
  if (!safeId(uid)) throw new Error('invalid uid');
  return readGroups(uid);
}

export async function createGroup(uid: string, title: string): Promise<GroupResult> {
  if (!safeId(uid)) return { ok: false, error: 'invalid uid' };
  const trimmedTitle = String(title || '').trim();
  if (!trimmedTitle) return { ok: false, error: 'title required' };

  const groups = readGroups(uid);
  const groupId = genId12();
  const relPath = groupFileRelPathFromContextsRoot(groupId);
  const now = nowIso();
  const meta: GroupMeta = { group_id: groupId, title: trimmedTitle, rel_path: relPath, created_at: now, updated_at: now };

  let abs: string;
  try { abs = resolveGroupFileAbsPath(uid, groupId); }
  catch (err) { return { ok: false, error: (err as Error).message }; }

  try {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    writeTextAtomicSync(abs, '');
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }

  groups.push(meta);
  writeGroups(uid, groups);
  log.info('ontology group created', { uid, groupId });
  return { ok: true, group: meta };
}

/**
 * 普通分组改名。**拒绝模板行**：模板的显示名归 T-box（改名要改模板定义，
 * 不是改台账），台账 title 只是安装时的拷贝——从这里改会让 groups.md 的
 * title 与模板目录的 name 分叉，产生第三套显示名事实来源。
 */
export async function renameGroup(uid: string, groupId: string, newTitle: string): Promise<SimpleResult> {
  if (!safeId(uid)) return { ok: false, error: 'invalid uid' };
  const trimmedTitle = String(newTitle || '').trim();
  if (!trimmedTitle) return { ok: false, error: 'title required' };

  const groups = readGroups(uid);
  const idx = groups.findIndex((g) => g.group_id === groupId);
  if (idx === -1) return { ok: false, error: 'group not found' };
  if (groups[idx].template_id) return { ok: false, error: 'role_template_group' };

  const oldTitle = groups[idx].title;
  groups[idx] = { ...groups[idx], title: trimmedTitle, updated_at: nowIso() };
  writeGroups(uid, groups);
  // D12：group_rename 记前后标题（标题不是字段值，无敏感性维度）。
  appendOntologyAudit(uid, groupId, 'group_rename', { beforeSummary: oldTitle, afterSummary: trimmedTitle });
  return { ok: true };
}

/**
 * 普通分组删除。**拒绝模板行**：模板的下架路径是
 * personal_ontology_template_files.ts::uninstallTemplateFile —— 它要归档模板
 * 文件、按 role_template 标签归档/清理 USER.md 与 MEMORY.md 里的全局记忆。
 * 从这里删只会 fs.rm 掉文件、不归档、不清理记忆，是不可逆的数据损失。
 */
export async function deleteGroup(uid: string, groupId: string): Promise<SimpleResult> {
  if (!safeId(uid)) return { ok: false, error: 'invalid uid' };
  const groups = readGroups(uid);
  const idx = groups.findIndex((g) => g.group_id === groupId);
  if (idx === -1) return { ok: false, error: 'group not found' };
  if (groups[idx].template_id) return { ok: false, error: 'role_template_group' };

  const [removed] = groups.splice(idx, 1);
  writeGroups(uid, groups);
  try {
    const abs = resolveGroupFileAbsPathFromMeta(uid, removed);
    // 删前留档（spec 009 T021）：从未产生过快照的组（刚建/只整体覆写过）
    // .history 为空，不先拍下最后一版就 rm，误删后无从恢复。必须在
    // rmSync **之前**（内容为空时 snapshotGroupHistory 自己跳过，语义不变）。
    snapshotGroupHistory(uid, groupId, readTextSafe(abs));
    fs.rmSync(abs, { force: true });
  } catch (err) {
    log.warn('failed to remove group content file', { uid, groupId, error: (err as Error).message });
  }
  notifyGroupDeleted(uid, removed.rel_path);
  // D12：group_delete 记被删组的标题（.history/<groupId>/ 目录保留，台账仍可查）。
  appendOntologyAudit(uid, groupId, 'group_delete', { beforeSummary: removed.title });
  log.info('ontology group deleted', { uid, groupId });
  return { ok: true };
}

export async function readGroupContent(uid: string, groupId: string): Promise<GroupContentResult> {
  if (!safeId(uid)) return { ok: false, error: 'invalid uid' };
  const groups = readGroups(uid);
  const meta = groups.find((g) => g.group_id === groupId);
  if (!meta) return { ok: false, error: 'group not found' };

  let abs: string;
  try { abs = resolveGroupFileAbsPathFromMeta(uid, meta); }
  catch (err) { return { ok: false, error: (err as Error).message }; }

  return { ok: true, content: readTextSafe(abs) };
}

/** Whole-file overwrite — used by the group management editor. */
export async function writeGroupContent(uid: string, groupId: string, content: string): Promise<SimpleResult> {
  if (!safeId(uid)) return { ok: false, error: 'invalid uid' };
  const groups = readGroups(uid);
  const idx = groups.findIndex((g) => g.group_id === groupId);
  if (idx === -1) return { ok: false, error: 'group not found' };

  const body = typeof content === 'string' ? content : '';
  const bytes = Buffer.byteLength(body, 'utf8');
  if (bytes > MAX_FILE_BYTES) {
    return { ok: false, error: `file exceeds ${Math.round(MAX_FILE_BYTES / 1024 / 1024)}MB limit` };
  }

  let abs: string;
  try { abs = resolveGroupFileAbsPathFromMeta(uid, groups[idx]); }
  catch (err) { return { ok: false, error: (err as Error).message }; }

  try {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    writeTextAtomicSync(abs, body);
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }

  groups[idx] = { ...groups[idx], updated_at: nowIso() };
  writeGroups(uid, groups);
  notifyGroupUpserted(uid, groups[idx].rel_path);
  return { ok: true };
}

/**
 * Append one entry to a group's content file — used by candidate confirmation
 * (see personal_ontology_candidates.ts). Format mirrors `memory.ts::addEntry`'s
 * `§`-separator convention, but this is NOT char-limited: only the same
 * defensive `MAX_FILE_BYTES` cap every Library file gets (decision 5).
 *
 * 阶段 B 起走 parse → push → serialize：旧纯文本文件保持行为等价（纯文本追加，
 * 由既有测试锁定）；已是双区格式的文件在流水区追加，字段区原样保留。
 */
export async function appendToGroup(uid: string, groupId: string, text: string): Promise<SimpleResult> {
  if (!safeId(uid)) return { ok: false, error: 'invalid uid' };
  const trimmed = String(text || '').trim();
  if (!trimmed) return { ok: false, error: 'empty content' };

  return mutateGroupContent(uid, groupId, (content) => {
    content.entries.push(trimmed);
    return { changed: true };
  });
}

/**
 * 字段区：往 `### <fieldName>` 小节追加一条 `- <值> [<来源>]`（可选 `@proj:<pid>`）。
 * 完全匹配（同值同源同项目）去重跳过；多值追加不覆盖。字段小节不存在则创建；
 * 首次写字段会把旧纯文本文件升级为双区格式（内容无损）。
 */
export async function appendFieldValue(
  uid: string,
  groupId: string,
  fieldName: string,
  value: string,
  source: string,
  project?: string,
  /** 信息截至年月（YYYY-MM，落 `@asof:`）。候选确认等智能写入自动带当前月
   *  ——蓝图 R26：确认时刻认为正确，就该有时间锚。用户手写不带，不强制。 */
  asOf?: string,
  /** 时间锚三态（specs/014 T005 / US-901）：`asOf` 设置、`clearAsOf` 显式清除、
   *  都缺省 = 不改动。与上面的位置参数互斥语义由 `resolveAsOfControl` 收口。 */
  asOfControl?: AsOfControl,
): Promise<SimpleResult> {
  if (!safeId(uid)) return { ok: false, error: 'invalid uid' };
  const name = String(fieldName || '').trim();
  const val = String(value ?? '').trim();
  if (!name) return { ok: false, error: 'field name required' };
  if (!val) return { ok: false, error: 'empty value' };
  const src = normalizeSource(source);
  const proj = project ? String(project).trim() : undefined;
  // 三态裁决唯一处（specs/014）：用户线非法要**报错不写**（M11/I-3）；
  // 智能线（既有位置参数）维持「非法静默忽略」的容错口径（A5 保护面，不改）。
  if (asOfControl) {
    const resolved = resolveAsOfControl(asOfControl);
    if (!resolved.ok) return resolved;
  }
  const validAsOf = asOfControl
    ? (asOfControl.asOf !== undefined ? asOfControl.asOf : undefined)
    : (asOf && ASOF_MARKER_RE.test(`asof:${asOf}`) ? asOf : undefined);

  let existingSnapshot: Array<{ value: string; restricted: boolean }> = [];
  let appended = false;
  const result = await mutateGroupContent(uid, groupId, (content) => {
    const values = content.fields[name] || (content.fields[name] = []);
    existingSnapshot = values.map((fv) => ({ value: fv.value, restricted: fv.sensitivity === 'restricted' }));
    if (values.some((fv) => fv.value === val && fv.source === src && (fv.project ?? undefined) === proj)) {
      return { changed: false }; // 完全匹配去重
    }
    const added: FieldValue = { value: val, source: src, ...(proj ? { project: proj } : {}), ...(validAsOf ? { asOf: validAsOf } : {}) };
    values.push(added);
    appended = true;
    return { changed: true, afterSummary: summarizeFieldValue(added) }; // D12：value_add 的 after 摘要
  }, { action: 'value_add', field: name });
  // 写后矛盾检查（蓝图 R32）：保存与检查互相独立——fire-and-forget，保存
  // 的「成功」从不承诺「查过没问题」，检查结论只报忧不报喜（台账+界面标记）。
  if (result.ok && appended && existingSnapshot.length) {
    void import('./recall/ontology-conflicts')
      .then((m) => m.checkNewValueAgainst(uid, groupId, name, val, existingSnapshot))
      .catch(() => {});
  }
  return result;
}

/** 字段区：按值匹配替换那一行（保留原来源标记）。 */
export async function setFieldValue(
  uid: string,
  groupId: string,
  fieldName: string,
  oldValue: string,
  newValue: string,
  /** 时间锚三态（specs/014 T005 / M12）：缺省 = 保留既有 asOf（009 的承诺，
   *  展开语义天然满足）；`asOf` = 设置；`clearAsOf` = 显式清除。 */
  asOfControl?: AsOfControl,
): Promise<SimpleResult> {
  if (!safeId(uid)) return { ok: false, error: 'invalid uid' };
  const name = String(fieldName || '').trim();
  const next = String(newValue ?? '').trim();
  if (!name) return { ok: false, error: 'field name required' };
  if (!next) return { ok: false, error: 'empty value' };
  if (asOfControl) {
    const resolved = resolveAsOfControl(asOfControl);
    if (!resolved.ok) return resolved;
  }

  return mutateGroupContent(uid, groupId, (content) => {
    const values = content.fields[name];
    if (!values) return { ok: false, error: 'field value not found' };
    const idx = values.findIndex((fv) => fv.value === oldValue);
    if (idx === -1) return { ok: false, error: 'field value not found' };
    // D12：value_edit 的前后摘要（受限行编辑后仍受限，before/after 都脱敏）。
    const beforeSummary = summarizeFieldValue(values[idx]);
    // 三态落盘（specs/014 T005）：set/clear 只动 asOf 键，其余标记逐字保留。
    if (asOfControl?.asOf !== undefined) {
      values[idx] = { ...values[idx], value: next, asOf: asOfControl.asOf };
    } else if (asOfControl?.clearAsOf === true) {
      const { asOf: _drop, ...rest } = values[idx];
      values[idx] = { ...rest, value: next };
    } else {
      values[idx] = { ...values[idx], value: next };
    }
    return { changed: true, beforeSummary, afterSummary: summarizeFieldValue(values[idx]) };
  }, { action: 'value_edit', field: name });
}

/** 字段值核实档 toggle（2026-09-20 断言核实维度；spec 007 升两档）：
 *  level = false 取消 / true 有来源支持（裸 @verified）/ 'independent' 独立
 *  核实过。同值多行一起切；只改 verified 位，不动其他标记。 */
export async function setFieldValueVerified(
  uid: string,
  groupId: string,
  fieldName: string,
  value: string,
  level: boolean | 'independent',
): Promise<SimpleResult> {
  if (!safeId(uid)) return { ok: false, error: 'invalid uid' };
  const name = String(fieldName || '').trim();
  const val = String(value ?? '').trim();
  if (!name) return { ok: false, error: 'field name required' };
  if (!val) return { ok: false, error: 'empty value' };

  return mutateGroupContent(uid, groupId, (content) => {
    const values = content.fields[name];
    if (!values || !values.some((fv) => fv.value === val)) {
      return { ok: false, error: 'field value not found' };
    }
    let changed = false;
    const next: boolean | 'independent' | undefined = level === false ? undefined : level;
    for (const fv of values) {
      if (fv.value !== val) continue;
      if (fv.verified !== next) changed = true;
      if (next === undefined) delete fv.verified;
      else fv.verified = next;
    }
    return changed ? { changed: true } : { changed: false };
  });
}

/** 规则分类循环 toggle（spec 007 T301）：无 → operation → preference →
 *  constraint → 无。仅关系值形状的行有分类语义（普通值标了也不影响解析）。 */
export async function cycleFieldValueRuleKind(
  uid: string,
  groupId: string,
  fieldName: string,
  value: string,
): Promise<SimpleResult> {
  if (!safeId(uid)) return { ok: false, error: 'invalid uid' };
  const name = String(fieldName || '').trim();
  const val = String(value ?? '').trim();
  if (!name || !val) return { ok: false, error: 'field name or value required' };
  const ORDER: Array<'operation' | 'preference' | 'constraint' | undefined> =
    [undefined, 'operation', 'preference', 'constraint'];

  return mutateGroupContent(uid, groupId, (content) => {
    const values = content.fields[name];
    if (!values || !values.some((fv) => fv.value === val)) {
      return { ok: false, error: 'field value not found' };
    }
    let changed = false;
    for (const fv of values) {
      if (fv.value !== val) continue;
      const idx = ORDER.indexOf(fv.ruleKind);
      const next = ORDER[(idx + 1) % ORDER.length];
      if (fv.ruleKind !== next) changed = true;
      if (next === undefined) delete fv.ruleKind;
      else fv.ruleKind = next;
    }
    return changed ? { changed: true } : { changed: false };
  });
}

/** 敏感性 toggle（spec 007 T302）：standard ⇄ restricted。restricted 的值
 *  由注入侧过滤（projection-knowledge），不进任务上下文与世界模型。 */
export async function setFieldValueSensitivity(
  uid: string,
  groupId: string,
  fieldName: string,
  value: string,
  restricted: boolean,
): Promise<SimpleResult> {
  if (!safeId(uid)) return { ok: false, error: 'invalid uid' };
  const name = String(fieldName || '').trim();
  const val = String(value ?? '').trim();
  if (!name || !val) return { ok: false, error: 'field name or value required' };

  return mutateGroupContent(uid, groupId, (content) => {
    const values = content.fields[name];
    if (!values || !values.some((fv) => fv.value === val)) {
      return { ok: false, error: 'field value not found' };
    }
    let changed = false;
    for (const fv of values) {
      if (fv.value !== val) continue;
      const next = restricted ? 'restricted' as const : undefined;
      if (fv.sensitivity !== next) changed = true;
      if (next === undefined) delete fv.sensitivity;
      else fv.sensitivity = next;
    }
    return changed ? { changed: true } : { changed: false };
  });
}

/** 字段区：删掉匹配该值的行；小节空则整个字段小节删除。值不存在视为 no-op ok。 */
export async function removeFieldValue(
  uid: string,
  groupId: string,
  fieldName: string,
  value: string,
): Promise<SimpleResult> {
  if (!safeId(uid)) return { ok: false, error: 'invalid uid' };
  const name = String(fieldName || '').trim();
  if (!name) return { ok: false, error: 'field name required' };

  return mutateGroupContent(uid, groupId, (content) => {
    const values = content.fields[name];
    if (!values) return { ok: true, changed: false };
    const removedFv = values.find((fv) => fv.value === value);
    const kept = values.filter((fv) => fv.value !== value);
    if (kept.length === values.length) return { ok: true, changed: false };
    if (kept.length) content.fields[name] = kept;
    else delete content.fields[name];
    // D12：value_remove 记被删那条的摘要（受限行只记 [受限]+长度）。
    return { changed: true, beforeSummary: removedFv ? summarizeFieldValue(removedFv) : undefined };
  }, { action: 'value_remove', field: name });
}

/** 字段区：删整个字段小节（含全部值）。字段不存在视为 no-op ok。 */
export async function removeField(uid: string, groupId: string, fieldName: string): Promise<SimpleResult> {
  if (!safeId(uid)) return { ok: false, error: 'invalid uid' };
  const name = String(fieldName || '').trim();
  if (!name) return { ok: false, error: 'field name required' };

  return mutateGroupContent(uid, groupId, (content) => {
    if (!(name in content.fields)) return { ok: true, changed: false };
    // D12：field_remove 记整个被删小节的值摘要（逐条脱敏后合并，helper 截断）。
    const beforeSummary = (content.fields[name] || []).map(summarizeFieldValue).join('、');
    delete content.fields[name];
    return { changed: true, beforeSummary };
  }, { action: 'field_remove', field: name });
}

/** 流水区：按文本完全匹配删除一条，其余保留。 */
export async function removeEntry(uid: string, groupId: string, entryText: string): Promise<SimpleResult> {
  if (!safeId(uid)) return { ok: false, error: 'invalid uid' };
  const target = String(entryText ?? '').trim();
  if (!target) return { ok: false, error: 'empty entry' };

  return mutateGroupContent(uid, groupId, (content) => {
    const idx = content.entries.findIndex((e) => e === target);
    if (idx === -1) return { ok: false, error: 'entry not found' };
    content.entries.splice(idx, 1);
    // D12：entry_remove 记被删流水条目的摘要（流水条目无受限标记，helper 截断）。
    return { changed: true, beforeSummary: target };
  }, { action: 'entry_remove' });
}

/**
 * 流水条目升格为字段值：从流水区移除该条目 + 字段区写入（来源 `手动`）。
 * 该字段小节不存在则创建；已升格过的条目再次升格会因条目不存在而失败（幂等）。
 */
export async function promoteEntryToField(
  uid: string,
  groupId: string,
  entryText: string,
  fieldName: string,
): Promise<SimpleResult> {
  if (!safeId(uid)) return { ok: false, error: 'invalid uid' };
  const target = String(entryText ?? '').trim();
  const name = String(fieldName || '').trim();
  if (!target) return { ok: false, error: 'empty entry' };
  if (!name) return { ok: false, error: 'field name required' };

  return mutateGroupContent(uid, groupId, (content) => {
    const idx = content.entries.findIndex((e) => e === target);
    if (idx === -1) return { ok: false, error: 'entry not found' };
    content.entries.splice(idx, 1);
    const values = content.fields[name] || (content.fields[name] = []);
    values.push({ value: target, source: '手动' });
    return { changed: true, afterSummary: target }; // D12：entry_promote 记升格的条目
  }, { action: 'entry_promote', field: name });
}

export interface GroupFieldInfo {
  name: string;
  isRelation?: boolean;
  description?: string;
  values: FieldValue[];
  /**
   * 模板组：字段的 T-box 归属三态 —— `active`（catalog 当前声明）/
   * `retired`（官方历史字段，catalog 已明确声明退役）/ `custom`（用户自建）。
   * 非模板组不带此字段。
   */
  status?: 'active' | 'retired' | 'custom';
  /**
   * `status !== 'active'` 的派生别名，给还没换到三态的渲染层用。
   * **新代码请读 `status`**：`isCustom` 分不出「产品下架的官方字段」和
   * 「用户自建字段」，而这两者的处置完全不同。
   */
  isCustom?: boolean;
  /** 模板组：字段所属分节（三态判定要按分节作用域，扁平清单里必须带上）。 */
  sectionTitle?: string;
}

export interface ListGroupFieldsResult {
  ok: boolean;
  fields?: GroupFieldInfo[];
  error?: string;
}

/**
 * 模板文件元信息行：`> 模板: <id>@<semver>[ | 已安装: <ISO>]`。
 *
 * **这是全仓库唯一的模板文件判据**（template_files.ts 从这里 import，反向会
 * 成环：template_files 已经依赖 groups）。收归前 groups 与 template_files 各有
 * 一份正则，一份带行尾锚点与预发布后缀、一份靠前缀匹配——虽然对当前版本号
 * 恰好同判（见 role_template_baseline.test.ts B1），但两份定义随时会分叉，
 * 让同一个文件被两个 reader 判成不同类型。
 *
 * 捕获组：1 = template_id，2 = 版本（支持 semver 预发布后缀），3 = 已安装时间。
 */
export const TEMPLATE_FILE_META_RE =
  /^>\s*模板:\s*([a-z0-9_-]+)@(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?:\s*\|\s*已安装:\s*(.+))?$/;

/** 文件是否携带模板元信息行（= 模板文件，按分节式解析）。 */
export function isTemplateFileText(text: string): boolean {
  if (typeof text !== 'string') return false;
  return text.split('\n').some((line) => TEMPLATE_FILE_META_RE.test(line.trim()));
}

/** 模板文件（`## 分节` / `### 字段` 分节式）的轻量字段汇总：跨分节合并所有
 *  `### <字段名>` 小节为字段清单（含空坑与值，文件顺序）。仅提取字段名+值；
 *  isRelation/description 由调用方按模板 T-box 补充。 */
export function collectTemplateFileFields(text: string): GroupFieldInfo[] {
  const out: GroupFieldInfo[] = [];
  const sections = String(text ?? '').split(/^##\s+(.+)$/m);
  for (let i = 1; i < sections.length; i += 2) {
    const body = sections[i + 1] || '';
    const blocks = body.split(/^###\s+(.+)$/m);
    for (let j = 1; j < blocks.length; j += 2) {
      const name = blocks[j].trim();
      if (!name || name === '流水') continue;
      const values: FieldValue[] = [];
      for (const line of blocks[j + 1].split('\n')) {
        const pv = parseFieldValueLine(line);
        if (pv) values.push(pv);
      }
      // 带上分节名：字段名只在其所属分节内唯一，三态判定必须按分节作用域走，
      // 扁平清单丢掉分节就只能按名字全模板猜。
      out.push({ name, values, sectionTitle: sections[i].trim() });
    }
  }
  return out;
}

/**
 * 合并模板声明与实例值：模板组返回模板字段清单（含 isRelation/description）
 * + 各组实例值（可能为空坑）；非模板组返回实例字段（无模板声明）。
 * 模板字段按 preset_groups 中该组标题（title）匹配 —— 组改名后匹配不上时
 * 退化为只返回实例字段，不猜测。
 * 模板文件（阶段 D，一模板一文件分节式）优先按模板文件解析：跨分节汇总
 * 所有 `###` 字段小节（含自定义字段），避免双区解析器把分节式文件误当流水。
 */
export async function listGroupFields(uid: string, groupId: string): Promise<ListGroupFieldsResult> {
  if (!safeId(uid)) return { ok: false, error: 'invalid uid' };
  const groups = readGroups(uid);
  const meta = groups.find((g) => g.group_id === groupId);
  if (!meta) return { ok: false, error: 'group not found' };

  let abs: string;
  try { abs = resolveGroupFileAbsPathFromMeta(uid, meta); }
  catch (err) { return { ok: false, error: (err as Error).message }; }
  const fileText = readTextSafe(abs);

  // 模板文件（分节式）→ 跨分节字段汇总（这是模板组的唯一事实来源）
  if (isTemplateFileText(fileText)) {
    const fields = collectTemplateFileFields(fileText);
    // 三态标注（active / retired / custom）。判据来自 contract 的单一 T-box
    // 能力，不在这里重建一份。isCustom 作为派生别名保留给旧渲染层。
    if (meta.template_id) {
      const { roleTemplateFieldStatus } = await import('./personal_ontology_contract');
      for (const f of fields) {
        f.status = roleTemplateFieldStatus(meta.template_id, f.sectionTitle || '', f.name);
        f.isCustom = f.status !== 'active';
      }
    }
    return { ok: true, fields };
  }

  const content = parseGroupContent(fileText);

  // 实例字段（有值的），按文件出现顺序
  const instanceFields = Object.keys(content.fields).map((name) => ({
    name,
    values: content.fields[name],
  }));

  // 模板声明（template_id 命中内置模板 + 组标题命中 preset）
  let templatePreset: PresetGroup | undefined;
  if (meta.template_id) {
    const template = getRoleTemplate(meta.template_id);
    if (template) {
      templatePreset = template.preset_groups.find((p) => p.title === meta.title);
    }
  }

  if (!templatePreset) {
    return { ok: true, fields: instanceFields };
  }

  const merged: GroupFieldInfo[] = templatePreset.fields.map((f) => ({
    name: f.name,
    isRelation: f.isRelation,
    description: f.description,
    values: content.fields[f.name] || [],
  }));
  // 实例里有、模板没声明的字段也补上（用户自建字段）
  for (const inst of instanceFields) {
    if (!templatePreset.fields.some((f) => f.name === inst.name)) {
      merged.push(inst);
    }
  }
  return { ok: true, fields: merged };
}

// Exposed for the IPC layer / tests that need to resolve a group's absolute
// content path (e.g. to build a chat-use read) without duplicating the
// traversal-safety logic above.
export function resolveGroupContentAbsPathForUser(uid: string, groupId: string): string {
  return resolveGroupFileAbsPath(uid, groupId);
}
