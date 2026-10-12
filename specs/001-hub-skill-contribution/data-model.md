# Phase 1 Data Model: Hub Skill Contribution Client

## Scope and storage

Hub owns contribution truth. The client stores only machine-private preparation, retry, and offline-cache state under the active user's `<uid>/local/` domain. No token, package body, terms body, or raw finding is written to logs/telemetry.

## Entities

### ContributionDraft

| Field | Meaning / validation |
|---|---|
| `draft_id` | Client UUID; local only |
| `account_partition` | One-way partition for the currently authenticated Hub account |
| `local_skill_id` | Stable UUID-v4 persisted for a custom Skill; never a path |
| `source_skill_ref` | Custom Skill identifier resolved server-side in main; no renderer path authority |
| `target_content_id` | Null for new content; immutable 12-hex ID for new version |
| `mode` | `new_content` or `new_version` |
| `state` | State machine below |
| `metadata` | Name, description, SemVer and optional contract-approved fields |
| `origin` | `original`, `derived_from_hub`, or `third_party`, note, immutable `forked_from` when derived |
| `terms` | Effective version and acceptance timestamp |
| `maintenance_confirmed_at` | Required RFC3339 timestamp |
| `staging_ref` | User-local temporary staging identifier, not a renderer-controlled path |
| `snapshot_fingerprint` | Digest binding normalized files plus outbound metadata |
| `preview_confirmed_fingerprint` | Must equal current fingerprint at submit |
| `idempotency_key` | UUID-v4 created after preview confirmation; stable for same snapshot retry |
| `created_at` / `updated_at` | RFC3339 |

Validation: only a custom Skill can create a draft; account change cancels it; target and derived linkage cannot be edited; new-version SemVer must be greater than `current_published_version` locally and remains Hub-authoritative.

### SubmissionSnapshot

| Field | Meaning / validation |
|---|---|
| `package_digest` / `package_size` | SHA-256 of exact ZIP bytes and byte count |
| `files[]` | Normalized relative path, size, SHA-256, binary/text display classification |
| `metadata` | Values derived from or reconciled with the staged package |
| `declarations` | Origin, terms, maintenance confirmation |
| `check_receipt_id` | Receipt bound to the same fingerprint |
| `icon_entry` | Optional file-list entry; never a local/external URL |
| `confirmed_at` | User confirmation timestamp |

Validation: preview enumerates every file. Binary and long text remain visible as entries. Any file or outbound-metadata change invalidates snapshot confirmation.

### LocalCheckReceipt

| Field | Meaning / validation |
|---|---|
| `snapshot_fingerprint` | Exact final-copy binding |
| `components` | Local per-component results and actual versions |
| `blocking[]` / `warnings[]` | Local full findings; paths are normalized package-relative paths |
| `completed_at` | RFC3339 |
| `outcome` | `passed`, `needs_input`, `blocked`, `unavailable`, `indeterminate`, `cancelled` |

Required local components are ruleset `1.0.0`, skill-sentry `2.1.0`, and declaration-core engine `1.3.0`; declaration ontology is independently pinned to `cogseed.security.skill@1.1.1`. Only `passed` (with optional warnings) permits preview. The target outbound `components[]` is not serialized until its contract is synchronized and frozen.

### SubmissionReceipt

| Field | Meaning / validation |
|---|---|
| `idempotency_key` | Same key for uncertain retry of same snapshot |
| `snapshot_fingerprint` | Detects key/content conflicts before transport |
| `submission_id` | Hub ID after successful response |
| `delivery_state` | `not_sent`, `in_flight`, `arrived`, `arrived_rejected`, `not_confirmed` |
| `hub_status` | `PENDING_REVIEW`, `ACCEPTED`, `RETURNED`, `WITHDRAWN`, or `REPLACED` |
| `last_error` | Structured safe code/retryability only |
| `replaced_submission_id` | Optional Hub result |

### ContributionCache

| Field | Meaning / validation |
|---|---|
| `account_partition` | Mandatory cache partition |
| `generated_at` | Hub cursor and displayed last-sync time |
| `items_by_entry_id` | C04 aggregate entries |
| `last_success_at` | Offline/stale UI marker |
| `schema_version` | Allows cache discard on contract change |

The cache is never merged across accounts. A full reload occurs on account change or incompatible schema.

### MyContributionEntry

Mirrors C04: `entry_id`, optional `content_id`, `name`, `content_status`, optional `current_published_version`, `latest_submission`, optional `withdrawal_request`, `updated_at`. `latest_submission.declarations_origin` seeds but does not silently finalize a new-version origin declaration.

### WithdrawalIntent

| Field | Meaning / validation |
|---|---|
| `content_id` | Published community content owned by current contributor |
| `reason` | 1-2000 characters |
| `status` | `PENDING`, `WITHDRAWN`, `REJECTED` |
| `rejected_reason` | Required for rejected result |

There is no `version` field or version-level UI action. Pending-submission withdrawal is a different operation and state transition.

### TermsSnapshot

`open`, optional `version`, `effective_at`, `body_markdown`, `etag`, and `fetched_at`. A 304 reuses the matching cached body. `open=false`, fetch failure, or version change prevents checks/upload; Hub revalidates at write time.

## State transitions

```text
idle
  -> awaiting_login -> idle | terms_check
  -> terms_check -> closed | preparing
preparing -> needs_input | checking | cancelled
needs_input -> checking | cancelled
checking -> blocked | unavailable | preview_ready | cancelled
preview_ready -> preparing (any change) | confirmed
confirmed -> submitting | preparing (drift)
submitting -> arrived | arrived_rejected | not_confirmed | cancelled
not_confirmed -> submitting (same key/snapshot) | preparing (changed content/new key)
arrived -> PENDING_REVIEW -> ACCEPTED | RETURNED | WITHDRAWN | REPLACED
```

Account logout/switch transitions every nonterminal local state to `cancelled`, removes staging bytes, clears in-memory results, and selects only the new account partition's cache.

## Relationships

- One local custom Skill has one stable `local_skill_id` and many drafts over time.
- One draft has many invalidated snapshots but at most one current confirmed snapshot.
- One confirmed snapshot has one idempotency key; uncertain retries share both.
- One Hub contribution entry aggregates one latest submission and at most one current withdrawal request.
- A `forked_from` relation belongs to the derived custom copy and is preserved across contribution versions.
