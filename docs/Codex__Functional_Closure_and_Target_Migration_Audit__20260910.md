# CogSeed × P3394 Functional Closure and Target Migration Audit

> **后续阶段输入说明：** 本文件保留完整审计过程与迁移分析。若只需一份无修订过程、可直接作为下一阶段输入的 Current Truth，请使用 `Codex__Final_Current_Truth__20260910.md`。后续 Current Truth 收口未新增跨模块 Authority / SoT / Binding / Projection / Candidate / KSTAR 决策。

> 本报告依据 `CogSeed_P3394_功能闭环真实性与新框架迁移审计任务书_v0.3.md` 执行。
> 代码基线优先使用 `origin/develop` 的 `ae0e3c8efb809d99ccc0f82bc0145ee86987bae6`（`package.json` 版本 1.0.2），因为当前 checkout `1c592e5` 落后该基线 77 个提交，并缺少本任务已经落下的 Receipt、Task Contract、Hybrid Retrieval、Run Evidence、Trace、Validation 等关键实现。
> 运行时证据来自本机安装的 CogSeed Enterprise 0.9.0 与 `.cogseed` 数据根。该数据可能由较早构建产生，因此用于证明历史真实状态与残留风险，不冒充当前 HEAD 的逐行运行时回放。未复制用户正文到本报告。

## 0. Audit Metadata

```yaml
auditor_person: Codex
ai_tool: Codex desktop
audit_date: 2026-09-11
repositories_reviewed:
  - CogSeed
code_baseline:
  branch: origin/develop
  head: ae0e3c8efb809d99ccc0f82bc0145ee86987bae6
  package_version: 1.0.2
working_checkout:
  branch: local/creator-agent-builder-a2a
  head: 1c592e5297f9249f2d0d809864e50441edc49b92
  relation: behind_origin_develop_by_77
documents_reviewed:
  - CogSeed_P3394_功能闭环真实性与新框架迁移审计任务书_v0.3.md
  - docs/kstar/KSTAR检索复用归因与错误模式优化分析报告-2026-09-01.md
  - docs/kstar/KSTAR侧边聊天上下文整理-2026-09-01.md
  - docs/superpowers/plans/2026-09-03-kstar-personal-ontology-closure.md
runtime_evidence_reviewed:
  - installed_app: CogSeed Enterprise 0.9.0
  - data_root: /Users/sudai/.cogseed/data/15474948
  - aggregate_only: true
  - user_content_copied: false
historical_material_reviewed:
  - existing runtime records from 2026-08 and 2026-09
audit_scope_complete: false
scope_complete_reason: core Cognition/Recall/KSTAR/P3394 loop fully reviewed; peripheral product modules not exhaustively replayed
modules_covered:
  - recall
  - cognition
  - kstar
  - p3394
  - p3394_bridge
  - cogseed_runtime
  - group_chat runtime integration
  - personal ontology and persistent memory
functions_discovered: 13
```

### Evidence Ledger

| Evidence ID | Evidence | Result | Boundary |
|---|---|---|---|
| E-01 | Focused code tests on `origin/develop` | 5 files, 48 tests passed | code regression only |
| E-02 | One-off candidate governance probe on `origin/develop` | `pending_review`, `validationCount=0` was automatically promoted to a seed asset | real implementation path, temp data root |
| E-03 | One-off revoke/impact probe | asset became `revoked`, but USER.md projection and next system prompt still contained the fact | real implementation path, temp data root |
| E-04 | One-off Personal Ontology bypass probe | direct candidate confirm wrote memory, removed the candidate, created 0 formal assets and 0 review decisions | real implementation path, temp data root |
| E-05 | One-off ontology prompt probe | projection had 0 assets, but USER.md fact appeared in prompt with 0 citations | real implementation path, temp data root |
| E-06 | Production aggregate read | 31 episodes, 31 reviews, 31 extraction runs, 7 tasks, 7 requirements | installed 0.9.0 data, historical/compatibility evidence |
| E-07 | Production Recall aggregate read | 6 formal assets, 9 candidates, 7 confirmed projections, 15 transfer proofs | installed 0.9.0 data |
| E-08 | Production receipt read | 21 local execution records, 0 ContextReuseReceipts, no injection/asset-usage receipt streams | installed 0.9.0 data |
| E-09 | Production candidate read | 6 confirmed candidates, all with no validation count | installed 0.9.0 data |
| E-10 | Latest production KSTAR episode | completed Episode existed, but no task, requirement, projection, forecast, reuse-turn, or ability-asset reference | installed 0.9.0 data, single-run evidence |

## 1. Executive Conclusion

当前核心系统不是一个“空壳”。它已经具备真实可运行的功能：会话捕获、统一候选池、候选晋升、四类正式资产、版本与审计、任务契约、混合检索、已确认投影、群聊注入、委派授权、出生继承、KSTAR Episode/Review/沉淀、Usage/Transfer/Effectiveness Receipt、Trace 与 Run Evidence。

问题不在缺少功能，而在 authority 与闭环证据没有完全收束：

- 当前看到 13 个核心功能，但没有一个能在“当前代码 + 当前生产数据”两层同时证明端到端真闭环。
- 约 9 个功能达到 `PARTIAL`：入口、数据、状态和消费者都存在，但 Evidence、Usage、Future Reuse 或治理链只覆盖部分路径。
- 至少 2 个功能属于高风险 `PSEUDO_CLOSED / BROKEN`：直接记忆/Personal Ontology 物化路径，以及正式资产撤销对派生画像的回收。
- 最大的 first breakpoint 是 **`Canonical mutation / revoke` 没有跨所有合法写入路径收口**。资产可以撤销，但已经写入 USER.md、MEMORY.md、角色模板字段的事实仍会被下一次系统提示词读取。
- 第二个 first breakpoint 是 **候选治理策略没有被严格执行**。代码已经算出 `hold`，`autoApplyRecallCandidate` 却只处理 `pause`，零验证候选仍可晋升正式资产；生产数据中 6 个已确认候选全部 `validationCount=0`，与该事实一致。
- 第三个 first breakpoint 是 **同一语义存在多套候选和写入入口**。Recall candidate、Personal Ontology candidate、`cross_session_memory` 直写、personal-profile projection 都能影响长期个人信息，但没有都经过同一个 governance/canonical gate。
- 存在多条平行 runtime read path：Commander Projection、Delegated Grant、Inherited Cognition、CogSeed Runtime context、USER.md/MEMORY.md、角色模板画像。它们之中只有部分写 Receipt。
- 存在 competing SoT：四类正式资产已经在 `recall/ability-assets` 收口，但 Personal Ontology 分组/角色模板、USER.md/MEMORY.md 仍可独立承载长期 person-level truth。
- P3394 Bridge 的协议、session、audit、outbox 和安全边界较成熟，但 bridge task state 仅驻内存；默认 conversation adapter 下，重启后的 `recovery sweep` 没有可恢复任务来源。
- 总体不建议重写。现有 Router、Gate、Rank、Projection、Receipt、Trace 和 KSTAR 对象大多可以保留，目标是通过 Adapter、停写非 canonical 入口、补统一 Receipt、把派生画像变成可随授权撤销的 view，完成中等规模收束。

必须先解决的 3 件事：

1. 收回长期个人信息的写权：Legacy PO candidate、direct memory write、materialized USER/role facts 统一改走 Recall candidate/governance，或明确标记为且保持为只读 projection。
2. 真正执行自己的晋升策略：`hold` 不得落到 `promote`；系统沉淀要么先获得独立 validation，要么由明确、可审计的 policy 允许“system candidate 直接确认”，不能两者并存。
3. 建立统一 impact closure：pause/revoke/delete/purge/forget 必须影响 eligibility、future projection、USER/MEMORY materialization、role-template projection，并形成可验证的 impact receipt。

## 2. Functional Inventory

| Function ID | Function Name | User / System Purpose | Trigger | Main Output | Current Status | Historical? | Current Owner |
|---|---|---|---|---|---|---|---|
| F-01 | Experience Capture → Candidate | 从会话/导入/KSTAR 经验生成统一候选 | terminal task、manual capture、import、KSTAR closure | capture + RecallCandidate | `PRODUCTION_LIVE + PARTIAL` | 是，旧 capture/PO 候选并存 | Recall + KSTAR |
| F-02 | Candidate Governance → Formal Asset | 审查、确认、拒绝、合并、晋升 | UI、system auto-apply、KSTAR precipitation | asset + ReviewDecision + handoff receipt | `PRODUCTION_LIVE + PARTIAL` | 是，legacy PO candidate bypass | Cognition + Recall |
| F-03 | Formal Asset Lifecycle / Version / Revoke | 管理 active/paused/revoked/deleted/version | UI/IPC/system policy | versioned asset + audit + status | `BROKEN_FOR_REVOKE_IMPACT` | 是 | Recall |
| F-04 | Task Contract / Hybrid Retrieval | 从任务形成契约，本体+语义选择资产 | automatic projection、forecast、projection preview | selection + match evidence + omissions | `PRODUCTION_LIVE + PARTIAL` | 是，旧 semantic-only | Recall |
| F-05 | Context Projection / Freeze / Confirm | 把选择结果冻结为可治理上下文 | task open、manual card、wake approval | confirmed/frozen projection | `PRODUCTION_LIVE + PARTIAL` | 是 | Recall + P3394/KSTAR |
| F-06 | Commander Prompt Injection / Injection Receipt | 将 confirmed projection 注入 Commander | Commander turn | prompt block + citations + receipts | `PRODUCTION_LIVE + PARTIAL` | 是 | GroupChat + Recall |
| F-07 | Delegated Grant / Inherited Cognition | 向目标 Agent 注入 Commander 授权或出生继承 | dispatch、agent turn | prompt block + ContextReuseReceipt | `PRODUCTION_LIVE + PARTIAL` | 是 | GroupChat + Recall |
| F-08 | Persistent Memory / Personal Ontology | 保存/展示 person-level 长期事实与画像 | memory tool、PO candidate、profile sync、space role | USER.md/MEMORY.md/role fields/prompt | `PSEUDO_CLOSED` | 是，legacy authority still live | Memory + Personal Ontology + Recall |
| F-09 | P3394 Session / Task / Recovery | 承载外部会话、任务、恢复、审计 | inbound bridge、outbound call、control | session/task events/receipt/reply | `PARTIAL + RECOVERY_BROKEN` | 是 | P3394 Bridge |
| F-10 | Forge Runtime Execution / Run Evidence | 在隔离 Runtime 执行任务并留存事实 | backend/runtime launch | events/result/run metadata | `PRODUCTION_LIVE + PARTIAL` | 是 | CogSeed Backend |
| F-11 | KSTAR Episode / Review / Contribution | 将执行转成经验、归因和可复用结果 | task terminal、manual/view consumer | Episode、Review、Candidate/Asset | `PRODUCTION_LIVE + PARTIAL` | 是 | KSTAR |
| F-12 | Usage / Transfer / Effectiveness Proof | 证明 injected、used、effective | injection、terminal、user feedback | injection receipt, usage receipt, transfer/effectiveness proof | `PARTIAL + HISTORICAL_EVIDENCE_MIXED` | 是 | Recall + KSTAR |
| F-13 | Trace / Run Evidence / Revoke Impact Closure | 统一回放证据并约束撤销影响 | UI read、terminal proof、source revoke | trace/evidence/gaps/impact | `PARTIAL + C10_BROKEN` | 是 | KSTAR + Recall |

## 3. BEFORE_AUDIT Baseline

| Capability | Before Audit Understanding | Source |
|---|---|---|
| Candidate confirmation | 候选可以经用户确认进入长期认知 | task book, product/UI wording |
| Asset reuse | 正式资产已统一复用，Runtime 能看到正确上下文 | historical KSTAR report and code comments |
| KSTAR learning | Episode → Review → Candidate/Asset 已形成主闭环 | historical KSTAR report and closure plan |
| Personal Ontology | PO 事实进入 Runtime，个人画像由确认结果逐步形成 | task book target and PO UI copy |
| Usage proof | injected、used、effective 三层已经能够区分 | historical KSTAR report after optimization |
| Restart recovery | P3394 session/task recovery 已由 journal/cursor 支撑 | manifest and recovery comments |
| Revocation | revoke 会立即影响未来 eligibility，历史 Trace 保持事实 | task book AR-12 and policy comments |
| Projection | confirmed projection 是 Runtime 的权威上下文选择 | code comments and PRD-facing docs |

## 4. VERIFIED_CURRENT Architecture

### Current Main Loop

```text
User / Terminal / P3394 inbound
  ↓
Group Chat enqueue / CogSeed task launch
  ↓
KSTAR host routing (model judge; may be skipped for external inbound)
  ↓
Task + Requirement
  ↓
Task Contract + Hybrid Retrieval
  ↓
Context Projection (manual or auto-confirmed)
  ↓
World Model Forecast
  ↓
Runtime consumption
  ├─ Commander prompt injection
  ├─ Delegated asset grant
  ├─ Inherited cognition
  ├─ CogSeed Runtime context
  └─ direct USER.md / MEMORY.md / role profile prompt
  ↓
Execution result / artifact / terminal event
  ↓
Injection Receipt / Usage Receipt / Context Reuse Receipt
  ↓
KSTAR Episode + Review + Attribution
  ↓
Requirement-level precipitation
  ↓
Recall Candidate
  ↓
ReviewDecision / system policy
  ↓
Formal Ability Asset
  ↓
future projection or self-reuse
```

### Current Store Topology

| Semantic Object | Current Writable Location | Reader Path | Reality |
|---|---|---|---|
| Candidate | `cloud/recall/records/candidates` | candidate UI/inbox/KSTAR bridge | canonical for four asset candidates |
| Legacy PO Candidate | `local/ontology_candidates/candidates.md` | `cognition.candidates.*` UI | second candidate lifecycle |
| Formal Asset | `cloud/recall/records/ability-assets` | formal-assets boundary, runtime gates | de facto canonical asset SoT |
| Projection | `cloud/recall/records/projections` | Commander/runtime prompt assembly | frozen selection record |
| USER.md / MEMORY.md | `cloud/memory` | every Core Agent system prompt | live parallel person-level read path |
| Role Profile | `.personal_ontology_groups` + template fields | space/role profile system prompt | live parallel person-level read path |
| Episode | `cloud/kstar/episodes` | Review, trace, precipitation | KSTAR fact store |
| Review | `cloud/kstar/reviews` | precipitation, trace | inferred/confirmed experience judgment |
| Injection Receipt | `cloud/recall/jsonl/injection-receipts` | trace/run evidence | present in code, absent in installed production evidence |
| Asset Usage Receipt | `cloud/recall/jsonl/asset-usage-receipts` | trace/run evidence | present in code, absent in installed production evidence |
| Context Reuse Receipt | `local/kstar/executions/<id>/context-reuse-receipt.json` | terminal proof, cognition receipts UI | 0 in installed production evidence |
| Transfer/Effectiveness Proof | `cloud/recall/records` | maturity/reuse UI | 15 historical proofs, none with receipt id |
| P3394 Session | `~/.cogseed/runtime-variants/.../p3394-sessions` | bridge session manager | durable |
| P3394 Task | memory map in `P3394BridgeTaskManager` | recovery controller | ephemeral |

## 5. Seven-Layer Reality Audit

### F-01 Experience Capture → Candidate

#### L1 Existence

- `startRecallCaptureOrchestrator`, `queueRecallCaptureFromTerminal`, `runRecallCapture`, `saveRecallCandidate`, `saveKstarCandidateProposals` all exist.
- Capture records, candidate records, extraction runs and tests exist.

#### L2 Trigger / Reachability

- Production live: boot subscribes to task terminals.
- Manual capture is reachable through IPC/UI.
- KSTAR requirement precipitation also enters the same candidate store.
- Import and teaching flows can add candidates.

#### L3 Input / Data Reality

- Inputs are persisted conversation messages, terminal run metadata, import records and KSTAR proposals.
- Evidence references and source references are real typed objects, not prompt-only text.
- Capture value screening and candidate type gates run before write.

#### L4 State / Persistence

- Captures and candidates persist under user-scoped cloud Recall.
- Candidate statuses, evidence, source refs, scope and optional learning provenance are persisted.
- Legacy PO candidates persist in a separate local Markdown store.

#### L5 Downstream Consumption

- `cognition.inbox.list` consumes Recall candidates.
- `cognition.candidates.list` consumes only Personal Ontology candidates.
- Automatic and user promotion consume Recall candidates.
- KSTAR extraction consumes its proposal bridge or direct experience path.

