# Creator + Agent Builder + Generic A2A 分支交接文档

> 文档日期：2026-09-03  
> 仓库：`bonc-ai/cogseed`  
> 文档性质：开发交接与重新集成说明，不是合并批准或发版证明。

## 1. 交接结论

`local/creator-agent-builder-a2a` 是一条以旧版 develop 为基线、叠加 Creator 和 Agent runtime 改造的本地分支。它可以作为功能源分支交接，但不能把当前分支整体直接合并到最新 `develop`。

正确处理方式是：

1. 以最新 `origin/develop` 建立新的集成分支。
2. 按提交顺序逐个重新应用 Creator 提交。
3. 以最新 develop 的文件为基线解决冲突，不能用整棵目录的 `ours` 或 `theirs` 覆盖。
4. 重新执行类型、单元、平台、Smoke、合规和分支差异审计。
5. 通过本地联合测试后，再推送一个新的远程工作分支，禁止直接推送保护分支。

本分支与 KSTAR / Personal Ontology 分支保持独立：

- 本分支不包含 KSTAR 优化实现。
- 本分支不改变 Personal Ontology 的分组、模板和编辑模型。
- KSTAR 后续若需要消费 Creator 产物，应通过稳定的 Agent、能力目录和 provenance 边界接入，不能直接读取 Creator 私有存储文件。
- Generic A2A / P3394 的协议、身份、审批、恢复和外部网关边界仍由既有 A2A/P3394 模块负责，Creator 不能绕过这些边界扩大权限。

## 2. 分支坐标

以下信息是本次交接检查时的本地 Git 状态，重新集成前必须重新执行 `git fetch origin develop` 并记录新的 SHA。

| 项目 | 值 |
| --- | --- |
| Creator 源分支 | `local/creator-agent-builder-a2a` |
| 源分支 HEAD | `4af72593451ec081d4d221a2757be084c3fe11df` |
| 当前最新 `origin/develop` | `882cb823` |
| 两者 merge-base | `71453450c934285b79ddf05c59d7a1ebf3066cab` |
| 相对 `origin/develop` | ahead 3，behind 12 |
| 独立远程分支 | 当前未发现 `origin/*creator-agent-builder-a2a*` |
| 当前上游配置 | `local/creator-agent-builder-a2a` 的 tracking branch 是 `origin/develop` |

### 2.1 上游配置风险

当前本地分支显示为 `[origin/develop: ahead 3, behind 12]`，这表示它跟踪的是 `origin/develop`，不是一个同名远程功能分支。后续推送前必须显式指定新的远程分支名，例如：

```bash
git push -u origin codex/creator-agent-builder-a2a-rebased-20260903
```

不要直接执行会把当前 HEAD 推向 `develop` 的模糊命令，也不要把 `origin/develop` 当成已经包含这条 Creator 分支的远程分支。

## 3. 功能提交历史

### 3.1 `7ff941e8`：preset contract 与不可变存储

提交：`feat(creator): add preset contracts and immutable storage`

主要内容：

- 新增 `src/main/features/creator/types.ts`：Creator preset、Agent input、runtime、permissions、provenance 和 schema issue 类型。
- 新增 `src/main/features/creator/schema.ts`：manifest 结构校验、字段白名单、边界、敏感值和危险引用过滤。
- 新增 `src/main/features/creator/store.ts`：draft、不可变 preset version、state pointer、append-only audit 和 operation journal。
- 新增 `src/main/features/creator/flags.ts`：Creator Mode 与 publish feature flag。
- 在 `src/main/paths.ts` 增加 Creator cloud/local 数据路径。
- 增加 schema、store、flags 测试及存储恢复测试基础。

### 3.2 `7c6709df`：提案、验证和生命周期

提交：`feat(creator): add audited proposal and lifecycle services`

主要内容：

