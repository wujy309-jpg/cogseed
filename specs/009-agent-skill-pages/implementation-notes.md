# Implementation Notes — S4（Phase 1–7 + 部分 Polish）

2026-10-19 · 分支 `feat/s4-agent-skill-pages`（基于 origin/develop 45fc0166）· 未提交、未推送。

## 本地改动隔离（T001）

`run.sh`、`src/main/index.ts`、`test/main/util/runtime-launcher.test.ts`（COGSEED_NO_AUTO_PROXY）是本机调试改动，**永不进入提交**；提交时只逐个 stage 本任务文件。

## 基线（T002）

- `npm run typecheck`：通过（改动前后均通过）。
- 未跑全量 `npm test`：按 AGENTS.md 测试成本规则，只跑与改动相关的定向测试。T047 收尾时再决定是否需要全量。
- 已知既有失败（与本期无关，未改动相关文件）：`test/renderer/skills-cognition-layout.test.ts` › 「keeps use-and-proof inside asset detail backed by the timeline」——断言 `cognition-assets/core.js` 不含 `recall.proofs.list`。

## 遵守的检查项（T003）

- 渲染层 classic script，无新 npm 依赖；IPC 不变（本期 MVP 未新增通道）。
- 弹窗复用 `uiModal` lg + 连接器弹窗 `.connector-popup-*` 版式；按钮全部 `uiButton`，未新增原生 `<button>`；`shared-ui-adoption-guard` 基线未上调。
- 新增页面局部结构登记 `docs/renderer-structural-registry.md` › `S4-PV-001`（Proposed）。
- 新文案 38 个 `catalog.*` 键，四语齐全；zh `agents.base_group` 改为「外接智能体」。

## 与 tasks.md 原文的偏差（记录在此，供评审）

| 任务 | 原文 | 实际 | 原因 |
|---|---|---|---|
| T004 | `marketplace.js` 中 `buildPlatformItems(kind)` | 新建 `catalog.js`（放入 `marketplace` 懒加载包，排在 `marketplace.js` 后）：`catalogSplitPlatform` + `catalogLoad` 分页拉目录 | 智能体页、技能页共用，且纯函数便于测试；`marketplace.js` 新增 `_mpEnsureState()`，不打开市场面板也能调用 `_mpInstall` / `_mpUninstall` |
| T005 | 新文件 `catalog-popup.js` | 弹窗合并进 `catalog.js` 的 `openCatalogPopup` | 与目录逻辑同一懒加载包，避免再多一个脚本 |
| T006 | 合并原型 `.ap-*` 为正式类 | 只加了 MVP 需要的 `.catalog-*` 少量类，其余沿用 `.connector-popup-*`、`agent-card` | 已安装页 / 我的技能本地组在 US3/US4 再加 |
| T008 | 删除「+ 创建」「我的贡献」 | 首页隐藏，移到「我的智能体 / 我的技能」子视图；「更多」隐藏 | 入口不丢；`#panel-marketplace` 保留（oss.js 仍用） |
| T013 | 平台组用 `marketplace-card` | 未安装平台项用 `agent-card` 版式 + 「安装」按钮 | 与同组已安装卡片视觉一致 |
| T009 | 首页 / 我的 / 已安装 | MVP 只做 首页 / 我的；「已安装」在 US3（T026） | 范围 |

## 已知缺口（留给后续阶段）

- 安装仍走 `_mpConfirmAgentInstall`「将同时安装」确认 → US2 / T020 移除。
- 已安装页、有更新、安装失败可重试、停用依赖提示、未登录、全局文件夹总开关 IPC → US2–US5。
- 首页 DOM 顺序 / 无来源字样 / IME 合成：单测只覆盖纯判定，DOM 由真实客户端验证（T010 中 DOM 断言部分）。

## 测试

```
npm run typecheck
npm run test:js -- test/renderer/catalog-home-groups.test.ts test/renderer/catalog-popup.test.ts test/renderer/catalog-use-example.test.ts
npm run test:js -- test/renderer/lazy-features.test.ts test/renderer/shared-ui-adoption-guard.test.ts test/renderer/marketplace-*.test.ts test/renderer/agent-*.test.ts test/renderer/skill-shared-ui.test.ts test/renderer/i18n-switch.test.ts
```

- 新增 24 个用例全过；`lazy-features.test.ts` 因 marketplace 包多了 `catalog.js` 更新一处期望。
- 其余相关用例通过，仅上面的既有失败。


---

## 第二轮：US2–US5 + 未登录 / 断网（2026-10-19）

### 做了什么

