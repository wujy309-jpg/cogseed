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

## Known non-icon inline SVG

Inline `<svg>` is counted by `test/renderer/shared-ui-adoption-guard.test.ts` so that icons cannot
bypass `modules/icons.js`. A **data visualisation** cannot be expressed as a static icon path, and
this section is where those are registered. Each entry is counted in `inlineSvgBaseline`; adding one
requires a record here in the same change.

| ID | File | What it draws | Why it is not an icon | Registered |
| --- | --- | --- | --- | --- |
| `SEC-PV-001-SVG` | `settings-security.js` | Security score ring (`scoreRing`) | Radius, stroke width and `stroke-dashoffset` are computed from the score; the arc length is the datum. A static path cannot carry it. | 2026-03-06 |

## Approved Provisional compositions

| ID | Scope | Status | Allowed boundary | Required shared seams | Decision owner/date | Review trigger |
| --- | --- | --- | --- | --- | --- | --- |
| `KB-PV-001` | `kb-workbench.js` context menus (`kb-ctx-*`) | Approved Provisional | Context-menu positioning, submenu state and KB commands may remain page-local. Do not reuse the account-specific `uiUserMenu*` API as a generic menu. | `uiButton(...)` / `uiIconButton(...)`, icons, tokens and accessible menu keyboard behavior. | `@bonc-ai/reviewers`, 2026-09-21 | Propose `uiMenu(...)` when a second page needs the same stable menu contract. |
| `KB-PV-002` | Workbench layout shell (`kb-wb-*`) | Approved Provisional | KB sidebar, toolbar and split-pane composition may remain page-owned. This does not exempt nested controls or tabs. | Shared actions, forms, tabs, status and tokens. | `@bonc-ai/reviewers`, 2026-09-21 | A second page adopts the same stable workbench layout contract. |
| `KB-PV-003` | File-reader internal interaction | Approved Provisional | Zoom, pagination, resize/drag behavior, document rendering and block marking remain page-owned after the outer modal migrates. | Modal lifecycle, actions, icons, status and layer tokens. | `@bonc-ai/reviewers`, 2026-09-21 | Another page needs the same stable reader interaction contract or a shared drag/resize seam is approved. |
| `KB-PV-004` | Media-manager internal views | Approved Provisional | Thumbnail grid, multi-select and batch-operation composition remain page-owned after the outer overlay migrates. | Modal/drawer lifecycle, actions, selection controls, progress and status. | `@bonc-ai/reviewers`, 2026-09-21 | A second page needs the same stable media-management contract. |

## Proposed compositions

Records in this section are awaiting a code-owner decision and cannot be used as an approved
exception. Their implementation ships under the proposal, and the boundary stays exactly as
written here until `@bonc-ai/reviewers` promotes, narrows or rejects it.

### `CONN-PV-001` — Connector detail view (Tencent Meeting)

- **ID**: `CONN-PV-001`
- **Scope**: `connectors.js` — the connector detail view and its grid ⇄ detail transition
  (`#connectors-detail-view` / `#connectors-detail-body`, page-local classes `connectors-detail-*`),
  reachable from the `腾讯会议` card in the 连接 › MCP与工具 tab (`#connections-pane-mcp`). Covers
  the connector identity header, the three-step progress indicator (`接入前` / `发起连接` /
  `连接成功`), the main status card with its `创建会议自动化` action, and the `连接状态` panel.
- **Status**: `Superseded` — replaced by `CONN-PV-003` on 2026-10-12; retained as history.
- **Allowed boundary** (the boundary this proposal asks to keep page-local; nothing here is
  approved yet): one detail view keyed by connector id, entered only from that connector's own card
  action (`data-act="open-detail"`), and only for connectors with a row in
  `_CONNECTOR_DETAIL_PROFILES` — the Tencent Meeting connector alone. The whole-card detail entry uses a shared `uiButton(...)` title with a
  stretched hit target, native keyboard activation, and focus return to that title after exit.
  Existing action buttons sit above that target; card clicks never initiate authorization.
  Code-owner approval of this proposal remains pending.
  It must not become a second visual variant of the card grid, and must not be generalised to
  other connectors without a new review. Both panels
  reuse the shared `ui-resource-card` shell and add page-owned padding/width only; the shared
  shell's border, radius, background and shadow are not overridden.
- **Required shared seams**: `uiButton(...)` and `uiIconButton(...)` for every control (the
  `connectors.js` raw-control baseline is unchanged), `uiCard(...)` for both panels,
  `uiStatusPill(...)` for the `已连接` tag, `uiIconHtml('check-circle' | 'info' | 'plug')` for
  icons, `uiAlert(...)` for the `(i)` disclosure instead of a page-local overlay, the shared
  Escape/focus-return pattern (document-level keydown with an IME guard plus focus return to the
  originating card action), native `<ol>`/`<li>` with `aria-current="step"` and a visually hidden
  state word for the indicator, and design tokens only — no literal colour, font-size, radius or
  `z-index`.
- **Rationale**: No shared seam describes this shape. The step indicator is business-specific —
  its steps 2 and 3 are derived from the live `connected` state rather than a new persisted field,
  and the first step is unconditionally complete — and the whole view exists because for this
  connector the connection is only half the job (connect, then create a meeting-digest automation
  task). Extracting a `uiSteps(...)` primitive from a single call site would freeze a contract that
  no second page has validated. Colours, spacing and typography come from tokens and the shared
  primitives, so the duplicate-implementation risk the policy targets does not apply.
- **Decision owner**: `TBD` (`@bonc-ai/reviewers` owns the decision; no approval has been given)
- **Decision date**: `TBD`
- **Review trigger**: A second page or a second connector needs the same detail composition or the
  same stable step-indicator contract (then propose `uiSteps(...)` / a connector-detail seam), or
  `@bonc-ai/reviewers` decides the shared layer should own it now.
- **Related PR/issue**: `TBD`

### `SEC-PV-001` — 安全与信任 page body (`sec-*`)

- **ID**: `SEC-PV-001`
- **Scope**: `settings-security.js` security page body (`sec-*`)
- **Status**: `Proposed`
- **Allowed boundary** (the boundary this proposal asks to keep page-local; nothing here is approved yet): The 安全与信任 page owns its business composition: the hero (kept as-is by review decision) and the **content of the three accordion row bodies** — the capability list, the composition-path list, and the receipts table — plus the detail-drawer sections. The page shell below the hero is **no longer page-local structure**: the three rows are `uiAccordion(...)`, which gained per-item `tone` / `icon` / `statusHtml` for exactly this shape. `sec-*` classes are page-local and may not be reused outside this page. The score ring is page-owned because it encodes a *security score band*, not a generic gauge: `scoreBand()` is the single banding function so the ring and the table's score bar cannot disagree.
- **Required shared seams**: `uiAccordion`, `uiButton`/`uiIconButton`, `uiInput`, `uiStatusPill`, `uiStatusDot`, `uiTag`, `uiBadge`, `uiSegmentedControl`, `uiProgressBar`, `uiSkeleton`, `uiEmptyState`, `uiDrawer`, `uiIconHtml`, `uiToast`/`uiPrompt`/`uiConfirm`, design tokens, and the `--z-*` layer tokens.
- **Rationale**: 由安全与信任页面在实现它的同一提交内提出，把页面本地结构登记到可复核的边界里；`SEC-PV-001` 覆盖页面主体与三个行体内容，`SEC-PV-002` 覆盖其中的组合路径图。
- **Decision owner**: `TBD` (`@bonc-ai/reviewers` owns the decision; no approval has been given)
- **Decision date**: `TBD`
- **Review trigger**: A second page needs the same stable score-gauge or capability-list contract, or the receipts table moves to `uiDataTable` once it can host rich cells.
- **Related PR/issue**: `TBD`

### `SEC-PV-002` — Composition path figure (`sec-graph*`)

