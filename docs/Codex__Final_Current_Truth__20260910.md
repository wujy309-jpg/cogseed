# CogSeed × P3394 — Final Current Truth

> 本文只收口当前事实，不继续扩审，不提出新的 Authority、SoT、Binding、Projection、Candidate、KSTAR 或其他跨模块归属决策。
> 本文中的 `CUR-*`、`ARC-*`、`DEC-*` 是唯一统一编号。Executive Conclusion、功能清单、状态矩阵、问题分类、P0/P1/P2、Audit Coverage 和 Machine-readable Summary 均引用同一组编号。
> 若编号关系发生冲突，以本文为准。详细审计过程见 `Codex__Functional_Closure_and_Target_Migration_Audit__20260910.md`，但下一阶段不需要阅读该过程文档。

## 0. Final Truth Metadata

```yaml
title: Final Current Truth
version: 1
date: 2026-09-11
source_audit: Codex__Functional_Closure_and_Target_Migration_Audit__20260910.md
code_baseline:
  repository: CogSeed
  ref: origin/develop
  head: ae0e3c8efb809d99ccc0f82bc0145ee86987bae6
  package_version: 1.0.2
working_checkout:
  ref: local/creator-agent-builder-a2a
  head: 1c592e5297f9249f2d0d809864e50441edc49b92
  relation: behind_origin_develop_by_77
runtime_evidence:
  installed_app: CogSeed Enterprise 0.9.0
  data_root: /Users/sudai/.cogseed/data/15474948
  exact_head_replay: false
  aggregate_only: true
  user_content_copied: false
authority_decision_made: false
audit_scope_complete: false
functions_reviewed: 13
current_defects: 3
architecture_gaps: 8
owner_decisions: 10
```

## 1. Executive Conclusion

当前系统已经真实具备 13 个核心 Cognition / Recall / KSTAR / P3394 功能。代码实现和部分生产数据能够证明这些能力真实存在、可触发、可持久化并已有消费者。

但按“当前生产真实运行证据”收口，严格意义上的端到端真闭环仍为 0 个。原因是功能链的不同段落分散在多条路径上，且以下证据不完整：

- 当前代码已有 Receipt、Usage、TransferProof、Run Evidence、Trace 等实现。
- 安装版 0.9.0 的生产数据没有 `ContextReuseReceipt`，也没有 Injection/AssetUsage Receipt stream。
- 历史 TransferProof 有 15 条，但全部没有 receipt id。
- 最近一条生产 KSTAR Episode 没有 task、requirement、projection、forecast、reuse-turn 或 ability-asset reference。

最终事实可分为三类：

- **当前系统问题：3 个**。`CUR-01`、`CUR-02`、`CUR-03`。
- **仅迁移到新框架时才需要处理的 Architecture Gap：8 个**。`ARC-01` 至 `ARC-08`。
- **代码事实无法决定、必须由 Owner 裁决：10 个**。`DEC-01` 至 `DEC-10`。

必须优先处理或先获得 Owner 裁决的事实：

1. `CUR-01`：`autoApplyRecallCandidate` 计算了 `hold`，但只处理 `pause`。零验证候选可进入 canonical mutation。
2. `CUR-02`：正式资产 revoke 后，已物化到 USER.md、MEMORY.md 或角色模板字段中的事实仍可进入下一轮 prompt。
3. `CUR-03`：P3394 session 可持久化，但 bridge task lifecycle 只在内存；默认 conversation adapter 下，重启后的 recovery sweep 没有可恢复任务来源。
4. `DEC-01`：当前代码无法决定长期 person-level 信息最终由哪套语义权威拥有。
5. `DEC-03`：当前代码同时保留“promotion policy hold”与“autoApply 继续晋升”两种行为，需要 Owner 说明哪一种才是产品契约。

当前系统更适合进行事实收口和最小修复，不适合直接进行大范围架构重构。但本报告不对新的 Authority、SoT、Binding、Projection、Candidate 或 KSTAR 归属作出决定。

## 2. Functional Inventory

