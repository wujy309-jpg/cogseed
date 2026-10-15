# 多 Agent 协作内核 — 设计方案（补齐 PRD v2.4 剩余条款）

对象：PRD v2.4 中尚未落地的 US3-03/04、FR-017～020、EC-07。
前置：选择/配置/提交层已交付（见 `docs/multi-agent-select-status-20260920.md`）。
本文件只描述设计与落地顺序，不含实现；实现需按本文评审后开工。

> **状态：定稿（2026-09-20）** — 5 项产品决策已确认，见 §14 决策记录。
>
> 本文引用的每个落点都在当前分支上核对过存在：
> `composeLlmTurnPayload` / `prepareNestedDispatchForTool`（`bus.ts`）、
> `busIsQuiescent` / `reviewCollaborationGate` / `dashboard-retry-claims`（`group_chat/index.ts`）、
> `buildSwitchedAgentContextDigest`（`context_handoff.ts`）、`onTurnFinished`（`plan_executor.ts`）、
> `readCollaborationSnapshot`（`collaboration.ts`）、`fileEditLock`（`util/locks.ts`）。
> 新增 prompt 文件需遵守仓库既有约定：静态规则在前，运行期字段集中在末尾
> `## Runtime injection` 段（既有 `chat_agent_in_group.md` / `chat_agent_setup*.md` 同款）。

## 1. 目标与非目标

### 目标

1. 用户多选出来的**会话成员 + 本条点名**真正决定这次协作的范围与执行者，而不只是被记录。
2. 一次提交产生**一个可辨认的协作运行（run）**：成员、配置、分工、结果都挂在这个 run 上，
   后续修改成员/配置不影响已提交的 run（FR-014/016）。
3. 有顺序依赖的分工能交接（US3-03），最终交付要能回答"谁做了什么、谁没做完、为什么"（FR-018）。
4. 停止与重试作用于**本次 run**，重试不重复已完成副作用、不绕过被拒绝的审批（FR-019/020）。
5. 提交具备幂等性：响应丢失时确认原提交，而不是新建一次运行（EC-07）。

### 非目标

- 不重写调度内核。依赖/审批/重试沿用既有 `collaboration.ts` 的 WorkflowRun 引擎。
- 不引入新的 LLM 调用通道、不改 CLI/MCP 的 spawn 约束、不新增 npm 依赖。
- 不改 `state.json` 的 `GroupStatus`（`idle|running|aborted`）语义——它被既有 gate 依赖；
  更细的状态是**派生视图**，不是新持久状态。

## 2. 现状与缺口（带落点）

| 能力 | 现状 | 缺口 |
| --- | --- | --- |
| 运行身份 | `state.taskRun.taskRunId` 仅内存（`bus.ts:1433`、`2475-2500`）；耐久 `WorkflowRun` 只在 commander 嵌套派发时懒建（`bus.ts:8061`、`collaboration.ts:495-566`） | 用户直接多选提交没有 run id，无法把多次 actor turn 归到一次提交 |
| 成员范围 | `GroupMessage.member_snapshot` 已落盘（本轮新增）；`members.json` 只增不减、无配置 | 范围没有进入任何 actor 的 LLM 输入 |
| 派发 | `forceTo: string[]` 支持多收件人（`bus.ts:2368`）；点名已走 `forceTo` | 多成员且无点名时完全交给 commander 自由发挥，范围信息缺失 |
| 状态 | `GroupStatus` 三态 + `GroupEvent` 联合（`bus.ts:1176-1252`：`state_changed.active_turns`、`agent_run_result`、`wake_request`、`aborted`、`turn_silent`）+ `runtimeStatus.collaboration` 快照（`index.ts:205-245`） | 没有"等待前序/等待用户/等待审批/完成/失败/停止"的统一词表 |
| 汇总 | 无 | 最终交付不核对被点名成员是否有贡献或阻塞说明 |
| 停止 | `groupChat.abort` 会话级（`bus.ts:11948`，清队列+abort 全部 worker+模型会话） | 停止后 plan 步骤可能被后续消息恢复 |
| 重试 | `retryFailedTurn`（`index.ts:1246-1527`）+ claim 文件（`dashboard-retry-claims/<requestId>.json`）+ `_processHasCompletedOrStartedTool` 门（`index.ts:1099`）+ `retry_resume.ts` | 只有单消息/单步重试，没有 run 级"只重失败成员" |
| 提交幂等 | 无 | 响应丢失会新建一次运行 |