- **ID**: `SEC-PV-002`
- **Scope**: `settings-security.js` composition path figure (`sec-graph*`)
- **Status**: `Proposed`
- **Allowed boundary** (the boundary this proposal asks to keep page-local; nothing here is approved yet): Each cross-skill risk path renders as a **directed figure**: one node per participating skill, carrying the capability that step contributes (shared `uiTag`) and a shared `uiButton` that opens the detail drawer, joined by an `arrow-right` from `modules/icons.js`. A skill appearing in more than one path carries a shared-paths meta row (`git-branch` + shared `uiBadge`). It stays inside `SEC-PV-001`'s composition-row-body scope and introduces no new shared seam. Nodes are CSS geometry only, and the figure is **deliberately not an inline-SVG case**: no geometry is derived from data (unlike the score ring, whose arc length *is* the score), so it neither needs nor adds a `Known non-icon inline SVG` row — hand-computed text coordinates would in any case drift across the four locales. Capability→skill attribution follows the report's own path semantics (`participants[i]` provides `capabilities[i]`), falling back to per-skill capability evidence, then to a separate tag row, only when the two arrays disagree in length, so that a capability is never silently dropped and never drawn on the wrong step.
- **Required shared seams**: `uiButton`, `uiTag`, `uiBadge`, `uiIconHtml` (`arrow-right`, `git-branch`), design tokens.
- **Rationale**: 由安全与信任页面在实现它的同一提交内提出，把页面本地结构登记到可复核的边界里；`SEC-PV-001` 覆盖页面主体与三个行体内容，`SEC-PV-002` 覆盖其中的组合路径图。
- **Decision owner**: `TBD` (`@bonc-ai/reviewers` owns the decision; no approval has been given)
- **Decision date**: `TBD`
- **Review trigger**: A second page needs the same node/edge figure → propose a shared `uiFlowFigure(...)`; or the figure gains geometry derived from data → it becomes a `Known non-icon inline SVG` entry.
- **Related PR/issue**: `TBD`

## Explicit business-owned decisions

| ID | Scope | Status | Decision | Review trigger |
| --- | --- | --- | --- | --- |
| `KB-B-001` | Knowledge Base question/answer conversation flow | Business-owned | The conversation flow, answer body and message sequencing are business content/state, not a blanket Provisional structural exception. Shared actions, status, progress and overlays still apply. | Propose a shared conversation/message contract if another page needs the same stable behavior. |
| `KB-B-002` | Question/answer attachment item (`kb-qa-attach-chip`) | Business-owned | Do not replace it with `uiChip(...)`: `uiChip` is an `aria-pressed` filter control, while an attachment item presents file metadata and a remove action. | Propose a shared attachment-item component when another page needs the same stable contract. |

## Pending proposals

| ID | Scope | Status | Allowed boundary | Required shared seams | Decision owner/date | Review trigger |
| --- | --- | --- | --- | --- | --- | --- |
| `COM-PV-001` | `composer-members.js` member picker rows (`composer-member-row`) | Proposed | The multi-select member row list may remain page-local composition: selection state uses `uiCheckbox(...)`, and the space-excluded state renders as an `aria-disabled`, non-selectable row with a `lock` icon and reason text instead of silently disappearing. Row layout, grouping and reason copy stay page-owned. | `uiCheckbox(...)`, `uiIconHtml(...)`, tokens, native `aria-disabled` semantics. | `@bonc-ai/reviewers`, `TBD` | Propose `uiSelectableRow(...)`/`uiListPicker(...)` once a second page needs the same stable multi-select row contract. |
| `KB-PV-005` | `kb-meeting-refs.js` 会议引用伴生面板（`kb-mrf-host` / `kb-mrf` / `kb-mrf__head/__title/__meta/__hint/__status/__sections`） | Proposed | 一场会议的「资产引用 / 纪要条目 / 待办草稿 / 跨会议关联 / 回执」五分区汇总面板可保持页内组合：与纠错面板位于同一右栏，各自独占子容器；`anchored-source-view.js` 保存两个实例并在收起、关闭或切换文档时分别销毁，每次展开重建子容器，分区顺序与折叠状态是会议读模型的业务内容视图。**不新增任何叶子控件**——对比/确认/丢弃/引用到本会议等动作一律 `uiButton(...)`，状态章与命中方式章 `uiTag(...)`（原语缺失退化为纯文本 `span`，非交互控件），空态 `uiEmptyState(...)`（每分区恰一处）；无裸 `<button>`/`<input>`/内联 SVG/字面 z-index（`shared-ui-adoption-guard`：本模块不在基线表内 = 允许 0 裸控件，实测 0）。 | `uiButton(...)`、`uiTag(...)`、`uiEmptyState(...)`、设计 token；模块缺失（旧构建）时伴生挂载静默跳过，不阻塞纠错主功能。 | `@bonc-ai/reviewers`, TBD | 第二个界面需要同一套稳定「多分区引用汇总 + 冻结版对比」呈现时，提案共享 `uiRefSummaryPanel(...)`/`uiVersionCompareRow(...)`。 |
| `HUBC-PV-001` | `hub-contributions.js` 贡献流程整页外壳与四步指示器（`#skills-contribute-view` / `hubc-steps` / `hubc-panel`） | Proposed | 贡献流程可保持页内整页组合：技能页内与 `skills-grid-view`、`skills-detail-view` 同级的一个视图，由「补齐资料 → 本地检查 → 预览与声明 → 提交审核」四个阶段面板按阶段整块重绘；步骤指示器为原生 `<ol>`/`<li>`（`aria-current="step"` + 视觉隐藏的状态词），状态由真实 `contribution.*` 结果推出，不新增持久化字段。**不新增任何叶子控件**：全部动作 `uiButton(...)`、表单 `uiField(...)`/`uiInput(...)`/`uiTextarea(...)`/`uiSelect(...)`/`uiCheckbox(...)`、状态 `uiStatusPill(...)`、提示 `uiAlert(...)`、条款全文 `uiModal(...)`；无裸 `<button>`/`<input>`、自建弹层、emoji/内联 SVG、字面 z-index。检查清单行只是业务读模型（`admission`）的呈现。 | `uiButton(...)`、`uiField(...)`/`uiInput(...)`/`uiTextarea(...)`/`uiSelect(...)`/`uiCheckbox(...)`、`uiStatusPill(...)`、`uiSkeleton(...)`、`uiModal(...)`、`uiConfirm(...)`、`uiIconHtml(...)`、设计 token。 | `@bonc-ai/reviewers`, TBD | 第二个流程需要同一套「多阶段向导 + 步骤指示器」稳定契约时，提案共享 `uiSteps(...)`（与 `CONN-PV-001` 的三步指示器合并评估）。 |
| `HUBC-PV-002` | `hub-contributions.js` 提交预览双栏（`hubc-preview` / `hubc-file-list` / `hubc-file-content`，原型 `preview-layout`） | Proposed | 预览阶段可保持页内双栏组合：左栏为本次提交的文件清单（逐项 `uiButton(...)` ghost 选择，`aria-pressed` 标记当前文件），右栏只读显示所选文件内容（经 `contribution.readFile` 按需读取，二进制只显示大小）。清单来自 `contribution.start/complete/recheck` 的 `preview`，不接受任意路径。**不新增叶子控件**；内容区是只读 `<pre>`。 | `uiButton(...)`、`uiEmptyState(...)`、`uiIconHtml(...)`、`uiStatusPill(...)`、设计 token；数据来自 `contribution.readFile`（路径必须在预览清单内）。 | `@bonc-ai/reviewers`, TBD | 第二个界面需要同一套「文件清单 + 只读内容」稳定契约时，提案共享 `uiFileBrowser(...)`（与 `KB-PV-003` 阅读器评估是否合并）。 |
| `HUBC-PV-003` | `hub-contributions.js` 「我的贡献」整页统计条与列表/详情布局（`#skills-contributions-view` / `hubc-summary` / `hubc-list` / `hubc-detail`，原型 `view-contributions`） | Proposed | 「我的贡献」可保持页内整页组合：统计条（总数/待审核/已发布/最近同步）、状态筛选与搜索、左侧列表加右侧详情的主从布局。列表行由 `uiButton(...)` ghost 承担选择与键盘行为（`aria-pressed`），状态用 `uiStatusPill(...)`；统计、筛选与搜索全部在前端对 `contribution.mine` 的账号隔离缓存做纯函数计算（`hub-contributions-model.js`），不改变缓存、刷新或离线语义。**不新增叶子控件**；撤回、新版本、历史动作沿用既有 `contribution.*` 通道与共享确认/提示。 | `uiButton(...)`、`uiSegmentedControl(...)`、`uiInput(...)`、`uiStatusPill(...)`、`uiEmptyState(...)`、`uiModal(...)`、`uiConfirm(...)`/`uiConfirmDanger(...)`/`uiPrompt(...)`、设计 token；纯函数桥 `HubContributionsModel`。 | `@bonc-ai/reviewers`, TBD | 第二个界面需要同一套「统计条 + 主从列表详情」稳定契约时，提案共享 `uiMasterDetail(...)`。 |



