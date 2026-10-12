# CogSeed 本体驱动查询与 Jev 决策层设计 v3

> 状态：本地设计基线，基于私仓 `origin/develop` 提交 `460911c2`。
>
> 本方案不是把 Semantica 迁移进 CogSeed，也不要求用户安装 Semantica。CogSeed 参考 Semantica 的本体、关系图、证据和可解释推理思路，在自己的代码和数据治理边界内实现；Jev 是可选的结构化判断服务，用于候选选择、适用性判断和结果验证。

## 1. 要解决的问题

CogSeed 在用户使用过程中会沉淀能力资产、本体实体、属性和关系。之后用户提出新任务时，系统需要回答的不是单纯的“哪段文字和问题最相似”，而是：

1. 当前问题涉及哪些实体和关系？
2. 用户过去沉淀的哪些能力资产与这些实体或关系有关？
3. 哪些资产在当前任务、空间、权限和作用域下可以使用？
4. 多个候选中哪个最适合？如果都不合适，是否应该明确返回没有合适资产？
5. 使用资产后，结果是否真的完成了任务？

向量检索适合找相似文本，但不能可靠表达“谁依赖谁”“沿哪条关系跳转”“当前资产是否允许在这个空间使用”。本体查询提供结构化事实和证据路径；Jev 提供结构化判断；CogSeed 负责数据、权限和治理。

## 2. 最终目标

```text
用户任务
  -> 任务契约和查询意图
  -> 用户本体图谱 / 能力资产关系查询
  -> 候选资产集合和证据路径
  -> CogSeed 本地硬性准入检查
  -> Jev 结构化判断和评分
  -> 确定性治理检查
  -> 能力资产注入或调用
  -> Jev 结果验证
  -> 复用回执、效果反馈和后续沉淀
```

固定的是这套处理逻辑；变化的是用户在 CogSeed 中持续沉淀的数据。产品不预置具体行业事实，不把 `985/211`、员工、API 网关等例子写进生产规则。

## 3. 三个系统的职责

### 3.1 CogSeed 内置本体能力

CogSeed 自己负责：

- 用户本体的分类、实体、属性和关系存储；
- 从用户任务中提取受限的任务契约和本体锚点；
- 按关系、属性和作用域查询用户可见的动态数据；
- 进行有限多跳导航并保留证据路径；
- 将本体查询结果和语义检索结果合并为候选资产；
- 在查询和复用时执行用户、空间、Agent、来源、版本、敏感度和生命周期检查。

当前 develop 已有的相关基础包括：

- `src/main/features/ontology_graph.ts`
- `src/main/ipc/ontology-graph.ts`
- `src/main/features/recall/ontology-taxonomy.ts`
- `src/main/features/recall/ontology-rules.ts`
- `src/main/features/recall/task-contract.ts`
- `src/main/features/recall/hybrid-retrieval.ts`
- `src/main/features/recall/context-projection.ts`

### 3.2 Semantica 的定位

Semantica 是参考项目，不是 CogSeed 的运行依赖。参考内容主要包括：

- 本体的 T-Box、R-Box、A-Box 分层思路；
- 图关系导航和多跳查询；
- 实体对齐、上下文切片和证据链；
- 面向决策的可追溯上下文组织。

CogSeed 不复制 Semantica 的代码，不要求用户另外部署 Python、图数据库或 Semantica 服务。未来如果确有外部图引擎需求，只能通过 Connector 或适配器接入，不能改变 CogSeed 的基础可用性。

### 3.3 Jev 的定位

Jev 是 TypeSafe AI 的 System One Model，接收结构化 `state` 和类型化问题，返回结构化判断、概率或置信度。Jev 适合：

- 对本体召回的候选资产做适用性评分；
- 在多个候选资产中选择一个或返回 `none`；
- 判断当前任务是否满足资产的适用条件；
- 判断候选资产之间是否存在语义冲突；
- 对执行结果做质量、证据充分性和目标完成度验证。

Jev 不负责：