#### L6 Runtime Effect / Evidence

- Production data proves captures and candidates are written.
- Installed production evidence shows six confirmed candidates promoted with no validation count, so capture-to-canonical mutation happened.
- No recent record proves the full path from a current production message through new injection/usage receipts to a new candidate.

#### L7 Feedback / Evolution

- Candidate decisions append ReviewDecision records.
- Candidate validation and effectiveness feedback exist.
- Weak/strong observations can reopen after new evidence.
- The system auto-promotion gate is not consistently enforcing its own policy.

```yaml
overall_status: PRODUCTION_LIVE + PARTIAL
first_breakpoint: candidate promotion policy calculates hold but autoApplyRecallCandidate does not honor hold
strongest_evidence: real capture/candidate records plus one-off probe showing zero-validation promotion
missing_evidence: current-version production replay from capture through governed promotion
```

### F-02 Candidate Governance → Formal Asset

#### L1 Existence

- `promoteRecallCandidate`, `autoApplyRecallCandidate`, `writeReviewDecision`, promotion validation, handoff receipts and asset creation exist.
- Formal-assets read boundary and promotion policy exist.

#### L2 Trigger / Reachability

- User confirmation paths are reachable through IPC and UI.
- System capture and KSTAR precipitation call `autoApplyRecallCandidate`.
- Legacy PO confirmation bypasses Recall promotion entirely.

#### L3 Input / Data Reality

- Candidate text, evidence, risk, action, scope and applicability/forbidden boundaries are real persisted fields.
- Actor is explicit (`user` or `system`).
- Some legacy material facts enter memory without a formal asset candidate.

#### L4 State / Persistence

- Promotion writes ReviewDecision, asset handoff receipt and ability asset.
- Version 1 of the asset is written with lifecycle/maturity axes.
- PO candidate confirmation writes USER/MEMORY directly and only removes the Markdown candidate.

#### L5 Downstream Consumption

- Runtime reads promoted assets through formal-assets/runtime gates.
- Manual projection and dispatch can consume promoted assets.
- USER/MEMORY direct writes are consumed by every Core Agent system prompt without asset IDs.

#### L6 Runtime Effect / Evidence

- Production data proves promotion happened.
- Production data proves six confirmed candidates had no validation count.
- One-off probe on the audited code reproduced that zero-validation candidate auto-promotion.

#### L7 Feedback / Evolution

- ReviewDecision ledger records outcomes.
- Handoff receipt connects candidate to created asset.
- Validation/effectiveness can update maturity later.
- Competing PO candidate and direct-memory paths do not produce ReviewDecision.

```yaml
overall_status: PRODUCTION_LIVE + PARTIAL
first_breakpoint: hold is ignored at the automatic promotion exit
strongest_evidence: candidate-service policy/probe and production confirmed candidates with validationCount absent
missing_evidence: a production candidate chain proving policy hold blocks canonical mutation
```

### F-03 Formal Asset Lifecycle / Version / Revoke

#### L1 Existence

- pause, resume, revoke, archive, delete, purge, restore, rollback, version snapshots, audit, maturity and cross-scope confirmation exist.

#### L2 Trigger / Reachability

- Lifecycle operations are reachable through IPC and UI.
- System validation can pause/downgrade assets.
- Source revocation can mark assets paused or maturity downgraded.

#### L3 Input / Data Reality

- Every lifecycle mutation requires actor and reason; system mutations require a review handoff id.
- Version snapshots preserve evidence and core content.

#### L4 State / Persistence

- Asset status, deletedAt, maturity, audit entries and version entries persist.
- The asset record itself is updated atomically.
- Materialized USER.md and role-template facts are not part of the same transaction.

#### L5 Downstream Consumption

- Runtime eligibility checks live asset status and source availability.
- Trace can read lifecycle state.
- Direct memory/role prompts do not consult asset status.

#### L6 Runtime Effect / Evidence

- One-off revoke probe proved `status=revoked` but the materialized profile remained in USER.md and in the next system prompt.
- Production proof records provide historical lifecycle facts, but no receipt-backed revoke impact record.

#### L7 Feedback / Evolution

- Future projection stops using a revoked asset if eligibility rechecks it.
- Existing generated views can keep exposing the fact indefinitely.
- There is no durable closure receipt for derived copies affected by revoke.

```yaml
overall_status: BROKEN_FOR_REVOKE_IMPACT
first_breakpoint: setStatus does not detach or invalidate materialized profile/role projections
strongest_evidence: one-off revoke probe showing revoked asset still present in next prompt
missing_evidence: end-to-end revoke impact receipt covering all derived readers
```

### F-04 Task Contract / Hybrid Retrieval

#### L1 Existence

- `buildRecallTaskContract`, ontology ranking, semantic ranking, hybrid merge, score thresholds, top-N and omission reasons exist.

#### L2 Trigger / Reachability

- Automatic projection calls semantic selection every Commander turn when no committed projection is used.
- Manual preview and forecast knowledge loading call related selection paths.
- Projection revision can add/remove selected assets manually.

#### L3 Input / Data Reality

- Query text is actual task text.
- Asset title, statement and ontology refs form semantic text.
- Ontology facts/rules/taxonomy are loaded from real Personal Ontology stores.

#### L4 State / Persistence

- The transient retrieval decision is persisted into projection as asset ids, versions, matches and omissions.
- TaskContract itself is not persisted as a separate authoritative record.

#### L5 Downstream Consumption

- Context projection consumes retrieval output.
- Forecast consumes projection knowledge.
- Commander prompt consumes selected assets and citations.

#### L6 Runtime Effect / Evidence

- Tests prove hybrid merge and gating.
- Production projections have match data and omissions.
- There is no direct trace artifact proving a task-contract decision caused a specific selection and later usage.

#### L7 Feedback / Evolution

- Omission reasons can be shown for governance.
- Usage/effectiveness evidence is not yet fed back into retrieval scoring.

```yaml
overall_status: PRODUCTION_LIVE + PARTIAL
first_breakpoint: retrieval decision is persisted only as projection output, not as an inspectable task contract/evidence object
strongest_evidence: hybrid retrieval code and projection matches
missing_evidence: linkage from task contract to selection rationale to usage outcome
```

### F-05 Context Projection / Freeze / Confirm

#### L1 Existence

- preview, automatic projection, confirm, defer, reject, revise, expiry, frozen versions and committed knowledge loading exist.

#### L2 Trigger / Reachability

- Manual card path is UI-reachable.
- Host routing auto-confirms workspace-policy projections.
- Wake approval can confirm projection atomically with approval.

#### L3 Input / Data Reality

- Projection consumes real selected asset ids and versions.
- Purpose, task text, authorization, expiry and workspace are persisted.
- Some projections can be empty.

#### L4 State / Persistence

- Projection status and frozen `assetVersions` persist.
- Confirmation validates asset existence, status and version.
- Production has seven confirmed projections with zero to three assets.

#### L5 Downstream Consumption

- Commander prompt consumes confirmed projection.
- Forecast knowledge loader consumes confirmed projection.
- CogSeed Runtime context consumes confirmed projection.

#### L6 Runtime Effect / Evidence

- Projection record proves selection and confirmation.
- Installed production evidence has no corresponding ContextReuseReceipts for these projections.
- Empty projections are valid and can still carry ontology facts through the prompt path without asset citations.

#### L7 Feedback / Evolution

- Omitted refs and selection degradation are recorded.
- Revision is possible only before confirmation.
- Revocation of an asset should affect live eligibility while preserving historical projection; this is partially implemented for formal assets, but not materialized Personal Ontology facts.

```yaml
overall_status: PRODUCTION_LIVE + PARTIAL
first_breakpoint: projection confirmation is real, but receipt/usage continuity is not proven across all consumers
strongest_evidence: persisted confirmed projections and frozen versions
missing_evidence: production receipt per projection consumer
```

### F-06 Commander Prompt Injection / Injection Receipt

#### L1 Existence

- `buildRecallTurnPromptContext`, `buildPromptContextForCommittedProjection`, `recordRecallUsage`, `recordInjectionReceipt` and ContextReuseReceipt preparation exist.

#### L2 Trigger / Reachability

- Commander turn path is production live.
- Committed projection is preferred; automatic projection is fallback.

#### L3 Input / Data Reality

- Commander gets actual selected projection assets.
- Asset versions prefer frozen snapshots.
- Live status/source eligibility is rechecked.

#### L4 State / Persistence

- Citations are persisted on the final message.
- Usage records and injection receipts are written after message persistence.
- ContextReuseReceipt is prepared for the turn.

#### L5 Downstream Consumption

- Commander model consumes the prompt block.
- Final message citations are UI/feedback readable.
- KSTAR closure later consumes injection receipts and message citations.

#### L6 Runtime Effect / Evidence

- Code records `injected`, not `used`.
- Usage receipt at KSTAR closure attempts to record `applied` only with observable tool/artifact evidence.
- Empty result or pure text use degenerates to `usage_unknown`; this is honest but not a full applied proof.
- Installed production evidence contains no current injection receipt stream.

#### L7 Feedback / Evolution

- Message-level positive/negative feedback writes usage outcome.
- KSTAR review can consume receipts for attribution.
- No user UI proves “this cognition changed the output”.

```yaml
overall_status: PRODUCTION_LIVE + PARTIAL
first_breakpoint: prompt injected is proven; applied/effective is conditional and often unavailable
strongest_evidence: code and tests for citations, usage and injection receipts
missing_evidence: current production receipt and user-visible applied/effective chain
```

### F-07 Delegated Grant / Inherited Cognition

#### L1 Existence

- `buildDispatchedAssetsPromptBlock`, `selectInheritedCognition`, `buildInheritedCognitionPrompt`, `reuseRefsForTurn`, `recordInheritedCognitionReuse` exist.

#### L2 Trigger / Reachability

- Delegated grants are reachable through Commander dispatch tools.
- Inherited cognition runs for local Agents with an inheritance snapshot.
- CLI agents intentionally bypass this path.

#### L3 Input / Data Reality

- Delegated assets are validated against the current confirmed projection.
- Inheritance uses frozen asset refs/content hash and checks current lifecycle, scope, sensitivity and source.

#### L4 State / Persistence

- Prompt text is ephemeral.
- ContextReuseReceipt persists reused and omitted refs.
- Inheritance does not create a formal asset or mutate source state.

#### L5 Downstream Consumption

- Target Agent model consumes prompt.
- Terminal proof consumes `turn-<turnId>` receipt.
- Use/effectiveness is not proven for inherited cognition.

#### L6 Runtime Effect / Evidence

- Receipt proves “loaded/injected”.
- No `AssetUsageReceipt` is generated for inherited cognition.
- CLI path explicitly cannot claim use.

#### L7 Feedback / Evolution

- Omitted refs are retained with reasons.
- No applied/effect feedback back to inherited asset.

```yaml
overall_status: PRODUCTION_LIVE + PARTIAL
first_breakpoint: inheritance has load proof but no applied/effect receipt
strongest_evidence: selection/prompt/receipt implementation and tests
missing_evidence: production inherited usage receipt and effectiveness outcome
```

### F-08 Persistent Memory / Personal Ontology

#### L1 Existence

- USER.md, MEMORY.md, agent memory, space memory, PO groups, role templates, PO candidate confirm, `cross_session_memory` and profile projection exist.

#### L2 Trigger / Reachability

- `cross_session_memory` is a live model tool.
- PO candidates are UI-reachable.
- Profile sync runs on promotion/page open.
- Space role profile is injected automatically into model prompts.

#### L3 Input / Data Reality

- Inputs are model/tool text, PO candidates, formal Personal assets and role-template fields.
- Some facts have source IDs, but the history in USER.md is not a versioned canonical asset.

#### L4 State / Persistence

- Multiple stores persist the same semantic kind of person-level truth.
- Some writes are append-only projections.
- Revoke/delete does not detach all materialized copies.

#### L5 Downstream Consumption

- `formatForSystemPrompt` reads USER.md/MEMORY.md every turn.
- Role profile is read every space turn.
- Projection knowledge converts USER/MEMORY entries into synthetic ontology assets.
- Synthetic ontology assets enter prompt but are explicitly excluded from citations.

#### L6 Runtime Effect / Evidence

- One-off PO bypass probe: confirm wrote memory, created no asset and no ReviewDecision.
- One-off injection probe: USER.md fact entered prompt with zero citations.
- One-off revoke probe: revoked asset fact remained in next prompt.

#### L7 Feedback / Evolution

- Direct memory writes bypass candidate governance.
- Materialized facts do not participate in asset maturity or versioning.
- Future prompt reuse keeps happening without an asset-version receipt.

```yaml
overall_status: PSEUDO_CLOSED
first_breakpoint: persistent memory/role profile is both a writable source and an uncited runtime read path
strongest_evidence: E-03, E-04 and E-05 probes
missing_evidence: governed write, versioned read, revoke propagation and usage receipt
```

### F-09 P3394 Session / Task / Recovery

#### L1 Existence

- envelope validation, registry, audit, replay protection, sessions, tasks, channels, outbox, approval and recovery controller exist.

#### L2 Trigger / Reachability

- Bridge starts on boot.
- Default adapter is conversation runtime.
- Inbound envelope execution and outbound auto-reply are live.

#### L3 Input / Data Reality

- Envelopes are validated and admitted by identity/capability.
- Session state is persisted; task state is in memory.
- Task/session mappings in default adapter are in memory.

#### L4 State / Persistence

- Session file is atomic tmp+rename.
- Outbound outbox and event cursors persist.
- P3394 Bridge TaskManager has a private `Map` only.

#### L5 Downstream Consumption

- Executor reads task manager for lifecycle.
- Recovery controller scans task manager for recoverable tasks.
- Doctor/UI reads bridge and peer state.

#### L6 Runtime Effect / Evidence

- In-process recovery works while the process lives.
- After restart, default task manager is empty, so `sweep()` has no tasks to recover.
- Production bridge endpoint and gateway processes exist, but direct restart recovery of live tasks is not proven.

#### L7 Feedback / Evolution

- Close hook writes a proposed-updates record.
- Conversation runtime's KSTAR hook is mechanical and does not write canonical cognition.
- Recovery attempts are logged, but no durable task journal reconstructs pre-restart recoverable tasks.

```yaml
overall_status: PARTIAL + RECOVERY_BROKEN
first_breakpoint: durable session + ephemeral task state; restart recovery cannot enumerate prior recoverable tasks
strongest_evidence: executor constructor and recovery controller implementation
missing_evidence: process-restart recovery test using real bridge task state
```

### F-10 Forge Runtime Execution / Run Evidence

#### L1 Existence

- CogSeed backend task store, event store, isolated runtime worker, run meta, run events and result projection exist.

#### L2 Trigger / Reachability

- `startCogSeedTask` is production live.
- P3394 can target backend runtime when conversation mode is disabled.
- Worker process has a dedicated entrypoint and JSONL protocol.

#### L3 Input / Data Reality

- Runtime context can include Commander-dispatched assets and confirmed projection assets.
- Worker receives a text context block, not structured asset objects.

#### L4 State / Persistence

- Task events, run meta, run events and output records persist.
- ContextReuseReceipt is prepared by `buildRuntimeAssetContext`.
- No InjectionReceipt or AssetUsageReceipt is written on this path.
- Runtime KSTAR episode sets `abilityAssetRefs: []`.

#### L5 Downstream Consumption

- Runtime events are projected to UI/backend.
- `recordCogSeedTaskRunForRecall` consumes terminal task facts.
- `readKstarRunEvidence` expects Injection/Usage receipts, but this path does not create them.

#### L6 Runtime Effect / Evidence

- Execution evidence exists in task/event/run stores.
- Asset-use evidence is broken between backend runtime and run-evidence.
- Context reuse receipt may remain `prepared` because only group-chat turn finalization completes it.

#### L7 Feedback / Evolution

- Runtime terminal creates KSTAR closure.
- KSTAR attribution cannot reliably tie runtime output to exact assets because episode refs are empty.
- Future reuse cannot learn effective/ineffective asset use on this path.

```yaml
overall_status: PRODUCTION_LIVE + PARTIAL
first_breakpoint: Runtime injects assets but records neither structured injection/usage receipts nor Episode asset refs
strongest_evidence: runtime-asset-context and buildRuntimeKstarEpisode
missing_evidence: production runtime run-evidence linking asset versions to terminal outcome
```

