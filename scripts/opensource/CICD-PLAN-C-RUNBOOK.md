# CogSeed 新版本发布 SOP：私仓 → 公仓 → 正式发布

适用仓库：`bonc-ai/cogseed-internal`（私仓）与 `bonc-ai/cogseed`（公仓）。维护日期：2026-10-11。

本手册是后续版本发布的统一入口，保留原文件名。所有版本号、SHA、PR 编号与 run ID 都必须取本次实际值，不复用历史候选。本文件和发布证据仅留私仓，不进入公开快照。

> 标准顺序：私仓 develop 定版 → PR 晋升 cicd → 同 SHA 私仓 push 检查 → 外部贡献公仓 CI／审批／保留作者合并 → 标准导出同步 → 公仓 PR 完整 CI → 维护者批准 → 合并 main → 同 SHA main push CI → 负责人正式发版确认 → 创建 tag → 签名环境批准 → 自动构建并发布 → 下载、安装、升级与分发验收。

## 1. 角色、成本与不可越过的边界

| 角色 | 责任 |
| --- | --- |
| 发布执行人 | 维护版本和清单，执行本手册，记录候选与运行证据，处理失败 |
| 代码审阅者 `bonc-ai/reviewers` | 公仓 CI 全绿后审查差异并 Approve；不能用执行人自批代替 |
| 发布负责人 | 在 main CI 全绿后，批准具体版本、完整公仓 SHA、渠道及已知限制 |
| 仓库管理员／证书持有人 | 配置 App、保护规则、签名环境及发布主体；审批签名作业 |

三种批准互不替代：**PR 代码审批、负责人正式发版确认、`release-signing` 环境审批**。发起源码同步只授权创建／更新快照 PR。

成本前提：

- **私仓所有分支的 GitHub 托管 runner 均属于计费范围，包括 cicd 和源码同步。** 当前净费用为零也不代表以后免费。
- 私仓 develop/cicd 仅执行轻量类型、lint、合规、静态资源、导出与工作流契约检查；安装使用 `npm ci --ignore-scripts`。不在私仓托管 runner 跑完整 JS/Python、下载模型或打包。
- 完整三平台测试、原生检查与打包在公仓标准 runner 执行；本地或已配置的受控自建 runner 可承担开发验证。不增加预算，不切换付费 larger runner 来解决失败。
- 修复尽量集中提交；先本地验证，再推送必要的候选。不要反复重跑相同代码来碰运气。
- 私仓同步不使用 artifact 存储传递导出包：两阶段通过摘要传递证据，并重新导出核对。公仓 CI 用一个公开小文件检验 artifact 上传、下载及校验和。

禁止直接推送受保护主干、绕过 CI／审批、移动旧 tag、覆盖已发布 Release、把私仓历史或内部报告推入公仓。公仓贡献须先回流私仓，再生成后续快照，避免被覆盖。

## 2. 首次配置与每次发版前检查

首次完成下列配置；每次发布检查是否变化。缺项先解决，不能在正式 tag 创建后才发现。

### 2.1 私仓源码同步

| 类型 | 名称／要求 |
| --- | --- |
| Variable | `PUBLIC_SOURCE_APP_ID`：专用同步 App ID |
| Secret | `PUBLIC_SOURCE_APP_PRIVATE_KEY`：同步 App 私钥 |
| Variable | `PUBLIC_SOURCE_BASELINE_READY=true` |
| Variable | `PUBLIC_SOURCE_BASELINE_SHA`：首次批准的公仓干净基线完整 SHA；后续版本不随意重设 |
| GitHub App | `cogseed-public-source-sync` 只安装到公仓，Contents / Pull requests / Workflows 均为 Read and write，Metadata 为 Read |
| 默认工具分支 | 私仓 `develop`；源码候选必须已进入 `cicd` 历史 |

新增 App 权限后，组织管理员还须批准安装更新。只修改 App 设置、不批准安装更新，权限仍可能不生效。

### 2.2 公仓保护与发布配置

