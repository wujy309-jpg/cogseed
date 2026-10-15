# Contract: Client–Hub Agent Interface（草案）

> **状态：客户端草案，2026-10-11 按产品与 Hub 2026-10-10 答复更新，尚未联合冻结。**接口细节见 `agent-api-proposal.md`（v2）。**执行顺序：先定 Agent 定义（schema，D-08），再定 API。**

## 〇、Hub 现状（已读 Hub 仓库 `cogseed-hub`，本机 `~/Desktop/cogseed-hub`；分支 `origin/main`、`origin/codex/hub-open1-governance`）

> 这一节改变了下面「现有接口」的含义，请先读。

- **Hub 目前完全没有 Agent 能力。**Hub 的 Marketplace 只提供三个目录类端点：`POST /marketplace/skills/list`（契约 A-01）、`/marketplace/skills/bundle`（A-02）、`/marketplace/hub-content/events`（A-03），外加 `/marketplace/contributions/*`（C-00～C-06）。
- **旧的 Agent 目录接口，新 Hub 一律返回 `404 + NOT_SUPPORTED` 并附 `supported[]` 清单：**`categories`、`agents/list`、`agents/detail`、`agents/install`、`agents/upload`、`defaults`（`src/features/skills/unsupportedEndpoint.ts`、`src/app/(frontend)/marketplace/[...unsupported]/route.ts`）。
- **Hub 对此有明确立场（原文意思）：**不实现这些旧接口；它们属于「另一套服务端的契约」，Hub 仓里没有客户端期望形态，**凭 404 反推着补端点，等于用猜出来的契约对外提供 API**；要兼容，**必须先由 Hub 与客户端共同确认目标契约，再补端点与测试**。这正是 S3 现在的处境。
- **内容类型被刻意固定为 `skill`：**A-01 目录项 `content_type` 固定 `skill`、`artifact.format` 固定 `skill-tree-v1`；C-02 提交清单 `content_type` 非 `skill` 返回 `INVALID_REQUEST`；贡献的数据模型写明「假设（通用对象，不预留分支）」。**所以把内容类型扩到 Agent 是 Hub 侧数据模型和契约的新建设，不是加一个枚举值。**
- **Hub 的目录项形状（Skill，A-01）：**`content_id`（12 位小写十六进制）、`content_type`、`version`、`status` 与 `disabled`（必须一致，客户端只读 `status`）、`min_app_version`（空则不返回）、`artifact{sha256,size_bytes,format}`（客户端下载后复核）。
- **没有找到「停用某个 Skill 时检查是否被 Agent 依赖」的实现**（对 Hub 代码做 `git grep` 反向依赖相关词，无命中）。会上提的这条是新需求。
- **Hub 的契约文件在哪、怎么交接：**`specs/009-skill-import-publish/contracts/a01-catalog.md`、`a02-bundle.md`；`specs/010-client-contribution/contracts/c00～c06`、OpenAPI（`openapi/hub-contributions.openapi.yaml`，约 833 行）、跨仓交接包 `cross-repo-handoff-2026-09-23/24.md`；`specs/011-content-disable-restore/contracts/`；PRD 在 `docs/prd/`。Hub 远端是内部 GitLab（team-02）。

## 一、客户端对市场的既有调用形态（已核对客户端代码）

> **注意：**下面 `agents/list`、`agents/detail` 是客户端按**旧服务端**契约写的调用，**新 Hub 不提供**（见〇）。它们只能当作「客户端现有期望形态」，作为与 Hub 共同确认目标契约的**起点候选**，不能当成 Hub 已有接口。

### 1. 市场目录（Agent / Skill）`src/main/features/marketplace.ts`

| 接口 | 请求 | 响应要点 |
|---|---|---|
| `POST /marketplace/agents/list` | `{category, status, q, page, size}` | `{list: MarketplaceAgent[], total}`；`MarketplaceAgent`：`id, name, description_zh/en, category, icon, color, version, agent_skills_bundle_url?, create_uid, download_count, published_at, updated_at, default_install?, is_open_source?, status?, min_app_version?` |
| `POST /marketplace/agents/detail` | `{id}` | `AgentDetail`：`agent_json`（完整 agent.json）、`agent_json_url`、`agent_skills_bundle_url?`、`version, category, published_at, updated_at, create_uid, default_install, is_open_source, status, min_app_version?` |
| `POST /marketplace/skills/list` | 同上 | 目录行以 `content_id` 下发，客户端在接口边界归一为 `id`；时间 RFC 3339 → epoch 毫秒 |

