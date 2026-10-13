# 私仓到公仓的源码同步

RD 在 `bonc-ai/cogseed-internal` 开发；定版后从固定提交导出公开文件，在 `bonc-ai/cogseed` 创建快照 PR。公仓不接收私仓 Git 历史。首次历史重写是独立的一次性操作，后续同步不重写 main。历史 Release 所需的 9 个原标签已保留；它们仍引用旧历史，不能宣称整个仓库历史已清除。

当前实施结果见 [CUTOVER-RESULT.md](./CUTOVER-RESULT.md)。[CUTOVER-PLAN.md](./CUTOVER-PLAN.md)是历史计划，不得直接照其中删除标签的步骤执行。文件存在、离线测试通过、workflow 合并、凭据配置、真实运行成功是不同状态；只有成功的运行和公仓 PR 能证明自动化已启用。

## 维护规则

`policy.json` 是唯一文件边界配置：`neverPublic` 优先级最高，`publicFiles` 精确到文件，`privatePaths` 分类其余私有文件。新增文件默认不公开；未分类、应公开但缺失、危险路径、符号链接、子模块、LFS 指针均阻断正式同步。

以下根目录和文件不公开：`.agents/`、`.claude/`、`.specify/`、`design/`、`specs/`、`skills/`、`AGENTS.md`、`CLAUDE.md`、私有导出工具及 `test/private/`。`resources/builtin/` 是公开产品资源。`docs/` 默认私有，只有两份 DEVELOPMENT 指南公开；社区公开材料按清单导出，PILOT_BACKLOG 保留私有。`updates-server/` 的 8 个参考实现文件已获准公开。

每次发版在私仓 PR 中审查新文件、公开内容和文档引用，更新清单；`reviewedReferenceHintsSha256` 绑定已复核的引用提示集合。正常的用户 AGENTS.md/CLAUDE.md 文件处理代码可以保留。不能为了扫描通过而放行整个测试目录；Gitleaks 配置只精确豁免已复核的合成样例，workflow 用两个随机阳性样例验证检测仍有效。

清单 `reviewed` 表示边界和提示已复核，不替代测试、扫描或发布批准。导出报告永远不声称自行授权发布。私仓源 SHA、映射和审核报告不得写入公仓提交或 PR。

## 后续每次定版

从私仓定版到公仓 CI、维护者审批、正式 tag／签名发布及分发验收，统一执行 [新版本发布 SOP](./CICD-PLAN-C-RUNBOOK.md)。本节仅概述源码同步，不替代正式发版确认。

1. RD 按现有流程合入 cicd，选择完整 40 位提交 SHA，确认该 SHA 在 cicd 历史中，且该 SHA 最新的 cicd push CI 和 compliance 均成功。
2. 先按下节核验贡献登记和公仓作者历史；外部 PR 未完成合并时停止。确认私仓 develop 中的导出清单和引用提示复核值适用于该版本。发起 `Public source snapshot PR` workflow，只填 `source_sha`。
3. workflow 使用发起时固定的 develop 工具版本和指定源码 SHA，执行分类、逐文件哈希校验、密钥扫描及同 SHA 门禁，再创建或更新公仓 `public-source-sync` → `main` PR。
4. 维护者审阅公仓差异并按仓库规则合并。workflow 不合并 PR、不创建 Release、不修改 main 或旧标签。公开贡献先导入私仓并登记；源码候选通过门禁后，外部 PR 先完成必需 CI 和正式审核，以 merge commit 保留原始作者提交，之后才发起快照同步。快照 PR 仍可 squash，因为外部提交已在其公仓父历史中。

相同内容不生成重复提交；已有同步 PR 可按精确 lease 更新。main 在准备期间变化会停止运行。旧同步分支无对应 open PR 时停止，不覆盖来历不明的分支。

## 外部贡献归属门禁

接收新的外部 PR 或修复历史贡献归属时，按 [公仓外部贡献接收手册](./COMMUNITY-CONTRIBUTION-RUNBOOK.md) 逐项执行；其中包含审批边界、异常处理和私仓接收记录模板。

导入外部 PR 时保留作者、DCO 和 `Source-PR: https://github.com/bonc-ai/cogseed/pull/<编号>`
尾注，并在同一私仓变更中更新 `contributions.json`：每条记录含 `pr` 和接受的最终
公开 `headSha`（完整 40 位 SHA）。登记的是原始贡献 head，不是私仓 cherry-pick SHA、
同步 SHA 或为了追上 main 新增的 merge SHA。记录为累计清单；后续重构或撤销内容也
不删除原贡献记录。审核者核对 PR、接受范围和 head，不能用某个已有 main SHA 顶替。
未使用尾注的手工复制也必须登记；自动检查不能从任意复制的文件反推出原作者。

`contributions.mjs` 从固定源码 SHA 读取登记表，适配 develop → cicd 的完整树晋升；
不读取未提交的登记改动，也不要求私仓导入提交出现在 cicd 祖先中。缺失、无效、重复
登记、历史条目被删除或替换、可见 `Source-PR` 缺项或任何登记 head 不在预期公仓 main 祖先中，都阻止同步。
第一次使用新工具前，源码候选必须携带登记表；旧候选缺表应重新晋升，不能用空表绕过。

