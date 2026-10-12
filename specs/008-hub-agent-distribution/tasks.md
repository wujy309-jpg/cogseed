# Tasks: Hub Agent 分发与贡献（客户端）

**Input**: `spec.md`, `plan.md`, `data-model.md`, `contracts/`（`agent-api-proposal.md` v3、`agent-package.schema.json`、`client-hub-interface.md`、`renderer-integration.md`）, `implementation-notes.md`

**状态**：第一阶段（不依赖 Hub 的部分）已实施；`[X]` 已完成并有验证，`[ ]` 未做。结果与验证命令见 `implementation-notes.md`。**未提交、未推送。**

**Tests**：先写夹具与契约测试，再写实现；每步跑最窄的相关测试，最后跑全量。

## Phase 1: 证据基线与契约

**Purpose**：固定实施依据，不凭记忆改代码。

- [X] T001 记录基线 `origin/develop` `5491969e` 与 Hub 仓库只读核对结果（Hub 无 Agent 能力、`agents/*` → `404 NOT_SUPPORTED`、内容类型固定 `skill`）于 `spec.md`「代码核实」与 `contracts/client-hub-interface.md` 〇
- [X] T002 [P] 起草并三轮修订 Agent 定义 `contracts/agent-package.schema.json`（v1.1：去 `version/created_at/updated_at`、去 `crown`、`skill_list` 三类互斥）及夹具 `contracts/fixtures/agent-package/`
- [X] T003 [P] 起草接口提案 `contracts/agent-api-proposal.md` v3（B-01～B-05，逐字段对照 Hub 的 A-01/A-02/C-02）
- [X] T004 [P] 汇总评审结论、产品答复（2026-10-10 五条）与 Hub 答复（10-10、10-12）进 `spec.md` 决策项 D-01～D-14 与 `confirmation-checklist.md`
- [X] T005 [P] 把契约夹具与共用名称测试向量复制到 `test/fixtures/hub-agent-contributions/`（**不放进** `hub-contributions/`，该目录被 `freeze-gates.test.ts` 当文件逐个读取）

---

## Phase 2: 主进程基础（提交侧）

**Purpose**：Agent 包规则、副本、检查、请求体，均为可独立测试的叶模块或 feature。

- [X] T006 Agent 包规则（`zod` 手写校验、名称规则、`skill_list` 三类判定、本机处理、四段包上限走配置）`src/main/features/contribution/agent-package-rules.ts`；测试 `test/main/features/contribution/agent-package-rules.test.ts`（53 条，含 schema 枚举不漂移与 19 条名称向量）
- [X] T007 Agent 提交副本 `src/main/features/contribution/agent-staging.ts`：只作用于副本、不跟随符号链接、私有 Skill 写 `ownerAgent`；测试 `agent-staging.test.ts`（18 条）
- [X] T008 Agent 准入 `agent-admission.ts`：阻断项、`agent.json` 校验、包上限预检、Agent 本体红线、**逐个随包 Skill 跑现有准入**；测试 `agent-admission.test.ts`（11 条）
- [X] T009 [P] 放宽 `preview.ts` / `package.ts` 入参类型，`buildPackage` 给出四段上限实测数据（压缩后、文件数、解包、压缩比）；测试并入 `package.test.ts` 与 `agent-submission-request.test.ts`
- [X] T010 Agent 请求体叶模块 `agent-submission-request.ts`（`content_type:'agent'`、`local_agent_id`，无 Electron/网络依赖）；测试 `agent-submission-request.test.ts`（7 条）
- [X] T011 `hub-client.ts`：贡献请求加 `CogSeed-Channel`；`createSubmission` 同时支持 Skill 与 Agent（包文件名按类型）；测试 `hub-client.test.ts`（新增 3 条）
- [X] T012 `store.ts`：`localAgentUuid`（本机 Agent → 提交用 UUID，旧文件向后兼容）
- [X] T013 `session.ts`：会话带可选 Agent 状态，副本变化时作废 Agent 准入结论
- [X] T014 Agent 贡献主流程 `agent-contribution.ts`（开始 / 确认预览 / 提交；外部能力全部注入）；测试 `agent-contribution.test.ts`（20 条：身份门、声明缺项、条款改版、摘要不一致、包上限、同键同字节重试、取消上传、跨账号隔离）
- [X] T015 IPC 接线 `ipc/contribution.ts`：`contribution.agent.start / confirm / submit`，只校验与转发；测试 `test/main/ipc/contribution.test.ts`（新增 3 条：通道登记、目录穿越、跨账号）

**Checkpoint**：未登录、检查未过、声明缺项、摘要不一致任一情形都不会发出请求；发出的字节与预览逐项一致。

---

## Phase 3: 用户故事 2 — 贡献自己的 Agent（界面，P1）

**Goal**：自建 Agent 卡片上有「贡献」，一个按钮、一次确认；引用本机 Skill 时提示「这些 Skill 也会同时贡献」。

