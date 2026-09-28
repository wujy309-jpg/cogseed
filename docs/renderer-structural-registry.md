# Renderer Structural Component Registry

This registry is the decision log for page-local Renderer structure governed by the
Shared / Provisional composition / Prohibited policy in [`AGENTS.md`](../AGENTS.md).
It records approved boundaries; it is not a catalog of every business-owned DOM class.

## Authority and workflow

- `@bonc-ai/reviewers` owns this registry. A PR author may propose a record, but a code-owner
  approval is required before the record becomes an approved exception or migration decision.
- A new or changed page-local structural composition must reference an existing registry ID or
  add a proposed record in the same PR. An unregistered structure is not implicitly Provisional.
- Reference counts and class-name counts are supporting evidence only. Classification follows
  semantic role, behavior and stable contract, not visual similarity or the number of selectors.
- Once two pages need the same stable role or behavior, the entry must move to a shared-component
  proposal. Repeated appearance alone is not sufficient when the business semantics differ.
- Records are never deleted. Completed work moves to `Migrated`; obsolete decisions move to
  `Superseded` so later reviews retain the rationale and PR trail.

## Statuses

| Status | Meaning |
| --- | --- |
| `Proposed` | Awaiting a code-owner decision; it cannot be used as an approved exception. |
| `Approved Provisional` | Page-local composition is allowed inside the recorded boundary. |
| `Migration Required` | A shared seam exists; new work must use it and legacy code should migrate without raising baselines. |
| `Business-owned` | Business content/data/state composition is explicitly outside the structural exception mechanism. Shared leaf controls still apply. |
| `Migrated` | The shared seam is integrated and the legacy baseline has been reduced where applicable. |
| `Rejected` | The proposed page-local structure is prohibited. |
| `Superseded` | A newer record replaces the decision. |

## Required record fields

Every new record must include: ID, scope, status, allowed boundary, required shared seams, rationale,
decision owner, decision date, review trigger and related PR/issue. Use `TBD` rather than inventing
an approval, link or owner.

## Knowledge Base migration decisions

These records classify migration boundaries. They do not authorize unrelated visual redesign or
business-logic changes.

| ID | Scope | Status | Decision and boundary | Review trigger |
| --- | --- | --- | --- | --- |
| `KB-M-001` | `kb-workbench.js` shared-library creation/share dialog | Migrated | Existing dialog DOM is adopted through `_mountKbDialog(...)` and `uiModalController(...)`; library validation, permissions and submit state remain page-owned. | Revisit only if the shared modal contract changes. |
| `KB-M-002` | `kb-workbench.js` file-viewer outer shell | Migrated | The overlay/dialog uses `uiModalController(...)`, and all viewer layer declarations use `--z-*`. Reader resize, zoom, pagination and block marking remain under `KB-PV-003`; there is no shared drag/resize seam today. | Revisit internal interaction only when another page needs the same stable reader contract. |
| `KB-M-003` | `kb-workbench.js` media-manager outer shell | Migrated | The centered media/mind-map overlay uses `uiModalController(...)`; focus, Escape, scroll lock and focus return are shared while internal canvas behavior remains under `KB-PV-004`. | A second page needs the same media-management contract. |
| `KB-M-004` | `kb-workbench.js` import dialog | Migrated | The dialog uses `uiModalController(...)`; file selection now uses `uiCheckbox(...)`, reducing the raw-checkbox baseline instead of re-baselining it. | Revisit when navigation or selection semantics need a new shared structure. |
| `KB-M-005` | `kb-workbench.js` hierarchical library tree | Migrated | Production DOM uses `uiTree(...)` plus `hydrateUiTrees(...)`; rename and context-menu callbacks remain page-owned. The non-DOM parser fallback exists only for isolated renderer test doubles. | Revisit if drag/drop is added or the shared tree contract changes. |
| `KB-M-006` | Knowledge Base same-object view tabs | Migrated | Same-object discovery views use `uiTabs(...)` plus `hydrateUiTabs(...)`. `kb-eco` switches product modules, so it is navigation rather than a same-object tab set and is outside this record. | A new same-object view selector is introduced. |
| `KB-M-007` | `kb-quiz.js` quiz dialog shell | Migrated | The quiz shell uses `uiModalController(...)`; controlled Escape requests preserve the unfinished-quiz confirmation flow, while A-D/Enter/arrows/F/S remain IME-safe business shortcuts. | Quiz closure or shortcut semantics change. |
| `KB-M-008` | `kb-picker.js` location picker dialog | Migrated | The existing picker DOM uses `uiModalController(...)`; cancellation, confirmation, focus entry and focus return settle through one lifecycle. | Picker becomes a reusable data-selection contract. |
| `KB-M-009` | KB card/tag/badge/status/progress/skeleton candidates | Migrated | Semantic audit completed: measurable quiz progress uses `uiProgressBar(...)`; catalog shells use `uiCard(...)`; coming-soon labels use `uiBadge(...)`; the quiz source disclosure uses `uiButton(...)`; attachment items remain business-owned under `KB-B-002`. Rich answer/topic/detail content is not reclassified from class-name counts alone. | Reopen only for a named class and target shared API with matching semantics. |
| `KB-M-010` | Literal KB `z-index` values | Migrated | Literal KB layer values are zero; the guard baseline was lowered rather than raised. | Any KB module introduces a literal layer declaration. |
| `KB-M-011` | Duplicate KB keyboard/focus behavior | Migrated | Modal focus/Escape, tree roving focus and button activation use shared runtimes. Business shortcuts remain page-owned, include IME guards and do not duplicate shared modal closure. | A new page-local focus trap, Escape listener or roving-navigation implementation appears. |