| Function ID | Function Name | Purpose | Current Code Status | Production Evidence Status | Related Findings |
|---|---|---|---|---|---|
| F-01 | Experience Capture → Candidate | 从会话、导入、任务终态生成候选 | `LIVE` | capture/candidate records 已观察到 | `ARC-01` |
| F-02 | Candidate Governance → Formal Asset | 对候选进行确认、拒绝、合并、晋升 | `LIVE_WITH_DEFECT` | 6 个 confirmed candidates，均无 validation count | `CUR-01`, `DEC-03` |
| F-03 | Formal Asset Lifecycle / Version / Revoke | 管理资产状态、版本、审计、撤销 | `LIVE_WITH_DEFECT` | 有资产、版本、审计记录 | `CUR-02`, `ARC-08` |
| F-04 | Task Contract / Hybrid Retrieval | 组合本体与语义检索选择资产 | `LIVE` | projection 中有 matches/omissions | `ARC-07` |
| F-05 | Context Projection / Freeze / Confirm | 冻结选择结果并确认 | `LIVE` | 7 个 confirmed projections | `ARC-02`, `ARC-07` |
| F-06 | Commander Prompt Injection / Receipt | 向 Commander 注入已确认认知并记录 | `LIVE` | 当前生产 receipt 链未证明 | `ARC-02`, `ARC-03` |
| F-07 | Delegated Grant / Inherited Cognition | 向目标 Agent 授权或继承认知 | `LIVE` | 无 applied/effect production proof | `ARC-04` |
| F-08 | Persistent Memory / Personal Ontology | 保存和读取长期人员信息与画像 | `LIVE_MULTI_PATH` | USER/MEMORY/role paths 可运行 | `CUR-02`, `ARC-01`, `ARC-02`, `DEC-01`, `DEC-02`, `DEC-09` |
| F-09 | P3394 Session / Task / Recovery | 承载外部会话和任务恢复 | `LIVE_WITH_DEFECT` | session/outbox 可持久化；task restart recovery 不成立 | `CUR-03`, `DEC-05`, `DEC-06` |
| F-10 | Forge Runtime Execution / Run Evidence | 隔离执行并保存运行事实 | `LIVE` | run/task/event stores 可读 | `ARC-03`, `ARC-06` |
| F-11 | KSTAR Episode / Review / Contribution | 形成经验、归因和后续沉淀 | `LIVE` | 31 Episodes, 31 Reviews, 31 ExtractionRuns | `ARC-01`, `ARC-03`, `ARC-05`, `ARC-06`, `DEC-10` |
| F-12 | Usage / Transfer / Effectiveness Proof | 证明注入、使用和效果 | `LIVE` | 15 historical TransferProofs，0 receipt ids | `ARC-03`, `ARC-04`, `ARC-06` |
| F-13 | Trace / Run Evidence / Impact Closure | 统一回放证据并暴露缺口 | `LIVE_PARTIAL_COVERAGE` | Trace 可读，但覆盖不到 direct memory/role path | `CUR-02`, `ARC-02`, `ARC-08` |

## 3. Current Truth Reconciliation

这一节只记录最终采用的结论，不保留过程叙事。

| Previous Conclusion or Assumption | Final Current Truth | Reason |
|---|---|---|
| 当前 checkout 可代表当前代码 | `origin/develop` `ae0e3c8e` 是本次代码基线；当前 checkout 落后 77 个提交 | 当前 checkout 缺少关键 receipt、task-contract、run-evidence 实现 |
| Receipt / Usage / Run Evidence 尚未实现 | 当前代码已经实现；缺口主要是路径覆盖和生产证据 | `origin/develop` 包含相关模块和测试 |
| 生产数据没有 receipt，因此当前代码一定没有 receipt 实现 | 安装版 0.9.0 的数据不能直接证明 1.0.2 HEAD 的逐行运行结果 | 版本边界不同 |
| P3394 session 和 task 都支持重启恢复 | session、outbox、cursor 可持久化；bridge task state 不可 | `P3394BridgeTaskManager` 只有进程内 `Map` |
| KSTAR 直接写 canonical cognition | 当前 KSTAR 先写 candidate，再调用 `autoApplyRecallCandidate`；但自动晋升存在策略执行缺陷 | `CUR-01` |
| Personal Ontology facts 与正式资产一样有 citations/receipts | ontology facts 会进入 prompt，但当前 committed projection 路径明确不把它们加入 citations | `ARC-02` |
| revoke 会立即影响所有未来读取 | 正式资产 runtime gate 会重新判断；USER/MEMORY/role materialized views 不会同步失效 | `CUR-02` |
| 自动沉淀候选已有验证依据 | 生产 confirmed candidates 的 validation count 均为空；代码也没有执行 hold | `CUR-01` |
| 历史 TransferProof 能证明当前 transfer | 它们是真实历史证明，但无 receipt id；当前 receipt-backed maturity 规则下不能等同 | `ARC-06` |
| KSTAR Episode 都带有 task/projection/reuse provenance | 生产 Episodes 中存在大量无这些字段的记录；最近一条也没有 | `ARC-06` |
| 所有资产注入路径都走同一证据链 | Commander、Dispatch、Inheritance、Backend Runtime、direct memory 的覆盖不同 | `ARC-03`, `ARC-04` |