- 新增 `catalog.ts`：从当前用户的 provider、model、tool、skill 状态构建能力目录。
- 新增 `proposal-service.ts`：将 Creator 目标交给模型生成单个 JSON manifest，并进行输出边界、schema 和 catalog 校验。
- 新增 `simulation-service.ts`：在一次性、受限、可取消的模拟作用域内执行 allow-listed action。
- 新增 `verification-service.ts`：对 schema、catalog、工具白名单、文件授权、副作用、预算、超时、取消、幂等、审计轨迹和 Agent 可用性进行检查。
- 新增 `lifecycle-service.ts`：封装 sandbox、verification、approval、publish、activate、disable、rollback 等状态动作。
- 新增 `src/main/security/creator-validation-runner.ts`：固定的 typecheck/test/lint/smoke 检查计划和输出脱敏。
- 增加 Creator proposal、catalog、simulation、verification、lifecycle、redaction 测试和恶意 proposal fixture。

### 3.3 `4af72593`：materialization 与 Agent runtime

提交：`feat(creator): materialize presets into current agent runtime`

主要内容：

- 新增 `materializer.ts`：将通过生命周期验证的 preset version materialize 成现有 custom Agent。
- 新增 `agent-binding-store.ts`：保存 preset version 与 Agent 的不可变 binding 及 runtime policy。
- 新增 `agent-dispatch-policy.ts`：runtime 派发前检查 Creator provenance、manifest digest、binding、active lifecycle 和启用状态。
- 修改 `src/main/features/agents.ts`：支持 Creator binding 的 Agent 读取、更新和 skill scope 校验。
- 修改 `src/main/features/group_chat/bus.ts`：运行时 skill 列表与 Creator binding 的已批准 skill 取交集。
- 修改 `src/main/model/core-agent/runner.ts`：将 Creator read-only policy 转成实际工具白名单、timeout 和 output token 限制。
- 修改 marketplace、skills、auth、spaces 和相关 Agent runtime 适配，以支持现有 Agent 系统承载 Creator 生成的 Agent。
- 增加 materializer、binding、dispatch policy、local-agent golden path、Agent、auth、skills、group-chat 回归测试。

## 4. 代码架构与职责

### 4.1 Creator 控制面

Creator 的设计目标是“生成并治理 preset”，而不是直接让模型写入可执行 Agent 文件。

| 模块 | 责任 |
| --- | --- |
| `creator/types.ts` | 稳定的 v1 manifest、Agent input、生命周期和 feature flag 类型 |
| `creator/schema.ts` | 对模型输出和持久化输入进行严格结构校验 |
| `creator/catalog.ts` | 提供当前可用 model/tool/skill 能力目录，标记 availability 与 health |
| `creator/proposal-service.ts` | 目标 -> 受限模型提案 -> manifest draft |
| `creator/store.ts` | draft、immutable version、state、audit、operation recovery |
| `creator/simulation-service.ts` | 受限的内存模拟和生命周期效果验证 |
| `creator/verification-service.ts` | trusted catalog + policy checks + simulation checks |
| `creator/lifecycle-service.ts` | 管理人工确认和生命周期事件 |
| `creator/inspect-service.ts` | 读取 feature flags、能力目录和 sandbox profile |

### 4.2 Agent Builder / materialization

materializer 只接受如下形式的引用：

```ts
{
  presetId: string,
  version: string,
  manifestDigest: string
}
```

materializer 的主要步骤：

1. 确认当前用户与请求用户一致。
2. 读取指定 immutable version，并校验 manifest digest。
3. 从 audit history 重建 draft、passed verification、approval 和 publication 的证据链。
4. 重新解析当前 catalog 和 skill，确认能力仍可用且版本一致。
5. 按固定 scope 创建 custom Agent，写入 Creator provenance。
6. 保存 preset version -> Agent 的 binding。
7. 如果中途失败，删除本次新建的 Agent，避免留下无 binding 的半成品。
8. 如果相同 digest 的 binding 已存在，则返回现有 binding，不重复创建 Agent。

这条路径的关键原则是：

- manifest 是设计时意图，不是 runtime Agent 文件格式。
- Agent 文件不是 Creator 授权的唯一来源；runtime 还要回查 binding、manifest 和 lifecycle audit。
- skill id、model、tool 和 permission 都必须与已验证 manifest 相匹配。
- binding 是机器本地的授权状态，不能被另一个用户或路径穿越请求读取。

### 4.3 Runtime 派发限制

`agent-dispatch-policy.ts` 和 `runner.ts` 共同完成 runtime 约束：

