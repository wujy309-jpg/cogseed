# 企业版同步执行状态（2026-09-27）

- 预演位置：`.worktrees/ent-sync`（分支 `work/ent-sync-20260927`）
- 状态：**合并进行中，冲突态**，尚未提交
- 进度：51 个冲突 → **已解决 21 个，剩余 30 个**
- 处置原则：**只吸收功能，不吸收 UI**

> 全程在主工作区之外进行；`work/20260924-fixes` 与 20 个未提交项未被触碰。

---

## 1. 已解决（21 个，全部通过校验）

### 1.1 手工解决（12 个）

| 文件 | 冲突块 | 处置与依据 |
|---|---|---|
| `src/renderer/modules/boot.js` | 3 | 变量改名采上游（`openLegacyAgents` → `openLegacyAgentConnections`）；**冲突 3 采上游结构并删除企业侧多余的 `}`**（上游用 `else if` 自身闭合） |
| `src/renderer/modules/settings.js` | 3 | **取企业侧**：企业用「隐藏 input + `__box` 伪元素」的 chip 体系（`ui-components.css` 13 条样式），上游用裸 `ui-checkbox`（企业侧该样式 0 条）。取上游会导致复选框**不可见** |
| `src/renderer/modules/kb-eco.js` | 3 | **取企业侧**：`kb-raymond-ui.test.ts` 强制要求 `role="tablist"`/`aria-selected="${String(active)}"`/`kb.eco.knowledge` 等企业侧 key 与 a11y 标记；上游已删除这些断言 |
| `package.json` | 2 | 版本采上游 `1.2.0`（消除 `npm ci` 失配）；企业 `appId`/`productName`/`build:ent:*`/`extraMetadata` 全保留；两套 verify 脚本并存 |
| `src/renderer/locales/{zh,en,ja,pt}.json` | 20 | 脚本化 key 并集（见 §1.2） |
| `src/renderer/ui-components.css` | 4 | 冲突 1/3 取企业侧；**冲突 2 取并集**（保留企业 `--login` 变体 + 吸收上游 `[hidden]` bug 修复）；**冲突 4 取上游 337 行**新组件样式 |
| `src/renderer/index.html` | 7 | 结构块（认知资产骨架）取企业侧；**script 引用块取上游**（5 个新 `ui-*` 模块）；删除重复的 `composer-popovers.js` |
| `test/main/features/hub_account/account-events.test.ts` | — | 保留企业侧**删除**（`23cbefe4` 切原生 Hub API 的配套动作；`account-events.ts` 实现仍在，被 3 处引用） |
| `scripts/audit-kstar-precipitation.mjs` | — | 保留企业侧（上游因隐私清理删除；企业仓私有） |

### 1.2 Locale 并集（关键，脚本化）

新增 `scripts/resolve-locale-conflicts.py` 与 `scripts/restore-referenced-locale-keys.py`：

- **策略**：上游为基底 + 企业同名 key 覆盖；
- **结果**：`zh`/`en` 9329 keys、`ja`/`pt` 7165 keys，**两侧 key 零丢失**；
- **陷阱发现**：上游 `6fdec238` 在 `ja`/`pt` **删除了 55 个 key**，其中 2 个（`action_approval.actor_fallback`、`cognition.status_confirmed` 类）仍被企业代码引用 → 已从 base 补回；其余 53 个经**精确检索确认无引用**，尊重上游删除；
- 早先"298 个仍被引用"的判断是**子串匹配假阳性**，已纠正。

### 1.3 取企业侧的纯 UI 文件（9 个）

`style.css`（156 冲突块 / 上游 25173 行）、`tokens.css`、`workspace.css`、`shell-navigation.css`、`component-gallery.html`、`component-gallery.js`、`model-guard.js`、`ui-sidebar-tools.js`、`ui-button.js`

### 1.4 校验结果

19 个文件全部通过语法/JSON 校验；企业身份完整性全部保持：

```
identity.appId    = com.cogseed.enterprise    ✓
identity.dataRoot = .cogseed-enterprise       ✓
brand.zhName      = CogSeed 企业版             ✓
package appId     = com.cogseed.enterprise    ✓
package channel   = enterprise                ✓
build:ent:mac     = 在                        ✓
门禁断言(ipc/index.ts) = 10                   ✓
hub_account 模块      = 18 个 .ts             ✓
企业文案键(zh)        = 6                      ✓
```

---

## 2. 剩余 30 个冲突

### 2.1 关键路径：Hub 基址（5 个）—— 必须解决，否则企业版静默故障

