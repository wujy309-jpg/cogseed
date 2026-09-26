# Tasks: Hub Skill Contribution Client

**Input**: `spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`

**Tests**: Required by the specification and repository workflow. Contract and protection tests precede implementation.

## Phase 1: Setup and Evidence Baseline

**Purpose**: Freeze the implementation evidence boundary without importing stale branch history.

- [X] T001 Record client `623b198f` and read-only Hub `34421be` authority provenance and current/unfrozen contract gates in `specs/001-hub-skill-contribution/contracts/client-hub-interface.md`
- [X] T002 [P] Add Hub C00-C05/OpenAPI accepted and rejected response fixtures without `components[]` or catalog icon fields in `test/fixtures/hub-contributions/`
- [X] T003 [P] Inventory iteration-one `forked_from`, community attribution, disable/restore and update-policy seams in `specs/001-hub-skill-contribution/research.md`
- [X] T004 [P] Classify Renderer work against the live component product contract and `docs/renderer-structural-registry.md`, recording any unresolved structural proposal in `specs/001-hub-skill-contribution/contracts/renderer-integration.md`

---

## Phase 2: Foundational Domain and IPC

**Purpose**: Shared privacy, state, transport, storage and bridge foundations required by all stories.

- [X] T005 Add domain-boundary validation tests for draft/completion, preview/package, local admission, Hub receipts, account cache, withdrawal intent and terms snapshots across `test/main/features/contribution/`, `test/main/ipc/contribution.test.ts` and `test/fixtures/hub-contributions/`
- [X] T006 [P] Add failing Hub adapter contract tests for headers, top-level envelopes, error redaction, unknown shapes and all six capability routes in `test/main/features/hub_contributions/hub-client.test.ts`
- [X] T007 [P] Add failing account-partition/cache/retry persistence tests proving no token or cross-account data persistence in `test/main/features/hub_contributions/store.test.ts`
- [X] T008 Implement strict domain validation at the owning boundaries: UUID-v4 generation in store/submission orchestration, normalized package-relative paths in staging/preview, five-status behavior in store/Renderer, and withdrawal reason `1–2000` in IPC under `src/main/features/contribution/` and `src/main/ipc/contribution.ts`
- [X] T009 Implement userId-first contribution path resolvers and atomic machine-private storage for account-partitioned cache, stable local Skill IDs and retry receipts in `src/main/paths.ts` and `src/main/features/hub_contributions/store.ts`
- [X] T010 Implement current C00-C05 Hub adapter using existing Hub account session/base URL, safe errors, timeouts and no target-contract fields in `src/main/features/hub_contributions/hub-client.ts`
- [X] T011 Implement orchestration cancellation/account-change cleanup and privacy-safe logging in `src/main/features/hub_contributions/service.ts`
- [X] T012 Add validation-only contribution IPC handlers and registration in `src/main/ipc/hub-contributions.ts` and `src/main/ipc/index.ts`
- [X] T013 Expose only the canonical `window.cogseed.invoke` allow-list channels and safe push prefixes, keeping `src/main/preload.js` classic JavaScript, in `src/main/preload.js`
- [X] T014 Add cross-layer IPC tests for invalid payloads, account scoping, cancellation and renderer-safe errors in `test/main/ipc/hub-contributions.test.ts`

**Checkpoint**: No file body, token or transport implementation is renderer-accessible; current Hub calls are fixture-covered and target fields remain gated.

---

## Phase 3: User Story 1 — Start Contribution and Pass Local Checks (P1) 🎯 MVP

**Goal**: A user can start from a custom Skill, pass login/terms gates, build an isolated final copy and receive fail-closed local results before any package upload.

**Independent Test**: Logged-in/out custom cards, closed terms, compliant/blocked/unavailable fixtures, progress/cancel and zero upload before pass all behave per US1.

