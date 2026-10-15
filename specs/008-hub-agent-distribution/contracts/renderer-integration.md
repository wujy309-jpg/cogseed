# Contract: Renderer Integration（草案）

> 据 2026-10-10 评审会与真实客户端代码更新。约束来自 `AGENTS.md`：渲染进程为原生 HTML/CSS/JS，仅经 `window.cogseed.{invoke, stream}` 访问主进程；IPC 处理函数只做参数校验并调用 feature，不含业务逻辑；`src/main/preload.js` 保持 `.js`；新增 npm 依赖需先讨论。**本期只改「智能体」这一项内部，其余菜单与页面不动（AG-FR-070）。**
>
> 以下位置按基线 `origin/develop` `5491969e` 核对；实现前须在 Plan 阶段对照最新代码再确认。

## 真实页面落点（已核对存在）

| 表面 | 现有落点 | 本期要做 |
|---|---|---|
| 一级侧栏、「智能体 / 技能 / 连接」页、二级菜单 | `src/renderer/index.html`：`.sidebar`；`#panel-connections` 的 `.connections-tabs`（智能体 / MCP与工具 / 技能 / 资料库 / IM） | **不改** |
| 智能体页 | `index.html` `#panel-agents`；卡片渲染 `modules/agents.js::renderAgentsGrid`（`.agent-card.ui-resource-card`） | 工具栏加「我的贡献」按钮；自建卡片加「贡献」按钮；平台卡片加依赖状态 chip；停用等在卡片与详情内 |
| 「更多」市场 | `index.html` `#panel-marketplace`、`modules/marketplace.js`（Agents Tab 已存在，含安装/更新/卸载/已停用/需 CogSeed x.y+ 等状态） | 详情页补依赖清单、安装前确认、安全校验结果 |
| 贡献页 / 我的贡献页 | `modules/hub-contributions.js` + `hub-contributions.css`（Skill 贡献整页已在用） | 增加 Agent 贡献页；「我的贡献」加类型切换（智能体 / 技能）；入口按钮照 `hub-contributions.js` 把「我的贡献」插到「更多」之前的做法 |
| 自建 Skill 的「贡献」按钮 | `modules/skills.js`（`data-skill-contribute`） | Agent 卡片照此做 |
| Agent 定义与卡片数据 | `src/main/features/agents.ts`（`Agent`）、`modules/agents.js::renderAgentsGrid` | 判断哪些字段可分发（见 `data-model.md` §1）；平台卡片上的「社区贡献」「依赖已停用」「有更新」目前真实代码里没有，需新增 |

## 主进程落点（建议）

| 能力 | 建议位置 | 备注 |
|---|---|---|
| Agent 提交打包、本机处理、预览、随 Agent 提交的自建 Skill | `src/main/features/contribution/` 下扩展（现有 15 个文件均无 Agent 逻辑） | 业务逻辑放 feature，不放 IPC |
| Agent 依赖校验与安装确认 | `src/main/features/marketplace.ts` 既有 Agent 安装流程旁扩展 | 保留「依赖失败则整体失败」语义 |
| 预置内容清单 | 是否需要单独清单待 D-02/D-10；预置内容的清单现有来源是 `resources/builtin/_manifest.json` 的 `inventory`（8 系统 Skill、31 Agent、58 Skill） | 预置内容本来是 Hub 内容，未核实 Hub 是否已有全部预置 ID |
| IPC 通道 | `src/main/ipc/contribution.ts` 扩展 | 仅校验+转发 |

## 实现时的一个已验证坑

智能体卡片上盖着全卡片大小的 `.agent-card-open` 覆盖层（`style.css`：`position:absolute; inset:0; z-index:1`），真实 CSS 只给 `.agent-card-actions > .agent-card-use` 抬高了层级（`z-index:2`）。新加的「贡献」按钮若不同样抬高，会被覆盖层盖住而点不了（原型里复现并已修）。实现时给 `.agent-card-contribute` 加 `position: relative; z-index: 2`，或并入同一条规则。

## 共享 UI 契约

- 登录提示、条款/授权、预览、状态徽标与 Skill 贡献保持一致，避免两套交互。
- 文案进入 locales，支持中英文（AG-FR-060）。
- 「贡献」是一个按钮、一次确认；有自建 Skill 时，确认放在预览页声明区，不另起流程。

## 合并后核对（来自 AGENTS.md）

把 `develop` 合入功能分支后，须重新核对 renderer↔main IPC 契约并运行 `npm run typecheck`；仓库曾因合并悄悄丢过 IPC 通道。

## 本阶段分类

本文档与原型为**规格与交互示意**：原型使用内存模拟数据，不接 IPC、账号与 Hub；原型的页面结构、样式与组件来自客户端真实文件，但**不代表客户端功能已实现**。
