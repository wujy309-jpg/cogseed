# 功能规格：Hub S3｜Agent 分发与贡献（客户端侧）

**Feature Branch**: `feat/hub-agent-distribution`

**Created**: 2026-10-09

**Status**: Draft（2026-10-10 按客户端评审会结论更新）— 客户端侧工程规格草案，派生自《CogSeed Hub S3｜Agent 分发与贡献需求 Brief v0.1》（2026-10-09，待细化、待评审，非冻结规格或排期承诺）。尚未 Plan、Build、验收或发布。已读 Hub 仓库（`~/Desktop/cogseed-hub`）里现有的 Skill 契约（A-01～A-03、C-00～C-06、OpenAPI），**Hub 目前没有任何 Agent 契约**；凡涉及接口、字段、状态机的条目，均为客户端提出的**草案**，需与 Hub 端（嘉宇）对齐后冻结。本文与 Hub 侧规格或产品决定冲突时，以后者为准。

**Input**: 2026-10-10 客户端评审会结论（见「评审结论」）；需求 Brief v0.1（S3-01～S3-06、两条主流程、§5 边界、§6 异常、§7 待定项、§8 完成标准）；既有客户端实现（Agent 安装、Skill 贡献链路，见「复用与缺口」）；种子场景由雨萱在 2026-10-09 选定为「报销」，经现有实现核对后收敛为「报销材料预检助手」（见「种子场景」）。

## 一句话说明

用户在现有「智能体」页点「更多」，进入 Hub 分发的 Agent 市场，查看它能做什么、依赖哪些 Skill、需要什么使用前提，确认后一次装好 Agent 与依赖，装好的 Agent 直接出现在智能体页「平台」区，选用它完成真实任务；用户也能把自己创建的 Agent 贡献到 Hub：在自建 Agent 卡片上点「贡献」，先预览实际会发出的内容与本机已处理的内容，确认来源、条款，并确认「本机自建的 Skill 会随 Agent 一起提交」（提交方式待 D-07 确认）后提交固定版本，等待审核，通过并发布后其他用户可安装。Agent 引用的 Skill，客户端按三种情形分别校验、分别提示：Hub 分发中随客户端预置的（本机已具备，无需下载）、需要从 Hub 下载的、随 Agent 一起提交的自建 Skill；不在依赖没准备好时显示 Agent 可用。**本期只改「智能体」这一项内部，其余页面与菜单保持现状。**审核、发布、目录与权限在 Hub 侧完成，本文不重复其规则。

## 评审结论（2026-10-10 客户端评审会）

> 来自会议逐字稿（机器转写，个别措辞可能不准）。除标注「待书面确认」外，视为已定方向。

| # | 结论 | 影响 |
|---|---|---|
| 1 | **架构不动**：只改「智能体」这一项内部；一级菜单、二级菜单（智能体 / MCP与工具 / 技能 / 资料库 / IM）保持现状，原型必须是与真实客户端一致的高保真 | AG-FR-070、071 |
| 2 | **没有「我的 Agent」页，也没有「已安装管理」页**：装好的 Agent 出现在现有智能体页（含停用等操作）；自建 Agent 卡片上有「贡献」按钮，与 Skill 一致 | AG-FR-001、014、030、050 |
| 3 | 发现入口沿用 Skill：智能体页「更多」→ Hub Agent 市场，可安装 | AG-FR-001 |
| 4 | **「我的贡献」保留**，Agent 与 Skill 放同一页，用类型切换（最终可能融合成一个列表，本期不做） | AG-FR-040 |
| 5 | **本机自建 Skill 随 Agent 一起提交，不再阻断**（提交后是私有包还是独立公开，待 D-07）：点贡献时提示「这些 Skill 也会同时贡献」，同意才提交；引用 Hub 分发的 Skill（链接）不提示；体验上一个按钮、一次确认，流程可复用但不要拆成两件事 | AG-FR-032、D-07 |
| 6 | **处理在客户端做**，Hub 不需要知道处理了什么；只拦最明显的（如 ssh 私钥、pem 格式），不穷举，不做成要长期维护的规则库；用户对自己提交的内容负责 | AG-FR-033 |
| 7 | （会上口径）Agent 引用 Skill 来源三类：客户端内置 / Hub 分发 / 用户贡献，均须公开；Hub 维护一份内置 Skill 清单，只用来判断「是不是内置」。**代码核实后术语有出入，见「代码核实」：随包的「内置」其实是 Hub 分发中的预置内容，真正的系统内置 Skill 性质不同** | AG-FR-011、032、D-02、D-10 |
| 8 | Agent 的标准基于客户端现有定义（提示词 + Skill）；只定义 Hub 与客户端之间传递的 Agent 协议，不回头看每个旧 Agent；旧版本兼容不考虑 | D-01、D-08 |
| 9 | **顺序：改原型 → 发群确认 → 先定 Agent schema（含哪些文件）→ 再定 API → 分头开发** | D-08 |

**与 Brief 的冲突（待书面确认）：** 结论 5 与 Brief v0.1 §5「私有 Skill 随 Agent 打包贡献」列为「不纳入」相反，来自评审会口头决定，建议中扬补一句书面确认后再作为已定需求（D-07）。

**会上尚未对齐：** 客户端与 Hub 的文件清单、退回反馈等接口与生命周期；Agent 本身的安全扫描范围（吴嘉宇确认）；Hub 里「接受但不发布」状态客户端发不出去（疑似 bug，发版后复查）。

## 代码核实（2026-10-10，基线 `origin/develop` `5491969e`）

> 只读核对，**未运行验证**的结论已标明。涉及的文件均在 `src/` 或 `resources/` 下。

**1. 「内置」有两种完全不同的性质**
- **系统内置 Skill**（`resources/builtin/system/skills/`，8 个：`agent-creator`、`autotask-creator`、`coding`、`grounded-material-qa`、`kb-mindmap`、`package-installer`、`personal-ontology-candidate-builder`、`skill-creator`）：ID 是名字形式；`system_skills.ts` 注释称其为「product protocol documents」，每个用户在本地镜像一份；提示词里单独注入「System skills」块，让模型用 `read_file` 读取，并明确写「They are not marketplace or custom skills」。
- **Hub 分发中的预置内容**（`resources/builtin/marketplace/`：31 个 Agent、58 个 Skill）：ID 是 12 位十六进制（与 Hub 同一套）。`builtin_marketplace.ts` 注释：它是「packaged fallback」，「**not a third source tier at runtime**」，启动时复制进用户的市场安装目录、写普通安装记录，联网后由市场对账接管；较新的随包版本还可以覆盖同 ID 的市场安装，使「尚未发布到上游」的改动也能运行。运行时它被标为 `builtin`（`_install.json::seed_source === "builtin"`，`skill-registry.ts`）。
- **术语冲突**：代码里叫 `builtin` 的是第二种（预置的 Hub 内容），不是第一种。本文用「系统内置」指第一种，「Hub 分发中的预置内容」指第二种。

