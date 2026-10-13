# 实施记录：第一阶段（不依赖 Hub 的部分）

> 2026-10-12。对应 `plan.md` 步骤 1～8。仓库 `develop` 没有 `docs/changes/`，所以记录放在 spec 目录。**未提交、未推送。**
> 分支 `feat/hub-agent-distribution`，基线 `origin/develop` `5491969e`。

## 交付了什么

| 步骤 | 文件 | 行为 |
|---|---|---|
| 1 Agent 包规则 | `src/main/features/contribution/agent-package-rules.ts` | 纯函数：`agent.json` 严格校验（`zod`，多余字段拒绝）、名称规则（字符集、宽度、保留名）、`skill_list` 三类判定、本机处理（剥离）、四段包上限（走配置） |
| 2 提交副本 | `agent-staging.ts` | 把本机自建 Agent 与其引用的本机 Skill 复制到暂存目录，只作用于副本；私有 Skill 写入 `ownerAgent` |
| 3 本机检查 | `agent-admission.ts` | 汇总：阻断项、`agent.json` 校验、包上限预检、Agent 本体红线、**每个随包 Skill 各跑一次**现有准入（安全声明门） |
| 4 请求体与打包 | `agent-submission-request.ts`、`package.ts`、`preview.ts`、`hub-client.ts` | 叶模块组装 `content_type: 'agent'` 的 manifest；打包后给出四段上限实测数据；提交请求头加 `CogSeed-Channel`；`createSubmission` 同时支持 Skill 与 Agent |
| 5 会话与 IPC | `agent-contribution.ts`、`session.ts`、`store.ts`、`ipc/contribution.ts` | 开始 / 确认预览 / 提交主流程（业务在 feature，IPC 只接线）；`contribution.agent.start / confirm / submit` 三个通道；本机 Agent 提交 UUID 持久化 |
| 6 界面 | `hub-agent-contributions.js`、`hub-contributions.js`、`hub-contributions-model.js`、`agents.js`、`state.js`、`index.html`、`style.css`、`lazy-features.js`、`locales/{zh,en}.json` | 智能体卡片「贡献」按钮、工具栏「我的贡献」、Agent 贡献整页（检查 → 预览与声明 → 提交）、「我的贡献」类型切换（全部 / 智能体 / 技能） |
| 7 依赖与安装 | `marketplace_agent_deps.ts`、`marketplace.ts`、`marketplace_private_skills.ts`、`ipc/index.ts` | 依赖规划（复用 / 安装 / 随包 / 阻断，**版本策略是单个可替换函数**）；安装时按规划执行，被停用的依赖在下载前就拒绝；私有 Skill 的 `ownerAgent` 在安装时改写成安装后的 Agent id；只读的「将同时安装」预览 `marketplace.agentInstallPlan` |
| 6 市场确认 | `marketplace.js`、`locales/{zh,en,ja,pt}.json` | 点「安装」后先弹「将同时安装」：列出 Hub 技能与随包技能、说明已有的直接复用不更新；被停用的依赖在下载前就说清楚并停止；预览失败不挡安装 |
| 登记 | `docs/renderer-structural-registry.md`、`scripts/opensource/policy.json` | 新增 `HUBC-PV-004`（Proposed）；30 个新文件登记进开源清单 |

## 与计划的偏差与新发现

1. **私有 Skill 的 `ownerAgent` 约定（需与 Hub 确认）。**现有机制里 `ownerAgent` 是宿主 Agent 的 id；贡献时 Hub 还没分配 `content_id`，所以提交副本里写**本机 `agent_id`**（并要求 `agent.json` 同样带 `agent_id`），安装时由客户端改写成安装后的 Agent id。Hub 契约里"`ownerAgent` 必须指向本 Agent"的校验口径要据此对齐。
2. **请求头 `CogSeed-Channel`：只有贡献客户端缺。**市场请求（`marketplace.ts` 的 `postJson` 等）本来就走 `withCommonHeaders`，已带通道头；`contribution/hub-client.ts` 自己拼头，没带。已补并加测试。
3. **依赖"已有复用、不升级"是现有行为。**`_skillAlreadyOnDisk` 本来就让已有 Skill 跳过安装；新增的是：已有但被 Hub 停用 → 阻断，以及 `builtin:` 本期明确拒绝。
4. **现有 Agent 的私有 Skill 安装能力已经齐全**（每 Agent 独立目录、深扫、回滚、按 Agent 记回执），本期没有重写，只在其上加规划与改写归属。
5. **曾误覆盖一个已有测试文件。**我新建 `marketplace_private_skills.test.ts` 时覆盖了仓库里同名的已有文件，随即用 `git` 恢复原内容并把新用例并入；最终该文件含原有 2 条加新增 5 条，均通过。
6. 本期仍**不做** `builtin:<name>`（指向未核实）；`skill_list` 出现它会被阻断（提交与安装两处）。

