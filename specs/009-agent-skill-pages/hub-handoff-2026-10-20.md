# S4 智能体 / 技能页改版 · 交接给 Hub 的任务

> **用途**：交给 Hub 侧（cogseed-hub，负责人嘉宇）先行处理已经敲定的部分。
> **客户端代码状态**：在本机分支 `feat/s4-agent-skill-pages` 上实现，**尚未提交、未推送**（基于 develop `45fc0166`）。Hub 侧看不到客户端代码，所以本文把客户端**实际发出的请求、读取的字段、缺字段时的表现**都写全了，可以直接照着做和自测。
> **核对依据**：客户端源码 + 本机 Hub 仓库 `cogseed-hub-20261014`（`b7924ed`）+ 本机 Hub 库 `cogseed-hub-local-dev` 的实测。日期 2026-10-20。
> **只读声明**：整理本文时没有改动 Hub 仓库和 Hub 数据库。
> **在线版**：https://claude.ai/code/artifact/00181e90-edb7-448b-8db6-c084552a0431（Claude Docs，可多人编辑；本文件是同内容的 Markdown 副本）

## 0. 一句话背景

S4 把客户端「智能体 / 技能」页改成：首页按「主智能体 / 外接智能体 / 平台」分组，平台组 = 本机已安装的 + Hub 目录里还没装的；点任意卡片弹出统一详情（能做什么、示例、会用到的技能）；另有「已安装的智能体 / 技能」管理页。**所有平台内容统一走 Hub**（2026-10-19 中扬拍板）：客户端不再区分「随包自带」，以后也要停止随包预装。所以 Hub 是这次改版的数据来源，下面这些不做，客户端页面要么空、要么只有交互没有内容。

## 1. 已敲定、Hub 可以开始做的任务

| # | 任务 | 为什么 | 客户端现状 / 依赖 | 完成标准 |
|---|---|---|---|---|
| H1 | **把客户端随包的全部内容上架到 Hub：32 个智能体 + 59 个技能**，ID 与版本对齐 | 平台内容统一走 Hub；客户端以后停止随包预装（迁移任务与嘉宇 23 号后对齐） | 随包清单在客户端 `resources/builtin/_manifest.json` 的 `inventory`，**完整清单见附录 A / B**。ID 是 12 位小写十六进制，和 Hub 同一套 | Hub 目录（`/marketplace/agents/list`、`/skills/list`）能列出附录里的全部 ID，版本 ≥ 附录版本；**本机 Hub 实测：32 个智能体 0 个在库，59 个技能缺 1 个（`c09e11d17a01` cognition-editor）**——以正式 Hub 为准重新核对 |
| H2 | **智能体依赖的技能都要已发布** | 不再预装后，装智能体时客户端会从 Hub 自动补齐依赖技能（S3 已实现） | 32 个随包智能体共引用 **84 条**共享技能（不含 `builtin:` 内置能力与随包私有技能） | 每个智能体的 `skill_refs` 里的 `content_id` 都能在技能目录里找到、`status = published` |
| H3 | **实现 `POST /marketplace/defaults`**（默认安装清单） | 新用户首次登录后，客户端靠它自动装一批「默认安装」内容；不预装后这是新用户看到内容的唯一来源 | 客户端已在调用（`marketplace.ts:2184`）；**本机 Hub 无此路由，返回 404**，客户端会重试后放弃 | 返回格式见 §3.3；具体放哪些内容由中扬定（见 §2 P5），接口先做出来 |
| H4 | **实现 `POST /marketplace/categories`**（分类表） | 首页分类筛选、卡片上的分类标签、详情里的分类都靠它 | 客户端已在调用（`marketplace_biz.ts:103`）；**本机 Hub 无此路由，返回 404**，客户端退回内置的一份默认分类，于是所有内容都显示成「通用」 | 返回格式见 §3.4；目录行的 `category` 取值必须是这张表里的 `code` |
| H5 | **目录行补三个展示字段：`examples`、`does`、`tags`**（智能体、技能都要） | 新详情弹窗按参考稿是「能做什么（打勾列表）+ 示例（点了直接发送）+ 标签」；没有字段就只剩一条通用示例 | 客户端已按 §3.2 的字段名读取，**缺字段时自动降级**（不显示「能做什么」、示例只给一条「请用 X 帮我处理这项工作」）；Hub 现在的目录行没有这三个字段 | 目录行（list）和详情（detail）都下发这三个字段；字段存哪里（定义文件里还是 Hub 单独字段）**还没定**（§2 P3），先按「目录行能下发」做接口 |
| H6 | **历史内容补齐（S4-09）**：所有平台智能体与技能都要有「能做什么 / 示例 / 标签」 | 现有 32 + 59 都没有这些内容 | 做法已定：手写一份真实智能体的内容当示范（one-shot），AI 读每个智能体 / 技能的定义文件照着生成，**人工逐个审核**；以后新发布的同样生成。另有 3 个智能体工作流程是「None. None」占位，需先修 | 附录 A / B 每一项都有审核过的三样内容，并能经 H5 的字段下发 |
| H7 | **发布顺序：Hub 先全部上架并验证，再发客户端** | Hub 没准备好就发客户端，新用户会看到空的平台组 | 已和中扬确认 | Hub 侧 H1–H4 验收通过后通知客户端发版 |
| H8 | **不做离线兜底** | 2026-10-19 中扬定：断网只显示已安装的内容 | 客户端已实现：连不上 Hub 时顶部提示「暂时连不上平台」+ 重试，平台组只显示已安装 | Hub 侧无需额外做事，知悉即可 |
| H9 | **目录不再需要「N 人在用」** | 本期不展示使用人数（统计口径另议，§2 P1） | 客户端已不展示 | Hub 侧不用为本期提供人数字段 |

