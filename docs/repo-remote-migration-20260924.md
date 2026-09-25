# CogSeed 仓库远端迁移工作说明（公仓 → 私仓）

- 日期：2026-09-24
- 发布对象：所有在本地持有 CogSeed 仓库的开发/测试人员
- 维护者：（仓库负责人待填） · 生效条件：§0 第 1 条的管理员口径确认后生效
- 适用：所有在本地持有 CogSeed 仓库的开发/测试人员
- 私仓（SSH，二选一，见 §2.1）：
  - 首选（22 端口被网络策略挡住时也能用）：`ssh://git@ssh.github.com:443/bonc-ai/cogseed-internal.git`
  - 常规：`git@github.com:bonc-ai/cogseed-internal.git`
  - **不要用 HTTPS**（实测 `Empty reply from server`）
- 公仓（原仓，保留只读）：`git@github.com:bonc-ai/cogseed.git`
- 目标：日常开发、提交、PR 全部走私仓 `develop`；`cicd` 只做集成验证/构建/打包/发布

---

## 0. 三条必须先读的事实（与原始通知的差异）

> **前置状态**：私仓与公仓的历史关系（全新起点 / 后续导入公仓历史）**尚未由仓库管理员确认**。
> 在确认之前：§1（盘点）与 §2（换远端）可以执行；§3 之后一律按"新分支起自私仓 develop"处理，
> 既有工作只允许用 §5 的**补丁搬运**方式进入私仓。

1. **私仓与公仓不是同一段历史。**
   2026-09-24 实测：私仓 `develop = e9c2058268a4b59864b8738eeef5386a052f8381`、`cicd = 7539f7265707e0660f83438faa72fe2f0bb1dc49`，这两个提交在本地（公仓历史）**不存在**。
   → 因此：**任何基于公仓历史的本地分支都不许直接推到私仓**（会产生无关历史；日后合并需要 `--allow-unrelated-histories`，等于把整条公仓历史灌进私仓）。
   → 既有工作一律**按补丁搬运**（§5）。私仓与公仓的最终关系（全新起点 / 后续导入公仓历史）**以仓库管理员口径为准**，未确认前不要做历史对接动作。

2. **本机 HTTPS 不通，SSH 通；SSH 建议用 443 端点。**
   实测：`https://github.com/bonc-ai/cogseed-internal` → `Empty reply from server`；
   `git@github.com:bonc-ai/cogseed-internal`（22 端口）可列出 refs；
   `ssh://git@ssh.github.com:443/...`（SSH over 443）同样可用，且在 22 被挡的网络里更稳。
   **统一用 SSH；若 `git fetch` 报连接超时/拒绝，先换成 443 端点再试。**

3. **远端改名会影响面比想象大。**
   远端配置是**每个仓库**（`.git/config`）的，不是每个工作树。若你有多个工作树（`git worktree list` 会显示，本机有一个 `.worktrees/perf-response-output`），改远端、`fetch --prune` 会同时影响它们；另外 `git fetch --prune` 之后，所有跟踪旧 `origin/*` 的本地分支会显示 upstream `gone`——**这是正常的，不代表分支坏了**。

---

## 1. 先盘点本机状态（只读，不改任何东西）

```bash
cd <你的 CogSeed 目录>
git status
git remote -v
git branch -vv
git worktree list        # 有工作树的话，逐个进去确认 status
git stash list           # 只查看，不要动
```

**本机的未提交内容要分三类处理**（本机实测：16 个已跟踪改动 + 16 个未跟踪 + 9 条 stash + 14 个本地分支）：

| 类别 | 处置 |
| --- | --- |
| 已完成的工作 | **提交到本地分支**（可回溯、可 `format-patch` 导出），不要只放 stash |
| 未完成的工作 | 本地提交，或 `git diff > xxx.patch` 导出到个人安全位置 |
| 不确定的未跟踪文件 | **不要提交**。先 `git status` 看清，必要时 `git clean -n` 预览；本机历史遗留包括 `.playwright-cli/`、根目录散落文档、游离的 `conversation.js`、`docs/kstar/`、`resources/runtime/ffmpeg/` 等 |

