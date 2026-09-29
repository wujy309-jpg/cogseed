# Phase 1 Quickstart: Validation Guide

This guide defines validation evidence; it does not authorize implementation, Hub writes outside a test environment, or release.

## Prerequisites

1. Joint-frozen client/Hub contract snapshot and fixtures; do not substitute the current integration baseline for freeze.
2. Hub test environment with account service, one effective terms version, and two contributor accounts.
3. macOS and Windows clients with the same pinned ruleset, skill-sentry, declaration engine, and ontology.
4. Fixture Skills: clean; each package/path/size/forbidden-content failure; missing/invalid/conflicting declaration; no icon/valid icon/bad icon; derived `forked_from`; concurrent-edit; long text/binary; each check component unavailable/version-mismatched/indeterminate.
5. Confirm iteration-one dependencies (`forked_from`, disabled/update behavior, community attribution) or mark their scenarios blocked rather than simulating success.

## Static and unit gates

```bash
npm run typecheck
npm test
git diff --check
```

Use `npm test`, never direct Vitest. Add focused contract fixtures, feature tests, IPC boundary tests, Renderer real-page integration tests, storage/account-isolation tests, and guardrail failure/recovery tests before the full suite.

## Scenario A: privacy and final-copy identity

1. Start contribution from a custom Skill; confirm built-in and Hub-installed Skills have no action.
2. Exercise every blocking fixture and every unavailable/indeterminate checker state.
3. Verify no package upload occurs before all checks pass and preview is confirmed.
4. Supplement metadata/declaration in the staging copy; verify the original Skill is unchanged.
5. Compare preview file list/digests to captured multipart ZIP and Hub-reconstructed list byte-for-byte.
6. Modify source/staging after preview; verify submission is blocked until full recheck and reconfirmation.

Expected: 100% local blocking, no sensitive content in logs/telemetry, no preview-external field/file sent.

## Scenario B: terms, login, and account isolation

1. Logged out: click both contribution and My Contributions, cancel login, then succeed and verify the original safe context resumes.
2. Exercise terms 200/open, 304, open=false, fetch failure, and version change between preview and submit.
3. Populate account A cache, switch to B offline, and verify no A row or retry receipt is visible; switch back and verify only A partition returns.
4. Logout during check, preview, and upload preparation; verify cancellation and staging cleanup.

## Scenario C: idempotency and replacement

1. Confirm one preview, interrupt transport at multiple points, and retry ten times with the same key.
2. Verify exactly one pending Hub submission and stable `submission_id` on replay.
3. Reuse the key with changed content only in a negative fixture; expect conflict and no overwrite.
4. Submit the same local Skill again, show replacement confirmation, and verify old `REPLACED` plus one new `PENDING_REVIEW` atomically.

## Scenario D: My Contributions, versions, and withdrawal

1. Validate full and incremental C04 loads, stale timestamp, offline cache, manual refresh, and 60-second foreground refresh policy.
2. Exercise all submission statuses and free-text reasons unchanged.
3. Submit a version greater than the current published version; block equal/lower/malformed versions locally and still handle Hub race rejection.
4. Preserve immutable target ID and derived `forked_from`; allow disabled/withdrawn content repair only when iteration-one prerequisites pass.
5. Withdraw pending submission idempotently.
6. Create content-level withdrawal with 1-2000 character reason; verify no version-level action, pending duplicate recovery, rejection reason, and governance notice.

## Scenario E: current versus target contracts

1. Against Hub snapshot `34421be`, verify the client does not emit `components[]` and does not call a catalog icon resource.
2. After joint freeze, run target component fixtures for optional absence, each component/status, required verdict on evaluated, and invalid entries.
3. After icon contract implementation/freeze, verify omitted icon, valid digest/content type/size, ETag/304, 404 fallback, digest mismatch fallback, and old-client tolerance.
4. Record current-integration evidence separately from target-contract acceptance.

## Real Electron verification

After implementation changes, run `scripts/restart-cogseed.sh`, confirm the worktree launcher/runtime logs, and validate normal plus error/recovery paths in the actual Electron app at desktop and constrained widths. Verify focus return, Escape ordering, Tab/Shift+Tab, accessible names, IME-safe shortcuts, reduced motion, cancellation, and progress. Perform platform-specific macOS and Windows validation; report any unrun platform explicitly.

