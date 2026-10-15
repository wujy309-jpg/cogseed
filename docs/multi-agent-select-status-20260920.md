# 多 Agent 选择与协作 — 当前情况说明（2026-09-20 复核版）

依据材料：`cogseed-multi-agent-prd v2.4`（FR-001～021 / US1～3 / EC-01～08）与交互基线
`cogseed-home-multiselect-v0.17`。分支：`codex/multi-agent-select-20260918`，基于
`origin/develop`（1a0f8662）。**未提交、未推送**，改动全部在工作区。

## 1. 结论先说

- 输入框这一层的需求（**选择成员 + 每来源模型 + 提交保持**）已实现并通过验证。
- PRD 的内核「多 Agent 协作」**尚未成立**：成员/点名目前只做到"被记录 + 按点名派发"，
  没有注入协调者上下文，因此"先方案、后验证"这类分工与交接不会因用户多选而形成；
  每个外接实例的模型也**只落快照、没有真正下发给对应执行者**。
- 详见 §4 未完成项，建议的下一步顺序在 §5。

## 2. 变更清单

### 新增

| 文件 | 行数 | 作用 |
| --- | --- | --- |
| `src/renderer/modules/composer-members.js` | 827 | 会话成员名单、点名标记解析、按来源配置分组与持久化、候选列表构建 |
| `test/renderer/composer-members.test.ts` | 344 | 30 例：边界规则、成员联动、配置隔离、持久化、插入/整块删除、协调者不进执行者名单 |
| `test/renderer/composer-mention-chip.test.ts` | 204 | 5 例：点名 chip 与纯文本的 DOM 往返 |

### 修改

| 文件 | 增/删 | 要点 |
| --- | --- | --- |
| `src/renderer/modules/model-chip.js` | +355 −5 | 入口按套数切换；按来源菜单与第二层悬浮；140ms 移出关闭；成员变化时层内刷新 |
| `src/renderer/modules/conversation.js` | +261 −40 | 点名 chip 渲染/序列化/整块删除；成员↔草稿联动；`A +N` 摘要；提交载荷与校验；失败回填草稿 |
| `src/renderer/modules/agents.js` | +97 −6 | 候选列表多选模式（members / mentions）、行点击改为勾选、完成按钮、Agent 目录只读出口 |
| `src/main/features/group_chat/index.ts` | +72 | 成员/点名逐个核验、按来源配置校验、点名 `forceTo`、成员快照入队 |
| `src/main/ipc/index.ts` | +30 −1 | `conversations.sendStream` 接收并做形状检查三个新字段 |
| `src/main/features/group_chat/visibility.ts` | +11 | `GroupMessage.member_snapshot` 持久化字段 |
| `src/main/features/group_chat/bus.ts` | +4 | `member_snapshot` 落到消息 |
| `src/renderer/style.css` | +86 −1 | 点名标记（产品绿文字）、`+N`、成员行（含清除 UA 按钮默认外观）、列表底部 |
| `src/renderer/locales/{zh,en}.json` | +23 −1 each | 22 个新文案键（成员/点名/模型来源） |
| `src/renderer/index.html` | +3 | 挂载 `composer-members.js`（在 `conversation.js` 之前） |
| 三个既有测试 | +95 | IPC 成员字段转发/拒绝、配置 map 校验、富编辑器函数抽取表更新 |

## 3. PRD 条款对照

### 已完成（有测试证据）