- `main`：禁止删除和强推；要求至少一名维护者批准、CODEOWNERS 审查、最新提交检查通过；无常规绕过。
- 必需检查与 [`PUBLIC_CI_JOBS`](../verify-release-gates.mjs) 一致，共 **15 项**：

  | 检查 | 数量 | 验证范围 |
  | --- | ---: | --- |
  | `compliance` | 1 | 静态／合规门禁和 artifact 往返 |
  | `linux-tests (1)` ～ `(4)` | 4 | Linux JS 分片，第 1 分片另跑资源测试 |
  | `macos-tests (1)` ～ `(4)` | 4 | macOS JS 分片，第 1 分片另跑资源测试 |
  | `windows-tests (1)` ～ `(4)` | 4 | Windows JS 分片，第 1 分片另跑资源、原生模块、协议与网关检查 |
  | `verify-macos` | 1 | macOS 开发包及打包冒烟 |
  | `verify-windows-package` | 1 | Windows 打包、元信息、启动、STT 与 Electron fuses |

- 公仓 Variable `COGSEED_HUB_API_BASE_URL`：负责人确认的真实 HTTPS 服务地址。发布构建不得携带开源占位地址。
- `release-signing` Environment：仅允许 `v*` tag；维护者审批、禁止自批、管理员不可绕过。证书持有人在环境中配置以下 **5 个 secrets**：
  - `APPLE_CERTIFICATE_BASE64`
  - `APPLE_CERTIFICATE_PASSWORD`
  - `APPLE_ID`
  - `APPLE_APP_PASSWORD`
  - `APPLE_TEAM_ID`
- 若旧值仍在仓库级，先完成环境配置并验证签名，再移除仓库级同名 secrets。不能因环境已创建就声称证书已迁移；任何值不得写进命令日志、聊天或报告。
- `v*` tag 的创建、更新、删除均受保护。正式发布确认须明确发布主体和必要权限；管理员仅按该确认配置最小权限，记录变更并在发布后复核／收回临时授权。不要删除整个 ruleset 或默认授予管理员永久绕过。
- 默认 Actions token 只读；正式发布 job 按需获取写权限。普通公仓 CI 不使用签名 secrets。
- 当前工作流配置了 macOS 签名与公证；Windows 是否具有有效 Authenticode 签名须单独验证，不能因 EXE 构建成功或 Release 文案写着 signed 就宣称 Windows 已签名。

**2026-10-10 首次发布前未完成项：** 实查 `release-signing` 环境的 secret 列表为空，`release-tags` 无 bypass actor；正式发布前须由证书持有人／管理员完成。此段是历史检查点，不替代以后每次实查。

## 3. 开始一次发布

以下命令用 Bash，按阶段逐段执行；每段完成后核对结果。尖括号代表本次人工填入的值，不能原样执行。所有 `gh` 命令明确指定仓库，避免公私仓混用。

在私仓 checkout 根目录开始：

```bash
set -euo pipefail
PRIVATE_REPO=bonc-ai/cogseed-internal
PUBLIC_REPO=bonc-ai/cogseed
VERSION='<本次版本，如 1.3.1，不带 v>'
TAG="v$VERSION"

gh auth status
git remote -v
git status --short --branch
git fetch origin refs/heads/develop:refs/remotes/origin/develop
git fetch origin refs/heads/cicd:refs/remotes/origin/cicd
```

开始条件：remote 确认为私仓，工作区干净，未混入他人的未提交改动，执行人使用 GitHub noreply 提交邮箱。检查 GitHub 邮箱隐私设置；合并时不传 `--author-email` 强行覆盖账号邮箱。

维护一份本次私有发布记录，使用第 10 节模板。记录保存到团队受控私有位置，不只放临时目录，不写入公仓 PR。

### 阶段 A：私仓 develop 定版

1. 在基于 `origin/develop` 的 `codex/` 分支准备版本变更与修复。
2. 更新 `package.json`、`package-lock.json` 的版本和 `CHANGELOG.md`；可使用 `npm version "$VERSION" --no-git-tag-version --ignore-scripts`，审查其 diff。此处不创建 tag。
3. 审查 [`policy.json`](./policy.json)：新增／删除文件逐项分类；`publicFiles` 精确到文件；`neverPublic` 优先。内部报告、私有工具及私有测试不公开。
4. 检查私有引用提示，确认合理引用后才更新 `reviewedReferenceHintsSha256`；不能只计算新摘要就当作已经审查，也不能扩大 Gitleaks 豁免来掩盖真实泄露。
5. 本地跑 `npm run typecheck`、`npm run lint`、相关回归测试及 `npm test --prefix scripts/opensource`；需要完整验证时使用仓库 `npm test`，不直接使用 `npx vitest`。
6. 经私仓 PR 合入 develop，检查 PR 轻量门禁通过。公开贡献、Windows 修复和发版适配必须在这里留有来源，不只改公仓。

