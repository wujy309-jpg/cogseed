import { createLogger } from '../../logger';
import { logErrorRef, maskId } from '../../util/log-redact';
import { rankAssets, type RankedAsset, type RankingSceneContext, type RankingWeights } from './asset-ranking';
import {
  catalogRelevanceScores,
  formatCatalogEntries,
  loadAssetAdoptionStatsCached,
  loadAssetUsageStatsCached,
  type AssetAdoptionStat,
  type AssetUsageStat,
} from './asset-catalog';

const log = createLogger('recall.catalog-hint');

/**
 * 资产目录进入提示词的两条路（2026-09-18，可发现性）。
 *
 * 为什么需要：注入解决的是"这一轮相关"，但模型不会主动想到"这个用户还有别的
 * 资产可以看"——真机行为样本（3 类任务、不加任何提示）0/3 会去查目录；把工具
 * 描述写得更明确后升到 1/3；样本里的任务都已被注入命中，模型更没有动机再去找。
 * 结论：**别指望模型主动调工具，把目录直接放进它眼前**。
 *
 * 成本（小库）：8 条 ≈ 1KB，相对注入块 14,000 字上限可忽略；比"多一次工具往返"
 * 更便宜，也更可能真的被用上。库大了就退回一行提示 + 工具，避免提示词被目录撑爆。
 *
 * 缓存：目录文本与条数按用户 60 秒 TTL——内容变化不需要秒级反映，而每回合重扫
 * 资产目录 + 使用流水是纯浪费。
 */
const CACHE_TTL_MS = 60_000;
/** 常驻提示词的目录上限：超过就只给一行提示（30 × ~110 字符 ≈ 3.3KB）。 */
export const INLINE_CATALOG_MAX_ENTRIES = 30;

interface CatalogPromptCache {
  userId: string;
  cid: string;
  at: number;
  count: number;
  text: string;
}
let cache: CatalogPromptCache | null = null;

/** 当轮 ranked 视图（specs/012 T019）：buildCatalogPrompt 里 rankAssets 的
 *  那一份拆解，按目录缓存的**同键**（userId + cid）记住最近一次构建——
 *  注入回执写侧（bus.ts 的 projection 通道 / recall-tools 的 agent_read
 *  通道）从这里查当轮拆解，**不在写侧重算**（排序唯一处 II2 的自然推论：
 *  解释也只出自那一次构建，两处同序才可对账）。会话归属对不上（没建过
 *  目录 / 别的会话）→ 空 Map，写侧省略 ranking，读取侧按 explainable:false
 *  如实说「没有记录」。 */
interface CatalogRankedView {
  userId: string;
  cid: string;
  byId: ReadonlyMap<string, RankedAsset>;
}
let lastRanked: CatalogRankedView | null = null;

export function resetAssetCatalogHintCacheForTest(): void {
  cache = null;
  lastRanked = null;
}

/** 当轮 ranked 视图访问器（T019）：键与目录文本缓存一致（userId + cid，
 *  会话级）；每个会话目录构建都刷新它，所以「最近一次」就是当轮 commander
 *  建目录的那一次。查不到返回空 Map（写侧据此不带 ranking，不编造）。 */
export function lastCatalogRankedForTurn(userId: string, cid: string): ReadonlyMap<string, RankedAsset> {
  if (!lastRanked || lastRanked.userId !== userId || lastRanked.cid !== cid) return new Map();
  return lastRanked.byId;
}

/**
 * 跨会话复用提示（2026-09-18）：模型自选挂在单会话上——换会话就不再生效。与其
 * 让宿主偷偷继承（会在无关会话里冒出你没要的资产），不如把"上次挂过这些"说给
 * 模型听，由它决定要不要再挂一次（挂上你依然会看到卡、随时可撤销）。
 */