| `ONTO-PV-004` | 本体对象详情、首页待处理提示与最近查看、完整原文窗口、我的认知与系统活动本体投影（2026-10-07） | Proposed | 对象详情组合当前信息、关系、相关规则、历史来源和实际采用版本；历史版本只读；首页待处理数来自共同候选队列，失败不显示零；最近查看只存本机对象 ID；我的认知与系统活动只读同一主档目录和版本记录，深链进入正式本体工作台；原文窗口只读，不作为确认授权。 | `uiTabs`、`uiField`、`uiButton`、`uiModal`、i18n 与既有页面 token；不增加共享叶子控件。页内组合依赖本体数据与权限语义，现有共享叶子 API 已覆盖控件但没有同一业务结构；PR/issue：TBD。 | `@bonc-ai/reviewers`, TBD | 接入正式页面的实现仍等待产品与代码负责人审查。 |

## Cognition composition records

保留当前页面使用的登记，审批状态由 reviewers 维护。新审批详情使用独立编号 `COG-PV-019`，不复用原标签弹层编号。

| ID | Scope | Status | Allowed boundary | Required shared seams | Decision owner/date | Review trigger |
| --- | --- | --- | --- | --- | --- | --- |
| `ONTO-PV-001` | `cognition-ontology.js` 本体关系图谱画布（全局模块图 + 单本体对象/事实/规则图） | Proposed | 页面自持的业务数据画布，只绘制查询返回的本体节点与显式关系；布局/边/节点状态不写回本体内容。列表与图谱保持同级路由，本体局部图位于单一本体详情内。 | 操作走 canonical IPC；图上详情动作走 `uiButton(...)`；本体视图切换走 `uiTabs(...)`；配色/焦点复用设计 token 与项目图标。内联 SVG 只用于边与关系网络绘制，不得用作叶子图标。 | `@bonc-ai/reviewers`, TBD | 若第二个页面需要同一层级关系画布，提议共享图谱查询/画布接口；代码负责人确认是否保留本页 SVG 画布例外。 |
| `ONTO-PV-002` | `cognition-ontology.js` 本体列表与盒内容分页（`.ontology-ws-pagination`） | Proposed | 长列表用原生 `<nav aria-label>` 呈现当前窗口范围及上一页/下一页；分页只改变可见切片，不修改、裁掉或排序权威记录。页内按钮走共享 `uiButton(...)`，不添加新按钮皮肤或重复键盘交互。 | `uiButton(...)`、原生导航语义、i18n 和设计 token；记录总数由已载入的用户可见快照计算。 | `@bonc-ai/reviewers`, TBD | 第二个页面需要同一稳定分页契约时，提议抽取共享 `uiPagination(...)`；本页继续验证键盘、窄屏和大数据边界。 |
| `COG-PV-001` | `cognition-assets/review-candidate.js` 改进候选依据链 + 只读「改进分析」分区（`ca-chain` / `ca-improvement` / `ca-improvement-empty`） | Proposed | 两块可保持页内组合：它们是对候选与结论读模型的业务内容视图（带标签分节、逐字段 `row`/`sub` 行、长值折叠）。**不新增任何叶子控件**——动作一律走 `uiButton(...)`、标签走既有 `chip()`/`uiTag(...)`、空态走本页 `empty()` → `uiEmptyState(...)`；无裸 `<button>`/`<input>`/内联 SVG/字面 z-index（`shared-ui-adoption-guard` 实测：`views.js` 裸控件 0、内联 SVG 1 与基线相等，均未上调）。 | `uiButton(...)`、`uiTag(...)`（测试夹具加载 `ui-status.js` 时）、`uiEmptyState(...)`（经本页 `empty()`）、既有 `chip()`/`foldValue()`、设计 token。 | `@bonc-ai/reviewers`, TBD | 第二个界面（如经验目录或会议引用层）需要同一套稳定「主张 → 依据 → 结果」呈现时，提案共享 `uiEvidenceChain(...)`/`uiOutcomeList(...)`。 |
| `COG-PV-002` | `cognition-assets/review-candidate.js` 候选详情的版本冲突块（`ca-version-conflict` / `data-version-conflict`） | Proposed | 该块可保持页内组合：它是"这次确认没生效"的**业务事实视图**——警示行 + 逐字段「当前 → 拟生效」`meta-item` 行 + 两段正文折叠 + 一个重锚按钮。**不新增任何叶子控件**：重锚/稍后/拒绝走本页既有 `btn()` → `uiButton(...)`（act 复用已登记的 `cand-decide`，action=rebase），长值折叠复用既有 `foldValue()`（`ca-tl-body`/`ca-tl-text`），中性标签复用既有 `chip()`；无裸 `<button>`/`<input>`/内联 SVG/字面 z-index/`document.*` 访问。 | `uiButton(...)`（经本页 `btn()`）、既有 `foldValue()`、设计 token；数据来自只读通道 `recall.assets.versions.list`。 | `@bonc-ai/reviewers`, TBD | 第二个界面（如审批卡或对话内卡片）需要同一套"冲突 → 按当前版重摆 → 显式重锚"呈现时，提案共享 `uiVersionConflictBlock(...)`/`uiFieldDelta(...)`。 |
| `COG-PV-015` | `cognition-assets/review-candidate.js` 候选详情的已处理状态说明与后续落点（`ca-candidate-state-note`） | Proposed | 从历史对话打开已处理建议时，按真实生命周期显示只读状态说明，并把已保存记录链接到正式资产、把被忽略的重复项链接到存活建议。业务说明和路由按钮可以保持页内组合；不新增叶子控件，按钮复用 `btn(...)` → `uiButton(...)` 及既有 `go-inbox-asset` / `open-candidate` 委托。 | `uiButton(...)`、既有状态 `chip()`、已登记资产/候选路由、设计 token、状态文案 i18n。 | `@bonc-ai/reviewers`, TBD | 代码负责人确认状态说明区与后续落点边界；若其他对象需要相同历史处理模式，再评估共享详情状态区。 |
| `COG-PV-012` | `cognition-assets/views.js` 资产编辑页可见范围选择器（`ca-asset-scope-editor` / Agent 与工作空间多选组） | Proposed | 资产编辑专用范围表单可保持页内组合：从 Agent/工作空间目录呈现可读名称，稳定 ID 仅留在控件值与持久化数据中；旧目录不存在的限制显示可撤销占位项；目录加载失败时仍允许保存正文但不提交范围策略；只更新用户触碰的维度，其他策略字段原样保留。**不新增叶子控件**——选择项统一用 `uiCheckbox(...)`，无选项状态用文案，取消限制走既有 `btn(...)`，说明与选择组复用 `.field`、`<details class="details">` 和既有 token。该业务语义不等同于标签筛选、标签编辑或批量操作。 | `uiCheckbox(...)`、`uiButton(...)`（经本页 `btn()`）、`.field`、原生 `<details class="details">` 折叠样式、i18n、设计 token。 | `@bonc-ai/reviewers`, TBD | 代码负责人确认该页内组合边界；若第二个页面需要相同的“按名称编辑稳定 ID 授权范围”契约，再提议共享选择器。 |
| `COG-PV-016` | `cognition-assets/views.js` 正式资产与独立经验详情的单列结构（`ca-asset-page` / `ca-asset-stack` / `ca-experience-detail-grid`） | Proposed | 各详情区块按正文、来历、使用、版本和管理的顺序独占一行；经验保留独立字段和动作，仅共用单列阅读节奏。它细化了 `COG-PV-010` 的详情呈现范围，不增加叶子控件或第二套折叠交互；长正文、来源、台账和错误状态保持业务数据原样。 | `uiButton(...)`、`uiSwitch(...)`、既有 `chip()` / `evidenceChip()`、原生 `<details>`、i18n 与设计 token。 | `@bonc-ai/reviewers`, TBD | 若其他业务对象需要同一稳定的单列详情合同，再提议共享页面结构；正式资产与经验的数据语义仍分别维护。 |
| `COG-PV-017` | `cognition-assets/review-candidate.js` + `cognition-assets/review-views.js` 「待我处理」页与候选族页面局部结构（自 `views.js` IIFE 拆出，2026-09-29） | Proposed | 零行为变更的机械拆分：`COG-PV-001`/`COG-PV-002`/`COG-PV-008`/`COG-PV-015` 等已登记的候选族结构（依据链 `ca-chain`、版本冲突块 `ca-version-conflict`、治理待办分组区、已处理状态说明）连同宿主函数整体迁入两个同目录同 IIFE 模式的新文件；共享零件经 `NS.ui` 取用、候选族零件经 `NS.candidate` 命名空间取用，不新增任何叶子控件或新结构。`shared-ui-adoption-guard` 按目录扫描自动覆盖新文件（实测 0 裸控件）。 | 与拆分前完全一致：`uiButton(...)`（经 `btn()`）、`uiInput(...)`、`uiTextarea(...)`、`uiEmptyState(...)`、既有 `chip()`/`foldValue()`、原生 `<details>`、设计 token；`views.js` 导出 `NS.ui` 共享件、`review-candidate.js` 导出 `NS.candidate`。 | `@bonc-ai/reviewers`, TBD | 代码负责人确认拆分边界（页面局部结构的新宿主文件）后，把本条与被引用的 `COG-PV-001`/`002`/`008`/`015` 的 Scope 同步更新为双文件表述；若后续再拆认知资产模块，沿用同一命名空间导出惯例。 |

