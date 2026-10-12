# 共用契约工作方式（Agent 定义 + 两边接口）

> 草案，2026-10-10。客户端基线 `origin/develop` `5491969e`；已读本机 Hub 仓库 `~/Desktop/cogseed-hub`（`origin/main`、`origin/codex/hub-open1-governance`）。回答「后续开发要对齐 Agent 定义和两边接口，怎么弄」。**只改文档，没有动运行时代码。**配套文件：[`agent-package.schema.json`](agent-package.schema.json)（agent.json 可分发子集的 JSON Schema 草案）、[`fixtures/agent-package/`](fixtures/agent-package/)（示例夹具）、[`client-hub-interface.md`](client-hub-interface.md)（接口）、[`../data-model.md`](../data-model.md)（字段分类）。

## 1. 仓库里现有的 Agent 规定（已读代码）

| 层 | 在哪 | 管什么 | 机器可读 |
|---|---|---|---|
| 创作规则 | `resources/builtin/system/skills/agent-creator/SKILL.md`（351 行） | 字段怎么写、工作流格式、技能引用、7 个分类码、描述写法、安全红线。`AGENTS.md` 称其为 authoring 的**权威来源** | 否（写给模型看） |
| 类型与归一化 | `src/main/features/agents.ts`：`Agent`、`normalizeAgent`、`validateAgentInputs`、`AgentInterfaceContract` | 字段全集；哪些持久化、哪些运行时派生 | 在代码里 |
| 校验器 | `src/main/quality/`：`validateAgentSpec` / `validateAgentDir`；`rules/schema.ts`、`rules/red-flags.ts` | 名字、描述 ≤ 800、分类码形状；25 条红线（22 条 EXTREME 直接阻断）；校验器在落盘前运行，**也覆盖 Agent** | 在代码里，有测试夹具 |
| 项目规则 | `AGENTS.md`「Skills, Agents, And Marketplace」 | `skill_list` 语义：缺省=不过滤，`[]`=零个，非空=严格子集；描述双语 | 文字 |

**缺的：**JSON Schema、OpenAPI、独立的「Agent 协议」文档。而且**现有校验器对 Agent 的结构检查很松**：`validateAgentJsonShape` 只有 `agent_id`、`name` 缺失是 EXTREME，名字格式、描述、分类都只是 MEDIUM 提示，**不检查** `workflow`、`skill_list`、`inputs`。「分发」需要的严格程度是新增的。

**还有一个关键区别：**客户端读取是**宽松**的（`validateAgentInputs` 会丢弃非法项、纠正类型），而分发提交需要**严格**（有问题就拒绝并指出位置）。所以协议要明确：**读取宽松、提交严格**。

## 2. 两边共用契约，现有的成熟做法（Skill 贡献）

`specs/001-hub-skill-contribution/contracts/client-hub-interface.md` 的「Joint-freeze acceptance」：契约文档 + Hub 的 OpenAPI + 双方共用的正反例夹具 + 互相跑对方的样例。客户端已有 `test/fixtures/hub-contributions/*.json`（十个，含认证失败、包被拒、版本不够高等）。Agent 沿用同一套。

## 2.1 Skill 这边已经走通的做法（读了客户端 `specs/001`、Hub 仓库 `cogseed-hub` 的 `specs/009`、`specs/010`、`specs/011`）

