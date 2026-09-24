/**
 * 资产管家工具（specs/008 US-401 读 / US-402 写 / US-404 安全网）。
 *
 * 与 `recall-tools.ts` 的分工：那里是**任务执行期**的只读取用（目录 + 语义检索 +
 * agent_read 留痕），这里面向**管理**——全量浏览、按需读全文、按用户指令改动。
 * 分开的理由是两者语义不同：取用会写注入回执与使用流水，管理不该写（把"管家
 * 看了一眼"记成"任务用了这条资产"，会让采用统计失真）。
 *
 * 写通道不新开：全部落到既有 `asset-service.ts` 写函数（不新建第二套写路径）。
 */

import type { AgentTool } from '#core-agent';
import { createLogger } from '../../logger';
import { t } from '../../i18n';
import {
  archiveAbilityAsset,
  classifyAbilityAssetWriteFailure,
  deleteAbilityAsset,
  listAbilityAssets,
  mergeAbilityAssets,
  readAbilityAsset,
  restoreAbilityAsset,
  rollbackAbilityAsset,
  updateAbilityAsset,
  type AbilityAssetFailureCategory,
  type UpdateAbilityAssetInput,
} from '../../features/recall/asset-service';
import type { RecallAbilityAssetRecord } from '../../features/recall/candidate-service';
import { evaluateRecallAssetRuntimeEligibility } from '../../features/recall/prompt-injection';
import { safeId } from '../../storage';
import { logErrorRef, maskId } from '../../util/log-redact';

const log = createLogger('asset-steward-tools');

export interface AssetStewardToolsOpts {
  userId: string;
  /** 当前回合 id：Phase 5 的危险操作确认与台账定位用。 */
  turnId?: string;
  /** Conversation id：危险操作的单次确认要送回这条会话。 */
  cid?: string;
  /** 空间 id：运行时准入的作用域上下文。 */
  spaceId?: string;
  /** 当前用户消息文本：适用/禁用场景匹配用。 */
  taskText?: string;
}

/** 列表分页默认与上限，对齐既有目录工具量级（一页 30、最多 50）。 */
const LIST_PAGE_DEFAULT = 30;
const LIST_PAGE_MAX = 50;

/** 单批正文上限。与既有正文模式的 2000 字同量级：再大就等于绕回"整块塞正文"。 */
export const READ_CHUNK_CHARS = 2_000;

/** 「已彻底清除」是终态、且规范要求"搜索不可见"——墓碑只剩一个 id，
 *  列出来只会是噪音，所以清单整体排除它（其余状态一律如实列出）。 */
const LISTABLE_STATUSES = ['active', 'paused', 'archived', 'deleted', 'revoked'] as const;

const STATUS_LABELS: Record<string, string> = {
  active: '在用', paused: '已暂停', archived: '已归档', deleted: '已删除',
  revoked: '已撤销', purged: '已彻底清除',
};

/** 准入被拦的原因 → 人话（与 recall-tools 的映射同源；这里的用途是"告知为什么
 *  不返回正文"，不是"换一条试试"）。 */
const BLOCK_REASON_LABELS: Record<string, string> = {
  status_not_active: '状态不是在用（已暂停/归档/删除/撤销）',
  source_unavailable: '来源被撤权，已停止使用',
  scope_mismatch: '作用范围与当前上下文不匹配',
  forbidden_context: '命中它自己声明的禁用场景',
  target_agent_not_allowed: '不允许用于当前 Agent',
  sensitivity_unclassified: '敏感级未分级',
  sensitivity_above_destination: '敏感级高于当前目的地上限',
  maturity_below_default_use: '置信度不足（未确认/未验证）',
};

function blockReasonText(reasons: readonly string[]): string {
  return reasons.length
    ? reasons.map((reason) => `${BLOCK_REASON_LABELS[reason] || reason}[${reason}]`).join('；')
    : '当前上下文不可使用';
}

function statusText(status: string): string {
  return `${STATUS_LABELS[status] || status}[${status}]`;
}

function metaLine(asset: RecallAbilityAssetRecord): string {
  const version = String(asset.activeVersion || asset.version || '1');
  return [
    `类型=${asset.type || '?'}`,
    `状态=${statusText(asset.status)}`,
    `范围=${asset.scope || 'general'}`,
    `成熟度=${asset.maturity || '?'}`,
    `在用版=v${version}`,
    ...(asset.activeVersion && asset.activeVersion !== asset.version ? [`最新版=v${asset.version}`] : []),
    ...(asset.spaceId ? [`空间=${asset.spaceId}`] : []),
    // 族名是用户手写的**同源血缘**分组名，不是主题标签（标签字段尚未落地）：
    // 显示它才能让归并判断有依据，但必须标清是什么，免得和"标签"混为一谈。
    ...(asset.familyName ? [`族名(同源血缘)=${asset.familyName}`] : []),
    ...(asset.sensitivity ? [`敏感级=${asset.sensitivity}`] : []),
  ].join(' | ');
}