## 2. 还没敲定的（请先别做，等结论）

| # | 事项 | 卡在哪 | 谁定 |
|---|---|---|---|
| P1 | 「在用」统计口径（D-08） | 按安装、按人去重已倾向；多台设备算不算一个人未定；客户端的使用上报只覆盖跑脚本的技能，发送与用户同意开关都未接通 | 中扬、嘉宇 |
| P2 | Hub 端改头像（D-10） | 两端是否共用客户端的图标与颜色表（43 个图标、17 种颜色）；Hub 改了是否写回定义文件；技能要不要头像 | 嘉宇、中扬 |
| P3 | 示例 / 能做什么 / 标签存在哪（D-01 / D-04） | 写进智能体 / 技能自己的定义文件，还是 Hub 单独字段；谁审核 | 中扬、嘉宇 |
| P4 | 报销智能体 `c045605cb916` | 客户端把它当固定 ID（只能管理、不能对话）。留在客户端，还是走 Hub 但保证 ID 不变 | 中扬、嘉宇 |
| P5 | 默认安装放哪些内容 | 新用户登录后自动装哪几个（H3 的清单内容） | 中扬 |
| P6 | 下载发布物是否要求登录 | 客户端的规则已定：未登录时平台组只显示已安装、点「安装」先请登录；Hub 侧目录匿名可读（FR-018）已满足，`bundle` 下载是否校验身份请 Hub 确认现状 | 嘉宇确认 |

## 3. 客户端契约细节（客户端代码未推送，以此为准）

### 3.1 通用约定

- 全部是 `POST`，`Content-Type: application/json`，请求头带 `Accept-Language`（客户端界面语言：`zh` / `en` / `ja` / `pt`）和客户端固定标识头。
- **信封**：成功时顶层 `code: 0`，载荷字段（`list`、`total` 等）**直接在顶层，没有 `data` 包装**；`code ≠ 0` 时客户端读 `msg` 作为错误说明。与 Hub 现有 A-01 一致。
- 时间字段用 RFC 3339 字符串，客户端在边界统一转成毫秒；ID 字段新格式用 `content_id`，客户端在边界映射成 `id`。

### 3.2 目录：`/marketplace/agents/list`、`/marketplace/skills/list`（已有，补字段）

**请求体**（客户端实际发送）：

```json
{ "app_version": "1.3.0", "category": null, "status": null, "q": null, "page": 1, "size": 50 }
```