- 固定 `creator-read-only-v1` sandbox profile。
- 固定包含 read-only file、search 和 bounded tool-result 工具。
- manifest 声明的 capability 只能增加已批准的只读能力。
- shell、browser、connector 和任意写入/远程副作用不能通过 Creator manifest 获得。
- `maxCost` 在当前 core-agent 只有 token 限额能力的前提下，被转换成保守的 output token 上限。
- `timeoutMs` 同时约束 idle timeout 和 stream idle timeout。
- Creator binding 下的 Agent skill list 只能使用 binding policy 中批准的 skill。
- binding、manifest digest 或 lifecycle evidence 不一致时，Agent 必须变成不可派发状态。

## 5. Manifest 与持久化契约

### 5.1 Manifest v1

`CreatorPresetManifestV1` 的顶层字段为：

- `schemaVersion`
- `presetId`
- `version` / `parentVersion`
- `displayName` / `description`
- `presetType: "cogseed-agent"`
- 可选 `agent` 元数据：category、icon、color、双语描述、knowhow、standards、inputs
- `model`
- `capabilities`
- `prompt.systemSections`
- `runtime`
- `permissions`
- `provenance`

runtime 当前要求：

- `sessionPolicy` 只能是 `new-per-run` 或 `resume-explicit`。
- `memoryPolicy` 只能是 `none` 或 `read-only`。
- `loopPolicy` 固定为 `single-agent`。
- `sandboxProfile` 固定为 `creator-read-only-v1`。
- timeout 在 1 到 30 分钟范围内。
- budget 的 cost/token 必须在固定上限内。

schema 层还会拒绝未知字段、非法 id、稀疏数组、循环对象、过大结构、credential-like 值、URL、绝对路径、路径穿越、命令注入形态和危险控制字符。模型输出必须是单个 JSON object，不能携带第二个 JSON 记录或 Markdown 外壳。

### 5.2 数据路径

Creator 数据通过 `src/main/paths.ts` 的统一路径函数生成：

```text
<uid>/cloud/creator/drafts/<draftId>.json
<uid>/cloud/creator/presets/<presetId>/versions/<version>.json
<uid>/cloud/creator/presets/<presetId>/state.json
<uid>/cloud/creator/audit.jsonl
<uid>/cloud/creator/operations.jsonl
<uid>/local/creator/agent-bindings/<presetId>.json
```

含义：

- `cloud`：用户可同步的 draft、immutable preset、state pointer 和 audit。
- `local`：机器私有的 Agent binding 授权状态。
- draft 可以覆盖更新。
- preset version 一旦写入不能被不同内容覆盖。
- audit 是追加式记录；保留生命周期事件的专用命名空间。
- operation journal 通过 prepared/completed 记录支撑崩溃恢复。
- 读写前执行 user scope、id、路径、符号链接和文件大小检查。

## 6. 生命周期交接

当前代码表达的主要流程是：

```text
draft
  -> sandboxed
  -> verified
  -> approved
  -> published
  -> materialize binding
  -> active
```

异常和运维路径：

```text
approved -> rejected
published/active -> disabled
active(version A) -> rollback(version B) -> active(version B)
```

注意：`materialized` 不是 `CreatorPresetLifecycle` 的公开状态。materialization 通过 binding 记录表达，activation 前必须检查 binding 是否存在且与 manifest digest 一致。

主要 service API：

- `sandboxPreset`
- `recordVerification`
- `approvePreset`
- `rejectPreset`
- `publishPreset`
- `activatePreset`
- `disablePreset`
- `rollbackPreset`
- `captureActiveSnapshot`
- `materializeCreatorPreset`
- `isCreatorPresetMaterializedForRuntime`

所有需要人工确认的操作都要求 actor、confirmedAt、manifest digest 和相应的 verification run 绑定。重复调用在相同证据下应返回同一逻辑结果；使用不同 digest、actor、verification 或 policy 重放时必须失败。

## 7. Generic A2A / P3394 边界

### 7.1 当前分支实际包含什么

Generic A2A/P3394 主体在本分支中主要是从旧 merge-base 继承的现有代码，包括：

- `src/main/features/p3394/`
- `src/main/features/p3394_bridge/`
- `src/main/features/cogseed_backend/` 中与外部执行接入相关的代码
- P3394 protocol、identity、approval、session、recovery、artifact、channel 和 gateway 测试