## 3. 总体设计：以 run 为中心

```
用户提交 ──(submit_request_id 幂等)──► groupChat.send
   │  members/mentions/configs 校验（已有）
   ├─ 建 RunRecord（耐久）  runs/<runId>.json
   ├─ 冻结 scope：members / mentions / source configs
   └─ enqueue(from=user, runId, forceTo=mentions|null)
           │
           ├─ 每个收件人 QueueItem.runId = runId（本轮已按来源配好 execConfig）
           ├─ actor 回合结束 → 消息记录 run_id + outcome
           └─ run 静默（无在途 turn + 队列空）→ 落 summary + 发 run_summary 事件
```

**RunRecord（耐久，`<groupDir>/runs/<runId>.json`）**

```jsonc
{
  "version": 1,
  "run_id": "run_xxx",
  "cid": "...",
  "created_at": "ISO",
  "submit_request_id": "req_xxx",        // 幂等键，见 §7
  "submitted_text": "...",               // 原文（含点名标记）
  "member_agent_ids": ["agent-codex-1", "agent-task-2"],
  "mention_agent_ids": ["agent-codex-1"],
  "mention_order": ["agent-codex-1", "agent-task-2"],   // 依赖方向依据（正文出现顺序）
  "requires_sequential": false,                        // 顺序意图强约束（§4.4）
  "corrections": 0,                                    // 已发生的纠正轮数（上限 1）
  "external_agent_ids": ["agent-codex-1"],// 来源分类，供配置/权限判定
  "source_configs": { "internal": {...}, "agent-codex-1": {...} },
  "actors": [
    { "agent_id": "agent-codex-1", "dispatched": ["turn_1"],
      "attempts": 1, "terminal": "done|failed|blocked|stopped|removed|pending",
      "produced": { "messages": 2, "artifacts": ["a1"] } }
  ],
  "status": "running|completed|failed|stopped",
  "summary": { "contributed": [...], "missing": [{ "agent_id": "...", "reason": "no_terminal|blocked_by_gate|stopped" }] }
}
```

约束：
- **目录扫描**，不做聚合索引（AGENTS.md）。
- 每个 run 一个文件；写入用既有 `fileEditLock` 串行化。
- 只放 id/枚举/计数，不放正文摘要（正文已在消息里）。

## 4. US3-03 / FR-017：范围进入协作

### 4.1 冻结与派发

1. `groupChat.send` 校验通过后创建 RunRecord（`member_snapshot` 缺省也要建：默认 CogSeed 接收也是一次 run，只是成员为空）。
2. `enqueue` 参数增加 `runId`；派发循环把 `runId` 写进每个 `QueueItem`（与 `execConfig` 同一层）。
3. actor 回合结束写消息时记录 `run_id`（与既有 `turn_id`/`exec_meta` 同风格，落在 `GroupMessage`）。
4. 点名非空时 `forceTo = mention_agent_ids`（已有）；点名与成员并存时，成员只作为**范围**，不扩大本条执行者。

### 4.2 上下文注入（关键）

新增 prompt 源 `src/main/prompts/member_scope.md`（静态规则；运行期字段放末尾 `## Runtime injection` 段，遵守 AGENTS.md 的 prompt 约束），在
`composeLlmTurnPayload(uid, fromActorId, msg)`（`bus.ts:3659`）之后追加作用域块：

