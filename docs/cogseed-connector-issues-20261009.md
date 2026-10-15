# CogSeed 连接器问题清单（整理版）

- 日期：2026-10-09 ｜ 工作树：`/Users/sudai/Documents/CogSeed-OpenSource`（HEAD `fd45165b`，**未修改任何源码**，仅新增本文件）
- 方法：三方独立只读审计 + 真机验证（dev 实例 + CDP 驱动渲染层 + 自建 loopback MCP 端到端 + 对已部署 Hub 直接探活 + 用打包用户数据实算目录）
- 基线：`npm run test:js` → 102 文件 / 885 用例通过（7 skipped）；连接器子集测试全绿。**下列条目全部是既有绿灯测试覆盖不到的不变量。**
- 条目总数：**52**（P0 ×5、P1 ×17、P2 ×19、待确认 ×11）
- 状态标记：`✔实测` = 本人真机/命令复现过；`◆确证` = 代码或测试层面确证；`?待确认` = 需要额外证据

---

## 1. 速览

### 1.1 这台机器上「一张都连不上」的因果链

```
Hub 未部署 /connectors/oauth/* 桥（P0-1） ──► 21 个 OAuth 连接器全部无法授权
服务端 composio 目录客户端零实现（P0-4） ──► 9 个新目录连接器永不出现
Google 默认隐藏（P0-3）＋ 远程配置永不刷新（P0-2） ──► 7 个 Google 连接器无法被远程打开
代理型 stdio 连接器在打包运行时必失败（P0-5） ──► Bing/Google 类即使桥修好也连不上
                                    ↓
                   可见 15 张卡片 = 14 张 OAuth（全 404）+ 1 张 CLI（tmeet 未装，按钮还可点）
```

### 1.2 五条 P0 的定位与可修性

| 编号 | 问题 | 归属 | 客户端可否单独修 |
|---|---|---|---|
| CONN-P0-1 | 客户端调用的连接器 OAuth 桥在部署 Hub 上不存在（全部 nginx 404） | 服务端 / 契约 | ❌ |
| CONN-P0-4 | 服务端 `connectors.catalog`（composio，9 条）客户端零实现 | 客户端 + 产品决策 | ⚠️ 需先定契约 |
| CONN-P0-2 | 打包版 `await import('electron')` 抛错 → 远程配置永不刷新 | 客户端 | ✅ |
| CONN-P0-5 | 同根因 → 代理型 stdio 连接器子进程 require 即抛 → 必失败 | 客户端 | ✅（随 P0-2） |
| CONN-P0-3 | 7 个 Google 连接器默认隐藏且渲染层零解释 | 产品口径 + 客户端 | ⚠️ 需先定口径 |

### 1.3 环境事实快照

| 项 | 值 |
|---|---|
| 运行中的应用 | `/Applications/CogSeed.app` 1.2.0（release 通道，2026-09-24 构建） |
| 发布产物 Hub base | `https://cogseed-open.bonc.com.cn`（`app.asar/.build/build-info.json`） |
| Hub 现状 | 活着：`POST /marketplace/skills/list` = 200；`/marketplace/hub-content/events` = 400 校验错；`/api/v1/auth/refresh` = 400 校验错 |
| Hub 的连接器桥 | `/connectors/oauth/*` 全部 nginx 404（前缀未接入应用路由） |
| 打包端远程配置 | `fetched_at_ms` = 2026-08-18，**每次启动刷新都失败** |
| 打包端连接器实例 | 无（`no connectors to bootstrap`） |
| 目录下发结果 | 内建 22 条 → 仅 15 条可见（隐藏 7 个 Google） |
| 本机 `tmeet` | 未安装（`cli_missing`） |

---

## 2. 全量索引（52 条）

> 按根因簇排序；「批次」见第 4 节。