## Historical cognition proposals

以下为保留的原始提案与决策记录，不是当前产品需求或新结构授权。明确退役的入口标为 `Superseded`；其余保留原审查状态，重新使用前核对当前实现与边界，不能因恢复记录而重建旧功能。

| ID | Scope | Status | Allowed boundary | Required shared seams | Decision owner/date | Review trigger |
| --- | --- | --- | --- | --- | --- | --- |
| `ONTO-PV-003` | `cognition-ontology.js` 候选整理流程（候选来源卡、目标本体选择、T/A/R 分步录入、已整理记录清单） | Superseded | **该入口已由夜间完整建议和系统活动流程取代；保留原提案用于追溯，不恢复入口。** 页面内承接单条 Recall 候选并逐步创建结构化本体记录；原始候选保留在“待我处理”，创建的本体记录通过候选来源关联，完成动作关闭候选待办。候选范围由页面提示并由主进程再次验证；高风险候选需要用户逐次确认。只组合本体业务流程，不引入可复用新控件或第二套模态框/表单交互。 | `uiPageHeader(...)`（经本页 `pageHeader()`）、`uiButton(...)`、`uiTabs(...)`、`uiField(...)`、`uiModal(...)`、`uiConfirm(...)`、`uiToast(...)`、i18n 与设计 token。 | `@bonc-ai/reviewers`, TBD | 需核对待我处理状态、候选范围冲突、保存失败恢复、完成后回执与窄屏布局；若第二个页面复用候选结构化整理流程，再评估共享领域接口。 |
| `COG-PV-014` | `conversation.js` 对话保存回执（`chat-cognition-save-receipts` / `chat-cognition-save-receipt`） | Superseded | **该入口已由夜间完整建议和系统活动流程取代；保留原提案用于追溯，不恢复入口。** 对话中的跨会话保存结果作为「证据」结果块内的小型事实行：精确保存文字、由主进程确认的保存/待审核状态、一个打开正式资产或候选的动作。状态不依赖模型复述；动作复用 `uiButton(...)` 与已有资产/候选路由。 | `uiButton(...)`、既有 Evidence 结果块、`data-asset-citation` / `data-candidate-citation` 跳转、设计 token；数据由 host-owned `cognition_save_receipts` 持久化。 | `@bonc-ai/reviewers`, TBD | 若经验或其他知识对象需要同样的确定性写入回执，再抽取共享回执原语；当前只覆盖认知资产保存。 |
| `PO-PV-001` | `personal-ontology.js` 三盒导航行竖排副标题（`personal-onto-nav-row-text is-stacked` / `personal-onto-nav-row-sub`） | Proposed | 三盒 nav 行的文字位可保持页内「主标题 + 副标题」两行竖排组合。nav 行本身是已冻结裸控件基线内的原生导航行（design-system 测试基线 5，`personal-onto-nav-row${active` 断言锁定）；竖排仅为排版修饰，**不新增任何叶子控件、不引入新交互**——动作走 `uiButton(...)`/`uiIconButton(...)`、图标走 `uiIconHtml(...)`、元数据与状态标记走 `uiTag(...)`/`uiStatusPill(...)`/`uiStatusDot(...)`；无 emoji/内联 SVG/字面 z-index（`shared-ui-adoption-guard` 实测均未上调）。 | `uiButton(...)` / `uiIconButton(...)`、`uiIconHtml(...)`（icons.js）、`uiTag(...)` / `uiStatusPill(...)` / `uiStatusDot(...)`（ui-status.js）、设计 token。 | `@bonc-ai/reviewers`, TBD | 第二个界面需要同一套「导航行主标题 + 副标题」稳定契约时，提案共享 `uiNavRow(...)`/`uiNavItem(...)`。 |
| `PO-PV-002` | `personal-ontology.js` 会话沉淀资产行与角色模板资产投影只读行（`personal-onto-value-line` / `memory-group-field-value`） | Proposed | A 盒画像资产和模板字段投影都明确显示来源并提供「查看来源资产」入口；投影值在本体页不可编辑或删除，用户从正式资产详情纠错或停用。手填字段值仍使用现有编辑/删除操作；原文编辑保留其他手填内容，但必须保留投影标记与模板元信息。**不新增叶子控件**：来源跳转用既有 `uiButton(...)`，行和说明保持本页组合。 | `uiButton(...)`、既有 `window.openCognitionAssetById(...)` 路由、i18n、设计 token。 | `@bonc-ai/reviewers`, TBD | 第二个投影面需要相同的「明确来源 + 回到唯一事实源」只读契约时，再提议共享来源投影行。 |
| `PO-PV-003` | `personal-ontology.js` 本体总览、多领域实体/分类管理、来源引用与关系边（`personal-onto-overview` / `personal-onto-domain-grid` / `personal-onto-graph-entity-card` / `personal-onto-relation-row`） | Proposed | 页面按业务语义组合个人事实投影、事项/资源/概念实体、可编辑分类字段与跨领域关系。图谱是独立持久化数据；个人资料、候选和正式资产仅作为 `{kind,id}` 来源引用，不复制正文。删除分类/实体及移除字段按后端引用约束执行，关系端点只连接“我”或本体实体。卡片、表单、弹层、动作、标签与状态均复用共享 `uiResourceGrid(...)` / `uiResourceCard(...)` / `uiCard(...)` / `uiForm(...)` / `uiField(...)` / `uiModal(...)` / `uiButton(...)` / `uiCheckbox(...)` / `uiSelect(...)` / `uiTag(...)` / `uiEmptyState(...)`；本体业务页只负责类别/实体/关系的领域排布。 | Shared Renderer APIs listed at left, i18n, design tokens; graph data via `ontology.graph.*` IPC. | `@bonc-ai/reviewers`, TBD | 第二个页面需要同一套本体图谱管理契约时，定义共享领域组件边界；代码负责人审核后将 Proposed 更新为 Approved Provisional 或 Superseded。 |
| `COG-PV-003` | `cognition-assets/views.js` 标签筛选行（`ca-tag-filter` / `ca-tag-candidates`） | Proposed | 资产列表里与类型 chips 并列的**另一根筛选轴**可保持页内组合：标签 chip 行（含「未分类」chip 与「更多」入口）+ 交/并集切换。**不新增任何叶子控件**——chip 走本页既有 `btn(...)` → `uiButton(...)` 的 chip 皮肤，交/并集走 `uiSegmentedControl(...)`，候选下拉走原生 `<details class="details">`（既有折叠样式）；计数与筛选是业务状态（内存过滤，渲染层不重排主进程给的顺序）。无裸 `<button>`/`<input>`/内联 SVG/字面 z-index。 | `uiButton(...)`（经本页 `btn()`）、`uiSegmentedControl(...)`、原生 `<details>` 既有折叠样式、设计 token。 | `@bonc-ai/reviewers`, TBD | 第二个界面需要同一套「多选 chip 筛选 + 交/并集切换」稳定契约时，提案共享 `uiChipFilterBar(...)`。 |
| `COG-PV-004` | `cognition-assets/views.js` 资产详情「标签」节（`data-asset-tags` / `ca-tags-row` / `ca-tag-item`） | Proposed | 详情页的标签节可保持页内组合：已有标签 `uiTag(...)` + 移除动作、空态「未分类」引导、输入 + 候选下拉（`<details>` + chips）+「添加」。**不新增任何叶子控件**——输入走 `uiInput(...)`、按钮走 `btn(...)`、标签走 `uiTag(...)`；回车提交的 IME 守卫在 app.js 委托层（既有纪律）。 | `uiInput(...)`、`uiTag(...)`、`uiButton(...)`（经本页 `btn()`）、原生 `<details>` 折叠样式、设计 token。 | `@bonc-ai/reviewers`, TBD | 第二个界面需要同一套「条目标签节（增删 + 候选 + IME 回车）」稳定契约时，提案共享 `uiTagEditor(...)`。 |
| `COG-PV-005` | `cognition-assets/views.js` 标签管理弹层与「更多」弹层（`ca-tag-overlay-slot` / `ui-modal-overlay[data-tag-overlay]`） | Proposed | 两枚弹层可保持页内组合：外壳与焦点/Escape 生命周期走 `uiModalController(...)`（持久壳槽位 `#ca-tag-overlay-slot` 由 render 维护，弹层打开中不整块重写）；内部是标签库读模型的业务内容行（重命名内联编辑、合并目标选择 + 影响面确认、停用确认、同义建议只读区、已停用/已合并折叠区、批量进度与失败清单）。**不新增任何叶子控件**——动作一律 `btn(...)`、输入 `uiInput(...)`、进度 `uiProgressBar(...)`、折叠区 `<details class="details">`。 | `uiModalController(...)`、`uiInput(...)`、`uiButton(...)`、`uiProgressBar(...)`、`<details>` 折叠样式、设计 token。 | `@bonc-ai/reviewers`, TBD | 第二个界面需要同一套「轻量管理弹层（三动作 + 建议 + 折叠区 + 进度）」稳定契约时，提案共享 `uiManageListModal(...)`。 |
| `COG-PV-006` | `cognition-assets/views.js` 多选批量条（`ca-batch-bar` / `ca-tag-progress` / `ca-tag-failures`） | Proposed | 列表多选态的批量操作条可保持页内组合：已选计数 + 全选本页/清空/退出、三选一语义（打标/去标/替换为，互斥）、标签输入、执行、可见进度与逐项失败清单（不截断、可重跑幂等）。**不新增任何叶子控件**——多选行 `uiCheckbox(...)`（仅多选态渲染）、语义切换 `uiSegmentedControl(...)`、输入 `uiInput(...)`、按钮 `btn(...)`、进度 `uiProgressBar(...)`。 | `uiCheckbox(...)`、`uiSegmentedControl(...)`、`uiInput(...)`、`uiButton(...)`、`uiProgressBar(...)`、设计 token。 | `@bonc-ai/reviewers`, TBD | 第二个界面需要同一套「多选批量操作条（三选一语义 + 进度 + 失败清单）」稳定契约时，提案共享 `uiBatchActionBar(...)`。 |
| `COG-PV-007` | `cognition-assets/views.js` 资产详情「为什么这一轮排在前面」小节（`ca-rank-why` / `ca-rank-rows` / `ca-rank-row`）与沉淀设置页权重卡（`ca-rank-w-form` / `ca-w-error`） | Proposed | 排序依据折叠小节与权重配置卡可保持页内组合：小节用原生 `<details class="details">`（既有折叠样式），因子行只是「名 + 数值」的业务数据行；权重卡是 4 个数值 `uiInput(...)`（0~10、步进 0.1）+ 恢复默认 + 保存，**就地报错**（只写错误行，不整卡重画）。**不新增任何叶子控件**；数据来自只读通道 `recall.catalog.ranking` 与权重读写通道，视图不重算排序。 | `uiInput(...)`、`uiButton(...)`（经本页 `btn()`）、原生 `<details>` 折叠样式、设计 token。 | `@bonc-ai/reviewers`, TBD | 第二个界面需要同一套「可解释因子拆解小节」或「数值权重表单」稳定契约时，提案共享 `uiFactorBreakdown(...)`/`uiNumberWeightForm(...)`。 |
| `COG-PV-008` | `cognition-assets/views.js` 「待我处理」页治理待办分组区（`sect-block` 治理分区 + `notice-row inbox-governance-form` 就地表单 + `details.inbox-batch-names` 聚合名单） | Proposed | 治理分组区可保持页内组合：分区复用既有 `.sect-block`/`.tt`/`.note` 结构（标题 + 计数 + 副标题一句），条目行复用既有 `.notice-row`；三处行内处置可保持业务组合——扩权两钮、缺边界就地表单（两个 `uiInput(...)` 预填当前条件 + 保存）、未分级分级控件与聚合名单（`uiSegmentedControl(...)` + `<details class="details">` 折叠样式）。**不新增任何叶子控件**；分组顺序与动作全部由主进程读模型给出，渲染层零映射表（governance-inbox-guard ①钉住）。 | `uiSegmentedControl(...)`、`uiInput(...)`、`uiButton(...)`（经本页 `btn()`）、`uiTag(...)`（详情档位章）、原生 `<details>` 折叠样式、设计 token。 | `@bonc-ai/reviewers`, TBD | 第二个界面需要同一套「分组待办行 + 行内三档定级/补条件表单」稳定契约时，提案共享 `uiGovernanceInboxGroup(...)`。 |
| `COG-PV-009` | `cognition-assets/views.js` 「其他处理」次级动作折叠（`otherActions()` → `details.ca-other-actions` + `.actions` 容器 + `.ca-card-actions` 行） | Proposed | 三件套卡的动作行可保持页内组合：主按钮（推荐动作，primary）平铺 + 次级动作收进原生 `<details class="details">` 轻量折叠（无卡壳覆写、页内多条复用同一 helper）。**不新增任何叶子控件**——折叠内按钮一律 `btn(...)` → `uiButton(...)`，折叠头是原生 `<summary>`（既有折叠样式 + summary:focus-visible 共享焦点环）；无裸 `<button>`/`<input>`/内联 SVG/字面 z-index。 | `uiButton(...)`（经本页 `btn()`）、原生 `<details>`/`<summary>` 折叠样式、设计 token。 | `@bonc-ai/reviewers`, TBD | 第二个界面需要同一套「主按钮 + 次级动作折叠」稳定契约时，提案共享 `uiActionRow(...)`/`uiSecondaryActions(...)`。 |
| `COG-PV-010` | `cognition-assets/views.js` 资产详情三段式（`.ca-detail-facts` 状态章行 / 来历段 / `.ca-used-line` 用过吗段 / `foldBlock()` 「详情与历史」折叠 `ca-detail-history`） | Proposed | 详情首屏三段可保持页内组合：状态章行＝既有 `chip()`/`uiTag(...)` 横排；来历段＝既有 `evidenceGroupsHtml()` 业务分组；用过吗段＝note + 可点 `evidenceChip()`；技术细节收 `foldBlock()`（原生 `<details class="details">` 折叠，台账沿用既有独立折叠行）。**不新增任何叶子控件**——开关 `uiSwitch(...)`、按钮 `btn(...)`、档位 `uiTag(...)`、长值折叠复用 `foldValue()`；无裸控件/内联 SVG/字面 z-index（`shared-ui-adoption-guard`：views.js 裸控件 0、SVG 1=树图基线）。 | `uiSwitch(...)`、`uiButton(...)`（经本页 `btn()`）、`uiTag(...)`、既有 `chip()`/`evidenceChip()`/`foldValue()`、原生 `<details>` 折叠样式、设计 token。 | `@bonc-ai/reviewers`, TBD | 第二个界面（如经验详情）需要同一套「是什么/来历/用过吗 + 历史折叠」稳定契约时，提案共享 `uiDetailThreeSection(...)`/`uiOriginUsageSection(...)`。 |
| `COG-PV-011` | `conversation-info.js` + `index.html` 会话头部认知衔接行（`#chat-cognition-strip` 常驻槽 + `.chat-cognition-strip-inner`（图标 + label + ghost 按钮）） | Proposed | 会话头部与消息区之间的一条状态行可保持页内组合：挂载在自有常驻槽（仿 `#chat-plan-strip` 先例，`hidden` 起步、N=M=0 不出现），内容＝图标 + 一句计数 + 「去看」ghost 按钮（打开运行上下文抽屉的 assets tab）。**不新增任何叶子控件**——按钮走 `_button(...)` → `uiButton(...)`，图标走 `uiIconHtml(...)`（icons.js），计数与措辞由 `_sessionCognitionCounts()` 与抽屉「四类资产」tab 共用同一函数；无裸控件/内联 SVG/字面 z-index（样式全 tokens）。 | `uiButton(...)`（ghost）、`uiIconHtml(...)`、设计 token（含 640px 断点换行）。 | `@bonc-ai/reviewers`, TBD | 第二个界面需要同一套「头部细条状态行（图标 + 计数 + 跳转）」稳定契约时，提案共享 `uiHeaderStatusStrip(...)`；届时与 `#chat-plan-strip` 一并评估共享化。 |
| `COG-PV-013` | `cognition-assets/views.js` 「待我处理」页尾旧 USER.md / MEMORY.md 归属核对分区（来源说明 + 原文选择 + 迁入结果） | Superseded | **该入口已由夜间完整建议和系统活动流程取代；保留原提案用于追溯，不恢复入口。** 一次性旧记忆核对区可保持页内组合并默认折叠，避免挤占日常待办：按来源文件展示原文，相同内容合并显示并明确一起迁入；条目由用户逐项勾选，显式确认后只处理预览快照仍匹配的选择，成功项才从旧源清理，待审核/失败/未选中项留在源文件。**不新增叶子控件或控件变体**——选择走 `uiCheckbox(...)`，刷新/迁入走 `uiButton(...)` / `uiConfirmDanger(...)`，原文使用既有 `.content-text`，状态提示复用 `.sect-block` / `.details` 和 i18n。 | `uiCheckbox(...)`、`uiButton(...)`（经本页 `btn()`）、`uiConfirmDanger(...)`、既有 `.content-text` / `.sect-block` / `.details` 与设计 token。 | `@bonc-ai/reviewers`, TBD | 需由代码负责人确认页尾一次性迁移核对组合；若第二处页面需要“基于快照的逐项迁移选择”稳定契约，再提议共享审核列表组件。 |
| `PO-PV-004` | `personal-ontology.js` 关系网络图谱画布与工具行（`personal-onto-relgraph` / `personal-onto-relgraph-canvas` / `personal-onto-relgraph-legend`，2026-10-02） | Proposed | 关系网络的图谱呈现是 AGENTS.md 明确允许的页面自持业务画布：节点/边由页面 SVG 直接绘制（沿 `KB-PV-004` 画布先例），布局计算借力 vendor 的 d3-force（按需注入，失败自动降级为页内分层布局），只绘制显式保存的关系（same_family 与模型猜测不画线，延续 `PO-PV-003` 底线）。**不新增叶子控件**——清单/图谱与布局切换走 `uiSegmentedControl(...)`、kind 过滤走 `uiChip(...)`、缩放/重置/新建关系走 `uiButton(...)`，元数据提示走 `uiTag(...)`，空态走 `uiEmptyState(...)`；画布交互（缩放/平移/拖拽固定/悬停高亮）是画布内部行为，不构成共享控件契约。 | `uiSegmentedControl(...)`、`uiChip(...)`、`uiButton(...)`、`uiTag(...)`、`uiEmptyState(...)`、`uiIconHtml(...)`（icons.js）、设计 token；vendor d3-force（ISC，按需注入）。 | `@bonc-ai/reviewers`, TBD | 若第二个页面需要同一套"关系图渲染 + d3-force 布局 + 显式关系底线"契约，再提议共享关系图组件并抽取布局注入器。 |
| `CA-PV-005` | 认知资产 · 总览页（`cognition-assets/kernel-overview.js`，页面级类名 `ca-kernel-*`） | Superseded | 总览页签、`kernel-overview.js`、`cognition.kernel.overview` 通道及相关文案已移除。计数与导语由既有页面承载，最近使用在资产详情、列表与认知树中展示；不另设使用记录或汇总页。后续页面内优化由 `CA-PV-006` 记录。 | — | `@bonc-ai/reviewers`, 2026-10-02 | 已结束；保留本行作为"不要再加汇总页"的先例 |
| `CA-PV-006` | 待我处理 · 本体候选行（`cognition-assets/review-views.js`，页面级类名 `ca-review-row` / `ca-review-row-text`，2026-10-02 归位） | Superseded | **该入口已由夜间完整建议和系统活动流程取代；保留原提案用于追溯，不恢复入口。** 在既有「待我处理」页内新增一块：**本体候选行**——原先只在「本体」页横幅里，用户要去第二个地方看；现在同页一行一句内容 + 「确认记住／驳回」，确认走 `po.candidates.confirm`、驳回走 `po.candidates.reject`（均为既有通道）。**不新增页签、不新增控件皮肤**：按钮走 `NS.ui.btn`（内部 `uiButton(...)`）、标题走 `sectionHead(...)`、空态走 `NS.ui.empty`；`.ca-review-row` 只做行排布（flex + 分隔线），不覆盖共享控件的边框/圆角/阴影。个人字段通过 `personal_fields_check` / `personal_field_remember` 在对话中询问与保存，不另设任务前表单。 | `sectionHead(...)`、`NS.ui.btn`、`NS.ui.empty`、设计 token（仅 `var(--*)`） | `@bonc-ai/reviewers`, 2026-10-02 | 若本体候选行被第二个页面复用，抽成共享组件并把本行改为 `Migrated` |
| `COG-PV-018` | 认知资产手动确认表单与只读维护建议（2026-10-08） | Superseded | **该入口已由夜间完整建议和系统活动流程取代；保留原提案用于追溯，不恢复入口。** 手动保存沿用候选审计及准入，规则选择展开真实边界；维护报告区分新只读建议和历史执行恢复，不增加页面、候选池或共享控件。 | 既有 `uiInput`、`uiTextarea`、`uiButton`、原生 `<details>`、i18n；属于页面业务组合。 | `@bonc-ai/reviewers`, TBD | 原提案未获得维护者批准；状态由当前 Superseded 记录取代。 |
| `HUBC-PV-004` | `hub-agent-contributions.js` Agent 贡献整页（`#agents-contribute-view`，复用 `hubc-steps` / `hubc-panel` / `hubc-preview` / `hubc-file-list` / `hubc-check-list` 结构；预览含「可能含本机信息」提示面板与逐行 `hubc-hint-line` 高亮，需勾选「已知晓」才可确认；智能体页进入的「我的贡献」挂在 `#agents-contributions-view`，与技能页的 `#skills-contributions-view` 为同一页面逻辑，页签保持「智能体」） | Proposed | 与 `HUBC-PV-001`/`HUBC-PV-002` 同一整页组合，但属于智能体页：与 `agents-grid-view`、`agents-detail-view` 同级的一个视图，由「本机检查 → 预览与声明 → 提交审核」三步组成（Agent 的检查在开始时一次完成，没有补齐资料步骤）。检查步骤逐行列出智能体本体与每个随包技能；预览步骤在文件清单之外多出「已在本机移除的字段」与「这个智能体用到的技能」两个只读区，声明区多一个版本号输入和「这些技能也会同时贡献」勾选。全部控件仍用 `uiButton` / `uiField` / `uiCheckbox` / `uiSegmentedControl` / `uiModal`，没有新增原始控件或页内弹层；唯一新增的类名是智能体卡片上的 `.agent-card-contribute`，它只补一条层级规则（`position: relative; z-index: var(--z-raised)`），否则会被整卡覆盖层 `.agent-card-open` 盖住而点不了。「我的贡献」仍是 `HUBC-PV-003` 的同一页，只多一个类型切换（`uiSegmentedControl`）。 |
| `SIDEBAR-PV-001` | Conversation sidebar task row activity indicator (`conv-task-indicator`, `conv-task-pill`) | Proposed | The single activity slot before a task-row title may stay page-local composition across three mutually exclusive states: live work (spinning indicator), waiting for the user's wake-approval decision (shared status pill built with `uiStatusPill(...)`, tone `attention`), and nothing. The slot is a query/refresh hook only (`_convTaskStatusLine` / `_refreshConvTaskLine`); state meaning comes from `/runtime` (`in_flight`, `waiting_approval`) and row layout stays page-owned. **The indicator stays status-only** — no click target and no navigation on the row; acting on a pending wake stays in the dashboard control center (`wake-approvals.js`), so this entry is not extended into an action seam. | `uiStatusPill(...)`, `uiIconHtml(...)`, tokens, `t(...)` copy, native `role`/`aria-label` semantics. | `@bonc-ai/reviewers`, `TBD` | Propose a shared `uiTaskActivityIndicator(...)` (or a `uiStatusPill` slot contract) once a second surface needs the same running/pending-approval states; revisit if the wake-approval surface gets its own shared status component. |

