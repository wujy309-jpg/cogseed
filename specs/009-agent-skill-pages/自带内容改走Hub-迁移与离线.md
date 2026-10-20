# S4｜自带智能体与技能改走 Hub 分发：迁移与离线

2026-10-19 · 给嘉宇商量用 · 依据：客户端仓库 `mate-agent-develop`（develop）代码、S3 规格 `specs/008-hub-agent-distribution`

## 结论（中扬已定）

客户端不再预装智能体和技能，平台内容**全部来自 Hub 分发**。新版本发布前，现在自带的内容要**全部在 Hub 上发布、维护好**，本地先验证。要考虑上线迁移。

不在范围内：**8 个系统内置技能**（`agent-creator`、`skill-creator`、`coding`、`package-installer` 等，在 `resources/builtin/system/skills/`）。它们是产品规程文件，单独注入提示词，不进商店，继续留在客户端。

## 先说清楚：现在的"自带"是怎么实现的

- 安装包里放着 `resources/builtin/marketplace/`：**32 个智能体、58 个技能**，ID 是 12 位十六进制，和 Hub 同一套（清单见 `resources/builtin/_manifest.json` 的 `inventory`）。
- 启动时 `seedBuiltinMarketplaceForUser`（`src/main/features/builtin_marketplace.ts:643`）把它们**复制进普通的市场安装目录**，写进安装记录 `installs.json`，打上 `seed_source: 'builtin'`。联网后由市场对账接管。
- 安装包里的版本更新时，会**覆盖**同 ID 的本机安装，让还没在 Hub 发布的改动也能跑。
- 用户删过的记在 `_deleted_at`；但自带技能有一个"在某日期前删除的会被重新装回"的例外（`_shouldBypassBuiltinSkillTombstone`）。
- Hub 另有"默认安装"：登录后 `ensureDefaultInstalls` 请求 `/marketplace/defaults` 自动装（`marketplace.ts:2164`），**未登录不装**。

所以"自带"本来就是"提前装好的 Hub 内容"。改走 Hub，主要是**停止随包预装**，并处理好已有用户。

## 要和嘉宇定的事

| # | 事项 | 现状 / 风险 | 建议 |
|---|---|---|---|
| 1 | **Hub 上是否已有全部 32 + 58** | S3 记录过"Hub 是否已知所有预置 ID，**未核实**"。安装包版本可能比 Hub 新（覆盖机制就是为此） | 23 号 Hub 恢复后，用脚本对比 `_manifest.json` 的清单和 Hub 列表（ID + 版本），缺的或版本旧的先发布 |
| 2 | **老用户升级后怎么处理** | 本机已有带 `seed_source: 'builtin'` 的安装记录 | 原样保留，当作"用户已安装"：进"已安装"页，可以停用、卸载，用户什么都不丢。去掉"随包覆盖"和"删除后重新装回"这两个机制 |
| 3 | **新用户第一次打开** | 不预装后，平台组在联网、登录前是空的；`default_install` 只在登录后生效 | 在 Hub 上把必需的几个标成 `default_install`，登录后自动装；首页"平台"组照常从 Hub 列表拉 |
| 4 | **断网 / Hub 挂了** | 已装的在本机，照常可用；商店列表有本地缓存（`marketplace.getListingsCache`），首页提示"暂时无法获取平台内容"（R4） | 已装的不受影响。**唯一的空档是"新用户首次打开就断网"**，要不要兜底，看下面 WorkBuddy 的做法再定 |
| 5 | **报销智能体 `c045605cb916`** | 它是客户端认定的固定 ID（`expense_workbench/canonical-agent.ts:6`），只能管理不能对话，S3 写过"不能冒用该 ID 或管理入口" | 单独确认：留在客户端，还是走 Hub 但保证 ID 不变 |
| 6 | **自带智能体依赖自带技能** | 31 个自带智能体有 61 条引用指向自带技能（S3 统计）。不预装后，装智能体时要从 Hub 一并装依赖 | 依赖自动补齐 S3 已实现（AG-FR-013a），确认 Hub 上这些技能都已发布即可 |
| 7 | **发布顺序** | Hub 没准备好就发客户端，新用户会看到空平台 | 先 Hub 全部上架并验证 → 再发客户端。客户端是否保留一版兜底，见第 4 条 |
| 8 | **本地验证** | — | 用全新账号、清空本机后：联网首次打开，看平台组、安装、使用、依赖补齐；再用老账号升级，看原有内容是否都在"已安装"里 |

## 参考：WorkBuddy 怎么做（2026-10-19 查本机安装包）

- 智能体（WorkBuddy 叫"专家"）的完整列表**从云端拉取**（`expert_center.json`），缓存在 `~/.workbuddy/app/cache/experts/`，本机缓存里有 **448 个**。
- 安装包里**只带一份精选推荐**：`builtin-expert-recommendations/curated-experts.json`，**60 条**，只有 ID、场景和一句简介，不是完整内容。
- 技能方面，安装包里带了一个内置插件 `workbuddy-builtin`，含 **46 个技能**。

也就是说，WorkBuddy 是"**少量随包 + 完整列表靠云端 + 本地缓存**"的混合做法。断网时实际显示什么，正在做离线实验（已清掉它的专家列表缓存和网页缓存，备份在 `~/.workbuddy-cache-backup-20261019/`）。

## 和 S4 设计的关系

- **D-11（自带内容集中开关）不用做了**：没有"自带的"这一类，所有平台内容装了就进"已安装"，能停用、能卸载。
- 首页"平台"组只剩两种状态：已安装（"使用"）、未安装（"安装"）。原型里"客户端自带、直接用"的那几张卡片要改。
- 统计口径（D-08）更简单：所有平台内容都经过"安装"，按安装、按人计数，口径统一。
