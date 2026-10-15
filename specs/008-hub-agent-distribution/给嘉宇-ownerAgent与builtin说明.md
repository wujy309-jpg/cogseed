# 两件需要和 Hub 对齐的事：`ownerAgent` 约定、`builtin:` 的指向

- **收件人**：吴嘉宇（Hub）
- **发件人**：史雨萱（客户端）
- **日期**：2026-10-12
- **背景**：客户端第一阶段（不依赖 Hub 的部分）已按 v3 契约做完。做的过程中发现两处需要和 Hub 对齐，都在 Hub 开工写校验之前对一下，免得联调第一次提交就被拒。

> ## ⚠️ 阅读提示（2026-10-13 补，**正文保留原样以便追溯**）
>
> **第二节的结论已作废。** 产品于 **2026-10-13** 决定做 `builtin:`，客户端**已实现**：
>
> | 项 | 现状 |
> |---|---|
> | 客户端实现 | `src/main/features/agent_builtin_capabilities.ts`（本地镜像 Hub 清单，当前开放 3 个：`grounded-material-qa` / `kb-mindmap` / `coding`） |
> | 清单本体 | `specs/008-hub-agent-distribution/contracts/builtin-capabilities-initial-manifest.json` |
> | Hub 端点 | **`GET /marketplace/builtin-capabilities/manifest`**（本文第二节写的 `builtin-skills/manifest` 是旧路径名，已废） |
> | 归属 | 清单**成员与起始版本由产品（中扬）定**；Hub 侧改 `HUB_BUILTIN_CAPABILITY_MANIFEST` 一处即同步 |
>
> 因此**第三节第 3 问（「`builtin:` 先不做，你们同意吗？」）已由产品决定关闭**，不要再按它执行。
> 第一节（`ownerAgent` 约定）**仍然有效**，且 Hub 侧已按该口径实现并在联调中实测（不符即
> `private_skill.owner` 拒绝）。

## 一、私有 Skill 的 `ownerAgent` 怎么写

### 现状（客户端现有机制）
私有 Skill 的 `SKILL.md` 头部有 `ownerAgent: <宿主 Agent 的 id>`，只有该 Agent 解析得到这个 Skill，别的 Agent 把它当未知项。存量官方 Agent 的写法就是 `ownerAgent` 等于它自己的 id（例如目录名 `e064dca9e1bd` 的 Agent，其私有 Skill 写 `ownerAgent: e064dca9e1bd`）。

### 问题
贡献时 Hub **还没有给这个 Agent 分配 `content_id`**，包里的 `ownerAgent` 没法写最终 id。

### 客户端的做法（请确认）
1. **提交时**：副本里每个私有 Skill 的 `ownerAgent` 写**贡献者本机的 `agent_id`**，并要求包内 `agent.json` 带同一个 `agent_id`。
2. **安装时**：客户端把每个私有 Skill 的 `ownerAgent` 改写成**安装后的 Agent id**（即 Hub 的 `content_id`）。改写发生在摘要校验、解包之后，只动 `SKILL.md` 头部那一行。
3. 已一致的包（存量官方 Agent）改写是空操作。

### 需要 Hub 对齐的校验口径
你契约里写的是"每个私有 Skill 的 `ownerAgent` 必须指向本 Agent"。按上面的做法，Hub 的复核应该是：

> 包内每个私有 Skill 的 `ownerAgent` **必须等于包内 `agent.json` 的 `agent_id`**（不是等于 Hub 的 `content_id`）。

另外，**有私有 Skill 时 `agent.json` 必须带 `agent_id`**（否则无从判定）；没有私有 Skill 的 Agent 不要求。

如果你们想改成别的约定（比如发布时由 Hub 把 `ownerAgent` 改写成 `content_id`，对应 A-02 里"发布时对内容树的唯一改写是写 `_meta.json`"，这样就多了第二处改写，需要改契约），请告诉我，客户端这边只是几行的事。

### 对应的错误码
`PRIVATE_SKILL_INVALID`，`rule` 建议用：`private_skill.owner`（缺失或不等于 `agent_id`）、`private_skill.name`（目录名是 12 位十六进制）。

## 二、`builtin:<name>` 在客户端指什么

你 10-12 答复里定了 `skill_list` 三类，第二类是 `builtin:<name>`（客户端内置能力，不下载）。我核对了客户端代码，**目前没有任何机制能解析它**：

| 事实 | 出处 |
|---|---|
| Agent 的 `skill_list` 经 `resolveSkillAllowlistRefs` 只解析 Skill 注册表里的条目 | `src/main/model/core-agent/skill-registry.ts` |
| 注册表**不再加载随包内置 Skill**；系统 Skill 目录（8 个）只作为个别对话的只读额外根 | `src/main/features/skills.ts` 注释 |
| 31 个内置 Agent 的 `skill_list` 里，**没有任何一项引用系统 Skill** | 实测 |
| 随客户端预置的 Skill（58 个）本来就是 12 位十六进制的 Hub 内容，你们的 `builtinSeedIds.ts` 已经收了 | Hub `src/features/skills/builtinSeedIds.ts` |

所以**目前"内置"的东西已经被第一类（12 位十六进制）覆盖**：它们是 Hub 内容，只是随客户端预置了一份，本机有就直接复用。`builtin:<name>` 想指的"客户端内置能力"，在现在的客户端里没有对应的东西。

### 建议
1. **本期客户端不实现 `builtin:`**：提交时遇到 `builtin:` 开头的条目会被本机阻断，安装时也直接拒绝，不会尝试下载。
2. **Hub 的内置能力清单端点（`GET /marketplace/builtin-skills/manifest`）先别开工**：现在清单里没有内容可列，做了也没人读。
3. 如果产品确实要这一类，需要先定义"客户端内置能力"是什么（比如把哪几个系统 Skill 开放给 Agent 引用），那是客户端和产品的一次新决策，之后再回头定契约。

## 三、想请你给的信息
1. 上面 `ownerAgent` 的校验口径，Hub 是否按"等于 `agent.json` 的 `agent_id`"实现？
2. 提交白名单扩充（`content_type: 'agent'`、`local_agent_id`、`metadata`）和 B-01/B-02/B-05 在测试环境可用的大概时间？客户端据此安排最小联调。
3. `builtin:` 先不做，你们这边同意吗？

## 四、客户端已完成的部分（供参考）
提交前的本机处理与检查、预览、请求体组装、提交流程、"我的贡献"类型切换、安装前"将同时安装"确认、依赖规划，全部用夹具和替身验证通过，没有依赖你们的接口。联调只差真实接口。
