# Agent 接口提案 v3（供联合冻结前最后一轮核对）

> **状态：草案 v3，2026-10-12。**据产品 2026-10-10 与 Hub 2026-10-10、2026-10-12 的答复修订，**尚未联合冻结**。
> v1 → v2 → v3 变化见 §10、§12。配套：Agent 定义 `agent-package.schema.json`（v1 草案）；能力清单与阻断矩阵 `client-hub-interface.md`；约束与流程 `shared-contract-plan.md`。
> 依据（均已读）：Hub 的 A-01、A-02、C-02 契约，Skill 联合验收交接，Hub 对 v1 的答复，产品五条要求，客户端现有调用。
> **未读：**A-03 事件上报、C-00 公共约定全文、C-03~C-06 全文。事件上报不在本提案内。

## 0. 已定的前提

| 来源 | 内容 |
|---|---|
| 产品 | 本期含用户贡献 Agent 的完整流程，可分批开发，按整体验收 |
| 产品 | 依赖由系统自动补齐，可告知将同时安装哪些，全部就绪才显示可用；无法自动解决才提示原因与办法 |
| 产品 | **本期支持私有 Skill 随 Agent 一起贡献**，不要求先单独发布；纳入安全检查；明确归属与隔离，不得覆盖用户同名 Skill；要求同步修改 Brief |
| 产品 | 安装/更新不得影响其他已可用 Agent 与在途任务；失败保留原有可用状态 |
| Hub | 路径沿用 `agents/list`、`agents/bundle`，方法为 **POST**；合成一个发布物；`skill_refs` 由 Hub 下发；引用只用 `content_id`、解析到最高已发布版本；分类集合分开 |
| Hub | Hub 目前没有任何 Agent 实现，B-01~B-04 全是新增；停用 Skill 不自动停用引用它的 Agent，只阻断新安装与发布 |
| Hub 2026-10-12 | 私有 Skill 随包按产品口径支持，Hub 2026-10-10 第三节作废；**安全检查取 a**；包上限四段保持现状不放宽（200 可能调整，不得硬编码）；审核列出每个随包 Skill；停用随 Agent 整体；`skill_list` 三类（新增 `builtin:<name>`）；B-05 采纳；`agent-package-v1`；Agent 本轮不支持上传图标；名称规则由契约持有；`NOT_SUPPORTED` 补进 C-00；A-03 本轮不做；不支持回退旧版本 |
| 已解决的冲突 | ~~Hub 答复第三节~~ 已作废。原文：Hub 答复第三节"私有 Skill 本期不随包"，被产品第 4 条取代（Hub 自己写了"需先和中扬确认"）。**需确认产品文字在 Hub 答复之后。** |

## 1. 设计原则

1. 与 Skill 逐项同形：信封（顶层无 `data` 层）、请求头（含 `CogSeed-Channel`）、分页、幂等、错误结构全部沿用。
2. 一个 Agent = 一个不可变发布物（ZIP），一个摘要覆盖全部内容，对应"篡改发布物拒绝安装"。
3. 依赖在目录项里下发，安装前即可展示依赖状态。
4. 合同缺口客户端不猜；标"待 Hub 定"的，答复前不写实现。

## 2. 接口一览

| 编号 | 方法与路径 | 对应 Skill | 鉴权 | 差异 |
|---|---|---|---|---|
| B-01 | `POST /marketplace/agents/list` | A-01 | 匿名 | `avatar`、`skill_refs`、`bundled_skills`；`artifact.format` 新值 |
| B-02 | `POST /marketplace/agents/bundle` | A-02 | 匿名 | 发布物 `agent-package-v1`，含私有 Skill；其余同 A-02 |
| B-03 | `POST /marketplace/contributions/submissions` | C-02 | 登录 | `content_type: 'agent'`；多出引用与私有 Skill 校验 |
| B-04 | `GET /marketplace/contributions/mine` | C-04 | 登录 | 列表项带 `content_type`；可按类型筛选 |
| B-05（**Hub 已采纳**） | `POST /marketplace/agents/detail` | 无 | 匿名 | 见 §6 |
| B-06（Hub 新增） | `GET /marketplace/builtin-capabilities/manifest` | 无 | 匿名 | 内置能力清单 `{ id, introduced_in, current_version, capability, risk }`；**路径名以 Hub 已实现的 `builtin-capabilities` 为准**，契约见 Hub `b04-builtin-capabilities.md`；当前返回空清单（合法稳定态，空清单时任何 `builtin:` 引用按 `builtin_ref.unknown` 拒绝） |
| — | 提交状态读回、审核前撤回、已发布撤回申请、条款 | C-02/C-05/C-01 | 登录 | 不变，按 `content_type` 通用 |
| — | 事件上报 | A-03 | — | **未覆盖** |

