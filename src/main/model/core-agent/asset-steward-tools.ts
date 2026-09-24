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
import { listAbilityAssets, readAbilityAsset } from '../../features/recall/asset-service';
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

/** 资产管家工具面（US-401 的两个读工具；US-402 的 6 个写工具在本文件后续扩展）。
 *
 *  只读会话不变量：这些工具**都不进** `runner.ts` 的闭合只读白名单——该白名单是
 *  「无副作用 actor 的最小工具集」，而资产库是用户私有全量数据，开给从属 actor
 *  属权限扩张。由 `test/main/model/core-agent/asset-steward-tools.test.ts` 钉住。 */
export function createAssetStewardTools(opts: AssetStewardToolsOpts): AgentTool[] {
  return [
    createListAbilityAssetsTool(opts),
    createReadAbilityAssetTool(opts),
  ];
}