从 `71453450` 到 `local/creator-agent-builder-a2a` 的三次分支专属提交没有新增一套新的 A2A wire protocol。三次提交的主要增量是 Creator control plane 与本地 Agent runtime。因而不能把这个分支描述成“已经完成 Creator 与远程 A2A 的端到端联调”。

### 7.2 必须保持的边界

- Creator 只 materialize 当前 CogSeed Agent，不直接创建外部网络连接。
- 外部 Agent 的 envelope、identity、epoch、approval、replay、session 和 recovery 仍必须经过现有 P3394/A2A 入口。
- Creator 的 `permissions` 不是 P3394 的远程授权替代品。
- 不能因为 Agent 有 Creator provenance 就跳过 P3394 admission、approval 或 capability intersection。
- Generic A2A 需要的网络和 side effect 能力不能通过 `creator-read-only-v1` 偷渡。
- Creator binding 失效时，只能阻断本地 Creator Agent 派发，不能修改或删除其他 A2A 节点的状态。
- A2A 产生的远程证据不能直接写入 Creator audit；必须经过对应的 P3394 审计和明确的适配层。

### 7.3 与 KSTAR / Personal Ontology 的关系

本交接分支不负责实现 KSTAR 或 Personal Ontology 消费。后续如果要让 Creator Agent 进入 KSTAR：

1. 由 KSTAR/Recall 侧生成受控 projection。
2. Host 计算 Creator Agent 实际允许的 capability 与目标 Agent 权限的交集。
3. 通过现有 Agent runtime/dispatch 边界注入，不读取 Creator 私有文件路径。
4. 记录 selected、eligible、injected、applied、effective 的真实证据，不能把 materialized 或 dispatched 直接当作使用成功。

## 8. 当前已覆盖的测试

### 8.1 Creator contract 与存储

- `test/main/features/creator/flags.test.ts`
- `test/main/features/creator/schema.test.ts`
- `test/main/features/creator/store.test.ts`
- `test/main/features/creator/catalog.test.ts`
- `test/main/features/creator/proposal-service.test.ts`
- `test/main/features/creator/redaction.test.ts`
- `test/main/security/creator-validation-runner.test.ts`
- `test/fixtures/creator/proposals/`

覆盖重点：schema 白名单、恶意模型输出、敏感信息过滤、catalog snapshot 校验、draft 覆盖、immutable version、append-only audit、journal recovery、并发锁、路径穿越和用户隔离。

### 8.2 模拟、验证与生命周期

- `test/main/features/creator/simulation-service.test.ts`
- `test/main/features/creator/verification-service.test.ts`
- `test/main/features/creator/lifecycle-service.test.ts`

覆盖重点：深冻结输入、取消、timeout、作用域清理、幂等 effect、trusted catalog、verification digest 绑定、人工确认、publish/activate/disable/rollback 及重复调用。

### 8.3 Agent runtime 与 Builder

- `test/main/features/creator/materializer.test.ts`
- `test/main/features/creator/materializer-agent-runtime.test.ts`
- `test/main/features/creator/agent-binding-store.test.ts`
- `test/main/features/creator/creator-agent-dispatch-policy.test.ts`
- `test/main/features/creator/local-agent-golden-path.test.ts`
- `test/main/features/agents.test.ts`
- `test/main/model/skill-registry.test.ts`
- `test/main/model/skill-registry-open-tier.test.ts`
- `test/main/features/group_chat/agent-mode.test.ts`
- `test/main/features/group_chat/bus.test.ts`
- `test/main/features/group_chat/bus-integration.test.ts`
- `test/main/features/auth-oauth-isolation.test.ts`

覆盖重点：binding 与 manifest digest 一致性、Agent 创建/清理、只读 runtime policy、skill scope、model/budget/timeout 派生、普通 chat dispatch 阻断和相关现有 Agent 行为回归。

### 8.4 Generic A2A / P3394 既有测试

既有协议和网关测试位于：

- `test/main/features/p3394/`
- `test/main/features/p3394_bridge/`
- `test/main/ipc/p3394-*.test.ts`
- `test/renderer/p3394-wake-placement.test.ts`

