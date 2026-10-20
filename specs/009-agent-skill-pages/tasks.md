---
description: "Task list for S4 智能体 / 技能页面改版（客户端侧）"
---

# Tasks: S4 智能体 / 技能页面改版（客户端侧）

**Input**: Design documents from `specs/009-agent-skill-pages/`

**Prerequisites**: [plan.md](plan.md)、[spec.md](spec.md)、[research.md](research.md)、[data-model.md](data-model.md)、[contracts/ui-and-ipc.md](contracts/ui-and-ipc.md)、[quickstart.md](quickstart.md)

**Tests**: 用户要求包含测试任务。渲染层测试放 `test/renderer/`，主进程测试放 `test/main/`；交互基线参照 `specs/009-agent-skill-pages/prototype/check/flow.cjs`。

**Organization**: 按 spec.md 的 5 个用户故事分阶段，每个故事可独立实现和验证。

> 注：`setup-tasks.sh` 因本机缺 PyYAML 无法合成预设模板，本文按 `.specify/templates/tasks-template.md` 手工生成。本期不涉及 AI 行为，`ai-product-method` 任务附录不适用（见 spec「AI Product Decision Contract」）。

## Format: `[ID] [P?] [Story] Description`

- **[P]**：可并行（不同文件、不依赖未完成任务）
- **[Story]**：所属用户故事（US1～US5）

---

## Phase 1: Setup

**Purpose**: 建分支、确认基线

- [X] T001 从最新 `origin/develop` 新建功能分支 `feat/s4-agent-skill-pages`；确认工作区里 `run.sh`、`src/main/index.ts`、`test/main/util/runtime-launcher.test.ts` 三个本地改动**不进入任何提交**（只 stage 本任务相关文件）
- [X] T002 跑基线并记录结果：`npm run typecheck`、`npm test`（记录既有失败用例，后续只比较新增失败），写入 `specs/009-agent-skill-pages/implementation-notes.md`
- [X] T003 [P] 阅读 `.agents/skills/cogseed-component-change/SKILL.md` 与 `AGENTS.md` 渲染层 / i18n / 测试规则，把本期要遵守的检查项摘到 `specs/009-agent-skill-pages/implementation-notes.md`

---

## Phase 2: Foundational（所有用户故事的前置）

**Purpose**: 共享的数据组合、弹窗、文案与页面骨架

- [X] T004 新建 `src/renderer/modules/catalog.js`，放入 `marketplace` 懒加载包且排在 `marketplace.js` 之后：分页读取平台目录，合并本机已安装的平台内容（含 `seed_source: builtin` 与 `default_install`），同 id 以本机为准，排序「已安装 → 未安装」；智能体页、技能页先 `loadRendererFeature('marketplace')` 再使用目录与按钮状态机；实际落点记录在 implementation-notes.md
- [X] T005 [P] 在 `src/renderer/modules/catalog.js` 实现统一详情弹窗 `openCatalogPopup(item, { kind, origin, actions })`，按 `connectors.js` `_openConnectorPopup` 写法用 `uiModal` lg（图标插标题栏最前、说明行、示例整行 `uiButton`、操作放 footer）；正文：简介、标签、示例（缺示例时生成通用示例「请用 X 帮我处理这项工作」，FR-026）、会用到的技能（智能体，带就绪状态）、能做什么（技能）；不展示工作流程原文 / schema（FR-006）
- [X] T006 [P] 在 `src/renderer/style.css` 增加弹窗与列表通用类（由原型 `specs/009-agent-skill-pages/prototype/app.css` 的 `.ap-popup-*`、`.ap-manage-*`、`.ap-mine-local`、`.ap-card-off` 合并改名为正式类），只用 `tokens.css` token；按 cogseed-component-change 流程登记
- [X] T007 [P] 在 `src/renderer/locales/zh.json`、`en.json`、`ja.json`、`pt.json` 新增本期全部文案键（分组标题、安装 / 安装中 / 安装失败可重试 / 有更新 / 已安装的智能体 · {n} / 已安装的技能 · {n} / 已启用 {on} / 共 {total} / 空态 / 登录提示 / 断网提示 / 停用依赖确认 / 总开关 / 移除外部包确认 / 通用示例等），四语齐全
- [X] T008 在 `src/renderer/index.html` 调整智能体、技能面板：首页工具栏去掉「+ 创建」(`#create-agent-btn`)、「我的贡献」(`#agents-mine-btn`)、「更多」(`#agents-more-btn`) 及技能页对应按钮，新增「我的… · N」「已安装的… · N」；为「我的」「已安装」两个子视图准备容器（复用 `hubc-backline` 返回行，放在 `.agents-grid-header` 外）；搜索框沿用 `.agents-search-field` + `agents-search-icon`；同时清理 `src/renderer/modules/skills-bindings.js` 里 `#skills-more-btn`、`#create-skill-btn` 在首页的绑定（创建改到「我的技能」）；**保留 `#panel-marketplace`**：开源项目区「更多能力 →」（`src/renderer/modules/oss.js:381`）仍用它，本期不改
- [X] T009 在 `src/renderer/modules/agents.js` 与 `src/renderer/modules/skills.js` 增加子视图切换（首页 / 我的 / 已安装），记住返回目标；切换时保留搜索的 IME 合成处理（合成中不过滤、不丢焦点，FR-029）