- [X] T015 [P] [US1] Add failing package staging tests for path traversal, absolute paths, case collisions, symlinks, 8 MiB/200-file/10 MiB limits, cleanup and concurrent source edits in `test/main/features/hub_contributions/staging.test.ts`
- [X] T016 [P] [US1] Add failing check-coordinator fixtures for ruleset `1.0.0`, skill-sentry `2.1.0`, declaration engine `1.3.0`, ontology `1.1.1`, missing/version-mismatch/timeout/indeterminate states and privacy-safe summaries in `test/main/features/hub_contributions/checks.test.ts`
- [X] T017 [P] [US1] Add real-page Renderer tests for card eligibility, reusable login continuation/cancel, terms closed, icons/fallbacks and check progress/cancel in `test/renderer/hub-contributions-flow.test.ts`, `test/renderer/hub-contributions-shared-ui.test.ts` and `test/renderer/lazy-features.test.ts`
- [X] T018 [US1] Implement immutable per-attempt staging copy, normalized file inventory, deterministic ZIP and cleanup under current `<uid>/local/` in `src/main/features/hub_contributions/staging.ts`
- [X] T019 [US1] Implement fail-closed check coordination through existing package/quality/guardrail runners without direct builtin execution in `src/main/features/hub_contributions/checks.ts`
- [X] T020 [US1] Bind check receipts to snapshot fingerprints and invalidate on any staged-file or metadata change in `src/main/features/hub_contributions/service.ts`
- [X] T021 [US1] Add contribution entry and icon/text-avatar fallback only to custom Skill cards using shared actions/icons in `src/renderer/modules/skills.js` and `src/renderer/modules/skills-bindings.js`
- [X] T022 [US1] Implement reusable login-required continuation and terms gate using shared modal/alert/button APIs in `src/renderer/modules/hub-contributions.js`
- [X] T023 [US1] Add shared-control contribution progress, cancellation, blocking/warning/unavailable results and recovery states in `src/renderer/modules/hub-contributions.js`
- [X] T024 [US1] Register the classic script and page hosts without page-local prohibited structure in `src/renderer/index.html`
- [X] T025 [US1] Add Chinese and English entry/login/terms/check/progress/error strings in `src/renderer/locales/zh-CN.json` and `src/renderer/locales/en.json`

**Checkpoint**: US1 is independently usable through local checks, with no package bytes sent.

---

## Phase 4: User Story 2 — Supplement, Preview and Submit (P1)

**Goal**: The contributor supplements a temporary final copy, confirms exact read-only bytes and declarations, and submits idempotently.

**Independent Test**: Missing/conflicting data, every declaration, binary/long preview, drift, replacement and ten disrupted retries prove one exact Hub submission.

- [X] T026 [P] [US2] Add failing final-copy/preview equality tests for supplementation, original immutability, binary/long text, icon as ordinary ZIP entry, metadata conflicts and digest drift in `test/main/features/hub_contributions/snapshot.test.ts`
- [X] T027 [P] [US2] Add failing submission tests for multipart order, exact manifest whitelist, idempotent replay/conflict, replacement, 4xx arrived rejection, 5xx/timeout uncertainty and same-key retry in `test/main/features/hub_contributions/submission.test.ts`
- [X] T028 [P] [US2] Add Renderer integration tests for missing-data fields, immutable facts, read-only preview, three declarations, replacement confirmation, upload progress/cancel and result states in `test/renderer/hub-contributions-flow.test.ts` and `test/renderer/hub-contributions-shared-ui.test.ts`
- [X] T029 [US2] Implement staging-only name/description/version/security-declaration supplementation and conflict reporting without changing the original Skill in `src/main/features/hub_contributions/staging.ts`
- [X] T030 [US2] Implement exact snapshot file list, ZIP digest, metadata/declaration fingerprint and safe paged file reads in `src/main/features/hub_contributions/snapshot.ts`
- [X] T031 [US2] Implement preview confirmation, final preflight drift check, UUID-v4 key lifecycle, replacement acknowledgement and delivery-state classification in `src/main/features/hub_contributions/service.ts`
- [X] T032 [US2] Implement current C02 fixed-order multipart submission without `manifest.components[]` or any separate icon part in `src/main/features/hub_contributions/hub-client.ts`
- [X] T033 [US2] Implement shared form controls, read-only file preview, origin/terms/maintenance declarations, replacement confirmation and upload recovery in `src/renderer/modules/hub-contributions.js`
- [X] T034 [US2] Add Chinese and English supplementation/preview/declaration/retry/replacement strings in `src/renderer/locales/zh-CN.json` and `src/renderer/locales/en.json`
- [X] T035 [US2] Prove preview-to-upload file and metadata equality plus ten-retry single-submission behavior with sanitized evidence in `test/main/features/hub_contributions/submission.test.ts`