### F-11 KSTAR Episode / Review / Contribution

#### L1 Existence

- Episode builder/store, Review inference/store, attribution, secondary attribution, requirement closure and contribution-like extraction exist.

#### L2 Trigger / Reachability

- Group task terminal subscription is live.
- Runtime terminal capture is live.
- Review cards can be user-facing; current group self-evolution auto-precipitates without requiring user review.

#### L3 Input / Data Reality

- Group Episode uses real messages, tool traces, artifacts, citations and source refs.
- Review can use forecast, conversation history, injection receipts and usage receipts.
- Runtime Episode has weaker asset linkage.

#### L4 State / Persistence

- Episode, Review and ExtractionRun persist.
- Production has 31 episodes, 31 reviews and 31 extraction runs.

#### L5 Downstream Consumption

- Review is consumed by precipitation.
- Trace consumes Episode/Review/Extraction.
- UI can read review/trace.

#### L6 Runtime Effect / Evidence

- Production reviews include deterministic/model inference and some lessons.
- Latest production Episode had no projection/task/requirement/reuse/asset refs.
- Some Reviews have lessons and attribution details, but not all are connected to a canonical change.

#### L7 Feedback / Evolution

- Requirement-level precipitation saves candidates/assets.
- Production extraction runs show no created/candidate/failure IDs, so historical extraction did not prove a current canonical evolve path.

```yaml
overall_status: PRODUCTION_LIVE + PARTIAL
first_breakpoint: Episode/Review exist, but provenance and asset impact are not uniformly present
strongest_evidence: persisted KSTAR records and focused closure tests
missing_evidence: per-run proof that a reviewed contribution changed the next canonical asset version
```

### F-12 Usage / Transfer / Effectiveness Proof

#### L1 Existence

- InjectionReceipt, AssetUsageReceipt, ContextReuseReceipt, ValidationRecord, TransferProof and EffectivenessProof exist.

#### L2 Trigger / Reachability

- Group-chat turn finalization records injection/usage facts.
- Terminal proof services can read receipts.
- Effectiveness feedback is exposed through IPC/UI.

#### L3 Input / Data Reality

- Receipts validate ids, projection ids, asset versions and injection relationships.
- Applied status requires evidence refs and non-`none` evidence kind.
- `usage_unknown` is a first-class honest state.

#### L4 State / Persistence

- Receipts persist in Recall JSONL/local execution directories.
- Production installed data has 15 transfer proofs but zero receipt ids.
- Production has no ContextReuseReceipt and no injection/asset-usage receipt streams.

#### L5 Downstream Consumption

- Run evidence consumes receipts.
- Trace consumes receipts.
- TransferProof can advance maturity only if a valid receipt is found.
- Usage records are read by UI/proofs.

#### L6 Runtime Effect / Evidence

- Historical production proofs completed without receipt ids; under current policy they cannot prove transfer maturity.
- Current code can record better evidence, but current production replay is absent.

#### L7 Feedback / Evolution

- Effectiveness feedback can write validation and maturity.
- Missing receipt blocks upgrade rather than fabricating proof.
- A prepared receipt that is never completed weakens the lifecycle audit.

```yaml
overall_status: PARTIAL + HISTORICAL_EVIDENCE_MIXED
first_breakpoint: historical proof records are not receipt-backed, and some new paths do not produce the expected receipt pair
strongest_evidence: E-08 and proof-service implementation
missing_evidence: a current run with InjectionReceipt -> AssetUsageReceipt -> TransferProof -> EffectivenessProof
```

### F-13 Trace / Run Evidence / Revoke Impact Closure

#### L1 Existence

- KSTAR Trace, run evidence builder, failure records, gaps, source controls and revocation hooks exist.

#### L2 Trigger / Reachability

- Trace is IPC/UI reachable.
- Run evidence is IPC reachable.
- Source revocation has production hooks.
- Asset revoke is UI reachable.

#### L3 Input / Data Reality

- Trace reads real tasks, requirements, projections, receipts, episodes, reviews and extraction runs.
- Run evidence requires task id and task run id.

#### L4 State / Persistence

- Trace is derived read state; it does not own a second truth.
- Gaps explicitly report missing links.
- Revoke impact is not persisted as a unified receipt.

#### L5 Downstream Consumption

- UI reads trace/run evidence.
- Terminal proof consumes evidence.
- Operators can identify missing injection/usage/review/effectiveness.

#### L6 Runtime Effect / Evidence

- Trace can correctly report partial/degraded state.
- If Episode lacks task/requirement/reuse ids, run evidence cannot link the run.
- Direct memory/role facts never appear in Trace/Run Evidence.

#### L7 Feedback / Evolution

- Run evidence is a strong audit surface.
- It does not yet trigger automated impact closure or repair.
- Revocation remains partially outside its blast-radius model.

```yaml
overall_status: PARTIAL + C10_BROKEN
first_breakpoint: revoke impact does not enumerate and invalidate all derived person-level views
strongest_evidence: evidence gap implementation plus E-03 revoke probe
missing_evidence: persisted revoke impact receipt and end-to-end future-read verification
```

## 6. Real Call Chain

### 6.1 Designed Chain

```text
Interaction / Execution / Feedback
→ Experience
→ Candidate
→ Governance
→ Confirmed Cognition
→ Retrieval / Applicability / Binding / Projection
→ P3394/Forge Runtime
→ Run / Trace / Result
→ Usage Receipt / Contribution
→ KSTAR Review
→ Candidate / no_change
→ Governance
→ vNext
```

### 6.2 Current Code Chain

| Step | Layer | File / Symbol | Called By | Reads | Writes | Output | Runtime Evidence | Status |
|---|---|---|---|---|---|---|---|---|
| 1 | Trigger | `group_chat/enqueue` | user, external inbound, task terminal | conversation | state/messages | turn dispatch | production data | CURRENT_CODE_CHAIN |
| 2 | KSTAR routing | `hostRouteTaskTurn` / `executeKstarControl` | Commander turn | task text/lifecycle | task, requirement, projection | projection id | some records | CURRENT_CODE_CHAIN |
| 3 | Retrieval | `buildRecallTaskContract` + hybrid ranker | `applySemanticSelection` | task text, assets, ontology | none | selected assets/omissions | projection matches | CURRENT_CODE_CHAIN |
| 4 | Projection | `previewContextProjection` / `createAutomaticContextProjection` | routing/auto turn | selected assets | projection record | confirmed projection | 7 production projections | CURRENT_CODE_CHAIN |
| 5 | Forecast | `autoForecastForRequirement` / `commitCommanderForecast` | Commander runtime/task open | projection knowledge and ontology | forecast + snapshot | forecast id | 6 production forecasts | CURRENT_CODE_CHAIN |
| 6 | Commander injection | `buildRecallTurnPromptContext` | Commander turn | confirmed projection | prompt text, message citations, usage/injection receipts | injected context | no installed current receipt stream | CURRENT_CODE_CHAIN |
| 7 | Delegate/inherit | dispatch prompt + `buildInheritedCognitionPrompt` | Agent turn | grant/inheritance | prompt + ContextReuseReceipt | target context | code/tests | CURRENT_CODE_CHAIN |
| 8 | Execution | GroupChat or CogSeed runtime | dispatch/task launch | prompt/context | messages/events/result | result/artifact | 21 production execution records | CURRENT_CODE_CHAIN |
| 9 | Episode | `captureGroupKstarClosure` / `captureRuntimeKstarClosure` | terminal subscription | terminal facts/messages | Episode | KSTAR Episode | 31 production episodes | CURRENT_CODE_CHAIN |
| 10 | Review | `inferKstarReview` | closure | Episode, optional forecast/receipts | Review | outcome/lesson/attribution | 31 production reviews | CURRENT_CODE_CHAIN |
| 11 | Usage truth | `persistAssetUsageTruth` | group closure | injection receipts + messages | AssetUsageReceipt | applied/unknown | no production stream | CURRENT_CODE_CHAIN |
| 12 | Precipitation | `precipitateRequirementLevel` | finish/abandon/task switch | episodes/reviews/forecast refs | candidate/asset | candidate or direct asset | extraction runs exist | CURRENT_CODE_CHAIN |
| 13 | Governance | `autoApplyRecallCandidate` / `promoteRecallCandidate` | system/manual | candidate policy/gates | asset + ReviewDecision + handoff receipt | canonical asset | historical promoted candidates | CURRENT_CODE_CHAIN |
| 14 | Future reuse | projection/runtime gates | next run | asset and source state | new projection/receipt | reuse candidate | missing current receipts | CURRENT_CODE_CHAIN |

### 6.3 Proven Runtime Chain

The strongest proven chains in current production evidence are:

```text
Group/terminal fact
→ Episode
→ Review
→ ExtractionRun
```

and, in older records:

```text
confirmed Projection
→ terminal event
→ TransferProof
```

The following chain is **not proven** in the installed production data:

```text
current Projection
→ injection receipt
→ asset usage receipt
→ applied/effectiveness
→ KSTAR review
→ governed asset update
→ future reuse
```

### 6.4 Function-Level Call Ledger

| Function ID | Primary Entry | Decision / Gate | Store | Consumer | Evidence | Verdict |
|---|---|---|---|---|---|---|
| F-01 | `queueRecallCaptureFromTerminal` | capture screening / classification | captures + candidates | inbox/autoApply | capture/candidate records | PARTIAL |
| F-02 | `promoteRecallCandidate` | promotion validation + risk/semantic gate | ability-assets + ReviewDecision | runtime | handoff receipt | PARTIAL: hold bypass |
| F-03 | `pause/revoke/delete` | status mutation | ability-assets/audit | runtime gate | audit | BROKEN for materialized views |
| F-04 | `buildRecallTaskContract` | hybrid selection | projection output | projection builder | match/omission data | PARTIAL |
| F-05 | `confirmContextProjection` | frozen version validation | projections | prompt/forecast/runtime | projection record | PARTIAL |
| F-06 | `buildRecallTurnPromptContext` | runtime eligibility | usage/injection receipts | Commander | citations | PARTIAL |
| F-07 | dispatch/inheritance builder | projection scope + inheritance gate | ContextReuseReceipt | Agent | receipt | PARTIAL |
| F-08 | `cross_session_memory` / PO confirm/profile sync | no unified candidate gate | USER/MEMORY/role fields | every system prompt | none for direct facts | PSEUDO_CLOSED |
| F-09 | `P3394BridgeExecutor.execute` | identity/capability/replay | session + in-memory task | recovery | audit | PARTIAL / recovery broken |
| F-10 | `startCogSeedTask` | task admission | task/event/run stores | projection/result | run events | PARTIAL |
| F-11 | terminal closure | review inference | episodes/reviews | precipitation/trace | 31 records | PARTIAL |
| F-12 | injection/terminal/feedback | receipt matching | receipt/proof stores | maturity/UI | 15 historical proofs | PARTIAL |
| F-13 | trace/run evidence | gap calculation | derived read model | UI/operator | explicit gaps | PARTIAL |

## 7. Closure Diagrams

### F-01 Capture

```text
[Terminal]            ✅ LIVE
→ [Message Input]     ✅ REAL
→ [Screening]         ✅ WIRED
→ [Candidate Store]   ✅ PERSISTED
→ [Review/Policy]     🟡 PARTIAL
→ [Canonical Asset]   🟡 POLICY BYPASS
→ [Usage Evidence]    ❌ NOT GUARANTEED
→ [Future Reuse]      🟡 CONDITIONAL
overall: PARTIAL
first_breakpoint: hold ignored at automatic promotion
```

### F-02 Governance

```text
[Candidate]           ✅
→ [ReviewDecision]    ✅
→ [Promotion Gate]    ✅
→ [Policy Hold]       ❌ NOT ENFORCED
→ [Canonical Asset]   🟡 CAN HAPPEN
→ [Handoff Receipt]   ✅
overall: PARTIAL
first_breakpoint: promotion policy hold
```

### F-03 Lifecycle

```text
[Asset Mutation]      ✅
→ [Asset Status]      ✅
→ [Audit]             ✅
→ [Runtime Gate]      ✅
→ [USER/MEMORY View]  ❌ NOT INVALIDATED
→ [Role Profile View] ❌ NOT INVALIDATED
→ [Impact Receipt]    ❌ MISSING
overall: BROKEN
first_breakpoint: derived view detach
```

### F-04–F-07 Runtime Reuse

```text
[Task/Projection]     ✅
→ [Selection]         ✅
→ [Prompt Injection]  ✅
→ [Injection Receipt] 🟡 PATH-DEPENDENT
→ [Usage Receipt]     🟡 PATH-DEPENDENT
→ [Transfer Proof]    🟡 RECEIPT CONDITIONAL
→ [Effectiveness]     🟡 MANUAL/OBSERVED ONLY
→ [Future Reuse]      🟡 NOT PROVEN
overall: PARTIAL
first_breakpoint: uneven receipt creation across runtime paths
```

### F-08 Personal Memory / Ontology

```text
[Candidate/Tool]      ✅ EXISTS
→ [Governance]        ❌ BYPASSED ON LEGACY/DIRECT PATH
→ [Memory/Profile]    ✅ PERSISTED
→ [Prompt]            ✅ READ
→ [Citation]          ❌ ABSENT
→ [Usage]             ❌ ABSENT
→ [Revoke]            ❌ FAILS TO CLOSE IMPACT
overall: PSEUDO_CLOSED
first_breakpoint: writable derived truth
```

### F-09 P3394

```text
[Envelope]            ✅
→ [Session]           ✅ PERSISTED
→ [Task]              🟡 MEMORY ONLY
→ [Runtime]           ✅ LIVE
→ [Terminal]          ✅
→ [Recovery Sweep]    ❌ NO DURABLE TASK SOURCE AFTER RESTART
overall: PARTIAL
first_breakpoint: task-state durability
```

### F-10–F-13 Forge/KSTAR/Evidence

```text
[Runtime]             ✅
→ [Episode]           ✅ PERSISTED
→ [Review]            ✅ PERSISTED
→ [Attribution]       🟡 PROVENANCE DEPENDENT
→ [Contribution]      ✅ CANDIDATE/ASSET POSSIBLE
→ [Usage/Effect]      🟡 OFTEN MISSING
→ [Governance]        🟡 POLICY BYPASS
→ [vNext]             🟡 NOT PROVEN PER RUN
overall: PARTIAL
first_breakpoint: per-run provenance and evidence continuity
```

## 8. Producer / Consumer Audit

### F-01–F-02

- Producers: terminal capture, manual capture, teaching/import, KSTAR precipitation, legacy PO skill.
- Stores: Recall candidates, ReviewDecision, ability assets, legacy PO Markdown.
- Consumers: inbox, candidate UI, autoApply, promote, cognition dashboard.
- Production consumers: candidate/promotion code and UI channels exist.
- Orphans: legacy PO candidates do not feed Recall candidate governance.
- Shadow consumers: `cognition.candidates.list` reads only PO candidates; `cognition.inbox.list` reads Recall candidates.

### F-03

- Producers: user lifecycle operations, system validation, source control.
- Stores: ability assets, audit, versions.
- Consumers: runtime gate, UI, proof chain.
- Orphans: USER/MEMORY and role-template materializations.

### F-04–F-07

- Producers: retrieval/projection, dispatch, inheritance.
- Stores: projections, message citations, usage/injection receipts, ContextReuseReceipt.
- Consumers: prompt assembly, terminal proof, trace.
- Orphan outputs: ontology synthetic assets in prompt have no citation/usage object.
- Shadow consumers: direct USER/MEMORY/role-profile prompt paths.

### F-08

- Producers: `cross_session_memory`, PO candidate, profile sync, role field writer.
- Stores: USER.md, MEMORY.md, role-template fields, profile projection receipts.
- Consumers: every Core Agent prompt, space role prompt, forecast ontology asset loader.
- Production consumers: definitely reachable.
- Orphans: profile projection records are not used as revocation authority.

### F-09–F-13

- Producers: P3394 executor, CogSeed runtime, KSTAR closure, proof service.
- Stores: session/task maps, task/run stores, episodes, reviews, extraction runs, proofs, traces.
- Consumers: recovery, UI, maturity, precipitation.
- Production consumers: Episode/Review/Trace/UI exist.
- Orphans: historical TransferProofs without receipt ids; current P3394 in-memory tasks after restart.

## 9. Parallel / Bypass Paths