## Shared form dialog migration

### `CONN-M-001` — Async form modal

- **ID**: `CONN-M-001`
- **Scope**: `modules/ui-modal.js`, production component gallery, and `connectors.js` Tencent
  Docs, 163/QQ/Enterprise email, and custom MCP connection forms.
- **Status**: `Migrated` for the structural implementation; code-owner review/related PR remain `TBD`.
  `CONN-PV-002` retains its Proposed business-content boundary and historical record.
- **Allowed boundary**: `uiFormModal(...)` composes `uiModal(...)` and one business-supplied
  `uiForm(...)` without form actions. It owns a standard footer, native form-associated submit,
  optional cancellation, text-only inline error feedback, and visible submit progress.
  Submission never auto-closes; the business callback decides when to close after success.
  Busy state blocks duplicate submit, disables controls and preserves previously disabled fields.
  `update(...)` refreshes localized title, close/submit/busy/cancel labels and optionally body HTML;
  the caller restores field values and hydrates selects after body replacement. Feedback and busy
  state survive updates. Escape, focus trapping/return and scroll locking belong to `uiModal`.
- **API**: Required `title`, `closeLabel`, `bodyHtml`, `submitLabel`, `busyLabel`; optional
  `size`, `initialFocus`, `cancelLabel`, `submitIcon`, `submitAttrs`, `feedbackAttrs`, `onSubmit`.
  Returns the existing modal Promise/`close`/`dialog`/`overlay` plus `setBusy(boolean)`,
  `setFeedback(text)` and `update(options)`. No provider copy, credentials, IPC or validation lives
  in the shared component.
