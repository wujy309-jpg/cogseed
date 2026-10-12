# 点对点确认清单：Agent 分发与贡献（开工前）

> 用途：和嘉宇（Hub）、中扬（产品）逐条确认，**确认完两边即可并行开工**。草案，2026-10-10。每条确认请记在末尾「确认记录」里：**结论 / 谁确认 / 日期**，口头定的也要补一句书面。
>
> 依据：客户端代码（基线 `origin/develop` `5491969e`）与 Hub 仓库 `cogseed-hub`（`origin/main`、`origin/codex/hub-open1-governance`）的只读核对。详见 `spec.md`「代码核实」、`contracts/client-hub-interface.md`「〇、Hub 现状」、`contracts/shared-contract-plan.md`。
>
> 研讨材料两份：**Agent 协议** = `contracts/agent-package.schema.json`（含夹具）；**两边接口** = `contracts/agent-api-proposal.md`。两份都是客户端单方草案。

## 一、先说背景（三句话）

1. **Hub 现在完全没有 Agent 能力。**旧的 `agents/list`、`agents/detail` 等路径，新 Hub 一律返回 `404 NOT_SUPPORTED`；Hub 内容类型固定为 `skill`，不预留分支。
2. **Hub 自己要求：先共同确认目标契约，再补端点与测试。**所以下面这些确认是开工的前提，不是形式。
3. **Skill 那边的教训：**两边各自开发，到真机联调才发现一个多余字段让所有合法贡献被拒。所以确认之后要先冻结 v1、尽早做最小联调。

## 一·补、以谁为准（冲突时按此裁）

| 问题 | 以谁为准 |
|---|---|
| 做不做 Agent 贡献、范围多大 | Brief v0.1 + 中扬书面确认（Hub 路线图为参考） |
| Agent 有哪些字段 | 客户端代码（`agents.ts`、`agent-creator`），为现有事实 |
| API 路径、错误码、摘要 | Hub 契约优先，客户端不猜 |
| 共用 schema 与夹具 | 双方联合冻结后才算数 |

> 之前没有出过 Agent 统一标准或两边接口：Hub 只有 Skill 契约（A-01~A-03、C-00~C-06），`agents/*` 返回 404 `NOT_SUPPORTED`；客户端规则分散，`p3394-gateway` 是外接 Agent 的运行时互通协议，与 Hub 分发无关。本清单配套的 schema 与接口文档均是客户端单方草案。

## 二、开工前必须确认（5 条，卡开工）

### ① Hub 做 Agent 的范围与节奏（D-11）

| 项 | 内容 |
|---|---|
| **问题** | Hub 要新建 Agent 的：目录（对应 A-01）、包（A-02）、事件（A-03）、贡献（C-02 的 `content_type` 扩展）、停用与治理。**一次做完，还是分批？** |
| **我的推荐** | **契约一次定完**（避免后补导致改动），**实现按依赖顺序排期**：先目录+包+安装（官方发布 → 用户安装闭环），后贡献+审核，因为贡献依赖包格式。Brief 要求两条主流程同轮交付到真实使用，具体排期以中扬为准 |
| **范围冲突（D-12）** | Hub《四迭代排布》迭代三写明「客户端提交 Agent 不在本迭代」，Brief S3 要求贡献。请中扬书面确认「Agent 贡献纳入本期」；路线图另有「提交链路按通用内容对象设计，供迭代三、四复用」，可作为 Hub 通用扩展 C-02 的依据 |
| **不确认的后果** | 客户端不知道什么时候能联调；契约分批定会反复改 |
| **找谁** | 嘉宇（排期）、中扬（范围） |

### ② Agent 包格式（D-08）