**Checkpoint**: 页面骨架、数据组合、弹窗可用，用户故事可开始

---

## Phase 3: User Story 1 - 在首页发现并使用平台内容 (Priority: P1) 🎯 MVP

**Goal**: 首页按三组（技能一组）展示，统一弹窗，使用与示例发送

**Independent Test**: 打开两页核对分组、排序、无来源字样；点已安装卡片开弹窗；点示例进入新任务并发送（contracts UI-01、UI-13）

### Tests for User Story 1

- [X] T010 [P] [US1] 新建 `test/renderer/catalog-home-groups.test.ts`：智能体页三组顺序「主智能体 → 外接 → 平台」；技能页只有平台；平台组已安装在前；含 `seed_source: builtin` 的项被当作已安装；首页无自建、本机已有、系统内置技能；DOM 中无「客户端内置 / 平台预置 / 平台分发」与「人在用」字样（FR-001～005）；搜索框输入法合成过程中（compositionstart→compositionend）不触发过滤、焦点不丢（FR-029）
- [X] T011 [P] [US1] 新建 `test/renderer/catalog-popup.test.ts`：各类型弹窗底部按钮符合 FR-007（主智能体只有使用；外接 管理/停用；自建 贡献/管理/停用；已安装平台 停用/卸载；外部包 停用/移除；全局文件夹 停用）；缺示例显示通用示例；停用时「使用」与示例置灰并有「启用」（FR-009）
- [X] T012 [P] [US1] 新建 `test/renderer/catalog-use-example.test.ts`：点「使用」调用现有 `useAgent` / `useSkill`；点示例以该示例作为初始消息进入新任务并发送（FR-008）

### Implementation for User Story 1

- [X] T013 [US1] 在 `src/renderer/modules/agents.js` 重写首页渲染（替换 `groups` 分组处，约 `:966`）：「主智能体」「外接智能体」用现有 `agent-card`，「平台」用 `marketplace-card` 渲染 `buildPlatformItems('agent')`；去掉「自定义」组；分类与搜索作用于三组
- [X] T014 [US1] 在 `src/renderer/modules/skills.js` 重写技能首页：只渲染「平台」组（`buildPlatformItems('skill')`）；`_openSkillsSectionHtml` 不再出现在首页
- [X] T015 [US1] 在 `src/renderer/modules/agents.js`、`skills.js` 把卡片点击改为 `openCatalogPopup`；自建 / 外接的「管理」继续打开现有整页详情（编辑工作台，`_renderAgentDetail`）
- [X] T016 [US1] 在 `src/renderer/modules/agents.js` 扩展 `useAgent` / `useSkill`（约 `:3655`、`:3743`）支持可选初始消息参数，弹窗示例调用后进入新任务并发送；停用项不可用（卡片变暗、标「已停用」）