红线：**不要为了切远端删除/覆盖本地改动，也不要把不确定的未跟踪文件提交进仓库。**

---

## 2. 切换远端（保留公仓只读）

### 2.1 推荐做法：改名保留，而不是直接改地址

```bash
# 记录原地址（写进你的迁移报告）
git remote get-url origin

# 公仓改名为 public（保留历史对比/查阅能力），私仓作为新的 origin
git remote rename origin public
git remote add origin ssh://git@ssh.github.com:443/bonc-ai/cogseed-internal.git
# 22 端口可用时也可写成：git remote add origin git@github.com:bonc-ai/cogseed-internal.git

# 校验：origin 的 fetch/push 都指向私仓；public 指向公仓
git remote -v
```

> 若团队坚持 `origin` 名字不变，也可以 `git remote set-url origin git@github.com:bonc-ai/cogseed-internal.git`，
> 但那样会**丢掉对公仓的远端跟踪引用**（后面想对比历史就得重新加远端）。二选一，别两个都做。

### 2.2 拉取私仓分支

```bash
git fetch origin --prune
git branch -r            # 应能看到 origin/develop、origin/cicd（以及 dependabot/* 等）
```

### 2.3 常见错误（务必避免）

- ✗ 用通知里的 HTTPS 地址（本机不通）；SSH 连不上时不要退回 HTTPS，改用 443 端点。
- ✗ `git fetch --prune` 之后看到一堆 `gone` 就惊慌去"修复"——那只是旧公仓跟踪引用被清理。
- ✗ 直接把本地老分支 `push` 到私仓（见 §0.1）。
- ✗ `git push --mirror`、任何形式的 force push。

---

## 3. 日常开发绑定私仓 develop

**不要**把现有本地 `develop` 直接绑到私仓 `origin/develop`：本机实测本地 `develop` 落后公仓 `origin/develop` 211、领先 13，私仓 `develop` 又是另一段历史——绑上去只会得到"无共同祖先"的 diverged 状态（这正是原始通知的步骤五在本机不适用的原因）。

正确做法是**从私仓 develop 起新分支**：

```bash
git fetch origin --prune
git switch -c work/<你的主题> --track origin/develop
git branch -vv          # 确认跟踪的是 origin/develop（私仓）
```

若你的本地 `develop` 已经**干净且以私仓为准**（管理员确认过基线），才做绑定：

```bash
git switch develop
git branch --set-upstream-to=origin/develop develop
```

**基线不一致时一律不要自行强推/重置**，先联系仓库管理员（见 §8）。

---

## 4. cicd 分支

- `cicd` 只用于集成验证、构建、打包、Release；**不要在 `cicd` 上开发或提交。**
- 需要本地检视时：

```bash
git switch -c cicd --track origin/cicd      # 本地没有 cicd 时
# 或本地已有：git branch --set-upstream-to=origin/cicd cicd
git switch work/<你的主题>                   # 看完立刻切回开发分支
```

- `develop` 验证通过后，按团队流程同步到 `cicd`（同步动作由流程负责人执行）。

---

## 5. 既有工作怎么搬进私仓（补丁法）

适用于：基于公仓历史、已验证但尚未进入私仓的改动（本机当前就有这样一批）。

```bash
# 1) 在公仓历史的分支上先本地提交（不推送）
git switch -c fix/<主题>            # 或就在当前分支
git add <明确的文件清单>             # 不要 git add -A
git commit -m "<主题>: <一句话说明>"

# 2) 导出补丁（同时留一份到个人安全位置）
git format-patch -1 --stdout > /tmp/<主题>-20260924.patch

# 3) 从私仓 develop 起分支，应用补丁
git fetch origin --prune
git switch -c work/<主题> --track origin/develop
git am /tmp/<主题>-20260924.patch    # 冲突则 git am --abort，改用 git apply --3way 手工处理

# 4) 走私仓的验证门禁 + PR（目标 develop）
```

补丁搬运必须补的验证（本仓库门禁）：