**2. Skill ID 有三种形态，不可互换**（`skill_id.ts`）：`hex`（市场安装，服务端分配，12 位十六进制）、`name`（用户自建）、`external`（`claude:xxx` / `codex:xxx`，读磁盘上的外部技能目录）。

**3. Agent 怎么引用 Skill**（`agents.ts`、`skill-registry.ts`）
- `skill_list` 是「Agent 声明的 workflow 依赖」，运行时当**白名单上限**：`undefined` 无上限，`[]` 明确为零。条目是 ID 或名字，保存时由 `resolveSkillAllowlistRefs` 按 ID 或名字解析，**无法解析的条目会被丢弃**。
- 31 个内置 Agent 共 84 条引用：61 条是十六进制，全部指向随包预置的 Skill；23 条是名字，是 Agent **自带的私有 Skill**（如 SeoGeoAgent 的 `skills/` 目录）。没有任何一条引用系统 Skill。

**4. 系统 Skill 能否被 `skill_list` 引用——未验证**：`resolveSkillAllowlistRefs` 解析所用的 `specs` 来自受信加载器，其目录只有**市场安装目录**与**自建 Skill 目录**（`getLoader()`），另加外部包与该 Agent 的私有目录；系统 Skill 目录由另一个加载器单独读取，不在其中。所以按代码，把系统 Skill 放进 `skill_list` 很可能被当作未知而丢弃。这只是读代码的推断，**没有运行验证，本文不写成支持，也不写成不支持**（D-10）。

**5. Agent 私有 Skill 包是现有机制**：市场 Agent 的详情带 `agent_skills_bundle_url`（zip）；安装时先下载私有包，再并行安装 `skill_list` 里缺失的独立 Skill，**任一失败整个 Agent 不记录**；私有 Skill 带 `ownerAgent`，别的 Agent 解析为未知。**它是「只给这个 Agent 用」，与「作为独立公开的 Skill 贡献到 Hub」不是一回事**（D-07）。

**6. Agent 定义**（`agents.ts` 的 `Agent`）
- 持久化在 `agent.json` 的创作字段：`agent_id, name, description_zh/en, workflow, icon, color, skill_list, inputs, interactive, profile, category, output_format, runtime, interface_contract, created_at, updated_at, source`。
- 与本机或用户相关、**不应随贡献分发**：`enabled_connectors`（连接器实例 ID）、`default_model`、`default_thinking`、`create_uid`。
- 宿主专有、**不可分发**：`management_surface`、`reimbursement_entry_role`、`interaction_mode`，以及 `runtime.kind` 为 `cli` / `p3394-gateway`（本地 CLI 外接 Agent）。
- 运行时派生、不写回 `agent.json`：`enabled`、`version`、`marketplace_*`、`status`、`seed_source`、`runtime_stats`。
- 冲突仲裁：`builtin` 预置 > `platform` 市场安装 > `custom`（`agentPrioritySource`）。市场项去重按 `(name, create_uid)`。

**7. 接口现状**（客户端 `marketplace.ts`、`contribution/hub-client.ts`；Hub 仓库 `cogseed-hub`）
- **客户端**调用 `POST /marketplace/agents/list`、`agents/detail`，这是按**旧服务端**契约写的；**新 Hub 对这些路径返回 `404 NOT_SUPPORTED`**，Hub 明确表示不凭 404 反推着补端点，要求**先由 Hub 与客户端共同确认目标契约**。
- **Hub 现有端点：**`/marketplace/skills/list`（A-01）、`/marketplace/skills/bundle`（A-02）、`/marketplace/hub-content/events`（A-03）、`/marketplace/contributions/{terms, submissions, submissions/{id}, …/withdraw, mine, withdrawal-requests}`（C-00～C-06）。
- **Hub 内容类型固定为 `skill`**（A-01 `content_type`、C-02 提交清单；非 `skill` 返回 `INVALID_REQUEST`；数据模型写明「不预留分支」）。扩展到 Agent 是 Hub 数据模型与契约的新建设。
- Skill 内容元数据（`SkillMetadata`，对应 A-01）：`content_id`（12 位十六进制）、`version`、`create_uid`（官方恒 `"0"`，决定安全扫描档位）、`status` 与 `disabled`（一致；客户端只读 `status`）、`min_app_version`（缺席=无下限）、`artifact{sha256,size_bytes,format}`（下载后复核，`format` 固定 `skill-tree-v1`）。
- 贡献：请求头 `X-CogSeed-Client-Version`、`X-CogSeed-Platform`（`macos`/`windows`）、`X-CogSeed-Request-ID`、`Idempotency-Key`；multipart `manifest.json` + 包 zip（≤ 8 MiB）；清单字段逐字对应 C-02 §1 白名单，`metadata` 只允许 `name/description/version`（多余字段拒绝而非忽略）；错误码含 `PACKAGE_REJECTED`、`PACKAGE_DIGEST_MISMATCH`、`VERSION_NOT_HIGHER`、`CLIENT_VERSION_UNSUPPORTED`、`LOCAL_CHECK_NOT_CLEAN` 等。
- Skill 社区贡献**必须**带 `references/security-manifest.yaml`（本体 `cogseed.security.skill@1.1.1`，declaration-core 1.3.0 校验）；**Agent 没有对应本体**（D-04）。
- 没有找到「停用 Skill 时检查是否被 Agent 依赖」的实现。

**8. 因此本文需要注意的差异**
- 「客户端内置 vs Hub 分发」两类来源，对随包预置的 Skill/Agent 不成立，它们本来就是 Hub 内容（D-02）。
- Agent 目前**没有**发布物摘要字段，AG-FR-020 需要 Hub 新增（D-09）；而且 **Hub 目前根本没有 Agent 的目录、包、贡献接口**（D-11）。
- 贡献接口的内容类型需要扩展到 Agent（Hub 端）；Agent 提交包里应包含哪些文件待 D-08。
- 随包预置内容可能先于 Hub 发布，「Hub 已知所有预置 ID」**未核实**。

## 种子场景

Brief §7 要求先定种子场景。雨萱选择「报销」。核对现有实现后发现，**直接分发现有内置「Reimbursement Agent」不可行**，原因均有代码依据：

