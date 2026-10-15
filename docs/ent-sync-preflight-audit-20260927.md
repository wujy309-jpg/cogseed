# 企业版同步预演审计（阶段 3 前置）

- 日期：2026-09-27
- 预演位置：`.worktrees/ent-sync`（分支 `work/ent-sync-20260927`，源自 `gitlab/develop-ent`）
- 预演动作：`git merge --no-ff --no-commit origin/develop`（`4d5c2fd9` → `ead9af66`）
- 状态：**冲突态未提交**，可随时 `git merge --abort` 或删除 worktree 丢弃
- 预演结论：`merge-tree` 预测的 51 个冲突 **与实际合并完全一致 ✓**

> 本文件只记录预演发现，不构成提交。解决动作见 `docs/enterprise-sync-plan-20260927.md`。

---

## 1. 意外发现：企业版存在一个真实运行时 bug

**`src/renderer/modules/kb-discover.js` 企业侧只有 28 行，却引用了 4 个未定义符号。**

| 符号 | 企业侧定义 | 引用位置 |
|---|---|---|
| `_state` | **0 处** | `i18n-change` 事件监听器 |
| `_renderAll` | **0 处** | 同上 |
| `_feishuDisconnectModalOptions` 等 5 个 | **0 处** | `module.exports` 桥 |

关键行（企业侧第 25 行）：

```js
window.addEventListener('i18n-change', () => { if (_state.rendered) _renderAll(); });
```

**`_state` 从未定义 → 语言切换触发 `i18n-change` 时必然抛 `ReferenceError`。**

- 成因：`#159 fix(kb): ... 发现模块待开发` 把 1075 行的实现替换成占位符，但漏删了尾部的事件监听与 CommonJS 桥。
- 影响面：只要企业包切换语言，控制台报错，KB「发现」模块的 i18n 响应失效。
- 处置建议：**本次同步顺手修掉**（采用上游实现，或删掉这两行死代码）。

---

## 2. 发现二：企业内部域名仍硬编码（与对比报告一致）

`build-identity.ts` / `hub_account/client.ts` 的冲突印证了 `docs/enterprise-vs-opensource-comparison-20260927.md` §5.1：

| 文件 | 企业侧 | 上游侧 |
|---|---|---|
| `hub_account/client.ts` | `RELEASE_HUB_API_BASE = 'https://cogseed-open.bonc.com.cn'` | `'https://hub.example.com'` + 新增 `hubApiBase` 三级优先级 |
| `build-identity.ts` | 无 `hubApiBase` 字段 | 新增 `hubApiBase` 字段（打包期注入） |
| `api_base.ts` | `ENTERPRISE_API_BASE` 硬编码真实域 | 改为 `resolveCogSeedApiBase(env, channel, hubApiBase)` |

**这与「不吸收 UI」无关，是必须解决的功能冲突**——处置见方案 §2.2（复用上游打包期注入机制）。

---

## 3. ⚠️ 「不吸收 UI」的致命前提（本次最重要结论）

上游把大量原生控件迁移到共享 UI 组件，**而功能代码依赖这些组件**。实测引用次数：

| 新模块 | 全局函数 | 在冲突文件中的引用 |
|---|---|---|
| `ui-status.js` | `uiStatusPill` | **4 次**（`connectors.js`） |
| `ui-card.js` | `uiCard` | **3 次**（`connectors.js`、`kb-discover.js`） |
| `ui-structure.js` | `uiTree` | **3 次**（`kb-workbench.js`） |
| `ui-tabs.js` | `uiTabs` / `hydrateUiTabs` | 各 1 次（`kb-discover.js`） |

企业侧**完全没有**这 5 个模块（`ui-tabs` / `ui-status` / `ui-card` / `ui-structure` / `ui-drawer`），`index.html` 里也没有注册。

> **结论：如果只把功能代码取上游、却把 `index.html` 也归入"UI"而取企业侧，
> 上述功能代码会在运行时遇到 `uiStatusPill is not a function` 之类的错误。**
> 这类错误在 `npm run typecheck` 里**查不出来**（renderer 是 classic script，`window.*` 调用无类型信息）。

### 精确化的政策：不吸收"样式重写"，必须吸收"新组件 + 其样式"