| 做法 | 出处 | 对 Agent 的借鉴 |
|---|---|---|
| **Hub 仓库是接口权威**，契约编号：A-01 目录 / A-02 包 / A-03 事件；C-00～C-06 贡献；另有 OpenAPI 3.1、跨仓交接包 | `cogseed-hub/specs/009/contracts/`、`specs/010-client-contribution/contracts/`、`openapi/hub-contributions.openapi.yaml`、`cross-repo-handoff-2026-09-24.md` | Agent 在 Hub 新开一份规格目录，按同样的编号与交接包办法 |
| **权威顺序**：C-00～C-06 > 交接包 > 实现状态说明 > OpenAPI（后两者描述已实现行为，**不冻结契约**）；快照用 Git SHA 钉住，用 `git show origin/<分支>:<路径>` 读，不动对方的检出 | `specs/001/research.md` | 同样的顺序；客户端规格里写明读的是哪个 SHA |
| **不从 OpenAPI 生成客户端**：会固化「实现状态」，漏掉已定未同步的字段；改为把契约在冻结 SHA 上转成**受检的客户端夹具** | `specs/001/research.md`、`plan.md` | 同 |
| **能力追溯矩阵**：能力 → 路由 → 权威 → 实现证据 → 客户端行为与测试 → 冻结状态 | `specs/001/contracts/client-hub-interface.md` | 本目录 `client-hub-interface.md` 已有雏形，可补全到同样的列 |
| **请求体组装抽成无依赖叶模块**，联调脚本直接调用客户端的真实组装代码，**不镜像**：2026-09-28 真机联调发现，`manifest.metadata` 被 Hub 当白名单（多余字段拒绝而非忽略），安全声明被当第四个键发出，导致**所有合法贡献**被 `UNEXPECTED_FIELD` 拒绝；镜像里没有这个缺陷所以一直没发现 | `src/main/features/contribution/upload-manifest.ts` 头注释 | Agent 提交体同样做白名单投影 + 叶模块 + 联调脚本调真实代码 |
| **联验记录分层**：真实 Electron 界面、Hub HTTP 联调（隔离服务 + 合成账号，60/60）、自动化测试、未执行项，分开写，并列出「阻塞」项；契约未冻结则不判通过 | `specs/001/acceptance-2026-09-29.md`、Hub 的 `joint-acceptance-support-2026-09-29.md` | 同 |
| **本地检查回执 `local_check`**：`checker.side/version`；规则集 1.0.0、skill-sentry 2.1.0、declaration-core 1.3.0 | `contribution/` | Agent 需要定义自己的检查器与版本 |

**Agent 缺的最大一块：安全声明与本体。**Skill 社区贡献**必须**带 `references/security-manifest.yaml`，本体为 `cogseed.security.skill@1.1.1`（`resources/guardrail/skill-declaration-core/ontologies/cogseed.security.skill/1.1.1/` 下 10 个 YAML：`ontology`、`artifact-fields`、`consistency-rules`、`trust-rules`、`digest-profile`、`version-policy`、`warning-policy` 与模板），由 declaration-core 引擎校验。**Agent 没有对应本体**，是否需要、怎么定，是新决策（D-04）；它也决定 D-07 的真实代价：若随 Agent 提交的自建 Skill 走「独立公开」，每个都要满足 Skill 贡献的全套检查（安全声明、深扫）。

## 2.2 已参考的 Hub 侧材料与新增结论

- 《开源版四迭代排布 v0.1》迭代三：Agent 由 Hub 后台配置，随迭代一的同步、装载、升级/停用机制分发；**客户端提交 Agent 不在本迭代**（与 Brief 冲突，见 spec D-12）；「提交链路按通用内容对象设计，供迭代三、四复用」。
- `specs/010-hub-skill-client-lifecycle` A-08：Agent 随带私有 Skill 路径不在上一轮，需回到 Change Candidate（对应 D-07）。
- Skill 联合验收交接（2026-10-07）：C00~C06 已可联调但**尚未联合冻结**；合同缺口客户端不自行猜测 endpoint、字段、错误码；旧 `/marketplace/agents/*` 在新 Hub 404 后降级。Agent 契约沿用「联调通过 ≠ 冻结」的分层记录。

## 2.3 2026-10-10 答复后的状态