Migration status above reflects the local implementation dated 2026-09-21. Related PR is `TBD` until
the branch is submitted; code-owner review may supersede any boundary without deleting its history.

## Approved Provisional compositions

| ID | Scope | Status | Allowed boundary | Required shared seams | Decision owner/date | Review trigger |
| --- | --- | --- | --- | --- | --- | --- |
| `KB-PV-001` | `kb-workbench.js` context menus (`kb-ctx-*`) | Approved Provisional | Context-menu positioning, submenu state and KB commands may remain page-local. Do not reuse the account-specific `uiUserMenu*` API as a generic menu. | `uiButton(...)` / `uiIconButton(...)`, icons, tokens and accessible menu keyboard behavior. | `@bonc-ai/reviewers`, 2026-09-21 | Propose `uiMenu(...)` when a second page needs the same stable menu contract. |
| `KB-PV-002` | Workbench layout shell (`kb-wb-*`) | Approved Provisional | KB sidebar, toolbar and split-pane composition may remain page-owned. This does not exempt nested controls or tabs. | Shared actions, forms, tabs, status and tokens. | `@bonc-ai/reviewers`, 2026-09-21 | A second page adopts the same stable workbench layout contract. |
| `KB-PV-003` | File-reader internal interaction | Approved Provisional | Zoom, pagination, resize/drag behavior, document rendering and block marking remain page-owned after the outer modal migrates. | Modal lifecycle, actions, icons, status and layer tokens. | `@bonc-ai/reviewers`, 2026-09-21 | Another page needs the same stable reader interaction contract or a shared drag/resize seam is approved. |
| `KB-PV-004` | Media-manager internal views | Approved Provisional | Thumbnail grid, multi-select and batch-operation composition remain page-owned after the outer overlay migrates. | Modal/drawer lifecycle, actions, selection controls, progress and status. | `@bonc-ai/reviewers`, 2026-09-21 | A second page needs the same stable media-management contract. |

## Explicit business-owned decisions