| 项 | 内容 |
|---|---|
| **问题** | 提交包里有哪些文件；哪些字段进协议；`agent_id` 提交时怎么和 Hub 的内容 ID 对应；`version` 能否出现在提交包里；本地外接 CLI Agent 是否排除；图标 `crown`（指挥官专用）是否排除 |
| **我的推荐** | 采用 `contracts/agent-package.schema.json` 的划分：协议 = `agent.json` 的**创作字段**（`name`、`description_zh/en`、`workflow`、`icon`、`color`、`category`、`skill_list`、`inputs`、`interactive`、`knowhow`、`standards`、`output_format`、`runtime: in_process`），加可选 `README.md` 与可选私有 `skills/`。**本机/用户相关字段**（`enabled_connectors`、`default_model`、`default_thinking`、`create_uid`）与**宿主专有字段**不进协议，客户端在本机处理掉，Hub 不需要知道。`agent_id`：提交时客户端用 `local_agent_id`（沿用 Skill 的做法，UUID），Hub 分配 12 位十六进制内容 ID。`version` 由提交清单的 `metadata` 给，`agent.json` 内不填。`runtime` 只允许 `in_process`。排除 `crown` |
| **不确认的后果** | schema 无法冻结，Hub 没法建模，客户端没法写提交体 |
| **找谁** | 雨萱 + 嘉宇 |

### ③ 随 Agent 提交的自建 Skill 怎么处理（D-07）

> **2026-10-10 更新：产品已书面答复：本期支持随包提交，纳入安全检查、明确归属与隔离。Hub 答复第三节与之冲突，需确认先后；200 文件额度与工作量由 Hub 重估；安全检查口径（D-14）待定。下面是原始问题，保留作记录。**

| 项 | 内容 |
|---|---|
| **问题** | 用户自建的 Skill 随 Agent 提交后，是 **A. Agent 私有包**（现有机制 `agent_skills_bundle_url` / `ownerAgent`，只给该 Agent 用），还是 **B. 独立公开的 Skill**（Hub 分配 ID，别人可单独装） |
| **事实** | 评审会口头定的，与 Brief v0.1 §5「不纳入」冲突。**B 的代价大：**Skill 社区贡献必须带 `references/security-manifest.yaml`（本体 `cogseed.security.skill@1.1.1`）并过 declaration-core 与深扫，每个自建 Skill 都要满足；A 复用现有安装机制，但「私有包的提交与审核」Hub 侧需新定义 |
| **我的推荐** | **本轮倾向 A**（成本小、复用现有机制），B 作为后续。**这是产品决定，以中扬为准**；我的推荐只基于成本 |
| **不确认的后果** | 包里要不要放 Skill 文件、Hub 要不要对这些 Skill 做安全声明检查，全悬着 |
| **找谁** | 中扬（决定）、嘉宇（评估 Hub 成本） |

### ④ Agent 发布物摘要（D-09）

| 项 | 内容 |
|---|---|
| **问题** | Skill 有不可变的 `artifact{sha256, size_bytes, format}`，客户端下载后复核；Agent 目前没有。Hub 是否为 Agent 的 `agent_json` 与私有包提供同形态字段？`format` 需要新值（现固定为 `skill-tree-v1`） |
| **我的推荐** | 同形态，直接对应 Brief 的「篡改发布物拒绝安装」 |
| **不确认的后果** | 「摘要校验」这条需求（AG-FR-020）做不了 |
| **找谁** | 嘉宇 |

### ⑤ Agent 的安全声明与检查（D-04）

| 项 | 内容 |
|---|---|
| **问题** | Skill 贡献必须带安全声明（本体 `cogseed.security.skill@1.1.1`）。Agent 要不要？检查范围是什么？ |
| **事实** | 客户端 `src/main/quality/` 已覆盖 Agent：规格形状检查 + 25 条红线（22 条 EXTREME 直接阻断），Agent 文本里的私钥、读取凭据、`curl \| sh` 等能拦；但对 Agent 结构的检查很松（只有 `agent_id`、`name` 缺失才严重） |
| **我的推荐** | **本轮不新增 Agent 本体**：Agent 文本走 `quality/` 红线 + 提交前的严格 schema 校验；随包的 Skill 脚本走现有深扫；Agent 本体留下一期。**需嘉宇与安全协作人确认** |
| **不确认的后果** | 无法确定提交的检查链，影响 ③ 的成本 |
| **找谁** | 嘉宇、安全协作人 |