- 产品五条与 Hub 十二点技术意见已纳入 `agent-api-proposal.md` v2 与 `agent-package.schema.json` v1 草案；**仍未联合冻结**。
- 已采纳 Hub：路径与 POST、合包、`skill_refs`、`avatar`、`_meta.json`、去 `crown`、`skill_list` 互斥、四段包上限、`CogSeed-Channel`、域内错误码放 `server_check.blocking[]`、共用名称测试向量。
- 与 Hub 不一致、以产品为准：私有 Skill 随包（Hub 称本期不做）。
- 待补：A-03 事件、安全检查口径（D-14）、依赖版本规则（D-13）、详情接口、内置能力清单、名称测试向量文件。

## 3. 建议怎么搞

**3.1 按性质分权威方，不一刀切**

| 内容 | 权威方 | 形态 | 理由 |
|---|---|---|---|
| **Agent 定义（包格式）** | 客户端 | 带版本号的 JSON Schema（本目录草案）+ 夹具 | 运行时、`agents.ts`、校验器都在客户端；Hub 只存储和分发 |
| **接口（API）** | Hub | OpenAPI + 契约文档（沿用 Skill 的 C00–C06 做法，Agent 增量） | Hub 是服务方；客户端在 `contracts/` 镜像 |
| **夹具** | 共用，放一处，两边 CI 都校验 | 正例、反例各一套 | 防止两边各写各的 |

**3.2 版本与兼容**
- 包带 `schema_version`（建议 `agent-package/1`）；破坏性变更升主版本。
- schema 写 `additionalProperties: false`：Hub 贡献接口本来就有 `UNEXPECTED_FIELD`，两边口径一致；客户端在本机把不属于协议的字段处理掉（见 `x-excluded`）。
- **存量内容怎么办**：见 §6，现有内置 Agent 有不满足自身创作规则的。

**3.3 校验器复用**
Hub 无法直接引用客户端的 TypeScript 校验器，所以：schema 管**形状**，`quality/` 的红线规则管**文本里的危险模式**。建议把红线规则也抽成共用的正反例夹具，Hub 照夹具实现（或直接用 `skill-sentry` 等已有引擎，见 D-04）。

**3.4 放哪**
按 Hub 已有的约定：**Hub 仓库 `cogseed-hub` 新开一份 Agent 规格目录**（`specs/NNN-.../contracts/` + OpenAPI + 跨仓交接包），Hub 是接口权威；**客户端在 `specs/008/contracts/` 镜像**，并在规格里写明读的是哪个 Hub SHA。**Agent 定义（包格式）**因权威在客户端，schema 与夹具放客户端仓，交接包里引用并附哈希，Hub 在 CI 里校验一致。
Hub 自己的立场已经写明：**先共同确认目标契约，再补端点与测试**（见 `client-hub-interface.md` 〇），所以顺序与本文一致。
## 4. 工作顺序

1. **Agent 包格式草案**（本目录已有第一版）→ 雨萱补全并定 D-01、D-08。
2. **嘉宇评审并冻结 v1**。
3. **Hub 出 API 增量**：贡献接口的内容类型扩到 `agent`（现为 `'skill'`）；Agent 发布物摘要 `artifact`（D-09）；目录项带依赖状态；`/mine` 按类型返回。
4. **夹具补全**（§5）。
5. 双方并行开发。
6. **联合验收**（§7），集成证据与产品验收分开汇报。

## 5. 夹具清单

**已写（草案，`fixtures/agent-package/`）：**

| 文件 | 期望 | 覆盖 |
|---|---|---|
| `pos-expense-precheck.agent.json` | 通过 | 完整字段：输入表单（textarea / file）、技能引用（两个十六进制 ID）、知识与标准、`runtime: in_process` |
| `pos-minimal.agent.json` | 通过 | 最小必填：名字、一种语言描述、工作流、分类 |
| `neg-extra-field-enabled-connectors` | 拒绝 | 多余字段（连接器实例 ID 必须在本机处理掉） |
| `neg-runtime-cli` | 拒绝 | 本地外接 CLI Agent 不可分发 |
| `neg-category-invalid` | 拒绝 | 分类码不在 7 个之内（如旧值 `code`） |
| `neg-name-with-space` | 拒绝 | 名字含空格 |
| `neg-select-without-options` | 拒绝 | `select` 缺 `options` |
| `neg-skill-list-bad-id` | 拒绝 | `skill_list` 条目不是合法 ID 形态 |
| `neg-no-description` | 拒绝 | 中英描述都缺 |