- **Required shared seams**: `uiModal`, `uiButton`, `uiForm`, `uiField`, tokens and shared select
  hydration. No raw-control baseline increase or duplicated keyboard behavior.
- **Rationale**: Token, email and custom transport forms share the same async submit/recovery
  contract. Fields, authorization instructions, saved-password reuse, transport parsing, consent
  warning and requests remain business-owned. The gallery demonstrates default, pending and retry
  states using the production component.
- **Product contract**: Formal product-contract acceptance is unconfirmed.
- **Decision owner/date**: `@bonc-ai/reviewers` / `TBD`.
- **Review trigger**: Code-owner review or a change to form submission/lifecycle semantics.
- **Related PR/issue**: `TBD` (local implementation).

## PR notation

### `CONN-PV-002` — Migrated connector onboarding and meeting recovery content

- **ID**: `CONN-PV-002`
- **Scope**: `connectors.js`, the ten migrated connector cards, email/token onboarding forms,
  runtime preparation feedback, and Tencent Meeting authorization recovery content.
- **Status**: `Proposed`; implementation is local and awaits code-owner review.
- **Allowed boundary**: Business fields, provider instructions, connected-account labels,
  cancel/retry state and task routing remain owned by the connector page. Email and pasted-token
  forms compose `uiFormModal(...)`; see `CONN-M-001` for the shared structural slice. The
  token-dialog layout uses a medium shared modal, compact provider guidance, standard shared
  footer with a native form-associated submit button, and no space reserved for empty feedback.
  Async validation errors keep the form open for correction; existing credential handling remains.
  Tencent Meeting recovery replaces the former
  three-step/detail status content with current connection status and task usage examples;
  it remains keyed only to Tencent Meeting, without expanding detail profiles to other providers.