工作流 prepare 阶段在发放公仓写 token 前检查一次，`sync.mjs` 生成任何快照前再检查；
无内容变化和本地演练同样检查。私有映射记录登记摘要、PR 列表和检查数量。
`--bootstrap` 遇到非空登记表拒绝执行，不能通过重建根提交丢弃已登记贡献。

只允许当前清洁基线之后的公开历史。切换前 PR 必须清洁迁移，不能接回旧祖先；
源码文件相同并不证明历史可以公开。修复已被快照吸收的贡献时先验证普通合并的完整
树等于当前 main，再走公仓 CI 和 CODEOWNERS 审批；合并后验证原 head 是 main 祖先且
文件树未变。新 PR 按发布 SOP 的贡献回流阶段执行，历史修复同样不豁免门禁。

## 首次启用配置

先将本工具和 `.github/workflows/public-source-sync.yml` 经私仓 PR 合入默认分支 develop；初次历史切换完成并核验后，再配置以下仓库 Actions 项：

| 类型 | 名称 | 值 |
| --- | --- | --- |
| Variable | PUBLIC_SOURCE_APP_ID | 专用 GitHub App ID |
| Secret | PUBLIC_SOURCE_APP_PRIVATE_KEY | App 私钥，仅写入 GitHub Secret，不进入聊天、代码或报告 |
| Variable | PUBLIC_SOURCE_BASELINE_SHA | 首次切换后公仓无父根提交完整 SHA |
| Variable | PUBLIC_SOURCE_BASELINE_READY | `true`，仅在首次切换核验完成后设置 |

App 只安装到公仓 `bonc-ai/cogseed`，授予 Contents: write、Pull requests: write、Workflows: write（同步已批准的工作流文件）（Metadata: read 为基础权限）。私仓 checkout/CI 查询使用本次 workflow 的只读 GITHUB_TOKEN。不要把个人 gh CLI token 作为永久自动化凭据。私仓当前套餐不支持强制 branch protection，因此不能声称已有平台强制的独立评审；需限制有权更改 develop、Secrets 和发起 workflow 的维护者。升级套餐后的环境审批可另行配置，不是当前运行前提。

## 本地工具与证据

导出工具本身无需新增 npm 依赖，需要 Git 和 Node.js 24；工作流契约测试复用仓库现有 yaml 依赖（先运行 `npm ci --ignore-scripts`）：

```bash
npm test --prefix scripts/opensource
node scripts/opensource/export.mjs --source '<完整SHA>' --out '<仓库外新目录>'
node scripts/opensource/sync.mjs --help
node scripts/opensource/cutover.mjs --help
```

导出目录包含 `source/`（公开候选）、`manifest.json` 和 `review.json`（私有证据）。导出器只读 Git blobs，逐文件记录路径、模式、大小、SHA-256；未提交内容不进入候选。source 安装依赖或测试后不能整目录发布，必须重新导出干净候选并核对摘要。

`sync.mjs` 再次对照源 Git 对象、清单、扫描和授权证据，建立只有公仓父提交的快照；`--bootstrap` 建立无父根提交。它本身不联网、不推送。`--allow-review-required-local` 仅供本地演练，其映射不得用于真实切换。

标准同步的两阶段通过少量 job outputs 传递 `evidence.mjs` 生成的来源、清单/审查字节摘要和扫描报告；发布阶段重导出并核对全部摘要后才创建公仓 token。扫描摘要、脱敏日志和私有映射保留在私仓运行日志/summary，不依赖 Actions artifact 存储。公仓 CI 另以一个公开小文件检验产物上传、下载和校验和，正式签名前必须通过。

首次用户授权记录采用本地明确批准方式，记录只重写公仓 heads/tags、保留 Release 资产和接受只读 PR refs 的范围，不伪造 workflow run。后续自动化只接受实际 workflow_dispatch 运行记录。

额度停用期间的加急发版只允许一次 `explicit_user_emergency` 授权：授权必须绑定当前源 SHA、导出摘要、策略摘要和引用提示摘要，`scope` 固定为 `single_snapshot_pr`，并提供仓库外的私有授权记录文件。`expiresAt` 不得晚于 `2026-10-01T00:00:00+08:00`，且工具按本次提交时间拒绝已过期授权；不得携带 `workflowRunId` 或 `workflowRunAttempt`，也不能与 `--bootstrap` 同用。该方式仅用于 2026-09 加急发版，10 月 1 日后必须回到真实 `workflow_dispatch` 运行记录；它不改变 PR 审查、Gitleaks 扫描或公仓 CI 门禁。这些 JSON 是私有审计记录，不是加密身份证明。

`cutover.mjs` 默认生成私有计划并探测原子推送；apply 要求准确计划摘要，重新验证候选、证据和全部远端 heads/tags，以每个分支 ref 的精确旧 OID lease 执行一次 atomic push；既有 tags 原值保留。任一 ref 漂移或保护拒绝即停止；工具不修改保护、Release、资产或 PR。保护的临时调整和恢复由维护窗口操作另行记录。备份恢复必须显式映射 heads/tags，禁止 mirror 推送备份命名空间。

初次产品基线为私仓 `v1.2.0` 解引用提交 `bcdb3206016623d8fcc4eaa7c44f19dd21602241`。公开适配提交只调整文档、测试隔离和清单，不改产品 src、资源及打包配置。适配后的公开 tree 不等于旧发行产物的原始 tree；不因此发布新安装包或把旧 tag 重指向新根。