| 故事 | 落点 |
|---|---|
| US2 安装 | `marketplace.js`：`_mpConfirmAgentInstall` 改为 `_mpCheckAgentInstallable`（只在依赖被平台停用 / 内置能力不支持时说明并停止，不再弹「将同时安装」）；`_mpInstall(kind,id,item,{quiet})` 返回是否装好，失败记入 `_mpState.installFailed`（quiet 时用 toast 而不是弹窗）；`_mpUninstall` 返回是否卸载；`_mpEnsureState` 首次建状态时拉一次本机安装版本。`catalog.js`：`catalogInstall` 返回布尔、`catalogInstallFailure`、`catalogUpdateRow`；弹窗支持「重试」「更新」。卡片：安装失败标「安装失败，可重试」+「重试」，已安装平台项有新版本标「有更新」。 |
| US3 已安装页 | 首页工具栏「已安装的智能体 / 技能 · N」→ 子视图：行列表（开关 + 卸载），页头「已启用 N / 共 M」，Hub 停用 / 有更新 / 依赖已停用标记；空态。卸载被引用的技能先确认。 |
| US4 我的 | 我的技能一个网格（自定义在前，外部包 + 全局文件夹在后），来源筛选「全部 / 自定义 / 本机已有」，顶部说明条 + 全局技能文件夹总开关（新 IPC `skills.getGlobalRootsEnabled` / `setGlobalRootsEnabled`）；移除外部包确认写明技能数；「我的贡献」在技能页也只在我的里出现。返回「我的贡献」后仍回到「我的」（子视图状态保留）。 |
| US5 停用依赖 | 主进程 `agent_dependency_state.ts` 新增 `withUserDisabledDependencies`，原因 `user_disabled`（与 Hub 停用 `disabled` 区分，`reasons` 字段只在有用户停用时出现，原有输出不变）；`agents.ts` 列表对平台与自建智能体都叠加。渲染层：`_flipSkillEnabled` 停用前统一反查在用的智能体并确认（覆盖菜单、弹窗、已安装页、详情所有入口），停用 / 启用后刷新智能体；弹窗技能 chip 标「已停用」、底部「启用「技能名」」。 |
| 未登录 / 断网 | `catalog.js` 读 `hub-account.status`（Gate 关闭视为无需登录）；未登录时平台组只显示已安装 + 顶部登录提示，安装先请登录；目录拉取失败时顶部提示 + 重试；登录成功后自动重拉目录。 |

### 测试（定向）

- 新增：`catalog-installed-view.test.ts`（9）、`skill-disable-dependents.test.ts`（5）、`agent_dependency_state.test.ts` +5、`agents.test.ts` +1（列表带 `user_disabled`）、`marketplace-install-error.test.ts` +5、`catalog-popup.test.ts` +3。
- 修改：`marketplace-agent-install-plan.test.ts` 原「会弹确认」断言改为「不弹确认」；`ontology-step2-guard.test.ts` 登记 2 个新 IPC 通道；`catalog-use-example.test.ts` 桩返回值。
- 删除不再使用的文案键：`marketplace.agent_plan_{title,intro,hub,bundled,reuse_intro,reuse,safety,confirm}`、`catalog.catalog_failed`（四语）。
- 既有失败（与本期无关）：`skills-cognition-layout`（同上）；`ontology-step2-guard` 因上游新增未登记的 `p3394.requeueIsolatedOutbox` 失败（本期两个通道已登记）。

### 视觉检查

用仓库真实的 css / ui-* / catalog.js 在本地预览页渲染：已安装列表、未登录 / 断网横幅、我的技能说明条、依赖停用弹窗（「启用「技能名」」）。真实客户端未逐页点验（T048）。

### 未完成 / 待拍板

- 未完成任务：T029（IPC 单测）、T030（我的视图测试）、T031（我的贡献返回测试）、T044（加载骨架 / 暂无更多）、T045（页面集成覆盖）、T047（全量 npm test）、T048（双平台真实客户端验收）、T049（文档同步）、T050（提交前复核）。
- 待拍板：
  1. ~~主智能体自动派发时对 `deps_blocked` 智能体的处理~~（2026-10-20 定：照常派、不带该技能，即现状）。
  2. ~~`skill_list` 里若写的是技能名而不是 id，反查与 `user_disabled` 判定会漏~~（2026-10-20 已修）。
  3. ~~技能页「我的贡献」按钮首页可能短暂可见~~（2026-10-20 已修）。
  4. `marketplace-card-states.test.ts` 未改：它测的是市场面板卡片（开源项目区仍在用），本期卡片状态由 catalog 测试覆盖。

