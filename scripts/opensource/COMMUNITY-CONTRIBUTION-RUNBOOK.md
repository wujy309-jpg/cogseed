# 公仓外部贡献接收手册（维护者）

适用：接收 `bonc-ai/cogseed` 的外部 PR，以及恢复已被同步快照吸收的贡献归属。
本文根据 #406、#410、#421、#422 的处理经验整理；2026-10-15 补充独立社区贡献定向晋升。
执行门禁以 [发布 SOP](./CICD-PLAN-C-RUNBOOK.md) 为准；本文把其中 A、B、B.1、C、D、E 阶段串成接收清单，不另设发布通道。
本文件、贡献登记和审核证据均留在私仓，受 `policy.json` 的 `neverPublic` 约束。

## 接收完成的标准

贡献内容进入私仓，只完成了“导入”。公仓原始作者提交进入 `main`，才完成 Git 历史中的归属保留。
只把文件经 `CogSeed Public Sync` 同步回公仓，不能替代原作者提交的合并。

正常顺序：

1. 审查公仓贡献内容、作者信息、DCO 和全部待合入历史。
2. 私仓导入内容并登记原始贡献 head，经 PR 合入 `develop`。
3. 按 SOP 阶段 B 整树晋升，或符合条件时按 B.0 定向晋升 `cicd`；固定源码 SHA，通过该 SHA 的 push CI 和 compliance。
4. 原公仓 PR 的当前 head 通过全部必需 CI，取得正式 CODEOWNERS Approve，以 merge commit 合并。
5. 确认登记的原始贡献 head 已是公仓 `main` 的祖先。
6. 需要同步时，通过标准工作流创建快照 PR；完成快照 CI、正式审批、合并及同一 main SHA 的 push CI 验证。
7. 核验贡献者显示情况，保存私有接收记录。源码接收不等于正式发版。

## 一、收到 PR：先确定接受什么

- 记录公仓 PR 链接、作者、原始贡献 head 的完整 40 位 SHA、拟接受的业务提交和文件范围。
- 审查差异、许可证/DCO、作者信息及依赖；PR 描述中的运行结果是提交者提供的证据，不能直接写成维护者已验证。
- 核对新增祖先均属于当前清洁公开基线之后的可公开历史。切换前的旧 PR 按 SOP 清洁迁移，不接回旧私有历史；文件树相同不能替代历史审查。
- 检查是否已有相同内容、是否需要补测、是否涉及公开文件清单，以及当前是否处于发布 main 冻结阶段。
- 在导入前规划接收顺序：固定候选登记的每个贡献 head 都必须先进入公仓 main，才能同步该候选。不要把尚未准备好接受的 PR 登记为已接受。

## 二、私仓导入：内容和归属一起登记

在基于最新 `origin/develop` 的干净隔离分支操作，遵守根目录 `AGENTS.md`：

1. 导入审查过的业务提交，通常使用 `git cherry-pick -x --signoff <业务提交SHA>`；不要盲目导入用于追上 main 的整段合并历史。
2. 保留原作者及其 DCO 尾注，追加实际执行人的签署，并保留来源提交信息。不得冒签作者；缺少所需 DCO 时先由贡献者补齐。
3. 导入提交增加 `Source-PR: https://github.com/bonc-ai/cogseed/pull/<编号>` 尾注。
4. **同一私仓变更**更新 [contributions.json](./contributions.json)：登记 `pr` 和接受的原始公开 `headSha`。手工复制内容也必须登记。
5. 审查 [policy.json](./policy.json)：新增公开文件逐项列入 `publicFiles`，私有材料按规则分类，并复核引用提示。不得为了同步方便放开整个目录。
6. 做与变更相关的本地验证，创建私仓 PR，通过现有检查后正常合入 `develop`；禁止直接推主线。

登记的 SHA **不是**私仓 cherry-pick SHA、同步快照 SHA，也不是仅为追上 main 新增的 merge SHA。
登记表是累计记录；后续重构或撤销内容不删除、不替换历史条目，也不能用已有 main SHA 冒充贡献 head。

随后选择晋升路径：常规版本按 SOP 阶段 B 创建到 `cicd` 的完整树晋升 PR，先处理 cicd 独有修复的回流；独立声明式社区贡献可按阶段 B.0 从固定 cicd 定向引入已在 develop 接收的业务提交、登记和精确公开清单。定向候选必须证明白名单之外逐文件等于 cicd，不能携入其他 develop 变动、删除历史登记或覆盖已有修复。适用条件、白名单和核验步骤以发布 SOP 为准。
晋升后固定完整源码 SHA，确认该 SHA 最新的 `ci.yml` 和 `compliance.yml` **push** 运行成功；PR 检查成功不能替代合并后的检查。