**通过条件：** 版本与变更说明一致，源码及导出策略已审查，相关本地验证通过，develop 已包含本次候选。

### 阶段 B：经 PR 晋升 cicd

从 cicd 建立晋升分支，使用已经定版的 develop **完整树**。以下操作会替换当前分支的文件，只能在刚创建且干净的晋升分支执行：

```bash
git fetch origin refs/heads/develop:refs/remotes/origin/develop
git fetch origin refs/heads/cicd:refs/remotes/origin/cicd
DEVELOP_SHA="$(git rev-parse origin/develop)"
git switch -c "codex/release-$VERSION" origin/cicd
git restore --source="$DEVELOP_SHA" --staged --worktree .
git diff --cached --check
git diff --cached --stat
```

审查差异，确认没有丢失 cicd 独有的有效修复；若发现此类修复，先回流 develop，再重做晋升。确认后提交、推送晋升分支，创建 base=`cicd` 的 PR。无需变更时不创建空提交。

PR 全绿后再合并。建议使用 squash，并用 `--match-head-commit` 绑定已检查的 PR head；不使用管理员强制合并。随后获取**合并后的 cicd SHA**：

```bash
git fetch origin refs/heads/cicd:refs/remotes/origin/cicd
SOURCE_SHA="$(git rev-parse origin/cicd)"
git diff --exit-code "$DEVELOP_SHA" "$SOURCE_SHA"
git show "$SOURCE_SHA:package.json" | node -e \
  'let s="";process.stdin.on("data",b=>s+=b).on("end",()=>console.log(JSON.parse(s).version))'

gh run list -R "$PRIVATE_REPO" --workflow ci.yml \
  --branch cicd --event push --commit "$SOURCE_SHA" --limit 5
gh run list -R "$PRIVATE_REPO" --workflow compliance.yml \
  --branch cicd --event push --commit "$SOURCE_SHA" --limit 5
```

**通过条件：** 候选树与定版 develop 一致、版本正确；该完整 SHA 最新的 `ci.yml` 和 `compliance.yml` **push** 运行均为 `completed/success`。PR 绿、旧 SHA 绿或被取消的运行均不能替代。

注意本仓库 fetch 配置可能只跟踪 develop；`git fetch origin develop cicd` 不保证更新 `origin/cicd`。采用上面的完整 refspec。

### 阶段 B.1：外部贡献归属回流

从收到 PR 到完成接收的操作清单及记录模板见 [公仓外部贡献接收手册](./COMMUNITY-CONTRIBUTION-RUNBOOK.md)；门禁和发布顺序仍以本 SOP 为准。

1. 定版前在同一私仓变更中登记每个已接受的外部 PR，保留作者、DCO、`Source-PR`
   和 `scripts/opensource/contributions.json` 的最终公开 head。登记表随完整树晋升
   cicd；检查与 develop 定版内容一致，不删减历史条目。手工复制贡献同样须登记。
2. 固定源码 SHA 通过阶段 B 门禁后，逐条核对对应公仓 PR：接受的内容已导入本次候选；
   新增祖先全部属于当前清洁公开基线之后的已审核公开提交。旧基线 PR 须清洁迁移，
   不得接回旧私有历史。仅验证最终 tree 相同不足以替代逐提交历史审查。
3. 导入后保持原 PR 打开；仅因导入而关闭的可重新打开。需要追上公仓 main 时正常
   更新 PR 分支，保留原始提交，然后重新检查最新 head 的差异、CI 和审批。
4. 按阶段 D 相同门禁完成当前 PR head 的 **15/15 必需检查 success** 和正式
   CODEOWNERS Approve；执行人不得自批代替。合并外部 PR 使用 **`--merge`** 和
   `--match-head-commit`，不得使用 squash/rebase 丢弃原始贡献提交；不要删除贡献者分支。
