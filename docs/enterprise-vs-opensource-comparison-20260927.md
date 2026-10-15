# 企业版（GitLab）vs 开源版（GitHub）客户端分支对比报告

- 日期：2026-09-27
- 企业侧：`http://10.1.12.6:54170/lhcx/project-group/opensource/team-02/cogseed-enterprise-edition`（远端名 `gitlab`，14 个分支，匿名只读可拉）
- 开源侧：`git@github.com:bonc-ai/cogseed.git`（远端名 `public`，69 个分支）
- 私仓侧（实际同步源，见 §3）：`ssh://git@ssh.github.com:443/bonc-ai/cogseed-internal.git`（远端名 `origin`，21 个分支）
- 取证：`git fetch` 后做 `merge-base` / `rev-list --count` 双向计数 + 文件级 `diff`
- **全程只读，未向任何远端推送**

---

## 0. 结论速览

| 结论 | 事实 |
|---|---|
| 企业版主线 | **`develop-ent`**（`2990b932`，2026-09-17）。`main` 是**空占位分支**：1 个 `Initial commit`、1 个文件 |
| 是否同源 | 与开源版**同源**，共同根提交 `7af5136c`；`gitlab/main` **无共同祖先**，无分析价值 |
| 企业版独有 | **113 个提交**（去 merge 72 个）、250 个文件、+61046 / −43774（相对真实同步点） |
| 对方领先 | 相对**私仓** `origin/develop` 落后 **142** 个提交；相对**开源公仓** `public/develop` 落后 **297** 个提交 |
| 最后真实同步点 | `4d5c2fd9`（2026-09-16），**来自私仓 `origin/develop`**，不是开源公仓 |
| ⚠ 最大问题 | 企业仓 CI 的 `upstream` 指向**开源公仓**，但它实际同步的提交**只存在于私仓** —— 两条上游线已于 2026-08-26 分叉 |
| ⚠ 文档失真 | `docs/enterprise-line.md` 称最新同步点为 `5b55e62`(09-20)，但该提交**不在 `develop-ent` 历史中** |
| ⚠ 版本号倒挂 | 企业版 `package.json` = **0.9.1** vs 开源版 = **1.2.0** |
| ⚠ 域名硬编码 | 企业版把开源版**刻意剥离**的 `cogseed-open.bonc.com.cn` / `www.bonc.com.cn` 写回了源码树 |

---

## 1. 分支拓扑

### 1.1 全量矩阵（企业侧 vs `public/develop`）

| GitLab 分支 | SHA | 企业独有 | 开源领先 | 与 `develop-ent` 关系 |
|---|---|---|---|---|
| **`develop-ent`** | `2990b932` | 269 | 297 | **= 企业主线** |
| `feature/client-protocol-adapters` | `eaa8fc41` | 266 | 297 | 与 dev-ent 分叉（dev-ent 多 16 / 它多 13） |
| `release/enterprise-models-20260916` | `d6d43cd2` | 258 | 297 | 与 dev-ent 分叉（dev-ent 多 16 / 它多 5） |
| `codex/fix-enterprise-owner-recovery` | `cd52396e` | 254 | 297 | 与 dev-ent 分叉（dev-ent 多 16 / 它多 1） |
| `codex/enterprise-login-copy-and-password-steps` | `e60881e5` | 140 | 297 | 已并入 dev-ent |
| `codex/enterprise-login-without-navigation` | `b01c7088` | 136 | 297 | 已并入 dev-ent |
| `codex/model-connection-pr` | `b7b2e56a` | 115 | 297 | 已并入 dev-ent |
| `codex/fix-connections-agent-tab-enterprise` | `2fc07282` | 93 | 297 | 已并入 dev-ent |
| `release/enterprise-0.9.0` | `945fd2fa` | 92 | 297 | 已并入 dev-ent |
| `main` | `a8b16098` | — | — | **无关**（独立根提交，空仓） |
| `sync/upstream-*`（4 个） | — | — | — | 同步标记，见 §3.2 |

> 已并入 `develop-ent` 的支线无独立增量；3 个分叉分支合计仅 19 个 `develop-ent` 没有的提交，可评估是否废弃。

### 1.2 三个远端的关系（关键）

```
共同根提交 7af5136c (2026-08-20)
        │
   8889f19c (2026-08-26)  ← public/develop 与 origin/develop 在此处分叉
        ├──────────────► origin/develop（私仓）  +298 个提交
        └──────────────► public/develop（开源）  +297 个提交
                              ↑ 2026-09-27 被 force-push 重写（旧 2831bdb1 已不在历史中）
```

**`origin/develop` 与 `public/develop` 互不包含**（各约 300 个独有提交）。两者不是简单的「私仓领先公仓」，而是**两条已经分叉的线**。

---

