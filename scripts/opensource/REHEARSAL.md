# 首次本地导出演练记录

日期：2026-09-28。状态：工具验证完成；公开候选待复核；没有执行发布或历史清理。

## 固定输入

- 来源仓库：`bonc-ai/cogseed-internal`。
- 本地实施分支：`codex/public-source-export`。
- 演练来源：develop 的 `ead9af6690002c52384b7420a5a6f7b8a5933cb4`，不是已通过发布门禁的 cicd 候选。
- 规则：同目录 `policy.json`，状态仍为 `draft`。
- 第四轮候选目录：`/Users/zhongyangfan/Developer/cogseed-public-preview-20260928-v4`。
- 导出 SHA-256：`9b0e877b46558ac0367b06e685bbd7f5d4d2af04dada99e9a715b1d08eaa984b`。

## 已验证

- 候选包含 3,943 个文件，逐一核对磁盘文件集合、大小、SHA-256、执行位，与 manifest 一致。
- 没有 `.git`、`.agents/`、`.claude/`、`.specify/`、`design/`、`specs/`、根 AGENTS/CLAUDE 文件或导出工具自身。
- 报告与私仓来源映射放在 source/ 外；没有向公仓传输。
- `npm test --prefix scripts/opensource`：12 项全部通过，macOS 实机运行；尚未在 Windows 主机执行。
- 候选中的 `npm run tokens:check`、`npm run community:skills:check`、`npm run builtin:manifest:check` 均通过。
- 设计令牌检查沿用现有 2,937 条 baseline；社区检查当前有 0 个候选 Skill 包，不能解释为已有社区 Skill 验收通过。
- 与第一轮快照相比增加 13 个文件：社区 Issue/PR 模板、签名权限 plist、源码说明和现有引导脚本。
- 用户已确认根目录 `skills/` 暂不公开，已纳入 `neverPublic`，不影响 `resources/builtin/`。第三轮相比第二轮公开文件集合不变，只更新规则映射和待分类报告。
- 用户已确认公开 `updates-server/` 更新服务参考实现。第四轮相比第三轮仅增加该目录的 8 个已提交文件；`releases.json` 是空目录数据，没有附带安装包、部署证书或运行时下载数据。
- 在第四轮实际导出的 source/ 中运行 `npm run test:updates-server`，17 项通过，覆盖版本比较、平台筛选、更新 feed、下载路径穿越拒绝等。此结果不等于完整应用或线上服务验收。
- 私仓 `.github/CODEOWNERS` 已归为私有配置，暂不原样导出；公仓评审主体与保护规则在跨仓发布配置阶段核实。当前固定 SHA 的未分类文件已归零。

## 第二阶段：公开文档和测试边界修正

- README、贡献指南、开发指南和社区模板统一使用公仓 `main`；贡献经评审导入私仓，再随定版快照公开。公共 PR 以导入结果关闭，保留作者、DCO 和 PR 关联。
- 公共文档不再链接内部 AGENTS、治理台账、试点 backlog 或缺失的更新 API 设计文档。公开开发指南保留共享 UI、IPC、i18n、路径保护等贡献约束。
- 内部规则、Renderer 台账和私仓 workflow 检查移入 `test/private/`，仍在私仓默认 Vitest 范围内；没有新增条件跳过。产品行为断言留在公开测试中。
- 清单排除 `test/private/`，移除 3 个旧测试路径、增加 2 个公开契约测试路径，候选清单变为 3,942 个文件。
- `npm run readme:check`：22 个本地链接通过。
- `npm run typecheck`、`npm run lint`：通过。
- 导出工具 12 项测试通过；相关 11 个 Vitest 测试文件通过，95 项通过、2 项原有平台条件跳过。
- 上述针对性 Vitest 暂用本机已有同版本 Electron 41.10.6 运行；本检出 `npm ci` 的官方 Electron 下载缓慢，因此不将此结果描述为全新安装验证。

第二阶段源修改已固定为本地提交 `402d92c628821f05af1c280d1808ad84ca625ab1`。第五轮导出 3,942 文件，未分类和缺失均为 0；依赖安装、类型检查、lint、针对性测试和资源测试通过。全量仍有两项可在私仓复现的业务基线失败。干净候选重导出哈希与验证用源码相同。详见 [第五轮验证记录](./VALIDATION-20260928.md)，第四轮结果不冒充新候选结果。

## 剩余门禁

1. 清单是 Draft；内容安全扫描、独立复核仍未完成。未分类归零不等于允许发布。
2. 内部文档引用提示还需逐项区分注释、功能夹具和真实依赖；不能批量删除 AGENTS/CLAUDE 字面引用。
3. 第五轮独立安装已完成，完整 JS 测试未全绿；应用启动未就绪，macOS/Windows 构建和安装验收仍未完成。
4. 公仓 workflow 和保护规则尚未配置；旧同仓发版 workflow 不能原样导入。
5. `v1.2.0` 既有安装包来源、跨仓资产映射和历史清理仍需分别核验和放行。

没有向公仓传输、推送分支、创建 PR/tag/Release 或改写历史。所有导出都是本地候选，不是已发布版本。
