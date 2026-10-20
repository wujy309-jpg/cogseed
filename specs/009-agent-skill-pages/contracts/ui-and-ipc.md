# Contracts: 界面行为与 IPC

## IPC（渲染层 → 主进程）

复用，不改签名：

| 通道 | 用途 |
|---|---|
| `agents.list` / `skills.list` | 本机智能体 / 技能（含已安装平台内容、自建、外接） |
| `skills.listOpen` | 本机已有技能（外部包、全局文件夹） |
| `marketplace.listAgents` / `listSkills` / `getListingsCache` / `categories` | 平台目录 |
| `marketplace.installAgent` / `installSkill` | 安装、更新 |
| `marketplace.uninstallAgent` / `uninstallSkill` | 卸载 |
| `marketplace.agentInstallPlan` | 依赖展示与阻断判定（不再用于确认弹窗） |
| `agents.setEnabled` / `skills.setEnabled` | 停用 / 启用 |
| `packages.action`（`command: 'remove'`） | 移除外部包 |
| `hub-account.status` | 登录态 |

新增（只校验参数、调用 `config.ts`，写后使技能缓存失效）：

| 通道 | 入参 | 返回 |
|---|---|---|
| `skills.getGlobalRootsEnabled` | — | `{ enabled: boolean }` |
| `skills.setGlobalRootsEnabled` | `{ enabled: boolean }`（非布尔则报错） | `{ ok: true, enabled }` |

扩展（字段新增，向后兼容）：`agents.list` 中 `dependency_state` 的依赖原因新增 `user_disabled`。

## 界面行为契约（验收用）

| 编号 | 触发 | 必须发生 | 不得发生 |
|---|---|---|---|
| UI-01 | 打开智能体页 | 三组顺序：主智能体 → 外接 → 平台；平台已安装在前 | 来源字样、「N 人在用」、自建卡片 |
| UI-02 | 点未安装卡片「安装」 | 「安装中…」→「使用」，提示已安装，「已安装 · N」+1 | 自动进入任务；「将同时安装」弹窗 |
| UI-03 | 未安装详情点示例 | 安装后进入新任务并发送该示例 | 安装失败时进入任务 |
| UI-04 | 安装失败 | 卡片保留「安装失败，可重试」，详情有原因与重试 | 卡片消失、已有内容受损 |
| UI-05 | 已安装页关开关 | 计数 -1，首页卡片「已停用」，新任务不调用 | — |
| UI-06 | 已安装页「⋯」→ 卸载 | 行消失，首页回到「安装」 | 卸载按钮直接露在每行 |
| UI-07 | 停用被引用的技能 | 先提示受影响智能体（说明将暂时不能使用），可取消；确认后智能体显示依赖已停用、「使用」与示例不可点，详情「启用 X」后恢复 | 静默停用；依赖停用后智能体仍可被使用 |
| UI-08 | 有新版本 | 卡片「有更新」，详情「更新」；失败保留旧版 | — |
| UI-09 | 我的技能关总开关 | 全局文件夹技能隐藏并说明 | 修改文件 |
| UI-10 | 移除外部包 | 先确认并说明带的技能数；确认后消失 | — |
| UI-11 | 断网 | 顶部提示 + 重试；平台只显示已安装 | 空白页、报错弹窗 |
| UI-12 | 未登录 | 本机内容照常；平台只显示已安装并提示登录；安装 / 贡献先提示登录 | 发起安装或提交 |
| UI-13 | 搜索输入中文 | 合成过程不触发过滤、不丢焦点 | — |