| 条款 | 落点 |
| --- | --- |
| FR-001 多选入口（底部 + `@`） | `agents.js` 多选模式；`composer-members.js::buildPickerList` |
| FR-002 名单与点名分离、`A +N`、取消即删标记 | `composer-members.js`、`conversation.js::_syncRecipientFromMembers` |
| FR-003 默认 CogSeed、一位不显示 `+0` | `memberSummary` |
| FR-004 稳定身份、重名可区分、纯文本不增员 | `mentionTokensIn`（`cli-*` / task 目录按 `agent_id` 区分） |
| FR-005 整块删除/撤销重做/IME | mention chip（`contentEditable=false`）+ `deleteMentionAtCaret` + 基线同步 |
| FR-006 搜索不清空、限高、完成/关闭、菜单互斥 | picker 既有容器 + 新页脚 |
| FR-007 内部共享/外接独立/不串密钥 | `configGroupsFrom`；只传 id 与模型名，不传连接信息 |
| FR-008～012 单套直达、多套分层、悬浮、140ms、无多余控件 | `_renderMemberConfigMenu`、`_openMemberSourceFlyout` |
| FR-014 会话内隔离、移除来源关闭其层、不写全局默认 | `refreshOpenMemberMenu`、`setSourceConfig`（仅会话键） |
| FR-015 提交前校验、不静默部分执行 | 渲染层意图校验 + `_validateAgentIdList`（任一失效整条拒绝） |
| FR-016 快照、接受后清空、成员与模型保留、切换恢复、新建默认 | `_composerMemberPayload`、`transferTarget`、`resetTarget` |
| FR-017 点名=本条对象、成员=协作范围（记录） | `mention_agent_ids` → `forceTo`；`member_snapshot` 落盘 |

### 部分完成

| 条款 | 缺口 |
| --- | --- |
| ~~FR-007/008 外接模型生效~~ | 已修（§5）：按来源下发已落地 |
| ~~FR-013 能力驱动选项~~ | 已修（§5）：managed 文案、读取失败重试、换模型后强度恢复默认均已落地 |
| FR-017/018 分工与汇总 | 成员未注入协调者上下文；未核对被点名成员的"贡献或阻塞说明" |

### 未做

| 条款 | 说明 |
| --- | --- |
| US3-03 前序成果交接 | 依赖链仍由既有 group chat 计划决定，不随用户多选形成 |
| FR-018 状态词表 | 沿用既有 `idle/running/aborted` 与协作步骤状态 |
| FR-019/FR-020 多成员运行的停止/重试范围 | 沿用既有实现，未做批处理级保证 |
| EC-07 提交幂等 | 无运行幂等键；仅渲染层单次提交 + 失败回填 |

## 4. 复核（2026-09-20）发现并修复的缺陷

在"测试没覆盖到的路径"上重读代码，找出 7 个问题，全部已修并补了回归用例：

| # | 问题 | 影响 | 修复 |
| --- | --- | --- | --- |
| 1 | `member_agent_ids` 把协调者 `commander` 当 agent 下发 | **勾选 CogSeed 后发送会被主进程整条拒绝**（按 agent 校验失败） | 新增 `agentMemberIds()` 过滤协调者；主进程对保留 id 改为丢弃而非报错 |
| 2 | 排队消息（会话进行中再次发送）不带成员/点名/按来源配置 | 排队那条丢失成员快照（FR-016 不成立） | 排队分支同样携带成员载荷，并避免与 legacy 单套配置冲突 |
| 3 | EC-06 意图判定把符号也算无意图 | 只发 emoji（如「👍」）会被拦下 | 只按空白与标点判定，保留 `\p{S}` 为有效意图 |
| 4 | picker 键盘导航只认旧行选择器 | 成员行上下键无效、回车永远点第一行 | 统一行选择器，`_PICKER_ROW_SELECTOR` 覆盖两类行 |
| 5 | 上条修复里用字符串拼 active 选择器 | 拼出双点非法选择器，回车时 `querySelector` 抛错 | 单独写死 `_PICKER_ROW_ACTIVE_SELECTOR` |
| 6 | 撤销恢复协调者时成员形状错误 | 存成 `{kind:'agent', id:'commander'}` | 恢复时还原为 commander 形状 |
| 7 | "移动提交载荷助手"的脚本顺带搬走了 `getExecOverride`/`setExecOverride` | 功能未坏（函数提升）但 diff 噪声 31 行、内聚被破坏 | 已搬回原位，conversation.js diff 从 +261/−40 收敛到 +243/−10 |