| 类别 | 文件 | 处置 |
|---|---|---|
| ❌ 不吸收（样式重写） | `style.css`（156 个冲突块）、`workspace.css`、`tokens.css`、`shell-navigation.css` | 整文件取企业侧 |
| ⚠️ **逐块解决** | `ui-components.css` | **见下方 §3.1，不能整文件排除** |
| ✅ **必须吸收** | `ui-tabs.js`、`ui-status.js`、`ui-card.js`、`ui-structure.js`、`ui-drawer.js`（**新增文件，无冲突**） | 随合并自动带入，**不要删除** |
| ✅ **必须回补** | `src/renderer/index.html` 中这 5 个模块的 `<script>` 引用（上游第 1874–1883 行） | 解决冲突时必须加回 |

### 3.1 `ui-components.css` 必须逐块处理（关键）

企业侧**完全缺失**新组件的样式类（实测：企业 0 处 / 上游有定义）：

| CSS 类 | 企业侧 | 上游 |
|---|---|---|
| `.ui-status-pill` | **0** | 6 处 |
| `.ui-tree` | **0** | 14 处 |
| `.ui-tab` / `.ui-tabs` | **0** | 11 / 2 处 |
| `.ui-drawer` | **0** | 7 处 |
| `.ui-resource-card` | **0** | 12 处 |

该文件 4 个冲突块的结构决定了正确解法：

| 冲突块 | 我方 | 上游 | 性质 | 处置 |
|---|---|---|---|---|
| 1（第 34 行） | 4 行 | 1 行 | 既有样式分歧 | 取企业侧 |
| 2（第 49 行） | 11 行 | 12 行 | 既有样式分歧 | 取企业侧 |
| 3（第 194 行） | 11 行 | 10 行 | 既有样式分歧 | 取企业侧 |
| **4（第 244 行）** | **0 行** | **337 行** | **纯新增**——正是新组件的全部样式 | **取上游** |

> **结论**：`ui-components.css` 取「企业侧为主 + 吸收冲突块 4 的 337 行新增」。
> 这样既保住企业 UI 血脉，又让同步进来的 `connectors.js` / `kb-workbench.js` / `kb-discover.js`
> 能正确渲染 `uiStatusPill` / `uiCard` / `uiTree` / `uiTabs`。

**企业侧已有的组件无需担心**（实测均在）：`uiModal`(`ui-modal.js`)、`uiForm`/`uiCheckbox`/`uiSwitch`(`ui-form.js`)、
`uiButton`(`agents.js`)、`uiIconButton`(`contexts.js`)、`uiToast`(`core.js`)、`uiEmptyState`(`contexts.js`)，
且 `.ui-modal`/`.ui-modal__header`/`.ui-modal__title`/`.ui-modal__footer`/`.ui-modal--lg`/`.ui-modal--sm`
在企业 `ui-components.css` 中均有定义——所以 `conversation.js` 的模态框迁移是安全的。

---

## 4. 51 个冲突的完整分类

### 4.1 按处置类型

| 处置 | 数量 | 说明 |
|---|---|---|
| **机械取企业侧** | 9 | 纯 UI 资产（见 4.2） |
| **删除类冲突** | 2 | 见 4.3 |
| **政策并集** | 31 | locales / index.html / 配置 / 测试 |
| **需人工判断** | **9** | 见 4.4 |

### 4.2 机械取企业侧的 9 个（不吸收 UI）

`style.css`、`tokens.css`、`workspace.css`、`shell-navigation.css`、`component-gallery.html`、`component-gallery.js`、`model-guard.js`、`ui-sidebar-tools.js`、`ui-button.js`

> `ui-components.css` **不在**此列——它必须逐块处理，见 §3.1。
>
> ⚠️ `component-gallery.js`（我方 28/38）与 `model-guard.js`（我方 18/8）判定为"以 UI 为主"，
> 但**请人工确认其中没有企业功能逻辑**再丢弃。

### 4.3 删除类冲突（2 个）——已查明方向，可直接处置

| 文件 | base | 企业侧 | 上游 | 原因 | 处置 |
|---|---|---|---|---|---|
| `test/main/features/hub_account/account-events.test.ts` | 有 | **删除** | 有 | 企业 `23cbefe4` 切到原生 Hub API 时删除该测试 | **保留删除**（`git rm`）——但见下方注意 |
| `scripts/audit-kstar-precipitation.mjs` | 有 | 有 | **删除** | 上游隐私清理 `4566e997`/`091a7dbc` 删除 | **保留企业侧**（企业仓私有，脚本仍有效） |