| ID | 一句话 | 级别 | 簇 | 批次 | 状态 |
|---|---|---|---|---|---|
| CONN-P0-2 | 打包版 `await import('electron')` 抛错 → 远程配置永不刷新 | P0 | A | 1 | ✔实测 |
| CONN-P0-5 | 同根因 → 代理型 stdio 连接器子进程 require 即抛 | P0 | A | 1 | ✔实测 |
| CONN-P0-1 | 连接器 OAuth 桥在部署 Hub 上全部 404 | P0 | B | 0 | ✔实测 |
| CONN-P0-4 | 服务端 composio 目录客户端零实现 | P0 | B | 0 | ◆确证 |
| CONN-P0-3 | 7 个 Google 连接器默认隐藏、无解释 | P0 | C | 0 | ✔实测 |
| CONN-P2-1 | `hidden` 连接器零兜底，页面无差别空态 | P2 | C | 4 | ◆确证 |
| CONN-P2-2 | `visible_disabled/unsupported` 卡片无原因行且按钮可点 | P2 | C | 4 | ✔实测 |
| CONN-P1-6 | `cli_missing` 卡片按钮仍可点（与自述矛盾） | P1 | C | 4 | ✔实测 |
| CONN-P1-2 | `gworker` 会话拿不到任何连接器 | P1 | D | 3 | ◆确证 |
| CONN-P1-3 | `## Connectors` 块与元工具不同源（提示词承诺不存在的工具） | P1 | D | 3 | ◆确证 |
| CONN-P1-11 | 零 action 连接器仍被宣传 | P1 | D | 3 | ◆确证 |
| CONN-P1-12 | `agent.enabled_connectors` 生产路径永不生效 | P1 | D | 3 | ◆确证 |
| CONN-P2-12 | 第二套 runtime 连接器栈绕过 enable/可用性/kind 门禁 | P2 | D | 6 | ◆确证 |
| CONN-P2-13 | 文档/测试漂移（`list_connectors`、平铺命名、死 mock） | P2 | D | 6 | ◆确证 |
| CONN-P1-4 | `call_connector_tool` 丢 `ctx.signal` → 中止无效 | P1 | E | 3 | ◆确证 |
| CONN-P1-7 | `install-confirm` 推送无 catch → 同意弹窗丢失 | P1 | E | 4 | ✔实测 |
| CONN-P1-9 | 3 个已注册 IPC 零调用（无取消入口/无子工具开关） | P1 | E | 4 | ◆确证 |
| CONN-P1-13 | `local_cli` 入口窗口内取消失效（返回 false 仍继续） | P1 | E | 2 | ◆确证 |
| CONN-P2-14 | `local_cli` 取消有延迟（POLL + exec 窗口） | P2 | E | 2 | ◆确证 |
| CONN-P2-15 | 超时口径不一：local_cli 5min vs OAuth 10min | P2 | E | 2 | ◆确证 |
| CONN-P2-17 | `flow_timeout` 不广播 → 用户零提示、无遥测 | P2 | E | 2 | ◆确证 |
| CONN-P1-15 | `refreshIfStale` 忽略 `force`（非 GitHub）→ 401 后重放死 token | P1 | F | 2 | ◆确证 |
| CONN-P1-16 | 刷新锁键分裂 + bundle 成员各自刷新 → 同一旋转 RT 互废 | P1 | F | 2 | ◆确证 |
| CONN-P1-17 | 同实例并发 connect 无串行化 → MCP 连接/子进程泄漏 | P1 | F | 2 | ◆确证 |
| CONN-P2-11 | MCP `call_tool` 超时硬编码 60s，长任务必失败 | P2 | F | 5 | ?待确认 |
| CONN-P2-16 | `connecting` 状态不被 verify 拾取（异常退出后不自愈） | P2 | F | 2 | ◆确证 |
| CONN-P1-1 | 旧数据行缺 `enabled_subtools`/`tools_cache` → 整轮模型调用崩 | P1 | G | 1 | ✔实测 |
| CONN-P2-9 | 旧本地 `connectors.json` 在开源构建永不迁移 → 升级后静默消失 | P2 | G | 5 | ◆确证 |
| CONN-P1-5 | MCP `isError:true` 被当成功结果 | P1 | H | 3 | ◆确证 |
| CONN-P1-10 | 模型可见错误未脱敏（10a）+ 非 text part 整段 base64 进上下文（10b） | P1 | H | 3 | ◆确证 |
| CONN-P1-8 | `connectors.verify` 每会话只跑一次 → 死连接长期绿灯 | P1 | I | 4 | ◆确证 |
| CONN-P2-3 | 同一份数据每次进入重建卡片 2 次 | P2 | I | 4 | ✔实测 |
| CONN-P2-4 | `⋯` 菜单浮层挂 body，重建后幽灵残留 | P2 | I | 4 | ◆确证 |
| CONN-P2-5 | 连接器页硬编码文案绕过 `t()`（ja 不可达、无 pt） | P2 | I | 4 | ◆确证 |
| CONN-P2-6 | `connectors.js` 自带第二套 uiButton 降级模板 + 重复 `escapeHtml` | P2 | I | 6 | ✔实测 |
| CONN-P2-7 | 结构登记不一致（代码称 Registered，登记表是 Proposed/TBD） | P2 | I | 6 | ◆确证 |
| CONN-P2-8 | `connections.js` touchpoints 分支重复两遍 | P2 | I | 6 | ◆确证 |
| CONN-P2-18 | 自定义 stdio 的 `env` 无黑名单且读盘不复校验 | P2 | J | 5 | ◆确证 |
| CONN-P2-19 | `*.localhost` 一律放行明文 http | P2 | J | 5 | ◆确证 |
| CONN-P1-14 | Windows `tmeet` 探测集合与 adapter 不一致 → 假阴性永久禁用 | P1 | K | 5 | ◆确证 |
| CONN-P2-10 | dev 与打包版都抢 `cogseed://` 归属，退出不注销 → 回调可能投错实例 | P2 | L | 5 | ◆确证 |
| CONN-Q-1 | 真实数据里是否真有缺字段的行（P1-1 触发前提） | Q | — | 7 | ?待确认 |
| CONN-Q-2 | 原始错误是否真会带出凭证（P1-10a 升级条件） | Q | — | 7 | ?待确认 |
| CONN-Q-3 | 并发瞬态失败拆连接是否影响另一路调用 | Q | — | 7 | ?待确认 |
| CONN-Q-4 | degraded 的 `status.message` 是否让缓存前缀逐轮失效 | Q | — | 7 | ?待确认 |
| CONN-Q-5 | recall/cognition 目录是否把未连接连接器带进模型 | Q | — | 7 | ?待确认 |
| CONN-Q-6 | 渲染层缓存跨身份回退（`currentUserId` 为空时共享 key） | Q | — | 7 | ?待确认 |
| CONN-Q-7 | `enabled_subtools` 语义在生产从未被写入 | Q | — | 7 | ?待确认 |
| CONN-Q-8 | detail 视图在目录缺失时标题降级为裸 id | Q | — | 7 | ?待确认 |
| CONN-Q-9 | OAuth 回调未校验 `body.provider` → 可能跨连接器错配 token | Q | — | 7 | ?待确认（mock 已复现） |
| CONN-Q-10 | 无签名 `status=cancelled` 深链可取消任意在途授权 | Q | — | 7 | ?待确认 |
| CONN-Q-11 | 双 `tmeet auth login` 并存 / 并发刷新同一 RT | Q | — | 7 | ?待确认 |