### 补充（同日，第三轮）

- 补测试：`catalog-installed-view.test.ts`（已安装页 / 依赖确认 / 未登录 / 断网）、`skill-disable-dependents.test.ts`、`agents.test.ts` 列表带 `user_disabled`。T025 运行时排除由既有 `local-tools` / `file-tools` / `bus-integration` 用例覆盖（停用名单按 id，与内容来源无关，随包内容与用户安装一致）。
- `category-tabs.test.ts` 按 S4 结构更新：自建内容在「我的」子视图，本机已有技能卡片标「外部包 / 本机已有」，技能首页分类筛选作用于平台组。
- 删除死代码：`_openSkillsSectionHtml` 的分区输出（只剩「我的技能」单网格一种调用）。`skills.external_group*`、`skills.global_group_hint` 文案与 `.skills-source-section-hint` 样式目前无代码使用，留待收尾时一并清理。
- 定向测试 27 个文件、460 个用例全过。`test/renderer` 全目录：33 个失败，全部在本期未改动的文件里（cognition-*、recall-*、kb-i18n-keys、conversation-placeholder-consume、skills-frontmatter、anchored-source-panels-electron、skills-cognition-layout），zh.json 的差异只含本期键。

### 补充（第四轮：T029、T030、T031、T044、T049）

- T029：`test/main/ipc/skills-global-roots.test.ts`（默认开、关 / 开往返写偏好并使技能缓存失效、非布尔报错且不写）。
- T030：`category-tabs.test.ts` 新增「我的」用例（我的智能体只放自建、首页不放；我的技能单网格顺序、来源筛选、只有自建可贡献、总开关与关闭说明；空态与搜索无结果）。外部包移除确认里的技能数未单测（依赖菜单 DOM），代码见 `_openExternalPackageMenu`。
- T031：`hub-contributions-flow.test.ts` 新增「从我的贡献返回网格」；`category-tabs.test.ts` 验证回到网格后仍在「我的智能体」。
- T044：平台组首次加载显示两张骨架卡（不先闪空态），加载完且没有可装的显示「平台暂时没有更多」（搜索 / 筛选、未登录、断网时不显示）；我的为空有说明；搜索无结果可清除筛选（技能页同时清除来源筛选）。`catalog-installed-view.test.ts` 补 3 条。
- 一致性修正：新增代码里的 `uiSwitch` / `uiEmptyState` 改走 `window.*`，与两个文件原有写法一致。
- T049：README 状态（检查通过 / 人工验收 / 上线分开写）、design-spec §5.1 实现差异、handoff §7 进展已更新。
- 剩余：T045、T047、T048、T050。

### 已安装页改版（2026-10-20，用户确认样稿后）

- 一行头部：返回（放进工具栏左侧）· 状态筛选「全部 / 有更新 / 已停用」· 搜索；原来右上角的「已启用 N / 共 M」和单独的说明段改为表格上方一行摘要。
- 整宽表格：头像 · 名称（标记）与说明 · 分类 · 版本 · 开关 · 「⋯」；「⋯」里是查看详情、更新到 vX（有更新时）、卸载（红色）。
- 排序：有更新 / 被阻断（Hub 停用、依赖停用、未通过安检）/ 已停用的排前面，各组按名字。
- spec FR-014、契约 UI-06、registry S4-PV-001 同步改写。`catalog-installed-view.test.ts` 按新结构重写。
- 同日追加（用户确认）：已安装页由整宽表格改为一行三个的卡片（参考 WorkBuddy / 豆包「管理」页；分类、版本不再单列，点开详情可见）；「卸载」只在已安装页的「⋯」里，详情弹窗不再提供（spec FR-007、FR-014 同步）。「批量管理」暂不做。
- 同日追加：技能卡片说明补两行高度上限（原有缺陷：同行卡片被撑高时露出半行第三行）；安检汇总条从技能首页移到「已安装的技能」页（重新检查照旧可用）。
- 同日追加（用户确认样稿）：新建智能体弹窗——「创建」去掉从未生效的「输出格式」空栏（develop 上同样从未挂载；创建默认「自动」，详情里可改），加一句「创建后在详情里设置」；「外接」改为本机智能体卡片选择（两列，未检测到的置灰、点击说明原因；「重新扫描」）、选中后出现自动填好的名称 / 简介和「模型供应商」（Claude Code / Codex，写入 runtime.cli_provider_id，由 p3394-wake-dispatcher 使用；此行此前被移除，测试已按新决定改写）；底部改为一行「已接入的外接智能体在智能体总览里管理」；确认按钮叫「接入」。
- 同日追加：外接卡片图标改为统一字母图标（品牌绿底，未检测到的灰底，不再按名字随机配色）；名称 / 简介 / 模型供应商一直显示，选卡片之前置灰，模型供应商对不支持的智能体置灰并说明「该智能体使用自己的配置」；未检测到的原因显示在标题行提示里。三项保证弹窗高度在任何选择下都不变（预览实测 765px 不变）。
- 同日追加（用户拍板）：①依赖被停用的智能体，自动派活照常、不带该技能——运行时本来如此（runner 渲染技能清单时排除用户停用的技能；派活不看 `dependency_state`），写入 spec FR-027；②技能清单写技能名的旧智能体：主进程依赖判定与界面「谁在用」都按 id 和技能名识别（主进程用 `resolveSkillAllowlistRefs`，与运行时同一规则；`reasons` 始终记真实 id），补测试；③技能页「我的贡献」改为按子视图用样式隐藏，挂载早晚都不闪。