- S4 首页按 `size: 50` 逐页拉，最多拉 **10 页（500 条）** 就停。Hub 现在的路由只读 `page` / `size`、其余忽略，没问题；如果某一类内容会超过 500 条，请提前告知，客户端调大上限或改用服务端筛选。

**S4 读取的行字段**（✅ 本机 Hub 已下发；🆕 需要新增）：

| 字段 | 智能体 | 技能 | S4 怎么用 | 缺了会怎样 | 状态 |
|---|---|---|---|---|---|
| `content_id` | ✔ | ✔ | 唯一标识；和本机安装记录对齐 | 整行丢弃 | ✅ |
| `name` | ✔ | ✔ | 卡片、详情标题 | 显示 ID | ✅ |
| `description_zh` / `description_en` / `description` | ✔ | ✔ | 卡片两行说明、详情简介（按界面语言取，缺了退回另一种） | 显示「暂无说明」 | ✅ |
| `category` | ✔ | ✔ | 分类筛选、卡片分类标签；必须是 `/marketplace/categories` 里的 `code` | 归为「通用」 | ✅（但 H4 缺表） |
| `version` | ✔ | ✔ | 和本机安装版本比较，新于本机就标「有更新」、详情出「更新」 | 无法判断更新 | ✅ |
| `published_at` / `updated_at` | ✔ | ✔ | 版本号相同时用时间比新旧 | 同上 | ✅ |
| `status` | ✔ | ✔ | `published` 才可安装；`disabled`：未安装的不出现在平台组，已安装的标「已被 Hub 停用」且不可用 | — | ✅ |
| `min_app_version` | ✔ | ✔ | 高于本机客户端版本时按钮变「需要更新客户端」 | 视为无下限 | ✅ |
| `avatar: { icon, color }` | ✔ | — | 智能体头像（技能用名称首字） | 按 ID 生成默认头像 | ✅ |
| `skill_refs: [{ content_id }]` | ✔ | — | 装智能体时自动补齐依赖（S3 已有） | 改为下载包后再读 | ✅ |
| `default_install` | ✔ | ✔ | 迁移后用于默认安装（与 H3 配合） | — | 字段已有 |
| `examples` | 🆕 | 🆕 | 详情「智能体帮你做 / 技能帮你做」：每条一整行按钮，**点了直接以这句话新建任务并发送**（未安装的先安装再发送）。最多显示 5 条 | 只显示一条通用示例「请用 X 帮我处理这项工作」 | 🆕 |
| `does` | 🆕 | 🆕 | 详情「能做什么」：浅色卡片里的打勾列表，建议 3–5 条、每条一句短话 | 不显示这块 | 🆕 |
| `tags` | 🆕 | 🆕 | 详情简介下的标签（可选，有就显示） | 不显示 | 🆕 |

**`examples` / `does` / `tags` 的格式**（客户端当前的解析规则）：

```json
{
  "examples": ["帮我把这份周报里的数字核对一遍", { "prompt": "列出这份合同里的风险条款" }],
  "does": ["找出缺失与重复数据", "核对汇总与明细是否对得上", "输出异常清单及来源"],
  "tags": ["财务", "表格"]
}
```

- `examples` 每项可以是字符串，或带 `prompt`（或 `text`）的对象；空串会被忽略；兼容旧名 `example_prompts`。
- **多语言**：客户端目前读不带语言后缀的字段。建议 Hub 按请求头 `Accept-Language` 返回对应语言（最省事）；如果更想下发 `examples_zh` / `examples_en` 这类分语言字段，告诉客户端，客户端改成按界面语言取（改动很小）。这一点和 P3 一起定。
- 写作口径（来自参考稿）：示例是用户会直接发出去的一句话，以「使用 <名称>，……」或直接的任务句开头；「能做什么」写结果，不写实现细节。

### 3.3 默认安装：`/marketplace/defaults`（新增，H3）

请求体：`{}`。客户端在**用户登录后**调用（未登录不调），按返回逐个安装；用户删过的（本机有删除记录）不会重新装回。客户端读取的响应：