| 收件人 | 注入内容 |
| --- | --- |
| commander（`fromKind==='user'` 且本条无点名或多成员） | 完整块：成员名单（可协作范围）、本条点名（必须执行者）、要求（点名成员必须有贡献或阻塞说明；顺序意图必须用**带依赖的派发**；最终交付要汇总贡献与未完成范围） |
| 内进程成员（被点名） | 一行：本条点名对象是你；给出结果或阻塞原因 |
| 外接实例（cli / p3394-gateway） | **不注入成员名单，也看不到其他成员的存在**（已定；FR-021 不扩大成员可见范围），只保留既有信封 |

配套：`dispatch_to` 的 schema（`bus.ts:10971-11022`）保持"由模型决定"，但块内文案是**硬性要求**：
有顺序意图时必须建立依赖步骤，且**该要求会被主机侧校验**（见 §4.4）。依赖仍复用既有
`prepareNestedDispatchForTool` → WorkflowRun（依赖/审批/重试）链路，不新增调度器。

### 4.3 交接

- **模型内进程成员之间**：沿用 `context_handoff.ts::buildSwitchedAgentContextDigest`（已有）；当消费者步骤声明依赖生产者时，把生产者的结果摘要注入消费者回合（现有嵌套派发行为）。
- **并行成员**（`forceTo` 多收件人、无依赖）：各自拿同一条用户消息，互不注入对方结果——符合 FR-017"独立工作可并行"。
- 明确写入设计约定：`to[]` 的顺序不代表执行顺序。

### 4.4 顺序意图的强约束（已定：强约束，非提示）

用户在正文里明确表达顺序（"先…再…"、"然后"、"之后"、"第一步…第二步"、"最后"）时，
本条**必须**形成依赖链；只在提示词里写要求不算强约束，必须有主机侧校验与纠正。

**判定**
1. 提交时由确定性检测器给出 `requires_sequential`（正则 + 顺序连接词，落点与既有
   `_HANDOFF_INTENT_RE`（`conversation.js`）同风格；**只做保守命中**，宁可不判也不误判）。
2. 命中后写进 RunRecord（`requires_sequential: true`），并在会话里以一行提示告知用户
   "本条按顺序协作：A → B"（用户可见，可据此改措辞取消）。
3. 检测器是纯函数 → 可单测（接受/拒绝两类语料，含"先方案后验证"这类无连接词的并列写法）。

**顺序来源**：依赖链的先后必须**沿用点名在正文中出现的顺序**（RunRecord 记 `mention_order`），
不得由模型自行调换；未点名成员不进入依赖链。

**校验与纠正（关键）** —— 已实现（2026-09-20）：
`member_scope.ts::verifySequentialPlan` 纯函数判定（缺成员 / 缺依赖 / 方向相反 / 成环），
闸门接在 `bus.ts::startPreparedNestedDispatchForTool`（依赖步骤真正启动前）：
不满足 → **不启动该步骤** + 返回 `sequential_not_established` 工具结果（即纠正输入）+
`run.corrections += 1`；第二次仍不满足 → run 标 `blocked`、`summary.missing.reason = sequential_not_established`。
仅当 `state.memberRunId`（本条提交的 run）且 `requires_sequential` 时生效，其它路径零影响。


1. 校验时机：commander 完成本条派发规划后、第二个及以后的依赖步骤真正启动前。
2. 校验内容：`requires_sequential === true` 时，被点名成员之间必须存在**覆盖全部点名成员**的
   依赖边（DAG 连通且无环），且依赖方向与 `mention_order` 一致。
3. 违反处理：**不启动后续步骤**，向 commander 追加一轮纠正输入（"必须为以下成员建立依赖步骤：
   A → B；不得并行派发"），并把该轮记为 `correction`（在 RunRecord 里可见）。
4. 纠正次数上限 **1 轮**：仍不满足 → run 标 `blocked`，`summary.missing` 给出原因
   `sequential_not_established`，交回用户（绝不静默降级为并行执行，对齐 FR-015 的"不静默降级"）。