| 事实 | 依据 | 对 S3 的影响 |
|---|---|---|
| 现有报销 Agent 是内置、`canonical` 的宿主信任锚，ID 固定为 `c045605cb916`，`seed_source` 为 `builtin` | `src/main/features/expense_workbench/canonical-agent.ts`、`resources/builtin/marketplace/agents/c045605cb916/agent.json` | 它本来就随客户端安装，不是「从 Hub 安装」的对象；若另有同类 Agent 经 Hub 分发，不能冒用该 ID 或管理入口 |
| 其 `skill_list` 为空 | 同上 `agent.json` | 它不引用任何 Skill，演示不了 S3 的核心——Agent 引用 Hub 分发的 Skill（含预置） |
| 依赖宿主工具与受保护配置卡片（`expense_configuration_status`、飞书应用密钥加密存本机、审批 code、open_id） | `agent.json` workflow、`expense_workbench/expense-agent.ts` | 这些正是 Brief §5 要求贡献时剥离的 Connector 配置与凭据，不能随 Agent 分发 |
| 报销执行组件是按哈希固定的 Python 组件，可信平台产物目前只有 `darwin-arm64`，未审核平台「故意失败关闭」 | `expense_workbench/trusted-component-manifest.ts` | 无法满足 Brief §8「macOS 与 Windows 双平台真实任务」 |

因此本文的种子场景定为**「报销材料预检助手」（B-lite）**：一个**新的、可分发的** Agent，只做「整理报销材料、按规则预检、给出补件清单与可提交的材料摘要」，**不含**飞书审批提交、凭据配置、宿主专有工具。它引用：

| 依赖 | 来源类型 | 说明 |
|---|---|---|
| `a3f09c21b7e4`（示意） | Hub 分发中的预置内容（真实预置内容的 ID 是 12 位十六进制，运行时标为 `builtin`） | 依据材料作答与核对；本机已具备时直接复用，无需下载。实际哪些 Skill 预置，以 `resources/builtin/_manifest.json` 的 `inventory` 为准 |
| `5e1c8a02d9b3`（示意，发票字段抽取） | Hub 分发的 Skill（**示意 ID，按真实的 12 位十六进制格式**） | 发票字段抽取；本机未安装时走安装确认 |
| `9b27f4a1c0e6`（示意，报销制度预检） | Hub 分发的 Skill（**示意 ID**） | 按制度规则预检；可被停用，用于演示依赖异常 |

> 三个 Skill 的 ID 与版本均为原型示意值（格式取真实的 12 位十六进制，但**不是真实 ID**），需与嘉宇确认真实可用的公开 Skill；若 Hub 上暂无合适 Skill，本场景需由运营先发布，或改用 Brief 建议的 A 场景。**早前用作「内置依赖」示例的系统 Skill `grounded-material-qa` 已移除**：系统 Skill 能否出现在 Agent 的 `skill_list` 里未核实（见「代码核实」、D-10），不作为依赖来源。

### 验收种子（客户端定，2026-10-11）

产品第 5 条要求验收 Agent **同时依赖 Hub 已发布 Skill 和随包私有 Skill**。上面的"报销材料预检助手"全部依赖 Hub，用作"官方发布 → 安装"的演示；另加一个**社区贡献**的验收 Agent「发票识别报销助手」（原型 `?v=bundled-skill`）：

| 依赖 | 类型 | 说明 |
|---|---|---|
| `a3f09c21b7e4`（示意） | Hub 分发中的预置内容 | 本机已具备，直接复用 |
| `5e1c8a02d9b3`（示意，发票字段抽取） | Hub 分发的 Skill | 本机未安装则自动补齐 |
| `invoice-ocr`（发票文字识别） | **随包私有 Skill** | 装在该 Agent 名下，不进用户技能列表，不覆盖同名技能 |

联合验收路径：用户自建此 Agent 与私有 Skill → 贡献 → 审核 → 发布 → 另一客户端安装 → 完成真实任务；并覆盖依赖缺失补齐、客户端不兼容、依赖停用、安装或更新失败（AG-SC-011）。两个 Hub Skill 的 ID 仍是示意，需嘉宇确认真实可用。

## 与 Hub 侧规格的分工

| Brief 项 | 客户端承接 | Hub 侧职责（客户端只展示结果） |
|---|---|---|
| S3-01 Agent 定义与官方发布 | 展示 Agent 定义、版本、依赖与安全结果；官方 Agent 的草稿与发布由 Hub 运营端完成 | 草稿、发布、审计、发布物核对、发布失败不破坏当前有效版本 |
| S3-02 用户贡献 | 入口、登录前提、提交预览、剥离、授权声明、提交、反馈、修改重提、新版贡献 | 鉴权、公开 Skill 校验的权威判定、条款闸门、幂等去重 |
| S3-03 贡献审核与发布 | 展示审核状态、退回原因；不承接审核与发布操作 | 审核详情、固定版本、通过/退回、发布权限、记录 |
| S3-04 发现、安装与真实使用 | 目录与详情、依赖清单与安装确认、依赖获取与兼容校验、失败恢复、安装后入口与任务执行 | 目录数据、依赖元数据、发布物与摘要 |
| S3-05 更新、停用与用户控制 | 更新检查、卸载、停用与恢复、转为我的版本、在途任务固定版本 | 新版发布、停用/恢复状态下发 |
| S3-06 安全与联合验收 | 安装前完整性校验、风险展示、本地扫描、双平台真实任务验证 | Hub 侧扫描、等级与摘要记录、联合验收环境 |

## 复用与缺口

> 代码位置按基线 `origin/develop` `5491969e` 核对。

| 能力 | 现状（已核对） | 结论 |
|---|---|---|
| 智能体页 | `src/renderer/index.html` `#panel-agents`：分类 + 搜索 + 「+ 创建」「更多」+ 分组卡片网格；卡片由 `modules/agents.js::renderAgentsGrid` 渲染（`.agent-card.ui-resource-card`，操作行含「使用」） | 在此页加「我的贡献」按钮、自建卡片上加「贡献」按钮；不新增页面 |
| 「更多」市场 | `index.html` `#panel-marketplace`、`modules/marketplace.js`：已有 Agents / Skills 两个 Tab、卡片、详情页，已有「安装 / 更新 / 卸载 / 已停用 / 需 CogSeed x.y+」等按钮状态 | 可复用；需补：详情页的依赖清单（两类来源）、安装前确认、安全校验结果 |
| Agent 安装 | `marketplace.ts` 文件头：Agent 安装先并行装齐 `skill_list` 里缺失的依赖，**任一依赖失败则整个 Agent 安装失败，Agent 不会被记录** | 可复用，与「依赖未准备好不误报可用」一致 |
| Agent 定义 | `modules/agents.js` 与 `src/main/features/agents.ts`：`agent.json` 含 `agent_id, name, description, workflow, skill_list …`，来源 `marketplace` / `custom` | 可复用；「适用场景、输入、交付标准」是否新增字段见 D-01 |
| 贡献入口 | Skill：`modules/skills.js` 卡片上的「贡献」按钮；`modules/hub-contributions.js` 把「我的贡献」按钮插入「更多」之前 | Agent 照此做，不另起交互 |
| 贡献链路 | `src/main/features/contribution/` 15 个文件、`hub-contributions.js` 贡献页与「我的贡献」页；规格见 `specs/001-hub-skill-contribution/` | 复用登录提示、条款、预览、声明、状态与幂等；**该目录没有任何 Agent 逻辑，001「只做 Skill」** |
| Skill 安装/更新/停用 | `marketplace_installs.ts`、`marketplace-update-policy.ts`、`marketplace_reconcile.ts` | 复用作依赖安装与治理；需补：依赖被停用/更新对已装 Agent 的影响 |
| 安全扫描 | 既有 `skill-sentry`、`declaration-core`（001 C-FR-003c） | 复用；Agent 本体需补哪些，由吴嘉宇确认（D-04） |

