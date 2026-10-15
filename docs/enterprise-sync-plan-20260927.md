# 开源版功能同步到企业版 —— 执行方案

- 日期：2026-09-27
- 目标分支：`develop-ent`（企业版主线，`2990b932`）
- 前置事实来源：`docs/enterprise-vs-opensource-comparison-20260927.md`
- 方案性质：**工程执行方案**，含取舍决策、冲突处置表、验证门禁、回滚点

---

## 0. 结论：这件事不能靠"跑一次 merge"

我用 `git merge-tree`（不碰工作区）预演了 `develop-ent += origin/develop`：

| **预演结果** | 数值 |
|---|---|
| 自动合并成功 | 623 个文件 |
| **真冲突** | **51 个文件**（严格按冲突状态行统计，已排除 `Auto-merging` 提示行） |
| 企业专有文件是否幸存 | **全部幸存**（`enterprise-gate.ts`、`model-governance.ts`、`enterprise-login-gate.js`、`.gitlab-ci.yml` 等逐个验证 ✓） |
| 企业身份配置是否幸存 | ✓（`appId` 仍 `com.cogseed.enterprise`，`zhName` 仍 `CogSeed 企业版`） |
| 门禁调用是否幸存 | ✓（`ipc/index.ts` 中 9 处 `assertEnterpriseSession` 全在：1 行 import + 8 处调用） |

**好消息**：企业版的隔离架构是有效的——上游没碰的文件原样保留。
**坏消息**：51 个冲突里包含**企业命脉文件**，而且如果沿用现有的 `resolve-sync-conflicts.sh`（规则 3 = 其余冲突整文件取企业侧），会**静默丢弃上游在 `bus.ts`、`conversation.js`、`kb-workbench.js` 等文件里的全部功能修复**——同步的意义直接归零。

所以本方案的核心不是"怎么合并"，而是**先重建分叉纪律，再执行合并**。

---

## 1. 阶段 0：先解决三个决策项（阻塞项，未决策不要动 merge）

### 决策 A：跟随哪个上游？→ **必须选 `origin/develop`（私仓）**

| 选项 | 缺失提交 | merge-base | 结论 |
|---|---|---|---|
| **`origin/develop`（私仓）** | **142**（去 merge 93） | `4d5c2fd9`（2026-09-16） | ✅ **推荐**：`develop-ent` 的实际祖先，历史连续 |
| `public/develop`（开源公仓） | 297（去 merge 228） | `8889f19c`（2026-08-26） | ❌ 与 `develop-ent` 已分叉，多出的 142 个提交属于另一条线 |

**依据**：私仓与开源公仓**互不包含**（各约 300 个独有提交，在 `8889f19c` 处分开）。`develop-ent` 历史上同步的提交（`4d5c2fd9`/`953288bf`/`5ad02101`）**全部来自私仓**。

> ⚠️ 但企业仓 `.gitlab-ci.yml` 第 49 行 `UPSTREAM_REMOTE` 配的是**开源公仓**。**决策 A 若不落地，下一次 CI 自动同步会引入一条企业线从未验证过的历史。**

**要改的地方（4 处，必须一起改）**：
1. `.gitlab-ci.yml` → `UPSTREAM_REMOTE`
2. `.gitlab-ci.yml` → `mirror-github` job 的镜像源（第 160 行）
3. `scripts/sync-upstream.sh` → 默认 `REMOTE=upstream` 的指向（第 14 行注释亦需同步）
4. `docs/enterprise-line.md` §1 「追踪上游开源仓 develop」

### 决策 B：企业线要不要把开源功能"回流"到公仓？→ **建议要，但排在同步之后**

企业版有 2 项上游缺失的修复（`local-tools.ts` 的 `find` 旗标修复、`packaged-resource-gate.cjs` 契约行）。这些留在企业侧只会持续制造冲突，应在同步完成后单独 MR 回合。

### 决策 C：`style.css` 这类巨型分叉怎么处理？→ **单独决策，不要夹在功能同步里**

`style.css` 是最大冲突点（两侧合计 65261 行变更）。企业版有 `raymond-shell.css` 统一 UI 血脉，上游有独立的 UI 演进。
**建议**：本次同步对该文件采取「企业侧为准 + 记录待吸收清单」，**不试图吸收上游 UI**——否则等于把功能同步变成 UI 重做，必然失败。