- [X] T016 [P] 渲染进程纯函数 `hub-contributions-model.js`：`classifyAgentAdmission`、`agentCheckRows`、`agentMissing`、`contentType`、按类型筛选；测试 `test/renderer/hub-contributions-model.test.ts`（新增 6 条）
- [X] T017 Agent 贡献整页 `src/renderer/modules/hub-agent-contributions.js`（检查 → 预览与声明 → 提交），复用 `hub-contributions.js` 的身份门、错误文案与「我的贡献」（经 `window.hubContributionsShared`）
- [X] T018 `agents.js`：自建 Agent 卡片「贡献」按钮、工具栏「我的贡献」、点击接线、回到网格时收起贡献页；`state.js` 绑定工具栏按钮；`index.html` 新增 `#agents-contribute-view` 与按钮
- [X] T019 `hub-contributions.js`：「我的贡献」加类型切换（全部 / 智能体 / 技能）；智能体条目的「提交新版本」走 Agent 流程
- [X] T020 `lazy-features.js`：贡献模块随技能包懒加载，Agent 页点击时先加载；测试 `test/renderer/lazy-features.test.ts`
- [X] T021 [P] 文案 `locales/zh.json`、`en.json`（贡献页 77 条；市场确认另含 `ja`、`pt`）
- [X] T022 [P] `style.css`：`.agent-card-contribute` 与「使用」同样抬高到 `--z-raised`，避免被整卡覆盖层 `.agent-card-open` 盖住；用无头 Chrome 命中测试验证
- [X] T023 [P] 登记 `docs/renderer-structural-registry.md` 的 `HUBC-PV-004`（Proposed）；`scripts/opensource/policy.json` 登记全部新增文件
- [X] T024 无头 Chrome 渲染验证（真实 CSS 与共享组件，IPC 为替身）：页面渲染、声明填完才可提交、调用顺序 `declare ×3 → agent.confirm → agent.submit → mine`

---

## Phase 4: 用户故事 4 — 安装、依赖与私有 Skill（P1）

**Goal**：点「安装」后系统自动补齐依赖；全部就绪才可用；失败保留原状态。

- [X] T025 依赖规划 `src/main/features/marketplace_agent_deps.ts`（复用 / 安装 / 随包 / 阻断，**版本策略是单个可替换函数 `resolveExistingDependency`**）；测试 `test/main/features/marketplace_agent_deps.test.ts`（10 条）
- [X] T026 `marketplace.ts` 安装流程改用规划：被停用的依赖在下载前拒绝；`builtin:` 本期拒绝；保留「依赖失败则整体失败」与互斥锁
- [X] T027 私有 Skill 安装时把 `ownerAgent` 改写成安装后的 Agent id（`stampPrivateSkillOwners`）；测试并入 `marketplace_private_skills.test.ts`（原有 2 条 + 新增 5 条）
- [X] T028 只读预览 `previewAgentInstallPlan` 与 IPC `marketplace.agentInstallPlan`；在全局通道登记测试 `ontology-step2-guard.test.ts` 登记
- [X] T029 `marketplace.js::_mpConfirmAgentInstall`：「将同时安装」确认（预览失败不挡安装、停用依赖说清原因、无额外依赖不打扰）；测试 `test/renderer/marketplace-agent-install-plan.test.ts`（10 条）

**Checkpoint**：已有且可用的 Skill 只复用不升级；安装失败不影响其他 Agent 与在途任务。

---

## Phase 5: 客户端尚欠（不依赖 Hub）

- [ ] T030 市场 Agent 详情页的静态依赖清单（Hub 分发 / 预置 / 随包三组）`src/renderer/modules/marketplace.js`
- [ ] T031 智能体卡片依赖状态 chip；依赖被停用时显示「依赖已停用」（规划里的 `agentReadiness` 已有，展示未接）`src/renderer/modules/agents.js`
- [ ] T032 Agent 更新流程与失败保留旧版的界面（现仅复用 Skill 更新通道）
- [ ] T033 整仓 `npm run lint`（本期只对改动与新增文件跑过 eslint）
- [ ] T034 重启应用后在真实页面人工验证贡献与安装（`scripts/restart-cogseed.sh`；本机另有运行中的开发版，需先确认）

---

## Phase 6: 依赖 Hub / 产品（阻塞项）

- [ ] T035 对齐私有 Skill `ownerAgent` 约定（提交写本机 `agent_id`、安装时改写）与 Hub 的「必须指向本 Agent」校验口径
- [ ] T036 核实 `builtin:<name>` 在客户端指哪些能力（D-10：31 个内置 Agent 无一引用系统 Skill），再决定是否实现
- [ ] T037 Hub 白名单扩充（`content_type:'agent'`、`local_agent_id`、`metadata`）与 B-01/B-02/B-05 就绪后做**最小联调**：提交一个最简 Agent → 审核 → 发布 → 另一客户端安装
- [ ] T038 依赖版本规则（D-13）取得产品书面认可；不兼容时「无回退」的限制写进验收
- [ ] T039 联合冻结记录：`agent-package.schema.json`、接口清单、夹具三样一起；Hub 与客户端各自签字，联调通过 ≠ 冻结
- [ ] T040 验收记录（沿用 001 的 `acceptance-*.md` 分层写法：真实界面 / Hub HTTP 联调 / 自动化 / 未执行）
- [ ] T041 提交与 PR：需用户另行明确授权；合并 `develop` 后重核对 renderer↔main IPC 并跑 `npm run typecheck`

---

## Dependencies

- Phase 2 → Phase 3、Phase 4（界面与安装都建立在叶模块与 IPC 之上）。
- Phase 5 与 Phase 6 互不依赖，可并行；Phase 6 的 T037 之后才有真实联调数据。
- T035 先于 T037（联调前先对齐校验口径，否则第一次提交会被 Hub 拒绝）。