**缺口（本迭代需新增）：** Agent 的提交打包（含引用清单与随包的自建 Skill）、本机处理（凭据、Connector 配置、本机路径、明显密钥格式）与预览、依赖情形的识别与校验（预置 / 需下载 / 随 Agent 提交）、**Agent 发布物摘要（Skill 已有 `artifact.sha256`，Agent 的目录项与详情目前没有）**、贡献接口的 Agent 内容类型（现有提交清单的 `content_type` 只有 `skill`）、安装前确认、Agent 与依赖的联动停用提示、「我的贡献」的类型切换。

## 用户场景与测试

### 用户故事 1：用户从「更多」发现并安装 Agent，并完成一次真实任务（优先级：P1）

用户在智能体页点「更多」，进入 Agent 市场，点开「报销材料预检助手」，看到：名称与说明、工作流程与交付结果、使用前提、引用的 Skill（分「需从 Hub 下载」「Hub 分发中的预置」两组并标明状态）、作者与来源、版本、客户端兼容要求、安全检查结果。点「安装」，弹出安装确认，列出将安装的 Agent 与缺失的依赖，确认后一次性装好。装好后 Agent 出现在智能体页「平台」区，用户选用它并上传报销材料，得到补件清单与材料摘要。

**验收场景：**
1. **Given** 市场里有已发布的 Agent，**When** 打开详情，**Then** 必须展示详情页要求的全部信息，依赖按来源分组、各自标明「已具备 / 需安装 / 不可用」。
2. **Given** 本机缺少某个 Hub 分发的依赖，**When** 点安装，**Then** 先展示依赖清单与来源，确认后才开始下载；确认前不写入本机。
3. **Given** 全部依赖就绪，**When** 安装完成，**Then** Agent 出现在智能体页「平台」区，可发起任务并产出预期交付物。
4. **Given** 任一依赖安装失败，**When** 安装结束，**Then** Agent 不进入可用状态、不出现在智能体页，错误原因可读，重试不破坏已有内容。
5. **Given** 依赖是随客户端预置的 Hub 内容且本机已具备，**When** 安装，**Then** 直接复用，不要求从 Hub 下载。
6. **Given** Agent 声明的最低客户端版本高于本机（市场项的 `min_app_version`，客户端已有「需 CogSeed x.y+」提示），**When** 查看详情或安装，**Then** 提示「需 CogSeed x.y+」，按钮停用，不显示 Agent 已可用。

### 用户故事 2：用户贡献自己创建的 Agent（优先级：P1）

用户在智能体页「自定义」区的自建 Agent 卡片上点「贡献」（与 Skill 一致）。未登录先弹出统一登录提示。登录后客户端在本机检查并处理，随后展示**提交预览**：将提交的文件（含随包的自建 Skill 文件）、**引用的技能**（Hub 分发含预置：仅引用、不随包；本机自建：随 Agent 一起提交）、**已自动处理的内容**。用户选择来源、接受条款与共享授权，并**确认「自建 Skill 会随 Agent 一起提交」**（提交方式待 D-07）后提交固定版本。一个按钮、一次确认。

**验收场景：**
1. **Given** Agent 引用了本机自建的 Skill，**When** 生成预览，**Then** 清楚提示「该 Skill 会随 Agent 一起贡献并公开」，用户勾选确认才能提交，不同意就不能提交。**【待书面确认，见 D-07】**
2. **Given** Agent 引用的是 Hub 分发（含预置）的 Skill，**When** 生成预览，**Then** 仅作引用展示，**不提示、不阻断**。
3. **Given** Agent 含 Connector 配置或凭据，**When** 生成预览，**Then** 这些内容在提交副本中被处理，并在预览中列出；用户本地原 Agent 不被改写。
4. **Given** 内容中含最明显的敏感格式（如 SSH 私钥、pem），**When** 检查，**Then** 阻断提交并指出文件与行；客户端只拦这类明显格式，不承诺识别所有隐私，内容由用户自己负责。
5. **Given** 预览已生成，**When** 提交前内容有变化，**Then** 要求重新检查与预览；**实际提交内容与预览逐项一致**。
6. **Given** 来源、条款、共享授权、同时贡献确认缺任一项，**When** 点提交，**Then** 提交按钮不可用并指出缺项。
7. **Given** 未登录，**When** 点贡献，**Then** 弹出统一登录提示，登录后回到原操作；取消或失败时不检查、不上传。

### 用户故事 3：用户在「我的贡献」查看状态，处理退回、重提与新版（优先级：P1）

「我的贡献」入口在智能体页工具栏（「更多」旁）。该页 **Agent 与 Skill 放在同一页，用类型切换**，状态有：待审核、已退回（含原因）、已通过待发布、已发布。「通过审核」与「已发布可获取」是两件事。被退回后修改重提视为**新提交**；已发布的可由作者提交新版本。

**验收场景：**
1. **Given** 提交已通过但未发布，**When** 查看，**Then** 显示「已通过，待发布」，且**不出现在市场里**。
2. **Given** 提交被退回，**When** 修改后重提，**Then** 生成新的提交版本，重新检查、预览、声明与审核。
3. **Given** 提交时断网或响应丢失，**When** 重试，**Then** 不产生重复投稿；明确告知「已到达」或「未到达」，无中间态；本地内容保留。
4. **Given** 切换类型为「技能」，**When** 查看列表，**Then** 只显示 Skill 的贡献，状态与操作一致。

### 用户故事 4：另一用户安装贡献的 Agent 并使用（优先级：P1）

用户 B 在 Agent 市场里看到已发布的社区贡献 Agent，来源标识为「社区贡献 + 贡献者显示名」，作者与来源可追溯。安装与使用同用户故事 1。若该 Agent 随包带了贡献者的自建 Skill，这些 Skill 作为已公开的「用户贡献」来源出现在依赖里。

### 用户故事 5：更新、停用、卸载与转为我的版本（优先级：P2）

