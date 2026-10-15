# 同步后失败测试解决方案

- 日期：2026-09-27
- 对象：`.worktrees/ent-sync` 合并后的 **81 个失败测试文件**（245 个失败用例）
- 前提：51 个冲突已全部解决；`npm run typecheck` **0 错误**；企业身份 6/6 保持
- 诊断方法：逐文件隔离重跑 + 错误类型判定 + 与未合并基线（`gitlab/develop-ent`）对比

---

## 0. 诊断结论：81 个失败是五种**不同性质**的问题

逐个隔离重跑后的修正分类（初版分类有假阳性，已修正）：

| 类别 | 文件数 | 性质 | 处理方式 |
|---|---|---|---|
| A. 并发级联 | **6** | 全量并行时的资源竞争，**隔离即通过** | 无需修改 |
| B. 测试 harness 缺口 | **2** | 上游改裸调用，harness 未注入该全局 | 补 harness 桩 |
| C. 测试与实现不匹配（死代码测试） | **1**+ | 上游测试期望企业没有的 API | 恢复企业测试 |
| D. 环境：embedding 原生依赖 | **4** | `--ignore-scripts` 未编译原生模块 | 完整安装依赖 |
| E. 契约断言（标记/样式） | **64** | 断言企业 Raymond 的设计系统 | **需决策**（见 §2.5） |
| F. 打包门禁脚本 | **4** | 断言企业打包配置标记 | 更新断言到上游配置 |

**关键事实**：A+B+C+D+F 合计 **17 个**可确定性修复，且**不需要动产品代码**——全部是测试侧适配。
只有 E（64 个，79%）涉及取舍。

---

## 1. 先修不需要决策的 17 个

### A. 并发级联（6 个，零工作量）

隔离重跑已验证通过，全量跑时受 embedding worker 崩溃级联影响：

```
test/main/features/connectors/oauth.test.ts           12 passed
test/main/features/group_chat/collaboration.test.ts  125 passed
test/main/features/group_chat/reference-flattening.test.ts  1 passed
test/main/features/messaging-owner-bind.test.ts        7 passed
test/main/features/skill-trust.test.ts                46 passed
test/renderer/kb-workbench.test.ts                   130 passed
```

**处置**：先做 D（装好依赖），这 6 个会自然稳定。不做任何测试改动。

### B. harness 缺口（2 个）

| 文件 | 症状 | 修复 |
|---|---|---|
| `conversation-sidebar.test.ts` | `ReferenceError: uiIconButton is not defined` | harness 的 `window` 桩补 `uiIconButton`（照已有 `uiButton` 桩的写法） |
| `model-chip-cascade-menu.test.ts` | 同类 | 同上 |

**依据**：`uiIconButton` 由共享模块挂到 `window`，**生产环境存在**；企业侧 `conversation.js` 原本 0 处裸调用所以 harness 没桩，上游改为裸调用（6 处）后缺桩。**这是 harness 缺口，不是产品缺陷。**

### C. 死代码测试（1 个）

`test/main/features/hub_account/auth-flow.test.ts`

- 上游该测试期望 `startLogin` / `completeLogin` / `openAuthorizeUrl` / `currentLoginState`
- 企业版 `auth-flow.ts` 用员工登录流程取代了这套通用 OAuth 入口
- 实测：这 4 个函数**产品代码 0 引用**（仅该测试引用）
- 企业侧**有自己的** `auth-flow.test.ts`

**处置**：恢复企业版测试文件（`git checkout gitlab/develop-ent -- <file>`）。零代码风险，且测试与实现重新对齐。
**不采用**"给企业版补 4 个上游函数"——那是为测试养死代码。

### D. 环境：embedding 原生依赖（4 个）

```
test/main/features/kstar/forecast-commit.test.ts
test/main/features/recall/context-projection-confirm-wake.test.ts
test/main/features/recall/memory-migration.test.ts
test/main/features/recall/ontology-conflicts.test.ts
```

**根因**：本轮用 `npm install --ignore-scripts`（本机 node-gyp 报 `No Xcode or CLT version detected`），embedding 原生模块未编译 → `embed worker fatal: Cannot read properties of undefined (reading 'x')`。

**处置（按代价排序）**：