## 4. Final Status Matrix

| Function | Code Exists | Production Reachable | Persist | Consumer | Runtime Effect | Evidence Chain | Current Problems | Final Truth Status |
|---|---|---|---|---|---|---|---|---|
| F-01 | yes | yes | yes | yes | via promotion | partial | `ARC-01` | PARTIAL |
| F-02 | yes | yes | yes | yes | yes | partial | `CUR-01`, `DEC-03` | DEFECTIVE |
| F-03 | yes | yes | yes | yes | yes | partial | `CUR-02`, `ARC-08` | DEFECTIVE |
| F-04 | yes | yes | output only | yes | yes | partial | `ARC-07` | PARTIAL |
| F-05 | yes | yes | yes | yes | yes | partial | `ARC-02`, `ARC-07` | PARTIAL |
| F-06 | yes | yes | citations/receipts | yes | yes | path-dependent | `ARC-02`, `ARC-03` | PARTIAL |
| F-07 | yes | yes | load receipt | yes | yes | load only | `ARC-04` | PARTIAL |
| F-08 | yes | yes | multiple stores | yes | yes | missing on direct path | `CUR-02`, `ARC-01`, `ARC-02` | MULTI_PATH |
| F-09 | yes | yes | session only | yes | yes | partial | `CUR-03` | DEFECTIVE |
| F-10 | yes | yes | yes | yes | yes | partial | `ARC-03`, `ARC-06` | PARTIAL |
| F-11 | yes | yes | yes | yes | indirect | partial | `ARC-01`, `ARC-03`, `ARC-05`, `ARC-06` | PARTIAL |
| F-12 | yes | yes | yes | yes | evidence-gated | partial | `ARC-03`, `ARC-04`, `ARC-06` | PARTIAL |
| F-13 | yes | yes | derived | yes | read-only | partial coverage | `CUR-02`, `ARC-02`, `ARC-08` | PARTIAL |

Final status vocabulary:

```text
DEFECTIVE
  A current implementation contradicts its own computed policy or advertised behavior.

PARTIAL
  The function exists and has real consumers, but at least one runtime/evidence path is incomplete.

MULTI_PATH
  More than one writable or runtime-relevant path handles the same semantic object.
```

## 5. Current System Problems

这一节只列当前系统本身已经成立的生产、安全或数据正确性问题。
“需要新框架才能成立”的问题不在这里，统一放入 Architecture Gap。

### CUR-01 — Promotion policy `hold` is ignored

**Fact**

`autoApplyRecallCandidate`:

```text
policy = evaluatePromotionPolicy(candidate)
if policy.action === "pause": throw
// hold is not handled
→ semantic review
→ semantic dedup
→ promote candidate
```

**Evidence**

- One-off probe on audited code: candidate entered as `pending_review`, `validationCount` absent, then `autoApplyRecallCandidate` returned a promoted seed asset.
- Installed production data: 6 confirmed candidates, all without validation count.

**Effect**

- A candidate can become canonical without satisfying the rule that produced `hold`.
- Candidate governance and canonical mutation disagree.
- Historical production data and current implementation both show behavior consistent with the defect.

**Severity**

`P0`

**Related Owner Decision**

`DEC-03`

### CUR-02 — Revoke does not invalidate materialized person-level views

**Fact**

Asset lifecycle mutation updates the formal asset status and audit.
It does not detach or invalidate:

- USER.md personal profile materialization;
- MEMORY.md materialization;
- role-template field values;
- synthetic ontology facts built from those views.

**Evidence**

- One-off probe: after asset `revoke`, `findPersonalProfileEntry` still returned the record, and `formatForSystemPrompt` still contained the revoked fact.

**Effect**

- Revoke does not close security/data-correctness impact.
- Next model turn can still consume revoked cognition.
- Restart does not repair the materialized copy.

**Severity**

`P0`

**Related Owner Decisions**