这些测试验证的是既有 A2A/P3394 边界；它们不等同于 Creator -> materialization -> external A2A 的组合验收。

## 9. 已知测试缺口与风险

以下项目在最新 develop 上重建后必须重新确认：

1. **没有 Creator IPC/Renderer 入口。** 当前分支的 Creator service 主要是 Main 层 API；`src/main/ipc/index.ts` 和 `src/main/preload.js` 没有对应的完整 Creator UI contract。若目标是可操作的 Creator UI，需要另行设计 IPC allow-list、preload bridge、Renderer 页面和真实页面集成测试。
2. **Provider 真实请求尚未被当前单测证明。** proposal/verification 使用可注入的 model、catalog 和 executor；测试通过不代表真实 provider 配置、超时和限额已经在 Electron 环境跑通。
3. **Validation runner 与生命周期不是同一个证明层。** `creator-validation-runner.ts` 提供固定 `npm run typecheck/test/lint/smoke` 计划，但默认 `verification-service` 主要执行 catalog/policy/simulation 检查。不能把 simulation passed 写成真实仓库检查 passed。
4. **Creator 与 Generic A2A 的组合路径缺少端到端证明。** 需要验证 Creator 生成的 Agent 在经过现有 identity/admission/approval/capability intersection 后，才能调用允许的 A2A 功能；不能只验证两边各自的单测。
5. **真实文件系统 materialization 仍需在干净用户目录验证。** dependency-injected Agent creator 测试不能替代真实用户目录、权限、重启、损坏 binding 和升级回滚测试。
6. **旧分支的全量结果不能沿用。** 这条分支缺少最新 develop 的 12 个提交，任何在旧基线上的通过结果都只能作为参考，不能作为重建后合并依据。

## 10. 从最新 develop 重建集成分支

推荐使用干净 worktree，避免影响当前正在进行的其他分支：

```bash
cd /Users/sudai/Documents/CogSeed
git fetch origin develop
git worktree add \
  /Users/sudai/Documents/CogSeed-creator-agent-builder-a2a-rebased \
  -b codex/creator-agent-builder-a2a-rebased-20260903 \
  origin/develop
cd /Users/sudai/Documents/CogSeed-creator-agent-builder-a2a-rebased
git cherry-pick 7ff941e856bd6b1963e2068ca2adeaf7ef7db482
git cherry-pick 7c6709df7719c4dcdcafadf4b57e1f42759cd890
git cherry-pick 4af72593451ec081d4d221a2757be084c3fe11df
```

如果三次 cherry-pick 出现冲突：

1. 先确认冲突文件属于 Creator 增量、最新 develop 变更，还是两者共同修改的共享 runtime 文件。
2. 对共享文件逐段合并，保留最新 develop 的安全修复、IPC contract、Agent/skill 边界和供应链配置。
3. 只重新应用 Creator 所需的最小变更。
4. 解决后执行 `git add` 和 `git cherry-pick --continue`。
5. 禁止使用整文件 `git checkout --ours` / `git checkout --theirs` 作为冲突策略。

重建后立即记录：

```bash
git status --short --branch
git log --oneline --decorate -16
git rev-list --left-right --count origin/develop...HEAD
git diff --stat origin/develop...HEAD
git diff --name-status origin/develop...HEAD
```

差异清单应主要集中在 Creator、Agent runtime 适配和对应测试；若出现大量 develop 删除、CI/合规文件删除或与 Creator 无关的批量改动，应停止集成并重新检查基线。

## 11. 集成验收清单

### 11.1 基线和静态检查

```bash
git fetch origin develop
git merge-base HEAD origin/develop
git diff --check
npm run typecheck
npm run lint
npm run audit:branch -- origin/develop
npm run audit:identity
npm run reuse:check
npm run readme:check
npm run builtin:manifest:check
```

### 11.2 测试门

```bash
npm test
npm run test:platform-native
npm run smoke
```

Creator 定向回归至少应覆盖：

```bash
npm test -- \
  test/main/features/creator \
  test/main/security/creator-validation-runner.test.ts \
  test/main/features/agents.test.ts \
  test/main/features/group_chat/bus.test.ts \
  test/main/model/skill-registry.test.ts
```