1. **推荐**：`xcode-select --install` 后跑完整 `npm install`，再 `npm run rebuild:sqlite:electron`
2. 若不能装 CLT：`npm i -D onnxruntime-node` 走预编译包（需评估，仓库规定新依赖需先讨论）
3. 兜底：这 4 个标记为环境限制，在报告中记录（**不删测试**——它们是上游新增的有效回归网）

**验证**：修好后这 4 个 + A 类 6 个应一并转绿（合计 10 个）。

### F. 打包门禁脚本（4 个）

```
test/main/util/packaged-resource-gate.test.ts    1 failed / 12 passed
test/main/util/stt-packaging-gate.test.ts        3 failed / 1 passed
test/main/util/codesign-runtime-gate.test.ts     1 failed / 4 passed
test/renderer/category-tabs.test.ts              3 failed / 33 passed
```

**根因**：断言企业打包配置的标记（产物名、资源清单），而 `package.json` / 打包脚本已取上游。
另有 `category-tabs` 断言企业 `index.html` 的 tab DOM（已取上游）。

**处置**：逐条把断言更新到**当前**配置的实际值（企业 `productName`/`artifactName` 增量仍在，所以断言应指向企业值）。需逐文件核对，约 0.5 人日。

---

## 2. E 类：64 个契约断言（**需你决策**）

这是剩余的绝对主体。它们断言的是**企业 Raymond 设计系统的 CSS token、类名与 DOM 结构**，例如：

```
kb-raymond-ui.test.ts:  expect(css).toMatch(/#panel-kb \.kb-view\s*{[\s\S]*?--kb-bg:\s*var\(--surface-app\);/)
settings-tabs.test.ts:  expect(html).toContain('class="settings-tab-pane settings-cre…')
connector-icons.test.ts: expect(src).toContain('ui-button--secondary ui-button--sm is…')
```

本次按"上游完整体现"吸收了上游 `style.css` + `index.html` + 设计 token，这些断言随之失效。

### 三个选项

| 选项 | 工作量 | 代价 | 结果 |
|---|---|---|---|
| **E1. 更新断言到上游设计系统** | ~64 文件，2–3 人日 | 需要逐条把企业 token/类名映射到上游对应物；少数上游没有的（企业专有 UI）需删除该条断言 | 保留测试守护价值，测试基线 = 上游 |
| **E2. 删除这批企业专有契约测试** | 0.5 人日 | 失去 Raymond 视觉回归网；上游本来就没有这些测试 | 测试基线 = 上游（干净） |
| **E3. 恢复企业 UI 资产** | 0.5 人日 | 与"按上游完整体现"直接冲突；上游新功能（外部 Agent 入口、首页快捷入口）仍可用但样式改动需重做 | 企业视觉回归网保住，但回到分叉 |

**我的建议：E2 + 抽样保留**。

理由：
1. 这 64 个断言的**唯一价值是守护企业 Raymond 设计系统**，而该系统已被"取上游"的决定取代——继续断言等于守护一个不存在的契约；
2. 上游对同类结构有自己的测试（`ui-components.test.ts`、各 `*-shared-ui.test.ts`、`shared-ui-adoption-guard.test.ts`），视觉回归面并未归零；
3. E1 的 2–3 人日花在"把断言改写成上游形状"上，收益远低于把同样时间投入真机验证；
4. 企业 UI 资产已备份在 `.ent-ui-backup/`（7 个文件），若将来要恢复 Raymond 线，可从备份取回并重放这批测试。

**抽样保留清单**（这 4 个建议走 E1 更新，因为它们守护的是**结构不变量**而非样式 token）：
- `shared-ui-adoption-guard.test.ts`（冻结原生控件基线，仓库硬约束）
- `renderer-structural-registry.test.ts`（页面局部结构登记表）
- `hidden-attribute-visibility.test.ts`（`[hidden]` 纪律，上游刚修过同类 bug）
- `modal-close-consistency.test.ts`（模态关闭一致性）

> 注意：这 4 个在基线/当前的状态需逐个确认，未全部在这 64 个里。

---

## 3. 执行顺序（建议）

```
第 1 步  D  修环境（xcode-select --install + 完整 npm install）
            → 预期同时解决 A 类 6 个 + D 类 4 个 = 10 个文件
第 2 步  B  补 2 个 harness 桩（10 行以内）
第 3 步  C  恢复企业 auth-flow.test.ts（1 条命令）
第 4 步  F  更新 4 个打包门禁断言
第 5 步  E  按决策执行（建议 E2 + 抽样保留 4 个 → E1）
第 6 步  全量重跑，与基线（125 失败）对比归档
```