async function recentAttachmentLine(userId: string, cid: string): Promise<string> {
  if (!cid) return '';
  try {
    const { listContextProjections } = await import('./context-projection');
    const projections = await listContextProjections(userId, { status: 'confirmed', limit: 50 });
    const others = projections.filter((item) => item.authorization === 'model_selected' && item.conversationId && item.conversationId !== cid);
    if (!others.length) return '';
    const newest = others.sort((left, right) => String(right.decidedAt || right.createdAt || '').localeCompare(String(left.decidedAt || left.createdAt || '')))[0];
    const ids = newest.assetIds.slice(0, 6);
    if (!ids.length) return '';
    const titles: string[] = [];
    for (const assetId of ids) {
      try {
        const { readAbilityAsset } = await import('./asset-service');
        const asset = await readAbilityAsset(userId, assetId);
        if (asset) titles.push(String(asset.title || assetId).slice(0, 24));
      } catch {
        // 读不到就跳过（只影响提示文案）。
      }
    }
    if (!titles.length) return '';
    return [
      `Recently attached in another conversation: ${titles.join('、')}.`,
      'If this task needs them too, attach them again with attach_assets_to_task (the user sees a revocable card).',
    ].join(' ');
  } catch {
    return '';
  }
}

/** 当轮相关度（2026-09-22 砍注入后的算法落点）：拿当轮任务文本与资产算
 *  余弦，相关 ≥0.40 标 ★、相关分参与排序——只当参谋帮模型定位，不注入正文。
 *  embedding 不可用回退纯使用次数排序（目录本身不受影响）。
 *  2026-09-25（specs/012 T018）实现挪到 asset-catalog 的 catalogRelevanceScores
 *  （提示词目录与工具目录共用同一份，两处同序的前提），本文件只保留 ★ 阈值。 */
const CATALOG_RELEVANT_MARK = 0.40;

/** 权重快照的安全读法（specs/012 T016）：每次目录构建读一次（无进程内长缓存，
 *  改配置下一轮目录即生效）；盘上非法时 getRankingWeights 自己返回
 *  invalid-fallback + 默认值——这里只兜"读盘本身抛错"（权限/IO），降级用默认，
 *  目录不能因为权重读不到而整个消失。 */
async function loadRankingWeightsSafe(userId: string): Promise<{
  weights: RankingWeights;
  source: 'configured' | 'default' | 'invalid-fallback';
}> {
  const { DEFAULT_RANKING_WEIGHTS, getRankingWeights } = await import('./catalog-ranking-weights');
  try {
    return await getRankingWeights(userId);
  } catch {
    return { weights: { ...DEFAULT_RANKING_WEIGHTS }, source: 'default' };
  }
}