5. 合并后逐条验证登记 head 是当前公仓 main 的祖先，再开始阶段 C。
   公仓 main 在同步期间前进时，重新生成基于最新 main 的候选。

内容已经通过快照公开的历史修复，额外要求普通合并的完整 tree 等于修复前 main，
合并后再次确认；有冲突或差异时先停下审查，不能以重复应用、空提交或强推冒充归属恢复。
历史修复仍需要同样的 CI 和正式审核。若正在执行阶段 E 到正式发布，先遵守该阶段的
main 冻结安排，不使已批准 tag 的来源 SHA 失效。此次修复不创建新 tag 或 Release。

阶段 C 的 prepare 检查和 `sync.mjs` 均从固定源码读取登记，拒绝贡献 head 尚未进入
公仓 main 的快照；无内容变化也不跳过。首次启用新工具时，先将含登记表的源码重新
晋升 cicd 并通过原有门禁。空登记只适用于确实没有外部贡献的源码，不是旧版本兼容开关。

### 阶段 C：导出审查与标准同步

本地导出可用于提前发现分类问题；只导出提交中的文件，不包含工作区未提交内容：

```bash
CANDIDATE="$(mktemp -d "${TMPDIR:-/tmp}/cogseed-release.XXXXXX")/export"
if node scripts/opensource/export.mjs --source "$SOURCE_SHA" --out "$CANDIDATE"; then
  EXPORT_STATUS=0
else
  EXPORT_STATUS=$?
fi
# 2 表示生成了待审查候选，并非自动授权公开；其他非零值应停止。
test "$EXPORT_STATUS" -eq 0 || test "$EXPORT_STATUS" -eq 2
```

检查 `manifest.json`、`review.json`：零 missing、零 unclassified，策略 reviewed，引用提示集合已审查；记录文件数和 `exportSha256`。`readyForPublication=false` 是导出器的证据边界，不通过手改报告变成 true。安装依赖或测试后的导出目录不得整目录推送，必须重新生成干净候选。

正式同步只通过私仓工作流：

```bash
gh workflow run public-source-sync.yml -R "$PRIVATE_REPO" \
  --ref develop -f source_sha="$SOURCE_SHA"
gh run list -R "$PRIVATE_REPO" --workflow public-source-sync.yml --limit 5
```

记录本次 run ID，查看日志与 summary；`prepare` 和 `publish_pr` 必须均成功。工作流自动完成：

1. 固定 dispatch 时的 develop 工具 SHA 和指定 cicd 源 SHA。
2. 检查源提交 push 门禁、文件边界和公仓基线。
3. 执行 Gitleaks 阳性自检、精确候选扫描。
4. 第二阶段重新导出并比对证据摘要，再创建最小权限的公仓 App token。
5. 创建／更新公仓 `public-source-sync` → `main` PR，私有映射仅保留私仓 summary。

失败修复后要**新建 dispatch**，不能点 Re-run 复用旧同步授权。9 月应急导出授权已过期，不能倒填时间或使用本地演练开关代替。

**通过条件：** 两阶段成功，私有记录留存源 SHA／工具 SHA／导出摘要／扫描与映射；公仓 PR 内容只来自公开清单，其父提交来自公仓历史。没有内容变化时可无新提交，核对结果后结束本次源码同步；不能凭空视为新版本已发布。

### 阶段 D：公仓 CI → 审阅 → 合并

```bash
gh pr list -R "$PUBLIC_REPO" --base main --head public-source-sync --state open
PUBLIC_PR='<上一步得到的 PR 编号>'
gh pr view "$PUBLIC_PR" -R "$PUBLIC_REPO" --json headRefOid,baseRefOid,url
PUBLIC_PR_SHA="$(gh pr view "$PUBLIC_PR" -R "$PUBLIC_REPO" --json headRefOid --jq .headRefOid)"
gh pr checks "$PUBLIC_PR" -R "$PUBLIC_REPO"
```

1. 等当前 PR head 的 `Public CI` **15/15 job 全部 success**。条件性测试跳过如实保留，不把整个 required job 的 skipped/cancelled 当通过。
2. 失败时读对应 job 日志，回私仓修复，再走 A → B → C；新快照覆盖旧候选后，旧 CI 和旧审批不能作为新候选证据。
3. 全绿后补齐公仓 PR 的版本说明、主要变化、验证链接和限制；不要写私仓 SHA、内部报告或来源映射。
4. 然后请求维护者审阅：

   ```bash
   gh pr edit "$PUBLIC_PR" -R "$PUBLIC_REPO" --add-reviewer bonc-ai/reviewers
   ```