---

## 2. 分叉纪律：把冲突面压到最小

当前 `src/` 有 298 个文件差异。**同步的目标不是消除差异，而是让差异只存在于"企业专有"位置**。

### 2.1 三层分叉策略

| 层 | 内容 | 同步时行为 |
|---|---|---|
| **L1 独立文件** | 企业新增模块（`hub_account/*` 10 个、`enterprise-*.js`、`.gitlab-ci.yml`、企业脚本与文档） | 上游不碰 → **永久零冲突**。已有架构，保持 |
| **L2 独立配置** | `identity.json`、`brand.json`、`package.json` 的 `build.appId`/`productName` 等 | 上游不碰 → 零冲突。保持 |
| **L3 共享代码改动** | `api_base.ts`、`hub_account/client.ts`、`build-identity.ts`、`ipc/index.ts`、`index.html` | **冲突来源。目标：把 L3 压缩到最少且最稳定** |

### 2.2 L3 重构：复用上游的注入机制，去掉企业硬编码

**当前问题**（合并后会静默故障）：

```
企业侧 api_base.ts:      ENTERPRISE_API_BASE = 'https://cogseed-open.bonc.com.cn'
上游 918441d8 对侧:      PACKAGED_DEV_API_BASE = 'https://hub.example.com'
                        resolveCogSeedApiBase(env, channel, hubApiBase)  ← 新增注入参数
```

上游 `write-build-info.cjs` **已经支持**打包期注入（已验证）：

```bash
node scripts/write-build-info.cjs --channel=release --hub-api-base=https://hub.acme.test
# 或 COGSEED_HUB_API_BASE=https://hub.acme.test node scripts/write-build-info.cjs --channel=enterprise
# release 渠道未注入会直接报错退出；enterprise 渠道允许留空
```

**推荐重构**（同时也是**上游 MR 候选**，回合后企业侧改动归零）：

1. `api_base.ts` 改为接受 `hubApiBase` 注入（与上游同签名），删掉 `ENTERPRISE_API_BASE` 硬编码常量；
2. 各渠道默认值抽到一个**企业独立文件**（如 `src/resources/service-origins.json`），上游不碰该文件 → 该点由 L3 降为 L2；
3. 企业打包脚本改为注入：

```json
"build:ent:mac": "node scripts/write-build-info.cjs --channel=enterprise --hub-api-base=$COGSEED_HUB_API_BASE_URL && electron-builder --mac"
```

4. `build-info.json` **从版本库移除**（它是构建产物，且上游不入库）。企业侧当前入库的那份 `commit` 还是 `589fae70`、`dirty: true`，是过期产物。

> 收益：企业版**源码树里不再出现任何内部域名**，与开源侧的发布扫描要求一致，且 `api_base.ts` 不再是冲突点。

### 2.3 更新同步工具：`resolve-sync-conflicts.sh` 现行规则必须改

现行规则 3「其余冲突文件整文件取企业侧」在**功能同步**场景下是**有害的**——它会把上游的 `bus.ts`(+1909)、`conversation.js`(+1254)、`kb-workbench.js`(+3327)、`settings.js` 修复全部丢掉。

**改造为**：
- 规则 1（locales 并集）保留，但需适配上游 `24ef13d8`/`6fdec238` 的 i18n key 化；
- 规则 2（index.html）保留，需补上游新增的 7 个 `ui-*.js` / `composer-members.js` / `member-work-state.js` 引用；
- **规则 3 改为"白名单"**：只有列入企业专有清单的文件才允许整文件取企业侧；其余冲突**必须人工解决**，脚本拒绝自动处理并列出文件。

---

## 3. 冲突清单与处置决策（51 个）

### G1 配置 / 渠道 / 身份 —— 关键路径，错一个就静默故障（8 个）