- **Required shared seams**: `uiCard`, `uiStatusDot`, `uiStatusPill`, `uiButton`, `uiIconButton`,
  `uiModal`, `uiForm`, `uiField`, shared select hydration, `uiToast`, `uiConfirmDanger`,
  `uiIconHtml`, i18n and design tokens. No raw-control baseline increase.
- **Rationale**: Provider-specific connection fields and authorization state are business content;
  this migration creates no additional control or overlay primitive. This record proposes the
  replacement of the detail-content boundary in `CONN-PV-001`, whose history remains intact.
- **Decision owner/date**: `@bonc-ai/reviewers` / `TBD`.
- **Review trigger**: Code-owner review of the migration, or a second page requiring the same
  provider onboarding contract.
- **Related PR/issue**: `TBD`.

### `CONN-PV-003` — Connector usage popup

- **ID**: `CONN-PV-003`
- **Status**: `Proposed`; code-owner approval remains pending.
- **Scope**: Usage popups for Tencent Meeting, 163 Mail, Enterprise Mail, QQ Mail, WPS, WeCom,
  Tencent Docs, Tencent Survey, DingTalk and Feishu. Replaces the full-page entry in `CONN-PV-001`. Other providers retain existing behavior.
- **Allowed boundary**: A stretched native card title button opens the usage popup without changing
  the current page. Content includes identity, capability description, live status/account,
  conversation enable switch, three examples, authorization/runtime recovery and collapsed setup
  guidance. Examples select this connector and prefill a new conversation without sending.
  Unconnected cards also open the popup; their primary action connects (or installs and connects).
  Each provider owns its examples and guidance. Credential and pasted-token actions transfer to
  the existing shared form dialog, then return to the popup with live connection state.
  The connected primary action opens a new conversation with empty text. Disable keeps the connection;
  disconnect still uses the existing confirmation and connector-removal flow.