**待补（建议）：**
- 包级：`manifest` 的 `file_list` 与 `package_digest` 不一致；包超过 8 MiB；包内含 `scripts/` 路径引用；私有 Skill 目录结构；`skill_list` 里有名字形式条目但包内没有对应私有 Skill。
- 文本级（红线）：私钥（`-----BEGIN … PRIVATE KEY-----`）、`.env` / `~/.ssh` 读取、`curl | sh`、`eval`；一例正常文本防误报。
- 接口级（沿用 Skill 的形态）：成功提交、幂等重放、幂等冲突（`IDEMPOTENCY_KEY_CONFLICT`）、版本不够高、最低客户端版本不满足（`CLIENT_VERSION_UNSUPPORTED`）、认证失败、`mine` 按类型返回、Agent 目录项带 `artifact` 且下载后摘要不一致。
- 账号隔离、条款竞态、声明缺失。

## 6. 本次草案的验证结果（用 `ajv` 8.20.0，只借用另一个 worktree 的现有安装，未往仓库加依赖）

- schema 本身可编译。
- 9 个示例夹具全部符合预期（2 个正例通过，7 个反例被拒）。
- **31 个真实内置 Agent：29 个通过，2 个不通过：**
  - 内置报销 Agent（`c045605cb916`）：含宿主专有字段 `management_surface`、`reimbursement_entry_role`（本就不可分发）；`output_format` 值为 `markdown`，**不在 `OutputFormat` 的取值里**，读取时被 `_canonicalOutputFormat` 静默丢弃（返回 null）；名字 `Reimbursement Agent` 含空格。
  - `客户Context Agent`：名字含空格。
- **含义：**随包内置内容**不满足客户端自己的创作规则**（名字不允许空格；`assertAgentNameAllowed` 只在**自建 Agent 的创建与更新**时调用，`agents.ts:1836`、`:2111`，随包预置与市场安装路径不经过它）。若 Hub 严格套用本 schema，**存量内容会被拒**。需要定：存量内容先归一化，还是协议对「平台来源」放宽。

## 7. 联合冻结验收（Agent 版，沿用 Skill 的五条）

1. 契约文档与 OpenAPI 对请求白名单、schema、枚举值、状态码、请求头和所有安全的错误细节一致。
2. Hub 与客户端共用正反例夹具，覆盖多余字段被拒、账号隔离、幂等重放/冲突、替换、条款竞态、声明失败、摘要或文件清单不一致。
3. 目标字段与图标等契约要么原样采纳，要么有记录在案的联合决定。
4. 客户端解析器通过 Hub 实现的夹具；Hub 的测试接受客户端产生的 multipart 样例。
5. 集成证据与产品验收、发布分开汇报。

## 8. 开放点

- D-01 / D-08：协议字段与包文件最终集合；`agent_id` 提交时如何与 `local_agent_id` / `target_content_id` 对应；`version` 是否允许出现在提交包里。
- D-07：随 Agent 提交的自建 Skill 是私有包还是独立公开；影响 `skill_list` 里名字形式条目的含义。
- D-09：Agent 发布物摘要。
- D-10：系统 Skill 能否被引用（未验证）。
- 存量内容与严格 schema 的关系（§6）。
- 图标：schema 的 `icon` 枚举含 `crown`（指挥官专用），提交时是否排除。
- 名字显示宽度 ≤ 60 单位、保留名冲突，schema 无法表达，需另写校验或夹具。
- Hub 目前没有任何 Agent 契约（见 `client-hub-interface.md` 〇）；Agent 的目录、包、事件、贡献是否一次做，还是分批，要与嘉宇排。