5. 审阅者处理所有阻断意见，确认最新版批准有效。公仓 main 已前进或 PR 被更新时，重新检查差异及 CI；不要直接往快照分支混入手工修复。
6. `reviewDecision=APPROVED`、必需检查全绿、可合并且 PR head 未变后，由执行人合并：

   ```bash
   gh pr view "$PUBLIC_PR" -R "$PUBLIC_REPO" --json reviewDecision,headRefOid,mergeStateStatus
   gh pr merge "$PUBLIC_PR" -R "$PUBLIC_REPO" --squash \
     --match-head-commit "$PUBLIC_PR_SHA" --delete-branch
   ```

本阶段的 squash 仅用于快照 PR；外部贡献 PR 必须按 B.1 保留提交历史合并。

删除已合并的 `public-source-sync` 分支是收尾的一部分。残留分支没有对应 open PR 时，下一次同步会拒绝覆盖；先确认确为已合并旧分支，再清理，不强行覆盖未知分支。

### 阶段 E：验证 main 并取得正式发版确认

合并后 SHA 可能与 PR head 不同，重新读取：

```bash
PUBLIC_SHA="$(gh api "repos/$PUBLIC_REPO/git/ref/heads/main" --jq .object.sha)"
gh run list -R "$PUBLIC_REPO" --workflow public-ci.yml \
  --branch main --event push --commit "$PUBLIC_SHA" --limit 5
PUBLIC_CI_RUN='<该 SHA 最新的 main push 运行 ID>'
gh run view "$PUBLIC_CI_RUN" -R "$PUBLIC_REPO" --json headSha,event,status,conclusion,jobs,url
```

必须等 **同一 main SHA、push 事件、最新 attempt 的 15 项全部通过**。不能拿 PR 运行替代。核对合并后的公开文件树与已审查快照一致。

从此阶段至 Release 发布完成，协调暂停公仓 main 的其他合并；发布工作流在构建前和发布前都会复查 tag 是否仍指向 main tip。若 main 改变，停止按旧确认发版，重新定版、验证并确认新 SHA。

向发布负责人提交第 10 节确认包，明确：版本、完整公仓 SHA、私有来源映射、CI 链接、平台验证、扫描摘要、发行范围、签名／分发状态、已知限制和恢复方式。**得到明确正式发版确认后才能继续 F；PR Approve 不等于这项确认。**

### 阶段 F：创建 tag 并运行正式发布

先复核首次配置：5 个 Apple 环境 secrets 可用，Hub 地址正确，获准发布主体具备创建新 `v*` tag 的必要权限，确认仍绑定当前 `PUBLIC_SHA`。不要因 tag 保护拒绝而关闭保护。

在**独立公仓 checkout**执行，绝不在私仓创建正式 tag：

```bash
# PUBLIC_CHECKOUT 为执行人准备的独立公仓目录；VERSION/TAG/PUBLIC_SHA 取本次批准值。
cd "$PUBLIC_CHECKOUT"
git remote -v
git status --short --branch
git fetch origin refs/heads/main:refs/remotes/origin/main --tags
test "$(git rev-parse origin/main)" = "$PUBLIC_SHA"
test "$(git show "$PUBLIC_SHA:package.json" | node -e \
  'let s="";process.stdin.on("data",b=>s+=b).on("end",()=>process.stdout.write(JSON.parse(s).version))')" = "$VERSION"
git ls-remote --tags origin "refs/tags/$TAG" "refs/tags/$TAG^{}"
gh release list -R "$PUBLIC_REPO" --limit 20
```

确认远端 tag 不存在；使用 `gh release view "$TAG" -R "$PUBLIC_REPO"` 精确核对该版本不存在。只有确认是不存在才继续，认证／网络错误不能当不存在；若存在 tag 或 Release，转第 8 节处理。

```bash
git tag "$TAG" "$PUBLIC_SHA"
git push origin "refs/tags/$TAG:refs/tags/$TAG"
gh run list -R "$PUBLIC_REPO" --workflow public-release.yml --limit 5
```