**Checkpoint**: US1 and US2 form a complete P1 contribution path against current contract fixtures.

---

## Phase 5: User Story 3 — My Contributions and Pending Withdrawal (P2)

**Goal**: Current-account contributions remain visible online/offline, refresh incrementally and allow pre-review withdrawal.

**Independent Test**: Two accounts, offline cache, all five statuses/reasons, incremental merge and idempotent pending withdrawal show no cross-account data.

- [X] T036 [P] [US3] Add failing sync/cache tests for full load, `updated_since`, merge by `entry_id`, stale timestamp, size cap, schema discard and account switch in `test/main/features/hub_contributions/mine.test.ts`
- [X] T037 [P] [US3] Add Renderer tests for My Contributions login, empty/stale-offline states, status/reasons, foreground/manual refresh wiring and pending withdrawal in `test/renderer/hub-contributions-flow.test.ts` and `test/renderer/hub-contributions-shared-ui.test.ts`
- [X] T038 [US3] Implement account-partitioned C04 full/incremental sync, foreground refresh inputs and stale cache fallback in `src/main/features/hub_contributions/mine.ts`
- [X] T039 [US3] Implement idempotent C02 pending-submission withdrawal and safe status refresh in `src/main/features/hub_contributions/service.ts`
- [X] T040 [US3] Integrate My Contributions navigation/list/status/reason/refresh/withdrawal with shared page, card, status, confirm and feedback APIs in `src/renderer/modules/hub-contributions.js` and `src/renderer/modules/marketplace.js`
- [X] T041 [US3] Add Chinese and English My Contributions/status/offline/withdrawal strings in `src/renderer/locales/zh-CN.json` and `src/renderer/locales/en.json`

---

## Phase 6: User Story 4 — Submit a New Version (P2)

**Goal**: A contributor submits a higher version for owned published, disabled or withdrawn community content while preserving identity and provenance.

**Independent Test**: Higher/equal/lower versions, immutable stable ID, derived origin, missing local source selection and disabled-content notice behave per US4.

- [X] T042 [P] [US4] Add failing new-version tests for immutable target ID, SemVer monotonicity, origin prefill, preserved `forked_from`, replacement and missing local source in `test/main/features/hub_contributions/new-version.test.ts`
- [X] T043 [P] [US4] Add Renderer tests for new-version source selection, version errors and disabled/withdrawn recovery notice in `test/renderer/hub-contributions-flow.test.ts`, with SemVer error coverage in `test/main/features/contribution/version.test.ts`
- [X] T044 [US4] Complete or reuse canonical iteration-one `forked_from`, community source and disabled/update seams without adding contribution-local duplicates in `src/main/features/marketplace.ts`, `src/main/features/marketplace/fork-to-custom.ts` and `src/main/features/marketplace-update-policy.ts`
- [X] T045 [US4] Implement new-version draft initialization from C04 with immutable target ID, current-version precheck and origin prefill in `src/main/features/hub_contributions/service.ts`
- [X] T046 [US4] Add new-version selection/validation/recovery UI using shared controls and localized copy in `src/renderer/modules/hub-contributions.js`, `src/renderer/locales/zh-CN.json` and `src/renderer/locales/en.json`

---

## Phase 7: User Story 5 — Request Published-Content Withdrawal (P2)

**Goal**: A contributor requests content-level governance withdrawal, sees disposition/history and never receives a version-level withdrawal action.

**Independent Test**: Valid/invalid reason, non-contributor, unpublished content, duplicate pending, rejected reason and no `version` field/action satisfy US5.

