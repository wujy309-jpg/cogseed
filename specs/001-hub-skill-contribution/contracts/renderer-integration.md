# Phase 1 Contract: Renderer Integration

## Real-page surfaces

- Custom Skill cards: always-visible secondary “贡献” action beside “使用”, only for local custom Skills; icon or text-avatar fallback.
- Reusable login-required prompt: preserves a safe action context for contribution and My Contributions, resumes only after successful login.
- Contribution flow: terms gate, missing-data form, check progress/results, read-only final preview, declarations, replacement confirmation, submission progress/result.
- My Contributions: account-scoped stale-while-revalidate list, empty/loading/error/stale states, status/reason display, pending withdrawal, new-version entry, withdrawal request/history.

## Shared UI contract

Use existing shared controls for every leaf action/control and established overlays. Required seams include `uiButton`, `uiIconButton`, `uiCheckbox`, `uiField`, `uiInput`, `uiTextarea`, `uiSelect`, `uiProgressBar`, `uiStatusPill`, `uiAlert`, `uiConfirm`, `uiModal`/`uiModalController`, `uiDrawer`/`uiDrawerController`, `uiResourceCard`/`uiResourceGrid`, `uiTabs`, and `uiIconHtml`/`hydrateUiIcons` as semantically appropriate.

- Do not write raw button/form/checkbox controls, page-local toast/confirm/modal shells, emoji/inline-SVG icons, literal z-indexes, or duplicate focus traps.
- Contribution-specific wizard sequencing, file-tree/content preview, and contribution-card data/state may be business-owned composition. If no existing structural seam fits, add a `Proposed` record to `docs/renderer-structural-registry.md` before implementation and treat approval as a gate.
- Do not increase `shared-ui-adoption-guard` baselines.
- Put all visible strings in renderer/main locale files and re-render dynamic surfaces on `i18n-change`.
- All input action shortcuts ignore IME composition. Long-running checks/uploads expose progress and cancellation; destructive actions return focus after confirmation.

## Integration coverage

Real-page tests must cover logged-out resume/cancel, terms closed, missing data, blocked/unavailable checks, preview invalidation, replacement confirmation, upload cancel/retry/result, stale/offline account-isolated list, empty/error/loading states, new-version validation, pending withdrawal, withdrawal request refusal/history, icons present/absent/load-failed, keyboard/focus and constrained width.

Before implementation acceptance, locate and read the live component-product checklist (expected sibling was unavailable during planning), classify any contract changes, exercise component gallery states where shared behavior changes, then run Electron verification on both affected real pages.

## Implementation classification (updated 2026-09-29, shared-card correction)

- Rechecked on 2026-09-29: the sibling component-product checkout is available and the live UX work-package README plus `CogSeed_首版组件与预览页产品清单_v0.1_Draft.md` were read. The ResourceCard correction below is recorded as an explicit Draft contract delta rather than inferred from source code.
- User review exposed that My Contributions reused only the card shell: semantic status and multiple actions were inserted into `bodyHtml`, the real footer stayed empty, and standard padding/layout existed only in gallery CSS. The authorized correction extends `uiResourceCard` with semantic status and shared multi-action footer support, omits an empty footer, and moves standard card layout into production component CSS. The live product Draft was updated with this explicit ResourceCard delta.
- The contribution surface now composes existing shared modal, form/checkbox, decision, feedback, skeleton, status, data-table, accordion, empty-state, card and grid APIs. Server-provided contribution terms render through the canonical `renderMarkdown` seam. Contribution sequencing and read-only file content remain business-owned composition.
- The page-local contribution action-group CSS was removed, so no structural-registry proposal is needed. Component-gallery coverage now includes the multi-action semantic-status state; static real-page adoption coverage remains in `test/renderer/hub-contributions-shared-ui.test.ts`, and interactive Electron evidence remains separate.

## Implementation classification (updated 2026-10-02, full-page rework)