使用明确完整 SHA 创建轻量 tag；不要依赖本地 HEAD。推送被保护拒绝时保留现场，由获准主体处理；不得 force push、移动旧 tag，或创建另一个未经批准的版本。

tag push 自动触发 [`Public Release`](../../.github/workflows/public-release.yml)，当前流程**不是**手工 dispatch：

| 阶段 | 自动执行内容／人工动作 |
| --- | --- |
| `gate` | 校验 tag 解引用 SHA＝main tip＝事件 SHA；最新 main push CI 全绿；package 版本＝tag |
| `build-macos` | 等待 `release-signing` 维护者批准；随后导入证书、构建 arm64/x64、签名与公证、元信息/fuses/启动检查 |
| `build-windows` | 构建 x64 EXE，元信息/fuses/启动/STT 检查；生成更新 feed 辅助 artifact |
| `publish` | 汇集精确的安装包集合，生成校验文件，再验 CI/tag；上传 draft，核对资产集合后**自动转正式发布** |

执行人在 Actions 页面跟踪实际 run。环境审批人核对已确认的版本和 SHA 后批准，不能只看工作流名称。**draft 只是流水线内部阶段，不是额外人工暂停点**；负责人须在创建 tag 前理解并批准最终自动发布。

### 阶段 G：发布后验收与分发

GitHub Release 应为非 draft，且仅含以下 **6 个资产**：

```text
CogSeed-<VERSION>-mac-arm64.dmg
CogSeed-<VERSION>-mac-arm64.zip
CogSeed-<VERSION>-mac-x64.dmg
CogSeed-<VERSION>-mac-x64.zip
CogSeed-<VERSION>-win-x64.exe
SHA256SUMS.txt
```

在新的下载目录核验实际远端资产：

```bash
gh release view "$TAG" -R "$PUBLIC_REPO" --json url,isDraft,isPrerelease,assets
DOWNLOAD_DIR="$(mktemp -d "${TMPDIR:-/tmp}/cogseed-release-download.XXXXXX")"
gh release download "$TAG" -R "$PUBLIC_REPO" --dir "$DOWNLOAD_DIR"
(cd "$DOWNLOAD_DIR" && shasum -a 256 -c SHA256SUMS.txt)
```

Linux 可改用 `sha256sum -c SHA256SUMS.txt`；Windows 可用 `Get-FileHash -Algorithm SHA256` 逐项比对。

验收并记录：

- 从正式 Release 下载的 macOS arm64、macOS x64、Windows x64 安装包，分别在对应环境做安装／启动、版本、账号／服务连接及本次重点功能检查；macOS 校验签名、公证，Windows 如有签名要求则校验 Authenticode。
- 从上一正式版本升级，检查已有数据仍可访问；不能用 CI 解包启动替代真实安装／升级验证。未覆盖的平台明确写“待验收”，不能记成全部通过。
- 核对公开发布说明与 CHANGELOG。当前流水线不自动生成完整产品发布说明，执行人按已批准内容补齐。
- 清理临时授权，保留源码映射、CI、Release、安装验收及回退信息。

**分发单独验收：** 当前工作流生成 `updates-win-feed-<PUBLIC_SHA>` artifact（保留 14 天），不会自动完成 Hub 录入、官网切换或客户端更新服务发布。GitHub Release 成功不等于官网／客户端已可更新。若本次包含这些渠道，由对应负责人按该渠道流程完成版本与资产录入，并验证“记录 → 发布指针 → 公共下载／更新接口 → 实际文件 → 客户端升级”。在渠道验收前，状态只能写“GitHub Release 已发布，分发待完成”。

## 4. 每次执行的完成条件

- [ ] 版本与 CHANGELOG 已定版，公开贡献和平台修复已回流私仓。
- [ ] develop 候选与 cicd 晋升树一致；同 SHA 私仓 push CI/compliance 成功。
- [ ] 精确导出分类、引用审查、密钥扫描通过；私有映射留存。
- [ ] 公仓当前 PR head 的 15 项 CI 全绿，然后维护者批准。
- [ ] 公仓 PR 已合并、旧快照分支已清理；同 main SHA 最新 push attempt 的 15 项全绿。
- [ ] 发布负责人明确批准版本、SHA、范围和发布主体；main 发布窗口保持冻结。
- [ ] 签名环境与 tag 权限就绪；新 tag 正确且未改写任何旧 tag。
- [ ] 正式 Release 工作流成功，6 个资产集合及实际下载校验通过。
- [ ] 平台安装／升级、签名及重点功能验收完成；要求的分发渠道验收完成。
- [ ] 私有发布记录归档，临时授权复核／收回，发布窗口结束。

