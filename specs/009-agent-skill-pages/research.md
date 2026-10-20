# Research: S4 智能体 / 技能页面改版

2026-10-19 · 依据 develop 当前代码。每条：决定 / 理由 / 考虑过的其他做法。

## R-01 平台组的数据来源

- **决定**：平台组 = 本机已安装的平台内容（`agents.list` / `skills.list` 中 `source` 归一为 `marketplace` 的项，含 `seed_source: builtin` 与 `default_install`）∪ 市场目录中未安装的项（复用 `marketplace.listAgents` / `listSkills` 及其本地缓存 `marketplace.getListingsCache`）。按「已安装 → 未安装」排序，同 id 以已安装为准。
- **理由**：`normalizeCatalogSource`（`src/renderer/modules/utils.js:168`）已把 `builtin` / `platform` 归为 `marketplace`；随包内容就是登记过的普通安装（`builtin_marketplace.ts`），界面统一时不需要读 `seed_source`。
- **其他做法**：按 `seed_source` 区分「自带」——被 2026-10-19 结论否决。

## R-02 首页与「我的」「已安装」三个视图放在哪

- **决定**：都放在现有 `#panel-agents` / 技能面板内，由 `agents.js` / `skills.js` 切换子视图（首页 / 我的 / 已安装），沿用 `agents-source-section`、`agent-card`、`marketplace-card`、`skill-card`、`hubc-backline`；「更多」入口与独立的 `#panel-marketplace` 不再从智能体 / 技能页进入。市场页的列表、安装、卸载函数继续在 `marketplace.js` 里，供两个页面调用。
- **理由**：宪章 IV 要求复用共享控件；`marketplace.js` 已有 `_mpInstall(kind, …)`、卸载、更新判定（`_mpInstallStatus`），重写会重复逻辑。
- **其他做法**：把市场页整体并入智能体页 DOM——改动面更大，且技能页同样需要。

## R-03 详情弹窗

- **决定**：新增一个共享渲染函数，按 `connectors.js` `_openConnectorPopup`（`:1262`）的写法用 `uiModal` lg；智能体、技能、平台、自建、外接、本机已有同一入口，按类型决定底部按钮（spec FR-007）。原型样式 `.ap-popup-*` 合并为通用类，进入 `style.css` 并走 `cogseed-component-change` 技能流程。
- **理由**：同一概念不做两套详情；连接器弹窗已是被接受的版式。
- **其他做法**：沿用现有整页详情（`_renderAgentDetail`）——会暴露工作流程等内部结构，违背 FR-006。现有整页详情保留为自建 / 外接的「管理」入口（编辑工作台）。

## R-04 安装 / 使用与「点示例一步」

- **决定**：卡片「安装」= 调用 `_mpInstall`，成功后只刷新状态；详情点示例 = `_mpInstall` 成功后调用 `useAgent` / `useSkill` 并以该示例作为初始消息。移除 `_mpConfirmAgentInstall` 的「将同时安装」弹窗（依赖规划 `previewAgentInstallPlan` 仍用于阻断判定与详情里「会用到的技能」展示）；安全卡 `_mpShowSecurityCard`、质量报告 `showValidationReport` 照旧。
- **理由**：Q1 / Q2 = A；`_mpInstall` 已含锁、失败提示、回滚。
- **其他做法**：主进程新增「安装并使用」IPC——没必要，渲染层串联即可，IPC 不变。

## R-05 更新

- **决定**：卡片「有更新」与详情「更新」复用 `_mpInstallStatus().updateAvailable` 与 `_mpInstall`（主进程 `installMarketplaceAgentForUser` 已有 `beginAgentReplace`：失败恢复旧版；在途任务按版本固定）。
- **理由**：Q（更新入口）= A；S3 已实现。

## R-06 已安装页

- **决定**：列表 = 本机已安装的平台内容（R-01 中的已安装部分）；开关复用 `agents.setEnabled` / `skills.setEnabled`；卸载复用 `marketplace.uninstallAgent` / `uninstallSkill`。卸载随包内容后，市场对账靠 `_deleted_at` 不再装回；随包「删除前日期会被重装」的例外（`_shouldBypassBuiltinSkillTombstone`）属于迁移任务，不在本期改。
- **风险**：用户卸载随包技能后，若该例外仍生效，下次启动可能被装回。实施时实测；若出现，在 tasks 里记为已知问题交迁移任务处理。

## R-07 停用依赖提示（FR-027）

- **决定**：
  1. 主进程 `agent_dependency_state.ts` 在判定依赖时，额外读取用户停用名单（`component_enabled.isSkillEnabled`），新增状态原因 `user_disabled`（与现有 `disabled` = 平台停用区分）；`agents.list` 返回的 `dependency_state` 带上它。
  2. 渲染层停用技能前，从已加载的智能体列表的 `skill_list` 反查引用者，有则弹确认。
  3. `user_disabled` 归入 `deps_blocked`，复用现有「依赖已停用时禁用使用」的逻辑（`agents.js:958`），与 S3 平台停用一致（2026-10-19 确认）；详情提供一键启用。
- **理由**：现有 `dependency_state` 只看平台状态（`agent_dependency_state.ts:64`）；反查在渲染层用已有数据即可，不新增 IPC。
- **其他做法**：新增「谁引用了这个技能」IPC——数据渲染层已有，没必要。

## R-08 「我的技能」与本机已有技能

- **决定**：自建 = `skills.list` 中 `custom`；本机已有 = `skills.listOpen`（外部包 + 全局文件夹，`_openSkillsSectionHtml` 现有数据源）。外部包移除复用 `packages.action`（`command: 'remove'`）；单技能停用复用 `skills.setEnabled`。
- **全局文件夹总开关**：主进程已有 `config.ts` `get/setGlobalSkillRootsEnabled`，**但没有 IPC**。新增一对只读写偏好的 IPC（例如 `skills.getGlobalRootsEnabled` / `skills.setGlobalRootsEnabled`），IPC 只校验参数并调用 config，写后 `invalidateSkills()`。
- **其他做法**：放进设置页——与「本机已有技能就在我的技能里管」的结论不一致。

## R-09 未登录与断网

- **决定**：登录态复用 `hub-account.status`；未登录时平台组只渲染已安装项并显示登录提示，「安装」「贡献」点击先走现有登录提示。断网沿用现有市场列表失败分支（顶部提示 + 重试），平台组只渲染已安装项。
- **理由**：Q（未登录）= A；不做离线兜底。

## R-10 文案与测试

- **决定**：新文案进 `src/renderer/locales/{zh,en,ja,pt}.json`；测试放 `test/renderer/`（参照现有 `marketplace-card-states.test.ts`、`agent-card-contribution-states.test.ts`）与 `test/main/`（依赖状态）。按 AGENTS.md 跑 `npm run typecheck`、`npm test`。
- **原型检查**：`specs/009-agent-skill-pages/prototype/check/flow.cjs` 作为交互基线，不替代真实测试。