| ID | Scope | Status | Decision | Review trigger |
| --- | --- | --- | --- | --- |
| `KB-B-001` | Knowledge Base question/answer conversation flow | Business-owned | The conversation flow, answer body and message sequencing are business content/state, not a blanket Provisional structural exception. Shared actions, status, progress and overlays still apply. | Propose a shared conversation/message contract if another page needs the same stable behavior. |
| `KB-B-002` | Question/answer attachment item (`kb-qa-attach-chip`) | Business-owned | Do not replace it with `uiChip(...)`: `uiChip` is an `aria-pressed` filter control, while an attachment item presents file metadata and a remove action. | Propose a shared attachment-item component when another page needs the same stable contract. |

## Pending proposals

| ID | Scope | Status | Allowed boundary | Required shared seams | Decision owner/date | Review trigger |
| --- | --- | --- | --- | --- | --- | --- |
| `COM-PV-001` | `composer-members.js` member picker rows (`composer-member-row`) | Proposed | The multi-select member row list may remain page-local composition: selection state uses `uiCheckbox(...)`, and the space-excluded state renders as an `aria-disabled`, non-selectable row with a `lock` icon and reason text instead of silently disappearing. Row layout, grouping and reason copy stay page-owned. | `uiCheckbox(...)`, `uiIconHtml(...)`, tokens, native `aria-disabled` semantics. | `@bonc-ai/reviewers`, `TBD` | Propose `uiSelectableRow(...)`/`uiListPicker(...)` once a second page needs the same stable multi-select row contract. |
| `COG-PV-001` | `cognition-assets/views.js` 改进候选依据链 + 只读「改进分析」分区（`ca-chain` / `ca-improvement` / `ca-improvement-empty`） | Proposed | 两块可保持页内组合：它们是对候选与结论读模型的业务内容视图（带标签分节、逐字段 `row`/`sub` 行、长值折叠）。**不新增任何叶子控件**——动作一律走 `uiButton(...)`、标签走既有 `chip()`/`uiTag(...)`、空态走本页 `empty()` → `uiEmptyState(...)`；无裸 `<button>`/`<input>`/内联 SVG/字面 z-index（`shared-ui-adoption-guard` 实测：`views.js` 裸控件 0、内联 SVG 1 与基线相等，均未上调）。 | `uiButton(...)`、`uiTag(...)`（测试夹具加载 `ui-status.js` 时）、`uiEmptyState(...)`（经本页 `empty()`）、既有 `chip()`/`foldValue()`、设计 token。 | `@bonc-ai/reviewers`, TBD | 第二个界面（如经验目录或会议引用层）需要同一套稳定「主张 → 依据 → 结果」呈现时，提案共享 `uiEvidenceChain(...)`/`uiOutcomeList(...)`。 |
| `COG-PV-002` | `cognition-assets/views.js` 候选详情的版本冲突块（`ca-version-conflict` / `data-version-conflict`，specs/015 T022） | Proposed | 该块可保持页内组合：它是"这次确认没生效"的**业务事实视图**——警示行 + 逐字段「当前 → 拟生效」`meta-item` 行 + 两段正文折叠 + 一个重锚按钮。**不新增任何叶子控件**：重锚/稍后/拒绝走本页既有 `btn()` → `uiButton(...)`（act 复用已登记的 `cand-decide`，action=rebase），长值折叠复用既有 `foldValue()`（`ca-tl-body`/`ca-tl-text`），中性标签复用既有 `chip()`；无裸 `<button>`/`<input>`/内联 SVG/字面 z-index/`document.*` 访问。 | `uiButton(...)`（经本页 `btn()`）、既有 `foldValue()`、设计 token；数据来自只读通道 `recall.assets.versions.list`。 | `@bonc-ai/reviewers`, TBD | 第二个界面（如 008 审批卡或对话内卡片）需要同一套"冲突 → 按当前版重摆 → 显式重锚"呈现时，提案共享 `uiVersionConflictBlock(...)`/`uiFieldDelta(...)`。 |
| `COG-PV-014` | `conversation.js` 对话保存回执（`chat-cognition-save-receipts` / `chat-cognition-save-receipt`） | Proposed | 对话中的跨会话保存结果作为「证据」结果块内的小型事实行：精确保存文字、由主进程确认的保存/待审核状态、一个打开正式资产或候选的动作。状态不依赖模型复述；动作复用 `uiButton(...)` 与已有资产/候选路由。 | `uiButton(...)`、既有 Evidence 结果块、`data-asset-citation` / `data-candidate-citation` 跳转、设计 token；数据由 host-owned `cognition_save_receipts` 持久化。 | `@bonc-ai/reviewers`, TBD | 若经验或其他知识对象需要同样的确定性写入回执，再抽取共享回执原语；当前只覆盖认知资产保存。 |
| `COG-PV-015` | `cognition-assets/views.js` 候选详情的已处理状态说明与后续落点（`ca-candidate-state-note`） | Proposed | 从历史对话打开已处理建议时，按真实生命周期显示只读状态说明，并把已保存记录链接到正式资产、把被忽略的重复项链接到存活建议。业务说明和路由按钮可以保持页内组合；不新增叶子控件，按钮复用 `btn(...)` → `uiButton(...)` 及既有 `go-inbox-asset` / `open-candidate` 委托。 | `uiButton(...)`、既有状态 `chip()`、已登记资产/候选路由、设计 token、状态文案 i18n。 | `@bonc-ai/reviewers`, TBD | 代码负责人确认状态说明区与后续落点边界；若其他对象需要相同历史处理模式，再评估共享详情状态区。 |
| `KB-PV-005` | `kb-meeting-refs.js` 会议引用伴生面板（`kb-mrf-host` / `kb-mrf` / `kb-mrf__head/__title/__meta/__hint/__status/__sections`，specs/013 会议引用层） | Proposed | 一场会议的「资产引用 / 纪要条目 / 待办草稿 / 跨会议关联 / 回执」五分区汇总面板可保持页内组合：挂载在纠错面板同容器（`anchored-source-view.js` 伴生挂载，同生命周期 destroy），分区顺序与折叠状态是会议读模型的业务内容视图。**不新增任何叶子控件**——对比/确认/丢弃/引用到本会议等动作一律 `uiButton(...)`，状态章与命中方式章 `uiTag(...)`（原语缺失退化为纯文本 `span`，非交互控件），空态 `uiEmptyState(...)`（每分区恰一处）；无裸 `<button>`/`<input>`/内联 SVG/字面 z-index（`shared-ui-adoption-guard`：本模块不在基线表内 = 允许 0 裸控件，实测 0）。 | `uiButton(...)`、`uiTag(...)`、`uiEmptyState(...)`、设计 token；模块缺失（旧构建）时伴生挂载静默跳过，不阻塞纠错主功能。 | `@bonc-ai/reviewers`, TBD | 第二个界面需要同一套稳定「多分区引用汇总 + 冻结版对比」呈现时，提案共享 `uiRefSummaryPanel(...)`/`uiVersionCompareRow(...)`。 |
| `PO-PV-001` | `personal-ontology.js` 三盒导航行竖排副标题（`personal-onto-nav-row-text is-stacked` / `personal-onto-nav-row-sub`，specs/009 Phase 5 T029/T032） | Proposed | 三盒 nav 行的文字位可保持页内「主标题 + 副标题」两行竖排组合（Phase 5 改变了 nav 行的结构组成，此前无 registry 条目可引用，故补登记）。nav 行本身是已冻结裸控件基线内的原生导航行（design-system 测试基线 5，`personal-onto-nav-row${active` 断言锁定）；竖排仅为排版修饰，**不新增任何叶子控件、不引入新交互**——动作走 `uiButton(...)`/`uiIconButton(...)`、图标走 `uiIconHtml(...)`、元数据与状态标记走 `uiTag(...)`/`uiStatusPill(...)`/`uiStatusDot(...)`（T040/T041 收敛后）；无 emoji/内联 SVG/字面 z-index（`shared-ui-adoption-guard` 实测均未上调）。 | `uiButton(...)` / `uiIconButton(...)`、`uiIconHtml(...)`（icons.js）、`uiTag(...)` / `uiStatusPill(...)` / `uiStatusDot(...)`（ui-status.js）、设计 token。 | `@bonc-ai/reviewers`, TBD | 第二个界面需要同一套「导航行主标题 + 副标题」稳定契约时，提案共享 `uiNavRow(...)`/`uiNavItem(...)`。 |
| `PO-PV-002` | `personal-ontology.js` 会话沉淀资产行与角色模板资产投影只读行（`personal-onto-value-line` / `memory-group-field-value`） | Proposed | A 盒画像资产和模板字段投影都明确显示来源并提供「查看来源资产」入口；投影值在本体页不可编辑或删除，用户从正式资产详情纠错或停用。手填字段值仍使用现有编辑/删除操作；原文编辑保留其他手填内容，但必须保留投影标记与模板元信息。**不新增叶子控件**：来源跳转用既有 `uiButton(...)`，行和说明保持本页组合。 | `uiButton(...)`、既有 `window.openCognitionAssetById(...)` 路由、i18n、设计 token。 | `@bonc-ai/reviewers`, TBD | 第二个投影面需要相同的「明确来源 + 回到唯一事实源」只读契约时，再提议共享来源投影行。 |
| `PO-PV-003` | `personal-ontology.js` 本体总览、多领域实体/分类管理、来源引用与关系边（`personal-onto-overview` / `personal-onto-domain-grid` / `personal-onto-graph-entity-card` / `personal-onto-relation-row`） | Proposed | 页面按业务语义组合个人事实投影、事项/资源/概念实体、可编辑分类字段与跨领域关系。图谱是独立持久化数据；个人资料、候选和正式资产仅作为 `{kind,id}` 来源引用，不复制正文。删除分类/实体及移除字段按后端引用约束执行，关系端点只连接“我”或本体实体。卡片、表单、弹层、动作、标签与状态均复用共享 `uiResourceGrid(...)` / `uiResourceCard(...)` / `uiCard(...)` / `uiForm(...)` / `uiField(...)` / `uiModal(...)` / `uiButton(...)` / `uiCheckbox(...)` / `uiSelect(...)` / `uiTag(...)` / `uiEmptyState(...)`；本体业务页只负责类别/实体/关系的领域排布。 | Shared Renderer APIs listed at left, i18n, design tokens; graph data via `ontology.graph.*` IPC. | `@bonc-ai/reviewers`, TBD | 第二个页面需要同一套本体图谱管理契约时，定义共享领域组件边界；代码负责人审核后将 Proposed 更新为 Approved Provisional 或 Superseded。 |
| `COG-PV-003` | `cognition-assets/views.js` 标签筛选行（`ca-tag-filter` / `ca-tag-candidates`，specs/012 T012） | Proposed | 资产列表里与类型 chips 并列的**另一根筛选轴**可保持页内组合：标签 chip 行（含「未分类」chip 与「更多」入口）+ 交/并集切换。**不新增任何叶子控件**——chip 走本页既有 `btn(...)` → `uiButton(...)` 的 chip 皮肤，交/并集走 `uiSegmentedControl(...)`，候选下拉走原生 `<details class="details">`（既有折叠样式）；计数与筛选是业务状态（内存过滤，渲染层不重排主进程给的顺序）。无裸 `<button>`/`<input>`/内联 SVG/字面 z-index。 | `uiButton(...)`（经本页 `btn()`）、`uiSegmentedControl(...)`、原生 `<details>` 既有折叠样式、设计 token。 | `@bonc-ai/reviewers`, TBD | 第二个界面需要同一套「多选 chip 筛选 + 交/并集切换」稳定契约时，提案共享 `uiChipFilterBar(...)`。 |
| `COG-PV-004` | `cognition-assets/views.js` 资产详情「标签」节（`data-asset-tags` / `ca-tags-row` / `ca-tag-item`，specs/012 T010） | Proposed | 详情页的标签节可保持页内组合：已有标签 `uiTag(...)` + 移除动作、空态「未分类」引导、输入 + 候选下拉（`<details>` + chips）+「添加」。**不新增任何叶子控件**——输入走 `uiInput(...)`、按钮走 `btn(...)`、标签走 `uiTag(...)`；回车提交的 IME 守卫在 app.js 委托层（既有纪律）。 | `uiInput(...)`、`uiTag(...)`、`uiButton(...)`（经本页 `btn()`）、原生 `<details>` 折叠样式、设计 token。 | `@bonc-ai/reviewers`, TBD | 第二个界面需要同一套「条目标签节（增删 + 候选 + IME 回车）」稳定契约时，提案共享 `uiTagEditor(...)`。 |
| `COG-PV-005` | `cognition-assets/views.js` 标签管理弹层与「更多」弹层（`ca-tag-overlay-slot` / `ui-modal-overlay[data-tag-overlay]`，specs/012 T012/T013） | Proposed | 两枚弹层可保持页内组合：外壳与焦点/Escape 生命周期走 `uiModalController(...)`（持久壳槽位 `#ca-tag-overlay-slot` 由 render 维护，弹层打开中不整块重写）；内部是标签库读模型的业务内容行（重命名内联编辑、合并目标选择 + 影响面确认、停用确认、同义建议只读区、已停用/已合并折叠区、批量进度与失败清单）。**不新增任何叶子控件**——动作一律 `btn(...)`、输入 `uiInput(...)`、进度 `uiProgressBar(...)`、折叠区 `<details class="details">`。 | `uiModalController(...)`、`uiInput(...)`、`uiButton(...)`、`uiProgressBar(...)`、`<details>` 折叠样式、设计 token。 | `@bonc-ai/reviewers`, TBD | 第二个界面需要同一套「轻量管理弹层（三动作 + 建议 + 折叠区 + 进度）」稳定契约时，提案共享 `uiManageListModal(...)`。 |
| `COG-PV-006` | `cognition-assets/views.js` 多选批量条（`ca-batch-bar` / `ca-tag-progress` / `ca-tag-failures`，specs/012 T011） | Proposed | 列表多选态的批量操作条可保持页内组合：已选计数 + 全选本页/清空/退出、三选一语义（打标/去标/替换为，互斥）、标签输入、执行、可见进度与逐项失败清单（不截断、可重跑幂等）。**不新增任何叶子控件**——多选行 `uiCheckbox(...)`（仅多选态渲染）、语义切换 `uiSegmentedControl(...)`、输入 `uiInput(...)`、按钮 `btn(...)`、进度 `uiProgressBar(...)`。 | `uiCheckbox(...)`、`uiSegmentedControl(...)`、`uiInput(...)`、`uiButton(...)`、`uiProgressBar(...)`、设计 token。 | `@bonc-ai/reviewers`, TBD | 第二个界面需要同一套「多选批量操作条（三选一语义 + 进度 + 失败清单）」稳定契约时，提案共享 `uiBatchActionBar(...)`。 |
| `COG-PV-007` | `cognition-assets/views.js` 资产详情「为什么这一轮排在前面」小节（`ca-rank-why` / `ca-rank-rows` / `ca-rank-row`，specs/012 T020）与沉淀设置页权重卡（`ca-rank-w-form` / `ca-w-error`） | Proposed | 排序依据折叠小节与权重配置卡可保持页内组合：小节用原生 `<details class="details">`（既有折叠样式），因子行只是「名 + 数值」的业务数据行；权重卡是 4 个数值 `uiInput(...)`（0~10、步进 0.1）+ 恢复默认 + 保存，**就地报错**（只写错误行，不整卡重画）。**不新增任何叶子控件**；数据来自只读通道 `recall.catalog.ranking` 与权重读写通道，视图不重算排序。 | `uiInput(...)`、`uiButton(...)`（经本页 `btn()`）、原生 `<details>` 折叠样式、设计 token。 | `@bonc-ai/reviewers`, TBD | 第二个界面需要同一套「可解释因子拆解小节」或「数值权重表单」稳定契约时，提案共享 `uiFactorBreakdown(...)`/`uiNumberWeightForm(...)`。 |
| `COG-PV-008` | `cognition-assets/views.js` 「待我处理」页治理待办分组区（`sect-block` 治理分区 + `notice-row inbox-governance-form` 就地表单 + `details.inbox-batch-names` 聚合名单，specs/010 T014~T016/T025/T029） | Proposed | 治理分组区可保持页内组合：分区复用既有 `.sect-block`/`.tt`/`.note` 结构（标题 + 计数 + 副标题一句），条目行复用既有 `.notice-row`；三处行内处置可保持业务组合——扩权两钮、缺边界就地表单（两个 `uiInput(...)` 预填当前条件 + 保存）、未分级分级控件与聚合名单（`uiSegmentedControl(...)` + `<details class="details">` 折叠样式）。**不新增任何叶子控件**；分组顺序与动作全部由主进程读模型给出，渲染层零映射表（governance-inbox-guard ①钉住）。 | `uiSegmentedControl(...)`、`uiInput(...)`、`uiButton(...)`（经本页 `btn()`）、`uiTag(...)`（详情档位章）、原生 `<details>` 折叠样式、设计 token。 | `@bonc-ai/reviewers`, TBD | 第二个界面需要同一套「分组待办行 + 行内三档定级/补条件表单」稳定契约时，提案共享 `uiGovernanceInboxGroup(...)`。 |
| `COG-PV-009` | `cognition-assets/views.js` 「其他处理」次级动作折叠（`otherActions()` → `details.ca-other-actions` + `.actions` 容器 + `.ca-card-actions` 行，specs/018 T002/T011） | Proposed | 三件套卡的动作行可保持页内组合：主按钮（推荐动作，primary）平铺 + 次级动作收进原生 `<details class="details">` 轻量折叠（无卡壳覆写、页内多条复用同一 helper）。**不新增任何叶子控件**——折叠内按钮一律 `btn(...)` → `uiButton(...)`，折叠头是原生 `<summary>`（既有折叠样式 + summary:focus-visible 共享焦点环）；无裸 `<button>`/`<input>`/内联 SVG/字面 z-index。 | `uiButton(...)`（经本页 `btn()`）、原生 `<details>`/`<summary>` 折叠样式、设计 token。 | `@bonc-ai/reviewers`, TBD | 第二个界面需要同一套「主按钮 + 次级动作折叠」稳定契约时，提案共享 `uiActionRow(...)`/`uiSecondaryActions(...)`。 |
| `COG-PV-010` | `cognition-assets/views.js` 资产详情三段式（`.ca-detail-facts` 状态章行 / 来历段 / `.ca-used-line` 用过吗段 / `foldBlock()` 「详情与历史」折叠 `ca-detail-history`，specs/018 T040~T042） | Proposed | 详情首屏三段可保持页内组合：状态章行＝既有 `chip()`/`uiTag(...)` 横排；来历段＝既有 `evidenceGroupsHtml()` 业务分组；用过吗段＝note + 可点 `evidenceChip()`；技术细节收 `foldBlock()`（原生 `<details class="details">` 折叠，台账沿用既有独立折叠行）。**不新增任何叶子控件**——开关 `uiSwitch(...)`、按钮 `btn(...)`、档位 `uiTag(...)`、长值折叠复用 `foldValue()`；无裸控件/内联 SVG/字面 z-index（`shared-ui-adoption-guard`：views.js 裸控件 0、SVG 1=树图基线）。 | `uiSwitch(...)`、`uiButton(...)`（经本页 `btn()`）、`uiTag(...)`、既有 `chip()`/`evidenceChip()`/`foldValue()`、原生 `<details>` 折叠样式、设计 token。 | `@bonc-ai/reviewers`, TBD | 第二个界面（如经验详情）需要同一套「是什么/来历/用过吗 + 历史折叠」稳定契约时，提案共享 `uiDetailThreeSection(...)`/`uiOriginUsageSection(...)`。 |
| `COG-PV-011` | `conversation-info.js` + `index.html` 会话头部认知衔接行（`#chat-cognition-strip` 常驻槽 + `.chat-cognition-strip-inner`（图标 + label + ghost 按钮），specs/019） | Proposed | 会话头部与消息区之间的一条状态行可保持页内组合：挂载在自有常驻槽（仿 `#chat-plan-strip` 先例，`hidden` 起步、N=M=0 不出现），内容＝图标 + 一句计数 + 「去看」ghost 按钮（打开运行上下文抽屉的 assets tab）。**不新增任何叶子控件**——按钮走 `_button(...)` → `uiButton(...)`，图标走 `uiIconHtml(...)`（icons.js），计数与措辞由 `_sessionCognitionCounts()` 与抽屉「四类资产」tab 共用同一函数；无裸控件/内联 SVG/字面 z-index（样式全 tokens）。 | `uiButton(...)`（ghost）、`uiIconHtml(...)`、设计 token（含 640px 断点换行）。 | `@bonc-ai/reviewers`, TBD | 第二个界面需要同一套「头部细条状态行（图标 + 计数 + 跳转）」稳定契约时，提案共享 `uiHeaderStatusStrip(...)`；届时与 `#chat-plan-strip` 一并评估共享化。 |
| `COG-PV-012` | `cognition-assets/views.js` 资产编辑页可见范围选择器（`ca-asset-scope-editor` / Agent 与工作空间多选组） | Proposed | 资产编辑专用范围表单可保持页内组合：从 Agent/工作空间目录呈现可读名称，稳定 ID 仅留在控件值与持久化数据中；旧目录不存在的限制显示可撤销占位项；目录加载失败时仍允许保存正文但不提交范围策略；只更新用户触碰的维度，其他策略字段原样保留。**不新增叶子控件**——选择项统一用 `uiCheckbox(...)`，无选项状态用文案，取消限制走既有 `btn(...)`，说明与选择组复用 `.field`、`<details class="details">` 和既有 token。该业务语义不等同于标签筛选、标签编辑或批量操作。 | `uiCheckbox(...)`、`uiButton(...)`（经本页 `btn()`）、`.field`、原生 `<details class="details">` 折叠样式、i18n、设计 token。 | `@bonc-ai/reviewers`, TBD | 代码负责人确认该页内组合边界；若第二个页面需要相同的“按名称编辑稳定 ID 授权范围”契约，再提议共享选择器。 |
| `COG-PV-013` | `cognition-assets/views.js` 「待我处理」页尾旧 USER.md / MEMORY.md 归属核对分区（来源说明 + 原文选择 + 迁入结果） | Proposed | 一次性旧记忆核对区可保持页内组合并默认折叠，避免挤占日常待办：按来源文件展示原文，相同内容合并显示并明确一起迁入；条目由用户逐项勾选，显式确认后只处理预览快照仍匹配的选择，成功项才从旧源清理，待审核/失败/未选中项留在源文件。**不新增叶子控件或控件变体**——选择走 `uiCheckbox(...)`，刷新/迁入走 `uiButton(...)` / `uiConfirmDanger(...)`，原文使用既有 `.content-text`，状态提示复用 `.sect-block` / `.details` 和 i18n。 | `uiCheckbox(...)`、`uiButton(...)`（经本页 `btn()`）、`uiConfirmDanger(...)`、既有 `.content-text` / `.sect-block` / `.details` 与设计 token。 | `@bonc-ai/reviewers`, TBD | 需由代码负责人确认页尾一次性迁移核对组合；若第二处页面需要“基于快照的逐项迁移选择”稳定契约，再提议共享审核列表组件。 |

## PR notation

Renderer PRs that touch structure should include one of the following:

```text
Shared APIs: uiModalController, uiTree
Registry entries: KB-M-002, KB-PV-003
New page-local structural composition: none
```

or, when proposing a new entry:

```text
Registry proposal: KB-PV-005 (Proposed)
Scope and boundary: ...
Why no shared seam fits: ...
Review trigger: ...
```