## 5. 不属于日常发版的操作

首次历史切换、重写 public main、重设 baseline、删除旧标签、应急本地导出都不属于本 SOP 的正常步骤。历史文档 [CUTOVER-PLAN.md](./CUTOVER-PLAN.md) 和 [CUTOVER-RESULT.md](./CUTOVER-RESULT.md) 仅用于追溯。不得照搬其中旧授权执行下一次版本发布。

## 6. 常见故障定位

| 症状 | 应执行的处理 |
| --- | --- |
| 私仓测试费用／分钟异常增长 | 检查是否把完整测试、模型下载或打包放回了私仓；恢复轻量门禁，修复后只执行必要运行 |
| `Artifact storage quota has been hit` | 私仓同步不应依赖该存储；检查是否走错旧流程。公仓 probe 失败先解决存储问题，再验证，不能跳过签名所需的产物链路 |
| App 拒绝写 workflow | 核对 Workflows write 和组织安装更新批准；仍只安装公仓 |
| 邮箱门禁或合并邮箱拒绝 | 使用 noreply 提交，开启 GitHub 邮箱隐私；合并命令省略 `--author-email`，不要改写主干历史绕过 |
| 导出 missing／unclassified／引用摘要不一致 | 在私仓审查分类与引用后修订策略；新 dispatch，不手改生成报告 |
| 同步 source 不在 cicd／push 检查不通过 | 重新读取完整远端 SHA，等待该 SHA 最新 push CI/compliance；不能用 PR run 顶替 |
| 同步提示 main 已变化 | 更新公仓基线读取、检查贡献回流，再新 dispatch；不能强推 main |
| 同步分支存在但无 open PR | 核实是否上次已合并分支未删除；确认归属后清理，未知分支先查明 |
| 平台测试偶发失败 | 保存完整 job 日志，复现时间、路径、并发或流生命周期问题；增加有判别力的回归，再修代码；不加全局 retry／skip |
| 公仓 PR 全绿但发布 gate 拒绝 | 检查 tag/main/package 版本、同 SHA 的 main push 运行及最新 attempt；PR CI 不够 |
| macOS 作业等待审批／找不到证书 | 检查 `release-signing` 审批和 5 个环境 secrets；不得将密钥贴到日志或聊天 |
| tag 创建被拒绝 | 检查本次批准的发布主体与 ruleset 权限；不取消整套 tag 保护 |
| Release 有包但官网／客户端无更新 | 按阶段 G 检查分发系统；GitHub 上传不自动更新 Hub 或服务端 feed |

读取已结束 job 日志可用 `gh run view <run-id> -R <repo> --log-failed`。API 下载带颜色日志时可用 `gh api --allow-escape-sequences repos/<owner>/<repo>/actions/jobs/<job-id>/logs`，只保存到私有证据位置。

## 7. 安全停止点

任一必需检查失败、SHA 漂移、未知公开差异、审批缺失、签名材料不完整或安装验收失败，都停止推进对应阶段。保留失败证据，再处理根因。

源码同步失败后新 dispatch；测试基础设施短暂故障可在确认根因后有限重跑，但判定始终使用最新 attempt，不选择旧绿结果。产品／工作流代码修复必须回私仓并重新生成候选。

## 8. 发布失败与恢复

