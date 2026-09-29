# 当前 develop 公开清单复核

2026-09-28 在私仓分支 `codex/public-source-export` 复核。`policy.json` 的 `reviewed` 只表示**文件边界和引用提示**已经针对以下固定源码提交审阅；它不表示内容扫描、CI、发布或公仓合并获得批准。

| 证据 | 固定值 |
| --- | --- |
| 清单对应的私仓源提交 | `f579da5479858bc3e2c3b3842d433b30da949021` |
| 公开文件数 | 3,942；缺失 0；未分类 0 |
| 导出文件集合 SHA-256 | `916004cfb78bfd4eadc601fe3eca02f30bd2e890117b81c59144d983b4f84384` |
| 引用提示 | 123 个文件；`SHA-256(JSON.stringify(privateReferenceHints)) = d4c64c5fc29a268b65f24f91520e47c5f00fe1301d97d3490ca7e23cbf32b726` |
| 当前 `policy.json` SHA-256 | `e59a86d28cdc50385936b39540b778cbf6bfdae1f53055b840e071bbf904537d` |

导出器从提交的 Git blob 生成私有候选 `cogseed-public-cutover-20260928/develop-export-f579da5/`。公开文件集合相对首次正式 1.2 候选有 11 个新增、1 个移除、54 个内容变化；它是后续 develop 产品树的清单，**不是首次 1.2.0 切换的清单**。首次定版适配使用另存的私有 `v120-reviewed-policy.json`（3,932 文件），不得把两个清单互换。未来指定 cicd 源提交时仍须重新导出并要求缺失、未分类为 0；本次 `reviewed` 不保证任意旧 SHA 都可用。

对全部 123 个提示逐项按“目标文件是否在公开树中缺失、引用行是否实际读取或链接其正文”复核。正式 1.2 候选已有的 121 个提示见私有 `v120-reference-review.md`；本候选只新增 `src/main/features/connectors/local-cli-auth.ts` 的 `AGENTS.md` 注释、`src/renderer/index.html` 对 `docs/renderer-structural-registry.md` 的 HTML 注释，并在 `src/renderer/modules/connectors.js` 增加同一治理文档的代码注释。该文档本身保持私有；运行代码不读取其正文。额外检查到 `src/renderer/style.css` 的同类注释（CSS 不在导出器的引用提示扫描扩展名内），也未见运行依赖。旧 `PC/CLAUDE.md` 和发行整改文档章节引用依旧是注释/维护文档欠账。用户主目录或用户工作区中的可选 `AGENTS.md` / `CLAUDE.md` 属于产品导入功能，并非被排除的私仓文件。

内容复核将本候选与正式 1.2 公开树逐文件比较，检查变更行中的 URL 域名、邮件域、IP、绝对用户目录、私仓仓库名和内部路径。新增 URL 只指向公开的 GitHub/npm/开源许可或腾讯会议站点；`/Users/` 仅在 `example`/`tester` 合成测试路径出现；没有新增私仓仓库名、内部网段字面量或个人邮箱。已固定的旧版 Gitleaks 8.18.4 在两树上均报同样 32 个已知 fixture 命中，新增/移除命中均为 0；此结果**不代替**工作流规定的 Gitleaks 8.30.1 扫描，后者仍是发布前门禁。

`CHANGELOG.md` 在上述源提交中仅删去了内部清理过程条目和已排除的设计文档链接，保留其余主分支内容。此处记录清单复核和候选范围，不宣称新版安装包或 Release 产生。