Windows is explicitly **not verified** in this worktree. Do not infer parity from macOS or typecheck evidence; packaged Windows contribution and path behavior requires a real Windows run.

## Execution evidence — 2026-09-25

- Branch: `codex/hub-skill-contribution-complete`; implementation baseline remains client commit `623b198f` plus the uncommitted feature changes listed by `git status`.
- Hub authority was read only through `git show` at `origin/codex/hub-open1-governance@34421be279d960e70e568031364d092dbc28ad73`. The Hub checkout stayed on its existing branch and its pre-existing untracked `.claude/skills` was not touched.
- `.specify/extensions.yml` contains no pre/post hooks (`hooks: {}`), so setup, plan/tasks/analyze/implement/converge had no extension command to run. This was rechecked after convergence.
- Focused final run: 19 test files / 175 tests passed, covering contribution main-process modules, IPC validation, real-page Renderer flows, shared-UI adoption and iteration-one fork reuse.
- Renderer flow subset: 10 dynamic flow tests plus 6 shared-UI tests passed, including login continuation/cancel, declaration supplementation, local-check cancel, upload abort, replacement acknowledgement, foreground refresh, stale cache, pending withdrawal, content-level governance withdrawal and disabled-content recovery guidance.
- `npm run typecheck`: passed. Locale JSON parsing: passed. `git diff --check`: passed.
- `npm run test:resources`: 308 passed. The standard `npm run test:resources:setup` was used to create the worktree-local pytest environment; no application dependency was added.
- Full JavaScript suite after missing Sherpa resources were restored: 1126 files passed, 12 skipped, 3 failed; 13002 tests passed, 51 skipped, 3 failed. The failures are outside this feature and reproduce in `test/scripts/verify-packaged-stt-win.test.ts` (Windows release workflow step adjacency), `test/main/features/auto_tasks.test.ts` (briefing dispatch mock not called), and `test/main/features/personal_context-forget.test.ts` (`since` registry matching). All contribution tests passed in the same run. No unrelated gate was weakened or edited.
- `scripts/restart-cogseed.sh` was executed, then the source runtime was prepared explicitly because first-run dependency setup exceeded the script's 30-second readiness window. The pinned Python/uv/Node runtime and OfficeCLI were reused read-only from a sibling source checkout only after the current repository's manifest/SHA checks passed; that checkout was not modified. A subsequent foreground `./run.sh` produced the real current-worktree Electron process and runtime log under the variant-local data root. Startup, Renderer, gateway and embed-worker activity are healthy. Automated UI interaction could not continue because macOS reported `Computer Use permissions are not granted`; therefore visual normal/error/recovery flow verification remains explicitly unverified rather than inferred. The concurrently running desktop checkout used a test-temporary userData root and did not prevent this standard runtime from starting.
- The observed `临时空间` and automatic Codex activity are not contribution submission behavior. The startup log records a version migration from `1.0.2` to `1.2.0` clearing onboarding state, followed by onboarding importing this Codex session, creating and binding `临时空间`, and running the imported-session welcome/reflection path. No contribution upload route appears in that sequence.
- Live Hub validation is not established by this source run. Neither `COGSEED_HUB_API_BASE` nor `COGSEED_API_BASE_URL` was injected, so account health and the shared marketplace/contribution client resolved to the dev default `http://localhost:3000`; the log records `/healthz`, client-config, updater and marketplace connection failures. The authority OpenAPI snapshot names only local `127.0.0.1:3000` and `127.0.0.1:3101` example servers, not an authorized shared integration origin. A read-only probe of the separately configured shared-origin candidate failed DNS resolution. Consequently the six current route families remain fixture-verified and integration-ready, but live end-to-end evidence is blocked on an authorized reachable endpoint/VPN/DNS; no endpoint was guessed.
- Windows remains unverified because no real Windows environment is available.
- The six current C00-C05 route families are implemented and fixture-covered for integration, but are not claimed jointly frozen. `manifest.components[]` and `list[].icon` / the icon resource remain decided target contracts only; the client neither emits nor calls them under authority snapshot `34421be`.