**Checkpoint**: 首页与弹窗可独立演示

---

## Phase 4: User Story 2 - 安装平台内容 (Priority: P1)

**Goal**: 「安装 / 使用」按钮、点示例一步安装并发送、失败重试、有更新

**Independent Test**: 未安装卡片点安装（不跳转、+1）；详情点示例一步完成；断网安装失败后重试；有新版本时更新（UI-02、03、04、08）

### Tests for User Story 2

- [X] T017 [P] [US2] 在 `catalog-home-groups.test.ts`、`catalog-popup.test.ts`、`catalog-installed-view.test.ts` 覆盖未安装「安装」、安装中不可重复点、完成后「使用」且不自动进任务、有新版本标「有更新」（FR-010、FR-011、FR-013a）；市场面板本身的 `marketplace-card-states.test.ts` 保持原契约
- [X] T018 [P] [US2] 扩展 `test/renderer/marketplace-agent-install-plan.test.ts`：安装带依赖的智能体**不再**弹「将同时安装」确认；依赖被平台停用或客户端版本不够时提示原因且不安装；安全扫描 / 质量报告确认仍然出现（FR-012）（注意：原测试断言会弹确认，需改为断言**不弹**）
- [X] T019 [P] [US2] 扩展 `test/renderer/marketplace-install-error.test.ts`：失败后卡片保留「安装失败，可重试」，详情有原因与「重试」，不进入任务（FR-013）；详情点示例：成功才进入任务，失败不进入

### Implementation for User Story 2

- [X] T020 [US2] 在 `src/renderer/modules/marketplace.js` 的 `_mpInstall` 去掉 `_mpConfirmAgentInstall` 调用（约 `:2317`、`:2368`），保留 `agentInstallPlan` 用于阻断判定（阻断时 `uiAlert` 原因并返回）；保留 `_mpShowSecurityCard` 与质量报告分支
- [X] T021 [US2] 在 `src/renderer/modules/marketplace.js` 为平台卡片与弹窗实现按钮状态机（安装 / 安装中… / 重试 / 使用 / 有更新）；安装成功后 `uiToast` 已安装、刷新首页与「已安装 · N」计数，**不跳转**
- [X] T022 [US2] 在 `src/renderer/modules/catalog.js` 实现未安装详情：主按钮「安装」（2026-10-19 改：与卡片、参考稿一致，原为「安装智能体 / 安装技能」）；点示例 = `_mpInstall` 成功后调用 `useAgent` / `useSkill` 发送示例；安装中示例置为不可点；失败显示原因与「重试」
- [X] T023 [US2] 在 `src/renderer/modules/catalog.js` 与 `marketplace.js` 接入更新：`updateAvailable` 时卡片标「有更新」、详情底部「更新」→ `_mpInstall`；失败提示「已保留旧版」（复用主进程 `beginAgentReplace` 行为）

**Checkpoint**: 安装、失败、更新可独立演示

---

## Phase 5: User Story 3 - 在「已安装」里集中停用和卸载 (Priority: P1)

**Goal**: 「已安装的智能体 / 技能」页

**Independent Test**: 老用户数据下打开已安装页，含原随包内容；停用、启用、卸载后回首页核对（UI-05、UI-06）

### Tests for User Story 3