---

## 3. 按根因簇展开

### 簇 A — 打包运行时 `await import('electron')` 在 `tsx/esm` 下必抛（1 个根因，2 个后果）

**根因**：`bootstrap.cjs:112-113` 注册 `tsx/esm` 后，任何 `await import('electron')` 在 asar 内抛
`Expected a string, an ArrayBuffer, or a TypedArray to be returned for the "source" from the "load" hook but got null`。
开发态正常（dev 日志证明该 import 成功），**只影响打包产物**。

- **CONN-P0-2 远程配置永不刷新** ◆确证
  - 证据：`src/main/features/client_config.ts:412`（唯一入口 `src/main/index.ts:1490`）；异常发生在注册 `browser-window-focus`/`activate`/`resume` 监听之前 → 启动与回前台都不刷新
  - 影响：所有服务端开关（`google_connectors`、模型目录、更新策略、`connectors.catalog`）冻结在缓存值（本机 2026-08-18）
  - 修复：改静态 `import`/`require`；加「打包环境下 `client_config.start` 不得抛错」的契约测试
- **CONN-P0-5 代理型 stdio 连接器必失败** ✔实测
  - 链路：`src/main/util/proxy-dispatcher.ts:180` → `{kind:'unsupported'}`（`:170-182`）→ `src/main/features/connectors/mcp-client.ts:91` 写进子进程 env → `bin/proxy-bootstrap.cjs:15` require 时 throw → adapter 退出码 1
  - 受影响条目：`catalog-google.ts:63/81/99/117/135/153/171` + `catalog.ts:242`（bing）
  - 复现：`COGSEED_PROXY_MODE=unsupported COGSEED_PROXY_UNSUPPORTED=route_resolution_failed node bin/bing-webmaster-mcp-server.cjs` → `exit=1`
  - 影响：即使 Hub 桥修好，这批连接器仍连不上；错误发生在子进程 require 阶段，用户只看到「连接失败」
  - 修复：`proxy-dispatcher` 改静态导入或注入 resolver；`unsupported` 回落 `direct`。规避：`COGSEED_NO_AUTO_PROXY=1`