| 文件 | 处置 |
|---|---|
| `src/main/features/api_base.ts` | **手工，按 §2.2 重构**（最高优先级） |
| `src/main/features/hub_account/client.ts` | **手工**：保留企业 `RELEASE_HUB_API_BASE` 真实域 + 上游新增的 `hubApiBase` 三级优先级；`normalizeHttpsOrigin` 采纳上游 |
| `src/main/util/build-identity.ts` | **手工并集**：企业 `BuildChannel` 的 `enterprise` 枚举 + 上游新增 `hubApiBase` 字段 |
| `src/main/index.ts` | **手工**：企业门禁接线 + 上游改动并集 |
| `package.json` | **手工**：企业 `appId`/`productName`/`build:ent:*`/`extraMetadata` 保留；上游版本号与新脚本采纳 |
| `package-lock.json` | 采纳上游为基底，再跑 `npm install` 重建（勿手工） |
| `run.sh` | 手工：企业数据根/env 前缀 + 上游改动 |
| `scripts/restart-cogseed.sh` | 采纳上游（`1185cc77` 修嵌套 worktree 误报），企业增量若无害则保留 |

### G2 i18n（4 个）—— 上游有 breaking 改动

`zh.json` / `en.json` / `ja.json` / `pt.json`

- 上游 `24ef13d8`（**breaking**）与 `6fdec238`（**breaking**）做了知识库文案 key 化收口；
- 处置：**上游为基底 + 企业同名键覆盖**（`enterprise_login.*` 与品牌文案企业侧永远赢），上游新 key 全量吸收；
- 验证：跑企业侧 i18n 门禁（8/8 模块响应 `i18n-change`）。

> 已预演确认：合并结果中 `zh.json` 的 `enterprise_login` 键**仍在**（6 处）。但 key 化收口后是否仍被引用，必须实测。
### G3 HTML 入口（2 个）

- `src/renderer/index.html`：企业为基底 + **回补上游新增引用**（`ui-tabs.js`、`ui-status.js`、`ui-card.js`、`ui-structure.js`、`ui-drawer.js`、`composer-members.js`、`member-work-state.js`）；企业 3 个 `enterprise-*.js` 引用必须保留；
- `src/renderer/component-gallery.html`：同上。

### G4 样式（5 个）—— 本次不吸收上游 UI（决策 C）

`style.css`、`ui-components.css`、`tokens.css`、`workspace.css`、`shell-navigation.css`

- 处置：**企业侧为准**，并入「待吸收清单」；
- 但需**人工确认**上游在这 5 个文件里没有夹带**功能性**类名/选择器（如新模块依赖的类），否则新模块会渲染异常。

### G5 功能模块（13 个）—— 核心增量，必须逐个手工

`src/main/features/group_chat/index.ts` + 12 个 renderer 模块：`kb-workbench.js`、`kb-notes.js`、`kb-discover.js`、`kb-eco.js`、`conversation.js`、`connectors.js`、`agents.js`、`settings.js`、`boot.js`、`model-guard.js`、`ui-button.js`、`ui-sidebar-tools.js`。

- 处置：**上游功能为准 + 企业钩子保留**。企业钩子集中在少数模式：渠道判断、品牌文案、门禁调用、企业 UI 类名；
- 每解决一个文件，对照企业侧 `git diff 4d5c2fd9 develop-ent -- <file>` 逐块确认企业增量是否保留。

> **注意：不在冲突列表 ≠ 不需要验证。** 很多大改动是**自动合并成功**的，例如：
> - `src/main/features/group_chat/bus.ts`（上游 ~1909 行变更）→ 自动合并 ✓
> - `src/renderer/modules/lazy-features.js` → 已预演确认**两侧增量都吸收**（企业 `messaging` 块 + 上游 `kb-quiz` 块均存在 ✓）
>
> 自动合并只保证**文本不冲突**，不保证**语义正确**。这些文件同样要跑功能回归（见阶段 4）。

### G6 测试（12 个）

`test/main/features/api_base.test.ts`、`group_chat/execution-config.test.ts`、`hub_account/{account-events,auth-flow,channel-defaults,client}.test.ts`、`test/renderer/*.test.ts`（6 个）、`test/scripts/package-dev-mac.test.ts`

- 处置：**渠道化测试优先**（`docs/enterprise-line.md` 已列出 8 件契约测试的渠道化做法）；
- 原则：同一套测试在开源线/企业线**都必须通过**——身份/协议断言以 `identity.json`/`brand.json` 为事实来源，不硬编码。