```bash
npm run typecheck
npm run test:js                # 不要用 npx vitest
bash scripts/restart-cogseed.sh   # 需要真机验证时
```

---

## 6. 仓库内的仓库地址引用（先别全量替换）

仓库里有 **60 处**指向公仓的 URL，主要集中在：

- `README.md`（徽章、clone 命令）
- `package.json`（`repository` / `homepage` / `bugs`）
- `sbom.cdx.json`（SBOM 元数据）
- 少量文档（如 `docs/creator-agent-builder-a2a-branch-handoff-20260903.md`）

**处置口径**：这些描述的是**对外发布物**，默认**保持不变**；只有当团队把私仓定为打包元数据的事实源时才改。这是决策项，**不要**做成一次全局查找替换。

---

## 7. 切换后的工作规则（红线）

1. 日常开发、提交、PR 一律在私仓 `develop`。
2. `develop` 验证通过后，按流程同步到私仓 `cicd`；`cicd` 不开发。
3. 公仓只作公开发布/历史查询，**不再向公仓提交开发代码**。
4. 不执行 `git push --mirror`；不做 force push。
5. 不把公仓的其他开发分支直接 merge 回私仓（历史不同源，见 §0.1）。
6. 不自动提交未跟踪文件，不动别人的 stash。
7. 发现本地分支与私仓 SHA 不一致，**不强推**，先联系管理员。
8. 权限不足/拉取失败/远端异常：**截图或保存完整报错**，暂停操作，联系管理员。

---

## 8. 完成后回报（按此格式）

先取数（把命令输出原样填进去）：

```bash
git remote -v
git branch -vv | sed -n '1,20p'
git rev-parse develop 2>/dev/null
git ls-remote origin refs/heads/develop refs/heads/cicd
git status --porcelain | wc -l
git stash list | wc -l
git worktree list
```

模板：

```
姓名：
本地仓库路径：
私仓地址是否正确（协议写清）：是 / 否 —— origin = git@github.com:bonc-ai/cogseed-internal.git
git fetch origin --prune 是否成功：是 / 否（失败请附报错）
私仓 origin/develop SHA：
私仓 origin/cicd SHA：
本地 develop 是否跟踪 origin/develop：是 / 否（若不跟踪请说明原因，如基线不一致待管理员确认）
本地 cicd 是否跟踪 origin/cicd：是 / 否 / 本地无该分支
是否存在未提交改动：是（已跟踪 N / 未跟踪 M）
是否存在未处理的本地分支或 stash：是（分支 N / stash M / 工作树 K）
是否确认后续不再向原公仓推送：确认
备注（可选）：例如"既有改动已导出补丁，待搬运"
```

**不要在回报里粘贴密码、Token、SSH 私钥或任何凭据。**

---

## 9. 附录：单机实测样本（2026-09-24）

仅作复核参照，**不是通用结论**；每位开发者请用 §8 的命令在自己的机器上重新取数。

| 项 | 实测值 |
| --- | --- |
| 本机路径 | `/Users/sudai/Documents/CogSeed`（另有工作树 `.worktrees/perf-response-output`） |
| 原远端 | `git@github.com:bonc-ai/cogseed.git`（SSH，fetch+push） |
| 私仓可达性 | SSH ✓（22 与 443 端点均可读）；HTTPS ✗ `Empty reply from server` |
| 实际生效的 origin | `ssh://git@ssh.github.com:443/bonc-ai/cogseed-internal.git`（public 保留为公仓只读） |
| 私仓 refs | `develop = e9c20582…`、`cicd = 7539f726…`（本地均无此对象） |
| 本地 develop | `db12b253`，相对公仓 `origin/develop` 落后 211 / 领先 13 |
| 本地分支/工作树/stash | 14 个分支、2 个工作树、9 条 stash |
| 未提交 | 16 个已跟踪改动 + 16 个未跟踪（其中 5 个是当日已验证的修复，11 个为历史遗留） |
| 硬编码公仓引用 | 60 处（README/package.json/sbom/文档） |

复核方式：把上表命令重跑一遍即可；**结论随私仓变化而变化**，不要把它当成长期事实。