- [X] T024 [P] [US3] 新建 `test/renderer/catalog-installed-view.test.ts`：列出全部已安装平台内容（含 `seed_source: builtin`、`default_install`），无自建 / 外接 / 主智能体 / 本机已有；一行三张卡片，每张有开关与「⋯」，卸载仅在菜单；页头状态筛选、摘要、需要处理的项排前；为空显示空态（FR-014、FR-015）；平台已下架的已安装项标「已下架」；卸载被智能体依赖的技能时先提示并允许取消
- [X] T025 [P] [US3] 在 `test/main/features/component_enabled.test.ts` 补用例：停用随包内容（`seed_source: builtin`）与停用用户安装内容写入行为一致；另在 `test/main/` 新增 / 扩展运行时测试（对应 `src/main/model/core-agent/runner.ts` 的可用技能清单与 `src/main/features/group_chat/bus.ts` 的 `buildAgentsIndexBlock`、`resolveDispatchTarget`）：被停用的技能 / 智能体**不在**主智能体可用清单中，`dispatch_to` 与 @ 名字解析不到（FR-016、SC-006）

### Implementation for User Story 3

- [X] T026 [US3] 在 `src/renderer/modules/agents.js` 实现「已安装的智能体」子视图：一行三张卡片，开关调 `agents.setEnabled`，「⋯」菜单承载详情 / 更新 / 卸载，页头有返回、状态筛选、搜索与摘要，并覆盖空态与已下架标记
- [X] T027 [US3] 在 `src/renderer/modules/skills.js` 实现「已安装的技能」子视图（同 T026，调 `skills.setEnabled`、`marketplace.uninstallSkill`）；卸载被依赖的技能前提示，安检摘要也移到本页
- [X] T028 [US3] 在 `src/renderer/modules/agents.js`、`skills.js` 让首页工具栏「已安装的… · N」计数、首页卡片「已停用」标记与已安装页的操作实时同步

**Checkpoint**: 已安装页可独立演示

---

## Phase 6: User Story 4 - 在「我的」里管理自己的东西并贡献 (Priority: P2)

**Goal**: 我的智能体、我的技能（含本机已有、总开关、外部包移除）、创建与我的贡献入口

**Independent Test**: 我的智能体只有自建；我的技能来源筛选、总开关、移除外部包；创建落点；我的贡献返回（UI-09、UI-10）

### Tests for User Story 4

- [X] T029 [P] [US4] 新建 `test/main/ipc/skills-global-roots.test.ts`：`skills.getGlobalRootsEnabled` 返回 `{ enabled: boolean }`；`skills.setGlobalRootsEnabled` 对非布尔 `enabled` 报错，合法时写入 `global_skill_roots_enabled` 并使技能缓存失效
- [X] T030 [P] [US4] 扩展 `test/renderer/category-tabs.test.ts`：我的智能体只有 `custom`；我的技能一个网格「自定义在前、本机已有在后」，来源筛选「全部 / 自定义 / 本机已有」；本机已有无「贡献」；总开关关闭后全局文件夹技能隐藏并显示说明；外部包移除先确认并说明带的技能数（FR-017～021）；创建成功后新卡片出现在「我的」，外接的出现在首页「外接智能体」组（FR-022）
- [X] T031 [P] [US4] 扩展 `test/renderer/hub-contributions-flow.test.ts`：从「我的」进入「我的贡献」，返回回到「我的」（FR-019）

### Implementation for User Story 4

