# 方案 C：1.3.0 发布链路（2026-10-10）

本文件属于私仓，不进入公开快照。取代 2026-09-28 手册的过期执行步骤；9 月一次性本地导出授权已过期，禁止复用或倒填时间。

## 成本与证据边界

- **私仓所有分支（包括 cicd）的 GitHub 托管 runner 均消耗计费额度。** Ubuntu 不是免费运行保证，不提高组织预算，也不使用付费 larger runner。
- 私仓 `ci.yml`：安装依赖时 `--ignore-scripts`，仅类型、lint、静态资源/文档、跳过登记及导出/工作流契约；不跑完整 JS/Python、不下载模型、不打包。超时 10 分钟。
- 私仓 `compliance.yml`：轻量许可证/SBOM 检查，不执行原生 postinstall。超时 10 分钟。
- develop 也仅保留静态与发布契约检查。package.json/lockfile 变更会让 affected 筛选退化成全量，故不在私仓托管 runner 上运行；完整验证在本地、公仓或受控自建 Linux runner。不得把静态成功记作全量通过。
- 同步不依赖私仓 artifact 存储：两阶段通过短摘要传递扫描证据，第二阶段重导出并验证 manifest/review/scan 字节摘要及来源；完整重建依据与映射保留在私仓运行记录。
- 公仓标准 runner 承担 Linux/macOS/Windows 分片全量、资源测试、Windows 原生协议测试及两平台打包冒烟；无签名 secrets。
- 私仓检查通过只证明候选可导出；公仓完整 CI 与人工审查才是平台发布资格。取消、跳过、仅本地通过不能冒充云端完整成功。

## 唯一发布路径

1. 修复 PR → 私仓 develop；保持 `scripts/opensource` 工具和产品源码在私仓维护。
2. develop 晋升到 cicd，保留已评审的平台修复，核验版本和 IPC 契约。若采用 squash 解决历史邮箱问题，记录来源 SHA 与最终树摘要，不改写 develop 历史。
3. 等最终 cicd SHA 的 `ci.yml` 和 `compliance.yml` **push** 运行成功；PR 检查不能代替此证据。
4. 对最终候选复核 `policy.json`：零 missing/零 unclassified、逐文件分类和私有引用摘要已审查。新增文件不自动公开。
5. 从私仓 develop **新 dispatch** `Public source snapshot PR`，传入完整 cicd SHA。工具固定导出，执行 Gitleaks 阳性自检与精确扫描，并重导出比对；仅推公仓 `public-source-sync` 分支并开 PR。
6. 公仓 PR 的 `public-ci.yml` 全绿，维护者审查后合入 main。删除已合并的快照分支。等待同一 main SHA 的 push CI 完成。
7. **暂停，提交正式发布确认包**：私仓候选/公仓 SHA、版本、PR/CI 链接、导出/扫描摘要、平台检查、已知限制。确认前不得创建正式 tag、执行签名发布或发布 Release。
8. 负责人确认后，在公仓 main tip 创建新的 `v1.3.0` tag。不得移动或删除已有 tag。
9. `public-release.yml` 验证 tag 解引用 SHA、main tip、最新 push CI attempt 的全部 job；macOS 经 `release-signing` 审批后签名、公证。Windows 生成安装包并冒烟。
10. 发布前再校验公仓 CI 与 tag、拒绝覆盖既有正式 Release；校验五个安装包，生成 SHA256SUMS.txt，上传草稿后核验资产集合，再发布。
11. 核验 Release 的安装包、校验文件和下载；将公开 SHA 与私有来源映射、检查运行及发布记录保存在私有证据中。

## 公仓设置

- main ruleset：禁止删除/强推；至少一名审批；CODEOWNERS 覆盖 workflow、发布门禁和 CODEOWNERS 本身。
- required checks 必须对应 `scripts/verify-release-gates.mjs::PUBLIC_CI_JOBS`：compliance、verify-macos、verify-windows-package，以及 linux-tests/macos-tests/windows-tests 各 1–4 分片。首次出现后添加，不填写不存在的旧 job。
- Environment `release-signing`：维护者审批、禁止自批，仅允许 `v*` tag。证书持有人将 5 个 Apple secrets 放入环境；签名验证后移除仓库级同名 secrets。值不得写入仓库/日志/聊天。
- tag ruleset：保护 `v*` 创建/更新/删除。当前无 bypass actor，正式发版确认时再明确发布主体及必要权限；不默认授予管理员永久绕过。
- Public Source Sync App：只安装公仓；Contents/PR/Workflows write（首次同步 workflow 文件需要 Workflows 权限）。权限更新需组织管理员批准安装；不可扩大到私仓。
- 默认 Actions token 只读；外部贡献工作流需审批；不使用 `pull_request_target`。
- 公仓只收到导出快照。不得 checkout 私仓跑免费测试，不得把内部测试包或私有报告上传公仓。

## 故障处理

- 私仓取消：保存同 SHA 的运行日志，优先排查 RSS/进程树与 runner 终止原因；不要通过反复重跑完整套件消耗分钟。
- 导出失败：在私仓修订精确清单/引用审查，重新扫描和 dispatch，不手工复制、不使用演练 bypass。
- 公仓 CI 失败：回私仓修复，重新晋升和导出；不能跳过平台失败进入签名。
- 同步 App 拒绝 workflow 写入：核实安装权限；不更换成不受约束的发布路径。
- 本地或平台环境未完整验证：记录“未完成”，正式发布确认包不能标记通过。

## 2026-10-10 调查事实

- 原报告中的 #51/#52 已合入 develop；#54 为未合并晋升候选。
- 后续 sleep-10 探针成功；真实测试探针可用内存最低已记录 625 MB、磁盘仍余 39 GB。无充分证据定性为 OOM，也无依据排除代码/进程问题。
- 查询时 10 月私仓 Linux 已记账 360 分钟、净费用 $0；只是当时记录，不代表未来预算与额度保证。
- 首次标准同步 `38015433824` 的导出和扫描成功，但私仓 artifact 上传被 `Artifact storage quota has been hit` 阻止；不要通过重跑或增加预算处理此依赖。新链路将私有证据留在运行日志/summary，并在公仓 CI 单独验证小文件产物往返。
- 公仓 main 仍为 b071821，完整新发布链路尚待首次实际验证。实现代码或本地测试通过不等于验收完成。