This section supersedes the 2026-09-29 statements above that the surface is a modal sequence and that no structural-registry proposal is needed. It does not change any `contribution.*` IPC channel, payload or main-process behavior.

- **Shape.** Appearance and structure now follow `prototype/prototype.html`: the contribution flow is a page with four stages (complete details → local checks → preview and declarations → submit) and a step indicator, and My Contributions is a page with a summary strip, status filter, search and a list/detail layout. Both are same-level views of the Skills page, hosted next to `skills-grid-view` and `skills-detail-view` and toggled the same way. Fields and behavior stay as defined by `spec.md` and the Hub contract.
- **Structural registry.** `docs/renderer-structural-registry.md` holds three **Proposed** records, none approved: `HUBC-PV-001` (page shell and step indicator), `HUBC-PV-002` (preview file list + read-only content) and `HUBC-PV-003` (My Contributions summary and list/detail layout). Approval by `@bonc-ai/reviewers` is still outstanding; the implementation ships under those proposals and stays inside the boundary written there.
- **Shared seams.** Every leaf control, form field, status, empty/loading state, decision, toast and overlay comes from the existing shared APIs. No shared component or shared behavior changed, so component-gallery coverage is **not applicable** for this change. `shared-ui-adoption-guard` baselines are unchanged and the new modules add zero raw controls.
- **Deliberate differences from the prototype** (spec/contract wins over the prototype for fields and behavior):
  - The security declaration keeps the six structured facts (network access + allowed domains, local file access, commands and external tools + tool names, sensitive data); the prototype's three-field version and its "purpose and boundary" text are not implemented.
  - Choosing "derived from Hub content" asks for the Hub content ID and source version (C-FR-006); a forked copy keeps them locked and read-only.
  - The Community Contribution Terms link opens the Hub terms in a shared modal (C-FR-007) instead of a new window.
  - Local checks make one `contribution.recheck` call, so progress is indeterminate while it runs. The check rows (local checks, ruleset, deep scan, instruction audit, declaration check) are filled in from the returned `admission` together with the engine, ruleset and ontology versions (C-FR-003c). Rows for checks that did not run read "not run", never "passed".
  - Submission stays unavailable until origin, terms and maintenance are given, and the page names what is missing (C-FR-005).
- **Pure view model.** `hub-contributions-model.js` derives check rows, admission classification, history statistics, filters and detail actions without DOM, i18n or IPC, with a guarded CommonJS bridge for tests.
- **Evidence status.** Source-level and page-flow tests drive the real page module through a minimal DOM; they are not a browser or Electron run.

### Real-Electron check (2026-10-02)

Run in a source `cogseed` runtime on macOS, driven through Chromium's local debugging port, with screenshots read back.

- **Real Hub data: not covered.** The Hub address was unreachable (connection refused), so terms fetch and `contribution.start/recheck/submit` never ran for real. In the real app the terms gate correctly stopped the flow ("could not load the current terms") and My Contributions showed the stale-data notice with an empty cache.
- **Covered with substituted data.** The real module source was executed in the real renderer against fixture answers for `contribution.*`; styles, shared components and DOM were real. Checked: four stages, check results (blocked and unavailable shown differently), preview two-pane, declarations gating with the "still needed" line, the terms modal, and My Contributions with data (summary, status filter, search, list/detail, per-status actions).
- **Final submission was not exercised.** The fixture made `contribution.submit` fail loudly if called; it was never called.
- **Defects found only in the real app, fixed:** panels had no spacing (`hubc-stage` was not a flex column); a long file path lost its icon and ellipsis; the terms link showed a doubled "v" (Hub terms versions already carry the prefix); checkbox rows were misaligned; selecting a list row dropped keyboard focus. The terms-link copy fix was only confirmed in the repository; the running app had loaded the old copy.
- **Still not done:** narrow-width layout, Tab order, the terms-link wording in a restarted app, and a run against a reachable Hub (including My Contributions with real records and the stale/offline path with data).