---

## 4. 执行步骤

### 阶段 1：冻结与预备（不影响任何人）

```bash
# 1) 备份当前企业线（本地 + 远端）
git branch backup/develop-ent-pre-sync-$(date +%Y%m%d) gitlab/develop-ent
git push gitlab backup/develop-ent-pre-sync-$(date +%Y%m%d)   # 走 MR 或由管理员执行

# 2) 建立独立工作树，避免污染当前工作区（当前有未提交改动）
git worktree add .worktrees/ent-sync -b work/ent-sync-20260927 gitlab/develop-ent

# 3) 固定上游提交，不用浮动分支名（防止同步中途上游又动）
UPSTREAM_SHA=$(git rev-parse origin/develop)   # ead9af66
echo "$UPSTREAM_SHA" > .worktrees/ent-sync/.sync-upstream-sha
```

### 阶段 2：先改工具与纪律（在合并之前）

1. 改 `resolve-sync-conflicts.sh` 规则 3 为白名单制（§2.3）；
2. 改 `.gitlab-ci.yml` / `sync-upstream.sh` 的上游指向（决策 A）；
3. 给 `sync-upstream.sh` 加 `merge-tree` 预检（零成本，随时可跑）：

```bash
# 注意：必须排除 Auto-merging/CONFLICT 提示行，否则会把「成功自动合并」的文件误算成冲突
git merge-tree --write-tree --name-only --messages develop-ent origin/develop \
  | sed -n '2,$p' | grep -vE '^$|^CONFLICT|^Auto-merging|^warning|^Merge' | sort -u > /tmp/conflicts.txt
wc -l < /tmp/conflicts.txt   # 应为 51
```

### 阶段 3：执行合并（建议单次，不切片）

**为什么单次**：`cbb35145`、`f3f9f5e0` 等是大型状态机重构，切片合并会产生无法独立验证的中间态；且 51 个冲突跨文件关联，切片反而反复重解。

```bash
cd .worktrees/ent-sync
git merge --no-ff "$UPSTREAM_SHA" -m "merge: 同步上游 develop（私仓 ${UPSTREAM_SHA:0:8}）142 个提交"
```

**解决顺序（严格按此序，G1 先做）**：

1. **G1 配置/渠道** —— 先解决，因为后续所有构建与测试都依赖它；
2. **G4 样式** —— 快速按企业侧过掉，记录待吸收；
3. **G2 i18n + G3 HTML** —— 按并集规则；
4. **G5 功能模块** —— 最耗时，逐个文件对照企业增量；
5. **G6 测试** —— 最后，因为测试要适配前面的改动。

### 阶段 4：验证门禁（缺一不可）

```bash
npm run typecheck                 # 必须 0 错误
npm test                          # 注意：不要用 npx vitest
```

**企业专有回归（同步后必查，这些是最容易被静默破坏的）**：

| 检查项 | 命令/方式 | 期望 |
|---|---|---|
| 企业身份未被覆盖 | `grep appId src/resources/identity.json` | `com.cogseed.enterprise` |
| 门禁接线完整 | `grep -c assertEnterpriseSession src/main/ipc/index.ts` | 9（1 import + 8 调用） |
| 企业模块未被删 | `ls src/main/features/hub_account/` | 10 个文件 |
| 企业文案未被覆盖 | `grep -c enterprise_login src/renderer/locales/zh.json` | ≥6 |
| 企业脚本引用未丢 | `grep -c enterprise- src/renderer/index.html` | ≥6 |
| 企业渠道枚举在 | `grep enterprise src/main/util/build-identity.ts` | 命中 |
| **无内部域名残留判断** | `grep -rn "bonc.com.cn" src/` | 按 §2.2 重构后应为 0 |

**真机验证**（不通过不算完成）：

```bash
bash scripts/restart-cogseed.sh
# 企业包构建与首启
npm run build:ent:mac
# 手工验证清单：
#  1) 未登录时全屏登录屏出现且阻断启动
#  2) 员工登录走通，进入工作区
#  3) 托管模型路由生效（企业网关 provider）
#  4) 知识库/多智能体/连接器等被同步的功能正常
#  5) 与开源版同机可同时运行（数据根隔离未被破坏）
```