5. 未命中 `requires_sequential` 时不做任何校验：多成员仍按 §4.3 并行，保持现状。

## 5. FR-018：状态词表与交付核对

### 5.1 状态词表（派生，不新增持久状态）

在渲染层新增纯函数 `deriveMemberWorkState({ actorEvents, activeTurns, gates, wakeRequests, plan, abortedRunIds })`
→ `waiting | running | waiting_dependency | waiting_user | waiting_approval | done | failed | stopped`。

| 目标状态 | 判定来源 |
| --- | --- |
| `waiting` | 已派发但尚无 turn 开始（`state_changed.active_turns` 无该 actor） |
| `running` | `active_turns` 含该 actor 的 turn |
| `waiting_dependency` | `runtimeStatus.collaboration` 快照里该 actor 的步骤依赖未满足 |
| `waiting_user` | 该 actor 有 `turn_silent` / plan 等待用户输入（`active_recipient` 指向用户侧） |
| `waiting_approval` | `pendingWakeRequests` 或 collaboration gate 处于待审 |
| `done` / `failed` | `agent_run_result` 终态 |
| `stopped` | run 被 abort（`aborted_run_ids` 含本 run） |

纯函数 + 事件回放 → 可用既有 `chat_events` 投影测试，无需真实模型。

### 5.2 贡献台账与最终交付

1. RunRecord 的 `actors[].terminal` 在回合终态时更新（`agent_run_result` / abort / gate 拒绝）。
2. run 静默判定：该 run 无在途 turn 且相关队列为空（既有 `busIsQuiescent` 同源），落 `summary`：
   - `contributed`：有终态 `done` 且至少产生一条回复/产物的成员；
   - `missing`：被派发但无终态，或终态为 `failed|blocked|stopped`，附 `reason`。
3. 若 `missing` 非空：**不得**把 run 标为 `completed`；向 commander 追加一轮核对输入
   （"以下被点名成员尚无贡献：X（原因）；请在最终交付中说明阻塞或补齐"），并把 `summary` 挂到最终消息的 meta。
4. 渲染（已定：选项 A — 会话内）：在最终消息下方展示"本次参与 / 未完成范围"，
   逐成员给出状态与原因（复用 run-center 既有状态样式，不新造视觉体系）。
   Run Center 详情作为后续增强，本期不做 run 列表页。
5. 规则落地：**调用成功 ≠ 任务完成**——只有 `missing` 为空才允许 `completed`。
6. **重跑入口（已定：选项 1）**：`missing` 非空时，汇总块内提供「只重未完成成员」按钮：
   - 只对 `failed / blocked / stopped / removed` 的成员发起重试，**绝不重跑 `done`**（不重复副作用）；
   - 走 §6.2 的 run 级重试（`groupChat.retryRun`），按钮上标明范围（"重跑 2 位未完成成员"）；
   - `missing` 为空时按钮不渲染（不出现可点的空动作）；
   - 被拒绝的审批仍不可绕过：这类成员的重试由 P3 直接拒绝并提示原因。

## 6. FR-019/020：停止与重试的 run 范围

### 6.1 停止

- `groupChat.abort` 增加可选 `run_id`：不传＝会话级（现状，保持兼容）；传＝只停该 run 的执行与后续步骤。
- `state.json` 增加 `aborted_run_ids: string[]`（append + 上限裁剪）；`plan_executor.onTurnFinished`（`plan_executor.ts:96`）与步骤启动前检查该列表，命中即不启动。
- 后续用户消息**不恢复**被停止 run 的步骤（新消息属于新 run）。
- `stop ≠ 撤销已完成的外部动作`：保持现状语义，并在 run summary 里保留已完成成员的结果。

### 6.2 重试

- run 级重试入口：**会话内汇总块的「只重未完成成员」按钮**（§5.2 第 6 条）与 Run Center 既有重试入口共用同一条通路；
  只对 `terminal in {failed, blocked, stopped, removed}` 的成员重发，`attempts += 1`；
  已完成（`done`）成员**不重跑**，其副作用不重复（沿用 claim 文件 + `_processHasCompletedOrStartedTool` 门）。