- [X] T032 [US4] 在 `src/main/ipc/index.ts` 新增 `skills.getGlobalRootsEnabled` / `skills.setGlobalRootsEnabled`：只校验 `enabled` 为布尔并调用 `src/main/features/config.ts` 的 `getGlobalSkillRootsEnabled` / `setGlobalSkillRootsEnabled`，写后调用 `skill-registry` 的 `invalidateSkills()`；渲染层继续通过 preload 已有的通用 `window.cogseed.invoke` 白名单 API 调用
- [X] T033 [US4] 在 `src/renderer/modules/agents.js` 实现「我的智能体」子视图：只渲染 `custom` 来源 `agent-card`（含现有 `agent-card-contribute`）；工具栏「+ 创建」（复用现有创建流程）与「我的贡献」（复用 `hub-agent-contributions.js` / `hub-contributions.js` 入口）
- [X] T034 [US4] 在 `src/renderer/modules/skills.js` 实现「我的技能」子视图：一个网格合并 `custom` 与 `skills.listOpen`（复用 `_openSkillsSectionHtml` 的卡片与菜单），卡片标「自定义 / 本机已有」，来源筛选；顶部说明条 + 总开关（调 T032 的 IPC）
- [X] T035 [US4] 在 `src/renderer/modules/catalog.js` / `skills.js` 为外部包技能提供「移除」：确认弹窗说明包名与带的技能数，确认后调 `packages.action`（`command: 'remove'`）并刷新
- [X] T036 [US4] 在 `src/renderer/modules/hub-contributions.js` 把「我的贡献」返回目标改为「我的智能体 / 我的技能」（`leaveFromMine`、`backline`）
- [X] T037 [US4] 在 `src/renderer/modules/agents.js` 调整创建成功后的落点：创建的进入「我的智能体」，外接的回首页「外接智能体」组（FR-022）

**Checkpoint**: 我的可独立演示

---

## Phase 7: User Story 5 - 停用技能时知道会影响谁 (Priority: P3)

**Goal**: 停用前提示受影响智能体；停用后智能体显示依赖已停用

**Independent Test**: 停用被引用的技能先弹提示，可取消；确认后智能体卡片 / 详情标出（UI-07）

### Tests for User Story 5

- [X] T038 [P] [US5] 在 `test/main/features/agent_dependency_state.test.ts` 补用例：依赖技能被用户停用时 `status` 为 `deps_blocked`、原因 `user_disabled`；平台停用仍为 `disabled`；都正常时 `ready`
- [X] T039 [P] [US5] 新建 `test/renderer/skill-disable-dependents.test.ts`：停用被引用技能前弹确认列出智能体名，取消不调用 `skills.setEnabled`；未被引用的直接停用；智能体卡片显示依赖已停用，详情「会用到的技能」标「已停用」（FR-027）；受影响智能体的「使用」与示例不可点，点详情「启用 X」后恢复

### Implementation for User Story 5

- [X] T040 [US5] 在 `src/main/features/agent_dependency_state.ts` 读取 `component_enabled.isSkillEnabled`，把用户停用的依赖记为原因 `user_disabled`（`AgentDependencyReason` 增加该值），保持与 `disabled`（平台停用）区分；确认 `agents.list` 返回的 `dependency_state` 带上（`src/main/features/agents.ts:1768`）
- [X] T041 [US5] 在 `src/renderer/modules/skills.js`（以及已安装页、弹窗里所有停用技能的入口）停用前从已加载智能体的 `skill_list` 反查引用者，有则 `uiModal` 确认；确认后再调 `skills.setEnabled`
- [X] T042 [US5] 在 `src/renderer/modules/agents.js` 与 `catalog.js` 显示 `user_disabled`：卡片「依赖已停用」、详情技能 chip 标「已停用」，文案区分平台停用与用户停用；`user_disabled` 与平台停用一样禁用「使用」和示例，详情底部提供「启用「技能名」」直接调 `skills.setEnabled` 恢复

**Checkpoint**: 全部用户故事可用

---

## Phase 8: Polish & Cross-Cutting