## 验证记录

详见本文末尾「验证结果」。

## 尚未做、需要后续

- **与真实 Hub 联调**：Hub 的白名单扩充与 B-01/B-02/B-05 尚未就绪，所有 Hub 交互目前只用替身验证。
- ~~Agent 市场详情页里的依赖清单~~、~~智能体卡片上的依赖状态~~：**已补做**（T030、T031，见 `tasks.md`）。卡片规则：依赖被 Hub 停用 → 禁用「使用」并提示；本机缺依赖 → 只提示不禁用（存量 Agent 的失效旧引用运行时本来就被忽略，直接禁用会误伤）。
- **「更新」流程**（装完后依赖更新、更新失败保留旧版）：本期只复用了现有 Skill 更新通道，未新增 Agent 更新界面。
- **`ja` / `pt` 文案**：现有贡献文案本来就只有 `zh` / `en`，本期沿用。
- **真实应用里的人工验证**：尚未重启应用目视确认（见下）。

## 验证结果

在 worktree `cogseed-agent-s3`（`feat/hub-agent-distribution`）执行，`node_modules` 为指向主目录的符号链接（已被 `.gitignore` 忽略）。

| 命令 | 结果 |
|---|---|
| `npm run typecheck` | **passed**（无输出，exit 0） |
| `npm run tokens:check` | **passed**（2900 条既有项，无增加） |
| `npx eslint <全部改动与新增的 .ts/.js 文件>` | **passed**（exit 0）。未跑整仓 `npm run lint`：**not run** |
| `node scripts/run-tests.mjs run`（全量） | **13 个文件、41 个用例失败，1272 个文件通过**。这 13 个文件与 41 个用例**在未改动的基线 `5491969e` 上完全相同地失败**（用独立检出逐一核对，已清理），属既有环境问题（打包/签名闸门、PDF 提取、嵌入模型下载、`file_indexer` 等），与本期无关 |
| 新增与改动的测试 | 贡献相关 7 个主进程测试文件 + 依赖规划、私有 Skill 归属、IPC 边界、渲染进程模型、市场安装确认、懒加载清单，**全部通过** |
| 页面渲染（无头 Chrome，真实 CSS 与真实共享组件，IPC 为替身） | **passed**：Agent 贡献页渲染（预览、技能清单、已移除字段、版本与声明）；填完声明后提交按钮才可点；调用顺序 `declare ×3 → agent.confirm → agent.submit(带版本) → mine`；卡片「贡献」按钮命中测试通过（真实层级令牌下不被 `.agent-card-open` 盖住） |
| 在真实应用里重启并目视验证（`scripts/restart-cogseed.sh`） | **not run**：本机另有一个在跑的开发版应用，且本期 Hub 接口尚未就绪，没有可联调的对端 |
| 与真实 Hub 联调 | **not run**：Hub 侧未就绪 |

测试里踩到并已修复的两处（均由本期引起）：
1. 全局通道登记测试（`ontology-step2-guard`）要求新 IPC 通道登记，已登记 `marketplace.agentInstallPlan`。
2. `freeze-gates.test.ts` 会把 `test/fixtures/hub-contributions/` 下的一切当文件读取，我放进去的 `agent/` 子目录让它报 `EISDIR`；已把 Agent 夹具移到独立目录 `test/fixtures/hub-agent-contributions/`。


## 2026-10-13 补充：预览高亮与更新判定

- 预览高亮（AG-FR-064）：纯检测器 `agent-sensitive-hints.ts`，每文件最多 10 处、总计 50 处；流程门 `confirmAgentPreview(...,{acknowledgeHints})` 未勾选返回 `hints_unacknowledged`；页面逐行 `<mark>` 高亮。
- 更新判定：`agent_catalog_update.ts` 为纯函数 + 注入式分页读取，**未接任何真实接口**；联调时只需提供 `fetchPage`。
- 验证：typecheck、tokens:check、`eslint .` 通过；全量测试仍是基线同样的 13 个文件/41 个用例失败，无新增。真实应用目视与 Hub 联调 **not run**。