- [X] T047 [P] [US5] Add C05 tests for reason `1–2000`, exact `{content_id, reason}` request whitelist/no version, authority errors, history routes and dispositions across `test/main/ipc/contribution.test.ts`, `test/main/features/contribution/hub-client.test.ts` and authority fixtures
- [X] T048 [P] [US5] Add Renderer tests for governance notice, shared confirmation, pending/rejected/withdrawn presentation and absence of version-level action in `test/renderer/hub-contributions-flow.test.ts`
- [X] T049 [US5] Implement C05 create/history orchestration and C04 disposition reconciliation in `src/main/features/hub_contributions/withdrawal.ts` and `src/main/features/hub_contributions/mine.ts`
- [X] T050 [US5] Add content-level withdrawal flow with shared form/confirm/status/feedback APIs and localized copy in `src/renderer/modules/hub-contributions.js`, `src/renderer/locales/zh-CN.json` and `src/renderer/locales/en.json`

---

## Phase 8: Polish, Gates and Real Environment

**Purpose**: Cross-story privacy, contract, Renderer and runtime evidence.

- [X] T051 [P] Add log/telemetry privacy tests proving no package body, file content, terms body, token, local path or raw finding in `test/main/features/hub_contributions/privacy.test.ts`
- [X] T052 [P] Add current-versus-target freeze guards proving no outbound `components[]` and no catalog icon route/field in `test/main/features/hub_contributions/freeze-gates.test.ts`
- [X] T053 [P] Add shared-UI adoption and real-page structural coverage without raising baselines in `test/renderer/shared-ui-adoption-guard.test.ts` and `test/renderer/hub-contributions-shared-ui.test.ts`
- [X] T054 Update component gallery only for an approved shared login-required behavior and its default/focus/disabled/loading/error/narrow states in `src/renderer/component-gallery.js` and related gallery tests; otherwise record not applicable in `specs/001-hub-skill-contribution/contracts/renderer-integration.md`
- [X] T055 Run focused contribution/Renderer tests under `test/main/features/hub_contributions/`, `test/main/ipc/hub-contributions.test.ts` and `test/renderer/hub-contribution*.test.ts` using repository test entry points and fix in-scope failures
- [X] T056 Run `npm run typecheck`, `npm test` and `git diff --check`, fixing in-scope failures without weakening gates; exact unrelated full-suite failures are retained in `quickstart.md`
- [ ] T057 Run `scripts/restart-cogseed.sh`, inspect launcher/runtime logs, and verify normal/error/recovery flows in real Electron on macOS — startup and logs verified with the current worktree's real Electron process; automated UI interaction remains blocked because macOS Computer Use permissions are not granted
- [X] T058 Record Windows as passed only with real platform evidence; otherwise leave it explicitly unverified in `specs/001-hub-skill-contribution/quickstart.md`
- [X] T059 Recheck all extension hooks, Hub read-only boundary, task completion, blocked target-contract items and final diff before handoff in `specs/001-hub-skill-contribution/tasks.md`

---

## Deferred Contract Gates (Not Current Implementation Tasks)

- `manifest.components[]`: blocked until Hub authority/OpenAPI/implementation synchronize and client/Hub jointly freeze `{ component, version, status, verdict }`.
- `list[].icon` and `GET /marketplace/skills/{contentId}/icon`: blocked until Hub authority/OpenAPI/implementation synchronize the decided object/resource/ETag behavior.
- These blockers do not block T001–T059. Current code must prove these fields/routes are absent.

## Dependencies and Execution Order

- Phase 1 establishes evidence and fixtures.
- Phase 2 blocks every user story.
- US1 blocks US2 because submission requires a passed final-copy receipt.
- US3 depends only on Phase 2 and can be validated independently.
- US4 depends on Phase 2 plus iteration-one lifecycle seams and reuses US2 submission.
- US5 depends on Phase 2 and C04 sync but is otherwise independently testable.
- Phase 8 follows all implemented stories.

## Requirement Traceability