### 簇 B — 客户端 ↔ Hub 契约断裂（需要服务端/产品决策）

- **CONN-P0-1 连接器 OAuth 桥未部署** ✔实测
  - 客户端调用点：`oauth.ts:204`（start）、`:300`（exchange）、`:402`/`:443`（refresh）、`oauth-dcr.ts:283`（redirect_uri）、`:361`（dcr-exchange）
  - 探活：上述路径全部 `404 nginx`；`/api/connectors/oauth/github/start` 是应用级 `Route not found`，`/api/v1/...` 是 `NOT_FOUND` → 应用在场、前缀未部署
  - 放大器：无预检（`oauth.ts:230` 直接 `shell.openExternal`）+ 失败要等 10 分钟（`oauth.ts:41`）；真机 `start_oauth(github)` → `{started:true}` 后无任何错误
- **CONN-P0-4 服务端 composio 目录零实现** ◆确证
  - 服务端下发 9 条 `auth_mode:'composio'`（含 `requires_credits`/`usage_metering`）；`grep -ri composio src/` = 0；`AuthMode` 只有 3 种
  - 测试仍在 mock 已不存在的符号（`manager.test.ts:32`、`availability.test.ts:136`、`ipc/connectors.test.ts:70`）
  - `connectors.catalog`/`connectors.dcr_catalog` 在本仓无任何消费者

### 簇 C — 目录可见性与「不可用」表达

- **CONN-P0-3 7 个 Google 连接器默认隐藏** ✔实测
  - `client_config.ts:690-693` 默认 `disabled` + 缓存无 `google_connectors` 键 → `availability.ts:168` 直接丢弃；`ipc/connectors.ts:100`/`:106` 双过滤
  - 打包数据实算：22 → 15，hidden = `google-workspace, gmail, gcal, gdocs, gsheets, gtasks, gsearch-console`
- **CONN-P2-1 `hidden` 零兜底** ◆确证：`connectors.js:478-498` 只有通用 `connectors.empty`，无法区分「本机没有/远程关闭/配置拉取失败」
- **CONN-P2-2 `unsupported` 卡片** ✔实测：无原因行（`connectors.js:696-707`）且主按钮可点（`:671-672`）
- **CONN-P1-6 `cli_missing` 卡片按钮仍可点** ✔实测：`connectors.js:671-672`、`:748-752`，与 `catalog.ts:263-268` 自述矛盾；详情页 CTA 才是真禁用（`:1108-1115`）

### 簇 D — 会话 / 可见性门禁一致性（模型侧）