## 三、公仓原 PR：先 CI，后正式审核，再保留历史合并

导入私仓后保持原 PR 打开；仅因“内容已导入”而关闭的 PR，可按规范重新打开。
如需更新 base，正常合并最新公仓 main 到贡献分支并保留原始提交，重新核对当前 head 的内容和新增历史。
新 head 需要新的 CI 和有效审批，旧 head 的结果不能沿用。
合并前再次确认公仓实际接受的内容与私仓固定候选一致；若出现新的业务改动，先回到私仓审查、导入和晋升，不能只凭公仓 CI 通过继续合并。

| 动作 | 通过条件及责任边界 |
| --- | --- |
| 批准外部贡献的 Actions 运行 | 维护者先审查本次运行对应的代码和工作流，再按授权批准；只允许执行检查 |
| 正式 CODEOWNERS Approve | 当前 head 的必需 CI 全绿后，由有权限的 CODEOWNER 在 GitHub 提交；执行人不得代批 |
| 合并原贡献 PR | 当前 head、有效 CODEOWNER 审批、必需检查、分支最新性和可合并状态同时满足 |
| 正式发布 | 另走 SOP 的发布确认、签名审批和分发验收；以上动作不代替发布授权 |

核对示例（在实际操作时填入 PR 编号，SHA 必须来自最新查询）：

```bash
PUBLIC_PR='<公仓PR编号>'
gh pr view "$PUBLIC_PR" -R bonc-ai/cogseed \
  --json headRefOid,baseRefOid,reviewDecision,mergeable,mergeStateStatus,statusCheckRollup
gh pr checks "$PUBLIC_PR" -R bonc-ai/cogseed
```

当前 SOP 要求 **15/15 必需检查 success**。若仓库规则发生变化，先核对并更新规范；不要以数字相同、测试断言通过或整个 job 被跳过代替检查成功。
必须确认 `reviewDecision=APPROVED`，并核对 CODEOWNERS 对本次文件的覆盖范围。
“有人留下 APPROVED review”不等于 CODEOWNER 门禁已满足；仍为 `REVIEW_REQUIRED` 时，交给有权限的 `bonc-ai/reviewers` 成员处理，不能重复自批或关闭保护规则。

仅在上述条件全部满足且 head 未变化时执行：

```bash
PUBLIC_HEAD='<刚核验的完整40位PR head SHA>'
gh pr merge "$PUBLIC_PR" -R bonc-ai/cogseed \
  --merge --match-head-commit "$PUBLIC_HEAD"
```

外部贡献 PR 不使用 squash/rebase，不删除贡献者分支。`--match-head-commit` 不替代其他审核门禁。
在公仓专用 checkout 获取最新 main 后，逐条验证登记的原始贡献 head：

```bash
git fetch origin refs/heads/main:refs/remotes/origin/main
CONTRIBUTION_HEAD='<contributions.json 中该贡献的完整 headSha>'
git merge-base --is-ancestor "$CONTRIBUTION_HEAD" origin/main
```

返回非零即停止同步，并核对对象是否已获取、仓库是否正确及合并历史是否保留。
同时核查原作者信息仍在对应提交中。GitHub contributor 页面可能延迟更新；区分“祖先关系已确认”和“页面已显示”，必要时核对作者提交邮箱与 GitHub 账号关联，不通过伪造空提交或改写作者来制造贡献。

## 四、标准同步与合并后验证

按 SOP 阶段 C 操作，仅使用标准 `public-source-sync.yml` 工作流和固定源码 SHA。
贡献门禁从该源码提交读取累计登记表；任何登记 head 未进入预期公仓 main 都会阻断同步，包括无内容变化的同步。
不得删登记、使用旧候选空表或手工推公仓文件绕过。