- **US1 / C-FR-001–003d / C-FR-007 / C-FR-041**: T015–T025, T051, T053, T055–T057.
- **US2 / C-FR-004–012a / C-FR-040–042**: T026–T035, T051–T057.
- **US3 / C-FR-018–018b / C-FR-025**: T036–T041, T051, T053, T055–T057.
- **US4 / C-FR-006 / C-FR-019–019b / C-FR-030–031**: T003, T042–T046, T055–T058.
- **US5 / C-FR-022–024a / C-FR-030**: T047–T050, T055–T058.
- **C-FR-002–002a and cross-story server refusals**: T002, T006, T010, T014, T027, T035, T047.
- **C-SC-001–010**: T015–T017, T026–T028, T035–T037, T042–T043, T047–T048, T051–T058.

## Parallel Opportunities

- Fixture, store and adapter tests T002/T003/T004 and T005/T006/T007 are file-independent.
- Within each story, main-process and Renderer failing tests marked `[P]` can be written together before implementation.
- US3 and iteration-one audit work for US4 can proceed after the foundation while US1/US2 implementation continues.

## Implementation Strategy

1. Establish contract fixtures and privacy-safe foundations.
2. Deliver US1 local-only checks as the independent MVP.
3. Add exact preview/submission (US2), then account-isolated visibility (US3).
4. Reuse verified iteration-one lifecycle seams for US4; do not backport branch history wholesale.
5. Add governed withdrawal (US5), then full gates and real Electron evidence.

All completed tasks must be marked `[X]`. A file's existence alone is not completion; the named test/evidence must pass. Current integration evidence, contract acceptance and release remain distinct.

## Converge audit — 2026-09-25

The implementation reuses the established `features/contribution` and `ipc/contribution.ts` seams rather than creating the planning-time `hub_contributions` path aliases. Implemented coverage includes isolated staging, fail-closed local admission, exact preview/ZIP capture, same-key uncertain-delivery retry, current C00-C05 transport, account-partitioned My Contributions cache, pending withdrawal, new-version targeting, published-content withdrawal, custom-card entry, shared Renderer composition, bilingual copy, and explicit components/icon freeze guards.

Passing final focused evidence: 19 files / 175 tests for contribution, IPC, Renderer and reused lifecycle seams; 10 dynamic real-page flow tests plus 6 shared-UI tests; TypeScript compilation, locale parsing, resource tests (308), and `git diff --check`. Full JS evidence is 1126 passed files / 13002 passed tests with three unrelated pre-existing failures retained in `quickstart.md`.

Unique external blockers: live Hub integration and joint freeze require a jointly frozen contract plus an authorized reachable integration environment. The source run correctly fell back to `localhost:3000`; the authority snapshot contains only local example servers, while the separately configured shared-origin candidate failed DNS resolution, so no replacement endpoint was guessed. `manifest.components[]` and catalog icon fields/resource remain deferred until Hub authority is updated. Real macOS Electron startup/logging is verified, while automated UI interaction is blocked by missing macOS Computer Use permissions. Windows requires a real Windows environment. No blocked field, endpoint, status or error code was guessed.

## Phase 9: Convergence

- [X] T060 Add IPC orchestration tests for invalid payloads, account scoping, replacement acknowledgement, upload abort and renderer-safe errors per C-FR-002/C-FR-011/C-FR-012 and Constitution V (partial)
- [X] T061 Bound and validate the account-partitioned My Contributions cache, discarding malformed rows and limiting retained entries while preserving incremental merge semantics per C-FR-018/C-FR-018a and plan: storage decision (partial)
- [X] T062 Add real-page DOM integration tests for login continuation, declaration supplementation, check/upload cancellation, replacement confirmation and foreground refresh per US1/AC2, US2 and Constitution IV/V
- [X] T063 Expand current-authority contract fixtures for all six routes and representative declared 4xx envelopes without target-only components/icon fields per C-FR-002a and plan: contract evidence (partial)
- [X] T064 Re-run focused tests, typecheck, full repository tests, resource tests, diff checks and macOS Electron restart attempt; retain exact external/unrelated failure evidence per C-SC-001–010 and Constitution V
