# Implementation Plan: Hub Skill Contribution Client

**Branch**: `feat/iter2-client-contribution` (worktree detached at branch tip) | **Date**: 2026-09-25 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/001-hub-skill-contribution/spec.md`

**Planning baselines**: client `623b198f5ecb00cff19b26c7c5cab1c68dc2c710`; Hub authority `cogseed-hub` `origin/codex/hub-open1-governance@34421be279d960e70e568031364d092dbc28ad73`.

## Summary

Add a client-only, user-scoped contribution workflow for custom Skills: reusable login continuation and terms gating; immutable staging-copy supplementation, deterministic fail-closed checks and exact read-only preview; idempotent submission and replacement; account-isolated offline My Contributions; new versions, pending withdrawal, and governed published-content withdrawal. Main owns filesystem, checks, auth and Hub transport behind IPC; Renderer composes shared controls on real Skills/Marketplace pages.

The six Hub capabilities are implemented and may be integration-tested, but C00-C06 remain awaiting client/Hub joint freeze. Current calls must not include the unimplemented `components[]` or catalog icon projection/resource. Their decided target contracts remain explicit freeze gates rather than guessed implementation details.

## Technical Context

**Language/Version**: Electron 41; main TypeScript 6 / Node; renderer classic JavaScript, HTML and CSS; Python only through existing guardrail runners

**Primary Dependencies**: existing `undici`, `adm-zip`, `yaml`, `zod`, Node crypto/fs, current image support, Hub account feature, marketplace/skills parsing, path/storage helpers, ruleset `1.0.0`, `skill-sentry` `2.1.0`, `skill-declaration-core` engine `1.3.0`, ontology `cogseed.security.skill@1.1.1`; no new dependency

**Storage**: JSON/JSONL-like machine-private contribution cache, retry receipts, stable local-skill IDs and staging under active `<uid>/local/`; Hub remains authoritative; no SQLite addition

**Testing**: repository-managed Vitest/resource tests via `npm test`, `npm run typecheck`, contract fixtures, Renderer real-page integration, macOS/Windows platform evidence, restarted Electron verification

**Target Platform**: macOS and Windows desktop

**Project Type**: single-process Electron desktop app with main-process backend, vanilla Renderer and IPC-only communication

**Performance Goals**: complete a ready contribution in under five minutes; foreground contribution refresh within 60 seconds; visible progress and cancellation for checks/uploads; packages bounded by 8 MiB compressed, 200 files and 10 MiB expanded

**Constraints**: no HTTP server/port/new auth layer; no Renderer network/token/filesystem authority; no new npm dependency; exact checked-previewed-uploaded bytes; fail closed on incomplete checks; no sensitive logs/telemetry; account-isolated cache; no raw-control baseline increase
**Scale/Scope**: Skill only; two real page surfaces, one reusable login prompt, one contribution state machine, six current Hub capabilities plus two target-contract freeze gates; no Agent/template/feedback/rating/anonymous/version-level-withdrawal scope

## Constitution Check

*GATE: PASS before Phase 0. Re-checked after Phase 1: PASS, subject to the external contract and dependency gates below.*

| Principle | Design evidence | Gate |
|---|---|---|
| I. Desktop boundary | Main-only Hub transport and filesystem; `window.cogseed.invoke`; classic Renderer; no server/port/local auth | PASS |
| II. Layering/choke points | IPC validates/calls `features/hub_contributions`; storage/path helpers and approved guardrail runners remain choke points | PASS |
| III. User isolation/privacy | userId-first feature APIs; `<uid>/local/` state; account partition; no tokens/raw content in logs/telemetry | PASS |
| IV. Shared UI/i18n | `cogseed-component-change` workflow, shared controls/icons/tokens, locale files, real-page coverage, IME/progress rules | PASS |
| V. Evidence | contract/negative/recovery/concurrency/cross-layer tests, macOS/Windows evidence, Electron restart verification; acceptance separate from tests | PASS |
| Workflow/governance | Plan only; facts/proposals/decisions separated; current integration is not called freeze or release | PASS |
| AI addendum | deterministic rules, authority A2, no model decision; preview and confirmations are human gates | PASS |

### External gates preserved by design

- Joint freeze of C00-C06/OpenAPI and cross-repository fixtures is required before production transport is enabled.
- Iteration-one `forked_from`, community attribution, disable/restore and update semantics must pass before their dependent iteration-two scenarios are enabled.
- Target `components[]` and icon contracts require synchronized Hub authority before client serialization/calls.
- The live component-product checklist must be located before Renderer contract acceptance; `../cogseed-product` was unavailable during planning.

These are staged delivery gates, not constitution violations; no implementation is allowed to fill them with assumptions.

## Project Structure

### Documentation (this feature)

```text
specs/001-hub-skill-contribution/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── client-hub-interface.md
│   └── renderer-integration.md
├── spec.md
└── checklists/
```

No `tasks.md` is created by this Plan phase.

### Source Code (repository root)

```text
src/main/
├── features/
│   ├── hub_contributions/          # new orchestration, API adapter, staging, checks, cache, retries
│   ├── hub_account/                # reuse login/session/account-change events
│   ├── marketplace/                # reuse iteration-one catalog/update/disable seams; do not duplicate
│   ├── skills/                     # reuse custom-skill/fork/version parsing seams
│   └── security/                   # reuse declaration admission helpers
├── ipc/
│   └── hub-contributions.ts        # new narrow validation-only handlers
├── paths.ts / storage.ts           # add user-scoped path resolvers through existing choke points
└── preload.js                      # remains JS; canonical allow-list only if required