第 7 条也说明：脚本改代码必须回看 diff —— 它没有报错，是复核 diff 时才发现的。

## 5. 缺陷修复（2026-09-20 第二轮，按复核清单逐条修）

| 缺陷 | 修法 | 位置 |
| --- | --- | --- |
| §9 已知偏差：成员候选未套用项目绑定过滤 | 新增 `getComposerAgentCandidates()` / `getComposerMemberScopeHint()`：**候选列表**与既有 Agents 页签同口径过滤；身份目录仍不过滤（否则跨会话成员会被误判来源） | `agents.js`、`composer-members.js` |
| FR-013：模型无下发通道时无提示 | 外接来源 `modelControllableFor === false` 时不再列模型行，显示「由该 Agent 管理」 | `model-chip.js` |
| FR-013：清单读取失败无重试 | 扫描失败时给「重新读取模型清单」行，`loadCliModels(refresh)` 后原位重画 | `model-chip.js` |
| FR-013：换模型后强度不受支持 | 选中的模型不支持 low/high 时，把该来源强度恢复默认并 toast 提示 | `model-chip.js` |
| **FR-007/008：按来源模型只落快照、没有真正下发** | `bus.ts` 新增 `memberConfigs` + `memberConfigScope`：派发时按 recipient 取配置（外接只认自己那份，内部成员/协调者共享 internal），facade 在提交时按 agent runtime 分类外接实例 | `bus.ts`、`group_chat/index.ts` |

新发现并修掉的连带缺陷：第一版 resolver 用「没有 exact 键就回落 internal」，会让**没配模型的外接实例拿到内部 API 模型**（正是 FR-007 禁止的串用）。已改为来源感知：`memberConfigScope.external_ids` 里的收件人只认自己的键，没配就跟随该 Agent 自身默认。回归用例 `execution-config.test.ts` 已覆盖（13 例）。

## 6. 本轮修掉的三个显性问题

1. **`auto` 弹窗被误纳入多选模式**：在该弹窗选 Agent 会把成员写进当前会话。
   已按入口白名单排除，auto 保持原单选语义（`_composerMemberModeForChip`）。
2. **`style.css` 被脚本改成 LF 换行**，diff 一度膨胀到 65002 行。已回滚重做，
   现在该文件只 +86 −1。
3. **候选列表出现黑色边框**：`.skill-picker-item` 原本只用于 `<div>`，
   成员行改用 `<button>` 后吃到浏览器默认按钮外观。已在 `.composer-member-row`
   显式重置 `appearance/border/background/font` 并补 `:focus-visible` 焦点环。

## 6.5 P1 落地（2026-09-20，协作内核第一期）

按 `docs/multi-agent-collaboration-design-20260920.md` §4.1–4.2 实现：

| 交付 | 落点 |
| --- | --- |
| 协作运行记录（提交时冻结成员/点名/来源配置/顺序意图） | 新增 `src/main/features/group_chat/run_store.ts`（`runs/<runId>.json`，目录扫描，`fileEditLock` 串行） |
| 范围注入 | 新增 `src/main/prompts/member_scope.md`（静态规则 + 末尾 Runtime injection 段）与 `src/main/features/group_chat/member_scope.ts`（纯函数构建 + 外接判定 + 顺序意图检测） |
| runId 打通 | `EnqueueParams.runId` → `QueueItem.runId` → `GroupMessage.run_id`；派发时登记 `recordRunDispatch`；5 处 actor 终态入队带 `runId`；投影路径 `ProjectedAgentMessageInput.runId` |
| 快照扩展 | `member_snapshot` 增 `mention_order` / `requires_sequential` / `external_agent_ids` |
| 注入规则 | commander 完整块（范围/必须执行者/顺序要求/交付要求）；内进程被点名成员一行；**外接实例不注入任何成员信息**；无成员快照完全不注入（旧路径零变化） |