- [X] T043 未登录与断网（FR-023、FR-024）：在 `catalog.js` / `agents.js` / `skills.js` 读取 `hub-account.status`；未登录时平台组只显示已安装并提示「登录后查看更多平台内容」，「安装」「贡献」先走现有登录提示；断网时顶部提示 + 重试、平台组只显示已安装；覆盖集中在 `test/renderer/catalog-installed-view.test.ts`
- [X] T044 [P] 首页加载骨架（平台未安装区）、平台暂无更多、搜索无结果（带清除筛选）、「我的」为空等状态（FR-025），补到 `test/renderer/catalog-home-groups.test.ts`
- [X] T045 [P] 按 cogseed-component-change 要求新增 `test/renderer/catalog-page-integration.test.ts`，锁定真实智能体 / 技能页对统一弹窗、已安装卡片、状态筛选、未登录 / 断网提示与本机技能说明条的接入；新模块无裸控件，未抬高 `shared-ui-adoption-guard` 旧基线
- [X] T046 检查四语文案无缺键、无硬编码中文 / 英文（`src/renderer/locales/*.json`、新增渲染代码）
- [ ] T047 跑 `npm run typecheck`、`npm test`，与 T002 基线对比，只允许既有失败；结果写入 `specs/009-agent-skill-pages/implementation-notes.md`
- [ ] T048 按 `specs/009-agent-skill-pages/quickstart.md` 在 macOS 与 Windows 真实客户端各走一遍 UI-01～13 并记录；包括卸载随包技能后重启是否被装回（research R-06 风险），出现则记为已知问题移交迁移任务
- [X] T049 [P] 同步文档：`specs/009-agent-skill-pages/README.md` 状态、`design-spec.md` 第 5 节与实际落点差异、`handoff-meeting2.md` 进展；检查通过 / 人工验收 / 上线分开陈述
- [ ] T050 提交前复核 `git status`：只包含本功能文件，**不含** `run.sh`、`src/main/index.ts`、`test/main/util/runtime-launcher.test.ts`；按仓库流程开 MR（需用户另行授权）

---

## Dependencies & Execution Order

- **Phase 1 → Phase 2**：Setup 完成后才做 Foundational。
- **Phase 2 阻塞所有故事**：T004（数据组合）、T005（弹窗）、T008/T009（骨架）是各故事前提；T006、T007 可与之并行。
- **US1（P1）** 先做，是 MVP；**US2** 依赖 US1 的平台卡片与弹窗；**US3** 依赖 T004，可与 US2 并行；**US4** 依赖 T009 子视图切换，可与 US2/US3 并行；**US5** 依赖 US3（停用入口）与 US4（我的技能入口）。
- **Phase 8** 在所需故事完成后进行；T047、T048、T050 最后。

### 用户故事依赖图

```
Setup → Foundational ─┬─ US1 ─ US2
                      ├─ US3 ─┐
                      └─ US4 ─┴─ US5 → Polish
```

## Parallel Opportunities

- Phase 2：T005、T006、T007 并行（不同文件）。
- 每个故事的测试任务（标 [P]）可在实现前并行写好。
- US3 与 US4 可由两人并行（分别在 `agents.js` / `skills.js` 的不同子视图，注意同文件合并顺序）。

### Parallel Example: User Story 1

```text
T010 test/renderer/catalog-home-groups.test.ts
T011 test/renderer/catalog-popup.test.ts
T012 test/renderer/catalog-use-example.test.ts
```

### Parallel Example: User Story 4

```text
T029 test/main/ipc/skills-global-roots.test.ts
T030 test/renderer/catalog-mine-view.test.ts
T031 test/renderer/hub-contributions-flow.test.ts
```

## Implementation Strategy

### MVP First（User Story 1）

1. Phase 1 + Phase 2
2. US1：首页三组 + 统一弹窗 + 使用 / 示例发送
3. 停下验证：contracts UI-01、UI-13；真实客户端走一遍

### Incremental Delivery

1. US1 → 演示
2. US2（安装、失败、更新）→ 演示
3. US3（已安装页）→ 演示（至此 P1 全部完成，可作为首个 MR）
4. US4（我的）→ 演示
5. US5（停用依赖）→ 演示
6. Polish → 双平台验证 → MR

## Notes

- 每个任务完成要以测试或真实运行结果为依据，不以文件存在为完成。
- 独立任务线（S4-09 示例生成、D-08 统计、D-10 Hub 头像、停止随包预装）不在本清单。
- 任何改变用户流程、权限或验收标准的发现，先回到 spec.md / brief-v0.4.md 更新。