| Semantic Purpose | Path ID | Trigger | Store | Selector / Gate | Runtime Entry | Receipt? | Current Role | Keep? |
|---|---|---|---|---|---|---|---|---|
| Formal asset selection | P-ASSET | projection | ability-assets + projections | hybrid + runtime gate | Commander/Runtime | yes, path-dependent | target main path | keep |
| Legacy PO candidate | P-PO-CAND | skill/UI | local Markdown | none equivalent | USER/MEMORY/role prompt | no | legacy bypass | migrate/stop write |
| Direct memory tool | P-MEM-TOOL | model tool | USER/MEMORY | injection scan + size only | every prompt | no | direct write bypass | gate or governance-wrap |
| Materialized profile | P-PROFILE | asset promote/sync | USER.md/role fields | append-only projection receipt | every prompt | no asset-version citation | derived view accidentally truth | keep as read-only projection |
| Synthetic ontology in projection | P-ONT-PROMPT | confirmed projection | USER/MEMORY/PO groups | lexical fact selection | Commander prompt | no citation | untracked context | adapter + receipt or explicit non-asset channel |
| Inherited cognition | P-INHERIT | agent birth | inheritance snapshot | scope/hash/lifecycle gate | local Agent prompt | load receipt only | separate agent path | keep + usage receipt |
| Commander delegated grant | P-GRANT | dispatch | projection + grant | host validates projection membership | target Agent prompt | load receipt | intended cross-agent path | keep |
| CogSeed Runtime context | P-RUNTIME-CTX | backend launch | projection -> context block | prompt injection builder | isolated worker | context receipt only | execution path | add injection/usage receipts |
| CLI agent | P-CLI | dispatch CLI | none | no Recall injection | CLI process | no | explicit bypass | keep documented |

## 10. Current Truth vs Claim

| Item | Claimed / Expected | Verified | Verdict | Evidence |
|---|---|---|---|---|
| Candidate can be confirmed | Confirmation through governance | Confirmation exists, but legacy PO path bypasses Recall governance | PARTIAL | E-04 |
| Confirmed means policy satisfied | Promotion policy controls auto-promotion | `hold` is ignored | FALSE | E-02, candidate-service |
| Formal asset SoT is unified | Four asset types share formal boundary | Formal asset boundary exists, but person-level facts also live in USER/MEMORY/PO | PARTIAL | E-04, E-05 |
| Runtime uses confirmed projection | Confirmed projection drives context | True for formal assets; ontology facts bypass citation tracking | PARTIAL | E-05 |
| Injected is not used | Usage receipts distinguish them | Implemented in code and some paths; production receipt chain missing | PARTIAL | E-08 |
| TransferProof proves reuse | Proof binds to ContextReuseReceipt | Current code requires receipt, historical proofs have none | TRUE_BUT_SCOPED | E-08, proof-service |
| P3394 restart recovery | Session and task recovery survive restart | Session survives; task state does not | FALSE | F-09 code |
| Revoke affects future authorization | Future eligibility changes and impact closes | Formal asset eligibility changes; materialized views remain | FALSE | E-03 |
| KSTAR creates next cognition | Review leads to candidates/assets | Precipitator exists, but production extraction runs do not prove canonical impact | PARTIAL | E-06 |
| Trace reports reality | Trace surfaces missing facts honestly | Yes, but cannot see uncited memory/ontology paths | PARTIAL | trace implementation |

## 11. Target Position

```yaml
F-01:
  target_domain: Domain A Experience & Learning
  target_authority: Recall candidate ingestion
  target_sot: cloud/recall/records/captures and candidates
  target_contracts: [Experience -> Candidate]
  must_not_own: canonical cognition mutation
F-02:
  target_domain: Domain B Candidate Recognition + Domain C Cognitive Governance
  target_authority: ReviewDecision and promotion gate
  target_sot: candidate + ability-assets + review ledger
  target_contracts: [Candidate -> Governance, Governance -> Canonical Cognition]
  must_not_own: direct derived-view writes
F-03:
  target_domain: Domain C Cognitive Governance
  target_authority: asset lifecycle
  target_sot: ability-assets + version/audit
  target_contracts: [Governance -> Canonical Cognition, Revocation -> Eligibility]
  must_not_own: derived views as competing truth
F-04:
  target_domain: Domain F Cognition Runtime / Reuse
  target_authority: retrieval/applicability
  target_sot: persisted selection evidence attached to projection
  target_contracts: [Retrieval -> Applicability -> Binding -> Projection]
  must_not_own: canonical cognition mutation
F-05:
  target_domain: Domain F Cognition Runtime / Reuse
  target_authority: immutable projection
  target_sot: projections + frozen assetVersions
  target_contracts: [Binding -> Projection, Context Projection -> Session/Task]
  must_not_own: live mutable asset content
F-06:
  target_domain: Domain F + Domain G
  target_authority: injection/use evidence
  target_sot: injection receipt + usage receipt
  target_contracts: [Context Projection -> Runtime, Runtime Evidence -> Usage Receipt]
  must_not_own: canonical cognition
F-07:
  target_domain: Domain F + Domain H + Domain I
  target_authority: delegated/inherited binding
  target_sot: ContextReuseReceipt + inheritance snapshot
  target_contracts: [Projection -> Agent, Usage Receipt]
  must_not_own: expanding authorization beyond projection/inheritance
F-08:
  target_domain: Domain D Personal Ontology + Domain J UI projection
  target_authority: canonical person cognition remains governed asset/PO authority; USER/MEMORY/role are views
  target_sot: confirmed cognition + PO semantic store, not raw prompt files
  target_contracts: [Governance -> Canonical Cognition, Canonical Cognition -> Runtime]
  must_not_own: independent writable lifecycles
F-09:
  target_domain: Domain G P3394 Bridge / Session
  target_authority: session/task identity and recovery
  target_sot: durable session + durable task journal
  target_contracts: [Context Projection -> Session/Task, Runtime Evidence -> Usage Receipt]
  must_not_own: long-term personal cognition
F-10:
  target_domain: Domain H Forge Task Runtime
  target_authority: execution facts
  target_sot: task/event/result/run trace
  target_contracts: [Projection -> Forge, Runtime Evidence -> Usage Receipt]
  must_not_own: canonical person state
F-11:
  target_domain: Domain A + Domain B
  target_authority: Episode/Review/Contribution
  target_sot: KSTAR episodes/reviews
  target_contracts: [Execution -> Contribution, Contribution -> KSTAR, KSTAR -> Candidate]
  must_not_own: direct canonical mutation
F-12:
  target_domain: Domain F + Domain KSTAR Learning
  target_authority: usage/transfer/effect evidence
  target_sot: receipts and proofs
  target_contracts: [Runtime Evidence -> Usage Receipt, Contribution -> KSTAR]
  must_not_own: inferred “used” without evidence
F-13:
  target_domain: Nexus Operations + Cognition Runtime
  target_authority: derived audit and impact closure
  target_sot: trace/run evidence derived from authoritative records
  target_contracts: [Revocation -> Eligibility -> Rebind/Stop -> Impact Closure]
  must_not_own: second lifecycle truth
```

## 12. Minimal Migration

```yaml
F-01:
  function: Experience Capture -> Candidate
  current_value: real terminal capture and candidate persistence
  current_problem: legacy PO candidates bypass the unified candidate store
  target_domain: Domain A
  target_sot: Recall candidate store
  target_contract: Experience -> Candidate
  keep: [capture orchestrator, screening, candidate schema]
  re_scope: [PO candidate skill becomes extractor only]
  adapter: [PO candidate -> saveRecallCandidate]
  stop_new_writes: [PO candidates.md as lifecycle owner]
  migrate: [pending legacy PO candidates]
  merge: [candidate inbox and cognition candidate list]
  deprecate: [dual pending-candidate UIs]
  rebuild: []
  runtime_verification: [capture -> candidate -> inbox -> review decision]
  estimated_change_shape: MEDIUM

F-02:
  function: Candidate Governance -> Formal Asset
  current_value: strong promotion gates and review ledger
  current_problem: hold ignored; direct memory writes bypass governance
  target_domain: Domain B + Domain C
  target_sot: candidate + ReviewDecision + ability-assets
  target_contract: Candidate -> Governance -> Canonical Cognition
  keep: [promotion validation, semantic review, handoff receipt]
  re_scope: [autoApply becomes policy executor only]
  adapter: [direct-memory explicit user intent -> governed candidate/decision]
  stop_new_writes: [legacy PO candidate direct memory write]
  migrate: [legacy candidates and explicit direct memory requests]
  merge: [single candidate queue]
  deprecate: [parallel auto-confirm semantics]
  rebuild: []
  runtime_verification: [hold blocks, pause blocks, validation advances, user explicit accept works]
  estimated_change_shape: MEDIUM

F-03:
  function: Asset Lifecycle / Version / Revoke
  current_value: versioned asset lifecycle and audit
  current_problem: derived USER/role views survive revoke
  target_domain: Domain C
  target_sot: ability-assets + version/audit
  target_contract: Revocation -> Eligibility -> Impact Closure
  keep: [status machine, versions, rollback, audit]
  re_scope: [USER/role are views, not canonical state]
  adapter: [view detach/rebuild API]
  stop_new_writes: [role/profile values without source asset/version]
  migrate: [materialized records get source id/version]
  merge: []
  deprecate: [untracked profile fields]
  rebuild: []
  runtime_verification: [pause/revoke/delete/purge then next prompt has no fact]
  estimated_change_shape: MEDIUM

F-04:
  function: Task Contract / Hybrid Retrieval
  current_value: hybrid ontology + semantic selection and omission reasons
  current_problem: contract decision not persisted as first-class evidence
  target_domain: Domain F
  target_sot: projection selection evidence
  target_contract: Retrieval -> Applicability -> Binding -> Projection
  keep: [task contract algorithm, hybrid ranker, thresholds]
  re_scope: [persist only bounded decision facts]
  adapter: [projection selection evidence object]
  stop_new_writes: []
  migrate: [legacy projections get degraded/no-contract marker]
  merge: []
  deprecate: []
  rebuild: []
  runtime_verification: [same task/context produces explainable selected/omitted set]
  estimated_change_shape: SMALL

F-05:
  function: Context Projection / Freeze / Confirm
  current_value: immutable confirmed projection and version pinning
  current_problem: consumers do not uniformly emit receipts; ontology is uncited
  target_domain: Domain F
  target_sot: projection record
  target_contract: Binding -> Projection -> Runtime
  keep: [projection schema, frozen versions, confirmation]
  re_scope: [ontology facts are explicit non-asset projection entries]
  adapter: [uniform consumer receipt adapter]
  stop_new_writes: []
  migrate: [ontology facts get stable refs/version or non-asset marker]
  merge: []
  deprecate: []
  rebuild: []
  runtime_verification: [every consumer emits projection id + consumed refs]
  estimated_change_shape: MEDIUM

F-06:
  function: Commander Prompt Injection / Injection Receipt
  current_value: citations, usage ledger, injection receipt
  current_problem: applied/effective often missing and current production evidence absent
  target_domain: Domain F
  target_sot: injection/usage receipts
  target_contract: Runtime Evidence -> Usage Receipt
  keep: [prompt assembler, citation metadata, usage ledger]
  re_scope: [applied only with observable evidence]
  adapter: [model-declared usage remains claimed_used and is not canonical]
  stop_new_writes: [none]
  migrate: [legacy usage records remain historical]
  merge: [usage and injection receipts under one evidence boundary]
  deprecate: [ambiguous used labels]
  rebuild: []
  runtime_verification: [injected -> applied/usage_unknown -> effect decision]
  estimated_change_shape: SMALL

F-07:
  function: Delegated Grant / Inherited Cognition
  current_value: explicit grant validation and inheritance integrity checks
  current_problem: load receipts only; no applied/effect receipt
  target_domain: Domain F + H + I
  target_sot: ContextReuseReceipt + inheritance snapshot
  target_contract: Projection -> Agent -> Usage Receipt
  keep: [selection and prompt rendering]
  re_scope: [agent result may propose contribution, not canonical mutation]
  adapter: [terminal evidence -> asset usage receipt]
  stop_new_writes: []
  migrate: [legacy inherited refs remain load-only]
  merge: []
  deprecate: []
  rebuild: []
  runtime_verification: [dispatch and inheritance each produce load + use decision]
  estimated_change_shape: MEDIUM

F-08:
  function: Persistent Memory / Personal Ontology
  current_value: mature storage, routing, grouping and prompt rendering
  current_problem: writable competing truth and no revocation closure
  target_domain: Domain D + Domain J
  target_sot: governed cognition + PO semantic store
  target_contract: Governance -> Canonical Cognition -> Runtime
  keep: [grouping, role templates, routing, prompt renderers]
  re_scope: [USER/MEMORY/role fields become derived views]
  adapter: [legacy direct writes -> candidate/governance; read adapter exposes source refs]
  stop_new_writes: [direct cross_session_memory user/shared, legacy PO confirm direct write]
  migrate: [materialized facts back-reference canonical asset/version]
  merge: [candidate stores]
  deprecate: [raw memory as independent person model]
  rebuild: []
  runtime_verification: [explicit remember -> candidate/decision -> view -> revoke removes]
  estimated_change_shape: LARGE

F-09:
  function: P3394 Session / Task / Recovery
  current_value: robust protocol, session persistence, outbox and audit
  current_problem: task state is in memory
  target_domain: Domain G
  target_sot: durable session + task journal
  target_contract: Session/Task -> Forge Runtime
  keep: [protocol kernel, channels, registry, outbox, session manager]
  re_scope: [task manager to journal-backed store]
  adapter: [default conversation tasks persist adapter mapping and terminal state]
  stop_new_writes: [in-memory task lifecycle as restart SoT]
  migrate: [existing recoverable runtime tasks where available]
  merge: []
  deprecate: []
  rebuild: []
  runtime_verification: [kill/restart during recoverable task -> sweep resumes without re-delivery]
  estimated_change_shape: MEDIUM

F-10:
  function: Forge Runtime Execution / Run Evidence
  current_value: isolated execution and durable task/run events
  current_problem: no structured injection/usage receipt and empty runtime Episode asset refs
  target_domain: Domain H
  target_sot: task/run/event/result store
  target_contract: Projection -> Forge -> Runtime Evidence
  keep: [worker boundary, event store, run store]
  re_scope: [context assembler emits structured asset metadata]
  adapter: [runtime context manifest -> injection receipt -> episode asset refs]
  stop_new_writes: []
  migrate: [legacy runtime runs remain degraded]
  merge: []
  deprecate: []
  rebuild: []
  runtime_verification: [one runtime run yields injection + usage + episode linkage]
  estimated_change_shape: MEDIUM

F-11:
  function: KSTAR Episode / Review / Contribution
  current_value: real learning chain and traceable review objects
  current_problem: uneven provenance and canonical impact
  target_domain: Domain A + Domain B
  target_sot: episodes/reviews/contributions
  target_contract: Contribution -> KSTAR -> Candidate
  keep: [Episode builder, inference, attribution, precipitation]
  re_scope: [Review cannot directly mutate canonical cognition]
  adapter: [missing provenance becomes explicit degraded contribution]
  stop_new_writes: []
  migrate: [legacy episodes remain unlinked]
  merge: []
  deprecate: [legacy P3394 parallel episode store where superseded]
  rebuild: []
  runtime_verification: [closed run -> episode -> review -> candidate -> governance -> vNext]
  estimated_change_shape: MEDIUM

F-12:
  function: Usage / Transfer / Effectiveness Proof
  current_value: rich evidence model and honest unknown/degraded states
  current_problem: not all runtime paths create receipt chains; historical proofs lack receipts
  target_domain: Domain F + KSTAR Learning
  target_sot: receipt/proof stores
  target_contract: Runtime Evidence -> Usage Receipt -> KSTAR
  keep: [receipt schemas, proof rules, maturity policy]
  re_scope: [all consumers use one receipt writer]
  adapter: [complete ContextReuseReceipt from runtime terminal]
  stop_new_writes: []
  migrate: [legacy proofs remain historical, not maturity authority]
  merge: [injection/use/transfer/effect in one audit read model]
  deprecate: []
  rebuild: []
  runtime_verification: [receipt chain covers every injected path and blocks maturity without proof]
  estimated_change_shape: MEDIUM

F-13:
  function: Trace / Run Evidence / Revoke Impact Closure
  current_value: transparent derived audit and gap reporting
  current_problem: blast radius excludes materialized memory/role views
  target_domain: Nexus Operations
  target_sot: derived from authoritative stores
  target_contract: Revocation -> Eligibility -> Rebind/Stop -> Impact Closure
  keep: [trace schema, run evidence, gap codes]
  re_scope: [impact closure from narrative policy to executable contract]
  adapter: [generic derived-view invalidation interface]
  stop_new_writes: [states that cannot reference source asset/version]
  migrate: [legacy derived facts marked unmanaged]
  merge: []
  deprecate: []
  rebuild: []
  runtime_verification: [revoke one asset -> all derived views invalidated -> impact receipt complete]
  estimated_change_shape: MEDIUM
```