- **CONN-P1-2 `gworker` 拿不到连接器** ◆确证：门禁只认 `gconv|gmember|agent`（`runner.ts:1387-1395`），而 `gworker` 是真实 kind（`state.ts:362-364`），实测该会话有 36 个工具含 `bash` 却零连接器入口
- **CONN-P1-3 块与工具不同源** ◆确证：块按 exposure 注入（`runner.ts:986-990`），元工具被 `effectiveToolAllowlist` 剔除（`:1028-1040`）→ `gmember + read-only` 时块在、工具无，而 `chat_agent_in_group.md:115` 命令模型去调它
- **CONN-P1-11 零 action 仍被宣传** ◆确证：`enabled_subtools: []`/空 `tools_cache` 的实例仍进块（`tools-adapter.ts:89-100`、`connector-meta-tools.ts:103-108`）
- **CONN-P1-12 `enabled_connectors` 永不生效** ◆确证：`runner.ts:983-999` 硬编码 `blockAgentId = undefined`；渲染层无写入点
- **CONN-P2-12 第二套 runtime 栈旁路** ◆确证：`kernel/tools/runner.ts:113-144` + `cogseed_backend/connector-manager.ts`，参数名/返回形状与主链不一致，策略硬编码 `connectors:'enabled'`（本构建不可达）
- **CONN-P2-13 文档/测试漂移** ◆确证：`tools-adapter.ts:9-11` 宣称存在 `list_connectors`；`types.ts:96-98` 仍写平铺命名

### 簇 E — 中止 / 取消 / 超时链路不完整

- **CONN-P1-4 丢 `ctx.signal`** ◆确证：`connector-meta-tools.ts:209`/`:259`；同仓 file/office/bash 工具都传了（`file-tools.ts:560`、`office-tools.ts:158`）→ 「停止」后写类 action 仍可能落地
- **CONN-P1-13 `local_cli` 入口取消失效** ◆确证：`_pending` 到 `local-cli-auth.ts:156` 才赋值，取消只读 `_pending`（`:69-74`）→ 返回 `cancelled:false` 仍 `start_login` + 打开浏览器
- **CONN-P2-14 取消延迟** ◆确证：只在 `_sleep(POLL)` 与 `_checkLogin` 之后检查（`local-cli-auth.ts:177-188`），上限 ≈ POLL 2s + callTool 60s / adapter 30s
- **CONN-P2-15 超时口径不一** ◆确证：local_cli 5min（`local-cli-auth.ts:41`）vs OAuth 10min（`oauth.ts:41`），注释却称一致
- **CONN-P2-17 `flow_timeout` 不广播** ◆确证：`manager.ts:983-988` 直接 return（对照 `:990-997`），用户零提示、无遥测
- **CONN-P1-9 三个 IPC 零调用** ◆确证：`ipc/connectors.ts:139-146`/`:193-206`/`:208-217`；`cancel_oauth` 全仓仅 1 处定义、0 调用点，而 `oauth.ts:184-185` 注释声称已接 UI
- **CONN-P1-7 `install-confirm` 无 catch** ✔实测：`connectors.js:1822-1826`、`:1833-1862`；`install_confirm.ts:80-90` 10 分钟后判拒绝

### 簇 F — grant / 连接生命周期与并发

- **CONN-P1-15 `force` 刷新是空操作** ◆确证：`oauth.ts:385-398` 只有 GitHub 分支读 `force`；`manager.ts:655-659` 注释明说 forcing → 401 后重放死 token，直接 `status:error`
- **CONN-P1-16 刷新锁键分裂** ◆确证：`manager.ts:393`（`${instId}:force`）vs `:513`（`instId`）；bundle 成员各持 grant 深拷贝独立刷新（`:930-939`）→ 旋转 RT 互废（Notion DCR / GitHub `ghr_`）
- **CONN-P1-17 并发 connect 泄漏** ◆确证：`manager.ts:615-628`、`:1209-1225`（per-id 锁只在 `callTool`）、`:1310-1315`（`shutdownAll` 只关当前值）→ 面板 verify 与模型调用重叠时泄漏一条 MCP 子进程
- **CONN-P2-16 `connecting` 不被 verify 拾取** ◆确证：`manager.ts:710-713`、`:1020-1056`、`:1109-1123`（正常失败路径会落 `status:error`，不卡死）
- **CONN-P2-11 MCP 调用 60s 硬超时** ?待确认：`mcp-client.ts:55`、`:170-181`；`manager.callTool` 不传 `timeoutMs`（需产品口径）

### 簇 G — 数据形状与迁移健壮性