新增测试：`run-record.test.ts`（5 例）、`member-scope-prompt.test.ts`（18 例，含外接零泄露、旧路径零注入、顺序意图接受/拒绝两类语料、prompt 文件约定）。
回归：`test/main/features/group_chat/` 全量 + IPC send-stream + 相关渲染层测试 **42 文件 791 例全绿**。

**本期未做（属设计 §4.4 校验与纠正、§5～§7）**：顺序意图目前只**检测并记录 + 写进范围块**，
主机侧的「依赖链校验 + 纠正轮 + blocked」尚未实现；run 的终态汇总、按 run 停止/重试、提交幂等键均为后续期。

## 6.6 P4 提交幂等 + P2 状态词表（2026-09-20，第二/第三期切片）

| 期 | 交付 | 落点 |
| --- | --- | --- |
| **P4**（EC-07 完成） | 一次提交意图一个 `submit_request_id`；未接受时保留、重发复用，文字变了换新 id | 渲染层 `_submitRequestIdFor`（会话 + 落地页两条发送路径都带） |
| | IPC 形状检查（`safeId`、≤64）+ 转发 | `ipc/index.ts::conversations.sendStream` |
| | claim 闸门：`in_flight` → 拒绝并提示"正在确认上一次提交"；`accepted` → 返回原消息不新建运行；失败 → 释放；10 分钟 TTL | `group_chat/index.ts` 的 `submit-claims/<id>.json` + `_readSubmitClaim` / `_writeSubmitClaim` / `_clearSubmitClaim` |
| **P2 前半**（FR-018 词表与核对口径） | 七态映射（终态 > 审批 > 依赖 > 等待用户 > 执行中 > 等待）+ 交付核对（未完成不允许 `complete`） | 新增 `src/renderer/modules/member-work-state.js`（纯函数，已挂 `index.html`） |

新增测试：`submit-idempotency.test.ts`（6 例）、IPC 幂等键转发/拒绝（+1 例）、`member-work-state.test.ts`（10 例）。

**P2 后半（未做）**：贡献台账落盘（run summary）+ 会话内汇总块渲染 + 「只重未完成成员」按钮（D5）。
**P3（未做）**：按 run 停止（含运行中移除成员＝立即停止，D4）与只重失败成员的重试。
**P1 收尾（未做）**：§4.4 顺序强约束的**主机侧校验与纠正**——目前只做到检测 + 记录 + 写进范围块。

未做这三项的原因写在 §12 风险里：§4.4 校验与 P3 都需要改协作调度内核（步骤依赖图 / plan 恢复），
且必须在真实会话里验证模型行为；本环境无法驱动真实模型回合，硬改会把不可验证的调度风险带进主干。

## 6.7 P1 收尾：顺序强约束校验（2026-09-20）

| 交付 | 落点 |
| --- | --- |
| 纯函数校验器（缺成员 / 缺依赖 / 方向相反 / 成环） | `member_scope.ts::verifySequentialPlan` |
| 纠正文案（不静默降级为并行） | `member_scope.ts::sequentialViolationMessage` |
| 闸门：依赖步骤启动前校验，不满足则不启动 + 回交协调者纠正 | `bus.ts::startPreparedNestedDispatchForTool` → `_guardSequentialPlanBeforeStart` |
| 纠正上限 1 轮，第二次仍违规 → run `blocked` + `missing.reason = sequential_not_established` | `_guardSequentialPlanBeforeStart` + `run_store.updateRun` |
| 运行归属：本条提交的 run id 记在 `CidState.memberRunId`（仅用户提交更新，agent 中途派发不覆盖） | `bus.ts` |

新增用例：`member-scope-prompt.test.ts` 增至 **25 例**（含依赖方向、缺依赖、缺成员、成环、通过时不产纠正文案）。
回归：`test/main/features/group_chat/` **40 文件 766 例全绿**。

**真机验证清单（本环境无法驱动真实模型回合，需在配好模型/CLI 的机器上核对）**