- 存储本体和能力资产；
- 发现 CogSeed 中不存在的事实；
- 代替关系图查询；
- 代替权限、作用域、敏感度、版本和生命周期检查；
- 直接写入用户本体或正式能力资产。

## 4. 一次请求的处理流程

### 4.1 查询和候选发现

用户提出任务后，CogSeed 生成受限任务契约：

```ts
interface RecallTaskContract {
  goal: string;
  actionType: 'analyze' | 'generate' | 'modify' | 'execute' | 'verify' | 'unknown';
  objects: string[];
  constraints: string[];
  requiredCapabilities: string[];
  ontologyAnchors: Array<{ groupId: string; field?: string; score: number }>;
}
```

然后从用户当前可见的数据中获取：

- 相关本体实体和属性；
- 能力资产的 `ontologyRefs`；
- 能力资产关系，例如 `depends_on`、`refines`、`replaces` 和 `conflicts_with`；
- 用户本体中的关系规则；
- 语义检索的候选结果。

本体结果必须带证据：实体 ID、关系 ID、关系类型、跳数、来源引用和数据版本。

### 4.2 本地硬性准入

在调用 Jev 前，CogSeed 先排除：

- 非当前用户或当前空间可见的资产；
- 非 active 资产；
- 来源不可用或版本不一致的资产；
- 作用域、Agent、敏感度策略不允许的资产；
- 被明确禁止的资产；
- 不满足安全策略的外部数据。

被排除的资产不能发送给 Jev。Jev 只看到已经通过本地硬性准入的最小候选信息。

### 4.3 Jev 判断

候选状态应尽量使用元数据和必要证据，不默认发送完整资产正文：

```json
{
  "task": {
    "goal": "排查当前项目的 API 网关认证问题",
    "actionType": "analyze",
    "constraints": ["只使用当前项目允许的资产"]
  },
  "ontology": {
    "entities": ["authentication", "api-gateway"],
    "paths": [
      "authentication -[depends_on]-> api-gateway"
    ]
  },
  "candidates": [
    {
      "id": "asset-redacted-id",
      "type": "skill_method",
      "title": "认证失败排查流程",
      "scope": "current-project",
      "applicableWhen": ["认证失败", "API 网关"],
      "ontologyEvidence": ["authentication depends_on api-gateway"]
    }
  ]
}
```

Jev 问题使用三类原语：

- `Choice`：选择最适合的资产或 `none`；
- `Score`：对适用性、相关性或结果质量评分；
- `Noul`：判断某个陈述是否成立，例如“该资产适用于当前任务”。

Jev 的结果必须经过本地 schema 校验。低置信度、`none`、冲突或服务失败都不能强行注入资产。

### 4.4 最终决定和执行

Jev 输出只是语义判断信号。CogSeed 还要再次执行确定性策略：

```text
Jev 选择候选
  -> 资产仍 active 吗？
  -> 版本仍然匹配吗？
  -> 当前作用域仍然允许吗？
  -> 来源和权限仍然有效吗？
  -> 是否需要用户确认？
  -> 通过后才创建 projection 或执行调用
```

所有选择、证据、Jev provider、模型版本、请求 ID、耗时、降级原因和最终治理结果都应写入可审计回执。

## 5. 适配器设计

CogSeed 内部使用稳定抽象，不让业务代码直接依赖 Jev SDK：

```ts
export interface DecisionEvaluationInput {
  state: Record<string, unknown>;
  questions: DecisionQuestion[];
  trace?: {
    taskId?: string;
    userId?: string;
    assetIds?: string[];
    ontologyPath?: string[];
  };
}

export interface DecisionEvaluationResult {
  answers: Array<{
    questionId: string;
    value: string | number | boolean;
    probability?: number;
    confidence?: number;
  }>;
  provider: 'jev' | 'fallback' | 'disabled';
  latencyMs: number;
  requestId?: string;
}

export interface DecisionEvaluator {
  evaluate(input: DecisionEvaluationInput): Promise<DecisionEvaluationResult>;
}
```

实现分为：