操作发生在**智能体页的卡片与详情**里，没有单独的「已安装管理」页。
1. 发布新版后，客户端提示可更新；更新前展示变化（含依赖变化）；**更新失败保留旧版**；**运行中的任务不替换版本**，新任务才用新版。
2. 停用后阻断**新的**使用，在途任务保持固定版本；恢复后可重新使用。
3. 依赖被停用/更新/卸载时，受影响的 Agent 卡片显示明确状态（如「依赖已停用」，「使用」停用），不静默替换，不误报可用。
4. 卸载 Agent **不连带删除**其他 Agent 共用的 Skill；用户主动卸载后**不自动装回**。
5. 「转为我的版本」生成用户自有副本，之后不被远程修改；更新与停用均不得操作用户任务、设置和私人内容。

### 用户故事 6：安全校验与篡改拒绝（优先级：P1）

安装前客户端校验最终发布物摘要与 Hub 记录一致；不一致、扫描失败或不可用时**不显示校验通过**，不安装，保留原有可用版本并给出原因。详情页展示可理解的风险/安全等级、来源与摘要。

### 边界情况

- **Hub 引用的 Skill 不存在 / 未公开 / 已停用 / 不兼容**：分别给出原因与处理出口；提交阶段由 Hub 判定，安装阶段由客户端阻断。
- **Agent 的最低客户端版本高于本机**：提示「需 CogSeed x.y+」，不显示可用。**系统内置 Skill**（8 个，名字形式的 ID）能否被 Agent 引用尚未核实，本期不作为依赖来源（D-10）。
- **扫描失败 / 扫描不可用 / 摘要不一致**：不得显示通过；保留旧版。
- **未登录、断网、重复点击、响应丢失**：保留本地内容；重试幂等。
- **Hub 不可用**：已安装且有效的内容沿用上次有效状态；审核标识不替代执行时的用户授权。
- **护网期间服务器可能关闭**：Hub 相关功能（登录、Skill/Agent 分发、应用更新）不可用，本地功能不受影响，发版不受影响（会上尚未最终确定）。

## 需求

> 编号 `AG-FR-xxx`。涉及 Hub 接口的条目为草案，见 contracts。

### 功能需求

**发现与详情（S3-04）**

- **AG-FR-001**：客户端 MUST 沿用 Skill 的发现逻辑：在智能体页提供「更多」按钮，进入 Hub Agent 市场（现有 `#panel-marketplace` 的 Agents Tab），展示 Hub 分发的 Agent 并可安装。MUST NOT 新增页面、菜单或「更多发现」入口。
- **AG-FR-002**（S3-01/S3-04）：详情 MUST 展示：名称与说明、工作流程与交付结果、引用 Skill（分「Hub 分发」「Hub 分发中的预置」两组并标状态）、使用前提、作者与来源、版本与更新说明、客户端兼容要求、安全检查结果。
- **AG-FR-003**（S3-04）：社区贡献内容 MUST 显示「社区贡献 + 贡献者显示名」来源标识。

**依赖与安装（S3-04）**

- **AG-FR-010**：安装前 MUST 展示依赖清单（来源类型、版本要求、本机状态），用户确认后才开始获取；确认前不写入本机。
- **AG-FR-011**：依赖按情形 MUST 分别校验：Hub 分发——记录内容 ID（12 位十六进制）、版本要求、可用状态，缺失则提供获取与安装；Hub 分发中的预置——本机已具备（随客户端预置，`seed_source=builtin`）时直接复用、无需下载，联网后由市场对账接管；随 Agent 提交的自建 Skill——按 D-07 的提交方式处理。**系统内置 Skill（8 个，名字形式的 ID）能否出现在 Agent 的 `skill_list` 中未核实，不作为依赖来源（D-10）。**
- **AG-FR-012**：任一依赖未就绪或安装失败时，Agent MUST NOT 进入可用状态、MUST NOT 出现在智能体页；重试 MUST NOT 破坏已有可用内容。（沿用 `marketplace.ts` 既有「依赖失败则整体失败」语义。）
- **AG-FR-013**：Agent 声明的最低客户端版本（市场项 `min_app_version`）高于本机时，MUST 提示「需 CogSeed x.y+」并停用安装，不显示 Agent 已可用。
- **AG-FR-013a**（产品第 2 条）：用户点"安装"后，客户端 MUST 自动检查并补齐所需 Skill（Hub 依赖与随包私有 Skill），确认框 MUST 列出"将同时安装"的内容；全部就绪后才 MUST 显示 Agent 可用；只有无法自动解决（依赖停用、客户端版本不够、网络不可用、摘要不符）才提示原因与处理办法。
- **AG-FR-013b**（产品第 3 条，待 D-13）：已有且可用的 Skill MUST 复用而不升级；安装或更新 Agent MUST NOT 影响其他已可用 Agent 与在途任务；任一失败 MUST 保留原有可用状态。
- **AG-FR-013c**（产品第 4 条，待 D-07/D-14）：随包私有 Skill MUST 装在该 Agent 名下，不进用户自己的 Skill 列表，MUST NOT 覆盖用户同名 Skill；随 Agent 一并提交、审核、发布、安装，并 MUST 纳入安全检查。
- **AG-FR-072**（Hub 2026-10-12，MUST）：客户端对 Hub 的**每个**市场与贡献请求（Agent 目录、详情、发布物下载、内置能力清单、提交、我的贡献）MUST 携带 `CogSeed-Channel`，取值与归一规则同 A-01；Hub 的企业线／开源线隔离依赖于此。跨通道的失败按"内容不存在"处理，客户端不得据此推断另一条线的内容。
- **AG-FR-073**（Hub 2026-10-12）：包上限（压缩 ≤ 8 MiB、文件 ≤ 200、解包 ≤ 10 MiB、压缩比 ≤ 100:1）本机预检 MUST 从契约读取，MUST NOT 硬编码；其中"200"最终值可能调整。
- **AG-FR-074**（Hub 2026-10-12）：`skill_list` 每项 MUST 为三类之一：12 位十六进制（Hub Skill，下载）、`builtin:<name>`（客户端内置能力，直接用本机、不下载，本机不具备则不得显示可用）、其他名字形式（随包私有 Skill，必须对应包内目录）。
- **AG-FR-014**：安装成功后，Agent MUST 出现在现有智能体页「平台」区，可选用并执行任务。

**安全与完整性（S3-06）**

- **AG-FR-020**：安装前 MUST 校验最终发布物摘要与 Hub 记录一致；不一致、扫描失败或不可用时 MUST NOT 显示通过、MUST NOT 安装，并保留原有可用版本。
- **AG-FR-021**：客户端 MUST 展示可理解的风险/安全等级及来源与摘要；审核标识 MUST NOT 替代执行时的用户授权。
- **AG-FR-022**：本地扫描范围与阻断标准待 D-04（Agent 本体主要是提示词，会上判断风险较低，主要扫随包脚本）。

**贡献（S3-02）**