## 13. Functional Closure Matrix

| Function | Trigger | Persist | Consumer | Runtime | Evidence | Feedback | Future Reuse | Closure |
|---|---|---|---|---|---|---|---|---|
| F-01 Capture | yes | yes | yes | via projection | partial | review decision | conditional | PARTIAL |
| F-02 Governance | yes | yes | yes | gate | handoff receipt | yes | yes | PARTIAL |
| F-03 Lifecycle | yes | yes | yes | gate | audit/version | validation | broken after revoke | BROKEN |
| F-04 Retrieval | yes | projection only | yes | yes | matches/omissions | no scoring feedback | yes | PARTIAL |
| F-05 Projection | yes | yes | yes | yes | version freeze | decisions | yes | PARTIAL |
| F-06 Commander Injection | yes | citations/receipt | yes | yes | path-dependent | feedback IPC | conditional | PARTIAL |
| F-07 Grant/Inheritance | yes | load receipt | yes | yes | load only | none | unscored | PARTIAL |
| F-08 Memory/PO | yes | multiple stores | yes | every prompt | none for direct path | direct edits | revoke broken | PSEUDO_CLOSED |
| F-09 P3394 | yes | session only | yes | yes | audit | close record | recovery broken | PARTIAL |
| F-10 Forge Runtime | yes | events/run | yes | yes | run events | KSTAR | conditional | PARTIAL |
| F-11 KSTAR | yes | yes | yes | no | Episode/Review | precipitation | partial | PARTIAL |
| F-12 Proof | yes | yes | yes | yes | receipt-dependent | validation | conditional | PARTIAL |
| F-13 Trace/Impact | yes | derived | yes | read-only | explicit gaps | repair missing | impact missing | PARTIAL |

## 14. Entry Reachability Matrix

| Claimed Entry | Exists? | Producer / Caller | User Reachable? | Production Reachable? | Current Status | Evidence |
|---|---|---|---|---|---|---|
| Capture terminal | yes | boot subscription | indirect | yes | PRODUCTION_LIVE | main boot |
| Manual capture | yes | IPC/UI | yes | yes | PRODUCTION_LIVE | IPC |
| Recall candidate UI | yes | IPC/UI | yes | yes | PRODUCTION_LIVE | cognition inbox |
| Legacy PO candidate UI | yes | IPC/UI | yes | yes | PRODUCTION_LIVE | cognition candidates |
| Candidate promotion | yes | IPC/system | yes | yes | PRODUCTION_LIVE | promotion code/data |
| Asset lifecycle | yes | IPC/UI | yes | yes | PRODUCTION_LIVE | asset service |
| Projection confirmation | yes | IPC/host routing/wake | yes | yes | PRODUCTION_LIVE | projection records |
| Prompt injection | yes | Commander turn | indirect | yes | PRODUCTION_LIVE | bus prompt path |
| Dispatch grant | yes | Commander tool | indirect | yes | PRODUCTION_LIVE | dispatch tools |
| Inherited cognition | yes | Agent turn | indirect | yes | PRODUCTION_LIVE | selection code |
| Direct memory tool | yes | model tool | model-mediated | yes | PRODUCTION_LIVE | runner wiring |
| P3394 inbound bridge | yes | boot listener | external peer | yes | PRODUCTION_LIVE | running gateway |
| P3394 restart recovery | yes | timer sweep | no explicit UI | no for in-memory tasks | BROKEN | F-09 code |
| Forge runtime | yes | task launch | backend/peer | yes | PRODUCTION_LIVE | runtime code/data |
| KSTAR trace | yes | IPC/UI | yes | yes | PRODUCTION_LIVE | IPC |
| Run evidence | yes | IPC/UI | yes | conditional | PARTIAL | requires linked ids |
| Revoke impact closure | partial | lifecycle/UI | yes | no full closure | BROKEN | E-03 |

## 15. Consumer / Orphan Output Matrix

| Output / Object | Produced By | Stored Where | Consumers | Production Consumers | Final Effect | Orphan? |
|---|---|---|---|---|---|---|
| Capture | terminal/manual | Recall records | candidate creation/UI | yes | candidate | no |
| Recall Candidate | capture/KSTAR/import | Recall records | inbox/promotion | yes | asset | no |
| PO Candidate | legacy skill/UI | local Markdown | cognition candidates | yes | USER/MEMORY | bypass orphan |
| ReviewDecision | promotion/manual | cloud review-decision | audit/history/inbox | yes | governance receipt | no |
| Ability Asset | promotion | Recall records | runtime/UI | yes | reuse | no |
| Projection | retrieval | Recall records | prompt/forecast/runtime | yes | context | no |
| Synthetic Ontology Asset | prompt knowledge loader | ephemeral | prompt only | yes | model context | no citation |
| USER/MEMORY Materialization | direct tool/PO/profile sync | cloud memory | every prompt | yes | person model | no managed revoke |
| Injection Receipt | group-chat path | Recall JSONL | trace/run evidence | no in installed data | usage truth | current orphan/absent |
| Asset Usage Receipt | KSTAR closure | Recall JSONL | trace/run evidence | no in installed data | applied/unknown | current orphan/absent |
| ContextReuseReceipt | prompt/dispatch/inheritance/runtime | local execution dirs | terminal proof/UI | 0 in installed data | transfer proof | current orphan/absent |
| Episode | terminal closure | KSTAR records | review/trace | yes | learning fact | no |
| Review | closure | KSTAR records | precipitation/trace/UI | yes | learning judgment | no |
| ExtractionRun | precipitation | KSTAR records | trace/UI | yes | candidate/asset result | production result ids empty |
| TransferProof | terminal proof | Recall records | maturity/UI | yes | transfer evidence | historical receipt orphan |
| EffectivenessProof | user feedback | Recall records | maturity/UI | conditional | effectiveness | conditional |
| P3394 Task | bridge executor | memory | recovery | yes in-process | recovery | orphan after restart |

## 16. Duplicate / Parallel / Shadow Architecture

| Kind | Current Duplication | Consequence | Target |
|---|---|---|---|
| Candidate | Recall candidate vs PO Markdown candidate | two review queues/lifecycles | one candidate intake |
| Confirmed person truth | Formal personal asset vs USER.md/MEMORY.md vs role-template field | multiple writable truths | formal asset/PO canonical; views derived |
| Write path | promotion vs PO confirm vs `cross_session_memory` vs profile sync | governance bypass | one canonical mutation contract |
| Runtime read | projection injection vs direct memory vs role profile vs inheritance vs runtime context | receipt coverage differs | uniform projection/binding layer |
| Usage | usage-records vs injection receipt vs asset usage receipt vs ContextReuseReceipt | different meanings | explicit state machine per stage |
| Lifecycle | asset status vs memory entry existence vs role field presence | revoke divergence | asset governance drives views |
| Version | asset version vs memory content hash vs role field text | no single rollback unit | asset/version authority |
| UI truth | recall inbox vs cognition candidate page vs dashboard count | different totals | projection of one read model |
| KSTAR fact | cloud KSTAR Episode vs P3394 bridge episode | duplicate learning narratives | one canonical Episode, bridge as adapter |
| P3394 task | durable session vs in-memory bridge task vs backend task store | recovery ambiguity | durable identity mapping |

## 17. Unified-Path Audit

```yaml
semantic_sot_unified:
  current: PARTIAL
  target: four formal assets + governed PO semantics own canonical cognition; views derive
  gap: USER/MEMORY/role fields remain writable truth
  minimal_fix: source-tag every materialized value and make views read-only/rebuildable

canonical_write_unified:
  current: NOT_UNIFIED
  target: ReviewDecision + promotion/update path is the only canonical mutation
  gap: direct memory, PO confirm, profile sync
  minimal_fix: adapters into candidate/governance; stop direct canonical writes

runtime_read_unified:
  current: NOT_UNIFIED
  target: retrieval/applicability/binding/projection before all cognition injection
  gap: direct memory and role profile bypass
  minimal_fix: expose them as projection sources with source refs and receipts

binding_projection_unified:
  current: PARTIAL
  target: one frozen projection per run/purpose
  gap: dispatch/inheritance/runtime have separate adapters
  minimal_fix: normalize all into projection/binding manifest

runtime_evidence_unified:
  current: NOT_UNIFIED
  target: injection receipt + usage receipt + transfer/effect proof on every path
  gap: backend runtime, inheritance, direct memory
  minimal_fix: one host-side receipt writer used by all adapters

lifecycle_unified:
  current: NOT_UNIFIED
  target: asset lifecycle controls all derived views
  gap: USER/MEMORY/role projection survives revoke
  minimal_fix: derived-view invalidation registry and impact receipt

learning_update_unified:
  current: PARTIAL
  target: Contribution -> KSTAR -> Candidate -> Governance -> vNext
  gap: system promotion policy bypass; historical extraction result ids empty
  minimal_fix: enforce promotion policy and persist contribution/canonical links
```

## 18. Personal Ontology Cross-Audit

### PO-1 本模块是否保存长期 person-level 信息？

是。四类正式资产中的 `personal`、PO groups、role-template fields、USER.md、MEMORY.md 都保存长期人员信息。

### PO-2 这些信息属于哪种对象？

| Store | Object Kind |
|---|---|
| `ability-assets.personal` | Confirmed Cognition |
| Recall candidate | Candidate |
| USER.md | Materialized Profile View |
| MEMORY.md | Materialized Shared View |
| PO group fields | Structured Person-level Store / Projection Source |
| role-template field | Structured Person-level Store / Projection Source |
| synthetic ontology asset | Prompt-time Projection, not canonical asset |
| personal-profile projection record | Sync Cache / Receipt |

### PO-3 是否存在相同正文的多个副本？

是。可同时存在于 formal personal asset、USER.md、MEMORY.md、role-template field、profile projection record 和 prompt-time ontology asset。

### PO-4 canonical id/version 在哪里？

正式资产的 canonical id/version 在 `ability-assets`。USER.md/MEMORY.md/role fields 当前不一定保留对应 asset id/version；仅部分 profile projection receipt 保存 provenance。

### PO-5 Runtime 读取 PO 的路径是什么？

- Commander committed projection: `loadCommittedProjectionKnowledge` 将 USER/MEMORY 转成 synthetic `personal` assets，并加入 prompt。
- Every Core Agent turn: `formatForSystemPrompt` 直接读取 USER.md/MEMORY.md。
- Space turn: `formatRoleProfileForSystemPrompt` 直接读取 role-template fields。
- Projection knowledge / forecast: PO groups and rules enter Forecast payload.

### PO-6 是否经过 Retrieval → Applicability → Binding → Projection → Injection → Receipt → Usage？

不完全。

- formal assets: 经过 selection/projection/gate，部分路径有 receipt。
- USER/MEMORY/role direct prompt: 没有统一 Retrieval/Applicability/Binding，也没有 asset-version receipt。
- synthetic ontology prompt assets: 没有 citations、injection receipt 或 usage receipt。

### PO-7 能否反向回答哪条 Personal Cognition 在哪个 Task/Run 被真正使用？

对正式资产的部分群聊路径可以回答到 injection/load；对 applied/effective 多数不能。对 USER/MEMORY/role direct prompt 路径不能。

### PO-8 PO update/revoke 后各副本如何处理？

| Target | Current Behavior |
|---|---|
| Current Run | Formal asset live gate can stop future prompt reads, but already injected text is historical |
| Next Run | Formal asset gate rechecks; materialized USER/MEMORY/role views can still inject |
| Role copy | Not detached on asset revoke |
| Memory copy | USER.md not filtered by asset lifecycle; MEMORY.md can be filtered only for cognition-sourced shared records, not all profile copies |
| Agent snapshot | Inheritance revalidates asset version/status, but old glossary may still be injected |
| Workspace copy | Space notes and role fields are not governed by the revoked asset |

**Finding:** PO is semantically important but not yet the sole canonical owner. It is both a source and a materialized runtime bypass.

## 19. P3394 / Forge / KSTAR Cross-Audit

### P3394

| Check | Result |
|---|---|
| Self-created session id | No for bridge; session ids come from envelopes/outbound store |
| Self-created task continuation | Bridge task ids are envelope-derived but lifecycle is memory-only |
| Chat summary as Session SoT | Conversation adapter uses bus messages; session truth remains bridge session + conversation |
| Memory instead of Case | KSTAR Episode covers group/runtime execution; P3394 hook is separate mechanical record |
| Bypass Local Bridge / Session authority | Conversation adapter routes through bus, but external inbound sets `skipKstarRouting: true` |
| Two Task states | Yes: P3394 bridge task, CogSeed backend task, and KSTAR task can exist |
| Recovery from journal | Session and outbox/cursor durable; bridge task lifecycle not durable |
| Projection binds sessionId + taskId | Partial; group/runtime provenance exists, external conversation path skips KSTAR routing |
| Run reverse-links Session/Task | Partial; CogSeed backend links exist, but P3394 bridge task mapping is memory-only |

### Forge

| Check | Result |
|---|---|
| Task Skill source | Runtime/skill stores and dispatch configuration |
| Task Ontology source | Projection knowledge / task context; not a distinct persisted Task Ontology |
| Input snapshot locked | Projection assets are version-frozen; runtime text context is not structured |
| Run independent | Yes |
| Artifact linked to Run | Task event/artifact store, but KSTAR runtime episode uses produced file summaries |
| Trace immutable/locatable | Run events are append-only; KSTAR runtime episode is derived |
| Result has evidence | Partial |
| Task Agent mutates person cognition | Direct tools can write memory; dispatch agent path generally returns contribution |
| Personal Projection overrides Task Skill | No evidence of override; both are separate prompt sources |
| execution success vs business approval | Distinguished for P3394 approval; KSTAR auto-precipitation is not human approval |

### KSTAR

| Check | Result |
|---|---|
| Input source | Real Episode/Review; forecast/receipts when available |
| Can locate original version | Formal asset provenance exists; direct memory copies may not |
| Episode produced | Yes |
| Learning conclusion consumer | Precipitation and trace |
| Forecast file only | No, forecast is used in review when provenance complete |
| Proposal downstream consumer | Candidate/asset path |
| Candidate created | Code yes; installed extraction run result ids did not prove it |
| no_change | Implicitly via empty proposals, but not a strong first-class object |
| Direct update canonical cognition | It writes candidate then autoApply; governance exists but promotion policy bug allows direct system canonical write |
| Next version read by Runtime | Conditional on status/maturity/runtime path |

## 20. Contract C1–C10 Audit

| Contract | Current Producer | Current Consumer | Current Carrier | Reality Status | First Breakpoint | Target Producer | Target Consumer | Minimal Change |
|---|---|---|---|---|---|---|---|---|
| C1 Experience → Candidate | capture/import/KSTAR | Recall candidate | capture/candidate JSON | PARTIAL | legacy PO bypass | Experience adapters | candidate | unify intake |
| C2 Candidate → Governance | candidate | ReviewDecision/promotion | candidate + review jsonl | PARTIAL | hold ignored | candidate | governance | enforce policy |
| C3 Governance → Canonical | promotion | ability-assets | asset + handoff receipt | PARTIAL | direct memory bypass | governance | canonical store | stop alternate writes |
| C4 Canonical → Runtime | projection/runtime gates | prompts/runtime workers | projection/context | PARTIAL | uncited ontology and direct memory | canonical + projection | runtime | projection all cognition reads |
| C5 Retrieval → Applicability → Binding → Projection | Recall | projection | projection + matches | PARTIAL | contract not first-class | Recall | projection | persist bounded contract evidence |
| C6 Projection → Session/Forge/Agent | bridge/group/runtime | runtime | context/prompt/receipt | PARTIAL | uneven receipts | projection adapter | runtime | one manifest and receipt writer |
| C7 Runtime Evidence → Usage Receipt | injection/terminal/feedback | proof/trace | receipts | PARTIAL | runtime/inheritance gaps | runtime | receipt service | emit all stages |
| C8 Execution → Contribution | runtime/KSTAR | review/candidate | Episode/Review | PARTIAL | provenance gaps | Forge | KSTAR | explicit contribution object |
| C9 Contribution → KSTAR → Candidate → Governance → vNext | KSTAR | candidate/asset | episode/review/candidate | PARTIAL | policy bypass | KSTAR | governance | enforce hold/validation |
| C10 Revoke → Eligibility → Impact Closure | lifecycle/source control | runtime/views | status/audit | BROKEN | materialized views | governance | impact registry | derived-view invalidation |