src/renderer/
├── modules/
│   ├── skills.js / skills-bindings.js   # custom-card contribution entry
│   ├── marketplace.js                   # My Contributions and iteration-one catalog integration
│   └── hub-contributions.js             # new page state/composition, classic script
├── index.html                           # register classic script / real page hosts
├── locales/{zh-CN,en}.json              # all visible copy
└── shared component/icon/token files     # extend only after product/registry classification

test/
├── main/features/hub_contributions/      # state, privacy, cache, retry, contract fixtures
├── main/ipc/                             # validation and renderer-safe results
├── renderer/                             # real-page/shared-UI/login/account-state coverage
└── fixtures/                             # accepted/rejected Hub shapes and Skill packages

docs/renderer-structural-registry.md       # only if new page-local structure is proposed
```

**Structure Decision**: A new contribution feature owns the workflow while existing account, Skill, marketplace, storage and guardrail modules remain authorities. Renderer integration is page-specific composition over shared APIs; no standalone frontend/backend service or parallel marketplace data model is introduced.

## Delivery Design

### 1. Freeze and compatibility lane

1. Convert Hub C00-C06/OpenAPI at the frozen Hub SHA into checked client fixtures without generating transport code from unfrozen fields.
2. Run bidirectional contract review for the six capabilities and all error/retry states.
3. Synchronize/freeze the decided target `components[]` and `list[].icon`/icon-resource contracts or record an explicit superseding joint decision.
4. Keep transport and target adapters separately gated so current integration never masquerades as final contract support.

### 2. Iteration-one prerequisite lane

Audit and complete the canonical marketplace seams for `forked_from`, community contributor attribution, content-level disabled/restore behavior, automatic update semantics, and derived-copy independence. Contribution code reads these facts; it does not add a second representation. Independent staging/check/API work can proceed while dependent UI actions remain gated.

### 3. Main-process contribution domain

- Add userId-first orchestration APIs and narrow IPC handlers.
- Resolve custom Skill sources in main, create private staging, normalize relative paths, supplement only the copy, build deterministic ZIP/file manifests and clean up on cancellation/failure.
- Coordinate existing package/quality/sentry/declaration checks; preserve independent actual versions/outcomes and bind receipts to the snapshot.
- Add Hub adapter for terms, submission, status, pending withdrawal, My Contributions and withdrawal requests, using the existing account token/base URL and structured errors.
- Persist stable local Skill UUIDs, account-partitioned stale cache and idempotent retry receipts in the machine-private domain.
- Abort and purge active state on account logout/switch; cap safe error results and redact logs/telemetry.

### 4. Renderer real-page integration

- On custom Skill cards, add the shared secondary action and icon/text fallback without affecting built-in/Hub-installed cards.
- Add a reusable login-required prompt that stores a validated action target, resumes once, and clears on cancel/failure/account mismatch.
- Compose the contribution flow with shared form/action/feedback/overlay/status/progress APIs; preview files read-only and never grants renderer paths.
- Add My Contributions with stale-while-revalidate, status/reason presentation, new-version selection, pending withdrawal and content-withdrawal flows.
- Treat wizard/file preview/list layout as business composition unless component review identifies a stable shared contract. Propose any missing structural seam in the registry before implementation.

### 5. Protection and observability

- Recalculate snapshot and outbound metadata immediately before submit.
- Only `code:0` proves arrival; 4xx is an arrived rejection; network/timeout/5xx remains unconfirmed and reuses the key.
- Emit only IDs, types, counts, durations and coarse error categories. Never emit package/file/terms text, raw findings, tokens, local paths or account details.
- Preserve Hub request ID for support without exposing transport secrets.

## Verification Strategy

1. **Contract**: positive/negative fixtures for every route, header, envelope, enum, unknown field, safe error detail, ETag, pagination/incremental merge, identity masking, idempotent replay/conflict and replacement.
2. **Privacy/integrity**: path/symlink/case/size bombs, forbidden content, declaration edge cases, concurrent edits, preview/ZIP equality, no upload before pass, redacted telemetry.
3. **Recovery/concurrency**: cancel/logout/account switch at each state, ten disrupted retries, simultaneous replacement, stale list refresh, Hub version race, cleanup after crash/restart.
4. **Renderer**: real Skills and Marketplace page coverage for all normal/loading/empty/blocked/unavailable/offline/destructive/recovery states; shared-component and raw-control guards; icons and narrow layout.
5. **Platform/runtime**: `npm run typecheck`, `npm test`, `git diff --check`, macOS and Windows platform-specific cases, `scripts/restart-cogseed.sh`, launcher/runtime log confirmation and actual Electron interaction. Unrun platform evidence is reported, never inferred.

## Hub Authority Gap Register

| Area | Current implemented/interface status | Decided target | Required action before implementation claim |
|---|---|---|---|
| Six contribution capabilities | Implemented and available for integration; authority still marks cross-end freeze pending | Preserve routes/semantics unless joint review changes them | Bidirectional fixtures and signed joint freeze |
| `manifest.components[]` | Not implemented; C03 has a different unfrozen candidate | optional array of `{component, version, status, verdict}`; validated if present; not admission input | Hub C00/C02/C03/OpenAPI update + implementation + fixtures |
| Catalog `list[].icon` | Not implemented; C06 candidate uses different names | `{url, sha256, size, content_type}`, omitted when absent | Hub catalog/OpenAPI update + backward-compat fixture |
| Icon resource | Not implemented; C06 candidate path differs | `GET /marketplace/skills/{contentId}/icon`, ETag/304, 404 absent/unpublished | Hub route implementation/security/cache contract + fixtures |
| Icon validation | Candidate Hub behavior exists; thresholds/strictness unfrozen | Hub decides strictness/thresholds | Hub publishes final rule; client consumes without inventing limits |
| Ontology upgrades | Current synchronized pin is 1.1.1 | Hub decides upgrade and notifies client pin sync | recorded cross-repo version-update procedure |
| Terms content | Interface implemented; no effective terms until placeholders are completed | effective version required for real submissions | Owner/Hub activates complete terms; client handles closed state |

## AI Product Implementation Addendum

### Model, data and tool boundaries

- Runtime/model/config versions and fallback behavior: no AI model is used. Deterministic checks use ruleset `1.0.0`, skill-sentry `2.1.0`, declaration engine `1.3.0`, ontology `1.1.1`; any missing/mismatch/unavailable/indeterminate result fails closed.
- Data source, retention, redaction and third-party boundaries: source is one selected custom Skill plus Hub account/terms/status facts. Staging and reports are local machine-private and cleaned after completion/cancel; offline cache is account-partitioned. Only confirmed snapshot bytes and contract metadata go to Hub.
- Tool permissions and maximum authority level: A2. Filesystem/guardrail work stays behind main-process path/storage/runner choke points; user confirms preview, declarations, replacement and withdrawal.
- Failure attribution categories: product (missing UI path), data (invalid/missing package facts), tool (checker unavailable), permission/auth, network, schema/contract, governance (terms/withdrawal), evidence (unfrozen), unknown.

### Evaluation contract

- Golden/representative set provenance: synthetic fixture packages plus repository guardrail/package fixtures and Hub contract samples at the recorded SHAs; no private production package enters shared evidence.
- Quality thresholds and protection surfaces: 100% block for specified local violations/incomplete checks; exact preview-to-upload equality; one pending submission after ten uncertain retries; zero cross-account cache rows; zero sensitive log/telemetry samples.
- Blocked/error handling: blocked, unavailable, indeterminate, cancelled and schema mismatch never count as pass.
- Human review sample and acceptance authority: client RD + Hub RD own contract freeze; `@bonc-ai/reviewers` owns structural decisions; product/Owner owns terms and any product-contract change. Passing tests do not imply acceptance.
- Runtime trace and evidence receipt location: repository test output and sanitized local development logs; Hub request IDs and fixture hashes only, never package contents.

### Rollback and change routing

- Reversible local rollback point: feature gate the contribution IPC/UI and discard its local cache/staging without changing installed Skills or existing marketplace behavior.
- A3/A4 independent approval and audit: not used; A4 disabled. Hub governance actions remain external and audited by Hub.
- Spec-changing findings return to spec; product-position findings return to Discovery.
- Learning produces a Change Candidate; it does not silently update rules, thresholds, schemas, ontology pins or permissions.

## Complexity Tracking

No constitution exception or new architectural layer is requested. The new feature module is the smallest boundary that prevents contribution-specific upload/state/privacy logic from entering IPC or existing catalog code.