## 2. 差异数据

### 2.1 两套基线的口径（务必区分）

| 对比基线 | merge-base | 企业独有 | 对方独有 | 含义 |
|---|---|---|---|---|
| `origin/develop`（私仓，真实同步源） | `4d5c2fd9` | **113** | **142** | 企业线的真实增量与真实滞后 |
| `public/develop`（开源公仓） | `8889f19c` | 269 | 297 | 含两条上游线分叉造成的失真放大 |
| `public/main` | `5679f4bf` | 284 | 10 | — |

> **看企业版做了什么改动 → 用私仓基线（113 个提交）。**
> **看企业版落后开源多久 → 用开源基线（297 个提交，但其中 142 个是私仓独有的，不是「开源新功能」）。**

### 2.2 文件级差异（vs `public/develop`）

```
850 files changed, 49917 insertions(+), 114792 deletions(-)
481 M   295 D   74 A
```

变更文件目录分布 Top 10：`src/main` 195、`test/main` 185、`test/renderer` 135、`src/renderer` 92、`.specify/*` 26、`.agents/skills` 21、`test/scripts` 9、`src/resources` 6、`.github/workflows` 6、`src/core-agent` 5。

---

## 3. ⚠️ 同步链路失效（本次最重要发现）

### 3.1 企业仓的 upstream 与实际同步源不一致

`.gitlab-ci.yml` 第 49 行：

```yaml
UPSTREAM_REMOTE: "https://github.com/bonc-ai/cogseed.git"   # 开源公仓
```

但 `develop-ent` 实际合入的同步点：

| 同步合并提交 | 时间 | 合并的上游提交 | 在私仓 `origin/develop` | 在开源 `public/develop` |
|---|---|---|---|---|
| `438f3dc6` | 2026-09-17 | `4d5c2fd9` | ✅ | ❌ |
| `0d321ebe` | 2026-09-15 | `953288bf` | ✅ | ❌ |
| `c05ace4d` | 2026-09-15 | `5ad02101` | ✅ | ❌ |
| `945fd2fa` | 2026-09-08 | — | ✅ | ❌ |

**企业版历史上同步的是私仓，但 CI 现在配的是开源公仓。** 而这两个仓已经分叉（§1.2），下一次自动同步会引入一条**从未被企业线验证过的历史**。

### 3.2 `sync/upstream-*` 标记全部失效

4 个同步标记**没有一个**存在于当前 `public/develop` 中（都被 09-27 的 force-push 移出历史），且其中 **3 个根本不在 `develop-ent` 里**：

| 标记 | 在 `origin/develop` | 在 `public/develop` | 在 `develop-ent` |
|---|---|---|---|
| `upstream-9e63c715` | ✅ | ❌ | ✅（唯一有效） |
| `upstream-4c38fb4` | ✅ | ❌ | ❌ |
| `upstream-5b55e62` | ✅ | ❌ | ❌ |
| `upstream-67959c4` | ✅ | ❌ | ❌ |

`docs/enterprise-line.md` §1.2 把 `5b55e62` 当作最新同步点来标注滞后 —— **该提交并未进入 `develop-ent`**，文档口径与实际历史不符。

### 3.3 公仓历史被重写

`public/develop` 于 2026-09-27 发生 force-push：旧值 `2831bdb1` 与当前值 `347100d1` 在 `8889f19c` 处分叉（291 / 297）。`docs/repo-remote-migration-20260924.md` 里记录的「私仓领先公仓 4 个提交」结论**已失效**，实际是各 ~300 个提交的双向分叉。

---

## 4. 企业版专属改动清单（113 个提交中）

### 4.1 身份与数据隔离（`feat(identity)`，2 个提交）

`src/resources/identity.json`：

| 字段 | 开源版 | 企业版 |
|---|---|---|
| `appName` | `CogSeed` | `CogSeed Enterprise` |
| `appId` | `com.cogseed.desktop` | `com.cogseed.enterprise` |
| `protocolScheme` | `cogseed` | `cogseed-ent` |
| `dataRootName` | `.cogseed` | `.cogseed-enterprise` |
| `devDataRootName` | `.cogseed-dev` | `.cogseed-ent-dev` |
| `envPrefix` | `COGSEED` | `COGSEED_ENT` |
| `p3394DefaultPort` | （无） | `8445` |

`brand.json`：`zhName` = `CogSeed 企业版`，`taglineZh` = `企业级 AI 能力资产平台`。
目的（`2990b932`）：打包版 `userData` 显式隔离，修复两版同机无法同时打开。

### 4.2 打包与渠道