**通道（Hub 第 9 条）：**B-01、B-02、B-05 继承 A-01/A-02 的 `CogSeed-Channel` 强制过滤；跨通道请求的失败必须与"内容不存在"完全无法区分，避免枚举另一条线上的 Agent。

## 3. B-01 目录

请求体、分页（`size ≤ 100`）、"每个 ID 只返回最高已发布版本、停用仍返回并标记"、`disabled` 与 `status` 必须一致、草稿永不出现，全部同 A-01。

| 字段 | A-01 | B-01 | 备注 |
|---|---|---|---|
| `content_id` / `create_uid` / `version` | 有 | 同 | |
| `content_type` | 固定 `skill` | 固定 `agent` | |
| `name`、`description_zh/en`、`description` | 有 | 同 | 映射规则见 §7 |
| `category` | 例 `productivity` | 7 个固定码：`education, ecommerce, rnd, creation, data, office, general` | **写进契约，Hub 持常量并校验**（Hub 第 8 条） |
| `avatar` | 无 | **`{ icon, color }`**，值来自 `agent.json` 的 `icon` / `color` | 不叫 `icon`，避开 C-06 的 `icon` 对象（Hub 第 1 条） |
| `published_at` / `updated_at` / `min_app_version` | 有 | 同 | |
| `disabled` / `status` | 一致 | 同 | |
| `artifact{download_url, sha256, size_bytes, format}` | `format=skill-tree-v1` | `format=agent-package-v1`（命名待 Hub） | 这是 D-09 |
| `skill_refs[]` | 无 | **新增**：`[{ content_id }]`，即 `skill_list` 里 12 位十六进制的条目 | 本期不带 `version_req`（Hub 第 4 问） |
| `builtin_refs[]` | 无 | **新增（提案，Hub 未定字段名）**：`[{ id: "builtin:<name>" }]`，即 `skill_list` 里 `builtin:` 开头的条目 | 客户端据此判断本机是否具备内置能力 |
| `bundled_skills[]` | 无 | **新增**：`[{ name }]`，包内私有 Skill 的名字 | 用于安装前告知"将同时安装" |

## 4. B-02 发布物与 `agent-package-v1`

请求体 `{ content_id, version }`，缺 `version` → `INVALID_REQUEST`，不回退最新；同一 `content_id + version` 永远同字节；`Digest`/`ETag`/`immutable`；停用不影响下载；失败返回 JSON 信封。全部同 A-02。

```text
agent.json            必需。作者原文，字段集见 agent-package.schema.json；不含 version/created_at/updated_at
_meta.json            Hub 在发布时写入：version、published_at。提交包里不得出现
README.md             可选
skills/<name>/...     可选。随包私有 Skill；每个目录含 SKILL.md；<name> 不得是 12 位十六进制
```

- 只含常规文件与目录，不含符号链接、绝对路径、`..`；ZIP 容器。
- 发布时对内容树的唯一改写是写入 `_meta.json`，与 `skill-tree-v1` 同构（Hub 第 5 条）。
- **包上限四段**（Hub 第 7 条；Hub 现有实现 `maxFiles: 200`、解包 10 MiB）：压缩 ≤ 8 MiB、文件 ≤ 200、解包 ≤ 10 MiB、单条目压缩比 ≤ 100:1。客户端本机检查必须全做。
- **Hub 已定：**四段先保持现状不放宽，用真实种子 Agent 实测后再议；**客户端不得把 200 等上限硬编码，须从契约读取**。注意 C-03 的"`blocking`/`warnings` 各 ≤ 200 **条**"是结果条数，与文件数无关。

## 5. B-03 提交

multipart（`manifest` + `package`，顺序固定）、`Idempotency-Key`、不分片、服务端校验顺序、`201` 响应，全部同 C-02。

| `manifest` 字段 | B-03 |
|---|---|
| `content_type` | `agent`（Hub 放开校验，D-11） |
| `local_agent_id` | UUID v4，替换键成分（对应 `local_skill_id`） |
| `target_content_id`、`package_digest`、`package_size`、`file_list` | 同 C-02；服务端复核，不一致 `PACKAGE_DIGEST_MISMATCH` |
| `metadata.name` / `description` / `version` | name、description 与包内 `agent.json` 一致（映射见 §7）；`version` 为 SemVer，**不写进 `agent.json`** |
| `declarations`、`local_check` | 同 C-02 |
| 安全声明 | **待 Hub 与安全协作人定（D-04）**，见 §8 |