| 文件 | 说明 |
|---|---|
| `src/main/features/api_base.ts` | 企业硬编码 `cogseed-open.bonc.com.cn`；上游改为 `resolveCogSeedApiBase(env, channel, hubApiBase)` |
| `src/main/util/build-identity.ts` | 采并集：企业 `enterprise` 渠道枚举 + 上游 `hubApiBase` 字段 |
| `src/main/features/hub_account/client.ts` | 保留企业真实域 + 上游三级优先级 |
| `src/main/index.ts` | 企业门禁接线 + 上游改动并集 |
| `src/main/features/group_chat/index.ts` | 上游 271 行改动 |

**推荐解法**（最低分叉）：复用上游打包期注入机制——
`build:ent:*` 改为 `--hub-api-base=$COGSEED_HUB_API_BASE_URL`，
渠道默认值抽到企业独立文件，源码树从此不含内部域名。

### 2.2 脚本（4 个）

`run.sh`、`scripts/package-dev-mac.cjs`、`scripts/restart-cogseed.sh`、`scripts/verify-packaged-dev.cjs`、`package-lock.json`

### 2.3 渲染模块（5 个）+ 测试（15 个）

| 文件 | 冲突块 | 建议 |
|---|---|---|
| `kb-workbench.js` | **103** | ⚠️ 见 §3，**架构分叉，需专项决策** |
| `conversation.js` | 4 | 取上游（企业已有 `uiButton`/`uiIconButton`/`.ui-modal*` 样式） |
| `connectors.js` | 3 | 取上游（依赖 `uiStatusPill`/`uiCard`，样式已就位） |
| `kb-notes.js` | 7 | 取上游 |
| `agents.js` | 1 | 取上游（composer 锚点逻辑，功能） |
| `kb-discover.js` | 1 | ⚠️ 见 §4，**需产品决策** |
| 测试 15 个 | — | 渠化适配 |

---

## 3. ⚠️ `kb-workbench.js`：架构分叉，不是文本冲突

| | 行数 | 相对 base |
|---|---|---|
| base | 7033 | — |
| 企业侧 | **5438** | +808 / **−2403**（删减式重构） |
| 上游 | **7984** | 新增 950+ 行功能 |

- 103 个冲突块、我方 720 行 / 上游 2530 行；
- 最大单块：上游 **963 行**、306 行、109 行新功能，企业侧对应位置几乎为空；
- **企业侧做过上游没有的共享组件迁移**：`uiButton`/`uiIconButton`/`uiEmptyState`/`uiModalController`/`_adoptModal`/`_refreshLocalizedChrome` 标记企业侧全有、上游**全无**；
- 而企业测试 `kb-raymond-ui.test.ts` **强制要求这些标记**。

**结论**：两侧是**双向深度分叉**——企业做了 UI 重构（丢弃 2403 行），上游做了功能扩展（新增 950+ 行）。逐行合并无法收敛，必须**人工把上游新功能移植进企业的重构后结构**，属专项工程而非合并动作。

**建议**：本轮先保留企业侧，把上游新功能登记进「待吸收清单」，单独排期。

---

## 4. ⚠️ 需产品决策的两项

### 4.1 KB「发现」模块（`kb-discover.js`）

企业版 28 行占位符（`#159` 待开发）vs 上游 1075 行完整实现。取上游 = 功能上线 + 顺带修掉下述 bug；保留 = 必须删掉死代码。

### 4.2 认知资产 DOM 分叉（`index.html` + `cognition-assets`）

- 企业侧 `index.html` **没有 `#ca-root`**，但企业自己的 `cognition-assets/app.js` **期望它存在**（`#panel-recall > #ca-root`）——**这是同步前就存在的问题**；
- 企业侧另有完整的 `skills-cognition-*` 自定义骨架，被企业认知 UI 依赖；
- 上游用 `#ca-root` 单容器取代了企业侧的大段骨架。

本次已按"不吸收 UI"取企业侧 HTML。若不修，`cognition-assets` 仍挂载不上（既有问题，非本次引入）。

---

## 5. 顺带发现的既有 bug（同步前就存在）

| # | 位置 | 问题 |
|---|---|---|
| 1 | `src/renderer/modules/kb-discover.js` | 28 行占位符里 `_state`/`_renderAll` **未定义**（定义 0 处），`i18n-change` 监听器一触发即抛 `ReferenceError`；`module.exports` 还导出 5 个未定义符号 |
| 2 | `cognition-assets/app.js` | 期望 `#ca-root`，但企业 `index.html` 未提供该元素 |

---

## 6. 复现与回滚

```bash
cd .worktrees/ent-sync

# 查看剩余冲突
git diff --name-only --diff-filter=U

# 继续解决后提交（本轮未提交）
git commit --no-edit

# 放弃全部（回到 develop-ent）
git merge --abort
cd ../.. && git worktree remove .worktrees/ent-sync --force && git branch -D work/ent-sync-20260927
```