- **CONN-P1-1 缺字段 → 整轮模型调用崩** ✔实测
  - 证据：`tools-adapter.ts:94-97`；反序列化不补默认值 `registry.ts:120-155`/`:197-212`；`listInstances` 只归一化 `status`（`manager.ts:798-825`）；迁移原样搬迁（`migrate-connectors-to-cloud.ts:80-92`）
  - 复现：缺 `enabled_subtools` 的行 → `TypeError: Cannot read properties of undefined (reading 'includes')` at `tools-adapter.ts:97`
  - 修复：`Array.isArray` 兜底 + 加载期归一化 + 一次性补字段迁移
- **CONN-P2-9 旧本地文件永不迁移** ◆确证：`_oauthUserId()` 恒 `null`（`migrate-connectors-to-cloud.ts:34-36`、`:60-65`），registry 只读 `cloud/config/connectors.json` → 老用户升级后连接器静默消失（本机无该文件，属升级场景风险）

### 簇 H — 错误语义与信息卫生

- **CONN-P1-5 `isError` 丢失** ◆确证：`connector-meta-tools.ts:258-268`；`stringifyMcpResult` 也不看（`tools-adapter.ts:36-50`）
- **CONN-P1-10a 原始错误进模型** ◆确证：`connector-meta-tools.ts:262-267`、degraded 行 `:86-88`；仓库日志侧本来有 `util/log-redact.ts` 与 URL origin+pathname 约定（`mcp-client.ts:110-112`）
- **CONN-P1-10b base64 灌上下文** ◆确证：文档说丢弃 image/resource，实际 `JSON.stringify(raw)`（`tools-adapter.ts:41-47`），实测 200KB 全量进入；测试把该行为固化（`connector-meta-tools.test.ts:623-630`）

### 簇 I — 渲染层体验与结构债

- **CONN-P1-8 verify 每会话一次** ◆确证：`connections.js:137`、`:160-178`；唯一调用点 `:165` → 死连接长期绿灯
- **CONN-P2-3 每次进入重建两次** ✔实测：`connectors.js:189-190`、`:211-214`、`:234-238`；实测 6 行目录产生 12 个卡片节点
- **CONN-P2-4 幽灵浮层** ◆确证：菜单挂 `document.body`（`connectors.js:810`）vs 网格清空（`:569`/`:573`）
- **CONN-P2-5 硬编码文案** ◆确证：`connectors.js:340-355`（zh/ja/en 字面串，ja 分支不可达、无 pt）
- **CONN-P2-6 第二套原语模板** ✔实测：`connectors.js:31-44` 占满 guard 基线（`shared-ui-adoption-guard.test.ts:32`）；`escapeHtml` 与 `utils.js:75` 重复（`connectors.js:1786`）
- **CONN-P2-7 结构登记不一致** ◆确证：`connectors.js:977-978` 自称 Registered vs `docs/renderer-structural-registry.md:69-83`/`:107` 为 Proposed/TBD；卡片 `⋯` 弹层未登记
- **CONN-P2-8 touchpoints 分支重复** ◆确证：`connections.js:262-277` 与 `:297-311`

### 簇 J — 安全加固

- **CONN-P2-18 stdio `env` 无黑名单** ◆确证：`custom-transport.ts:98-114`（`NODE_OPTIONS`/`PATH`/`ELECTRON_RUN_AS_NODE`/`LD_*`/`DYLD_*` 可写入），读盘后不再复校验（`manager.ts:521-527`、`registry.ts:120-155`）→ 该 transport 成为可无限重放的执行规格
- **CONN-P2-19 `*.localhost` 放行明文 http** ◆确证：`custom-transport.ts:55-59`（低危；`[::ffff:127.0.0.1]` 反而被正确拒绝）

### 簇 K — 平台差异

- **CONN-P1-14 Windows `tmeet` 探测不一致** ◆确证：availability 只扫 PATH（`availability.ts:65-67`、`:80-105`）vs adapter 额外探测 `%APPDATA%\npm`（`bin/tencent-meeting-mcp-server.cjs:88-91`）；drift-pin 测试看不到该差异（`tencent-local-cli-connector.test.ts:150-174`）→ CLI 已装仍永久 `cli_missing`

### 簇 L — 运维 / 环境