| 所处阶段 | 恢复方式 |
| --- | --- |
| 公仓 PR 未合并 | 修私仓，重新晋升与同步同一候选 PR，重新 CI 与审阅 |
| main 已合并，未创建 tag | 停止发布；通过 PR 修复或回退，重新验证新 main SHA 并取得新确认 |
| tag 已创建，构建失败，尚无正式 Release | 不移动 tag。先检查失败原因、tag/main 未漂移、原确认是否仍有效；仅 secrets／环境／基础设施修复可评估重跑。需要改源码或 workflow 时走新版本，不能让旧 tag 指向新代码 |
| 已有 draft Release | 工作流允许同 tag 的 draft，但必须核对来源与资产；多余／错误资产会阻断发布。由执行人按批准范围整理 draft，再重新校验；不能靠改名掩盖错包 |
| 已发布 Release | 工作流拒绝覆盖。同版本不重传不同字节、不移动 tag。负责人确认影响后暂停分发／恢复旧分发指针，并走新补丁版本 |
| 升级涉及数据迁移 | 不自动降级用户数据；先评估旧版兼容性，使用已批准的备份／恢复方案 |

若发布已成功但 Actions 最后状态异常，先查实际 Release 是否已公开，避免盲目重跑覆盖。紧急下架、删除或渠道回退须记录责任人、范围与批准。

## 9. 当前验证基线（历史证据，不是未来版本授权）

2026-10-10 已验证：

- 公仓 [PR #408](https://github.com/bonc-ai/cogseed/pull/408) 候选 `3ce4aa2329bebb5fa34a4e9cfbb379cd21910cdf` 的 [Public CI 38025581659](https://github.com/bonc-ai/cogseed/actions/runs/38025581659) **15/15 全绿**。
- 私仓对应 cicd：`f1f37fbbbafa6844f5436f0d200c17d9cadd165f`；[同步运行 38025469677](https://github.com/bonc-ai/cogseed-internal/actions/runs/38025469677) 两阶段成功。
- 导出 4,256 个文件；摘要 `0cbfe0d58ed7594eefccf239863d744c819dd73fb19ac2053df72ce7d12c08fc`；精确文件树比对与 Gitleaks 扫描通过。
- 编写本 SOP 时 PR 仍为 OPEN／REVIEW_REQUIRED；**尚未证明 main push 验证、正式签名发布和最终分发完成**。

这次已修复的典型根因包括 Windows 模型压缩包解压、跨平台路径／异步测试假设、搜索索引并发覆盖、目录时间戳缓存失效以及代理响应流 GC 生命周期问题。后续出现类似症状先查日志和回归，不默认是 runner 内存不足。

## 10. 可复制的私有发布记录与确认模板

```text
版本 / tag：
执行人 / 发布负责人 / 代码审阅者 / 签名审批人：
计划范围：GitHub Release / 官网 / 客户端更新 / 其他

develop 定版 SHA：
私仓修复 PR / 晋升 PR：
cicd SOURCE_SHA：
同 SHA 私仓 CI / compliance push run：
同步工具 SHA / 同步 run：
导出文件数 / exportSha256 / 策略摘要 / 引用审查摘要：
Gitleaks 自检与候选扫描结果 / 私有映射存放位置：

公仓 PR / PR head SHA / 15 项 CI run：
维护者批准记录：
合并后的 PUBLIC_SHA：
同 SHA main push CI run / attempt / 15 项结果：
版本与 CHANGELOG / 公开文件树核对：
Hub 地址 / 签名环境就绪 / Windows 签名状态：
平台验证及未覆盖项：
已知风险 / 恢复方案：

正式发版确认：
我确认发布 <版本>，公仓提交 <完整 SHA>，tag <tag>。
已审阅以上验证结果和限制；批准 <发布主体> 创建该 tag，
并执行签名、公证、构建及流水线自动公开 GitHub Release。
分发范围为 <渠道>；临时权限为 <权限及回收安排>。
确认人 / 确认时间 / 确认记录链接：

正式发布 run / 环境审批记录：
Release URL / 6 个资产名称与 SHA256 / 实际下载核验：
各平台安装、启动、升级、数据与重点功能验收：
官网 / Hub / 更新接口 / 客户端分发验收：
临时权限回收 / 发布窗口结束时间：
最终状态：待审阅 / 待正式确认 / 构建中 / GitHub 已发布待验收或分发 / 发布完成 / 停止待修复
```

源码依据：[同步工作流](../../.github/workflows/public-source-sync.yml)、[公仓 CI](../../.github/workflows/public-ci.yml)、[正式发布工作流](../../.github/workflows/public-release.yml)、[发布门禁](../verify-release-gates.mjs)、[导出维护说明](./README.md)。这些实现变更时，同步更新本 SOP。