**Hub 新增校验：**
1. `agent.json` 按 schema 严格校验，多余字段拒绝。
2. `skill_list` 中 12 位十六进制的条目：Hub Skill 存在、已发布、未停用。
3. `skill_list` 中名字形式的条目：必须对应包内 `skills/<name>/SKILL.md`；包内每个私有 Skill 的 `ownerAgent` 必须指向本 Agent。
4. 私有 Skill 不得与"覆盖用户同名 Skill"的归属规则冲突（见 §8）。

**错误处理（Hub 第 12 条采纳）：**不新增接口级错误码。接口级仍返回 `PACKAGE_REJECTED`，具体原因放在 `details.server_check.blocking[]`，用域内 `code` 与 `rule`：

| 域内 `code` | `rule` 例 | 含义 |
|---|---|---|
| `AGENT_SCHEMA_INVALID` | `agent.field.unexpected`、`agent.name.charset` | `agent.json` 不符合 schema |
| `SKILL_REF_NOT_FOUND` | `skill_ref.content_id` | 引用的 Hub Skill 不存在，或名字形式条目无对应包内目录 |
| `SKILL_REF_DISABLED` | `skill_ref.status` | 引用的 Hub Skill 已停用 |
| `PRIVATE_SKILL_INVALID` | `private_skill.owner`、`private_skill.name` | 私有 Skill 缺 `ownerAgent`、归属不符、目录名为十六进制 |

## 6. 目录详情（Hub 第 10 条，需定一个）

A-01 只有列表、A-02 只回字节，详情页要展示工作流程与交付标准。

| 方案 | 利弊 |
|---|---|
| ① 列表里带 | 列表一页最多 100 条，每条带工作流程，响应变大 |
| ② 下载包后读 `agent.json` | 详情页得先下载（含私有 Skill），未安装就下载不合适 |
| **③（Hub 已采纳）新增 B-05 `POST /marketplace/agents/detail { content_id, version }`**，返回展示用字段（`workflow`、`inputs`、`standards`、`knowhow` 等，不含私有 Skill） | 多一个接口，但列表轻、详情不用下载包 |

Hub 给的是①②二选一，③是我的新增，**由 Hub 决定**。

## 7. 映射规则

- **`metadata.description`** = `description_zh`，缺省则取 `description_en`（`agent.json` 至少有其一）。Hub 用同一规则复核。
- **名称**：字符集以客户端规则为准（`^[A-Za-z0-9_一-鿿-]+$`，无空格）；显示宽度 ≤ 60，中日韩按 2 计。Hub 现有 `nameRules.ts` **只查非空与显示宽度，不查字符集**，Agent 复核需补字符集检查，否则会出现"Hub 收下、客户端安装时拒绝"。宽度算法与字符集两端共用一组测试向量（见 §9）。

## 8. 依赖、版本、私有 Skill 与安全规则（产品第 2、3、4 条，**待联合确认**）

这一节是产品新要求，目前双方都没有定义，以下为客户端提案。

### 8.1 安装依赖

1. 点"安装"后，客户端读取 `skill_refs` 与 `bundled_skills`，在确认框列出"将同时安装：…"；全部就绪才显示可用。
2. 全部下载到临时区、校验摘要通过后，才一次性写入；任何一步失败，整个 Agent 不记录，已有状态不变（沿用现有"依赖失败则整体失败"语义）。
3. 无法自动解决（Skill 已停用、需更高客户端版本、网络不可用、摘要不符）才提示原因与处理办法。

### 8.2 依赖版本规则（提案）

| 情形 | 规则 |
|---|---|
| 本机已有该 Skill 且可用 | **复用，不升级**，不因安装 Agent 改动其他 Agent 正在用的 Skill |
| 本机没有 | 安装当前最高已发布版本；若其 `min_app_version` 高于本机 → **客户端已定：阻断并提示"需 CogSeed x.y+"**。**A-01 只返回最高版本，无法回退到较旧的兼容版本**，要不要让 Hub 另外返回旧版本，待嘉宇定 |
| 已有但被停用 | 阻断，原因"依赖已停用" |
| 装完后依赖有新版本 | 走 Skill 自己的更新通道（现有"在途任务固定版本"机制）；Agent 不触发升级 |
| 依赖后来被停用 | Agent 状态变为 `deps_blocked`，不自动停用 Agent，在途任务不替换版本 |

### 8.3 私有 Skill 的归属与隔离（提案）

- 沿用现有机制：私有 Skill 的 frontmatter 带 `ownerAgent`，别的 Agent 解析为未知（`skills.ts`、`agents.ts` 已有）。
- 装在该 Agent 名下，**不进用户自己的 Skill 列表**，不覆盖用户同名 Skill；Agent 卸载时一并移除；Agent 更新时私有 Skill 整体原子替换。
- 私有 Skill 目录名不得是 12 位十六进制（避免与 Hub `content_id` 混淆）。
- **待核实：**私有 Skill 在本机的具体落盘位置与同名冲突处理，以代码为准，实现前核对。