## 21. BEFORE_AUDIT → VERIFIED_CURRENT Diff

| Capability | BEFORE_AUDIT Claim / Understanding | VERIFIED_CURRENT | Changed? | Why | Evidence |
|---|---|---|---|---|---|
| Candidate confirmation | governed confirmation | governed Recall path plus legacy PO bypass | 收窄 | one semantic question has two entries | E-04 |
| Formal asset unity | four asset types unified | formal read boundary unified; person truth not | 收窄 | materialized views remain source-like | E-03/E-05 |
| KSTAR loop | main chain exists | Episode/Review/precipitation code and records exist | 证实 | production records show stages | E-06 |
| KSTAR canonical impact | learning updates cognition | autoApply can update, but policy hold bypass exists | 推翻部分 | policy and implementation disagree | E-02/E-09 |
| Usage proof | injected/used/effective distinguished | code distinguishes; production chain absent | 收窄 | historical proofs lack receipts | E-08 |
| Personal Ontology in Runtime | PO enters Runtime | yes, but uncited and partly bypassed | 收窄 | synthetic ontology excluded from citations | E-05 |
| Restart recovery | durable task recovery | session durable; task state ephemeral | 推翻 | F-09 implementation | code |
| Revocation | future authorization changes | formal eligibility changes; derived facts survive | 推翻 | E-03 | runtime probe |
| Trace truth | trace reports actual state | trace is honest and gap-aware, but blind to direct memory path | 收窄 | trace only reads receipts and KSTAR facts | trace code |
| Projection freeze | frozen exact versions | true for formal assets | 证实 | `assetVersions` validation | projection code/tests |

## 22. Current → Target Functional Mapping

| Current Function / Component | Current Reality | Current SoT | Target Domain | Target SoT | Decision | Change Size | Reason |
|---|---|---|---|---|---|---|---|
| Recall Capture | live and useful | capture store | Domain A | capture store | KEEP | S | core intake is sound |
| Recall Candidate | live unified store | candidates | Domain B | candidates | KEEP | S | preserve schema/gates |
| PO Candidate | live bypass | local Markdown | Domain B | Recall candidate | KEEP+ADAPTER | M | no rewrite; migrate intake |
| ReviewDecision | real ledger | review-decision files | Domain C | same | KEEP | S | governance provenance |
| Promotion policy | exists | policy fn | Domain C | same | RE-SCOPE | S | must enforce hold |
| Formal Assets | canonical for four types | ability-assets | Domain C/D/E | same | KEEP | S | mature implementation |
| USER/MEMORY materialization | writable runtime truth | memory files | Domain J projection | derived from canonical | RE-SCOPE | L | critical authority fix |
| Role-template materialization | writable profile source | role fields | Domain D/J | governed projection | RE-SCOPE | M | same as memory |
| Task Contract | functional | transient | Domain F | projection evidence | KEEP+ADAPTER | S | persist rationale |
| Hybrid Retrieval | functional | transient/result | Domain F | projection evidence | KEEP | S | already useful |
| Context Projection | frozen/confirmed | projection | Domain F | same | KEEP | S | correct boundary |
| Commander injection | live | prompt/receipts | Domain F | receipts | REWIRE | M | uniform receipts |
| Dispatch/Inheritance | live | context receipt | Domain F/H/I | same | KEEP+ADAPTER | M | add usage evidence |
| Backend Runtime context | live but under-instrumented | run events | Domain H | run/evidence | REWIRE | M | structured context/receipt |
| KSTAR Episode | live | episodes | Domain A | same | KEEP | S | strong fact object |
| KSTAR Review | live | reviews | Domain A/B | same | KEEP | S | preserve inference |
| Precipitation | functional | candidates/assets | Domain B/C | candidate | RE-SCOPE | M | no direct canonical without governance |
| Transfer Proof | real schema | proof records | Domain F | same | KEEP | S | especially good design |
| Trace/Run Evidence | useful audit | derived | Nexus | same | KEEP | S | extend coverage |
| P3394 session | durable | session file | Domain G | same | KEEP | S | correct |
| P3394 task | in memory | Map | Domain G | durable journal | MIGRATE | M | recovery correctness |
| P3394 bridge episode | parallel hook | global/legacy | Domain A adapter | KSTAR Episode | DEPRECATE/MERGE | M | avoid competing fact SoT |

## 23. Old Closed-loop → New Closed-loop

### 23.1 Learning Loop

#### Current

```text
terminal result
→ Episode
→ Review
→ precipitation proposal
→ Recall candidate
→ autoApply/propose
→ formal asset
```

#### Breakpoints

- `NO_EVIDENCE`: many paths cannot prove applied.
- `NO_GOVERNANCE`: policy hold can be ignored.
- `WRONG_SOT`: candidate and direct memory writes coexist.

#### Target

```text
Execution
→ Usage Receipt
→ Episode
→ Review / Attribution
→ Contribution
→ Candidate
→ Governance
→ Asset vNext
```

#### Minimal Delta

- Keep Episode/Review/precipitation.
- Require `usage status` in Review.
- Treat every precipitation result as Contribution.
- Route all candidate writes through one store.
- Enforce promotion policy.

#### Runtime Verification

```text
Run A:
inject asset version V1
→ record usage_unknown/applied
→ review finds improvement or gap
→ create candidate
→ policy hold or approve
→ asset V2 or no_change

Run B:
projection contains V2/no_change decision
```

### 23.2 Reuse Loop

#### Current

```text
Task
→ retrieval
→ projection
→ Commander/Agent prompt
→ receipts on some paths
→ terminal proof
```

#### Breakpoints

- `BYPASS`: USER/MEMORY/role prompt path.
- `NO_EVIDENCE`: runtime and inheritance applied state.
- `WRONG_SOT`: synthetic ontology assets are not real assets.

#### Target

```text
Task
→ Context Projection
→ Binding Manifest
→ Runtime/Actor
→ Injection Receipt
→ Usage Receipt
→ Transfer/Effect Proof
```

#### Minimal Delta

- Keep projection freeze and receipt schemas.
- Emit a manifest for every context source.
- Persist citations/receipt IDs for ontology facts separately from ability assets.
- Add applied/unknown decision for every injected item.

#### Runtime Verification

```text
one run with three injected sources:
ability asset
PO fact
role profile
→ three receipts
→ one usage status each
```

### 23.3 Revocation Loop

#### Current

```text
asset revoke
→ asset.status=revoked
→ runtime gate blocks future candidate selection
→ USER/role copies may remain
```

#### Breakpoints

- `NO_REVOKE`
- `SHADOW_STATE`
- `NO_CONSUMER`

#### Target

```text
revoke
→ eligibility invalidation
→ derived-view invalidation
→ current run stops future reads
→ impact receipt
→ next prompt verified clean
```

#### Minimal Delta

- Keep status/audit.
- Add derived-view registry.
- Detach USER/MEMORY/role copies by source asset id/version.
- Record impact closure.

#### Runtime Verification

```text
create personal asset
→ materialize USER/role
→ revoke
→ current prompt no fact
→ restart
→ next prompt no fact
→ impact receipt complete
```

## 24. Target Call Graph

```text
[Interaction / Execution / Feedback]
  ← reuse current capture/import/runtime terminal adapters
        ↓
[Experience + Evidence]
  ← reuse capture records, messages, receipt refs
        ↓
[Single Candidate Intake]
  ← reuse Recall saveRecallCandidate
  ← adapter legacy PO candidate
  ← adapter explicit memory tool writes
        ↓
[Cognitive Governance]
  ← reuse evaluatePromotionPolicy + validation + ReviewDecision
  ← enforce hold instead of treating it as no-op
        ↓
[Canonical Cognition]
  ← reuse ability-assets
  ← PO semantic store exposed through governed contract
  ← USER/MEMORY/role fields become derived views
        ↓
[Retrieval → Applicability → Binding]
  ← reuse task-contract + hybrid retrieval + runtime gate
        ↓
[Immutable Context Projection + Binding Manifest]
  ← reuse projections
  ← add source refs for ontology/role facts
        ↓
[P3394 Session / Task]
  ← reuse session manager
  ← replace in-memory bridge task manager with durable journal
        ↓
[Forge Runtime / Task Agent]
  ← reuse worker, task store, event store
  ← emit structured asset context manifest
        ↓
[Run / Artifact / Trace / Result]
  ← reuse existing stores
        ↓
[Injection Receipt → Usage Receipt]
  ← reuse receipt schemas
  ← one host-side writer for all paths
        ↓
[KSTAR Contribution]
  ← reuse Episode/Review
  ← attach exactly one Contribution fact
        ↓
[Candidate → Governance → Cognition vNext]
  ← reuse precipitation
  ← stop direct canonical writes
        ↓
[Future Binding]
  ← reread canonical + derived view only after eligibility/revocation checks
```

## 25. Object Ownership Migration

| Semantic Object | Current Owner / Store | Current Writers | Current Readers | Target Canonical Owner | Target Writers | Target Readers | Migration Decision |
|---|---|---|---|---|---|---|---|
| Experience | captures/messages/episodes | terminal/manual/KSTAR | candidate | same | same | candidate | KEEP |
| Candidate | Recall + PO Markdown | capture/KSTAR/import/PO | inbox/UI/promotion | Recall candidate | all adapters | governance | MERGE |
| Confirmed Cognition | ability-assets | governance | runtime/UI | same | governance only | all | STOP alternate writes |
| Personal Ontology | PO groups/templates + personal assets | UI/PO sync/runtime | prompt/forecast | semantic store + governed assets | governance/PO contract | projection | RE-SCOPE |
| Personal Skill | skill_method assets + installed Skill | governance/binding | runtime | assets + skill store | governance/binding | runtime | KEEP |
| Memory | USER/MEMORY/agent/space | model tool/PO/profile sync | every prompt | derived view of governed sources or independent scoped notes | view rebuild + explicit governed notes | prompt | RE-SCOPE |
| Binding | projection/manifest | runtime adapters | runtime | projection/binding manifest | projection layer | runtime | REWIRE |
| Projection | projections | retrieval/manual | prompt/forecast/runtime | same | projection layer | runtime | KEEP |
| Session | P3394 session file | bridge | executor | same | bridge | bridge | KEEP |
| Task | bridge map + backend store | bridge/backend | recovery/runtime | backend/task journal | bridge/backend | recovery | MIGRATE |
| Run | runtime/task events | runtime | KSTAR/UI | same | runtime | evidence | KEEP |
| Trace | derived | reader | UI | derived | none | UI | KEEP |
| Usage Receipt | Recall JSONL | injection/terminal | evidence | same | uniform writer | evidence | KEEP+ADAPTER |
| Contribution | Episode/Review/precipitation proposals | KSTAR | candidate | explicit Contribution record | KSTAR | candidate | SPLIT |
| KSTAR Episode | cloud KSTAR | closure | review/trace | same | closure | review | KEEP |
| Version | ability asset versions | asset service | projection/proof | same | asset service | all | KEEP |
| Lifecycle | asset status | governance | runtime | same | governance | views/runtime | EXTEND impact |
| UI derived state | Reactor/renderer read models | none | UI | same | none | UI | KEEP |

## 26. Bypass Consolidation Plan

| Bypass / Parallel Path | Why It Exists | Current Consumer | Still Needed? | Target Main Path | Cut / Adapter / Keep | Safe Removal Condition |
|---|---|---|---|---|---|---|
| Legacy PO candidate | historical personal ontology workflow | cognition candidate UI | temporarily | Recall candidate | Adapter | legacy pending items migrated and UI reads one store |
| `cross_session_memory` direct user/shared write | fast explicit memory tool | every prompt | only as governed intent | candidate/governance or explicit policy | Adapter | explicit user remember creates ReviewDecision/asset or governed note |
| USER/MEMORY projection | readable profile view | Core Agent prompt | yes as view | canonical -> view rebuild | Re-scope | view carries source id/version and revoke removes |
| Role-template projection | role-space rendering | space prompt | yes as view | canonical -> PO contract view | Re-scope | writes carry source and can rebuild |
| Synthetic ontology prompt asset | forecast/task context | Commander/forecast | yes | projection source with explicit non-asset type | Adapter | citations/receipts preserve distinction |
| Backend runtime context | isolated worker input | runtime | yes | binding manifest -> runtime context | Adapter | injection/usage receipts emitted |
| Inheritance prompt | agent birth context | Agent | yes | projection/binding adapter | Keep+adapter | usage receipt attached |
| P3394 conversation KSTAR skip | external traffic should not hang | Commander | yes | external bridge task contract | Keep with explicit contract | external task policy links to Contribution/Episode intentionally |
| CLI agent no-Recall | process boundary | CLI agents | yes | external grant only | Keep | documented no-claim policy remains |

## 27. Required Changes

### P0 — 语义 / Authority / SoT / 闭环正确性

#### P0-1 Promotion policy hold is ignored

```text
Issue
→ Current reality: evaluatePromotionPolicy returns hold for validationCount=0, but autoApply only handles pause
→ First breakpoint: candidate-service.ts automatic promotion exit
→ Why it matters: Candidate can become Canonical without required validation
→ Minimal change: if policy.action === 'hold', stop before semantic dedup/promotion unless an explicit, recorded system policy says otherwise
→ Why not a bigger rewrite: policy already exists and is already computed
→ Affected functions: F-02, F-11, F-12
→ Verification: zero-validation candidate cannot auto-promote; validation success allows promotion
```

#### P0-2 Competing candidate and canonical write paths

```text
Issue
→ Current reality: PO candidate, direct memory tool, profile sync and formal asset promotion all write person-level facts
→ First breakpoint: no unified canonical mutation
→ Why it matters: AR-13 and AR-2 are violated
→ Minimal change: PO candidate and explicit memory writes adapt into Recall candidate/governance; all materialized views become derived
→ Why not a bigger rewrite: existing candidate service and memory stores can remain
→ Affected functions: F-01, F-02, F-08, F-13
→ Verification: any long-term person fact has one candidate id, one decision id and one canonical source
```

#### P0-3 Revoke does not invalidate materialized views

```text
Issue
→ Current reality: USER/role projection survives asset revoke and still enters next prompt
→ First breakpoint: derived-view lifecycle
→ Why it matters: revoke/forget is false; privacy and trust risk
→ Minimal change: persist source asset id/version on every projected view and add invalidation on lifecycle mutation
→ Why not a bigger rewrite: view renderers and memory storage already exist
→ Affected functions: F-03, F-08, F-13
→ Verification: E-03 probe must return false for both projectionStillPresent and promptStillContainsProjectedFact
```

### P1 — Runtime 真实闭环

#### P1-1 Ontology facts enter prompt without citations or receipts

```text
Issue
→ Current reality: synthetic ontology assets are prompt-visible but excluded from citations
→ First breakpoint: buildPromptContextForCommittedProjection
→ Why it matters: AR-4/AR-15 cannot be evaluated
→ Minimal change: emit typed ontology projection refs and receipts, or explicitly separate them from ability assets
→ Why not a bigger rewrite: citation object can carry a non-asset source discriminant
→ Affected functions: F-05, F-06, F-08
→ Verification: E-05 probe must show citation/receipt count greater than zero
```

#### P1-2 Forge Runtime receipt chain is incomplete

```text
Issue
→ Current reality: buildRuntimeAssetContext prepares load receipt but emits no injection/usage receipt and Episode asset refs are empty
→ First breakpoint: Runtime context assembly
→ Why it matters: Runtime tasks cannot be audited as asset reuse
→ Minimal change: emit manifest, injection receipt, usage receipt and Episode asset refs on the backend runtime path
→ Why not a bigger rewrite: event/result stores already exist
→ Affected functions: F-10, F-11, F-12
→ Verification: one backend runtime task returns full receipt chain
```

#### P1-3 P3394 recovery has no durable task source