`DEC-01`, `DEC-02`, `DEC-09`

### CUR-03 — P3394 restart recovery has no durable bridge task source

**Fact**

- P3394 sessions persist to session files.
- Outbound outbox and event cursor can persist.
- `P3394BridgeTaskManager` stores tasks only in a private `Map`.
- Recovery controller scans `executor.tasks.listRecoverable()`.
- Executor creates a new empty task manager on boot unless a test injects one.

**Effect**

- In-process recovery can work.
- Across process restart, the default conversation runtime has no recoverable task list to scan.
- Advertised restart recovery is not true for bridge task lifecycle.

**Severity**

`P0`

**Related Owner Decision**

`DEC-05`

## 6. Architecture Gaps

这一节的每一项只有进入新框架迁移时才会成为必须处理项。
它们不自动说明当前系统有生产错误，也不代表本报告已经决定新的跨模块 Authority 或 SoT。

### ARC-01 — Candidate and long-term-write paths are fragmented

当前存在多条可影响长期个人信息的路径：

- Recall candidate → promotion → formal asset；
- Personal Ontology candidate → direct USER/MEMORY/role write；
- `cross_session_memory` → direct USER/MEMORY/role write；
- personal-profile-sync → USER/role projection。

**Current fact:** 这些路径没有共享同一个候选生命周期或 ReviewDecision。

**Migration meaning:** 新框架若要求统一 candidate/governance，需要先由 Owner 裁定长期信息的 canonical ownership 和可接受写入口。

**Connected decisions:** `DEC-01`, `DEC-02`, `DEC-07`, `DEC-09`

### ARC-02 — Ontology and memory facts enter runtime without citations/receipts

**Current fact:** committed projection prompt can include synthetic ontology assets derived from USER.md/MEMORY.md, but those entries are excluded from `citations`.

**Migration meaning:** 新框架若区分 selected、eligible、projected、injected、used，必须先决定 ontology facts 是 ability asset、单独 context type，还是 projection-only view。

**Connected decisions:** `DEC-01`, `DEC-09`

### ARC-03 — Runtime evidence coverage is uneven

**Current fact:**

- Group Commander path can write citations, usage records and injection receipts.
- Backend Runtime context prepares a ContextReuseReceipt but emits no InjectionReceipt/AssetUsageReceipt.
- Runtime KSTAR Episode sets `abilityAssetRefs: []`.
- Runtime Run Evidence expects Injection/Usage receipts.

**Migration meaning:** 若不统一 runtime evidence，新框架无法证明 backend runtime 的真实 consumption。

**Connected decisions:** none required to describe the gap; implementation ownership still pending.

### ARC-04 — Delegated and inherited cognition prove load, not applied/effect

**Current fact:** delegated grants and inherited cognition can produce ContextReuseReceipt entries, but there is no equivalent applied/effect receipt.

**Migration meaning:** 新框架若要区分 “loaded / used / effective”，需要为这两个路径补齐统一的状态位置。

### ARC-05 — P3394 bridge episode and KSTAR Episode are separate facts

**Current fact:** bridge close hook creates proposed updates; KSTAR creates Episode/Review records. They are not one canonical learning object.

**Migration meaning:** 新框架若要求 Contribution/Episode 统一，需要 Owner 决定桥事件是否只是 adapter input，还是独立 evidence source。

**Connected decision:** `DEC-06`

### ARC-06 — Historical proof and provenance shapes do not match current receipt rules

**Current fact:**

- Installed data: 15 TransferProofs, 0 receipt ids.
- Installed data: no ContextReuseReceipt.
- Installed data: many Episodes lack task/projection/reuse/asset refs.

**Migration meaning:** 旧数据需要明确标记为 legacy/no-receipt evidence，不能直接套用当前 receipt-backed maturity 结论。

**Connected decision:** `DEC-08`

### ARC-07 — Task Contract is not first-class persisted evidence

**Current fact:** Task Contract influences hybrid retrieval, but the final persisted artifact is the projection. The contract/rationale is not separately retained.

**Migration meaning:** 只有在 Owner 要求解释 applicability/binding 全过程时，才需要把检索决策提升为正式 evidence object。

### ARC-08 — No derived-view source/version/impact registry

**Current fact:** USER/MEMORY/role copies can be derived from formal assets, but the registry needed to enumerate and invalidate all copies on version/revoke is absent.