如果测试脚本对路径参数的转发方式发生变化，以 `package.json` 和 `scripts/run-tests.mjs` 的实际约定为准，不要绕过项目的 `npm test` 包装脚本直接调用底层 Vitest。

### 11.3 功能场景

在干净测试用户和临时 workspace 中执行：

1. 使用 valid proposal fixture 生成 draft。
2. 验证 URL、credential、绝对路径、危险命令和未知 capability 被拒绝。
3. 完成 sandbox -> verify -> approve -> publish。
4. 以 manifest digest materialize Agent，确认实际写入 `creator_binding`。
5. activate 后执行普通 Agent dispatch，确认只使用 binding 允许的 model、skill、tool、timeout 和 token budget。
6. 重复 materialize，确认不重复创建 Agent。
7. 修改 digest、binding、manifest 或用户 scope，确认 dispatch fail closed。
8. disable 当前版本，确认不能继续普通 chat dispatch。
9. 发布两个 immutable version，执行 rollback，确认 active pointer、audit 和 Agent binding 一致。
10. 对 Generic A2A/P3394 执行原有 protocol、identity、approval、replay、recovery 和 leak boundary 测试。
11. 额外执行 Creator Agent -> P3394 admission/approval -> allowed A2A capability 的组合验证；没有该结果时，交接状态只能是“部分验证”。

### 11.4 Electron 运行验证

完成代码变化后，在该 worktree 重新启动应用：

```bash
scripts/restart-cogseed.sh restart
```

确认：

- launcher 日志 `/tmp/cogseed-agent-cogseed-run.log` 无新的启动阻断。
- runtime data log 有 Electron、Main、Renderer 和 IPC 启动记录。
- 普通聊天、现有 Agent dispatch、skill registry 和 P3394 既有路径没有回归。
- Creator 相关入口若尚未提供 UI，应明确记录为 service-only，不得在验收表中勾选“UI 完成”。

## 12. 推送和交接产物

只有在第 10、11 节全部完成并记录结果后，才执行：

```bash
git status --short
git push -u origin codex/creator-agent-builder-a2a-rebased-20260903
```

交接时应提供：

- 新集成分支名称和远程链接。
- 最新 `origin/develop` SHA。
- 三次 Creator cherry-pick 后的 commit SHA。
- `git diff --stat origin/develop...HEAD` 和意外删除检查结果。
- typecheck、全量测试、平台测试、Smoke、lint、audit 结果。
- Electron 启动和真实功能验证结果。
- 未完成的 Creator IPC/UI、真实 provider、真实文件系统和 Creator+A2A 组合测试项。

## 13. 后续开发建议

### P0：先完成可证明的 runtime 闭环

- 把 Creator service 接入受控 IPC/preload，再补 Renderer 的最小操作页面和 contract 测试。
- 将真实 provider、真实 Agent 文件操作和重启恢复纳入集成测试。
- 将 Creator Agent 与 Generic A2A 的 capability intersection、approval 和 audit 组合链路跑通。

### P1：补治理和运营能力

- 把 `creator-validation-runner` 与生命周期 verification 的关系明确为“真实仓库检查”还是“可选宿主检查”，避免两套结果混淆。
- 增加 activation、disable、rollback 的运行指标和失败原因。
- 对 capability catalog、manifest version、binding revision 做可追踪的版本差异展示。

### P2：再考虑 KSTAR 接入

- KSTAR 只消费已确认、已 materialize 且当前仍有效的 Agent/能力事实。
- 资产使用必须区分 `selected`、`eligible`、`injected`、`applied`、`effective`。
- Creator 生成的 Agent 不应直接成为高成熟度 KSTAR 资产；需要经过真实执行证据和人工/策略确认。

## 14. 最终状态定义

本分支在交接时的准确表述是：

> **Creator 控制面、preset 生命周期、验证模拟、不可变 Agent binding 和本地 read-only runtime 适配已经在旧基线上实现；Generic A2A/P3394 主体来自既有代码。该分支尚未基于最新 `origin/develop` 完成重建后的全量验证，也没有证明 Creator 与 Generic A2A 的端到端组合路径，更没有 Creator IPC/Renderer 产品入口。**

只有在最新 develop 重建、全部测试门通过、组合路径验证完成并推送新远程分支后，才能把状态改为“可提交评审”。
