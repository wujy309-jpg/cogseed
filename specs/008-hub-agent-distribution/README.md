# Hub S3｜Agent 分发与贡献（客户端侧）

- [**点对点确认清单**](confirmation-checklist.md)：开工前和嘉宇、中扬逐条确认的 5 件事（含我的推荐与确认记录表）
- [功能规格](spec.md)（含评审结论、代码核实、种子场景、复用与缺口、待决策 D-01～D-14、组件对照表）
- [数据模型（草案）](data-model.md)
- [Client–Hub 接口契约（草案）](contracts/client-hub-interface.md)：含阻断点矩阵
- [共用契约工作方式（草案）](contracts/shared-contract-plan.md)：Agent 定义 + 两边接口怎么对齐、夹具清单、联合验收
- [Agent 接口提案（研讨用）](contracts/agent-api-proposal.md)：B-01~B-04 与 Skill 的 A-01/A-02/C-02 逐字段对照，附要问 Hub 的 7 个问题

- [Agent 定义 JSON Schema（草案 v0）](contracts/agent-package.schema.json) · [示例夹具](contracts/fixtures/agent-package/)：9 个，2 正例 7 反例
- [渲染进程与主进程落点（草案）](contracts/renderer-integration.md)
- [质量清单](checklists/requirements.md)
- [交互原型](prototype/prototype.html) · [单文件版（可直接发给别人）](prototype/prototype.standalone.html)

**状态**：Draft，客户端侧草案，2026-10-10 按客户端评审会结论更新。已对照 Hub 仓库现有的 Skill 契约；**Hub 目前没有任何 Agent 契约**，接口与字段需与 Hub 端联合确认后冻结（D-11）。**顺序：改原型 → 发群确认 → 先定 Agent schema → 再定 API → 分头开发。**未实现、未评审、未验收。

## 原型

直接打开 `prototype/prototype.html`（需在仓库检出内），或把 `prototype/prototype.standalone.html` 发给任何人双击打开。

顶部「原型导览」是评审用的跳转条，**真实客户端里没有**。它常驻 4 个主流程入口（智能体页、更多·Agent 市场、贡献预览、我的贡献），其余收在「更多场景」里。**各种情况都应该能从真实入口点出来**，不必依赖导览条：

| 想看的情况 | 在原型里这样点 |
|---|---|
| 正常安装、使用 | 智能体页「更多」→ 报销材料预检助手「安装」→ 确认安装 →「使用」 |
| Agent 声明了更高的最低客户端版本（`min_app_version`） | 市场里「会议纪要助手 Pro」，按钮是「需 CogSeed 1.4.0+」（禁用），点「详情」看原因 |
| 依赖已被 Hub 停用 | 市场里「发票归档助手」，按钮是「依赖已停用」；已装的「差旅报销材料整理」在智能体页卡片上也有同样的提示 |
| 发布物摘要不一致（拒绝安装） | 市场里「合同审阅助手」→ 安装 → 确认，下载后校验摘要失败 |
| 安全检查未完成 | 市场里「数据周报助手」→ 安装 → 确认 |
| 依赖下载失败并整体回滚 | 市场里「表格整理助手」→ 安装 → 确认，失败后点「重试」会成功 |
| 更新失败、保留旧版 | 安装「报销材料预检助手」→ 智能体页点它 → 详情里点「更新」→ 确认 |
| 贡献：同时贡献自建 Skill | 智能体页「报销材料整理助手」的「贡献」，预览里勾四项后提交 |
| 贡献：没有自建 Skill | 「周报整理助手」的「贡献」 |
| 贡献：私钥被拦 | 「客户邮件助手」的「贡献」 |
| 未登录点贡献 | 点侧栏左下账号条 →「退出登录」，再点任一自建 Agent 的「贡献」 |
| 我的贡献、退回重提、类型切换 | 工具栏「我的贡献」→ 选「差旅报销材料整理」→「修改并重提」；上方切换「智能体 / 技能」 |
| 响应丢失 | 只能从导览条「更多场景 → 响应丢失」进入（正常点击触发不了断网） |

也可用 `?v=<key>` 直达每个阶段：

| 阶段 | 直达 |
|---|---|
| 智能体页（自建卡片有「贡献」，工具栏有「我的贡献」「更多」） | `?v=agents` |
| 安装后的智能体页（平台区出现新装 Agent） | `?v=agents-installed` |
| 使用（示意输入输出） | `?v=task` |
| 已装详情 · 有更新 / 更新失败保留旧版 / 依赖已停用 | `?v=agent-detail` · `?v=update-fail` · `?v=deps-blocked` |
| 更多 · Agent 市场 / 市场详情 | `?v=market` · `?v=market-detail` |
| 需更新客户端 / 依赖已停用 / 摘要不一致 / 扫描不可用 | `?v=min-app-version` · `?v=hub-disabled` · `?v=tampered` · `?v=scan-unavailable` |
| 安装确认 / 依赖安装失败 | `?v=install` · `?v=install-fail` |
| 未登录点贡献 | `?v=guest-login` |
| 贡献预览（含「同时贡献的技能」确认）/ 私钥拦截 | `?v=contribute-preview` · `?v=contribute-blocked` |
| 提交中 / 响应丢失 | `?v=sending` · `?v=send-lost` |
| 我的贡献（Agent / Skill 类型切换）/ 退回重提 | `?v=mine` · `?v=resubmit` |

**重要说明**

- 原型的页面结构、样式与组件来自客户端真实文件：外壳对照 `src/renderer/index.html`（一级侧栏 → 「智能体 / 技能 / 连接」页 → 二级菜单 → 智能体页），样式按其顺序加载真实 CSS，控件来自 `ui*.js` 组件工厂。**本期只改「智能体」这一项内部，其余菜单保持现状，原型里点其他二级菜单只显示「本期不改动」。**
- 原型使用内存模拟数据，不接 IPC、账号、Hub 或真实扫描；刷新会重置。扫描结论、摘要、条款均为示意。
- **示意数据**：原型里所有 Hub Skill 的 ID 格式取真实的 12 位十六进制（如 `5e1c8a02d9b3`），但**都不是真实 ID**，须与 Hub 端确认真实公开 Skill（D-06）。**系统内置 Skill（如 `grounded-material-qa`）不作为依赖来源**：能否被 Agent 的 `skill_list` 引用未核实（D-10）。依赖来源只展示「Hub 分发」「Hub 分发 · 预置」「随 Agent 提交」三种。
- **「自建 Skill 随 Agent 提交」是评审会口头定的，与 Brief v0.1 §5 冲突，待中扬书面确认（D-07）**；原型按「提示并确认」演示。提交后是 Agent 私有包（现有机制）还是独立公开的 Skill **不默认等同**，原型界面上也写明「待产品确认」。
- **种子场景**为新的「报销材料预检助手」，不是现有内置的 Reimbursement Agent（`c045605cb916`）：后者是内置信任锚、`skill_list` 为空、依赖飞书凭据与仅 `darwin-arm64` 的可信组件。详见 spec「种子场景」。
- `prototype.standalone.html` 由 `prototype.html` + `app.html` 与客户端真实样式/脚本打包生成，约 1.7 MB，**请勿手改**；源文件变更后需重新生成。
- 原型展示不表示功能已实现、评审或验收；Brief §8 明确，原型演示不能单独代表 S3 完成。