- **Required shared seams**: `uiModal`, `uiButton`, `uiIconButton`, `uiSwitch`, `uiStatusPill`,
  `uiAccordion`, existing connector task selection and recovery APIs, icons, i18n and tokens.
  No new modal shell, keyboard trap, IPC channel or raw-control baseline increase.
- **Rationale**: The popup's connection lifecycle and examples are connector business content.
  Shared controls own their behavior; no new shared component contract is introduced.
- **Decision owner/date**: `@bonc-ai/reviewers` / `TBD`.
- **Review trigger**: Code-owner review or extension beyond the ten providers listed above.
- **Related PR/issue**: `TBD` (local implementation).

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


### `COG-PV-019` — 认知阅读与系统活动资产修改审批

- **Status**: Proposed（等待 reviewers 审批）
- **Scope**: 我的认知详情及系统活动的资产修改提议。
- **Boundary**: 外壳采用 `uiCard`，候选编辑字段采用 `uiField`；使用边界与提议字段用原生 `dl/dt/dd` 纵向呈现。资产修改审批直接投影现有 `asset-approvals`，不伪装为夜间提取候选，不放宽形成门槛。详情依次展示版本目标、拟更新字段、原值对比、提议依据和保存影响。操作调用已有版本重检审批服务。
- **Conversation integration (2026-10-16)**: `[proposal:id]` 复用共享 `uiButton`，只定位同一系统活动详情；缺失、读取失败时不回退其他项。引用与旧对话审批卡从既有读取 IPC 同步真实状态，不由模型声称结果；旧卡完整读取成功前禁用确认。没有新增审批外壳或叶子控件。
- **Required shared seams**: `uiCard`、`uiField`、`uiButton`、已有反馈与路由、i18n、设计 token。
- **Decision owner/date**: `@bonc-ai/reviewers` / TBD。
- **Review trigger**: 第二类业务需要相同的版本化修改审批布局时再评估共享审批详情组件。


### `COG-PV-020` — 认知资产设置卡片与夜间模型列表

- **Status**: Proposed（代码负责人审批待定）
- **Scope**: 夜间发现、自动确认、运行状态三卡及夜间模型折叠节。
- **Boundary**: 卡头继续采用左标题说明、右状态和操作的业务布局。模型折叠节默认只显示系统首个模型，自定义时显示保存的独立顺序；原生有序列表采用共享 `uiCard` 条目壳，图标、模型名与供应商分层，首选/备用状态靠右，排序移除使用共享图标按钮；最后一张添加卡复用相同壳、尺寸与间距，原生标题按钮以扩展点击区域覆盖卡片。点击打开共享中尺寸弹窗，按设置顺序列出已配置模型，已添加和停用项保留可读文本并移除选择按钮，右侧展示共享状态 pill，不使用整行灰底禁用按钮；弹窗正文底部保留完整留白。点选立即保存，失败保留弹窗供重试。列表、条目状态和异步保存是业务数据组合，不建立新的共享控件变体。列表与选择弹窗支持窄窗口换行；折叠态在重绘后保留。
- **Required shared seams**: `uiCard`、`uiStatusPill`、`uiProgressBar`、`settings-model-form__advanced`、`uiSwitch`、`uiButton`、`uiIconButton`、`uiModal`、`uiIconHtml`、i18n 和设计 token。弹窗焦点、Escape 和滚动锁由共享生命周期负责；页面仅在重绘移除原触发器后恢复至新的添加按钮。
- **Decision owner/date**: `@bonc-ai/reviewers` / TBD。
- **Layout refinement (2026-10-15)**: 展开后的模型卡与添加卡横向占满设置内容区，取消 720px 限宽；常规双行条目最小高度 56px、上下内边距 8px、条目间距 8px，长文本及窄窗口按内容增高。选择弹窗保持原有宽松间距。
- **Review trigger**: 第二个页面需要同一设置卡头或模型列表契约时评估共享化。
- **Related PR/issue**: TBD（本地实现）。


### `S4-PV-001` — 智能体 / 技能页平台分组、子视图、统一详情弹窗与外接选择器

- **Status**: Proposed（等待 reviewers 审批）
- **Scope**: 「智能体 / 技能 / 连接」页的智能体、技能两个 tab 与新建智能体弹窗（`agents.js`、`skills.js`、`catalog.js`、`local-agents.js`），specs/009-agent-skill-pages。
- **Boundary**: 首页分组复用现有 `agents-source-section` / `skills-source-section` 与 `agent-card` / `skill-card`：智能体页为主智能体 / 外接智能体 / 平台三组，技能页只有平台一组；平台组把已安装内容与目录中未安装的行合并，未安装卡片沿用同一张业务卡，只把主按钮换成安装。「我的智能体 / 我的技能」是同一网格的子视图，返回行用共享 `uiButton`（`catalog-subview-back` 只做行内排布），工具栏入口由 `uiButton` 渲染进 `catalog-toolbar-actions` 宿主，不新增原生按钮。详情弹窗按 `CONN-PV-003` 的写法与 `.connector-popup-*` 样式组合 `uiModal` lg，正文为简介、标签、示例（整行 `uiButton`）、会用到的技能（`uiStatusPill`），操作放 footer；与连接器弹窗不同，点示例直接发送。「已安装的智能体 / 技能」子视图（2026-10-20 改版）：工具栏同一行放返回（`catalog-installed-crumb`，`uiButton`）与状态筛选（`uiSegmentedControl`）和搜索，下方一行摘要，主体是一行三个的卡片网格（`catalog-installed-grid` / `catalog-installed-card`：头像 · 名称与 `uiStatusPill` 标记 · 两行说明 · 右上角启停 `uiSwitch` 与「⋯」`uiIconButton`），卸载与更新收在页面局部菜单 `catalog-row-menu`（与现有 `skill-row-menu` 同构），需要处理的行排前面；交互用 `data-catalog-row*` 委托；「我的技能」顶部说明条 `catalog-local-bar` 承载全局技能文件夹总开关（`uiSwitch`）；平台组上方的未登录 / 断网提示沿用 `marketplace-reconcile-banner` 配色，只加 `catalog-home-banner` 排布。停用 / 卸载被引用技能的确认用 `uiModal` + `ui-modal__list`。外接智能体选择器是新建弹窗专用的两列业务卡组合，用 `radiogroup` / `radio` 语义和 roving tabindex，支持方向键、Home / End、Enter / Space；字母头像与勾选图标复用现有 token 和 `uiIconHtml`，不抽成第二套通用单选控件。仅新增 `catalog-*` 与 `agent-ext-*` 排布类。
- **Required shared seams**: `uiModal`、`uiButton`、`uiSwitch`、`uiStatusPill`、`uiEmptyState`、`uiSegmentedControl`、`uiInput`、`uiConfirm`、现有安装 / 卸载 / 启停 / 使用流程、icons、i18n、设计 token。新增 IPC 仅 `skills.getGlobalRootsEnabled` / `skills.setGlobalRootsEnabled`（只读写偏好）；不新增 modal 外壳或原生控件基线。
- **Rationale**: 平台内容的安装、停用与示例是智能体 / 技能业务内容；与 `CONN-PV-003` 的弹窗版式相同、语义不同（安装 vs 连接，发送 vs 预填），两处稳定后可评估抽取共享「资源使用弹窗」。
- **Decision owner/date**: `@bonc-ai/reviewers` / TBD。
- **Review trigger**: 第三个页面需要同一使用弹窗，或连接器与本弹窗的行为契约收敛时。
- **Related PR/issue**: TBD（本地实现，分支 `feat/s4-agent-skill-pages`）。
