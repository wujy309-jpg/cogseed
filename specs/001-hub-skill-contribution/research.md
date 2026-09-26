# Phase 0 Research: Hub Skill Contribution Client

**Date**: 2026-09-25

**Client baseline**: `623b198f5ecb00cff19b26c7c5cab1c68dc2c710`

**Hub authority snapshot**: `cogseed-hub` `origin/codex/hub-open1-governance@34421be279d960e70e568031364d092dbc28ad73`

## Evidence boundary

- The Hub repository was read without switching or modifying its checkout, via `git show origin/codex/hub-open1-governance:<path>`.
- Authority order is C00-C06, then the 2026-09-24 handoff, then the implementation-status note, then OpenAPI 3.1. The latter two describe implemented behavior and do not freeze the contract.
- The Hub implementation-status note supersedes the handoff's stale pause statement: the six upload-direction capabilities are implemented and available for integration, but cross-repository contract freeze is still incomplete.
- The decided target shapes for `manifest.components[]` and `list[].icon` supplied for this planning round are decisions awaiting synchronization into Hub authority. They are not represented as current Hub capability or used to generate current calls.
- The expected sibling component-product repository `../cogseed-product` was not present. The Renderer implementation must re-locate and read the live product checklist before component work; this does not block planning.

## R-01: Integration boundary

**Decision**: Add a user-scoped `features/hub_contributions/` workflow behind narrow IPC handlers and the existing `window.cogseed.invoke` bridge. Reuse the existing Hub account session and API-base mechanisms; do not add a server, port, renderer network call, or authentication layer.

**Rationale**: This preserves the Electron main/renderer boundary and keeps tokens out of Renderer. Contribution orchestration includes private files, account context, retries, and cache isolation, so it belongs in `features/`, not IPC or Renderer.

**Alternatives considered**:

- Renderer `fetch`: rejected because it exposes transport/auth concerns and bypasses the canonical bridge.
- New local HTTP service: constitution violation.
- Extending marketplace functions directly: rejected because contribution submission has a separate state machine and privacy boundary; it may reuse marketplace parsers/install semantics without making catalog code own uploads.

## R-02: Final-copy integrity and local checks

**Decision**: Build an immutable, per-attempt staging copy under the current user's machine-private local domain. Normalize and supplement that copy, run all required checks against it, compute the file manifest and ZIP digest from it, then bind the preview confirmation and idempotency key to the resulting snapshot fingerprint. Any file or metadata change invalidates the preview and check receipt.

**Rationale**: C-FR-003/004/012 require the checked, previewed, and transmitted bytes to be identical without silently modifying the user's original Skill. A content-addressed receipt makes time-of-check/time-of-use drift detectable.

**Alternatives considered**:

- Upload directly from the source directory: rejected due to concurrent edits and preview drift.
- Patch only the multipart manifest: rejected because name/description/security declaration must be package facts.
- Reuse an old check after edits: explicitly prohibited.

## R-03: Check orchestration

**Decision**: Add one contribution-check coordinator that calls existing package/shape/path rules and the approved guardrail runners. It records separate results and actual versions for ruleset `1.0.0`, `skill-sentry` `2.1.0`, and `declaration-core` engine `1.3.0`; declaration ontology remains `cogseed.security.skill@1.1.1`. Missing, mismatched, timed-out, corrupt, or indeterminate checks fail closed. Full findings stay local; only contract-safe summaries may leave the machine.

**Rationale**: A security scan is not a declaration check, and the declaration engine version is not the ontology version. Existing runners and path/storage choke points must remain authoritative.

**Alternatives considered**:

- Treat `blocking: []` as proof of completed checks: rejected.
- Add model-based sensitive-content classification: rejected; the spec selects deterministic rules and human review.
- Invoke bundled skill scripts directly: rejected; execution must use the established runner.

## R-04: Current Hub API and freeze strategy

**Decision**: Implement current calls only from a vendored, reviewed client contract derived after the joint freeze. Until then, use the traceability matrix in `contracts/client-hub-interface.md` as a gate: six capabilities may be integration-tested against the current Hub implementation, but schema changes remain behind parsers/adapters and contract fixtures.

**Rationale**: `components[]` and catalog icon projection/resource are not implemented, while icon thresholds and several white-list/error details remain unfrozen. “Available for integration” does not mean “accepted contract.”

**Alternatives considered**:

- Generate a client from current OpenAPI: rejected because it would canonize implementation status and omit decided-but-unsynchronized fields.
- Guess missing endpoints/fields: prohibited.

## R-05: Idempotency and replacement