**Migration meaning:** `CUR-02` 的最小修复需要这种 registry；新框架是否需要统一 impact closure，仍需 Owner 决定其范围。

**Connected decisions:** `DEC-01`, `DEC-09`

## 7. Owner Decisions Required

以下问题不能由代码事实单独决定。本文不替 Owner 选择答案。

### DEC-01 — Long-term person-level truth ownership

待裁决问题：

- 长期 person-level 信息的 canonical owner 是正式 `personal` asset、Personal Ontology semantic store，还是两者共同但职责不同？
- USER.md/MEMORY.md/role-template fields 是 canonical store、materialized view，还是独立用户可编辑笔记？
- 同一事实需要一个 canonical id/version，还是允许多个 authority 通过 contract 互联？

影响：`CUR-02`, `ARC-01`, `ARC-02`, `ARC-08`

### DEC-02 — Explicit user memory-write semantics

待裁决问题：

- 用户明确说“记住这个”时，是：
  - 直接写成受信任的用户决定；
  - 先创建 candidate 再由用户/系统确认；
  - 依据 memory tier 分别处理。
- `cross_session_memory` 写入 user/shared 是否必须产生 ReviewDecision。

影响：`CUR-02`, `ARC-01`

### DEC-03 — Promotion policy semantics

待裁决问题：

- `hold` 是硬阻断，还是只表示“尚无 validation，可由另一条 system policy 覆盖”？
- KSTAR/system precipitation 是否允许在无独立 validation 时晋升？
- 如果允许，需要什么明确、可审计的 policy id 和 evidence？

影响：`CUR-01`，并影响 F-02/F-11/F-12 的所有验收条件。

### DEC-04 — Silent injection eligibility

待裁决问题：

- `seed` / `bud` 是否允许静默注入？
- 当前 `formal-assets/policy.ts` 的“只有 transfer validated 才可默认注入”和 `runtime.ts` 的“fit-only silent injection”哪一个代表产品契约？
- 若用户主动选择，未验证资产是否可用？

影响：F-04/F-05/F-06/F-12。

### DEC-05 — P3394 task persistence and recovery owner

待裁决问题：

- bridge task journal、backend task store、conversation state 谁是恢复入口？
- 是否需要保留 bridge task lifecycle 作为独立可恢复实体？
- conversation adapter 的 task→cid mapping 是否必须持久化？

影响：`CUR-03`, `ARC-05`。

### DEC-06 — External inbound KSTAR routing

待裁决问题：

- `skipKstarRouting: true` 是长期产品语义，还是外部桥接入的临时保护？
- 外部任务是否应该形成 KSTAR Task/Projection/Episode，还是只形成 bridge evidence？

影响：F-09、F-11、`ARC-05`。

### DEC-07 — Legacy Personal Ontology candidate lifecycle

待裁决问题：

- `cognition.candidates.*` 是继续作为产品入口，还是迁移后只保留 adapter？
- 它确认后直接写 USER/MEMORY 的行为，是预期产品行为还是历史遗留？

影响：F-01、F-02、F-08、`ARC-01`。

### DEC-08 — Historical receipt-less evidence treatment

待裁决问题：

- 15 个 receipt-less TransferProof 是显示为历史成功、历史未证明，还是迁移补齐？
- 旧 Episode 无 provenance 时显示 degraded、legacy，还是 migration pending？

影响：F-11、F-12、`ARC-06`。

### DEC-09 — Personal Ontology prompt representation

待裁决问题：

- ontology facts 在 Runtime 中应使用 asset citation、独立 context citation，还是明确标记为 uncited advisory context？
- 用户能否按其来源资产 revoke 这些 facts？

影响：F-05、F-06、F-08、`ARC-02`, `ARC-08`。

### DEC-10 — KSTAR automatic precipitation semantics

待裁决问题：

- KSTAR review→candidate/asset 是否必须经过用户确认？
- 自动沉淀是候选、formal asset，还是仅 Experience/Episode？
- no_change 是否需要成为显式持久化结果？

影响：F-11、F-12、`ARC-05`。

## 8. P0 / P1 / P2

P0/P1/P2 只表示下一阶段处理优先级，不改变上面的三类事实分类。

### P0 — 当前正确性 / 安全 / 数据可信度