- 新增脚本 `build:ent:mac` / `build:ent:win` / `build:ent:mac:adhoc`
- `extraMetadata.cogseedBuildChannel`: `release` → `enterprise`
- `artifactName`: `CogSeed-Enterprise-${version}-...`
- 新增依赖 `sm-crypto@0.5.7`（国密）；`homepage` → `https://www.bonc.com.cn`
- 提交入库的 `build-info.json`（开源版为构建产物、不入库）

### 4.3 企业身份与模型治理子系统（新增，规模最大的一块）

企业版新增了**一整套**员工身份 + 托管模型治理代码，全部位于 `src/main/features/hub_account/`：

| 新增文件 | 推测职责（据文件命名与提交信息） |
|---|---|
| `enterprise-gate.ts` | 渠道判定 + 会话有效性 + 断言（登录门禁核心） |
| `employee-contract.ts` | 员工契约/协议定义 |
| `employee-errors.ts` | 员工侧错误分类 |
| `employee-flow.ts` | 员工登录/首次配置流程 |
| `credential-protection.ts` | 凭证保护（配合新增依赖 `sm-crypto` 国密） |
| `session-lifecycle.ts` | 会话生命周期 |
| `user-activity.ts` | 用户活跃度 |
| `enterprise-models.ts` | 企业托管模型清单 |
| `model-config-gate.ts` | 模型配置门禁 |
| `model-governance.ts` | 模型治理（路由/授权管控） |

模型层新增：

- `src/main/model/core-agent/enterprise-gateway-provider.ts` —— 企业网关 provider
- `src/main/model/core-agent/governed-provider.ts` —— 受治理 provider
- `src/main/model/core-agent/enterprise-adapter-profiles.ts` —— 企业适配器配置档
- `src/main/ipc/managed-model-authorizations.ts` —— 托管模型授权 IPC

数据迁移：`src/main/util/migrate-source-data-root.cjs`（配合 §4.1 的独立数据根切换）。

### 4.4 登录门禁接线

- `src/main/ipc/hub-account.ts`：`hub-account.status` 追加 `enterprise_gate` 快照
- `src/main/ipc/index.ts`：`user.init` / `conversations.*` / `spaces.list` / `cogseed.session.list` 加 `assertEnterpriseSession`
- `src/renderer/modules/enterprise-login-gate.js` + `index.html` + `boot.js`：未登录全屏登录屏 + **启动阻断**
- `src/renderer/modules/enterprise-onboarding.js` / `enterprise-onboarding-service.js` + `enterprise-onboarding.css` + `assets/enterprise-companion.png`：首次配置引导
- `src/renderer/locales/{zh,en}.json`：`enterprise_login.*` 文案

> 两套基线（私仓 / 开源）下 `src/` 的差异**完全一致**（298 文件，+26694 / −51810）——说明企业版的生产代码改动未受两条上游线分叉影响，差异集中在外部文件（`.specify/`、`specs/`、`.agents/` 等）。

### 4.5 同步工具链（开源侧完全没有）

| 文件 | 作用 |
|---|---|
| `.gitlab-ci.yml` | 4 job：`verify` / `sync-upstream` / `sync-lag-check` / `mirror-github` |
| `scripts/sync-upstream.sh` | 本地一键同步（fetch + 落后统计 + 冲突预检 + `merge --no-ff` + typecheck） |
| `scripts/resolve-sync-conflicts.sh` | 按机械规则自动解决同步冲突 |
| `.gitlab/merge_request_templates/sync-upstream.md` | 同步 MR 模板 |
| `scripts/dev-roots.cjs`、`scripts/verify-enterprise-onboarding.cjs` | 开发根目录 / 门禁验证 |

### 4.6 文档

`docs/enterprise-line.md`、`docs/enterprise-login-gate.md`、`docs/enterprise-mac-arm64-packaging.md`、`docs/Hub-桌面端员工登录与首次配置-当前API数据清单.md`；根目录另有 `CogSeed-发版Checklist-20260916.md`。

---

## 5. 风险清单

### 5.1 ⚠️ 内部域名硬编码（最高优先级）

企业版 `src/main/features/api_base.ts`：

```ts
+ export const PACKAGED_DEV_API_BASE = 'https://cogseed-open.bonc.com.cn';
+ export const RELEASE_API_BASE      = 'https://cogseed-open.bonc.com.cn';
+ export const ENTERPRISE_API_BASE   = 'https://cogseed-open.bonc.com.cn';
```

- 开源版此处已改为占位符 `https://hub.example.com`，真实 origin 改由**打包期**经 `.build/build-info.json` 注入（`scripts/write-build-info.cjs` 读流水线仓库变量）。
- 开源侧近期提交 `918441d8 fix(config): bake the service origin into release packages` 正是在做这件事。
- 企业版 `ENTERPRISE_API_BASE` 直接复用了**开源版**的生产 origin，`docs/enterprise-line.md` 自认「企业服务就绪前复用生产 origin」——**属临时状态且无替换时限**。