- 审批：重试前读取 gate 状态；**被拒绝**（rejected/denied）的 gate 不允许通过重试绕过——重试请求返回明确错误，要求用户改范围或改配置。
- 用户停止后的 run 不进入自动重试（现有 sticky `aborted` + 新的 `stopped` 终态双重保证）。
- 幂等：重试请求带自己的 `request_id`（沿用 `dashboard-retry-claims` 模式），重复点击复用同一次重试。

### 6.3 运行中移除成员 ＝ 立即停止其工作（已定）

产品口径已确认：**取消成员要立刻停止它在本次运行里的工作**，而不是只影响下一次提交。
这是对 FR-014 的补充口径：**配置快照仍冻结**（本 run 的模型/强度不因成员变化而改），
但**成员集合可变**，用于停止。

流程：

1. 渲染层取消勾选某成员时，若该会话当前有在跑的 run 且该成员在本 run 内被派发过 →
   调用**同一个 abort 入口**（AGENTS.md：群组停止只有这一条路径），带
   `{ run_id, agent_ids: [被移除的成员] }`：
   - 清掉这些 actor 的待执行队列项；
   - `abortWorkerTurn` 其正在执行的回合（含模型会话/工具调用的既有取消逻辑）；
   - 不触碰其他成员的在途执行。
2. RunRecord：该 actor `terminal = "removed"`（不再参与 summary 的 `contributed`）。
3. **依赖处理**：依赖被移除成员的下游步骤**不启动**，终态 `blocked`、原因 `member_removed`
   （不静默跳过，也不改成"无人执行"就继续）。
4. **已完成成果保留**：停止 ≠ 撤销（与 FR-020 同语义），run summary 里保留其已产出的消息/产物。
5. **重新加入不复活**：该成员可以重新勾选，但只对**下一次提交**生效；本 run 的 `removed`
   终态保持不变（审计口径：一次运行只有一份事实）。
6. **无确认弹窗**：取消勾选即可（行为可用"重新勾选 + 下一条消息"修正），但必须有一次明确反馈
   （toast：已停止 X 的本次执行，已完成结果保留）。若产品要求二次确认，再加。

## 7. EC-07：提交幂等

1. 渲染层：一次"提交动作"生成 `submit_request_id`（uuid）；IPC/网络失败后的**同一意图重发**复用该 id；用户重新编辑再发＝新 id。
2. IPC `conversations.sendStream` 形状检查 `submit_request_id`（`safeId`，长度上限）。
3. `groupChat.send`：
   - claim 文件 `<groupDir>/submit-claims/<submit_request_id>.json`，`fileEditLock` 排他；
   - 命中且已完成 → 返回原 `msg`（附带 `duplicate: true`），**不 enqueue**；
   - 命中且进行中 → 返回 `{ ok:false, error:'duplicate submit in flight' }`（渲染层提示"正在确认上一次提交"）；
   - 未命中 → 写入 claim → 正常 enqueue；TTL（例如 10 分钟）后清理，避免长期占位。
4. 草稿策略：claim 命中时**不清空**用户草稿，等确认结果；只有真正被接受才清空（渲染层已有"未接受则回填"逻辑）。

## 8. 接口与数据变更清单