**第 1–4 步合计约 1 人日，且不改产品代码**，预计把失败文件从 81 降到约 64（即只剩 E 类）。

---

## 4. 执行结果（D + A + B 已完成，实测）

| 步骤 | 状态 | 结果 |
|---|---|---|
| **D 环境：embedding** | ✅ **已完成** | 根因**不是缺编译工具**，而是 `resources/embedding-model/fast-bge-small-zh-v1.5.tar.gz` **未解压**（主工作区已解压，worktree 只有压缩包）。解压后 4 个全通过：`memory-migration` 5/5、`ontology-conflicts` 13/13、`forecast-commit` 18/18、`context-projection-confirm-wake` 8/8 |
| **A 并发级联** | ✅ **已随之消除** | embedding 正常后 6 个级联失败全部转绿 |
| **B harness 缺口** | ✅ **已完成** | `conversation-sidebar.test.ts` 从 7 失败 → **81/81 全通过**。修法：补 `uiIconButton`/`uiInput`/`uiTextarea`/`uiAlert`/`uiToast`/`uiConfirm`/`uiModalController` 桩，且**同时挂到 vm 的 global 与 `window`**（裸标识符解析到 global，只挂 `window` 不够） |
| **C 死代码测试** | ⚠️ 部分 | 恢复企业 `auth-flow.test.ts` 后仍有 7 失败（`AUTH_SESSION_EXPIRED`），需逐条对齐会话桩 |
| **F 打包门禁** | ➖ **无需处理** | 实测 3 个（`packaged-resource-gate`、`stt-packaging-gate`、`codesign-runtime-gate`）**基线就已失败**，非本次引入 |
| **E 契约断言** | ⏸ **待决策** | 见 §2 |

### 最终指标

| 指标 | 基线 | 合并初版 | **现在** |
|---|---|---|---|
| 失败测试文件 | 125 | 81 | **67** |
| 失败用例 | 375 | 245 | **205** |
| 通过测试文件 | 928 | 1067 | **1086** |
| 通过用例 | 11265 | 12931 | **12991** |

**相对基线净修复 58 个失败文件、170 个失败用例；通过用例增加 1726 个。**

### 剩余"本次引入"的 29 个，全部同源于 UI 吸收决策

逐条核对错误类型后确认：**29 个全部**断言的是标记/样式，**无一是产品逻辑缺陷**：

| 断言对象 | 数量 | 例子 |
|---|---|---|
| CSS token / 类名 | 17 | `expected ':root {…' to match /\.messaging-layout\s*{[^{}]*grid-tem…/` |
| DOM 标记（`index.html`） | 8 | `expected '<!doctype html>…' to contain 'class="settings-tab-pane settings-cre…'` |
| 源码标记（模块实现细节） | 4 | `expected '// ─── Settings…' to contain '_settingsRefreshEnterpriseModelAuthSu…'` |

即：**修完 D+A+B 后，所有剩余失败都收敛成"企业 Raymond 契约 vs 上游设计系统"这一件事。**

> **教训（分类方法）**：初版用错误行 grep 分类会误判（源码 dump 里出现 "embed"/"force" 等词会污染判定），
> 也曾把"模型未解压"误判为"缺 Xcode CLT"。必须**逐文件隔离重跑 + 读完整错误块 + 与基线对比**才能定性。

---

## 5. 验收标准

| 项 | 目标 |
|---|---|
| 冲突 | 0（已达成） |
| `npm run typecheck` | 0 错误（已达成） |
| 企业身份 6 项 | 全部保持（已达成） |
| 失败测试文件 | ≤ 基线的 125，力争 ≤ 20 |
| 真机验证 | 登录门禁阻断、员工登录、托管模型路由、KB/多智能体/连接器可用 |
| 企业打包 | `npm run build:ent:mac` 需注入 `COGSEED_HUB_API_BASE` |

---

## 6. 一句话总结

**81 个失败里只有 64 个与"取上游 UI"这个决策直接相关，其余 17 个都是测试侧适配问题（不涉及产品代码）。** 建议先把这 17 个清掉（1 人日），再对 64 个做 E2 决策——这样能把"合并是否可用"的判断与"要不要保留企业视觉回归网"的判断分开，前者今天就能有结论。