### 5.2 ⚠️ 同步冲突策略会静默丢弃上游修复

`docs/enterprise-line.md` §3.1：除 `locales/*.json` 与 `index.html` 外，**所有冲突文件整文件取企业侧**。

- 高风险文件：`src/renderer/modules/skills.js`、`style.css`、`settings.js`、`workspace.js`（均为冲突高发区）。
- 文档把丢弃内容记为「【待吸收清单】」写在 MR 描述里，**没有持久化追踪文件**。

### 5.3 版本号倒挂已造成过故障

企业版 `0.9.1` vs 开源版 `1.2.0`。历史提交 `d8b6600d fix: package-lock 版本与 package.json 对齐 0.9.1（上游 sync 带入 1.0.2，npm ci 校验会失配）` —— 已实际触发过 CI 失败。

### 5.4 单侧修复未回合

- `src/main/model/core-agent/local-tools.ts` 的 `BASH_FIND_FLAGS_WITH_VALUE` 修复（`-maxdepth 1` 的 `1` 被当路径解析，仓库位于 `~/Desktop` 等目录必现）—— 企业版自述「上游 MR 候选」，**至今未回合**。
- `bin/packaged-resource-gate.cjs` 的 `builtin-packages` 契约表临时登记行，待上游 #144 修复后删除。

### 5.5 未同步的开源侧重要变更（297 个中的高危项）

- `24ef13d8 feat(kb)!: 知识库文案 key 化收口 + 8/8 模块响应 i18n-change` —— **breaking**，与企业的 `locales/*.json` 覆盖策略正面相撞
- `918441d8 fix(config): bake the service origin into release packages` —— 与 §5.1 冲突
- `f9765fd0 feat(updater): 更新下载支持暂停/续传`
- `0b0e16ac` / `00126ada` fix(multi-agent) 验收 P1 五项 / P2 四项
- `5bbf0af4 feat(home): 首页多 Agent 选择与展示对齐原型 v0.17`
- `4566e997` / `091a7dbc` chore: 清除发布扫描隐私残留
- `7cbea805 chore: OSS placeholders for Hub domains + scrub internal scripts`

---

## 6. 建议动作（按优先级）

1. **先定企业线到底跟哪条上游** —— 是私仓 `origin/develop` 还是开源公仓 `public/develop`。当前 CI 配的是公仓，历史合的是私仓，必须二选一后统一 `.gitlab-ci.yml`、`sync-upstream.sh` 默认值与 `docs/enterprise-line.md`。
2. **确认 2026-09-27 开源公仓 force-push 的原因**（是否发布扫描清理重写），并评估企业线是否需要重新对齐基线 —— 旧同步标记已全部失效，靠 `sync/upstream-*` 判断滞后已不可行。
3. **修正 `docs/enterprise-line.md`** 中「最新同步点 `5b55e62`」的失真描述，改为按 `git log --merges` 实际合并提交取证。
4. **评估 `ENTERPRISE_API_BASE` 是否应指向独立企业域名**；若短期无法分离，登记明确的替换时限与责任人。
5. **执行一次上游同步**（真实滞后 142 个提交），重点处理 `24ef13d8`（i18n breaking）与 `918441d8`（origin 注入）两处冲突。
6. **为「待吸收清单」建立持久化追踪文件**，替代只写在 MR 描述里的做法。
7. **把 `local-tools.ts` 的 `find` 旗标修复回合上游**，减少长期分叉面。
8. **对齐版本号口径**，避免 `npm ci` 失配复发。
9. **清理空 `main` 分支或改默认分支为 `develop-ent`**，避免误操作。
10. **评估 3 个分叉分支**（`feature/client-protocol-adapters` 等，合计 19 个独有提交）是否废弃。

---

## 7. 复现方式

```bash
# 一键复跑（只读，不改工作区、不推送）
bash scripts/compare-enterprise-opensource.sh
bash scripts/compare-enterprise-opensource.sh develop-ent develop   # 指定分支

# 手动取证
git fetch gitlab '+refs/heads/*:refs/remotes/gitlab/*' --no-tags
git merge-base gitlab/develop-ent origin/develop
git rev-list --count origin/develop..gitlab/develop-ent   # 企业独有 = 113
git rev-list --count gitlab/develop-ent..origin/develop   # 真实滞后 = 142
```

> **取证纪律**：判定同源与领先/落后，必须用 `git fetch` **之后**的 `merge-base` + `rev-list --count` 双向计数。
> 不要用「某个 SHA 本地对象库里不存在」下结论（见 `docs/repo-remote-migration-20260924.md` §0 教训）；
> 也不要依赖 `sync/upstream-*` 之类的标记分支——上游 force-push 会让它们全部失效（本报告 §3.2 即为此例）。
