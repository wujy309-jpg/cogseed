# Data Model: S4 智能体 / 技能页面改版

本期不新增持久化数据；只读取并组合现有数据。新增的只有一个依赖状态原因 `user_disabled`。

## 平台内容项（界面视图）

| 字段 | 来源 | 说明 |
|---|---|---|
| id、kind（agent / skill） | 市场目录行或本机安装记录 | 同 id 以本机安装为准 |
| name、category、version、description | 同上 | — |
| icon、color | 智能体 `agent.json` / 目录行 `avatar` | 技能用首字头像 |
| tags、examples、does | 内容字段（可缺） | 缺示例时用通用示例（FR-026） |
| installed | 本机安装记录存在 | 含 `seed_source: builtin`、`default_install`，界面不区分 |
| updateAvailable | `_mpInstallStatus` | 目录版本 / 时间新于本机 |
| enabled | 停用名单（`component-enabled.json`） | — |
| hubStatus | 平台状态（正常 / 停用 / 下架） | — |
| dependency（智能体） | `dependency_state` | 见下 |

**状态转换**：未安装 →（安装中）→ 已安装 →（停用 ⇄ 启用）→（卸载）→ 未安装；已安装 →（更新中）→ 已安装（失败保留旧版）；安装失败 → 未安装（标「安装失败，可重试」）。

## 依赖状态（主进程，扩展）

```
AgentDependencyState = { status: 'ready' | 'deps_blocked' | 'deps_missing', ids, reasons? }
reason: 'disabled'（平台停用） | 'unsupported' | 'missing' | 'user_disabled'（新增：用户停用）
```

规则：有任一依赖为 `user_disabled` 时，状态为 `deps_blocked`，与平台停用一样禁用「使用」和示例；卡片与详情据 reason 显示「依赖已停用」及具体技能，详情可一键启用该技能，启用后回到 `ready`。

## 本机已有技能

| 字段 | 来源 |
|---|---|
| id、name、description | `skills.listOpen` |
| source | `external`（外部包）/ `global`（全局文件夹） |
| package_name、package_kind、package_enabled | 外部包注册表 |
| enabled | 停用名单 |

外部包以包为单位移除；全局文件夹受总开关 `global_skill_roots_enabled` 控制。

## 视图归属（不变量）

| 内容 | 首页 | 我的 | 已安装 |
|---|---|---|---|
| 主智能体、外接智能体 | ✓ | — | — |
| 平台内容 | ✓ | — | 已安装的 |
| 自建 | — | ✓ | — |
| 本机已有技能 | — | ✓（技能） | — |
| 系统内置技能 | — | — | — |