- **AG-FR-030**：客户端 MUST 在智能体页「自定义」区的自建 Agent 卡片上提供「贡献」按钮（与 Skill 一致）；平台内置与从 Hub 安装的官方 Agent 不提供。可贡献对象的最终范围见 D-03。
- **AG-FR-031**：未登录点击贡献 MUST 复用统一登录提示；登录成功回到原操作；取消/失败时不检查、不上传。
- **AG-FR-032**【待书面确认，D-07】：Agent 引用的 Skill 在客户端里有三种情形（Hub 分发、Hub 分发中的预置、随 Agent 提交的自建 Skill）。引用 Hub 分发或预置的 Skill 属于链接，**MUST NOT 提示、MUST NOT 阻断**。Agent 含本机自建 Skill 时，**MUST NOT 阻断**，而 MUST 在提交前明确提示「这些 Skill 会随 Agent 一起提交」，并要求用户确认；不同意则不提交。**这些 Skill 提交后是作为 Agent 私有 Skill 包（现有机制：`agent_skills_bundle_url` / `ownerAgent`，只给该 Agent 用）还是作为独立公开的 Skill，不默认等同，待 D-07 确认。**体验上 MUST 是一个按钮、一次确认，不拆成两个流程。无法判定来源或获取的引用 MUST 阻断并指出具体引用。
- **AG-FR-033**：本机处理 MUST 在客户端完成，Hub 不需要知道处理了什么，被处理的内容 MUST NOT 上传。客户端 MUST 处理最明显的敏感内容（凭据、Connector 配置、本机路径），并对最明显的密钥格式（如 SSH 私钥、pem）阻断提交并定位到文件与行。客户端 MUST NOT 承诺识别所有隐私；规则 MUST NOT 做成需要长期维护的庞大规则库；用户对自己提交的内容负责。MUST NOT 上传任务历史、私人文件、私人实例信息。
- **AG-FR-034**：客户端 MUST 展示提交预览，含将发出的文件、引用清单（含「将同时贡献」的自建 Skill）与已处理内容清单（仅本机展示、不上传）；**实际提交内容 MUST 与预览逐项一致**；预览之外的任何本机数据 MUST NOT 随提交发出。
- **AG-FR-035**：处理 MUST 只作用于提交副本，本地原 Agent MUST NOT 被改写。
- **AG-FR-036**：来源声明（原创 / 派生自 Hub 内容 / 基于第三方材料）、条款接受、共享授权，以及（有自建 Skill 时）同时贡献确认，缺一 MUST 拒绝提交并指出缺项。
- **AG-FR-037**：提交 MUST 固定当前内容版本；审核 MUST 绑定该具体提交版本。
- **AG-FR-038**：提交 MUST 幂等：断网/响应丢失后重试不产生重复投稿；明确告知「已到达」或「未到达」，无中间态；本地内容保留。
- **AG-FR-039**：修改后重提 MUST 视为新提交并重新校验与审核，不沿用对旧内容的批准。

**审核反馈与状态（S3-03）**

- **AG-FR-040**：「我的贡献」MUST 保留，Agent 与 Skill 放在同一页，用类型切换；状态区分：待审核、已退回（含原因）、已通过待发布、已发布。「通过审核」与「已发布可获取」MUST 区分展示。入口在智能体页工具栏。
- **AG-FR-041**：未发布的投稿 MUST NOT 出现在市场里；无权限者 MUST NOT 能审核/发布/治理（权限在 Hub，客户端不提供入口）。
- **AG-FR-042**：作者 MUST 能对已发布内容提交新版本，版本号 MUST 高于当前最高已发布版本（本机阻断）；稳定 ID 自动关联且不可改。
- **AG-FR-043**：申请撤回、作者新版、同人审核发布等规则待 D-03，不在本文预设。

**更新、停用与用户控制（S3-05）**

- **AG-FR-050**：更新失败 MUST 保留旧版；运行中任务 MUST NOT 被替换版本。停用、更新、卸载 MUST 在现有智能体页的卡片与详情里完成，MUST NOT 新增「已安装管理」页。
- **AG-FR-051**：停用 MUST 阻断新的使用、在途任务保持固定版本；恢复后可重新使用。
- **AG-FR-052**：依赖更新/停用/卸载对 Agent 的影响 MUST 明确展示（如卡片状态「依赖已停用」）；MUST NOT 静默替换，MUST NOT 误报可用。
- **AG-FR-053**：卸载 Agent MUST NOT 连带删除其他 Agent 共用的 Skill；用户主动卸载后 MUST NOT 自动装回。
- **AG-FR-054**：「转为我的版本」后内容 MUST NOT 被远程修改；更新与停用 MUST NOT 操作用户任务、设置和私人内容。
- **AG-FR-055**：Hub 不可用时，已安装且有效的内容 MUST 沿用上次有效状态。

**跨切面与边界**

- **AG-FR-060**：所有新增可见文案 MUST 进入 renderer/main locales，支持中英文。
- **AG-FR-061**：本地检查、依赖安装、上传等耗时操作 MUST 提供可见进度；上传 MUST 可取消。
- **AG-FR-062**：日志与遥测 MUST NOT 记录 Agent 正文、凭据或本机路径；只记录提交 ID、稳定 ID、状态、计数、耗时与粗粒度错误类型。
- **AG-FR-063**：renderer 实现 MUST 遵守 `AGENTS.md`：原生 HTML/CSS/JS、仅经 `window.cogseed.{invoke, stream}`、IPC 处理函数不含业务逻辑、新增 npm 依赖需先讨论。
- **AG-FR-070**：本期 MUST 只改「智能体」这一项内部。一级菜单与二级菜单（智能体 / MCP与工具 / 技能 / 资料库 / IM）、其他模块的入口与页面 MUST NOT 被改动或移除。
- **AG-FR-071**：原型 MUST 是与真实客户端结构一致的高保真原型（真实侧栏、页头、二级菜单与组件），实现后效果 MUST 与原型一致。

### 关键实体

- **Agent 定义**：名称、说明、工作流程、交付标准、图标/分类、作者来源、引用 Skill 列表、使用前提；沿用 `agent.json`，新增字段见 D-01。
- **引用（Skill Reference）**：`{情形: hub | preset | bundled, 内容 ID, 版本要求}`；`preset` 是 Hub 分发中随客户端预置的内容（12 位十六进制 ID，运行时标为 `builtin`）；`bundled` 是随 Agent 一起提交的本机自建 Skill，提交方式待 D-07。
- **提交副本与处理报告**：用于贡献的最终内容及本机处理项清单；只存本机，预览为其只读快照，处理项不上传。
- **提交（客户端视角）**：提交 ID（Hub 分配）、关联本机 Agent、稳定 ID、固定版本、状态、退回原因、提交时间、是否同时贡献了 Skill。
- **发布物与摘要**：稳定内容 ID、版本、来源作者、提交内容原始摘要、最终发布物摘要；客户端校验最终发布物摘要。
- **安装状态**：已安装 / 依赖未就绪 / 已停用 / 可更新 / 已转为我的版本。

