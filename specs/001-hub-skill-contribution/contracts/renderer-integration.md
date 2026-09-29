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
