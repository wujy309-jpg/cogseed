# S4｜智能体 / 技能页面改版（客户端侧）

- [功能规格（Spec Kit）](spec.md)：用户故事、功能需求、成功标准，供 plan / tasks 使用
- [实施计划](plan.md) · [调研](research.md) · [数据模型](data-model.md) · [界面与 IPC 契约](contracts/ui-and-ipc.md) · [验证指南](quickstart.md) · [任务清单](tasks.md)（50 个任务）· [实施记录](implementation-notes.md)
- [设计规格 v0.4](design-spec.md)：规则 R1–R10、组件对照表、落到客户端的改动清单（含代码位置）、待决策（原 spec.md，2026-10-19 改名保留）
- [需求 Brief v0.4](brief-v0.4.md)：产品侧需求文本（来源：2026-10-15 会议、2026-10-18 会议 #2、代码调研）；上一版 [v0.3](brief-v0.3.md) 保留备查
- [会议 #2 交接](handoff-meeting2.md)：会议结论、被推翻的旧决策、调研问题
- [交互原型](prototype/prototype.html) · [单文件版（可直接发给别人）](prototype/prototype.standalone.html)

**状态**（2026-10-20）：功能实现已完成，分支 `feat/s4-agent-skill-pages` 已同步到 `origin/develop`（`071eefe42f5b`）；正在提交与发起草稿 MR。

- 检查通过：T045 真实页面集成覆盖已补；`npm run typecheck` 通过；S4 定向测试 798 个通过、3 个跳过，仅 1 个上游 IPC 注册表守卫失败；弹窗焦点修复后的最小回归 10/10 通过。详细命令、既有失败和全量测试情况见 [implementation-notes.md](implementation-notes.md)。
- 人工验收：macOS 真实客户端已完成只读烟测，覆盖智能体首页、我的智能体、创建 / 外接弹窗、技能首页、我的技能、已安装技能和弹窗关闭后的焦点回归；未执行会改变用户数据的安装 / 卸载 / 启停场景，Windows 也尚未验收，因此 T048 保持未完成。
- 上线：实现可进入评审，但 T047 仍未关闭（全量 `npm test` 暴露多项上游 / 沙箱环境失败，且进程未自行退出），T048 双平台验收未完成；结构登记 `S4-PV-001` 仍为 `Proposed`，需 `@bonc-ai/reviewers` 审批。
- 已定：平台内容统一走 Hub（原随包内容 = 已安装，D-11 关闭）；页面分工（R1）；按钮「安装 / 使用」，卡片安装不跳转、去掉「将同时安装」确认（R9、D-02）；本机已有技能在「我的技能」（D-09）；停用被引用的技能先提示，依赖停用的智能体不可用（D-12，与 S3 一致）。
- 待定：统计口径（D-08）、Hub 头像编辑（D-10）、历史内容的示例 / 能做什么（S4-09，AI 一次性生成 + 人工审核）。主智能体自动派发时照常派发但不带已停用技能，已经定案并按现状验证。

## 原型

直接打开 `prototype/prototype.html`（需在仓库检出内），或把 `prototype/prototype.standalone.html` 发给任何人双击打开。
单文件版由 `node specs/009-agent-skill-pages/prototype/build-standalone.cjs` 生成，源文件变更后需重新生成。

顶部「原型导览」是评审用的跳转条，**真实客户端里没有**。

| 想看的情况 | 在原型里这样点 | 直达 |
|---|---|---|
| 智能体首页（主智能体 / 外接智能体 / 平台） | 默认第一屏 | `?v=agents` |
| 详情弹窗（已取到本机） | 点任一卡片 | `?v=agent-detail` |
| 详情弹窗（未安装 / 已安装（迁移来的）/ 已停用 / 自建 / 外接） | 首页点未取到的卡片；点「合规审阅员」；点「项目材料审阅」；「我的」里点自建卡片；点 Codex | `?v=detail-uninstalled` · `?v=detail-builtin` · `?v=detail-disabled` · `?v=detail-own` · `?v=detail-external` |
| 安装 → 使用（「安装」→ 安装中 → 变「使用」）；详情里点示例 = 安装后直接发送 | 首页点「报销助手」等卡片的「安装」，或在其详情里点示例 | — |
| 安装失败后重试 | 导览条「更多场景 → 安装失败」，点「安装」，再点「重试」 | `?v=install-fail` |
| 我的智能体（只有自建）/ 我的技能（一个网格：自定义 + 本机已有，按来源筛选），自建可贡献 | 工具栏「我的智能体 · N」 | `?v=agents-mine` · `?v=skills-mine` |
| 我的贡献（照客户端现有页面：汇总 / 类型与状态筛选 / 搜索 / 列表 + 详情） | 「我的智能体」页工具栏「我的贡献」 | `?v=contributions` · `?v=skills-contributions` |
| 已安装的智能体 / 技能（原「管理」；只放从平台安装的：停用 / 卸载） | 工具栏最右「已安装的智能体 · N」 | `?v=agents-manage` · `?v=skills-manage`（空） |
| 有更新 / 更新失败 | 首页点「周报助手」（卡片标「有更新」）→ 详情「更新到 v1.1.0」 | `?v=update` · `?v=update-fail` |
| 停用有依赖的技能 | 技能页 →「已安装的技能」→ 关掉「文档摘要」的开关（先弹出会受影响的智能体） | `?v=disable-dep` |
| 依赖已停用 | 停用「文档摘要」后回智能体页，点「会议纪要助手」 | `?v=dep-off` |
| 未登录（及退出 / 重新登录） | 点左下角账号「退出登录」，或导览条「未登录」 | `?v=logged-out` |
| 创建智能体（创建 / 外接） | 「我的智能体」页工具栏「+ 创建」（首页不放） | `?v=create` |
| 技能页（只有平台） | 点「技能」标签 | `?v=skills` |
| 首页加载中 / 获取失败 / 平台暂无更多 | 导览条「更多场景」 | `?v=loading` · `?v=offline` · `?v=empty` |

## 检查

原型交互保留命令行假 DOM 检查（真实客户端验收结果见 implementation notes）：

```bash
node specs/009-agent-skill-pages/prototype/check/flow.cjs
```

`check/harness.cjs` 用仓库已有的 `htmlparser2` 解析 `app.html`，在 `node:vm` 里加载客户端真实 `ui-*.js` 与 `app.js`；`check/flow.cjs` 覆盖首页三组、安装 / 使用、点示例一步安装并发送、已安装页、我的（含本机已有技能的总开关与外部包移除）、贡献、我的贡献页、创建、技能页、加载 / 断网 / 安装失败 / 空态，以及全部直达链接无报错。

**重要说明**

- 页面结构、样式与组件来自客户端真实文件：外壳对照 `src/renderer/index.html`，样式按其真实顺序加载 `src/renderer/*.css`，控件来自 `src/renderer/modules/ui-*.js` 工厂；卡片使用真实的 `agent-card` / `marketplace-card` / `skill-card`、分组使用真实的 `agents-source-section` / `skills-source-section`，「贡献」使用真实的 `agent-card-contribute` / `skill-card-contribute`。
- 只有 `ap-*` 开头的少量样式是原型新增（详情弹窗、示例行、创建表单、已安装页的行、首页顶部提示、平台卡片停用态），见 spec 的组件对照表，需设计评审。
- 原型使用内存模拟数据，不接 IPC、账号、Hub；刷新会重置。名称、版本、标签、示例均为**示意**，须与 Hub 端确认真实字段。
- 「使用」之后进入的新任务页、「管理」进入的编辑工作台、「我的贡献」页，沿用现有页面，原型里只用提示表示。
