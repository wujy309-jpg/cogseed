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

## Implementation classification (2026-09-25)

- The expected sibling component-product checkout was absent, so its live checklist could not be read. This remains an evidence gap, not inferred approval.
- The current surface composes existing shared modal, form, decision, feedback, empty-state, card and grid APIs. It adds no shared-component API, raw control/modal shell, literal layer, or new page-local structural primitive.
- Component-gallery changes and a structural-registry proposal are therefore not applicable to this diff. Static real-page adoption coverage is in `test/renderer/hub-contributions-shared-ui.test.ts`; interactive Electron evidence remains separate.