function listLine(asset: RecallAbilityAssetRecord): string {
  return `[asset:${asset.id}] ${asset.title || '(无标题)'} (${metaLine(asset)})`;
}

/** 一条资产是否是"能交给模型看的"——与注入/派单同一道运行时准入门，
 *  同源判定，避免两处标准分叉。
 *
 *  软条件 `not_applicable_context` 不计入拦截（与既有正文读取同口径）：
 *  applicableWhen 是给模型自己判断的软提示，按用户消息做词面匹配来否掉模型的
 *  明确选择，会把这个功能废掉。硬闸照旧：状态 / 来源 / scopePolicy / 禁用场景 /
 *  敏感度 / targetAgents。
 */
async function runtimeBlockReasons(
  opts: AssetStewardToolsOpts,
  asset: RecallAbilityAssetRecord,
): Promise<string[]> {
  const eligibility = await evaluateRecallAssetRuntimeEligibility(opts.userId, asset, {
    ...(opts.spaceId ? { scope: opts.spaceId } : {}),
    ...(opts.taskText ? { taskText: opts.taskText } : {}),
    purpose: 'agent_read',
    silentDefaultInjection: true,
  });
  return eligibility.reasons.filter((reason) => reason !== 'not_applicable_context');
}

function createListAbilityAssetsTool(opts: AssetStewardToolsOpts): AgentTool {
  const userId = opts.userId;
  return {
    name: 'list_ability_assets',
    executionMode: 'parallel',
    description: [
      '列出这位用户的**全部**认知资产（经验/规则/模板/方法/偏好），含标题、类型、状态、范围、成熟度、在用版本、所属空间。',
      '与 search_ability_assets 的区别：那是按相关度找"这次任务能用上什么"，这个是**管理视角的全量清单**——要看全、要按状态/类型/空间筛、要交给后面的整理动作时用它。',
      '默认一页 30 条、最多 50 条，用 offset 翻页；返回里带总数与各状态的条数，翻完就能确认"一共多少条"。',
      '**已彻底清除的资产不在清单里**（规范要求搜索不可见）；已删除的会如实标成"已删除"，不会被藏起来，但它的正文读不出来（见 read_ability_asset）。',
      '资产目前**没有主题标签字段**（标签系统尚未落地）：不要按标签过滤，也不要试图写标签，返回里出现的"族名(同源血缘)"是另一个东西（系统自动的同源分组）。',
    ].join(''),
    inputSchema: {
      type: 'object',
      properties: {
        offset: { type: 'number', description: '从第几条开始（默认 0）。上一页末尾会提示下一页的 offset 与剩余条数。' },
        limit: { type: 'number', description: `一页条数：默认 ${LIST_PAGE_DEFAULT}、最大 ${LIST_PAGE_MAX}。` },
        filter: {
          type: 'object',
          description: '可选过滤：三者可同时给。',
          properties: {
            assetType: { type: 'string', description: '资产类型：rule / template / skill_method / fact / personal。' },
            status: { type: 'string', description: '治理状态：active / paused / archived / deleted / revoked。' },
            spaceId: { type: 'string', description: '只看某个空间沉淀的资产（sp_ 开头）。' },
          },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
    async execute(input: Record<string, unknown>): Promise<{ content: string; isError?: boolean }> {
      const offset = Math.max(0, Math.floor(Number(input.offset) || 0));
      const limit = Math.min(LIST_PAGE_MAX, Math.max(1, Math.floor(Number(input.limit) || LIST_PAGE_DEFAULT)));
      const filter = (input.filter && typeof input.filter === 'object' && !Array.isArray(input.filter))
        ? input.filter as Record<string, unknown>
        : {};
      const assetType = typeof filter.assetType === 'string' && filter.assetType.trim() ? filter.assetType.trim() : undefined;
      const status = typeof filter.status === 'string' && filter.status.trim() ? filter.status.trim() : undefined;
      const spaceId = typeof filter.spaceId === 'string' && filter.spaceId.trim() ? filter.spaceId.trim() : undefined;
      if (status && !LISTABLE_STATUSES.includes(status as typeof LISTABLE_STATUSES[number])) {
        return { content: `status 过滤值不认识：${status}（可用：${LISTABLE_STATUSES.join(' / ')}）`, isError: true };
      }
      if (spaceId && !safeId(spaceId)) {
        return { content: `spaceId 不是合法的空间 id：${spaceId}`, isError: true };
      }

      let assets: RecallAbilityAssetRecord[];
      try {
        assets = await listAbilityAssets(userId);
      } catch (err) {
        log.warn('steward list failed', { userId: maskId(userId), error: logErrorRef(err as Error) });
        return { content: '读取认知资产清单失败（详见应用日志）。', isError: true };
      }
      const all = assets.filter((asset) => asset.status !== 'purged');
      const counts = new Map<string, number>();
      for (const asset of all) counts.set(asset.status, (counts.get(asset.status) || 0) + 1);

      let pool = all;
      if (assetType) pool = pool.filter((asset) => asset.type === assetType);
      if (status) pool = pool.filter((asset) => asset.status === status);
      if (spaceId) pool = pool.filter((asset) => asset.spaceId === spaceId);

      const filterNote = [
        assetType ? `类型=${assetType}` : '',
        status ? `状态=${status}` : '',
        spaceId ? `空间=${spaceId}` : '',
      ].filter(Boolean).join('，');
      const countNote = LISTABLE_STATUSES
        .filter((key) => counts.get(key))
        .map((key) => `${STATUS_LABELS[key]} ${counts.get(key)}`)
        .join(' · ');
      if (!pool.length) {
        return {
          content: all.length
            ? `没有符合条件的资产（全部 ${all.length} 条：${countNote}${filterNote ? `；过滤条件：${filterNote}` : ''}）。去掉过滤条件或换一个再试。`
            : '认知资产库是空的：这位用户还没有任何资产。',
        };
      }
      const page = pool.slice(offset, offset + limit);
      if (!page.length) {
        return {
          content: `已到清单末尾（共 ${pool.length} 条${filterNote ? `，过滤：${filterNote}` : ''}；offset 从 0 开始）。用 offset=0 从头看，或去掉过滤条件。`,
        };
      }
      const more = pool.length - (offset + page.length);
      return {
        content: [
          `认知资产清单：共 ${all.length} 条（${countNote}）${filterNote ? `；过滤：${filterNote} → ${pool.length} 条` : ''}`,
          `本页 ${offset + 1}-${offset + page.length} 条：`,
          '',
          ...page.map(listLine),
          '',
          more > 0 ? `还有 ${more} 条：用 offset=${offset + page.length} 继续翻页。` : '这是最后一页。',
          '看某条全文用 read_ability_asset（传 assetId）。',
        ].join('\n'),
      };
    },
  };
}

function createReadAbilityAssetTool(opts: AssetStewardToolsOpts): AgentTool {
  const userId = opts.userId;
  return {
    name: 'read_ability_asset',
    executionMode: 'parallel',
    description: [
      '读出一条认知资产的**完整正文**：单批最多 2000 字，长正文用 chunk 逐批读完（返回里会写明第几批/共几批与下一批的 chunk）。',
      '这是管理视角的全文读取，不受"一次 6 条、每条 2000 字"的目录取用限制；适合改动前先看清内容、核对某条到底写了什么。',
      '资产**不可用时不会返回正文**，而是如实说明原因（已删除/已暂停/来源被撤权/范围不符/命中禁用场景/敏感级过高/未分级等）——这不是"找不到"，别当成资产不存在，也别试图绕过。',
      '已删除的资产在保留期内仍然存在，但正文已不可用；要恢复它用 restore_ability_asset。',
    ].join(''),
    inputSchema: {
      type: 'object',
      properties: {
        assetId: { type: 'string', description: '目录里的资产 id（aa- 开头）。' },
        chunk: { type: 'number', description: `第几批（从 0 开始），默认 0。一批 ${READ_CHUNK_CHARS} 字；返回会写明总批数与下一批编号。` },
      },
      required: ['assetId'],
      additionalProperties: false,
    },
    async execute(input: Record<string, unknown>): Promise<{ content: string; isError?: boolean }> {
      const assetId = typeof input.assetId === 'string' ? input.assetId.trim() : '';
      if (!safeId(assetId)) return { content: `不是合法的资产 id：${assetId || '(空)'}`, isError: true };
      const chunk = Math.max(0, Math.floor(Number(input.chunk) || 0));

      let asset: RecallAbilityAssetRecord;
      try {
        asset = await readAbilityAsset(userId, assetId);
      } catch (err) {
        log.warn('steward read failed', { userId: maskId(userId), assetId, error: logErrorRef(err as Error) });
        return { content: `[asset:${assetId}] 读取失败：这条资产不存在，或不属于当前用户。`, isError: true };
      }

      const reasons = await runtimeBlockReasons(opts, asset);
      if (reasons.length) {
        // 「被拦截不得计为成功」：isError 是平台自身的成功/失败信号，回执同时写明
        // 具体命中哪条规则——不静默当不存在，也不把正文交出去。
        return {
          content: [
            `[asset:${assetId}] ${asset.title || '(无标题)'}：当前不可读出正文。`,
            `状态：${statusText(asset.status)}`,
            `拦截规则：${blockReasonText(reasons)}`,
            asset.status === 'deleted'
              ? '这条在删除保留期内：可以恢复（restore_ability_asset），恢复后才能读到正文。'
              : '这是权限/状态门禁的结果，不是"资产不存在"。',
          ].join('\n'),
          isError: true,
        };
      }

      const statement = String(asset.statement || '');
      const totalChunks = Math.max(1, Math.ceil(statement.length / READ_CHUNK_CHARS));
      if (chunk >= totalChunks) {
        return {
          content: `chunk 越界：这条资产正文共 ${totalChunks} 批（chunk 从 0 开始），收到 ${chunk}。`,
          isError: true,
        };
      }
      const body = statement.slice(chunk * READ_CHUNK_CHARS, (chunk + 1) * READ_CHUNK_CHARS);
      const applies = (asset.applicableWhen || []).join('；');
      const forbids = (asset.forbiddenWhen || []).join('；');
      const nextHint = chunk + 1 < totalChunks
        ? `还有 ${totalChunks - chunk - 1} 批：用 chunk=${chunk + 1} 继续。`
        : '这是最后一批，正文已读完。';
      return {
        content: [
          `[asset:${assetId}] ${asset.title || '(无标题)'}`,
          metaLine(asset),
          // 条件行不能靠"过滤空串"来拼：正文与下一批提示之间那个空行是**故意**的，
          // 一起滤掉会让提示黏在正文末尾，模型分不清哪句是内容、哪句是工具话。
          ...(applies ? [`适用于: ${applies}`] : []),
          ...(forbids ? [`禁用: ${forbids}`] : []),
          `正文（第 ${chunk + 1}/${totalChunks} 批，共 ${statement.length} 字）:`,
          body,
          '',
          nextHint,
        ].join('\n'),
      };
    },
  };
}

// ── 写工具（US-402） ──────────────────────────────────────────────────────
//
// 全部落到既有 `asset-service.ts` 写函数，不新建第二套写通道；`actor` 一律 `'ai'`，
// 依据写进台账的 `reason`（FR-004）。**被拦截的操作不得计为成功**：失败回执带
// `isError`、写明拦截规则与归因分类。

/** 归因分类 → 人话（回执给模型看，模型再向用户解释）。 */
const FAILURE_CATEGORY_LABELS: Record<AbilityAssetFailureCategory, string> = {
  product: '产品规则',
  model: '模型侧',
  prompt: '提示词',
  data: '数据缺失/不存在',
  tool: '工具执行',
  permission: '权限或敏感级拦截',
  workflow: '并发/流程冲突',
  schema: '入参或记录形状不合法',
  governance: '治理状态拦截',
  evidence: '证据不足',
  unknown: '未归类',
};

/** 「AI 自主提出的实质变化」不得直接生效（specs/008 分级②）。
 *
 *  实质变化 = 方法正文 / 事实判断 / 适用范围：
 *    - `statement`：正文即"这条资产主张什么"；
 *    - `scope` 与 `applicableWhen`/`forbiddenWhen`：它从此会进出哪一批任务；
 *    - `sensitivity`：能去的地方变多就是扩权——拍板表没单列它，但既有系统
 *      自己就把「敏感级升高」当扩权（inbox 的 `sensitivity_escalated` 是
 *      confirm 档）。归入实质变化是**更保护**的方向，代价只是偶发一张卡。
 *  命名/标题不在此列（分级③允许自动处理）。 */
const SUBSTANTIAL_FIELDS = ['statement', 'scope', 'applicableWhen', 'forbiddenWhen', 'sensitivity'] as const;

function writeReceipt(action: string, asset: RecallAbilityAssetRecord, extra: string[] = []): string {
  return [
    `已${action}：[asset:${asset.id}] ${asset.title || '(无标题)'}`,
    metaLine(asset),
    ...extra,
  ].join('\n');
}

function writeFailure(
  action: string,
  assetId: string,
  error: unknown,
  hint?: string,
): { content: string; isError: true } {
  const category = classifyAbilityAssetWriteFailure(error);
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [
      `未能${action}：[asset:${assetId}]`,
      `拦截规则：${message}`,
      `归因：${category}（${FAILURE_CATEGORY_LABELS[category]}）`,
      ...(hint ? [hint] : []),
    ].join('\n'),
    isError: true,
  };
}

function requireReason(value: unknown): string | { error: string } {
  const reason = typeof value === 'string' ? value.trim() : '';
  if (!reason) return { error: 'reason 必填：这次改动依据的是用户的哪句话/哪条证据？（它会被写进台账的「依据」）' };
  if (reason.length > 1_000) return { error: 'reason 太长（上限 1000 字）' };
  return reason;
}

function createEditAbilityAssetTool(opts: AssetStewardToolsOpts): AgentTool {
  const userId = opts.userId;
  return {
    name: 'edit_ability_asset',
    description: [
      '改一条认知资产的内容：标题、正文、适用范围、适用/禁用场景、敏感级。**必须**说明依据（reason）。',
      '**分级（很重要）**：用户明确要求的改动（"把这条改清楚点"）直接执行；**你自己**想到的正文/适用范围/敏感级实质变化不要直接改——那类改动会改掉这条资产主张什么、或者它从此会进出哪一批任务，必须由用户点头（本工具会拒绝并说明）。',
      '读到的版本号（metaLine 里的「在用版」）请通过 expectedVersion 带回来：如果这条资产在你读取之后被改过（用户正在手动编辑），工具会拒绝而不是覆盖——重新读一次再决定。',
      '改动会写进台账（谁改的/时间/前后值/依据），并且随时可回滚（rollback_ability_asset）。',
      '标签与归类字段目前没有（标签系统尚未落地）：不要传 tags/category，传了会被拒绝。',
    ].join(''),
    inputSchema: {
      type: 'object',
      properties: {
        assetId: { type: 'string', description: '要改的资产 id（aa- 开头）。' },
        fields: {
          type: 'object',
          description: '要改的字段，至少给一个；没给的字段不动。',
          properties: {
            title: { type: 'string', description: '标题（命名规范化；上限 120 字）。' },
            statement: { type: 'string', description: '正文（上限 4000 字）。' },
            scope: { type: 'string', description: '适用范围。' },
            applicableWhen: { type: 'array', items: { type: 'string' }, description: '适用场景（整体替换；传空数组=清空）。' },
            forbiddenWhen: { type: 'array', items: { type: 'string' }, description: '禁用场景（整体替换；传空数组=清空）。' },
            sensitivity: { type: 'string', description: '敏感级：L0 / L1 / L2。' },
          },
          additionalProperties: false,
        },
        reason: { type: 'string', description: '改动依据：用户的原话或具体证据（必填，写进台账）。' },
        expectedVersion: { type: 'string', description: '你读到这条时的版本号；给了就要求与当前一致，不一致则拒绝（不静默覆盖）。' },
        origin: {
          type: 'string',
          description: '这次改动的来源：user_instruction=用户明确要求的；ai_initiated=你自己提出要改的（缺省）。AI 自主的实质变化会被拒绝并要求走用户确认。',
        },
      },
      required: ['assetId', 'fields', 'reason'],
      additionalProperties: false,
    },
    async execute(input: Record<string, unknown>): Promise<{ content: string; isError?: boolean }> {
      const assetId = typeof input.assetId === 'string' ? input.assetId.trim() : '';
      if (!safeId(assetId)) return { content: `不是合法的资产 id：${assetId || '(空)'}`, isError: true };
      const reasonOrError = requireReason(input.reason);
      if (typeof reasonOrError !== 'string') return { content: reasonOrError.error, isError: true };
      const reason = reasonOrError;
      const fields = (input.fields && typeof input.fields === 'object' && !Array.isArray(input.fields))
        ? input.fields as Record<string, unknown>
        : {};
      const touched = Object.keys(fields).filter((key) => fields[key] !== undefined);
      if (!touched.length) return { content: 'fields 里至少要给一个要改的字段。', isError: true };
      // 标签/归类字段尚未落地（Epic 2 US-201）。**如实拒绝，不静默丢弃**：
      // 静默丢弃会让模型以为改成功了（最坏的一种"成功"）；也不映射到
      // `type`（资产数据形态、与 payload.kind 绑定）或 `familyName`（系统自动的
      // 同源血缘，不是分类）。Epic 2 落地后二者统一并入标签字段。
      const unavailableFields = ['tags', 'category'].filter((key) => fields[key] !== undefined);
      if (unavailableFields.length) {
        return {
          content: [
            `未能改动：[asset:${assetId}]`,
            `拦截规则：字段未就位（待 Epic 2 US-201 标签系统）：${unavailableFields.join(' / ')}`,
            '归因：data（数据缺失/不存在）',
            '这条资产目前没有标签/归类字段，所以这两个入参现在没有落点。请只带 title / statement / scope / applicableWhen / forbiddenWhen / sensitivity 重试。',
          ].join('\n'),
          isError: true,
        };
      }
      // 系统边界：模型给的值先在这里收口。上限与 IPC/服务层同口径（条件 ≤32 条），
      // 不指望下游兜——下游抛的是英文不变量消息，对模型不够可读。
      if (fields.sensitivity !== undefined && !['L0', 'L1', 'L2'].includes(String(fields.sensitivity))) {
        return { content: `sensitivity 只能是 L0 / L1 / L2，收到：${String(fields.sensitivity)}`, isError: true };
      }
      for (const key of ['applicableWhen', 'forbiddenWhen'] as const) {
        const value = fields[key];
        if (value === undefined) continue;
        if (!Array.isArray(value) || value.length > 32) {
          return { content: `${key} 要是字符串数组、且不超过 32 条。`, isError: true };
        }
      }
      const origin = input.origin === 'user_instruction' ? 'user_instruction' : 'ai_initiated';

      let asset: RecallAbilityAssetRecord;
      try {
        asset = await readAbilityAsset(userId, assetId);
      } catch {
        return { content: `[asset:${assetId}] 这条资产不存在，或不属于当前用户。`, isError: true };
      }

      // 分级②：AI 自主提出的实质变化不直接生效。Phase 6 会在这一步之前建提议并
      // 发审批卡片；这里保留"绝不静默生效"这道底线——提议建不出来时也宁可拒绝。
      const substantial = touched.filter((key) => (SUBSTANTIAL_FIELDS as readonly string[]).includes(key));
      if (origin !== 'user_instruction' && substantial.length) {
        return {
          content: [
            `[asset:${assetId}] ${asset.title || '(无标题)'}：这次改动涉及实质内容（${substantial.join(' / ')}），不能由我直接生效。`,
            '原因：正文/适用范围/敏感级变了，意味着这条资产主张的内容、或者它以后会进出哪一批任务变了，必须由用户确认。',
            '请把改动意图告诉用户，等用户明确要求后再改；或等审批卡片机制接手（本 feature 的后续阶段）。',
            origin === 'ai_initiated' && input.origin === undefined
              ? '（你没有声明 origin，按更保守的"AI 自主"处理；如果是用户明确要求的，带上 origin=user_instruction 与用户原话重试。）'
              : '',
          ].filter(Boolean).join('\n'),
          isError: true,
        };
      }

      const update: UpdateAbilityAssetInput = {
        reason,
        actor: 'ai',
        ...(typeof input.expectedVersion === 'string' && input.expectedVersion.trim()
          ? { expectedVersion: input.expectedVersion.trim() }
          : {}),
        ...(typeof fields.title === 'string' ? { title: fields.title } : {}),
        ...(typeof fields.statement === 'string' ? { statement: fields.statement } : {}),
        ...(typeof fields.scope === 'string' ? { scope: fields.scope } : {}),
        ...(Array.isArray(fields.applicableWhen) ? { applicableWhen: fields.applicableWhen.map(String) } : {}),
        ...(Array.isArray(fields.forbiddenWhen) ? { forbiddenWhen: fields.forbiddenWhen.map(String) } : {}),
        ...(typeof fields.sensitivity === 'string' ? { sensitivity: fields.sensitivity as 'L0' | 'L1' | 'L2' } : {}),
      };
      try {
        const updated = await updateAbilityAsset(userId, assetId, update);
        return {
          content: writeReceipt('改动', updated, [
            `改了什么：${touched.join(' / ')}`,
            `依据：${reason}`,
            '台账已记（actor=ai）；要撤销这次改动用 rollback_ability_asset。',
          ]),
        };
      } catch (err) {
        log.warn('steward edit failed', { userId: maskId(userId), assetId, error: logErrorRef(err as Error) });
        const conflicted = err instanceof Error && err.message.includes('version conflict');
        return writeFailure('改动', assetId, err, conflicted
          ? '这条资产在你读取之后被改过（可能是用户正在手动编辑）。重新读一次，确认用户想要的改动后再决定要不要改。'
          : undefined);
      }
    },
  };
}

/** 四个"状态治理"写工具共用一张表：动作名 → 落到哪个既有函数 + 回执里补什么。 */
function createStatusActionTool(
  opts: AssetStewardToolsOpts,
  spec: {
    name: string;
    description: string;
    actionLabel: string;
    run: (userId: string, assetId: string, reason: string) => Promise<RecallAbilityAssetRecord>;
    extra?: (asset: RecallAbilityAssetRecord) => string[];
  },
): AgentTool {
  const userId = opts.userId;
  return {
    name: spec.name,
    description: spec.description,
    inputSchema: {
      type: 'object',
      properties: {
        assetId: { type: 'string', description: '资产 id（aa- 开头）。' },
        reason: { type: 'string', description: '依据：用户的原话或具体理由（必填，写进台账）。' },
      },
      required: ['assetId', 'reason'],
      additionalProperties: false,
    },
    async execute(input: Record<string, unknown>): Promise<{ content: string; isError?: boolean }> {
      const assetId = typeof input.assetId === 'string' ? input.assetId.trim() : '';
      if (!safeId(assetId)) return { content: `不是合法的资产 id：${assetId || '(空)'}`, isError: true };
      const reasonOrError = requireReason(input.reason);
      if (typeof reasonOrError !== 'string') return { content: reasonOrError.error, isError: true };
      try {
        const asset = await spec.run(userId, assetId, reasonOrError);
        return { content: writeReceipt(spec.actionLabel, asset, spec.extra ? spec.extra(asset) : []) };
      } catch (err) {
        log.warn(`steward ${spec.name} failed`, { userId: maskId(userId), assetId, error: logErrorRef(err as Error) });
        return writeFailure(spec.actionLabel, assetId, err);
      }
    },
  };
}

function createMergeAbilityAssetsTool(opts: AssetStewardToolsOpts): AgentTool {
  const userId = opts.userId;
  return {
    name: 'merge_ability_assets',
    description: [
      '把一条重复资产并进另一条：source 的版本链并入 target（同一版本组），source 随即归档并记下归并去向，历史引用仍指向原条目可读。',
      '两条必须同类型；source 不能已经被并过。判断"重复"要谨慎——拿不准就先问用户，别把两条不同主张的资产并掉。',
      '并进之后 source 的正文不再作为在用内容；要撤销只能靠回滚各自版本，不能"反归并"。',
    ].join(''),
    inputSchema: {
      type: 'object',
      properties: {
        sourceAssetId: { type: 'string', description: '被并入的资产（会归档）。' },
        targetAssetId: { type: 'string', description: '保留下来的资产（版本链接收方）。' },
        reason: { type: 'string', description: '依据：为什么判定这两条重复（必填，写进台账）。' },
      },
      required: ['sourceAssetId', 'targetAssetId', 'reason'],
      additionalProperties: false,
    },
    async execute(input: Record<string, unknown>): Promise<{ content: string; isError?: boolean }> {
      const sourceAssetId = typeof input.sourceAssetId === 'string' ? input.sourceAssetId.trim() : '';
      const targetAssetId = typeof input.targetAssetId === 'string' ? input.targetAssetId.trim() : '';
      if (!safeId(sourceAssetId) || !safeId(targetAssetId)) return { content: 'sourceAssetId / targetAssetId 不是合法的资产 id。', isError: true };
      const reasonOrError = requireReason(input.reason);
      if (typeof reasonOrError !== 'string') return { content: reasonOrError.error, isError: true };
      try {
        const merged = await mergeAbilityAssets(userId, sourceAssetId, targetAssetId, { actor: 'ai', reason: reasonOrError });
        return {
          content: writeReceipt('归并', merged, [
            `被并入的条目：${sourceAssetId}（已归档，历史引用仍指向它）`,
            '台账已记（两条各一条：merged_from / merged_into）。',
          ]),
        };
      } catch (err) {
        log.warn('steward merge failed', { userId: maskId(userId), error: logErrorRef(err as Error) });
        return writeFailure('归并', targetAssetId, err);
      }
    },
  };
}

function createRollbackAbilityAssetTool(opts: AssetStewardToolsOpts): AgentTool {
  const userId = opts.userId;
  return {
    name: 'rollback_ability_asset',
    description: [
      '把一条资产回滚到某个历史版本：用那一版的内容**生成一个新版本**，历史版本号不回退（已经引用过旧版的任务不受影响）。',
      '回滚本身也进台账（actor=ai + 依据），所以"改错了再改回来"这条链是完整的。',
      '先用 read_ability_asset 或版本列表确认目标版本号；回滚不改治理状态（暂停过的不会因为回滚变回在用）。',
    ].join(''),
    inputSchema: {
      type: 'object',
      properties: {
        assetId: { type: 'string', description: '资产 id（aa- 开头）。' },
        toVersion: { type: 'string', description: '要回滚到的版本号（纯数字字符串，如 "2"）。' },
        reason: { type: 'string', description: '依据（必填，写进台账）。' },
      },
      required: ['assetId', 'toVersion', 'reason'],
      additionalProperties: false,
    },
    async execute(input: Record<string, unknown>): Promise<{ content: string; isError?: boolean }> {
      const assetId = typeof input.assetId === 'string' ? input.assetId.trim() : '';
      const toVersion = typeof input.toVersion === 'string' ? input.toVersion.trim() : String(input.toVersion ?? '').trim();
      if (!safeId(assetId)) return { content: `不是合法的资产 id：${assetId || '(空)'}`, isError: true };
      if (!/^[0-9]{1,9}$/.test(toVersion)) return { content: `toVersion 要是纯数字版本号，收到：${toVersion || '(空)'}`, isError: true };
      const reasonOrError = requireReason(input.reason);
      if (typeof reasonOrError !== 'string') return { content: reasonOrError.error, isError: true };
      try {
        const asset = await rollbackAbilityAsset(userId, assetId, toVersion, { actor: 'ai', reason: reasonOrError });
        return {
          content: writeReceipt('回滚', asset, [
            `回滚到 v${toVersion}（已作为新版本 v${asset.version} 落地，历史不回退）`,
            '台账已记（rolled_back + 前后值）。',
          ]),
        };
      } catch (err) {
        log.warn('steward rollback failed', { userId: maskId(userId), assetId, error: logErrorRef(err as Error) });
        return writeFailure('回滚', assetId, err);
      }
    },
  };
}

/** 资产管家工具面（US-401 的两个读工具；US-402 的 6 个写工具在本文件后续扩展）。
 *  只读会话不变量：这些工具**都不进** `runner.ts` 的闭合只读白名单——该白名单是
 *  「无副作用 actor 的最小工具集」，而资产库是用户私有全量数据，开给从属 actor
 *  属权限扩张。由 `test/main/model/core-agent/asset-steward-tools.test.ts` 钉住。 */
export function createAssetStewardTools(opts: AssetStewardToolsOpts): AgentTool[] {
  return [
    createListAbilityAssetsTool(opts),
    createReadAbilityAssetTool(opts),
    createEditAbilityAssetTool(opts),
    createMergeAbilityAssetsTool(opts),
    createStatusActionTool(opts, {
      name: 'archive_ability_asset',
      actionLabel: '归档',
      description: [
        '归档一条资产：从日常列表与推荐里移出，内容、证据与历史都保留，随时可恢复（restore_ability_asset）。',
        '适合"这条现在用不上但别删"的情况。删除（delete_ability_asset）会进保留期，比归档更重。',
      ].join(''),
      run: (userId, assetId, reason) => archiveAbilityAsset(userId, assetId, { actor: 'ai', reason }),
    }),
    createStatusActionTool(opts, {
      name: 'delete_ability_asset',
      actionLabel: '删除',
      description: [
        '删除一条资产：进入 30 天保留期（保留期内可恢复），到期系统自动彻底删除、不可恢复。',
        '**只在用户明确要求删除时用**。拿不准就用归档——归档没有不可逆的一天。',
      ].join(''),
      run: (userId, assetId, reason) => deleteAbilityAsset(userId, assetId, { actor: 'ai', reason }),
      // 保留期口径必须随回执一起给：用户此刻要知道"这东西什么时候会真的没了"。
      extra: () => [t('recall.asset.delete_confirm_rules')],
    }),
    createStatusActionTool(opts, {
      name: 'restore_ability_asset',
      actionLabel: '恢复',
      description: [
        '把一条资产放回在用：已归档的、以及已删除但仍在保留期内的都可以恢复。',
        '保留期已过或已彻底清除的会被拒绝并说明原因——那是终态，恢复不成立。',
      ].join(''),
      run: (userId, assetId, reason) => restoreAbilityAsset(userId, assetId, { actor: 'ai', reason }),
    }),
    createRollbackAbilityAssetTool(opts),
  ];
}