| ID | Finding | Type | Why P0 | Required Before Implementation |
|---|---|---|---|---|
| P0-1 | `CUR-01` promotion hold ignored | Current defect | Candidate can become canonical without policy compliance | `DEC-03` |
| P0-2 | `CUR-02` revoke impact not closed | Current defect | Revoked cognition can still affect future prompts | `DEC-01`, `DEC-02`, `DEC-09` |
| P0-3 | `CUR-03` P3394 task recovery not durable | Current defect | Advertised restart recovery is false | `DEC-05` |
| P0-4 | `DEC-01` unresolved person-level truth ownership | Owner decision | Blocks safe fix for `CUR-02` and general migration planning | Owner decision |
| P0-5 | `DEC-03` unresolved promotion contract | Owner decision | Blocks safe fix for `CUR-01` and all learning acceptance tests | Owner decision |

### P1 — 只有进入新框架迁移时才必须闭环的 Architecture Gap

| ID | Finding | Type | Migration Dependency |
|---|---|---|---|
| P1-1 | `ARC-01` fragmented candidate/write paths | Architecture gap | requires `DEC-01`, `DEC-02`, `DEC-07`, `DEC-09` |
| P1-2 | `ARC-02` uncited ontology runtime context | Architecture gap | requires `DEC-01`, `DEC-09` |
| P1-3 | `ARC-03` backend runtime evidence gap | Architecture gap | no current authority change required to describe; implementation pending |
| P1-4 | `ARC-04` delegated/inherited applied/effect gap | Architecture gap | depends on C7 target contract |
| P1-5 | `ARC-05` bridge/KSTAR learning object split | Architecture gap | requires `DEC-06` |
| P1-6 | `ARC-06` receipt-less historical evidence | Architecture gap | requires `DEC-08` |
| P1-7 | `ARC-07` Task Contract not first-class evidence | Architecture gap | depends on target audit requirement |
| P1-8 | `ARC-08` no derived-view impact registry | Architecture gap | requires `DEC-01`, `DEC-09` |

### P2 — 收口、标注、数据卫生与产品裁决

| ID | Item | Type | Reason |
|---|---|---|---|
| P2-1 | `DEC-02` explicit memory-write semantics | Owner decision | product behavior, not code-determined |
| P2-2 | `DEC-04` silent injection maturity contract | Owner decision | two current policies disagree |
| P2-3 | `DEC-06` external inbound KSTAR routing | Owner decision | product/protocol semantics |
| P2-4 | `DEC-07` legacy PO candidate lifecycle | Owner decision | migration/product scope |
| P2-5 | `DEC-08` historical receipt-less evidence display | Owner decision | historical data interpretation |
| P2-6 | `DEC-09` ontology prompt representation | Owner decision | citation/vocation semantics |
| P2-7 | `DEC-10` KSTAR auto-precipitation semantics | Owner decision | governance/product boundary |
| P2-8 | Candidate UI totals and dashboard semantics | Data hygiene | different read models currently expose different candidate populations |
| P2-9 | Legacy proof/provenance labels | Data hygiene | historical facts need explicit boundary labels |
| P2-10 | P3394 bridge episode duplication | Cleanup candidate | only if `DEC-06`/`DEC-10` choose to converge them |

## 9. Audit Coverage

```yaml
code_reviewed:
  - recall
  - cognition
  - kstar
  - p3394
  - p3394_bridge
  - cogseed_runtime
  - cogseed_backend runtime integration
  - group_chat runtime integration
  - personal ontology and persistent memory
runtime_data_reviewed:
  scope: aggregate metadata and status/count facts only
  source: installed CogSeed Enterprise 0.9.0
  production_replay_for_audited_head: false
tests_reviewed_or_run:
  - focused Recall/KSTAR/Trace/Projection tests
  - audited baseline result: 48 tests passed
not_reviewed:
  - unrelated product modules
  - every platform-specific P3394 gateway branch
  - exact current-head production replay
unknown:
  - complete inventory of modules outside reviewed scope that write USER.md/MEMORY.md/role fields
  - whether historical receipt-less evidence was generated by behavior later removed
  - whether production data reflects 1.0.2 behavior or only pre-1.0.2 behavior
  - restart recovery behavior under all channel adapters
limits:
  - code facts do not replace runtime replay
  - runtime data is aggregate/historical compatibility evidence, not audited-head proof
  - owner decisions remain unresolved
scope_statement: this document freezes the current truth; it does not prescribe target authority
```

## 10. Machine-readable Summary

