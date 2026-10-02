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

/** 每个家固定落到哪个候选池（两池互斥）。 */
export const POOL_BY_HOME: Record<ContentHome, CandidatePool> = {
  personal_fact: 'ontology',
  rule: 'recall',
  template: 'recall',
  method: 'recall',
  task_local: 'task_local',
  experience: 'experience',
};

/** 家的定义：既是判定 prompt 的判据，也是界面文案的唯一来源。 */
export interface HomeDefinition {
  home: ContentHome;
  label: string;
  /** 判据（写给模型看，也写给用户看）。 */
  definition: string;
  /** 边界样例：帮模型把相邻的家分开。 */
  examples: readonly string[];
}

export const HOME_DEFINITIONS: readonly HomeDefinition[] = [
  {
    home: 'personal_fact',
    label: '关于我',
    definition: '关于用户本人的、跨任务长期成立的短句事实（身份、归属、联系方式、稳定偏好与边界）。',
    examples: ['我在开源项目组', '我的银行卡号是…', '我回复偏好用简短中文'],
  },
  {
    home: 'rule',
    label: '规则',
    definition: '带适用/禁止边界的判断、约束或做法；被违反时应当能指出"违反了哪一条"。',
    examples: ['对外报价不要承诺交期', '报销住宿按城市封顶'],
  },
  {
    home: 'template',
    label: '模板',
    definition: '可复用的结构、检查表、范例（填进去就能用的骨架）。',
    examples: ['周报按进展/风险/下周计划三段写'],
  },
  {
    home: 'method',
    label: '方法',
    definition: '有目标、步骤与适用范围的可执行做法（"怎么做"的一套流程）。',
    examples: ['整理材料五步法：先分类→合并→标注→复核→输出清单'],
  },
  {
    home: 'task_local',
    label: '任务/项目事实',
    definition: '只对当前项目、任务或协作关系成立的临时事实；会过期，**不进长期档案**。',
    examples: ['本周上线支付网关', '这个项目由张三对接'],
  },
  {
    home: 'experience',
    label: '经验',
    definition: '某一次任务的情境、结果与教训（复盘所得，不是可复用规则本身）。',
    examples: ['上次那张发票被退回，因为抬头写成了简称'],
  },
];

/** 对外可读的路由表（文档/界面/日志共用一份，避免三处漂移）。 */
export const CONTENT_ROUTE_TABLE: ReadonlyArray<{ home: ContentHome; pool: CandidatePool; label: string }> =
  HOME_DEFINITIONS.map((entry) => ({ home: entry.home, pool: POOL_BY_HOME[entry.home], label: entry.label }));

/** 判定不出来的合法出口：不猜、不进任何家（未分类待整理）。 */
export const UNCLASSIFIED = 'unclassified' as const;
