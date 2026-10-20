# Implementation Plan: S4 智能体 / 技能页面改版（客户端侧）

**Branch**: 实施时从最新 `origin/develop` 新建（建议 `feat/s4-agent-skill-pages`）；规格目录 `specs/009-agent-skill-pages` | **Date**: 2026-10-19 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/009-agent-skill-pages/spec.md`

> 注：`setup-plan.sh` 因本机缺少 PyYAML 无法合成预设模板，本文按 `.specify/templates/plan-template.md` 加 `ai-product-method` 预设的 plan 附录手工生成；未安装任何依赖。

## Summary

把「智能体」「技能」两页改成：首页按「主智能体 / 外接 / 平台」展示所有能用的内容，平台内容不标来源、已安装在前；按钮「安装 / 使用」；统一详情弹窗；「已安装的…」集中停用 / 卸载 / 更新；「我的…」只放自己的东西（技能含本机已有）；停用技能时提示受影响的智能体。技术上以渲染层改造为主，复用 `marketplace.js` 的安装、卸载、更新与 `agents.js` 的使用流程；主进程只做两处小改：依赖状态增加「用户停用」原因、为全局技能文件夹开关补一对 IPC。

## Technical Context

**Language/Version**: 主进程 TypeScript（Electron）；渲染层原生 HTML / CSS / JavaScript（宪章 I）

**Primary Dependencies**: 现有 `src/renderer/modules/ui-*.js` 共享控件、`icons.js`、`marketplace.js`、`agents.js`、`skills.js`、`connectors.js`（弹窗参照）；不新增 npm 依赖

**Storage**: 无新增。读取 `installs.json`、`component-enabled.json`、外部包注册表、偏好 `global_skill_roots_enabled`

**Testing**: `npm run typecheck`、`npm test`（vitest，`test/renderer/`、`test/main/`）；原型交互基线 `prototype/check/flow.cjs`；真实客户端人工验证见 [quickstart.md](quickstart.md)

**Target Platform**: macOS、Windows 桌面客户端

**Project Type**: desktop-app（Electron）

**Performance Goals**: 首页先渲染本机内容，平台目录异步补齐；不因目录请求阻塞已安装内容显示

**Constraints**: IPC 只校验参数并调用 features（宪章 II）；新文案四语（宪章 IV）；可见控件改动遵循 `.agents/skills/cogseed-component-change/SKILL.md`；搜索忽略 IME 合成

**Scale/Scope**: 平台内容约 90 + 条（现有随包 32 智能体 + 58 技能，加 Hub 新增）；改动集中在 3 个渲染模块、2 个主进程模块、4 个语言文件、`index.html` 与 `style.css`

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 原则 | 结论 | 说明 |
|---|---|---|
| I 桌面运行边界 | ✅ | 不引入 HTTP 服务 / 打包器 / TS 到渲染层；新 IPC 走 `window.cogseed.invoke` 白名单 |
| II 分层与统一入口 | ✅ | 新 IPC 只校验并调 `config.ts`；依赖状态改动在 features 层；不绕过锁与安装入口（复用 `_mpInstall` → 主进程安装锁） |
| III 数据隔离与隐私 | ✅ | 只读写当前用户数据域现有文件；不新增遥测 |
| IV 共享界面与国际化 | ✅（需执行） | 详情弹窗、管理行、说明条的新样式要走组件变更技能并补真实页面集成覆盖；文案四语 |
| V 实际证据验证 | ✅（需执行） | 覆盖 UI-01～13；停用后不被调用要有运行时证据；双平台分别验证；检查 / 验收 / 上线分开陈述 |
| 工作流 | ✅ | specify → plan → tasks → analyze → implement；从最新 `origin/develop` 建分支，经 MR 合入 |

无违规，无需 Complexity Tracking。Phase 1 设计后复查：仍全部通过。

## Project Structure

### Documentation (this feature)

```text
specs/009-agent-skill-pages/
├── brief-v0.4.md        # 产品需求（可单独阅读）
├── spec.md              # Spec Kit 规格
├── design-spec.md       # 设计规格 v0.4（组件对照、代码落点）
├── plan.md              # 本文
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── contracts/ui-and-ipc.md
├── quickstart.md
├── checklists/requirements.md
├── prototype/           # 可点击原型 + check/ 交互检查
└── tasks.md             # $speckit-tasks 生成
```

### Source Code (repository root)

```text
src/renderer/
├── index.html                    # 智能体 / 技能面板工具栏与子视图容器（去掉「更多」、首页的创建与我的贡献）
├── style.css                     # 详情弹窗通用类（由原型 .ap-popup-* 合并）、已安装行、我的技能说明条
├── modules/
│   ├── agents.js                 # 首页三组、我的智能体、已安装的智能体、useAgent 接示例、停用依赖确认
│   ├── skills.js                 # 技能首页、我的技能（自建 + 本机已有，来源筛选、总开关、外部包移除）、已安装的技能
│   ├── marketplace.js            # 供两页调用：目录、安装（去掉将同时安装确认）、卸载、更新判定；平台卡片渲染
│   ├── catalog.js（新增）        # 懒加载：平台目录、已安装组合、统一详情弹窗、登录 / 断网状态
│   ├── skills-bindings.js        # 去掉首页「更多」「创建」绑定
│   ├── hub-contributions.js      # 「我的贡献」返回目标改为「我的」
│   └── utils.js                  # 来源归一（已有）
└── locales/{zh,en,ja,pt}.json    # 新文案

src/main/
├── features/agent_dependency_state.ts   # 新增 user_disabled 原因
├── features/config.ts                   # 已有 get/setGlobalSkillRootsEnabled
├── preload.js                           # 保持现有通用 window.cogseed.invoke 桥，无新增专用 API
└── ipc/index.ts                         # 新增 skills.getGlobalRootsEnabled / setGlobalRootsEnabled

test/
├── renderer/                     # 首页分组、按钮状态、已安装页、我的技能、停用依赖确认、弹窗操作
└── main/                         # dependency_state 的 user_disabled；新 IPC 参数校验
```

**Structure Decision**: 沿用现有单仓结构（主进程 `src/main`、渲染层 `src/renderer`）。平台目录、已安装视图帮助函数与统一详情弹窗收敛到 `catalog.js`，作为 `marketplace` 懒加载包的第二个脚本，排在 `marketplace.js` 后；智能体页、技能页先加载该包再渲染目录状态，避免在常驻首屏增加第二套安装逻辑。

## AI Product Implementation Addendum

### Model, data and tool boundaries

- 本期不涉及模型、提示词或 AI 工具权限的改动。唯一相关点是**停用名单对主智能体可用清单的影响**（已有机制，本期复用）；验证时需确认停用后新任务的「可用技能 / 可用智能体」清单里不再出现该项。
- 示例内容生成（S4-09）属于独立任务线，不在本计划。

### Evaluation contract

- 不适用模型评测；验收以 [contracts/ui-and-ipc.md](contracts/ui-and-ipc.md) 的 UI-01～13 与 spec SC-001～007 为准。阻断或报错的检查不计为通过。

### Rollback and change routing

- 本地回滚：功能分支整体回退即可；新增 IPC 与依赖原因字段向后兼容，回退不影响用户数据。
- 改变用户流程、权限或验收标准的发现回到 spec；产品定位变化回到 brief。

## Complexity Tracking

无。