1. 多选 2 个成员，正文写「先…再…」发送 → 会话 group 目录 `runs/run_*.json` 应出现
   `requires_sequential: true`、`mention_order: ["A","B"]`；`runs/` 下有且仅有本会话运行文件。
2. commander 若并行派发 → 运行日志出现 `sequential plan rejected`（含 `reason` 与 `corrections: 1`），
   run 文件 `corrections: 1`；再次并行 → run `status: blocked`、`summary.missing[].reason = sequential_not_established`。
3. commander 建了依赖步骤 → 第一层照常执行、第二层在依赖满足后才启动，run 文件 `actors[].dispatched` 按序增长。
4. 外接实例（Codex 等）回合的输入里**不应**出现成员名单（可查该回合的 prompt/日志）。
5. 普通单接收者会话（不选成员）行为与改动前一致：**仍会建 run 记录**（设计 §4.1：默认接收也是一次运行，
只是成员为空），但 `requires_sequential` 的校验不生效（无点名 → `mention_order < 2` 直接放行），
且该回合的 LLM 输入里**没有**范围块（无成员快照即不注入）。

   > 更正：本节早先写成"不选成员就没有 runs/ 文件"，与实现不符（`send()` 每次被接受都会建 run）。
   > 这是设计取值（一次提交＝一次运行，含默认接收），已按实际行为更正。

## 6.8 真机场景测试（可直接运行）

`test/main/scenarios/multi-agent-collaboration.scenario.test.ts` —— 默认 skip，`npm test` 不受影响。

```bash
COGSEED_SCENARIO=1 npm run test:js -- test/main/scenarios/multi-agent-collaboration.scenario.test.ts
```

可选环境变量：`COGSEED_SCENARIO_TEXT`（场景正文）、`COGSEED_SCENARIO_MEMBERS`（逗号分隔 agent_id）、
`COGSEED_SCENARIO_TIMEOUT_MS`（默认 300000）、`COGSEED_SCENARIO_LOG_DIR`（日志目录）。

它跑**真实主进程链路**：当前登录用户 → 新建会话「多Agent 场景测试」→ `groupChat.send`
（点名 + 成员快照 + "先…再…"顺序意图）→ 等 run 收敛 → 打印 run 记录全文与日志证据。自动断言：

- run 记录落盘，且 `requires_sequential === true`、`mention_order === [A, B]`
- `member_agent_ids` 含两位成员
- 出现纠正时 `corrections <= 1`（强约束上限）
- 打印每个 actor 的终态与 `corrections/status`，供人工确认"最终交付是否点名了未完成成员"

副作用：会在真实数据根下创建一个会话（标题「多Agent 场景测试」），跑完可在侧栏删除；会真实调用模型。

## 6.9 交互澄清：按原型 v0.17 对齐（2026-09-20）

用户反馈"选择智能体/配置模型容易搞混"。回查原型后确认：**模式区分靠底部计数 + 行的 aria-label**，
不靠行内标签或说明条；勾选态＝**真实已选**。据此做了三处对齐（我上一轮自造的 UI 全部撤回）：

| 项 | 原型行为 | 调整 |
| --- | --- | --- |
| 勾选态 | `checkedIds = selected`（名单为空时 CogSeed 也不勾） | 去掉"名单为空时 CogSeed 显示勾选"的旧逻辑 → 勾选态＝真实已选 |
| 分组标题 | `group` 为空的行不出标题（CogSeed 行不带「CogSeed」标题） | CogSeed 行不再出标题；并固定分组顺序 CogSeed → 外接 Agent → Task Agent（组内保序） |
| 默认接收 | 入口 aria-label：「默认由 CogSeed 接收，点击选择成员。」；非空：「会话成员：A、B。共 N 个。点击修改。」 | 入口补充空态说明文案（非空态原本已有） |
| 模式区分 | 底部 `会话成员 N 个` / `本条点名 N 个` + 行 aria-label `选择会话成员 X` / `点名 X` | **保持**（未新增行内标签、未新增列表说明条——这两个是我上一轮自造的，已撤回） |