| 层 | 变更 |
| --- | --- |
| prompt | 新增 `src/main/prompts/member_scope.md`（静态规则 + 末尾 Runtime injection 段） |
| bus | `EnqueueParams.runId`；派发写 `QueueItem.runId`；`composeLlmTurnPayload` 后追加作用域块；run 静默 → summary 事件 |
| group_chat/index | 建 RunRecord；`send` 接 `submit_request_id`；`abort` 接 `{ run_id, agent_ids }`（scoped stop，仍走同一 choke point）；run 级 `retryRun` |
| state | `state.json.aborted_run_ids`（append-only，有上限） |
| 消息 | `GroupMessage.run_id`（与 `exec_meta`/`turn_id` 同风格） |
| 事件 | `GroupEvent` 增 `run_started` / `run_member_state` / `run_summary` / `run_stopped`（载荷只含 id、枚举、计数） |
| IPC | `conversations.sendStream` 增 `submit_request_id`；`groupChat.abort` 增可选 `{ run_id, agent_ids }`（不传＝现状会话级停止）；新增 `groupChat.retryRun` |
| 渲染 | 状态映射纯函数 + 最终交付汇总展示 + 「只重未完成成员」按钮（调 `groupChat.retryRun`，复用 `window.cogseed.invoke`，不新增通道）；新增 i18n 键（zh/en） |

## 9. 兼容与迁移

- 旧消息无 `run_id`：状态映射退化为按 actor 聚合（现状行为），不报错。
- 旧会话无 `runs/` 目录：按目录扫描返回空，不建空文件。
- `aborted_run_ids` 缺省 = 空数组；老 `state.json` 读取兼容（已有默认值合并逻辑）。
- 不传 `run_id` 的 `abort` = 现状会话级停止。
- 不传 `submit_request_id` 的发送 = 现状（无幂等保护），保证旧渲染层/第三方调用不受影响。

## 10. 测试计划

| 目标 | 用例落点 |
| --- | --- |
| run 建立与冻结 | 新增 `test/main/features/group_chat/run-record.test.ts`：提交建 run、快照冻结、后续改配置不改 run |
| 作用域注入 | 新增 `member-scope-prompt.test.ts`：commander 得完整块；内进程点名成员得一行；外接实例**不得**含成员名单 |
| 点名与成员派发 | 扩展 `bus-integration.test.ts`：点名=收件人集合；多成员无点名=commander + 范围注入 |
| 状态词表 | 新增 `test/renderer/member-work-state.test.ts`：七态映射 + 事件回放（含 gate/wake/abort 组合） |
| 贡献台账 | 扩展 run-record 测试：missing 非空 → run 不 completed；注入核对轮 |
| 停止范围 | 扩展 `bus-integration.test.ts`：abort(run_id) 后 plan 不启动后续步骤；新消息不恢复旧 run |
| 重试范围 | 扩展 `failed-turn-retry.test.ts`：只重失败成员、不重 done 成员、拒绝的 gate 不可绕过 |
| 运行中移除成员 | 扩展 `bus-integration.test.ts`：scoped abort 只停列出的 actor；下游步骤 `blocked/member_removed`；已完成成果保留；重新勾选不复活本 run |
| 幂等 | 新增 `submit-idempotency.test.ts` + 扩展 `conversations-send-stream.test.ts`：同 id 只产生一次 enqueue；进行中重复提示；TTL 后可再用 |
| 重跑入口 | 新增 `run-summary-retry.test.ts`（渲染层）：`missing` 为空不渲染按钮；非空时请求体只含未完成成员 id；被拒绝审批的成员请求被拒并提示 |
| 顺序强约束 | 新增 `sequential-intent.test.ts`：检测器接受/拒绝语料；`requires_sequential` 下并行派发被拦、依赖方向与 `mention_order` 一致、纠正 1 轮后仍不满足 → `blocked` + `sequential_not_established` |
| 兼容 | 无 run_id / 无 submit_request_id 的老路径回归（扩展既有测试） |

## 11. 风险与回滚