**Decision**: Generate UUID-v4 `Idempotency-Key` only after a confirmed preview. Persist it with the snapshot fingerprint and reuse it for transport failure/timeout/5xx retries; a changed snapshot creates a new key. Treat `code:0` (including replay) as arrived, 4xx as arrived-but-rejected, and connectivity/timeout/5xx as not confirmed and retryable with the same key. Show replacement confirmation before submitting when the account-scoped pending index indicates replacement.

**Rationale**: This matches C02's permanent `(account, key)` scope and avoids duplicate pending submissions.

**Alternatives considered**:

- New key per HTTP attempt: duplicates submissions.
- Automatic retry of 4xx: conflicts with Hub's non-retryable contract.

## R-06: Account-isolated cache

**Decision**: Store contribution list cache, sync cursor, local-skill stable IDs, pending retry receipts, and transient staging references under `<uid>/local/`; key account-visible records by a one-way account partition identifier without storing access tokens. Clear in-memory state and abort active work on account change/logout. Hub remains authoritative; cached list data is stale-marked and replaced on account switch.

**Rationale**: C-FR-018 requires offline display and strict account isolation. Machine-private transport/retry state is not syncable cloud content.

**Alternatives considered**:

- One cache per device user without account partition: risks cross-account display.
- Cloud-sync pending uploads or tokens: privacy and replay risk.

## R-07: My Contributions synchronization

**Decision**: Full-load on first entry, missing cache, account switch, or stale cursor; otherwise use `updated_since=generated_at`, merge by `entry_id`, and poll only while the page is foregrounded. Retain the last successful snapshot with sync time and expose manual refresh. Read withdrawal status primarily from C04; use C05 GET only for history.

**Rationale**: Matches C04's aggregation and incremental semantics while satisfying stale-while-revalidate/offline behavior.

## R-08: Iteration-one dependency

**Decision**: Sequence prerequisite compatibility first: verify/complete `forked_from`, community attribution, content-level disabled behavior, update semantics, and official-vs-derived rules before enabling dependent contribution flows. Independent contribution preparation and API adapter work may proceed in parallel, but release gates for derived-origin prefill, disabled/withdrawn new versions, withdrawal aftermath, source badges, and icon catalog display stay closed until iteration-one contracts are proven.

**Rationale**: The client spec records these dependencies as absent or incomplete. Faking them inside the contribution feature would create a parallel marketplace model.

## R-09: Renderer composition

**Decision**: Compose existing shared APIs (`uiButton`, `uiIconButton`, `uiCheckbox`, `uiField`, `uiInput`, `uiTextarea`, `uiSelect`, `uiProgressBar`, `uiStatusPill`, `uiAlert`, `uiConfirm`, `uiModal`/controller, `uiDrawer`/controller, `uiResourceCard/Grid`, `uiTabs`, icons and tokens) on the real Skills/Marketplace pages. Treat contribution wizard content and read-only file preview as business-owned composition. If implementation needs a new reusable or page-local structural seam, update the product contract or add a `Proposed` structural-registry entry before using it; never raise the raw-control baseline.

**Rationale**: This is a page-specific composition unless evidence shows a second stable consumer. Login-required prompting should become a shared reusable behavior because both contribution entry and My Contributions need it.

## R-10: Icons and target contracts

**Decision**: For the current contribution upload, an optional icon remains a normal file in the final ZIP and file list; absence never blocks. Do not implement catalog `list[].icon` or icon GET calls from current authority. Plan an adapter for the decided target `icon = { url, sha256, size, content_type }`, omitted when absent, and `GET /marketplace/skills/{contentId}/icon` with ETag/304 and 404 for unpublished/absent icons, only after Hub authority synchronizes and joint freeze completes. Hub owns icon thresholds/strictness and ontology-version coordination.

**Rationale**: C06 currently contains a different candidate field/path shape and is explicitly unfrozen; the implementation-status note says catalog icon projection/resource is absent.

## R-11: No new dependency

**Decision**: Use repository facilities (`undici`, `adm-zip`, `yaml`, `zod`, `jimp`/existing WebP support, Node crypto/fs) and existing guardrails. No npm dependency is planned.

## Resolved unknowns and remaining external gates

All implementation-planning unknowns have a safe decision. The following are external freeze gates, not inferred clarifications:

1. Hub authority must incorporate and jointly freeze the decided `components[]` shape `{ component, version, status, verdict }` and its evaluated/verdict rule; current Hub has neither implementation nor final schema.
2. Hub authority must incorporate and jointly freeze the decided catalog icon object/resource behavior; current C06/OpenAPI/implementation differ or omit it.
3. Hub decides icon validation strictness/thresholds and publishes ontology pin changes to the client.
4. Exact manifest white list and final error mapping after the above changes require shared contract fixtures.
5. Terms §12.3/§12.4 must be completed before a real effective terms version can open submission.
6. The live component product checklist must be located before Renderer implementation acceptance.