- **Skill 元数据 `SkillMetadata`**（`marketplace/metadata-adapter.ts`）：`content_id, version, create_uid（官方恒 "0"，决定安全扫描档位）, status（客户端判停用的唯一判据）, min_app_version（缺席=无下限，空串而非 null）, category, published_at, updated_at?, artifact{sha256,size_bytes,format}, name, default_install, is_open_source`。
- **Skill 下载与校验**：按 `artifact` 校验，从 Hub 源取得不可变发布物。
- **Agent 安装**：先下载 `agent_skills_bundle_url` 私有包，再并行安装缺失的独立 Skill，**任一失败整个 Agent 不记录**；最低版本不满足时拒绝安装（`_assertMarketplaceAppCompatible`）。

### 2. 贡献 `src/main/features/contribution/hub-client.ts`

| 接口 | 说明 |
|---|---|
| `GET /marketplace/contributions/terms` | 条款，支持 `If-None-Match`（ETag） |
| `POST /marketplace/contributions/submissions` | **multipart**：`manifest`（JSON）+ `package`（zip，≤ 8 MiB）；请求头 `Idempotency-Key` |
| `GET /marketplace/contributions/submissions/{id}` | 提交状态回读 |
| `POST /marketplace/contributions/submissions/{id}/withdraw` | 撤回待审核提交 |
| `GET /marketplace/contributions/mine` | 「我的贡献」，支持 `page`、`size`（≤100）、`updated_since` |
| `POST /marketplace/contributions/withdrawal-requests` / `GET …?content_id=` | 已发布内容的撤回申请 |

- **请求头**：`X-CogSeed-Client-Version`、`X-CogSeed-Platform`（只取 `macos` / `windows`）、`X-CogSeed-Request-ID`、`Accept-Language`、`Authorization: Bearer`。
- **响应信封**：`{code, error{code,message,retryable,details}, request_id, …}`；超时 30 s。
- **提交清单 `SubmissionManifest`**：`content_type: 'skill'`、`local_skill_id`、`target_content_id|null`、`package_digest`、`package_size`、`file_list[{path,size,sha256}]`、`metadata{name,description,version}`、`declarations`、`local_check`。
- **错误码**（节选）：`PACKAGE_REJECTED`、`PACKAGE_DIGEST_MISMATCH`、`VERSION_NOT_HIGHER`、`CLIENT_VERSION_UNSUPPORTED`、`LOCAL_CHECK_NOT_CLEAN`、`TERMS_VERSION_MISMATCH`、`DECLARATION_MISSING`、`FORKED_FROM_REQUIRED`、`IDEMPOTENCY_KEY_CONFLICT`、`PENDING_LIMIT_EXCEEDED`、`PAYLOAD_TOO_LARGE`、`AUTH_REQUIRED`。

## 二、客户端通用义务

1. 任何 Agent 内容离开本机之前，必须完成本地检查与处理，并经用户预览确认。
2. 客户端的登录引导、入口限制**不替代**服务端鉴权；服务端拒绝原因原样展示。
3. **处理在客户端做**，处理了什么 Hub 不需要知道，不上传。
4. 日志与遥测不记录 Agent 正文、凭据、本机路径。
5. 扫描、摘要校验、依赖获取任一环节不可用 → 视为「未完成」，**不得显示通过**。

## 三、Agent 需要新增或扩展的能力

| 编号 | 能力 | 现有基础 | 状态 | 权威方 |
|---|---|---|---|---|
| C1 | Agent 目录与详情（含依赖元数据：引用的 Skill 状态） | 客户端旧调用形态 `agents/list`、`agents/detail`（Hub **不提供**） | **新建，需联合确认目标契约**（参照 Skill 的 A-01） | Hub |
| C2 | **Agent 发布物摘要**：`artifact{sha256,size_bytes,format}`，覆盖 `agent_json` 与私有包（`format` 需新值，现为固定的 `skill-tree-v1`） | Skill 已有（A-01/A-02），Agent **没有** | **新增（D-09）** | Hub |
| C3 | 依赖解析：给定 Agent 版本，返回其引用的 Hub Skill 的可用性 / 版本 / 停用 | `getSkillMetadata`（按 ID 取） | 可由客户端逐个查询；是否提供批量接口待定 | Hub |
| C4 | 内置能力清单 | 无 | **Hub 来补**（Brief 完成标准之一）；供给形态待 Hub 方案；ID 形态与系统 Skill 能否引用（D-10）待核实 | Hub + 客户端 |
| C5 | 提交 Agent：`content_type` 扩展为 `'agent'`；包含 `agent.json` 与随包私有 Skill（**产品已定本期支持**）；包上限四段（压缩 ≤ 8 MiB、文件 ≤ 200、解包 ≤ 10 MiB、压缩比 ≤ 100:1） | Skill 提交（C-02，`content_type` 现固定 `skill`，非 `skill` 返回 `INVALID_REQUEST`） | **新建，需 Hub 放开并重估私有 Skill 的工作量与 200 文件额度** | Hub |
| C6 | 提交阶段校验：Hub Skill 引用存在、已发布、未停用；名字形式条目对应包内私有 Skill；私有 Skill 归属与目录名合规。错误放 `server_check.blocking[]` 域内码 | — | **新增** | Hub（权威） |
| C7 | 提交状态与退回原因、「通过」与「发布」分离；`/mine` 按类型返回 Agent 与 Skill | `/contributions/mine` | 扩展 `type` | Hub |
| C8 | 新版发布/停用/恢复状态下发；**停用 Skill 时检查是否被 Agent 依赖**（会上提出） | Skill 的 `status`/`disabled`（A-01、011 规格）；**反向依赖检查未找到** | 扩展到 Agent；反向依赖是新需求 | Hub |
| C10 | 目录详情（B-05 建议，Hub 定） | 无 | 待 Hub 定（列表带 / 下载后读 / 新增详情接口） | Hub |
| C11 | `CogSeed-Channel` 通道过滤，跨线失败与"不存在"不可区分 | A-01/A-02 已有 | 继承 | Hub |
| C9 | Agent 最低客户端版本 | `min_app_version`（目录项已有） | 复用 | Hub |

