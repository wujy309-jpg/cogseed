/**
 * cognition_kernel/routing — 归属的**契约**（2026-10-02 改版）。
 *
 * 本文件只有「家」的定义与「家 → 候选池」的映射，**不含任何判定规则**：
 *   · 判定主体：judge.ts（大模型按本体规则判定 + 三档门控）
 *   · 规则数据：routing_rules.ts（用户自己的归属规则与纠正样例，可改可版本化）
 *
 * 改版理由（子安 2026-10-02 判定）：旧版把归属写死成一张 TS 类型映射表 + 兜底
 * 启发式，既违反从参考实现提炼的第一条原则「规则即数据 + 分层权威，禁止把业务
 * 规则写进代码」，也完全不读用户本体——有本体不用本体，等于白建。
 */

import type { CandidatePool, ContentHome } from './types';
import { DEFAULT_HOME_REGISTRY, type HomeRegistryEntry } from './object-model';

/** 每个家固定落到哪个候选池（两池互斥）——派生自家注册表数据（S3-b 数据化）。 */
export const POOL_BY_HOME: Record<ContentHome, CandidatePool> = Object.fromEntries(
  DEFAULT_HOME_REGISTRY.map((entry) => [entry.home, entry.pool]),
) as Record<ContentHome, CandidatePool>;

/** 家的定义：既是判定 prompt 的判据，也是界面文案的唯一来源。 */
export interface HomeDefinition {
  home: ContentHome;
  label: string;
  /** 判据（写给模型看，也写给用户看）。 */
  definition: string;
  /** 边界样例：帮模型把相邻的家分开。 */
  examples: readonly string[];
}

/** 内置家的定义 = 出厂注册表（数据在 object-model.DEFAULT_HOME_REGISTRY；本导出保留兼容）。 */
export const HOME_DEFINITIONS: readonly HomeDefinition[] = DEFAULT_HOME_REGISTRY.map((entry) => ({
  home: entry.home as ContentHome,
  label: entry.label,
  definition: entry.definition,
  examples: entry.examples,
}));

export type { HomeRegistryEntry };

/** 对外可读的路由表（文档/界面/日志共用一份，避免三处漂移）。 */
export const CONTENT_ROUTE_TABLE: ReadonlyArray<{ home: ContentHome; pool: CandidatePool; label: string }> =
  HOME_DEFINITIONS.map((entry) => ({ home: entry.home, pool: POOL_BY_HOME[entry.home], label: entry.label }));

/** 判定不出来的合法出口：不猜、不进任何家（未分类待整理）。 */
export const UNCLASSIFIED = 'unclassified' as const;