新增用例：`composer-members.test.ts` 增至 **33 例**（空名单不勾选 / 显式选中才勾选 / 分组顺序）。
回归：`test/renderer/` + `group_chat` **2344 例通过**（唯一失败仍是分支遗留的未跟踪测试）。

## 7. 验证证据

| 门 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| 相关测试 12 文件 | 104 例全绿（成员 30 例、chip 往返 5 例、外部 Agent 切换、模型级联、统一执行入口、共享控件基线、IPC 与配置校验等） |
| `npm test`（完整门，Electron 运行时） | 11806 passed / 52 skipped。失败项：①**既有未跟踪文件** `test/renderer/conversation-activity-status.test.ts`（依赖本分支不存在的 `_activityToolAction`，与本次改动无关）；②`p3394_bridge/interop.test.ts` 的 cross-node cancel 在满载并行下 `waitFor timeout`，单独重跑 8 例全绿（判为负载抖动，非本次改动） |
| `git diff --check` | 干净 |
| 真机 | `scripts/restart-cogseed.sh` 重启成功，当日运行日志 0 条 error |

未覆盖：屏幕截图/点击级人工验收（本环境无屏幕录制与辅助功能权限），
暗色主题与最小窗口仅按 token 与既有布局推断，未做像素级核对。

## 8. 数据结构与接口（接手要点）

- **localStorage**：`chat.membersByCid`（`{ [cid|'new-chat']: Member[] }`）、
  `chat.sourceConfigByCid`（`{ [cid]: { internal?: Config, [agentId]?: Config } }`）。
  与既有 `chat.recipientByCid`、`chat.execOverrideByCid` 同构；无成员时完全走旧路径。
- **发送载荷新增**：`member_agent_ids`、`mention_agent_ids`、`execution_configs`。
  多来源时**不**广播单一 `execution_config`，避免内部模型串给外接实例。
- **主进程校验**：`ipc/index.ts::_safeAgentIdList`（形状、≤20、去重）→
  `group_chat/index.ts::_validateAgentIdList`（启用 + 可派发，逐条）、
  `_validatedExecutionConfigMap`（按来源）。
- **落盘**：`GroupMessage.member_snapshot`（成员、点名、按来源配置）。
- **按来源下发**（本轮新增）：`EnqueueParams.memberConfigs`（key = `internal` 或外接
  agent_id，`bus.ts::SOURCE_INTERNAL_KEY`）＋ `memberConfigScope.external_ids`
  （facade 按 `runtime.kind === 'cli' | 'p3394-gateway'` 分类）。
  `bus.ts::resolveSourceExecConfig(recipientId, params)` 决定每个收件人拿到哪一份：
  外接只认自己的键（没配就跟随自身默认），其余共享 internal，没有按来源配置时
  回落既有单套 `executionConfig`。

## 9. 建议的下一步

1. ~~按来源配置真正下发~~ → 本轮已完成（见 §5）。
2. **成员/点名注入本条上下文**：让协调者知道本次协作范围与点名对象，
   并据此形成依赖与交接（US3-03）。
3. **贡献/阻塞核对**：最终交付按被点名成员收敛，缺贡献项显式标注（FR-018）。
4. **运行身份与幂等键**：一次提交一个运行 id，重复点击/响应丢失不产生第二次运行（EC-07）。

## 10. 已消除的已知偏差

- ~~成员候选列表未套用「项目绑定 Agent」过滤~~ → 已修（见 §5 第一行）。
  成员候选与 Agents 页签同口径；项目零绑定 Agent 时显示与页签相同的提示。

## 11. 边界

- 本次未改 group chat 调度内核（`plan_executor` / `collaboration` / 重试与停止语义）。
- 未新增依赖、未改 IPC 通道名、未改数据目录结构。
- 未提交、未推送、未开 MR；`docs/` 下本文件亦未提交。
