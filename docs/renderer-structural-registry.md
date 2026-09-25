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
| `PO-PV-001` | `personal-ontology.js` 三盒导航行竖排副标题（`personal-onto-nav-row-text is-stacked` / `personal-onto-nav-row-sub`，specs/009 Phase 5 T029/T032） | Proposed | 三盒 nav 行的文字位可保持页内「主标题 + 副标题」两行竖排组合（Phase 5 改变了 nav 行的结构组成，此前无 registry 条目可引用，故补登记）。nav 行本身是已冻结裸控件基线内的原生导航行（design-system 测试基线 5，`personal-onto-nav-row${active` 断言锁定）；竖排仅为排版修饰，**不新增任何叶子控件、不引入新交互**——动作走 `uiButton(...)`/`uiIconButton(...)`、图标走 `uiIconHtml(...)`、元数据与状态标记走 `uiTag(...)`/`uiStatusPill(...)`/`uiStatusDot(...)`（T040/T041 收敛后）；无 emoji/内联 SVG/字面 z-index（`shared-ui-adoption-guard` 实测均未上调）。 | `uiButton(...)` / `uiIconButton(...)`、`uiIconHtml(...)`（icons.js）、`uiTag(...)` / `uiStatusPill(...)` / `uiStatusDot(...)`（ui-status.js）、设计 token。 | `@bonc-ai/reviewers`, TBD | 第二个界面需要同一套「导航行主标题 + 副标题」稳定契约时，提案共享 `uiNavRow(...)`/`uiNavItem(...)`。 |

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