```json
{
  "code": 0,
  "agents": [
    { "id": "0fdb4da8a080", "version": "0.2.0", "published_at": 1784564940000, "updated_at": 1784564940000,
      "agent_json_url": "…", "agent_skills_bundle_url": "…", "create_uid": "0",
      "status": "published", "min_app_version": "" }
  ],
  "skills": [
    { "id": "02d958231673", "version": "1.1.0", "published_at": 1784564940000, "updated_at": 1784564940000,
      "bundle_url": "…", "create_uid": "0", "status": "published", "min_app_version": "" }
  ]
}
```

- 这一接口沿用的是**旧格式**（`id`、毫秒时间、`*_url`），与新目录（`content_id`、RFC 3339、`artifact.download_url`）不一样。Hub 如果想统一成新格式，先说一声，客户端在边界加一次归一即可，**不要两边各自悄悄改**。
- `status` 也接受旧名 `state`，`min_app_version` 也接受 `minAppVersion`。

### 3.4 分类表：`/marketplace/categories`（新增，H4）

请求体：`{}`。响应：

```json
{
  "code": 0,
  "list": [
    { "code": "data", "name_zh": "数据", "name_en": "Data", "name_ja": "データ", "name_pt": "Dados", "sort_order": 10 },
    { "code": "general", "name_zh": "通用", "name_en": "General", "name_ja": "汎用", "name_pt": "Geral", "sort_order": 999 }
  ]
}
```

- 客户端缓存 24 小时；拉取失败时用内置的一份默认表，所以接口挂了不会白屏，但分类会不准。
- `code` 是目录行 `category` 的取值；**请保留 `general`**，客户端把缺分类和不认识的分类都归到它。客户端里旧分类 `writing` 会被视为 `creation`。

### 3.5 S4 不改、沿用 S3 的接口

`/marketplace/agents/detail`、`/marketplace/agents/bundle`、`/marketplace/skills/bundle`、贡献相关的 `/marketplace/contributions/*`、`/marketplace/builtin-capabilities/manifest`：S4 没改调用方式。安装依旧走「下载 → 质量 / 安全检查 → 登记」，安全卡与质量报告照旧弹出；S4 只是去掉了「将同时安装」确认框。

## 4. 本机联调时发现的 Hub 侧问题（供参考）

| # | 现象 | 影响 | 建议 |
|---|---|---|---|
| F1 | Hub 默认存储目录 `media/marketplace` 是空的，发布物实际在 `~/Library/Caches/cogseed-hub-joint/media`；按默认目录启动后，5 个智能体全部报「发布物字节不可读取」，**从目录里被静默去掉**（Hub 代码注释里提过 `total` 仍会把它们算进去） | 客户端看到的列表比库里少，用户以为没有这些内容 | 存储目录固定下来（`scripts/local-dev.mjs` 已钉死，但单独 `pnpm dev:hub` 时没有）；读不出发布物时至少在运营台显式报出来，并保持 `total` 与 `list` 一致 |
| F2 | 本机 Hub 库里 32 个随包智能体一个都没有；技能缺 `c09e11d17a01`（cognition-editor） | H1 的工作量 | 以正式 Hub 为准重新比对（附录 A / B 可直接当清单用） |
| F3 | `/marketplace/categories`、`/marketplace/defaults` 不存在（404） | 见 H3、H4 | 见 H3、H4 |

本机联调方式（只开后台、不开账号服务，所以登录走不通；客户端要关掉登录门禁才能看平台内容）：

```bash
cd ~/Desktop/cogseed-hub-20261014 && NODE_ENV=development HUB_ISOLATED_VALIDATION=1 \
  DATABASE_URL=postgres://cogseed:synthetic-local-only@127.0.0.1:55439/cogseed_hub_local_dev \
  PAYLOAD_SECRET=synthetic-local-validation-secret-32-characters NEXT_PUBLIC_SERVER_URL=http://localhost:3000 \
  HUB_SKILL_STORAGE_DIR="$HOME/Library/Caches/cogseed-hub-joint/media" \
  node node_modules/next/dist/bin/next dev --webpack --hostname 127.0.0.1 --port 3000
```