### 8.4 安全检查（待 Hub 与安全协作人）

产品要求随包 Skill 纳入安全检查。选项：

| 选项 | 内容 | 代价 |
|---|---|---|
| a. 与社区 Skill 同标 | 每个私有 Skill 都带 `references/security-manifest.yaml`，过声明检查与深扫 | 一致、最稳；贡献者负担和 Hub 检查成本最大 |
| b. Agent 级一份声明 | 一份声明覆盖 Agent 与其私有 Skill | 需新定义 |
| c. 仅扫描脚本 | 不要求声明，只对随包脚本深扫 | 最轻，但与社区 Skill 标准不一致 |

**Hub 2026-10-12 已定：取 a。**每个随包 Skill 都带 `references/security-manifest.yaml`（本体 `cogseed.security.skill@1.1.1`），过 declaration-core 与深扫。Hub 需新建"包内多个 Skill 各自声明"的校验层，结果合并进 `server_check.blocking[]`。客户端本机检查也须逐个子目录核对声明。

## 9. 共用测试向量（Hub 第 3 条）

两端各实现名称规则，**共用一组测试向量**，作为联合验收的一部分：

- 合法：纯中文、中英混合、含下划线与连字符、宽度恰为 60、宽度 61 被拒。
- 非法：含空格、首尾空白、假名、谚文、保留名（指挥官 / commander / cogseed）。
- 向量文件已建：`contracts/fixtures/agent-package/name-rule-vectors.json`（19 条，含规则说明）；已用参考实现核对一致。Hub 与客户端各自的测试读取同一文件。待嘉宇确认字符集与保留名由谁持有。

## 12. v2 → v3 变化（Hub 2026-10-12 答复）

| 项 | 变化 |
|---|---|
| `skill_list` | 新增第三类 `builtin:<name>`；schema 与 3 个夹具已更新 |
| 安全检查 | 选项 a 已定 |
| 包上限 | 不放宽；客户端从契约读，不硬编码 |
| 详情 | B-05 采纳 |
| 内置能力清单 | Hub 新增 B-06 |
| 图标 | Agent 不支持上传图标，只用 `avatar{icon,color}` |
| 错误 | `NOT_SUPPORTED`（`retryable:false`，`details.supported[]`）补进 C-00 |
| 通道 | 客户端 MUST 在每个市场请求带 `CogSeed-Channel` |
| 版本回退 | 契约写明不支持 |
| 事件 | A-03 本轮不做 |

**客户端核实发现（影响 `builtin:`）：**31 个现有内置 Agent 的 `skill_list` 里，61 项是 12 位十六进制，另有十几项名字形式（`seo-crawl` 等，应为各自的私有 Skill），**没有任何一项引用系统 Skill**（`agent-creator`、`coding` 等 8 个）。所以 `builtin:<name>` 目前在客户端**没有已知的指向对象**，需先定它指哪些能力（D-10），Hub 的清单才有内容可列。

## 10. v1 → v2 变化

| 项 | 变化 |
|---|---|
| 私有 Skill | v1 有；Hub 要求删；**产品要求保留** → 保留，补隔离、安全、版本规则 |
| `icon` | 目录项改 `avatar{icon,color}` |
| `version` | 不进 `agent.json`；Hub 写 `_meta.json` |
| `crown` | 从枚举去掉 |
| `skill_list` | 12 位十六进制 = Hub Skill；其余必须对应包内私有 Skill；两类互斥 |
| 错误码 | 改为域内码，放 `server_check.blocking[]` |
| 包上限 | 补全四段 |
| 通道 | 补 `CogSeed-Channel` 与跨线不可区分 |
| 详情 | 新增 B-05 建议 |
| 新增 | 依赖版本规则、隔离规则、安全检查选项、测试向量 |

## 11. 仍待确认

| # | 事项 | 找谁 |
|---|---|---|
| 1 | 产品第 4 条与 Hub 第三节的先后；随包 Skill 的 200 文件上限与工作量重估 | 中扬、嘉宇 |
| 2 | §8.4 安全检查选项 | 嘉宇、安全协作人 |
| 3 | §8.2 版本规则（含"最高版本不兼容时无回退"的限制） | 中扬、嘉宇 |
| 4 | §6 详情方案 | 嘉宇 |
| 5 | 内置能力清单的 ID 形态与供给方式（Hub 方案待出）；**系统 Skill 是名字形式，按本提案的 `skill_list` 规则会被当私有 Skill 拒收（D-10）** | 嘉宇 |
| 6 | 发布物 `format` 命名；分类码常量由谁持有 | 嘉宇 |
| 7 | 事件上报（A-03）是否需要 Agent 版 | 嘉宇 |
