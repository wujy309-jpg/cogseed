# 私有 Skill 随 Agent 打包：给 Hub 的说明与待答复项

- **收件人**：吴嘉宇（Hub）
- **发件人**：史雨萱（客户端）
- **日期**：2026-10-11
- **背景**：产品 2026-10-10 答复第 4 条要求本期支持私有 Skill 随 Agent 贡献；你的答复第三节写本期不随包。两份文字冲突，请先对一下先后，再看下面需要 Hub 评估的部分。

## 一、这是什么

用户自建、未单独发布的 Skill，在他贡献 Agent 时**和 Agent 打进同一个发布物**，一起提交、审核、发布。其他用户安装 Agent 时自动拿到，不要求贡献者先把这些 Skill 单独发布。

| 问题 | 约定（客户端提案） |
|---|---|
| 别人通过这个 Agent 能用吗 | 能 |
| 能单独用、出现在 Skill 列表吗 | 不能，不进用户的技能列表 |
| 别的 Agent 能引用吗 | 不能（沿用现有 `ownerAgent` 机制，别的 Agent 解析为未知） |
| 会进 Hub 的 Skill 市场、有独立 `content_id` 吗 | 不会 |
| 覆盖用户本机同名 Skill 吗 | 不会，装在该 Agent 名下 |
| 卸载 / 更新 Agent 时 | 一并移除 / 整体原子替换 |

这对应此前的 D-07 方案 A（Agent 私有包），**不是**方案 B（独立公开 Skill）。

## 二、包与校验（详见 `contracts/agent-api-proposal.md` v2 §4、§5）

```text
agent-package-v1
├── agent.json            作者原文（不含 version/created_at/updated_at）
├── _meta.json            Hub 发布时写入
├── README.md             可选
└── skills/<name>/...     私有 Skill；每个含 SKILL.md；<name> 不得是 12 位十六进制
```

- `agent.json` 的 `skill_list`：**恰为 12 位十六进制 = Hub Skill**（Hub 校验存在、已发布、未停用）；**其余名字形式必须对应包内 `skills/<name>/`**，否则拒绝。两类互斥，所以不会再出现同时命中两条 pattern 的问题。
- 每个私有 Skill 的 `ownerAgent` 必须指向本 Agent。
- 错误按你的第 12 条：接口级仍是 `PACKAGE_REJECTED`，原因放 `server_check.blocking[]`，域内码 `PRIVATE_SKILL_INVALID`（`rule` 例：`private_skill.owner`、`private_skill.name`）、`SKILL_REF_NOT_FOUND` 等。
- 一个摘要覆盖整个包，对应"篡改发布物拒绝安装"。

## 三、需要你答复的问题（按影响排序）

| # | 问题 | 为什么要你定 | 我的建议 |
|---|---|---|---|
| 1 | 产品第 4 条与你第三节谁在后？以哪个为准？ | 决定这件事做不做 | 以产品为准；你说过"需先与中扬确认"，请你们对一下 |
| 2 | **包上限**：Hub 现在文件 ≤ 200、解包 ≤ 10 MiB、压缩比 ≤ 100:1。私有 Skill 进包后够不够？对 Agent 是否放宽？ | 你指出先撑破的是 200 个文件 | 先按 Skill 现有上限，联调时用真实 Agent 量一下再定 |
| 3 | **随包 Skill 的安全检查**：a. 每个带 `references/security-manifest.yaml`，与社区 Skill 同标；b. Agent 级一份；c. 仅扫描脚本 | 产品要求纳入安全检查；a 最稳也最重 | a；请你与安全协作人定 |
| 4 | 审核时私有 Skill 怎么展示给运营？按 Agent 的一部分审，还是列出每个 Skill 的内容和检查结果？ | 影响 Hub 审核页 | 列出每个，运营一次审完整包 |
| 5 | 私有 Skill 没有独立 `content_id`，**停用治理**怎么处理？停用 Agent 即一并停用？ | 它不在 Skill 停用页里 | 随 Agent 整体停用，不单独治理 |
| 6 | 名称与目录名校验（含"目录名不得是 12 位十六进制"）由 Hub 复核吗？ | 避免和 `content_id` 混淆 | Hub 复核 |
| 7 | 工作量重估：私有 Skill 随包对 Hub 的新增工作 | 产品要求两端重估后再冻结接口 | 请给出估算 |

## 四、客户端会做的

- 提交前：本机检查私有 Skill（含最明显的密钥格式拦截）、预览、声明；点"贡献"时提示"这些 Skill 也会同时贡献"，同意才提交，一次确认。
- 安装时：确认框列出"将同时安装"的 Hub Skill 与随包 Skill，全部就绪才显示可用；任一失败整个 Agent 不记录，不影响其他 Agent 与在途任务。
- 本机落盘位置与同名冲突的具体处理，**实现前我再对着代码核实**，目前只确认 `ownerAgent` 机制存在。

## 五、相关材料

`Agent接口提案v2.md`、`Agent定义（schema）`、夹具 `pos-hub-and-private-skill.agent.json`（同时引用 Hub Skill 与私有 Skill）、可点击的原型（打开 `?v=bundled-skill` 看安装确认与"随 Agent 一起安装"分组）。