客户端用 `COGSEED_HUB_ENABLED=false scripts/restart-cogseed.sh restart` 启动（源码运行默认连 `http://localhost:3000`）。完整联调（含登录）按 Hub 仓库 `docs/local-client-integration.md`，需要先装 mkcert 并信任其证书。

## 5. 验收清单（Hub 侧做完后，客户端一起走）

1. 全新账号、清空本机后联网首次打开：智能体页「平台」组能看到附录 A 的内容（未安装的显示「安装」）；技能页同理（附录 B）。
2. 登录后：H3 默认安装的内容自动出现在「已安装的智能体 / 技能」里。
3. 装一个有依赖的智能体（附录 A「依赖技能数」> 0 的任意一个）：不弹确认框，依赖技能自动一起装好。
4. 点开任一内容详情：有「能做什么」打勾卡片、有 3 条以上示例、点示例能直接发出去（H5、H6）。
5. 分类筛选的分类名和 Hub 分类表一致，不再全是「通用」（H4）。
6. 在 Hub 上把某个技能改版本号发布：客户端卡片出现「有更新」，详情「更新」后版本变新。
7. 在 Hub 上停用某个内容：未安装的从平台组消失；已安装的标「已被 Hub 停用」、不能用。
8. 断开 Hub：顶部提示「暂时连不上平台」+ 重试，已安装的照常可用。

## 6. 客户端这边对应已做的（便于对照，不需要 Hub 做）

- 首页三组 / 技能首页只有平台组；平台组「已安装在前、未安装在后」，不标来源。
- 统一详情弹窗（能做什么、示例、会用到的技能；主按钮「使用」或「安装」；「卸载」只在已安装页）。
- 安装 / 安装中 / 安装失败可重试 / 有更新；去掉「将同时安装」确认框。
- 「已安装的智能体 / 技能」页：一行三个的卡片，状态筛选「全部 / 有更新 / 已停用」，需要处理的排前面。
- 未登录：平台组只显示已安装 + 登录提示，安装先请登录；断网：顶部提示 + 重试。
- 客户端自查待修（客户端侧做，Hub 无需处理）：从目录拉到的**未安装**智能体，详情「会用到的技能」目前读 `skill_list`，而新目录下发的是 `skill_refs`，所以这一栏暂时为空，客户端会改成读 `skill_refs`。

## 附录 A · 客户端随包的 32 个智能体（`resources/builtin/_manifest.json` → `inventory.marketplace_agents`）

「依赖技能数」不含 `builtin:` 内置能力；随包私有技能（`embedded_skills`）随智能体包走，不需要单独上架。