| 风险 | 缓解 |
| --- | --- |
| 作用域注入改变 commander 行为，可能影响既有单成员会话 | 只在"用户消息 + commander + 有显式成员"时注入；默认 CogSeed 单接收不注入（与现状完全一致） |
| run 静默判定误判（在途 turn 漏计）导致过早 summary | 复用既有 `busIsQuiescent` 同源判定 + 静默确认延迟（与 idle watchdog 同风格，不引入 wall-clock 总超时） |
| 幂等 claim 遗留导致后续发送被误判重复 | TTL + 仅"同一 id"生效；渲染层每次新提交用新 id |
| 停止语义变化影响既有 gate/恢复逻辑 | `abort` 不传 `run_id` 时行为完全不变；`aborted_run_ids` 只是额外过滤 |
| 事件载荷膨胀 | 只发 id/枚举/计数（遵守遥测字段约束） |
| 回滚 | 每项独立开关：作用域注入（prompt 文件删除即退）、run 记录（不读即退）、幂等（不传 id 即退）、停止范围（不传 run_id 即退） |

## 12. 分期建议

| 期 | 内容 | 交付判断 |
| --- | --- | --- |
| P1 | §4 范围注入 + §4.1 冻结/派发（runId 打通到 QueueItem 与消息） | 多成员提交后，commander 的输入里能看到范围与点名；点名成员必被派发 |
| P2 | §5 状态词表 + 贡献台账 + 最终交付核对 | 最终交付能回答"谁做了什么、谁没做、为什么"；missing 非空不得 completed |
| P3 | §6 停止/重试的 run 范围 | 停止后不启动后续步骤；重试只重失败成员且不绕过拒绝的审批 |
| P4 | §7 提交幂等 | 响应丢失不产生第二次运行 |

每期结束按 AGENTS.md 跑 `npm run typecheck` / `npm test`，并 `scripts/restart-cogseed.sh` 做真机验证；
跨 Renderer/Main 的改动必须在真机上验证 IPC 契约（合并 develop 后尤其）。

## 13. 未决问题（已全部关闭）

1. ~~顺序意图的识别~~ → **已定：强约束**（见 §4.4）：命中顺序意图即必须建立覆盖全部点名成员的依赖链，
   校验不通过不启动后续步骤；纠正上限 1 轮，仍不通过则 run 标 `blocked`，绝不静默降级为并行。
2. ~~外接实例是否可以看到其他成员的存在~~ → **已定：不可以**（§4.2）。外接只见自己那份任务与信封；若将来要求外接参与协调，需单独安全评审。
3. ~~run 的可见范围~~ → **已定：选项 A**（§5.2）：会话内最终消息下方展示；Run Center 详情列为后续增强。
4. ~~成员移除对已运行 run 的影响~~ → **已定：立即停止其工作**（§6.3）：配置快照仍冻结，成员集合可变；下游步骤阻塞、已完成成果保留、重新加入不复活本 run。
5. ~~`missing` 成员的兜底入口~~ → **已定：选项 1**（§5.2 第 6 条）：汇总块内提供「只重未完成成员」按钮，
   只重 `failed/blocked/stopped/removed`，绝不重跑 `done`，被拒绝的审批不可绕过。

**结论：本文 5 个未决问题全部已定，方案定稿（2026-09-20），可按 §12 分期开工。**

## 14. 决策记录（2026-09-20 确认）

| # | 问题 | 决定 | 落点 |
| --- | --- | --- | --- |
| D1 | 顺序意图是强约束还是提示 | **强约束**：命中即必须建立覆盖全部点名成员的依赖链，校验不过不启动后续步骤，纠正上限 1 轮后 `blocked` | §4.4 |
| D2 | 外接实例能否看到其他成员 | **不可以**：不注入成员名单，只见自己那份任务与信封（FR-021） | §4.2 |
| D3 | run 汇总展示位置 | **会话内**（最终消息下方）；Run Center 详情列为后续增强 | §5.2 |
| D4 | 运行中移除成员的影响 | **立即停止其工作**：配置快照仍冻结、成员集合可变；scoped abort 走同一停止入口；下游阻塞、成果保留、重加不复活 | §6.3 |
| D5 | `missing` 成员的重跑入口 | **汇总块内提供按钮**：只重未完成成员，绝不重跑已完成成员，拒绝的审批不可绕过 | §5.2 第 6 条、§6.2 |