- `NoopEvaluator`：Jev 未配置或功能关闭时保持现有行为；
- `JevEvaluator`：调用真实 TypeSafe Jev API；
- `FallbackEvaluator`：Jev 超时、限流或不可用时使用现有确定性排序和治理逻辑。

Jev 配置属于用户本地配置，API Key 使用现有本地密钥存储；配置不进入 Git，不进入同步明文，不写入日志。

## 6. 阶段计划

### Phase 1：Jev 适配层

交付：HTTP/SDK 客户端、请求 schema、响应校验、超时、重试、脱敏日志、Noop 和 fallback。

验收：有 key 能调用；无 key 不影响对话；超时自动降级；不发送未授权资产。

### Phase 2：候选资产判断

交付：把本体证据和硬性准入后的候选交给 Jev，支持选择、评分和 `none`。

验收：Jev 能对候选排序；不合适时不强选；失败时保留原有混合检索行为。

### Phase 3：执行前验证

交付：在 projection 创建或能力调用前验证适用条件、冲突和是否需要确认。

验收：Jev 不能绕过本地硬门；低置信度和冲突进入人工确认或不注入。

### Phase 4：结果验证和反馈

交付：对执行结果做目标完成、证据充分性和质量判断；结果进入现有复用回执和候选沉淀流程。

验收：Jev 只产生验证信号，不直接晋升正式资产；用户反馈可追溯。

### Phase 5：真实数据评估和默认策略

交付：在同一批脱敏真实任务上比较纯语义、本体混合、本体加 Jev 三种路径。

只有当准确率、误注入率、延迟和成本都达到门槛，才考虑默认开启 Jev。

## 7. 开关和降级

建议使用用户级配置：

```json
{
  "version": 1,
  "enabled": true,
  "provider": "typesafe-jev",
  "timeoutMs": 5000,
  "maxCandidates": 8,
  "minConfidence": 0.7,
  "stages": {
    "candidateSelection": true,
    "preInjectionValidation": false,
    "resultValidation": false
  },
  "fallback": "existing-ranking"
}
```

默认策略：

- 未配置 Jev：不调用，继续现有本体和语义检索；
- 已配置但阶段未开启：不调用；
- Jev 超时、限流或返回非法结果：记录降级原因，使用现有逻辑；
- 高风险、跨作用域和敏感资产：不能只凭 Jev 自动通过。

## 8. 这个东西到底有什么用

它不是为了让 CogSeed “多装一个产品”，也不是为了把普通文档搜索改成复杂图数据库。它解决的是能力复用中的三类问题：

### 8.1 找得更准

普通搜索看到的是文字相似；本体查询看到的是用户已经沉淀的实体和关系。例如用户问“哪些能力依赖 API 网关”，系统查的是 `depends_on` 关系，而不是所有提到“API 网关”的文档。

### 8.2 用得更稳

本体能找到候选，但不一定能判断当前场景是否适用。Jev 可以对候选做结构化判断；CogSeed 再执行权限和作用域检查，减少“找到了但不该用”的情况。

### 8.3 说得清楚、能追溯

结果可以解释为：

```text
因为实体 A 通过关系 R 连接到实体 B，且资产 X 引用了该关系；
资产 X 通过当前作用域检查，并被 Jev 判断为适合当前任务；
因此注入资产 X。
```

这比只返回一个向量相似度或模型自由发挥的理由更容易验证、复盘和修正。

## 9. 当前真实状态

截至本设计基线，CogSeed 已有本体图谱、个人本体、R-Box 规则、任务契约、混合资产检索和投影准入基础；当前仍是“本体驱动能力复用基础/MVP”。

尚未完成：

1. 通用自然语言 `ontology_query` 工具入口；
2. 从本体图谱直接做通用多跳查询和证据路径输出；
3. 完整的候选查询、Jev 判断、注入、执行反馈闭环；
4. Jev 真实 API 适配器；
5. 基于真实用户数据的三路对照评估。

因此当前应对外表述为：

> CogSeed 已完成参考 Semantica 思路的本体和能力资产复用基础，正在规划把 Jev 接入候选判断与结果验证层；尚未完成最终生产闭环。