| # | ID | 名称 | 版本 | 依赖技能数 |
|---|---|---|---|---|
| 1 | `0fdb4da8a080` | PRD一致性检查Agent | 0.2.0-review.1 | 2 |
| 2 | `1ce66a5d9875` | 选品分析Agent | 1.0.0 | 2 |
| 3 | `287ce6012204` | Agent 创建师 | 1.0.0 | 0 |
| 4 | `2a2d007ec7e2` | 内容创作Agent | 1.0.0 | 2 |
| 5 | `2ec891859db3` | 文档一致性检查Agent | 0.2.0-review.1 | 2 |
| 6 | `36cb9c97ac31` | 代码库探索Agent | 0.2.0-review.1 | 2 |
| 7 | `37054bcc1740` | 文献综述Agent | 0.2.0-review.1 | 2 |
| 8 | `373f22475ab4` | 解决方案草案Agent | 0.2.0-review.1 | 3 |
| 9 | `39f682807819` | 周度状态Agent | 0.2.0-review.1 | 2 |
| 10 | `3bf780cd23be` | 学习研究Agent | 0.2.0-review.1 | 2 |
| 11 | `54f102b6c1ee` | 学习计划Agent | 0.2.0-review.1 | 2 |
| 12 | `57f6f828af9f` | 研究设计评审Agent | 0.2.0-review.1 | 2 |
| 13 | `5a5fe1598ed0` | 练习反馈Agent | 0.2.0-review.1 | 2 |
| 14 | `662cb1c1de2c` | 项目风险扫描Agent | 0.2.0-review.1 | 2 |
| 15 | `736cc1ac94b4` | 客户Context Agent | 0.2.0-review.1 | 2 |
| 16 | `78900d8758bc` | DeepResearcher | 1.0.35 | 4 |
| 17 | `78ef7f901e81` | 招聘评估缺口Agent | 0.2.0-review.1 | 3 |
| 18 | `7c3138523589` | 竞品研究Agent | 0.2.0-review.1 | 1 |
| 19 | `7ece3121592e` | 集成验证Agent | 0.2.0-review.1 | 3 |
| 20 | `876218dd6c3f` | 代码质量评审Agent | 0.2.0-review.1 | 2 |
| 21 | `8dcba242d360` | 客户需求评估Agent | 0.2.0-review.1 | 3 |
| 22 | `9099ea65848a` | 测试运行Agent | 0.2.0-review.1 | 2 |
| 23 | `9a26f9f2336d` | 文档来源探索Agent | 0.2.0-review.1 | 2 |
| 24 | `a0aaf36d3c37` | 简历批量解析Agent | 0.2.0-review.1 | 2 |
| 25 | `a37e8dbcc57e` | 引文核验Agent | 0.2.0-review.1 | 2 |
| 26 | `bc60fe682b5a` | 数据复盘Agent | 1.0.0 | 1 |
| 27 | `bcfcb4921dce` | UIDesigner | 1.3.9 | 13 |
| 28 | `c045605cb916` | Reimbursement Agent | 0.2.0 | 0 |
| 29 | `c0e5a377b91c` | 项目计划Agent | 0.2.0-review.1 | 2 |
| 30 | `e064dca9e1bd` | SeoGeoAgent | 1.0.13 | 10 |
| 31 | `fb836f8b51ca` | 候选人对比Agent | 0.2.0-review.1 | 3 |
| 32 | `fce0f5110ab2` | 文档变更影响Agent | 0.2.0-review.1 | 2 |

## 附录 B · 客户端随包的 59 个技能（`inventory.marketplace_skills`）

「本地 Hub」一列是本机 Hub 库的实测，正式 Hub 请重新核对。