---

## 收尾与交付证据（2026-10-20）

### 基线同步与范围隔离

- 暂存本任务已跟踪改动后，将分支 rebase 到 `origin/develop`；当前基线为 `071eefe42f5b`，`HEAD...origin/develop` 为 `0 0`。
- `run.sh`、`src/main/index.ts`、`test/main/util/runtime-launcher.test.ts` 继续作为本机专用改动保留，提交范围明确排除；其他无关未跟踪资料也不进入本次提交。
- `.specify/extensions.yml` 的 `hooks` 为空，本功能没有额外扩展钩子要执行。

### 组件与可访问性收口

- T045 已完成：新增 `test/renderer/catalog-page-integration.test.ts`，锁定真实 Agent / Skill 页面对统一目录弹窗、已安装卡片、筛选、未登录 / 断网反馈和本机技能说明条的接入。
- 外接智能体卡片选择器采用 ARIA radio group + roving tabindex，支持方向键、Home / End、Enter / Space，并给不可用项暴露真实原因；`S4-PV-001` 登记同步扩展到该组合。
- macOS 实机发现创建弹窗关闭后主页面曾从可访问性树消失。根因为旧弹窗只切换 CSS class、未接入共享生命周期；现已用 `uiModalController` 统一焦点进入 / 陷阱 / 回归与滚动锁定。关闭后焦点回到「+ 创建」，主页面重新出现在可访问性树中。

### 自动检查结果

- `npm run typecheck`：通过。
- S4 定向范围（25 个测试文件）：24 个文件通过；798 个用例通过、3 个跳过、1 个失败。唯一失败是 `test/main/features/recall/ontology-step2-guard.test.ts` 未登记上游已有的 `kb.download` 与 `p3394.requeueIsolatedOutbox`；本功能新增的 `skills.getGlobalRootsEnabled` / `skills.setGlobalRootsEnabled` 已登记并通过检查。
- 共享 UI 守卫的独立运行还报告上游 `kb-workbench.js` 动态控件数 14 高于冻结基线 10；该文件与 `origin/develop` 一致，本期未抬高基线。
- 弹窗生命周期修复后的最小回归：`catalog-page-integration.test.ts` + `local-agents-status.test.ts`，2 个文件、10 个用例全部通过。
- `npm test` 已实际尝试；测试输出包含多个本期外的 cognition / recall / marketplace / auto-task 失败，P3394 HTTP 用例在沙箱内出现 `listen EPERM`，全部文件输出后进程仍未自行退出，最终人工中止（退出码 130）。因此不能宣称全量通过，T047 保持未完成，也不再无诊断重跑。

### 真实客户端验收

- 用 `scripts/restart-cogseed.sh restart` 启动当前工作树；运行日志确认来源为 `/Users/chloe/Desktop/mate-agent-develop`，启动完成。
- macOS 只读烟测通过：智能体首页三组及未登录横幅、我的智能体、创建 / 外接弹窗与本机 CLI 状态、技能首页、我的技能来源筛选与全局目录开关、已安装技能状态筛选 / 开关 / 菜单均正常呈现；弹窗关闭后的焦点和可访问性树恢复正常。
- 为避免污染真实用户数据，本轮未执行安装、卸载、启停和贡献提交；Windows 未验收。因此不能勾选覆盖 UI-01～13 双平台与写操作的 T048。

### 评审边界

- 产品合同与实现已对齐；组件库复用、gallery / 静态契约和真实页面接入均有覆盖。
- `docs/renderer-structural-registry.md` 的 `S4-PV-001` 仍为 `Proposed`，需 `@bonc-ai/reviewers` 明确批准后才能视为结构边界完成。