async function buildCatalogPrompt(
  userId: string,
  cid: string,
  taskText = '',
  scene?: RankingSceneContext,
): Promise<{ count: number; text: string; relevantIds: Set<string> }> {
  const { listAbilityAssets } = await import('./asset-service');
  const assets = await listAbilityAssets(userId);
  const active = assets.filter((asset) => asset.status === 'active');
  if (!active.length) return { count: 0, text: '', relevantIds: new Set<string>() };
  let stats = new Map<string, AssetUsageStat>();
  try {
    stats = await loadAssetUsageStatsCached(userId);
  } catch {
    // 使用次数拿不到不影响目录本身。
  }
  // 采用统计（T016 换口径）：排序的使用因子 = 实际采用次数（applied 回执），
  // 与上面 stats（被带入次数，目录行「用N次」的呈现口径）分开各数各的。
  let adoption = new Map<string, AssetAdoptionStat>();
  try {
    adoption = await loadAssetAdoptionStatsCached(userId);
  } catch {
    // 采用统计拿不到 = 该因子按 0 次参与（0 是真实信号），目录本身不受影响。
  }
  const total = active.length;
  // 当轮相关度（有任务文本才算）：★ 标记 + relevance 因子输入。
  const relevance = taskText ? await catalogRelevanceScores(userId, taskText, active) : new Map<string, number>();
  const relevantIds = new Set([...relevance.entries()].filter(([, score]) => score >= CATALOG_RELEVANT_MARK).map(([id]) => id));
  // 推荐排序唯一处（specs/012 US-202，T016：原内联 sort 已删）：本文件与
  // recall-tools.runCatalog 共调 rankAssets 的同一推荐分，顺序不允许出现第二份
  // 实现。只排不裁：rankAssets 输出条数 = 输入条数，这里按其顺序重建资产数组，
  // 集合逐条不变；tags 不进输入类型（标签只影响筛选不影响排序，编译期保证）。
  const weightsSnapshot = await loadRankingWeightsSafe(userId);
  const byId = new Map(active.map((asset) => [asset.id, asset] as const));
  const ranked = rankAssets({
    assets: active.map((asset) => ({
      id: asset.id,
      maturity: asset.maturity,
      updatedAt: asset.updatedAt,
      ...(asset.spaceId ? { spaceId: asset.spaceId } : {}),
      ...(asset.scopePolicy ? { scopePolicy: asset.scopePolicy } : {}),
    })),
    relevance,
    adoptionStats: adoption,
    ...(scene ? { scene } : {}),
    weights: weightsSnapshot.weights,
    weightsSource: weightsSnapshot.source,
  });
  // 当轮 ranked 视图记档（T019）：同键同时刻，供回执写侧查表（只透出不重算）。
  lastRanked = { userId, cid, byId: new Map(ranked.map((row) => [row.assetId, row] as const)) };
  const sorted = ranked
    .map((row) => byId.get(row.assetId))
    .filter((asset): asset is (typeof active)[number] => Boolean(asset));
  const inline = total > INLINE_CATALOG_MAX_ENTRIES ? sorted.slice(0, 20) : sorted;
  const lines = formatCatalogEntries(inline, stats, 1, relevantIds);
  const more = total - inline.length;
  const marked = relevantIds.size;
  return {
    count: total,
    relevantIds,
    text: [
      `Asset catalog (${total} reusable assets${marked ? `, ${marked} look relevant to this turn (★)` : ''}; one compact line each — pull the full text with`,
      'search_ability_assets + assetIds when one fits, and attach_assets_to_task to keep using it):',
      ...lines,
      ...(more > 0
        ? [`…还有 ${more} 条：可用 search_ability_assets 带 query 语义检索（比翻页快），或不带参数（可带 offset）翻页查看更多。`]
        : []),
    ].join('\n'),
  };
}

/** 目录文本（带 60 秒 TTL 缓存）；读不到或没有资产时返回空串。
 *  taskText 非空时按当轮相关度排序＋★标记，**不落缓存**（任务文本每轮变，
 *  缓存住相关排序等于把上一轮的判断塞给下一轮）。
 *  scene（T017）＝会话的项目/空间归属：会话级冻结（项目成员在会话创建时定死，
 *  与缓存键 cid 一一对应），所以进 60 秒缓存是安全的；两者都缺省时该因子
 *  整体缺席（≠0 分，排序行为接近现状）。 */
export async function assetCatalogForPrompt(userId: string, cid = '', now = Date.now(), taskText = '', scene?: RankingSceneContext): Promise<string> {
  return (await assetCatalogForPromptWithRelevance(userId, cid, now, taskText, scene)).text;
}

/** 带当轮★集合的目录构建（2026-09-19 漏取审计）：text 同上，relevantIds 供
 *  回合收尾计算"标了★但没被用"的差集（缓存路径返回空集合——缓存本就不含
 *  相关排序）。 */
export async function assetCatalogForPromptWithRelevance(
  userId: string, cid = '', now = Date.now(), taskText = '', scene?: RankingSceneContext,
): Promise<{ text: string; relevantIds: Set<string> }> {
  if (!taskText && cache && cache.userId === userId && cache.cid === cid && now - cache.at < CACHE_TTL_MS) {
    return { text: cache.text, relevantIds: new Set<string>() };
  }
  try {
    const built = await buildCatalogPrompt(userId, cid, taskText, scene);
    const reuse = await recentAttachmentLine(userId, cid);
    const text = [built.text, reuse].filter(Boolean).join('\n\n');
    if (!taskText) cache = { userId, cid, at: now, count: built.count, text };
    return { text, relevantIds: taskText ? built.relevantIds : new Set<string>() };
  } catch (error) {
    // 读不到就什么都不加（而不是加一句"0 条"——那会让模型以为用户没有资产）。
    log.warn('asset catalog prompt unavailable', { userId: maskId(userId), error: logErrorRef(error as Error) });
    return { text: '', relevantIds: new Set<string>() };
  }
}