- 核验工作流 `prepare`、`publish_pr` 均成功，审查导出差异、分类、扫描及私有映射证据。
- 公仓 `public-source-sync` 快照 PR 按阶段 D 完成当前 head 的全部必需 CI 和正式 CODEOWNERS 审批。
- 快照 PR 可以按 SOP squash，因为原作者提交已在公仓父历史中；不要把此规则用于原贡献 PR。
- 合并后按阶段 E 验证**同一个 main SHA** 最新的 Public CI push 运行。PR CI 成功不等于 main CI 成功。
- 若本次修复涉及 Scorecard，还要核对实际分析与 SARIF 上传步骤成功；普通 Public CI 全绿不能证明 Scorecard 已运行。
- 私仓源 SHA、同步映射、导出审核报告和内部 PR 信息只存私仓，不能写入公仓 PR 或提交。

## 五、异常处理

**内容已公开但作者丢失（#406）：** 先验证原 PR 可以普通合并且完整文件树与当前 main 完全相同，再完成 CI 和正式审核。合并后再次比较完整 tree，并验证原始 head 的祖先关系。有冲突或文件差异时停下审查，不用强推、重复应用代码或空提交冒充归属恢复。

**公仓 CI 失败（#410 后续、#421、#422）：** 保存失败 job/步骤/日志，区分断言失败、测试进程未收尾和外部服务故障。修复回私仓 PR，按 develop → cicd 同 SHA 门禁 → 标准同步重新推进，不直接修公仓生成的快照。测试断言全过但 worker/RPC 报未处理错误，仍属于失败；不能过滤日志、跳过测试或无限重跑掩盖。

**归属门禁与修复顺序互相等待：** 先在私仓完成修复和门禁，说明哪些已登记原始 PR 阻止新快照。若需要调整已约定的“先公仓验证修复，再接收原 PR”顺序，明确提交给负责人确认；在原 PR 自身满足 CI 和正式审批后，先合并原始提交，再同步修复。聊天顺序确认不能代替 CODEOWNER 审批，也不能豁免失败的必需检查。

**授权或结果过期：** head/base 变化、审批失效、CI 未完成/失败、公开差异不明时停止。同步失败按 SOP 使用新 dispatch，不复用旧运行授权。历史失败运行保留原状态，用修复后新 SHA 的运行证明闭环，不宣称旧失败被改成成功。

## 六、本次案例与可复用结论

| 案例 | 已验证事实与后续接收规则 |
| --- | --- |
| [公仓 #406](https://github.com/bonc-ai/cogseed/pull/406) | 恢复 Mover-hub 的 4 个原始提交；合并前后完整文件树一致。内容无差异的归属修复同样需要 CI 和正式审核。 |
| [公仓 #410](https://github.com/bonc-ai/cogseed/pull/410) | 接受 Feng11-kyrie 的 3 个候选文件，保留 3 个原始业务提交；追上 main 后的 PR head 与登记的原始贡献 head 含义不同。 |
| [公仓 #421](https://github.com/bonc-ai/cogseed/pull/421) | 通过标准快照交付贡献指南及测试修复；原始贡献先进入 main，快照 squash 不会抹去已有作者历史。 |
| [公仓 #422](https://github.com/bonc-ai/cogseed/pull/422) | Scorecard 及 Windows 测试修复经私仓回流、重新同步和当前 head 全部必需 CI 后合并。案例用于说明验证顺序，实际 main CI、Scorecard 分析和上传结果仍应逐次记录。 |

## 七、私仓接收记录模板

把以下记录放在对应私仓 PR 描述或私有审核记录中；填完整 SHA 和运行链接，不只写“已绿”。
未完成项明确写“待验证”，不要用提交、合并或截图代替尚未完成的运行证据。

```text
公仓 PR / 作者：
接受范围 / 原始业务提交 / 登记 headSha：
历史清洁基线与新增祖先审查：
作者、DCO、Source-PR 核验：
私仓导入 PR / contributions.json / 公开文件分类：
本地验证及尚未覆盖的平台：
晋升路径（整树 / B.0 定向）/ cicd 基线 / develop 来源 / 逐文件白名单与隔离证据：
cicd 晋升 PR / 固定源码 SHA / 候选树核对：
同 SHA 最新 push CI / compliance 运行链接与结果：
公仓待合并 head / 当前必需 CI：
正式 CODEOWNER 审批 / reviewDecision / 合并方法：
公仓合并 SHA / 原始 head 祖先关系：
历史归属修复时的合并前后 tree：
同步 workflow / 两阶段结果 / 公仓快照 PR（如需要）：
最终 main SHA / 同 SHA 最新 Public CI push 结果：
Scorecard 分析与 SARIF 上传结果（如涉及）：
贡献者 Git 历史 / contributor 页面显示状态：
未完成项 / 所需人工审批 / 是否另有发布授权：
```