## 成功标准

### 可衡量结果

- **AG-SC-001**：官方供给——运营发布种子 Agent，另一用户从目录安装，在原入口完成一次真实任务并产出预期交付物；**macOS 与 Windows 各验一遍**（组合待 D-05）。
- **AG-SC-002**：用户贡献——用户 A 预览并提交，经审核发布后用户 B 安装并完成任务；作者与来源可追溯。
- **AG-SC-003**：含最明显敏感格式（如私钥）的 Agent 100% 在客户端阻断，上传请求为零；凭据、Connector 配置、本机路径 100% 在提交副本中被处理；含本机自建 Skill 的 Agent 在用户未确认「同时贡献」时 100% 不能提交（待 D-07 确认）；预览清单与 Hub 实收清单逐项一致（抓包对照）。
- **AG-SC-004**：两类依赖的缺失、停用、不兼容、准备失败各有明确提示；100% 不误报可用；已有内容不被破坏。
- **AG-SC-005**：篡改的发布物 100% 拒绝安装；扫描失败/不可用/摘要不一致 100% 不显示通过且保留旧版。
- **AG-SC-006**：更新失败保留旧版；运行中任务版本固定；停用阻断新使用、恢复后可用。
- **AG-SC-007**：在上传过程中人为断网并重试 10 次，Hub 侧待审核提交始终只有 1 条，客户端 10 次均给出明确结论。
- **AG-SC-008**：卸载不连带删除共用 Skill；主动卸载后不自动装回；一级、二级菜单与其他模块入口与改动前逐项一致（AG-FR-070）。
- **AG-SC-009**：日志与遥测抽样 100% 不含 Agent 正文、凭据或本机路径。
- **AG-SC-010**：断网、重试及 Hub 不可用场景在确定的 macOS/Windows 组合上完成验证。
- **AG-SC-011**（产品第 5 条）：至少用一个**同时依赖 Hub 已发布 Skill 和随包私有 Skill** 的 Agent，走通贡献 → 审核 → 发布 → 另一客户端安装 → 完成真实任务；并覆盖依赖缺失时自动补齐、客户端不兼容、依赖停用、安装或更新失败，状态准确、异常有处理办法。

验收以固定 Hub / 客户端版本、测试环境、实际 Agent 与 Skill 版本及结果记录为依据；后台发布成功、接口通过或原型演示**不能**单独代表 S3 完成（Brief §8）。

## 组件对照表

原型的外壳与页面结构直接对照客户端真实页面（`src/renderer/index.html`）：一级侧栏 → 「智能体 / 技能 / 连接」页 → `connections-tabs` 二级菜单 → `#panel-agents`；样式按 `index.html` 的真实顺序加载客户端 CSS，控件来自 `ui*.js` 组件工厂。这是对照 `design/opensource-design-system/AGENTS.md`「页面优先复用现有按钮、字段、状态、筛选、空状态、确认、页头和浮层」的结果。

| 用途 | 使用的客户端组件 / 结构 | 来源 |
|---|---|---|
| 一级侧栏、页头、二级菜单 | `.sidebar`、`uiPageHeader`、`.connections-tabs.ui-tabs`（原样，不改动） | `index.html`、`ui-page-header.js` |
| 智能体页：分类、搜索、「+ 创建」「更多」、分组卡片 | `agents-resource-toolbar`、`uiSegmentedControl`、`uiInput`、`uiButton`、`.agent-card.ui-resource-card` | `index.html #panel-agents`、`agents.js` |
| 市场页：返回、Tab、搜索、卡片、详情头 | `#panel-marketplace` 的 `marketplace-*` 结构与 `uiButton` | `index.html`、`marketplace.js` |
| 按钮、状态、依赖状态、来源标识 | `uiButton`、`uiStatusPill`、`uiBadge`、`uiTag` | `ui-button.js`、`ui-status.js` |
| 弹窗（安装确认、停用、卸载、登录、重提） | `uiModal` | `ui-modal.js` |
| 进度、空状态、表单控件 | `uiProgressBar`、`uiEmptyState`、`uiInput`、`uiField`、`uiCheckbox` | `ui-status.js`、`ui-empty.js`、`ui-form.js` |
| 贡献页、我的贡献页 | `hubc-*` 布局（回退行、步骤条、面板、检查行、文件预览、提交条、列表/详情） | `hub-contributions.css`（Skill 贡献整页已在用） |
| 阻断/警告提示 | `hubc-alert`（`role="alert"` / `role="status"`） | 同上 |

**客户端目前没有对应组件、原型里用 `ap-*` 新增的部分（需设计评审，只用 token）：**

| 新增 | 用在 | 评审建议 |
|---|---|---|
| `ap-note`（成功/信息提示条） | 市场详情「安装将同时获取依赖」 | 设计系统有 `Alert`，客户端尚无对应 CSS/工厂；建议补共享 Alert |
| `ap-dep` 依赖行（名称 + 来源标签 + 状态 + 说明） | 市场详情、已装详情、贡献预览引用清单 | 可能抽成共享「依赖行」 |
| `ap-strip` 已处理清单 | 贡献预览 | Agent 贡献特有 |
| 「依赖的技能」「版本与更新」区块 | Agent 详情（已装与市场） | 真实 Agent 详情无依赖区块，需评审位置 |
| 卡片上的「社区贡献」「依赖已停用」「有更新」chip | 智能体页、市场卡片 | 沿用 `agent-card-chip`；真实平台 Agent 目前不展示来源 chip |
| 「我的贡献」类型切换（智能体 / 技能） | 我的贡献页 | 复用 `uiSegmentedControl`，位置需评审 |
| 贡献预览的「同时贡献的技能」确认 | 贡献页 | 复用 `uiCheckbox`，文案待 D-07 确认后定 |

**原型外框（不是产品组件）：** 外层评审导览条，真实客户端里没有，只常驻 4 个主流程入口，其余收在「更多场景」里。各种异常情况（安装失败、摘要不一致、扫描未完成、依赖停用、需更新客户端、更新失败、私钥拦截、未登录）都应能通过真实入口点出来，见 README「怎么点出各种情况」。原型里模拟的账号与提示文字仅为演示。

**已知差异：** 来源声明在 Skill 贡献页是 `uiField` 的 `select`（需 `hydrateUiFormSelects` 接线），原型为避免接线用 `uiSegmentedControl`（三选一）；实现时以 Skill 贡献页为准。原型不加载 `agents.js` 等业务脚本（依赖 IPC），卡片标记按其渲染结果手写，实现时以真实渲染函数为准。侧栏的最近任务与账号条使用真实客户端标记（`conv-item`、`uiUserMenuTrigger`），内容为示意数据。

## 待决策（由产品/双端确认，客户端不以默认值代替）