- **CONN-P2-10 深链协议归属冲突** ◆确证：dev 与打包版都是 `protocolOwner: true` 且调用 `setAsDefaultProtocolClient('cogseed')`（`protocol.ts:79-96`、`brand.ts:66-71`/`:100-109`），退出不注销 → 两实例并存时回调可能投错实例（日志 `connector callback arrived with no pending flow`），流程空等 10 分钟

---

## 4. 修复批次（建议）

| 批次 | 内容 | 依赖 | 验证方式 |
|---|---|---|---|
| **0 决策** | CONN-P0-1（补旧桥 vs 改新契约）、CONN-P0-4（是否实现 composio）、CONN-P0-3（OSS 是否默认关 Google） | 服务端/产品口径 | — |
| **1 客户端根因** | **CONN-P0-2 + CONN-P0-5**（同一处 `await import('electron')`）、**CONN-P1-1**（形状兜底） | 无 | 打包启动日志不再有 load-hook 错；远程配置 `fetched_at` 更新；缺字段行不再抛错 |
| **2 连接可靠性** | CONN-P1-13、P1-15、P1-16、P1-17、P2-14、P2-15、P2-16、P2-17 | 批次 1（打包运行时可跑） | 取消立即生效；401 后真发刷新请求；并发 connect 无泄漏 |
| **3 模型侧语义一致性** | CONN-P1-2、P1-3、P1-4、P1-5、P1-10、P1-11、P1-12 | 可独立 | 会话 kind × 权限矩阵测试；中止可取消；`isError` 透传 |
| **4 渲染层** | CONN-P1-6、P1-7、P1-8、P1-9、P2-1、P2-2、P2-3、P2-4、P2-5 | 可独立 | 组件级 + 真页面集成测试；禁用态与失败原因可见 |
| **5 加固/平台/迁移** | CONN-P1-14、P2-9、P2-10、P2-11、P2-18、P2-19 | 需产品口径（P2-11） | Windows 探测单测；迁移契约测试 |
| **6 清理与契约对齐** | CONN-P2-6、P2-7、P2-8、P2-12、P2-13 | 可独立 | guard 基线下降；登记表更新；死 mock 清理 |
| **7 验证类** | CONN-Q-1 ~ Q-11（先取证再定级） | — | 见下表 |

---

## 5. 待确认清单（先取证，别当缺陷修）

| ID | 待确认项 | 需要的证据 |
|---|---|---|
| CONN-Q-1 | 真实数据里是否真有缺 `enabled_subtools`/`tools_cache` 的行 | 历史版本引入时间，或扫一遍真实容器 `connectors.json` |
| CONN-Q-2 | 原始错误是否真会带出凭证（P1-10a 升级条件） | 一个会回显请求头/URL 的 MCP 端点或网关错误样例 |
| CONN-Q-3 | 并发瞬态失败拆连接是否让另一路「connection closed」 | 两 actor 并发 + 注入一次瞬态失败 |
| CONN-Q-4 | degraded 的 `status.message` 是否让 prompt 前缀逐轮失效 | 一次 degraded 连接器的两轮真实调用，对比 system 前缀与缓存命中 |
| CONN-Q-5 | recall/cognition 目录是否把未连接连接器带进模型（`source-catalog.ts:431-446`） | 确认 kstar episode/evidence 文本是否进模型上下文 |
| CONN-Q-6 | 渲染层缓存跨身份回退（缓存含 `account_label`） | 构造 `user.init` 失败场景 |
| CONN-Q-7 | `enabled_subtools` 生产从未被写入（只有 main 侧实现） | 确认是 UI 未接线还是设计上不由用户配置 |
| CONN-Q-8 | detail 视图目录缺失时标题降级为裸 id | 由 `connectors:authorization-url` 推送打开详情的实际表现 |
| CONN-Q-9 | **OAuth 回调未校验 `body.provider`**（`oauth.ts:313-352`）→ 跨连接器 token 错配 | 真机「先开 A 卡 → 再开 B 卡 → 最后完成 A 的浏览器页」；mock 已复现（slack 流程 resolve 出 bing token） |
| CONN-Q-10 | 无签名 `status=cancelled` 深链可取消任意在途授权（`oauth.ts:285-295`） | 浏览器实测自定义 scheme 是否需要用户手势 |
| CONN-Q-11 | 双 `tmeet auth login` 并存 / 并发刷新同一 RT | 真 CLI、真 Notion/GitHub 账号 + 并发窗口，观察 `bad_refresh_token`/`invalid_grant` |