```yaml
final_current_truth:
  version: 1
  date: 2026-09-11
  source_audit: Codex__Functional_Closure_and_Target_Migration_Audit__20260910.md
  authority_decision_made: false
  baseline:
    code_ref: origin/develop
    code_head: ae0e3c8efb809d99ccc0f82bc0145ee86987bae6
    package_version: 1.0.2
    working_checkout_head: 1c592e5297f9249f2d0d809864e50441edc49b92
    working_checkout_relation: behind_origin_develop_by_77
    installed_app: CogSeed Enterprise 0.9.0
    exact_head_runtime_replay: false
  counts:
    functions: 13
    current_defects: 3
    architecture_gaps: 8
    owner_decisions: 10
    closed_functions_under_strict_runtime_evidence: 0

  function_status:
    - function_id: F-01
      function_name: Experience Capture -> Candidate
      final_status: PARTIAL
      code_live: true
      production_reachable: true
      evidence: captures_and_candidates_observed
      findings: [ARC-01]
    - function_id: F-02
      function_name: Candidate Governance -> Formal Asset
      final_status: DEFECTIVE
      code_live: true
      production_reachable: true
      evidence: six_confirmed_candidates_without_validation_count
      findings: [CUR-01, DEC-03]
    - function_id: F-03
      function_name: Formal Asset Lifecycle / Version / Revoke
      final_status: DEFECTIVE
      code_live: true
      production_reachable: true
      evidence: revoke_probe_and_asset_audit_version_records
      findings: [CUR-02, ARC-08]
    - function_id: F-04
      function_name: Task Contract / Hybrid Retrieval
      final_status: PARTIAL
      code_live: true
      production_reachable: true
      evidence: projection_matches_and_omissions
      findings: [ARC-07]
    - function_id: F-05
      function_name: Context Projection / Freeze / Confirm
      final_status: PARTIAL
      code_live: true
      production_reachable: true
      evidence: seven_confirmed_projections
      findings: [ARC-02, ARC-07]
    - function_id: F-06
      function_name: Commander Prompt Injection / Receipt
      final_status: PARTIAL
      code_live: true
      production_reachable: true
      evidence: implementation_and_tests_current_production_receipt_not_proven
      findings: [ARC-02, ARC-03]
    - function_id: F-07
      function_name: Delegated Grant / Inherited Cognition
      final_status: PARTIAL
      code_live: true
      production_reachable: true
      evidence: load_path_implemented_no_applied_effect_production_proof
      findings: [ARC-04]
    - function_id: F-08
      function_name: Persistent Memory / Personal Ontology
      final_status: MULTI_PATH
      code_live: true
      production_reachable: true
      evidence: direct_memory_and_uncited_ontology_probes
      findings: [CUR-02, ARC-01, ARC-02, DEC-01, DEC-02, DEC-09]
    - function_id: F-09
      function_name: P3394 Session / Task / Recovery
      final_status: DEFECTIVE
      code_live: true
      production_reachable: true
      evidence: session_persistence_code_and_ephemeral_task_manager
      findings: [CUR-03, DEC-05, DEC-06]
    - function_id: F-10
      function_name: Forge Runtime Execution / Run Evidence
      final_status: PARTIAL
      code_live: true
      production_reachable: true
      evidence: run_task_event_stores_exist
      findings: [ARC-03, ARC-06]
    - function_id: F-11
      function_name: KSTAR Episode / Review / Contribution
      final_status: PARTIAL
      code_live: true
      production_reachable: true
      evidence: 31_episodes_31_reviews_31_extraction_runs
      findings: [ARC-01, ARC-03, ARC-05, ARC-06, DEC-10]
    - function_id: F-12
      function_name: Usage / Transfer / Effectiveness Proof
      final_status: PARTIAL
      code_live: true
      production_reachable: true
      evidence: 15_transfer_proofs_0_receipt_ids
      findings: [ARC-03, ARC-04, ARC-06]
    - function_id: F-13
      function_name: Trace / Run Evidence / Impact Closure
      final_status: PARTIAL
      code_live: true
      production_reachable: true
      evidence: trace_code_and_explicit_gap_model
      findings: [CUR-02, ARC-02, ARC-08]

  current_system_problems:
    - id: CUR-01
      title: promotion_policy_hold_is_ignored
      category: current_defect
      severity: P0
      production_or_data_correctness: true
      first_breakpoint: autoApplyRecallCandidate_after_policy_evaluation
      owner_decisions: [DEC-03]
    - id: CUR-02
      title: revoke_does_not_invalidate_materialized_person_level_views
      category: current_defect
      severity: P0
      production_or_data_correctness: true
      first_breakpoint: asset_lifecycle_mutation_does_not_touch_derived_views
      owner_decisions: [DEC-01, DEC-02, DEC-09]
    - id: CUR-03
      title: p3394_bridge_task_recovery_is_not_durable
      category: current_defect
      severity: P0
      production_or_data_correctness: true
      first_breakpoint: P3394BridgeTaskManager_in_memory_map
      owner_decisions: [DEC-05]

  architecture_gaps:
    - id: ARC-01
      title: fragmented_candidate_and_long_term_write_paths
      migration_only: true
      owner_decisions: [DEC-01, DEC-02, DEC-07, DEC-09]
    - id: ARC-02
      title: uncited_ontology_and_memory_runtime_context
      migration_only: true
      owner_decisions: [DEC-01, DEC-09]
    - id: ARC-03
      title: uneven_runtime_evidence_coverage
      migration_only: true
      owner_decisions: []
    - id: ARC-04
      title: delegated_and_inherited_cognition_lack_applied_effect_proof
      migration_only: true
      owner_decisions: []
    - id: ARC-05
      title: p3394_bridge_episode_and_kstar_episode_split
      migration_only: true
      owner_decisions: [DEC-06]
    - id: ARC-06
      title: historical_receiptless_proof_and_provenance_shapes
      migration_only: true
      owner_decisions: [DEC-08]
    - id: ARC-07
      title: task_contract_not_first_class_persisted_evidence
      migration_only: true
      owner_decisions: []
    - id: ARC-08
      title: no_derived_view_source_version_impact_registry
      migration_only: true
      owner_decisions: [DEC-01, DEC-09]

  owner_decisions:
    - id: DEC-01
      title: long_term_person_level_truth_ownership
      code_cannot_decide: true
    - id: DEC-02
      title: explicit_user_memory_write_semantics
      code_cannot_decide: true
    - id: DEC-03
      title: promotion_policy_hold_semantics
      code_cannot_decide: true
    - id: DEC-04
      title: silent_injection_eligibility
      code_cannot_decide: true
    - id: DEC-05
      title: p3394_task_persistence_and_recovery_owner
      code_cannot_decide: true
    - id: DEC-06
      title: external_inbound_kstar_routing
      code_cannot_decide: true
    - id: DEC-07
      title: legacy_personal_ontology_candidate_lifecycle
      code_cannot_decide: true
    - id: DEC-08
      title: historical_receiptless_evidence_treatment
      code_cannot_decide: true
    - id: DEC-09
      title: personal_ontology_prompt_representation
      code_cannot_decide: true
    - id: DEC-10
      title: kstar_automatic_precipitation_semantics
      code_cannot_decide: true

  priority:
    P0:
      - CUR-01
      - CUR-02
      - CUR-03
      - DEC-01
      - DEC-03
    P1:
      - ARC-01
      - ARC-02
      - ARC-03
      - ARC-04
      - ARC-05
      - ARC-06
      - ARC-07
      - ARC-08
    P2:
      - DEC-02
      - DEC-04
      - DEC-06
      - DEC-07
      - DEC-08
      - DEC-09
      - DEC-10
      - candidate_ui_truth_alignment
      - historical_evidence_labels
      - p3394_bridge_episode_duplication_cleanup

  overrides_finalized:
    - previous: current_checkout_represents_current_code
      final: origin_develop_ae0e3c8e_is_audited_code_baseline
    - previous: receipt_system_not_implemented
      final: receipt_system_is_implemented_but_not_proven_on_some_paths
    - previous: production_data_proves_audited_head
      final: production_data_is_historical_compatibility_evidence
    - previous: p3394_task_and_session_both_restart_recover
      final: session_is_durable_task_lifecycle_is_not
    - previous: kstar_directly_writes_canonical
      final: kstar_uses_candidate_then_autoApply_and_hold_is_ignored
    - previous: ontology_facts_have_formal_asset_citations
      final: ontology_facts_reach_prompt_without_citations
    - previous: revoke_applies_to_all_derived_views
      final: revoke_updates_formal_asset_only

  coverage:
    audit_scope_complete: false
    current_head_production_replay: false
    aggregate_runtime_evidence_only: true
    next_stage_can_rely_on_this_document: true
    next_stage_must_not_infer_new_authority_from_this_document: true
```