> **注意**：`account-events.ts` 实现文件仍被 3 处引用（`auth-flow.ts`、`ipc/hub-account.ts`、`employee-flow.test.ts`），
> 所以删的是测试而非实现。企业侧对 `broadcastHubStateChanged` 的覆盖因此缺失——建议**补一个精简测试**，而不是恢复上游旧测试。

### 4.4 需人工判断的 9 个功能文件

| 文件 | 冲突块 | 我方行 | 上游行 | 性质 | 建议处置 |
|---|---|---|---|---|---|
| `kb-workbench.js` | 103 | 720 | 2530 | KB 重构 + `uiTree` 迁移 | 取上游 + 回补企业钩子（**最大工作量**） |
| `kb-discover.js` | 1 | 0 | 1024 | 企业砍成占位符，上游是完整实现 | **产品决策**：见 §5 |
| `kb-notes.js` | 7 | 47 | 234 | 功能增量 | 取上游 + 回补 |
| `conversation.js` | 4 | 32 | 44 | 全部是共享 UI 迁移（`uiButton`/`uiIconButton`） | 取上游（企业已有这些组件） |
| `connectors.js` | 3 | 54 | 151 | 搜索功能新增 + 详情重渲染 + 模态迁移 | 取上游（依赖 `uiStatusPill`/`uiCard`，见 §3） |
| `agents.js` | 1 | 1 | 20 | composer 成员选择器锚点逻辑 | 取上游（**功能**，非 UI） |
| `settings.js` | 3 | 5 | 16 | 原生控件 → `uiCheckbox`/`uiSwitch` | 取上游（企业已有这两个组件） |
| `kb-eco.js` | 3 | 22 | 43 | locale key 改名（`kb.eco.discover` → `kb.eco.nav_discover`）+ `uiToast` 调用 | 取上游 + **同步 locales key** |
| `boot.js` | 3 | 5 | 6 | 变量改名（`openLegacyAgents` → `openLegacyAgentConnections`）+ 控制流调整 | 取上游（纯功能，无 UI 影响） |

**重要修正**：`conversation.js`、`settings.js`、`kb-eco.js`、`boot.js` 的冲突内容**本质是功能/命名**，
不是样式——"不吸收 UI"对它们**不适用**，必须按功能吸收。我最初按 diff 总量把它们标为"UI/中性"是口径过粗，
逐块审计后才看清（这也是为什么自动判定不能当最终结论）。

---

## 5. 需要产品决策的一项：KB「发现」模块

| | 企业版 | 上游 |
|---|---|---|
| 实现 | 28 行占位符（`uiEmptyState` 显示"发现功能正在建设"） | 1075 行完整实现（含飞书/共享源、`uiTabs` 分区） |
| 依据 | `#159 fix(kb): ... 发现模块待开发` | 持续演进 |

**两个选项**：

- **A（推荐）**：吸收上游实现 → 企业版用户获得"发现"功能，同时顺带修掉 §1 的 bug；但企业版此前刻意隐藏该模块的产品意图被推翻。
- **B**：保留占位符 → 必须**修掉那两行死代码**（否则语言切换报错），并把上游的 `kb-discover.js` 加入"永不吸收"清单。

> 这一项我无法替你决定，需要产品负责人拍板。**在此之前不要动这个文件。**

---

## 6. 预演产物与复现

| 产物 | 路径 |
|---|---|
| 逐文件冲突详情（9 个功能文件） | `docs/ent-sync-conflicts/*.md` |
| 全量冲突块统计 | `node scripts/ent-sync-conflict-blocks.mjs`（在 worktree 内运行） |
| 分诊结果 JSON | `docs/ent-sync-triage-2026-09-27.json` |

```bash
# 复现预演（已完成，如需重来）
cd .worktrees/ent-sync
node ../../scripts/ent-sync-conflict-blocks.mjs                     # 摘要
node ../../scripts/ent-sync-conflict-blocks.mjs --file <path> --md  # 单文件详情

# 放弃预演（丢弃全部冲突态）
git merge --abort
# 彻底丢弃 worktree
cd ../.. && git worktree remove .worktrees/ent-sync --force && git branch -D work/ent-sync-20260927
```

**当前风险为零**：预演在独立 worktree 内，主工作区（`work/20260924-fixes` 及 5 个未提交 docs 提交）**未被触碰**。
