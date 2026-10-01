# Semantica 本地融合基线

本文档记录本次把本体驱动查询方案迁移到私仓最新 `origin/develop` 的本地基线。

## 基线

- 代码基线：`origin/develop`，提交 `460911c2`
- 本地工作分支：`semantica-migration`
- 远程操作：未 push
- 真实用户本体、能力资产和运行时数据：不纳入代码仓库

## develop 已有的可复用实现

最新 develop 已经提供了本体和能力资产复用的基础，不需要从旧分支整套覆盖：

- `src/main/features/ontology_graph.ts`：用户本体图谱的分类、实体和关系存储
- `src/main/ipc/ontology-graph.ts`：本体图谱 IPC 边界
- `src/main/features/personal_ontology_*`：个人本体数据和模板管理
- `src/main/features/recall/ontology-taxonomy.ts`：T-Box 词汇读取
- `src/main/features/recall/ontology-rules.ts`：R-Box 关系规则读取
- `src/main/features/recall/task-contract.ts`：从任务文本构造受限查询契约
- `src/main/features/recall/hybrid-retrieval.ts`：本体路由与语义路由合并
- `src/main/features/recall/context-projection.ts`：候选资产的准入和投影
- `src/main/model/core-agent/personal-ontology-tools.ts`：只读本体图谱工具

这些模块共同构成目前的“本体驱动能力复用基础”。它们读取用户运行时沉淀的数据，不内置 `985/211`、员工或 API 网关等业务事实。

## 本次迁移的内容

迁入本目录的两个文件是方案和验证材料：

- `ontology-driven-query-design-v2.zh-CN.md`
- `ontology-query-validation-plan.zh-CN.md`

它们是设计和测试参考，不代表所有设计中的 `ontology_query` 主入口已经存在于当前代码中。

## 当前明确未完成的部分

以下能力仍属于后续实现，不应在汇报中表述为已完成：

1. 面向通用自然语言查询的独立 `ontology_query` 工具入口。
2. 从用户本体图谱实体和关系直接生成多跳查询结果与证据路径。
3. 把本体查询结果完整接入能力资产候选排序、注入和执行反馈闭环。
4. 基于真实用户数据的 `kb_search`、本体查询和混合模式对照评估。
5. Jev 的候选判断和结果验证适配器。

## 融合原则

- 以最新 develop 的数据模型和治理边界为准，不覆盖其已有实现。
- 先通过本地测试验证，再决定是否提交或推送。
- 不把本地真实资产和本体数据复制进 Git。
- 新增查询入口时，应复用现有用户身份、作用域、资产版本和投影准入逻辑。
- Jev 只能作为后续决策评估器，不能替代本体图谱和 CogSeed 的权限治理。