---

## 6. 已确认「正常」的面（不要重复排查）

- **自定义 MCP 连接器端到端可用**：`add_custom → spawn → initialize → tools/list → tools/call` 全通；落盘加密、移除与 `source-removal` 记账正常（真机实测）。
- **模型侧 umbrella 无旁路**：不存在把 MCP action 平铺进 SDK `tools[]` 的路径；`## Connectors` + 两个元工具 + `add_custom_connector` 是唯一入口（块与调用实测生效，负例 `E_CONNECTOR_NOT_VISIBLE`/`E_TOOL_NOT_AVAILABLE` 正确）。
- **可见性主链正确**：停用开关、`connected/degraded` 过滤、remote Google 开关、auth-session 工具黑名单、Google Workspace 去重、结果截断咽喉点（`capToolResult`）。
- **缺 CLI 确实不会 spawn**：三道闸一致（catalog → 渲染层 → `beginOAuthConnect` assert）；adapter 子进程 PATH 与探测同源，macOS 不存在「探测通过却 ENOENT」（唯一反向不一致是 Windows，见 CONN-P1-14）。
- **stdio 超时回收正常**（超时后 0 存活）；streamable-http 超时无 unhandled rejection。
- **MCP 连接健壮性**：`_onDemandConnectLocks` 合并并发连接；`secrets_enc` 覆盖 grant/dcr_client/transport（0600 + AES-256-GCM）；DCR 的 state 校验、PKCE S256、RFC 8707 `resource`、refresh 尊重 force 均正常。
- **IPC 通道名**渲染层↔主进程无反向不一致（问题是「已注册未被调用」）；**i18n key** 在 zh/en/ja/pt 全存在（问题只是硬编码文案）；**图标**全走 `icons.js`，目录品牌章有 DOMPurify 清洗。
- **日志与渲染层密钥卫生**：`mcp-client.ts:96-112` 只打 basename/argCount/URL origin+pathname；`ipc/connectors.ts:54-95` 剥离全部凭据字段。

---

## 7. 证据与可复跑命令

```bash
# 1) 测试基线
npm run test:js                       # 102 files / 885 passed / 7 skipped

# 2) Hub 探活：连接器桥 vs 市场接口
curl -s -o /dev/null -w '%{http_code}\n' \
  https://cogseed-open.bonc.com.cn/connectors/oauth/github/start          # → 404 (nginx)
curl -s -X POST -H 'Content-Type: application/json' -d '{}' \
  https://cogseed-open.bonc.com.cn/marketplace/skills/list | head -c 80   # → {"code":0,...}

# 3) 打包环境目录核算（真实用户数据 + 真实模块）
#    22 条目录 → 15 条可见；7 个 Google hidden；google_connectors 键缺失

# 4) 旧数据行崩溃复现
#    缺 enabled_subtools 的行 → TypeError at tools-adapter.ts:97

# 5) 模型侧端到端（自建 loopback MCP）
#    add_custom → refresh(tools=[probe_echo]) → getConnectorPromptBlock 含该连接器
#    → list_connector_tools 返回 schema → call_connector_tool 返回 "echo:hello-from-probe"

# 6) 代理环（CONN-P0-5）
COGSEED_PROXY_MODE=unsupported COGSEED_PROXY_UNSUPPORTED=route_resolution_failed \
  node bin/bing-webmaster-mcp-server.cjs     # → exit=1，throw at bin/proxy-bootstrap.cjs:15

# 7) 连接器子集测试
npm test -- run test/main/features/connectors/   # 连接器相关全绿（缺陷均无既有覆盖）
```

临时脚本（均在 `/tmp`，未进仓库）：`probe-connector-visible.cjs`、`probe-packaged-catalog.cjs`、`probe-legacy-row.cjs`、`cogseed-probe-mcp.cjs`、`cdp-eval.cjs`、`cdp-connectors.cjs`、`cogseed-audit/`（8 个只读复现用例 + 若干探针）。
