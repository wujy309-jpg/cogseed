# Phase 1 Contract: Client–Hub Contribution Interface

**Authority snapshot**: Hub `34421be279d960e70e568031364d092dbc28ad73`

**Status**: integration baseline, not joint freeze

This artifact is a client traceability contract, not a replacement for Hub C00-C06 or its OpenAPI. It prevents current implementation, decided target contracts, and unfrozen work from being conflated.

## Common client obligations

- Main process owns Bearer/session use and all Hub calls. Renderer receives safe domain objects and structured errors only.
- Send client version, platform, request ID, language, and `Idempotency-Key` where required. Never send a device/workspace/task ID, local path, other Skill data, token, raw sensitive finding, or preview-external file.
- Parse the top-level Hub envelope. Display Hub-localized `error.message`; use `error.code`, `retryable`, and safe details for behavior.
- Reject unknown response enum/shape safely, retain request ID for support, and do not reinterpret a schema error as success.

## Capability traceability matrix

| Capability | Current route(s) at Hub snapshot | Authority | Implemented/integration evidence | Client behavior and tests | Freeze status |
|---|---|---|---|---|---|
| Terms | `GET /marketplace/contributions/terms` | C00, C01, OpenAPI | Implemented; anonymous; ETag/304; `open:false` has no ETag | cache by ETag, show full terms/version, gate before checks, verify 200/304/closed/network failure/version race | Current route usable; wording/activation operational dependency remains |
| Create/new-version submission | `POST /marketplace/contributions/submissions` | C00, C02, C03, C06, OpenAPI | Implemented multipart `manifest` then `package`; idempotency, replacement, limit, declaration engine and candidate icon checks | upload only confirmed bytes; same-key retry; new-version target immutable; contract fixtures for every declared 4xx and 5xx uncertainty | Usable for integration; manifest additions/icon thresholds still unfrozen |
| Submission status | `GET /marketplace/contributions/submissions/{submissionId}` | C00, C02, OpenAPI | Implemented; foreign/missing both `SUBMISSION_NOT_FOUND` | map five statuses, reasons, server warnings, accepted version; reject cross-account cache lookup | Usable for integration; joint freeze pending |
| Pending withdrawal | `POST /marketplace/contributions/submissions/{submissionId}/withdraw` | C00, C02, OpenAPI | Implemented and idempotent | confirmation, empty-object body, distinguish already withdrawn from no-longer-pending | Usable for integration; joint freeze pending |
| My Contributions | `GET /marketplace/contributions/mine` | C00, C04, OpenAPI | Implemented; account isolation; page/size/updated_since, size capped at 100 | account-partitioned stale cache, incremental merge, full reload on switch, current version/origin prefill | Usable for integration; refresh is client policy, joint freeze pending |
| Withdrawal requests | `POST` and `GET /marketplace/contributions/withdrawal-requests` | C00, C05, OpenAPI | Implemented; no version field; max one pending per content | 1-2000 reason, governance notice, no version action, duplicate-pending recovery, history read | Usable for integration; joint freeze pending |

## Submission invariants

1. `local_skill_id` is a persisted UUID, not a local path. New content replacement is scoped by account + local Skill; new version replacement is account + target content ID.
2. The ZIP digest, size, file list, package metadata, declarations, check receipt, and preview fingerprint describe one immutable snapshot.
3. A changed snapshot gets a new preview confirmation and idempotency key. A transport retry of an unchanged snapshot reuses its key forever.
4. `references/security-manifest.yaml` is required for community submission and uses ontology `cogseed.security.skill@1.1.1`; declaration-core engine `1.3.0` is a component version, not an ontology value.
5. Optional icon bytes are part of the ZIP/file list/digest. No separate icon multipart part, local path, or contributor-controlled URL is sent.
6. Server checks do not replace local checks; local self-report does not replace Hub checks.

## Decided target contracts awaiting Hub authority synchronization

These shapes are planning constraints only and MUST NOT be emitted or called until the Hub C00-C06/OpenAPI snapshot contains them and joint contract tests freeze them.

### Component evaluation summary

```json
{
  "components": [
    { "component": "ruleset", "version": "1.0.0", "status": "evaluated", "verdict": "pass" }
  ]
}
```

- `component`: `ruleset | skill-sentry | declaration-core`.
- `status`: `evaluated | not-deployed | failed`.
- `verdict` is required only when `status=evaluated`.
- The entire array is optional and does not gate a submission when absent; when present it is validated. Hub records/displays it but does not use it as an admission decision.
- Current Hub implementation has no `components[]`; current C03 documents a different candidate `{name, version, result}`. No current request code may be generated from either candidate.

### Published catalog icon

```json
{
  "icon": {
    "url": "/marketplace/skills/8a4f01c29d7e/icon",
    "sha256": "<64 lowercase hex>",
    "size": 8192,
    "content_type": "image/png"
  }
}
```

- `list[].icon` is omitted when absent; old clients ignore it.
- Target resource: `GET /marketplace/skills/{contentId}/icon`; ETag returned, matching `If-None-Match` gives 304, unpublished/absent gives 404.
- Current Hub C06 has different candidate names/path and the implementation-status note says both catalog projection and resource are unimplemented. Do not call it yet.
- Hub owns validation strictness/thresholds and notifies clients when ontology pins must change.

## Joint-freeze acceptance

Freeze is complete only when:

1. C00-C06 and OpenAPI agree on request white lists, schemas, enum values, status codes, headers, and all safe error details.
2. Hub and client share positive and negative fixtures for all six capabilities, including extra-field rejection, account isolation, idempotent replay/conflict, replacement, terms race, declaration failure, digest/file-list mismatch, and withdrawal conflicts.
3. Target `components[]` and icon contracts are either incorporated exactly or explicitly superseded by a recorded joint decision.
4. Client parsers pass against Hub implementation fixtures; Hub tests accept client-produced multipart samples.
5. Integration evidence is reported separately from product acceptance/release.