## 四、阻断点矩阵

| 异常 | 提交阶段 | 安装阶段 | 客户端展示 |
|---|---|---|---|
| Hub Skill 不存在 | Hub 拒绝 | 安装清单标「不可用」，`content_not_found`，阻断安装 | 原因 + 处理出口 |
| Hub Skill 已停用（`status`） | Hub 拒绝发布 | 阻断安装；已装 Agent 变 `deps_blocked` | 卡片「依赖已停用」 |
| Agent 最低客户端版本高于本机 | `CLIENT_VERSION_UNSUPPORTED`（提交接口） | **客户端阻断**，按钮停用 | 「需 CogSeed x.y+」 |
| 预置依赖本机已具备 | — | 直接复用，不下载 | 「已具备」 |
| 随 Agent 提交的自建 Skill | 校验归属、目录名、安全检查（D-04 待定） | 随包安装在该 Agent 名下，不进用户 Skill 列表，不覆盖同名 Skill | 提交前提示并确认；安装前告知"将同时安装" |
| 最明显的密钥格式（私钥、pem） | **客户端阻断**，不上传 | — | 指出文件与行 |
| 扫描失败/不可用 | Hub 阻止发布 | 客户端不安装、保留旧版 | 「检查未完成」，不显示通过 |
| 发布物摘要不一致 | `PACKAGE_DIGEST_MISMATCH` | **客户端拒绝安装**（依赖 D-09） | 「内容与发布记录不符」 |

## 五、提交不变量

1. 提交前重新计算最终副本摘要，与最近一次预览不一致 → 阻断并要求重新预览。
2. 同一次提交动作的重试共用 `Idempotency-Key`；Hub 返回「已收到/未收到」之一，无中间态（冲突为 `IDEMPOTENCY_KEY_CONFLICT`）。
3. 修改后重提 = 新 `submission_id`，不沿用旧批准。
4. 审核通过 ≠ 已发布；市场里只含 `published`。审核与发布 Hub 侧不要合成一件事（会上意见）。
5. 随包提交的自建 Skill 与 Agent 一次提交、一次确认。

## 五·补、依赖与版本（产品第 2、3 条，规则提案见 `agent-api-proposal.md` §8）

1. 安装时自动补齐依赖，确认框列出"将同时安装"；全部就绪才可用。
2. 已有且可用的 Skill 复用、不升级；装完后依赖更新走 Skill 自己的通道；不得影响其他 Agent 与在途任务。
3. 全部下载并校验通过后一次性写入；任一失败整个 Agent 不记录，保留原状态。
4. A-01 只返回最高版本：最高版本不兼容时无法回退（已知限制，待联合确认）。

## 六、待 Hub 同步的开放点

- 先定 **Agent 协议**（含哪些文件）再定 API（D-08）；C2、C5、C6 为新增，需 Hub 确认可行性与排期。
- **D-07（产品已定：本期随包提交，不要求先单独发布；实质为 Agent 私有包加安全检查与隔离）**：Hub 第三节"本期不随包"被取代，待确认先后；安全检查选项、200 文件额度待 Hub 重估。
- **D-10**：系统 Skill 能否被 `skill_list` 引用（代码推断为不能，未验证）。
- 随包预置内容是否都已在 Hub 上（`builtin_marketplace.ts` 注释说可能先于 Hub 发布）。
- 文件清单与退回反馈的生命周期，客户端与 Hub 两边各有一份，会上说还没对好。
- Hub 里「接受但不发布」状态客户端发不出去（会上疑似 bug，发版后复查）。
- Hub 停用某个 Skill 时是否检查对 Agent 的依赖影响（会上意见：有依赖则不应停用，除非先下架 Agent）；这是 Hub 运营端行为，不在客户端。