```text
Issue
→ Current reality: session persists, task state is a Map
→ First breakpoint: P3394BridgeTaskManager
→ Why it matters: advertised restart recovery is false for active tasks
→ Minimal change: persist task lifecycle/journal and restore into executor on boot
→ Why not a bigger rewrite: session/outbox/cursor persistence patterns already exist
→ Affected functions: F-09, F-13
→ Verification: restart with recoverable task and assert resumeForward without redelivery
```

#### P1-4 Silent injection policy contradicts its own stated contract

```text
Issue
→ Current reality: policy says only transfer verified is silently default-injected, runtime ignores maturity for silent injection
→ First breakpoint: evaluateAssetRuntimeEligibility silent branch
→ Why it matters: unverified cognition can look authoritative
→ Minimal change: choose one contract; target recommendation is enforce transfer_validated for silent injection or explicitly retire the old policy text and rename the status
→ Why not a bigger rewrite: single gate
→ Affected functions: F-04, F-05, F-06, F-12
→ Verification: seed/bud cannot silent inject unless user explicitly selected it
```

### P2 — 收束 / Cleanup / 可维护性

#### P2-1 Two candidate UIs show different totals

```text
Issue
→ cognition dashboard/candidate adapter reads PO candidates; inbox reads Recall candidates
→ Minimal change: one read model with source adapter
→ Verification: candidate total equals union/dedupe of all sources
```

#### P2-2 Historical receipt-less proofs remain confusing

```text
Issue
→ Installed data: 15 transfer proofs, 0 receipt ids
→ Minimal change: mark as legacy_not_receipt_backed; never use for maturity
→ Verification: UI distinguishes historical success from receipt-backed transfer
```

#### P2-3 P3394 bridge episode store duplicates KSTAR

```text
Issue
→ P3394 close hook produces proposed updates, KSTAR produces Episode/Review
→ Minimal change: convert bridge episode to Contribution/evidence adapter
→ Verification: one canonical Episode exists per execution
```

## 28. Minimal Migration Sequence

```text
1. Freeze semantic owners
   - four formal asset types own canonical reusable cognition
   - PO semantic fields own structured person context
   - USER/MEMORY/role fields become derived views

2. Freeze C2/C3
   - all candidate writes go to Recall candidate store
   - promotion must honor hold/pause/policy
   - write ReviewDecision before canonical mutation

3. Add adapters
   - legacy PO candidate -> Recall candidate
   - explicit memory tool -> governed candidate/decision
   - materialized memory/role views -> source id/version

4. Stop duplicate new writes
   - PO direct USER/MEMORY write
   - direct user/shared memory write outside governance
   - untracked role field projection

5. Freeze C4/C5/C6
   - all runtime cognition enters via projection/binding manifest
   - ontology/login role facts carry typed source refs

6. Rewire runtime read
   - USER/MEMORY/role views become renderers over canonical/projection sources
   - runtime context assembly reads binding manifest

7. Complete evidence chain
   - one injection receipt writer
   - one usage receipt writer
   - one ContextReuseReceipt finalizer
   - all runtime paths emit Episode asset refs

8. Fix P3394 recovery
   - persist bridge task journal
   - restore on boot before sweep

9. Close C9
   - runtime result -> Contribution -> KSTAR -> candidate -> governance -> vNext
   - preserve no_change as explicit outcome

10. Close C10
    - revoke -> eligibility -> derived-view invalidation -> impact receipt
    - verify next prompt, restart, role copy, memory copy

11. Remove/mark legacy
    - legacy PO candidate UI after migration
    - legacy receipt-less proofs as historical only
    - duplicate bridge episode path after adapter

12. Verify
    - focused tests
    - one staging/current run per path
    - trace/run-evidence review
```

## 29. What We Can Keep

可以原样保留：

- Recall capture orchestrator and screening.
- Recall candidate schema and exact-fingerprint dedupe.
- Promotion validation and semantic review.
- ReviewDecision append-only ledger.
- Formal-assets read boundary.
- Asset lifecycle, version snapshots, audit and rollback.
- Task Contract and hybrid retrieval algorithms.
- Projection freeze and confirmation.
- ContextReuseReceipt, InjectionReceipt, AssetUsageReceipt schemas.
- TransferProof and EffectivenessProof logic.
- KSTAR Episode/Review/Trace/RunEvidence models.
- P3394 protocol, registry, channel, replay, idempotency, outbox and session state machine.
- UI pages for candidate review, asset proofs, trace and run evidence.

可以保留但收边界：

- Personal Ontology groups and role templates.
- USER.md/MEMORY.md storage.
- KSTAR precipitation and automatic lifecycle labels.
- P3394 conversation runtime.

可以保留但换 Contract：

- PO candidate -> Recall candidate adapter.
- direct memory write -> governed intent adapter.
- dispatch/inheritance -> binding manifest adapter.
- backend runtime context -> injection/usage receipt adapter.
- P3394 bridge task -> durable journal.

可以保留为只读兼容：

- historical receipt-less TransferProofs.
- legacy PO pending candidates after migration.
- old Episode records without provenance.

必须停写：

- legacy PO direct USER/MEMORY canonical mutation.
- untracked profile/role projection.
- direct user/shared memory write without governance/decision when it is intended as long-term cognition.
- in-memory P3394 task map as restart authority.

可以砍掉：

- duplicate candidate page lifecycle after one queue exists.
- duplicate P3394 episode store after Contribution adapter exists.
- synthetic ontology objects masquerading as formal ability assets.

必须迁移：

- pending PO candidates.
- materialized profile facts to source ids/versions.
- P3394 task state where recoverable.

必须重构：

- C10 impact closure.
- promotion policy enforcement at the automatic promotion exit.

仍需验证：

- exact runtime behavior of installed 0.9.0 versus origin/develop 1.0.2.
- real user feedback loop after a receipt-backed reuse.
- all platform-specific P3394 and worker restart paths.

## 30. Verification Plan

| Claim to Verify | Required Runtime Test | Expected Evidence | Pass Condition | Blocks Migration? |
|---|---|---|---|---|
| Production entry reachable | run one user task end-to-end in current build | terminal event + task/projection ids | no test-only caller used | yes |
| Real input | use persisted user message and real conversation id | capture/candidate refs | refs resolve to real sources | yes |
| Promotion policy hold | create zero-validation candidate and autoApply | policy decision + emitted asset state | no asset created | yes |
| Candidate governance | user accepts eligible candidate | ReviewDecision + handoff receipt + asset | ids linked | yes |
| Correct source of truth | create personal fact through official UI/tool | one candidate/decision/canonical id | no untracked memory write | yes |
| Runtime consumer | inject one formal asset and one PO fact | prompt block + citations/receipts | both tracked with distinct types | yes |
| Usage receipt | complete a run with tool evidence | InjectionReceipt + AssetUsageReceipt | usage status applied or explicitly unknown | yes |
| Transfer proof | complete receipt-backed run | ContextReuseReceipt completed + TransferProof | maturity advances only with valid receipt | yes |
| Effectiveness | submit evidence-backed feedback | EffectivenessProof + ValidationRecord | only valid outcome advances maturity | yes |
| Feedback | close KSTAR review and inspect candidate | Contribution + candidate id | candidate links to same run | yes |
| Future reuse | start next task after vNext | new projection uses new version | canonical new version read | yes |
| Revoke | revoke materialized personal asset | impact receipt | next prompt and restart contain no fact | yes |
| Version change | update asset after projection | old projection frozen or invalidated correctly | no silent content drift | yes |
| Conflict | create conflicting candidate type | conflict blocks promotion | no canonical write | yes |
| Parallel path removal | use legacy PO candidate after migration | adapter result | no direct memory mutation | yes |
| P3394 restart recovery | kill app with recoverable task | durable task journal + cursor | recovery resumes without redelivery | yes |
| Forge runtime evidence | run backend task with assets | run evidence with receipts | no `injection_not_recorded` / `usage_not_recorded` gaps | yes |
| Receipt-less historical data | open old proof | legacy marker | cannot advance maturity | no |

## 31. Audit Coverage

```yaml
reviewed_functions:
  - F-01
  - F-02
  - F-03
  - F-04
  - F-05
  - F-06
  - F-07
  - F-08
  - F-09
  - F-10
  - F-11
  - F-12
  - F-13
not_reviewed_functions:
  - unrelated office/expense/messaging product workflows
historical_functions_not_fully_recovered:
  - pre-candidate-store Personal Ontology ingestion variants before current Markdown format
  - retired P3394 episode/asset-event ledger variants
missing_runtime_evidence:
  - current-version InjectionReceipt -> AssetUsageReceipt -> TransferProof -> EffectivenessProof chain
  - restart recovery of a live P3394 task
  - applied/effective evidence for inheritance and backend runtime
missing_consumers_to_verify:
  - every renderer surface for profile projection revocation
  - platform-specific P3394 external gateways
unknown_parallel_paths:
  - any module outside reviewed scope that writes USER.md/MEMORY.md or role-template fields directly
blockers:
  - no exact current-version production replay dataset
  - installed app version differs from audited origin/develop package version
expected_followup_time:
  - 1-2 engineer-days for one integrated runtime replay
  - 3-5 engineer-days for end-to-end migration fixes and verification
```

## 32. Machine-Readable Summary