| 编号 | 问题 | 客户端推荐 | 确认对接 |
|---|---|---|---|
| D-01 | 「适用场景 / 输入 / 交付标准」是新增独立字段，还是放入 `workflow` 文本；Agent 标准以客户端现有定义为准（提示词 + Skill） | 新增结构化字段便于详情展示；与 Hub 字段对齐 | 中扬、雨萱、嘉宇 |
| D-02 | 「内置清单」是否还需要、由谁提供：代码核实显示随包预置的内容本来就是 Hub 同款 ID，Hub 应已知；只有系统内置 Skill（名字形式 ID）才可能不在 Hub。另：引用固定版本还是兼容范围；依赖更新/停用如何影响 Agent | 若系统 Skill 不能被引用（D-10），就不需要单独的内置清单；若需要，可由 `_manifest.json` 的 `inventory` 生成。**注意随包预置内容可能先于 Hub 发布（`builtin_marketplace.ts` 注释），需核实预置的是否都已在 Hub 上** | 中扬、雨萱、嘉宇 |
| D-03 | 可贡献对象、来源授权、作者新版、申请撤回、审核/发布权限、是否允许同人操作 | 沿用 Skill 贡献链路口径；审核与发布 Hub 侧不要合成一件事（会上意见） | 中扬、嘉宇；雨萱对齐体验 |
| D-04 | 安全裁决：Agent 本体需扫哪些（会上判断主要是随包脚本，提示词风险低）、阻断/告知标准、签名是否延期 | 阻断最明显的密钥格式与不明外连；扫描不可用一律不显示通过 | 嘉宇确认、中扬、安全协作人 |
| **D-13** | **依赖版本规则**（产品要求补齐）：已有时复用还是升级、装完依赖更新怎么办；不得影响其他 Agent 与在途任务；失败保留原状态。Hub 目录只返回最高已发布版本，最高版本不兼容时无法回退 | 已有且可用则复用不升级；缺失装最高版本，不兼容则阻断；更新走 Skill 自己的通道。见 `contracts/agent-api-proposal.md` §8.2 | 中扬、嘉宇 |
| **D-14** | ~~随包 Skill 的安全检查口径~~ **Hub 2026-10-12 已定：a**，每个随包 Skill 带 `references/security-manifest.yaml`，与社区 Skill 同标；Hub 新建"包内多 Skill 各自声明"校验 | — | — |
| D-05 | 支持组合与容量：Hub/客户端版本、macOS/Windows 验收组合、实名分工与估算 | Windows 需先确认真实任务依赖不含仅 `darwin-arm64` 的组件 | 张超协调；海运对齐 |
| D-06 | 种子场景：报销预检（B-lite）还是简历/个人主页（A） | 选 B-lite 前先确认两个 Hub 公开 Skill 真实存在，否则退回 A | 中扬、雨萱、嘉宇 |
| **D-07** | **自建 Skill 随 Agent 提交——产品 2026-10-10 书面答复：本期支持，不要求先单独发布；纳入安全检查，明确归属与隔离，不覆盖用户同名 Skill；要求同步修改 Brief。**实质为 A（Agent 私有包）加安全检查与隔离，不是独立公开。与 Hub 答复第三节（本期不随包）冲突，Hub 自称需先与中扬确认，**须确认产品文字在 Hub 答复之后**；200 文件额度与工作量由 Hub 重估 | 按产品执行；规则提案见 `contracts/agent-api-proposal.md` §8 | 中扬、嘉宇 |
| **D-08** | **Agent schema（协议）：Hub 与客户端之间传递的 Agent 含哪些文件**；剥离用排除法还是白名单（会上说由实施方案定） | 先于 API 定；基于客户端现有 `agent.json` 定义 | 雨萱、嘉宇；**草案见 `contracts/agent-package.schema.json`、`contracts/shared-contract-plan.md`** |
| **D-09** | **Agent 发布物摘要**：Skill 的目录项有不可变的 `artifact{sha256,size_bytes,format}` 并在下载时校验，Agent 的目录项与详情（`MarketplaceAgent` / `AgentDetail`）目前没有，AG-FR-020 的摘要校验需 Hub 新增字段 | Hub 为 Agent 与其私有包提供同形态的 `artifact` | 嘉宇 |
| **D-10** | **系统内置 Skill 能否被 Agent 的 `skill_list` 引用**：代码证据倾向于不能（见「代码核实」），**尚未运行验证，本文不写成已支持** | 验证前不把系统 Skill 当依赖来源；验证通过后再决定要不要进 Agent 协议 | 雨萱核实、嘉宇 |
| **D-11** | **Hub 侧 Agent 能力是全新建设**：目录（对应 A-01）、包（A-02）、事件（A-03）、贡献（C-02 的 `content_type` 扩展）、停用与反向依赖检查（会上提出，未找到现有实现）。Hub 已表态：先共同确认目标契约，再补端点与测试 | 在 Hub 仓库新开 Agent 规格，沿用 A-/C- 编号与跨仓交接包；本文 `contracts/` 作为客户端镜像；顺序见 `shared-contract-plan.md` | 嘉宇、中扬 |
| **D-12** | ~~Hub 路线图写"客户端提交 Agent 不在本迭代"~~ **已解决（2026-10-10）**：产品与 Hub 均确认本期含用户贡献 Agent 完整流程，按 Brief 走；Hub 同步更新过期的四迭代排布。可分批开发，按整体验收 | — | — |

## 假设

- 本文仅覆盖客户端；Hub 侧规格、接口与权限模型以 Hub 端为准。已对照 Hub 仓库现有的 Skill 契约；**Hub 目前没有 Agent 契约**，Agent 部分的接口都是待联合确认的草案。
- 沿用 Skill 贡献链路的登录提示、条款闸门、预览、幂等与「我的贡献」交互；细节差异在 Plan 阶段核对。
- 内置报销 Agent（`c045605cb916`）及其飞书提交链路**不在本迭代范围**，不被修改。
- 旧版本兼容不考虑。
- 企业版、空间/自动化模板、跨设备同步、完整运营分析工作台、Connector 配置分发均不纳入（Brief §5）。私有 Skill 随 Agent 贡献：Brief 列为不纳入，评审会口头改为纳入，**待书面确认（D-07）**。
- 产品 2026-10-10 答复五条（含贡献纳入本期、依赖自动补齐、版本规则、私有 Skill 随包、真实任务闭环验收）已纳入；Brief 需据此同步修改。范围与口径以 Brief 及产品书面确认为准；Hub 路线图为参考，其与 Brief 的差异记 D-12。Skill 联合验收交接指出 C00~C06 尚未联合冻结，客户端遇契约缺口不自行猜测 endpoint、字段或错误码，Agent 沿用此原则。
- 本版 spec 与原型据评审会逐字稿（机器转写）整理，转写不准处以与会者确认为准。