## 三、开工后边做边确认（不卡开工）

| 项 | 要确认什么 | 备注 |
|---|---|---|
| D-10 系统 Skill 能否被 Agent 的 `skill_list` 引用 | 代码推断为不能（加载器不含系统 Skill 目录），**未运行验证** | 验证前不写成支持 |
| 存量内置 Agent 与严格 schema | 31 个内置 Agent 里 2 个不满足（名字含空格、`output_format: markdown`）；Hub 导入存量时先归一化还是放宽 | 见 `shared-contract-plan.md` §6 |
| 随包预置内容是否都已在 Hub 上 | 代码注释说预置内容可能先于 Hub 发布 | 影响依赖解析 |
| 停用 Skill 时检查是否被 Agent 依赖 | 会上提的新需求，Hub 里没找到现有实现 | Hub 运营端行为 |
| 路线图「交付标准」等 Agent 配置项与 `agent.json` 字段对应（D-01、D-12） | 路线图写「工作流程、能力描述、交付标准、相关引用」，核对与现有字段映射 | 嘉宇、中扬 |
| 错误码映射 | `CLIENT_VERSION_UNSUPPORTED`、`PACKAGE_DIGEST_MISMATCH` 等对 Agent 的含义 | 沿用 Skill 的 |
| 名字显示宽度 ≤ 60、保留名冲突 | schema 无法表达，校验放哪一端 | |
| D-05 Windows 验收组合、D-06 种子场景用的真实 Hub Skill | 种子 Agent 引用的 Skill 是否真实存在 | 影响联调数据 |

## 四、确认完之后做什么

1. **冻结 v1**：`agent-package.schema.json`、接口清单（能力追溯矩阵）、夹具，三样一起。
2. Hub 在 `cogseed-hub` 新开 Agent 规格目录（沿用 A-/C- 编号与跨仓交接包）；客户端 `specs/008/contracts/` 作镜像，写明读的 Hub SHA。
3. **请求体组装抽成无依赖叶模块**，联调脚本直接调用客户端真实代码，**不镜像**（Skill 的教训）。
4. 两边并行开发。
5. **尽早做最小联调**：提交一个最简单的 Agent → 审核 → 发布 → 另一客户端安装。不要等功能做完。
6. 联验记录分层写（真实界面 / Hub HTTP 联调 / 自动化 / 未执行），契约未冻结则不判通过。

## 五、确认记录

| # | 问题 | 结论 | 谁确认 | 日期 |
|---|---|---|---|---|
| ① | Hub 范围与节奏 | 贡献已纳入本期（D-12 已解决）；可分批，整体验收；排期待嘉宇 | 产品、Hub | 2026-10-10 |
| ② | Agent 包格式 | Hub 2026-10-12：v2 技术点全部采纳；`skill_list` 三类（新增 `builtin:<name>`）；名称规则由契约持有 | Hub | 2026-10-12 |
| ③ | 自建 Skill：A 私有包 / B 独立公开 | 产品：本期随包提交，不要求单独发布（实质 A 加安全检查与隔离）；Hub 第三节不同意，待对齐 | 产品 | 2026-10-10 |
| ④ | Agent 发布物摘要 | | | |
| ④ | Agent 发布物摘要 | Hub 2026-10-12：采纳，`agent-package-v1`，发布时只写 `_meta.json` | Hub | 2026-10-12 |
| ⑤ | Agent 安全声明与检查 | Hub 2026-10-12：随包 Skill 取选项 a（每个带 security-manifest，与社区 Skill 同标） | Hub | 2026-10-12 |