```yaml
person: Codex

modules:
  - module: CogSeed Cognition / Recall / KSTAR / P3394 Core

    functions:
      - function_id: F-01
        function_name: Experience Capture -> Candidate
        before_audit_claim: captured experience becomes a reviewable candidate
        verified_current:
          reality_status: PRODUCTION_LIVE + PARTIAL
          trigger: terminal/manual/import/KSTAR
          entry: startRecallCaptureOrchestrator and manual capture IPC
          main_store: cloud/recall/records/candidates
          main_consumer: cognition inbox and promotion
          runtime_consumer: via projection after promotion
          evidence: captures/candidates in production data
          feedback: ReviewDecision
          first_breakpoint: legacy PO candidates bypass Recall candidate intake
        closure:
          trigger: LIVE
          input: REAL
          decision: WIRED
          persistence: PERSISTED
          downstream_consumption: PARTIAL
          runtime_effect: PATH_DEPENDENT
          evidence: PARTIAL
          feedback: PARTIAL
          governance: PARTIAL
          future_reuse: CONDITIONAL
          overall: PARTIAL
        parallel_paths:
          - legacy PO candidate Markdown
        bypass_paths:
          - direct memory tool
        shadow_states:
          - PO candidate pool
        competing_sot:
          - Recall candidate vs PO candidate
        target:
          domain: Domain A
          canonical_sot: Recall candidate store
          contracts: [Experience -> Candidate]
          target_call_path: capture -> candidate -> review
        migration:
          decision: MERGE
          keep: [capture, screening, candidate schema]
          re_scope: [PO candidate as adapter]
          adapter: [PO candidate -> saveRecallCandidate]
          stop_write: [PO candidate lifecycle]
          migrate: [pending PO candidates]
          merge: [candidate UIs]
          deprecate: [PO candidate lifecycle]
          rebuild: []
          verification: [capture -> candidate -> inbox -> decision]
          change_size: MEDIUM

      - function_id: F-02
        function_name: Candidate Governance -> Formal Asset
        before_audit_claim: governance controls promotion
        verified_current:
          reality_status: PRODUCTION_LIVE + PARTIAL
          trigger: user confirmation or system autoApply
          entry: promoteRecallCandidate / autoApplyRecallCandidate
          main_store: candidates + ReviewDecision + ability-assets
          main_consumer: runtime/UI
          runtime_consumer: formal asset gate
          evidence: handoff receipts and production promoted assets
          feedback: validation/effectiveness
          first_breakpoint: autoApply ignores hold
        closure:
          trigger: LIVE
          input: REAL
          decision: PARTIAL
          persistence: PERSISTED
          downstream_consumption: LIVE
          runtime_effect: PARTIAL
          evidence: PARTIAL
          feedback: PARTIAL
          governance: BROKEN_HOLD
          future_reuse: CONDITIONAL
          overall: PARTIAL
        parallel_paths:
          - direct PO confirm
        bypass_paths:
          - cross_session_memory
        shadow_states:
          - USER/MEMORY facts
        competing_sot:
          - formal asset vs materialized person facts
        target:
          domain: Domain B + Domain C
          canonical_sot: candidate + ReviewDecision + ability-assets
          contracts: [Candidate -> Governance, Governance -> Canonical Cognition]
          target_call_path: candidate -> decision -> asset
        migration:
          decision: RE-SCOPE
          keep: [promotion validation, review ledger, handoff receipt]
          re_scope: [autoApply enforces policy]
          adapter: [direct memory intent -> governed write]
          stop_write: [direct canonical person facts]
          migrate: [legacy candidates]
          merge: [candidate queues]
          deprecate: [parallel auto-confirm semantics]
          rebuild: []
          verification: [hold blocks, validation unlocks]
          change_size: MEDIUM

      - function_id: F-03
        function_name: Formal Asset Lifecycle / Version / Revoke
        before_audit_claim: revoke affects future authorization
        verified_current:
          reality_status: BROKEN_FOR_REVOKE_IMPACT
          trigger: UI/system/source-control
          entry: pause/revoke/delete/purge
          main_store: ability-assets + audit + versions
          main_consumer: runtime gate/UI
          runtime_consumer: formal asset gate
          evidence: audit/version records
          feedback: validation/maturity
          first_breakpoint: materialized views survive revoke
        closure:
          trigger: LIVE
          input: REAL
          decision: WIRED
          persistence: PERSISTED
          downstream_consumption: PARTIAL
          runtime_effect: PARTIAL
          evidence: PARTIAL
          feedback: PARTIAL
          governance: PARTIAL
          future_reuse: BROKEN
          overall: BROKEN
        parallel_paths:
          - USER.md
          - role-template fields
        bypass_paths:
          - every-prompt memory injection
        shadow_states:
          - materialized facts
        competing_sot:
          - asset status vs profile existence
        target:
          domain: Domain C
          canonical_sot: ability-assets + version/audit
          contracts: [Revocation -> Eligibility -> Impact Closure]
          target_call_path: revoke -> detach views -> verify next read
        migration:
          decision: RE-SCOPE
          keep: [status/version/audit]
          re_scope: [profile/role as views]
          adapter: [derived-view invalidation]
          stop_write: [untracked projection]
          migrate: [source back-reference]
          merge: []
          deprecate: [independent profile truth]
          rebuild: []
          verification: [revoke probe returns clean next prompt]
          change_size: MEDIUM

      - function_id: F-04
        function_name: Task Contract / Hybrid Retrieval
        before_audit_claim: ontology and semantic retrieval select reusable cognition
        verified_current:
          reality_status: PRODUCTION_LIVE + PARTIAL
          trigger: automatic/manual projection
          entry: applySemanticSelection
          main_store: projection output
          main_consumer: projection/forecast/prompt
          runtime_consumer: selected assets
          evidence: projection matches and omissions
          feedback: none
          first_breakpoint: task contract is not first-class persisted evidence
        closure:
          trigger: LIVE
          input: REAL
          decision: LIVE
          persistence: PARTIAL
          downstream_consumption: LIVE
          runtime_effect: PARTIAL
          evidence: PARTIAL
          feedback: MISSING
          governance: WIRED
          future_reuse: CONDITIONAL
          overall: PARTIAL
        parallel_paths:
          - direct memory prompt
        bypass_paths:
          - ontology synthetic assets
        shadow_states: []
        competing_sot: []
        target:
          domain: Domain F
          canonical_sot: projection selection evidence
          contracts: [Retrieval -> Applicability -> Binding -> Projection]
          target_call_path: task contract -> hybrid candidates -> gate -> projection
        migration:
          decision: KEEP+ADAPTER
          keep: [task contract, hybrid retrieval]
          re_scope: [persist bounded rationale]
          adapter: [selection evidence]
          stop_write: []
          migrate: [legacy projections degraded]
          merge: []
          deprecate: []
          rebuild: []
          verification: [explain selected/omitted ids]
          change_size: SMALL

      - function_id: F-05
        function_name: Context Projection / Freeze / Confirm
        before_audit_claim: confirmed projection is authoritative runtime context
        verified_current:
          reality_status: PRODUCTION_LIVE + PARTIAL
          trigger: task open/manual/wake
          entry: previewContextProjection/confirmContextProjection
          main_store: cloud/recall/records/projections
          main_consumer: Commander/forecast/runtime
          runtime_consumer: prompt/context
          evidence: projection records and version pins
          feedback: decisions/expiry
          first_breakpoint: consumer receipts are uneven
        closure:
          trigger: LIVE
          input: REAL
          decision: WIRED
          persistence: PERSISTED
          downstream_consumption: LIVE
          runtime_effect: PARTIAL
          evidence: PARTIAL
          feedback: PARTIAL
          governance: WIRED
          future_reuse: CONDITIONAL
          overall: PARTIAL
        parallel_paths:
          - direct memory
          - role profile
        bypass_paths:
          - synthetic ontology prompt
        shadow_states:
          - USER/MEMORY profile
        competing_sot:
          - projection vs direct profile
        target:
          domain: Domain F
          canonical_sot: projections + frozen assetVersions
          contracts: [Binding -> Projection, Projection -> Runtime]
          target_call_path: selection -> frozen projection -> consumer receipt
        migration:
          decision: KEEP+ADAPTER
          keep: [projection schema and confirmation]
          re_scope: [ontology entries explicitly typed]
          adapter: [consumer receipt writer]
          stop_write: []
          migrate: [legacy projection provenance degraded]
          merge: []
          deprecate: []
          rebuild: []
          verification: [every consumer emits projection receipts]
          change_size: MEDIUM

      - function_id: F-06
        function_name: Commander Prompt Injection / Injection Receipt
        before_audit_claim: injected assets are tracked
        verified_current:
          reality_status: PRODUCTION_LIVE + PARTIAL
          trigger: Commander turn
          entry: buildRecallTurnPromptContext
          main_store: message citations + receipts
          main_consumer: Commander model
          runtime_consumer: model prompt
          evidence: citations/injection/usage receipts
          feedback: message feedback
          first_breakpoint: applied/effective often unknown; current production receipts absent
        closure:
          trigger: LIVE
          input: REAL
          decision: WIRED
          persistence: PERSISTED
          downstream_consumption: LIVE
          runtime_effect: PARTIAL
          evidence: PARTIAL
          feedback: PARTIAL
          governance: WIRED
          future_reuse: CONDITIONAL
          overall: PARTIAL
        parallel_paths:
          - backend runtime
          - inheritance
        bypass_paths:
          - direct memory
        shadow_states: []
        competing_sot: []
        target:
          domain: Domain F
          canonical_sot: injection/usage receipts
          contracts: [Runtime Evidence -> Usage Receipt]
          target_call_path: prompt injection -> receipt -> usage decision
        migration:
          decision: REWIRE
          keep: [prompt block and citations]
          re_scope: [used claims require evidence]
          adapter: [claimed_used stays non-canonical]
          stop_write: []
          migrate: [legacy usage historical]
          merge: [receipt writers]
          deprecate: [ambiguous used]
          rebuild: []
          verification: [injected -> applied/unknown]
          change_size: SMALL

      - function_id: F-07
        function_name: Delegated Grant / Inherited Cognition
        before_audit_claim: granted/inherited assets are truly usable by target Agents
        verified_current:
          reality_status: PRODUCTION_LIVE + PARTIAL
          trigger: dispatch/agent birth
          entry: buildDispatchedAssetsPromptBlock/selectInheritedCognition
          main_store: ContextReuseReceipt
          main_consumer: target Agent
          runtime_consumer: prompt
          evidence: load receipt only
          feedback: none
          first_breakpoint: applied/effect not recorded
        closure:
          trigger: LIVE
          input: REAL
          decision: WIRED
          persistence: PERSISTED
          downstream_consumption: LIVE
          runtime_effect: PARTIAL
          evidence: PARTIAL
          feedback: MISSING
          governance: WIRED
          future_reuse: CONDITIONAL
          overall: PARTIAL
        parallel_paths:
          - Commander injection
          - backend runtime
        bypass_paths:
          - CLI no-Recall
        shadow_states: []
        competing_sot: []
        target:
          domain: Domain F + H + I
          canonical_sot: ContextReuseReceipt + inheritance snapshot
          contracts: [Projection -> Agent, Usage Receipt]
          target_call_path: grant/inheritance -> prompt -> load receipt -> usage decision
        migration:
          decision: KEEP+ADAPTER
          keep: [selection and prompt rendering]
          re_scope: [target contributes, does not mutate]
          adapter: [usage receipt]
          stop_write: []
          migrate: [legacy load-only]
          merge: []
          deprecate: []
          rebuild: []
          verification: [grant and inheritance produce usage decisions]
          change_size: MEDIUM

      - function_id: F-08
        function_name: Persistent Memory / Personal Ontology
        before_audit_claim: PO personal facts enter Runtime and profile shows confirmed cognition
        verified_current:
          reality_status: PSEUDO_CLOSED
          trigger: memory tool/PO candidate/profile sync/role injection
          entry: cross_session_memory/confirmCandidate/formatRoleProfileForSystemPrompt
          main_store: USER.md/MEMORY.md/role fields
          main_consumer: every model prompt
          runtime_consumer: direct prompt
          evidence: none for direct path
          feedback: none equivalent
          first_breakpoint: writable derived truth without governance/revocation
        closure:
          trigger: LIVE
          input: REAL
          decision: BYPASSED
          persistence: MULTIPLE_STORES
          downstream_consumption: LIVE
          runtime_effect: PARTIAL
          evidence: MISSING_FOR_DIRECT_PATH
          feedback: BROKEN
          governance: BROKEN
          future_reuse: BROKEN_REVOKE
          overall: PSEUDO_CLOSED
        parallel_paths:
          - PO candidate
          - memory tool
          - profile sync
          - role field
        bypass_paths:
          - direct every-prompt read
        shadow_states:
          - USER.md
          - MEMORY.md
          - role fields
        competing_sot:
          - asset vs memory/profile
        target:
          domain: Domain D + Domain J
          canonical_sot: governed cognition + PO semantic store
          contracts: [Governance -> Canonical Cognition -> Runtime]
          target_call_path: governed intent -> candidate/decision -> projection/view
        migration:
          decision: RE-SCOPE
          keep: [storage/rendering/grouping]
          re_scope: [views are derived]
          adapter: [memory -> candidate/governance]
          stop_write: [direct user/shared, PO confirm direct]
          migrate: [source back-reference]
          merge: [candidate intake]
          deprecate: [raw memory as person model]
          rebuild: []
          verification: [explicit remember -> governance -> view -> revoke]
          change_size: LARGE

      - function_id: F-09
        function_name: P3394 Session / Task / Recovery
        before_audit_claim: restart recovery works
        verified_current:
          reality_status: PARTIAL + RECOVERY_BROKEN
          trigger: inbound/outbound/control
          entry: P3394BridgeExecutor
          main_store: session file + memory task map + runtime store
          main_consumer: executor/recovery
          runtime_consumer: bridge adapter
          evidence: audit/outbox/session files
          feedback: close hook
          first_breakpoint: task manager is memory-only
        closure:
          trigger: LIVE
          input: REAL
          decision: WIRED
          persistence: PARTIAL
          downstream_consumption: LIVE
          runtime_effect: PARTIAL
          evidence: PARTIAL
          feedback: PARTIAL
          governance: WIRED
          future_reuse: RECOVERY_BROKEN
          overall: PARTIAL
        parallel_paths:
          - conversation adapter
          - backend runtime adapter
        bypass_paths:
          - external inbound skipKstarRouting
        shadow_states:
          - bridge task map
        competing_sot:
          - bridge task vs backend task
        target:
          domain: Domain G
          canonical_sot: durable session + task journal
          contracts: [Session/Task -> Runtime]
          target_call_path: envelope -> durable task -> runtime -> recovery
        migration:
          decision: MIGRATE
          keep: [protocol/session/outbox/audit]
          re_scope: [task lifecycle to journal]
          adapter: [conversation task adapter]
          stop_write: [in-memory authority]
          migrate: [recoverable tasks]
          merge: []
          deprecate: []
          rebuild: []
          verification: [restart resumes without redelivery]
          change_size: MEDIUM

      - function_id: F-10
        function_name: Forge Runtime Execution / Run Evidence
        before_audit_claim: runtime execution and asset use are auditable
        verified_current:
          reality_status: PRODUCTION_LIVE + PARTIAL
          trigger: task launch
          entry: startCogSeedTask
          main_store: task/event/run stores
          main_consumer: result projector/KSTAR/UI
          runtime_consumer: isolated worker
          evidence: run events/result
          feedback: KSTAR
          first_breakpoint: missing structured injection/usage receipts and empty Episode asset refs
        closure:
          trigger: LIVE
          input: REAL
          decision: WIRED
          persistence: PERSISTED
          downstream_consumption: PARTIAL
          runtime_effect: LIVE
          evidence: PARTIAL
          feedback: PARTIAL
          governance: PARTIAL
          future_reuse: CONDITIONAL
          overall: PARTIAL
        parallel_paths:
          - group chat runtime
        bypass_paths:
          - context block without structured refs
        shadow_states: []
        competing_sot:
          - task store vs KSTAR episode linkage
        target:
          domain: Domain H
          canonical_sot: run/event/task store + receipts
          contracts: [Projection -> Forge -> Runtime Evidence]
          target_call_path: context manifest -> runtime -> run evidence -> receipt
        migration:
          decision: REWIRE
          keep: [worker boundary/event store]
          re_scope: [context to manifest]
          adapter: [receipt emission]
          stop_write: []
          migrate: [legacy degraded]
          merge: []
          deprecate: []
          rebuild: []
          verification: [full receipt chain on runtime run]
          change_size: MEDIUM

      - function_id: F-11
        function_name: KSTAR Episode / Review / Contribution
        before_audit_claim: learning loop closes through candidate and asset
        verified_current:
          reality_status: PRODUCTION_LIVE + PARTIAL
          trigger: task terminal
          entry: captureGroupKstarClosure/captureRuntimeKstarClosure
          main_store: episodes/reviews/extraction-runs
          main_consumer: precipitation/trace/UI
          runtime_consumer: future projection if asset created
          evidence: Episode/Review records
          feedback: ReviewDecision via candidate
          first_breakpoint: uneven provenance and canonical impact
        closure:
          trigger: LIVE
          input: REAL
          decision: LIVE
          persistence: PERSISTED
          downstream_consumption: PARTIAL
          runtime_effect: PARTIAL
          evidence: PARTIAL
          feedback: PARTIAL
          governance: PARTIAL
          future_reuse: CONDITIONAL
          overall: PARTIAL
        parallel_paths:
          - P3394 bridge episode
        bypass_paths:
          - auto-precipitation policy
        shadow_states: []
        competing_sot:
          - cloud Episode vs bridge episode
        target:
          domain: Domain A + B
          canonical_sot: KSTAR Episode/Review/Contribution
          contracts: [Execution -> Contribution -> KSTAR -> Candidate]
          target_call_path: execution -> episode -> review -> contribution -> candidate
        migration:
          decision: KEEP+ADAPTER
          keep: [episode/review/inference]
          re_scope: [review cannot mutate canonical]
          adapter: [provenance/contribution]
          stop_write: []
          migrate: [legacy unlinked episodes]
          merge: [P3394 bridge adapter]
          deprecate: [duplicate bridge episode]
          rebuild: []
          verification: [closed run yields linked candidate/no_change]
          change_size: MEDIUM

      - function_id: F-12
        function_name: Usage / Transfer / Effectiveness Proof
        before_audit_claim: injected/used/effective are distinguishable and proven
        verified_current:
          reality_status: PARTIAL + HISTORICAL_EVIDENCE_MIXED
          trigger: injection/terminal/feedback
          entry: recordInjectionReceipt/recordAssetUsageReceipt/handleRecallTaskTerminal
          main_store: receipts/proofs
          main_consumer: maturity/UI/trace
          runtime_consumer: future eligibility
          evidence: receipt-dependent
          feedback: validation/maturity
          first_breakpoint: path-dependent receipt chain
        closure:
          trigger: LIVE
          input: REAL
          decision: WIRED
          persistence: PERSISTED
          downstream_consumption: PARTIAL
          runtime_effect: PARTIAL
          evidence: PARTIAL
          feedback: PARTIAL
          governance: PARTIAL
          future_reuse: CONDITIONAL
          overall: PARTIAL
        parallel_paths:
          - usage-records
          - ContextReuseReceipt
          - injection receipt
          - asset usage receipt
        bypass_paths:
          - direct memory
        shadow_states:
          - receipt-less historical proofs
        competing_sot:
          - usage labels across services
        target:
          domain: Domain F + KSTAR
          canonical_sot: receipts/proofs
          contracts: [Runtime Evidence -> Usage Receipt -> KSTAR]
          target_call_path: injection -> usage -> transfer -> effect
        migration:
          decision: KEEP+ADAPTER
          keep: [receipt/proof schema]
          re_scope: [one writer per stage]
          adapter: [complete receipts from runtime terminal]
          stop_write: []
          migrate: [legacy proofs historical]
          merge: [evidence read model]
          deprecate: []
          rebuild: []
          verification: [full four-stage chain]
          change_size: MEDIUM

      - function_id: F-13
        function_name: Trace / Run Evidence / Revoke Impact Closure
        before_audit_claim: trace and revoke close the loop
        verified_current:
          reality_status: PARTIAL + C10_BROKEN
          trigger: UI/read/revoke
          entry: readKstarTrace/readKstarRunEvidence/lifecycle mutation
          main_store: derived
          main_consumer: UI/operator
          runtime_consumer: none
          evidence: trace/gaps
          feedback: repair actions
          first_breakpoint: derived person-level views outside blast radius
        closure:
          trigger: LIVE
          input: REAL
          decision: WIRED
          persistence: DERIVED
          downstream_consumption: LIVE
          runtime_effect: AUDIT_ONLY
          evidence: PARTIAL
          feedback: PARTIAL
          governance: PARTIAL
          future_reuse: BROKEN_REVOKE
          overall: PARTIAL
        parallel_paths:
          - memory direct read
          - role profile direct read
        bypass_paths:
          - uncited ontology
        shadow_states:
          - materialized fact copies
        competing_sot:
          - evidence graph vs direct prompt
        target:
          domain: Nexus Operations
          canonical_sot: derived from authoritative stores
          contracts: [Revocation -> Eligibility -> Rebind/Stop -> Impact Closure]
          target_call_path: revoke -> impact registry -> verify
        migration:
          decision: RE-SCOPE
          keep: [trace/run evidence/gaps]
          re_scope: [revoke becomes executable impact contract]
          adapter: [derived-view invalidation]
          stop_write: [unmanaged derived facts]
          migrate: [legacy facts marked unmanaged]
          merge: []
          deprecate: []
          rebuild: []
          verification: [impact receipt complete and next prompt clean]
          change_size: MEDIUM

closed_functions: []
partial_functions:
  - F-01
  - F-02
  - F-04
  - F-05
  - F-06
  - F-07
  - F-09
  - F-10
  - F-11
  - F-12
  - F-13
pseudo_closed_functions:
  - F-08
dormant_functions: []
historical_functions:
  - receipt-less TransferProof maturity path
  - legacy Personal Ontology candidate direct-memory line

p0_breakpoints:
  - autoApplyRecallCandidate ignores promotion-policy hold
  - materialized USER/MEMORY/role facts survive revoke
  - competing candidate/canonical write paths bypass unified governance

duplicate_truths:
  - Formal personal asset vs USER.md vs MEMORY.md vs role-template field
  - Recall candidate vs Personal Ontology candidate
  - KSTAR cloud Episode vs P3394 bridge episode

runtime_bypasses:
  - USER.md/MEMORY.md direct system prompt read
  - role-template profile direct system prompt read
  - synthetic ontology assets without citations
  - cross_session_memory direct write
  - backend runtime context without injection/usage receipts

stores_to_stop_writing:
  - Personal Ontology candidates.md as lifecycle authority
  - USER.md/MEMORY.md as canonical source for governed long-term cognition
  - role-template fields without source asset/version
  - P3394BridgeTaskManager in-memory Map as restart authority

contracts_to_freeze:
  - C2 Candidate -> Governance
  - C3 Governance -> Canonical Cognition
  - C4 Canonical Cognition -> Runtime
  - C6 Projection -> Session/Task/Forge/Agent
  - C7 Runtime Evidence -> Usage Receipt
  - C10 Revocation -> Eligibility -> Impact Closure

runtime_tests_required:
  - zero-validation candidate cannot auto-promote
  - direct remember intent enters one governed candidate/decision path
  - PO fact injection produces typed citation/receipt
  - revoke removes materialized fact from next prompt and after restart
  - backend runtime emits injection + usage + transfer evidence
  - P3394 recoverable task survives process restart
  - KSTAR run produces candidate/no_change linked to canonical version
```