| # | ID | 名称 | 版本 | 本地 Hub |
|---|---|---|---|---|
| 1 | `02d958231673` | product-copywriting | 1.1.0 | 有 |
| 2 | `058e3bb57bf5` | integration-map | 0.2.1-review.3 | 有 |
| 3 | `06d69ee5f1bc` | terminology | 0.2.1-review.3 | 有 |
| 4 | `0d95910c7f2f` | meeting-actions | 0.2.1-review.3 | 有 |
| 5 | `0e847fc8685e` | guided-learning | 0.2.1-review.3 | 有 |
| 6 | `13ac643c3ef9` | source-extraction | 0.2.1-review.3 | 有 |
| 7 | `15af984d02a5` | scope-wbs | 0.2.1-review.3 | 有 |
| 8 | `17b2d5e85d87` | reproducibility | 0.2.1-review.3 | 有 |
| 9 | `181e249741e9` | milestone-plan | 0.2.1-review.3 | 有 |
| 10 | `2b7f7c8621d5` | question-refinement | 0.2.1-review.3 | 有 |
| 11 | `36867a076129` | AI产品构建评测 | 0.2.0 | 有 |
| 12 | `396f58aeffd0` | AI产品风险排除 | 0.2.0 | 有 |
| 13 | `3def7f0eb34a` | weekly-review | 0.2.1-review.3 | 有 |
| 14 | `4334030f8314` | status-review | 0.2.1-review.3 | 有 |
| 15 | `464e3f3416cf` | solution-design | 0.2.1-review.3 | 有 |
| 16 | `4a8054f512e9` | daily-priority | 0.2.1-review.3 | 有 |
| 17 | `4bb1813c8335` | term-map | 0.2.1-review.3 | 有 |
| 18 | `4ff31e1cab6f` | design-review | 0.2.1-review.3 | 有 |
| 19 | `56023303d185` | AI产品阶段编排 | 0.2.0 | 有 |
| 20 | `577787fb975e` | prd-user-stories | 0.2.1-review.3 | 有 |
| 21 | `5a131fa3f845` | requirement-evidence | 0.2.1-review.3 | 有 |
| 22 | `6743aa0797a2` | brand-research | 1.1.0 | 有 |
| 23 | `6ba6255ee930` | review | 0.2.1-review.3 | 有 |
| 24 | `6c5609e76cf0` | literature-evidence | 0.2.1-review.3 | 有 |
| 25 | `7432875f93bf` | acceptance-evaluation | 0.2.1-review.3 | 有 |
| 26 | `78967e9cfe10` | feedback-summary | 0.2.1-review.3 | 有 |
| 27 | `79943922f937` | store-teardown | 1.1.0 | 有 |
| 28 | `86cea925e282` | academic-writing | 0.2.1-review.3 | 有 |
| 29 | `8ac59333bc31` | xhs-note-creator | 1.1.0 | 有 |
| 30 | `8d2f4b7c9a10` | paper-repro | 1.1.0 | 有 |
| 31 | `8f090a1b0c27` | resume-evidence | 0.2.1-review.3 | 有 |
| 32 | `90da4ae1fac4` | acceptance-evidence | 0.2.1-review.3 | 有 |
| 33 | `910301a3f5be` | AI产品资格评审 | 0.2.0 | 有 |
| 34 | `93d7b28fb6b4` | implementation-plan | 0.2.1-review.3 | 有 |
| 35 | `98e6c144f229` | interview-design | 0.2.1-review.3 | 有 |
| 36 | `991ac94fc4e1` | testing | 0.2.1-review.3 | 有 |
| 37 | `9a2bc04da822` | risk-dependency | 0.2.1-review.3 | 有 |
| 38 | `9be6fda271a5` | material-organizer | 1.1.0 | 有 |
| 39 | `a31023dd51a0` | sales-data-review | 1.1.0 | 有 |
| 40 | `a5c864d6b267` | ecommerce-price-research | 1.1.0 | 有 |
| 41 | `a79d235e416b` | AI产品机会发现 | 0.2.0 | 有 |
| 42 | `a827416958f6` | product-metrics | 0.2.1-review.3 | 有 |
| 43 | `a988c001dc65` | debugging | 0.2.1-review.3 | 有 |
| 44 | `aef5bf07573f` | reading-notes | 0.2.1-review.3 | 有 |
| 45 | `afae324569e2` | competitor-market-research | 0.2.1-review.3 | 有 |
| 46 | `bc0be37d6755` | feature-prioritization | 0.2.1-review.3 | 有 |
| 47 | `c07c2cab295d` | information-architecture | 0.2.1-review.3 | 有 |
| 48 | `c09e11d17a01` | cognition-editor | 1.1.0 | **缺** |
| 49 | `c65fa3eae763` | context-clarification | 0.2.1-review.3 | 有 |
| 50 | `d1e0d20f4b28` | AI产品上线学习 | 0.2.0 | 有 |
| 51 | `d3d406dffdbc` | repo-exploration | 0.2.1-review.3 | 有 |
| 52 | `d5041e397e79` | match-matrix | 0.2.1-review.3 | 有 |
| 53 | `d5d2fb6337fb` | technical-writing | 0.2.1-review.3 | 有 |
| 54 | `e117a4a3afef` | jd-intake | 0.2.1-review.3 | 有 |
| 55 | `e12403164f5f` | delivery-risk | 0.2.1-review.3 | 有 |
| 56 | `e7f5c0e6f1be` | social-data | 1.1.0 | 有 |
| 57 | `ee99fbb42964` | deep-research | 1.1.1 | 有 |
| 58 | `f45f8fe237c9` | AI产品立项聚焦 | 0.2.0 | 有 |
| 59 | `ffaad9705891` | version-diff | 0.2.1-review.3 | 有 |

> 另有 8 个**系统内置技能**（`agent-creator`、`skill-creator`、`coding`、`package-installer` 等）是产品规程文件，单独注入提示词、不进商店，**继续留在客户端，不在本次范围**。