### 阶段 5：收口

1. 更新 `docs/enterprise-line.md`：
   - §1 上游指向改为私仓；
   - §1.2 改动清单按本次合并结果重写（`local-tools.ts`、`packaged-resource-gate.cjs` 等行的状态）；
   - **修正失真的同步点描述**（原文称 `5b55e62` 为最新同步点，该提交并不在 `develop-ent` 历史中）；
   - §3.1 冲突规则改为白名单制；
2. **建立「待吸收清单」持久文件**（如 `docs/enterprise-pending-absorption.md`），替代只写在 MR 描述里的做法——本次至少写入 `style.css` 等 5 个样式文件；
3. 合入 `develop-ent`（走 GitLab MR，不直接推受保护分支）。

---

## 5. 风险与回滚

| 风险 | 触发条件 | 应对 |
|---|---|---|
| **企业 Hub/市场/更新全部失效** | `api_base.ts` / `hub_account/client.ts` 解析错 | 阶段 4 的「无内部域名残留」+ 真机登录验证；重构后由打包注入 |
| **门禁被静默绕过** | `ipc/index.ts` 冲突解决时丢掉 `assertEnterpriseSession` | 预演已确认 9 处全在；同步后 `grep -c` 必须仍为 9 |
| **上游功能被静默丢弃** | 沿用现行 `resolve-sync-conflicts.sh` 规则 3 | 阶段 2 先改脚本；解决后逐文件核对 |
| **i18n key 化后企业文案失联** | `24ef13d8`/`6fdec238` 的 key 重命名 | 跑企业 i18n 门禁；实测登录屏文案 |
| **测试基线漂移** | 契约测试硬编码开源身份 | 渠道化改造，两线同一套测试均通过 |
| **合并无法收敛** | 冲突解决超过预期 | 回滚点见下 |

**回滚**：

```bash
# 合并前
git reset --hard backup/develop-ent-pre-sync-YYYYMMDD
# 若已合入远端（走 MR 的情况）
git revert -m 1 <merge-commit-sha>
```

**终止条件（建议设为止损线）**：若 G5 功能模块的手工冲突解决超过 **2 人日**，停止并重新评估——考虑改为「先只同步 G1+G2+G3+G6（配置/文案/入口/测试）+ 高价值功能子集」，把大件（`kb-*` 重构、`group_chat` 状态机）拆成后续独立批次。

---

## 6. 一次性 vs 分批：明确建议

| 方案 | 优点 | 缺点 | 建议 |
|---|---|---|---|
| **单次全量合并** | 一次性收敛；中间态少；git 历史干净 | 51 冲突一次性处理，风险集中 | ✅ **推荐**（配合阶段 4 门禁与止损线） |
| 分批（按功能域） | 单批风险小 | 大型重构会产生不可验证的中间态；冲突反复重解；每个中间态都要跑完整门禁 | ❌ 不推荐作为首轮 |

**如果要分批**，正确的切法是**按"是否依赖大型重构"切，而不是按功能域切**：
- 批 1：不依赖 `kb-*` / `group_chat` 重构的所有提交（配置、测试稳定性、composer、welcome、updater、connectors 等）；
- 批 2：`kb-*` 重构（`24ef13d8`、`6fdec238`、`a497e052`）；
- 批 3：`group_chat` / run 状态机（`cbb35145`、`f3f9f5e0`、`f688fe1a`、`dd5f7133` 等）。

---

## 7. 立即可做的第一步（今天就能做，零风险）

```bash
# 在任何改动之前，先固化这次预演的结论，便于复跑与交接
git merge-tree --write-tree --name-only --messages develop-ent origin/develop \
  | sed -n '2,$p' | grep -vE '^$|^CONFLICT|^Auto-merging|^warning|^Merge' | sort -u \
  > /tmp/ent-sync-conflicts-20260927.txt
wc -l < /tmp/ent-sync-conflicts-20260927.txt   # 51
```

这一步**不改任何东西**，但给出了本次同步的准确工作量基线。任何后续冲突数偏离 51，都说明上游又动了，需要重新预演。
