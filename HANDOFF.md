# 交接说明 · 安全与信任模块（2026-10-08）

给下一个对话窗口。**先读这份，再读 `AGENTS.md`。**

范围：`安全与信任`（skill security）模块的 UI 重构 ×2 轮 + 安全能力的两个修复（P0 / P2）。
分支 `dev/wujy309-jpg`，HEAD `803e697a`，**全部改动未提交**。

---

## 0. 最重要的一件事：不要以为这是干净的树

工作区里同时躺着**两批未提交改动**：

```
git status --short
  M  41 个已跟踪文件被改动
  D   2 个文件被删除（resources/.../tests/conformance/v1.0.0/*）
  ?? 35 个未跟踪新文件
```

其中**既有 WIP**（不是我写的）约占绝大多数：整个 skill-sentry v2.2.0 引擎
（`agentic_rules.py` / `baseline.py` / `derived_views.py` / `hidden_content.py` / `mappings.py` /
`obfuscation.py` / `sarif.py` / `structural.py` / `supply_chain.py` / `rulesets/v1.1.0/` …）
+ v3 安全页 + main 侧 security feature。**本会话的改动叠在它之上。**

**两种改动混在同一批文件里**，最严重的是这几处：

| 文件 | 总 diff | 其中我的 | 状况 |
| --- | --- | --- | --- |
| `src/main/features/security/guardrail-status.ts` | 217 行 | ~25 行 | 大部分是 WIP |
| `resources/.../scanner_core/report.py` | 417 行 | ~12 行 | 大部分是 WIP |
| `resources/.../engine/capabilities.yaml` | 249 行 | ~60 行 | 混合 |
| `scanner_core/text_rules.py` | 183 行 | ~60 行 | 混合 |
| `src/main/ipc/index.ts` | 74 行 | ~6 行 | 大部分是 WIP |

**纯属我的改动**（diff 里只有我的）：

```
# 新建
src/main/features/skill_id.ts                                  110 行
test/main/features/security/skill-id.test.ts                   137 行
test/main/features/security/capability-classification.test.ts   71 行
scripts/repin-skill-sentry.mts                                  77 行
HANDOFF.md                                                      本文件
design/security-redesign/**                                     两版设计稿 + 工装 + 截图

# 编辑（diff 里只有我的）
src/renderer/modules/ui-structure.js      28+/2-   uiAccordion 扩展 tone/icon/statusHtml
src/renderer/ui-components.css             8+/0-   行式状态样式
src/renderer/component-gallery.js         27+/0-   新增「Accordion · 行式状态」样本
```

**建议**：动手前先请人类把既有 WIP 单独提交一次，否则 review 和回滚都无法按主题切分。
我没有跑过任何 git 写操作（无 add / commit / stash / checkout）。

---

## 1. 本会话完成了什么

### 轮次 A · 安全与信任页 UI 重构（两版设计稿 + 落地）

1. **审计**：发现两处违反仓库 UI 政策的实现——手写 `.sec-pill`（第二套状态色板 `ok|warn|bad|muted`，与共享 `uiStatusPill` 的 `success|attention|critical|neutral` 并存）；抽屉加载同时渲染固定 40% 的 `uiProgressBar` 与 `uiSkeleton`。
2. **v1 设计稿**（`design/security-redesign/`）：删重复数据、统一色板、表格 6→4 列。**被评审否决**——"太繁琐"。
3. **v2 设计稿**（`design/security-redesign/v2/`）：改走杀毒软件式状态页。**评审要求 hero 原样保留**，简化只作用于 hero 以下。
4. **落地到生产**：
   - 扩展共享 `uiAccordion`，新增 per-item `tone` / `icon` / `statusHtml`（此前**零生产消费者**，向后兼容）
   - 检测能力 / 组合风险 / 检查记录三个区块 → 三行可展开的「防护项」
   - `.sec-pill` 全部改用 `uiStatusPill`（页面内 0 残留）
   - 同一组数字不再渲染两遍（可见摘要行删除，只留分段控件 + 视觉隐藏副本）
   - 选择器从页面内联卡片 → **右侧共享 `uiDrawer`**（全高、搜索框固定、一屏 7+ 条 vs 原来 280px 约 5 条）
   - 新增 15+2 个 locale 键（zh/en/ja/pt **真译文**）

### 轮次 B · P0：外部技能从"能看见、扫不了"变成"能扫"

**问题**：`skills.list` 会把 Claude Code / Codex 技能列进选择器（id 形如 `claude:pdf-tools`），
但 `isValidSkillId` 只接受 12 位十六进制或字母开头名字，**冒号过不了** → 点「详情/检查」必抛
`invalid skill id`。你机器上 30 个外部技能，**30 个全是死按钮**。

**修法（关键：没有放宽 `isValidSkillId`）**：它被 9 处 IPC 当门禁，其中两处会**写盘**：

```
skills.security.accept / revoke  →  把 .skill-sentry-baseline.json 写进技能目录
                                    对外部技能 = 写进用户的 ~/.claude/skills/<name>/
```

所以新增独立的「可扫描」谓词，只放宽三处**只读**入口：

| 入口 | 结果 |
| --- | --- |
| `trust.reverify` / `security.report` / `security.acceptances` | 接纳外部 id |
| `security.accept` / `security.revoke` | **保持严格拒绝**，错误码 `external_skill_readonly` |

三个必须解决的技术点：
1. **穿防**：`claude:foo` → 文件名 `claude.foo`（`.` 在内部 id 里不可能出现 → 映射可证互斥、可逆）
2. **解码侧**：`listReceipts` 是**按文件名扫描**的，只有编码会让外部回执以 `claude.foo` 冒出来然后被丢掉 → 补 `fileStemToSkillId`
3. **单一来源**：外部技能根目录原在 `skills.ts` 定义、扫描器不知道 → 提取到零依赖叶子模块 `skill_id.ts`

顺带修掉一处真实宽松兜底：`isScannableSkillId` 在 `require('../skills')` 失败时回落
`[A-Za-z0-9_.:-]+`（**允许 `.` 和 `:`**），这就是"放行后在下游被 `safeId` 抛错"的路径。现改为严格。

**实证**（`/tmp/verify-*.mts`，见 §5）：
```
真实外部技能 30 个 | 不可扫描的：0
解析: /Users/wu.j.y/.claude/skills/brainstorming
扫描: ok=true 357ms outcome=pass score=94 findings=7 externalSkill=true
穿越攻击 claude:../evil / claude:a/b / ../../../etc/passwd -> 全部拒绝
扫描前后目录快照 9 条 → 9 条，文件列表/大小/mtime 全一致（扫描确实只读）
acceptFinding(external) -> {"ok":false,"error":"external_skill_readonly"}
```

### 轮次 C · P2：消掉开屏的"3 项降级"

**两层改动，缺一不可。**

**第一层 · 真补原生能力**：新增通用高熵密钥检测（`text_rules.py`），这是 gitleaks 相对内置规则的主要增量
——"名字不认识但看起来就是密钥"。判定链：凭据味变量名 × `shannon_entropy ≥ 3.5` × 长度 ≥ 16。
刻意做窄，四类放行：**摘要**（sha1/md5/sha256/384/512 十六进制）、**模板引用**（`${VAR}`/`process.env.X`）、
**占位符**、**单一字符类串**。置信度固定 `low`，几乎不参与扣分。

**第二层 · 分类诚实化**：把 `needs_tool` 从 `degraded` 里拆出来。

| 能力 | 之前 | 现在 | 理由 |
| --- | --- | --- | --- |
| `secret_detection` | `degraded` | **`implemented`** | 内置规则集**就是**交付物，gitleaks 只是扩大覆盖 |
| `dependency_vulnerability_scan` | `degraded` | **`needs_tool`** | 没有任何原生交付，`implemented: true` 是自相矛盾的声明 |
| `malware_signature_matching` | `partial` | `partial` | 原生指标表存在但覆盖是子集 —— 诚实 |

**效果**：`3 项降级 → 0 项降级`；标题行 `13 可用 · 3 项降级` → `14 可用 · 2 项需要注意`；
横幅 `以下能力处于降级状态：密钥检测、依赖漏洞扫描` → `以下能力需要安装额外工具才能启用：依赖漏洞扫描。安装后自动解锁，不影响其余检查。`，
且从琥珀色改为**中性灰**（`data-tone="info"`），读作信息而非告警。

---

## 2. 下一步：P1（组合风险图）

**优先级已由人类确定：P2 → P1，P2 已完成，P1 未开始。**

现状：`composition.ts` 已算出跨技能能力路径（`paths[].participants` + `capabilities`），
渲染层只把它画成**一段文字 + 几个 `uiTag`**。

要做的是把它变成图。**数据已经有了，不需要新的分析逻辑**——这是性价比最高的一处差异化，
因为竞品（见 §6）有图可视化的没有跨技能能力模型，有模型的没有图。

落点建议：
- 渲染层：`settings-security.js` 的 `compositionBodyHtml()`（组合风险行的行体）
- 不要把图画进主屏——它是行内展开后的内容
- 画布类图形按 `AGENTS.md` 属"业务专属图形画布"，可页面本地持有；但**先读**
  `docs/renderer-structural-registry.md` 判断是否需要登记
- `src/renderer/modules/icons.js` 提供图标；内联 SVG 会被 `shared-ui-adoption-guard.test.ts` 计数，
  数据可视化需登记到登记册的 "Known non-icon inline SVG" 一节（先例 `SEC-PV-001-SVG`）

---

## 3. 遗留待决（不要擅自决定）

1. **引擎 VERSION 仍是 `2.2.0`**，但行为已改（新增高熵检测器）。按理该升版本，但版本号关联发布语义，
   且可能牵动其他 pin 与测试。**我标出来而没有替你决定。**
2. **`SEC-PV-001` 仍是 `Proposed`**。只有 `@bonc-ai/reviewers` 能提升为 `Approved Provisional`。
3. **`uiSegmentedControl` 不携带 value**（两轮都没修）。它只在内部用 `value` 比较选中态，
   从不写进 DOM（`ui-segmented-control.js:39-40`），页面只能靠**本地化标签文本反查取值**
   （`filterValueFromLabel()`，两套词汇 9+ 个标签，兜底 `'all'`）。翻译碰撞会静默选错筛选器。
   修法在共享层加 `data-value`，属组件契约变更、会波及其他调用方。**这不是布局问题。**
4. **`malware_signature_matching` 仍是 `partial`**。扩充指标表是内容工作。
5. **声明未驱动运行时**：`capabilities.yaml` 自称"机器可读的唯一权威声明源"，但能力状态是
   `guardrail-status.ts` 里**硬编码**的。这次我不得不**手工**同步两处——那正是漂移的来源。
   真要让声明驱动，是一次独立重构（见 §4 第 3 条）。

---

## 4. 陷阱清单（踩过的，务必先看）

### 4.1 改引擎后**必须**重算完整性 pin

```bash
node_modules/.bin/tsx scripts/repin-skill-sentry.mts
```

`skill-sentry.INTEGRITY` 是**整棵树**的哈希。任何 `resources/guardrail/skill-sentry/` 内的编辑都会让它失配，
而后果**不是显示问题**：

```
scannerTrustedForLoad() -> { trusted: false }   when status === 'tampered'
```

→ 应用**拒绝加载扫描器** → 所有技能失去安全检查，状态页报"被篡改"。
pin 必须放在树**旁边**（`../skill-sentry.INTEGRITY`），放里面会改变它自己记录的哈希，永远对不上
（这个错误犯过一次，见 `scanner_trust.ts` 的 `PIN_FILE` 注释）。

### 4.2 外部技能 id 是 `claude:` / `codex:`，`isValidSkillId` **必须拒绝**它们

写入路径（`security.accept` / `revoke`）会把基线写进技能目录。放宽 `isValidSkillId` 等于让
用户自己的 `~/.claude/skills/<name>/` 变成可写目标。只读路径用 `isScannableSkillId`。
`test/main/features/security/skill-id.test.ts` 锁住这条边界。

### 4.3 `capabilities.yaml` 曾经不是合法 YAML

WIP 里 `report_fields: [findings[].context, ...]` 在 YAML 流式序列里非法（`[` `]` `,` 是保留指示符），
**18 行**。HEAD 版本是合法的。已修（改为带引号的流式序列）。
`yaml.safe_load` 是唯一能发现它的方式——**没有任何代码解析这个文件**。

### 4.4 工具与环境的坑

- **`web_search` 工具是坏的**（HTTP 401，搜索端点密钥无效）。人类可在
  **设置 → 插件 → 插件配置 → Web 搜索**改端点。**只能由人类改，不要自己设环境变量。**
  调研请改用 **GitHub Search API**（`api.github.com/search/repositories`，JSON、无需鉴权）。
- **不要用 Electron 截图**：`show: true` 的窗口即使放在 `x=-4000` 也会出现在 Dock、可能抢焦点，
  人类明确提过被打扰。用 headless Chrome：
  `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --no-sandbox --no-first-run --no-default-browser-check --disable-extensions --disable-background-networking --disable-sync --disable-default-apps --hide-scrollbars --user-data-dir=<临时目录> --screenshot=<out.png> --window-size=W,H <url>`
- **headless Chrome 写出截图后不会自行退出**，不要等 `close` 事件——轮询产物文件大小稳定后 `SIGKILL`。
- **`--dump-dom` 在 `--headless=new` 下会挂死**。页面高度改用「高窗口渲染 + 按底色裁掉底部空白」（Pillow）。
- **`data:` URL 有长度上限**，内联完整 locale（约 1.8MB）会在第二次导航时 `ERR_FAILED`。写临时文件 + `loadFile`。
- **`executeJavaScript` 会克隆脚本最后一条语句的求值结果**。`window.x = {...含函数...}` 会抛
  "An object could not be cloned"，统一追加可克隆尾值。
- **`ELECTRON_RUN_AS_NODE=1`** 在本机 shell 里是设着的，会让 Electron 退化成纯 Node。
- 在 tsx 脚本里用 `paths.ts` 前必须设 `COGSEED_WORKSPACE_ROOT`
  （`resolveInstallContainer('cogseed')`），且 **ESM 静态 import 会被提升**，必须用动态 `import()`。

### 4.5 别把夹具当证据

我一度拿渲染截图当 P2 的验证——**那是错的**：渲染脚本里的 `capabilities` 是硬编码夹具，不是
应用真实状态。真实验证必须调 `guardrailStatus()`。已改为从 `/tmp/real-status.json` 注入真实状态。

### 4.6 全量测试的"环境失败"可能是假的

先前有 6 个测试失败（`resource-grid-layout`、`core-agent/sandbox`、`local-tools`），我判定为
**嵌套沙箱**导致 Chromium 沙箱 / macOS `sandbox-exec` 起不来。后来 DSH 文件策略放宽为
`danger-full-access` 后，**它们全部通过**——证实了当时的判断。若再遇到，先看策略再改代码。

---

## 5. 验证命令与当前状态

```bash
npm run typecheck                       # ✓ 通过
npm test                                # ✓ 1110 文件 / 12906 测试，0 失败
node scripts/run-tests.mjs run test/main/features/security/     # ✓ 242 测试
node_modules/.bin/tsx scripts/repin-skill-sentry.mts            # 引擎改动后必跑

cd resources/guardrail/skill-sentry && python3 -m pytest tests/unit -q   # 引擎单测
```

**误报基线**：`test/main/features/security/sentry-adapter.test.ts` 的
「passes every shipped builtin skill without a risk verdict」——新检测器启用后仍然通过。
这是新增检测器**必须**守住的线。

**重启应用**（人类要求真机验证时）：
```bash
./scripts/restart-cogseed.sh
```
只停本 worktree；确认启动看 `/tmp/cogseed-cogseed-run.log` 与
`~/.cogseed/runtime-variants/cogseed/data/logs/<日期>.log`。日志里
`hub-account.me` / `updater ... ERR_CONNECTION_REFUSED` 是**既有的网络噪音**，与本模块无关。

**一次性验证脚本**（在 `/tmp`，可能随重启消失，需要就重新写）：
- `/tmp/verify-external.mts` — P0 端到端（枚举真实外部技能 → 解析 → 扫描 → 穿越负例）
- `/tmp/verify-readonly.mts` — 证明扫描外部技能**零写入**（扫描前后目录快照比对）
- `/tmp/check-capabilities.mts` — 打印真实能力分类
- `/tmp/render-real-page.mjs` — headless 渲染真实页面（依赖 `/tmp/real-status.json`）

---

## 6. 竞品调研结论（供 P1 及后续参考）

方法：**GitHub Search API**（`web_search` 坏了）。约 30 个仓库，2026 年 1–4 月集中出现。

| 项目 | ★ | 定位 |
| --- | --- | --- |
| [NVIDIA/SkillSpector](https://github.com/NVIDIA/SkillSpector) | 19.6k | Claude Code / Codex / MCP 技能，"装之前先扫"；有 `langgraph.json` + `model_registry.yaml` → **LLM 分析** |
| [Tencent/AI-Infra-Guard](https://github.com/Tencent/AI-Infra-Guard) | 6.8k | 全栈红队平台 |
| [snyk/agent-scan](https://github.com/snyk/agent-scan) | 3.1k | CLI + GitHub Action/App |
| [Pantheon-Security/medusa](https://github.com/Pantheon-Security/medusa) | 1.0k | 审 `.claude/` hooks / permissions / skills |
| [HeadyZhang/agent-audit](https://github.com/HeadyZhang/agent-audit) | 237 | 51 规则映射 OWASP Agentic Top 10，**污点分析** |
| [claude-world/claude-skill-antivirus](https://github.com/claude-world/claude-skill-antivirus) | 80 | 9 引擎，扫 **71K+ 技能语料** |
| [ryo-ebata/cc-audit](https://github.com/ryo-ebata/cc-audit) | 25 | "**AI-free**，确定性、可复现" |
| [suchithnarayan/ai-skill-scanner](https://github.com/suchithnarayan/ai-skill-scanner) | 15 | LLM + 污点 + CI/PR + **图可视化** |

**我们已经领先的**：跨技能组合风险（竞品全是单技能）、自身完整性校验、覆盖率诚实
（列出哪些能力降级、为什么、多少目录未解析）、风险接受的治理（理由+到期+高危不可接受）、反规避派生视图。
规则面 151 条文本模式 / 17 组 + secret patterns + hook/MCP 专属规则。

**差距与优先级**（P0、P2 已做）：
- **P1** 组合风险图（数据已有）
- **P4** LLM 辅助分析作为**第二意见**（进程内已有 agent 运行时；但 LLM 只加"疑似"标签，
  **绝不参与 pass/blocked 判定**，否则确定性和可审计性一起丢）
- **P5** 信誉/语料信号（Hub 侧服务端：已知恶意哈希、发布者身份、首次出现、安装量）
- **P6** 沙箱档位要么落地要么别显示（`scan_tier = "sandboxed" if isolated else "static"`，
  本机 `isolated: false`，UI 显示"静态扫描（未隔离）"）

---

## 7. 文件地图

```
HANDOFF.md                                   ← 本文件
scripts/repin-skill-sentry.mts               ← 引擎改动后必须跑

src/main/features/skill_id.ts                ← 新增：id 契约叶子模块（零依赖）
  · isValidSkillId        内部 id（十六进制/名字）—— 写入口用
  · isScannableSkillId    内部 + 外部 —— 只读入口用
  · skillIdToFileStem / fileStemToSkillId   回执文件名编解码
  · resolveIdUnderBase    路径包含检查
  · EXTERNAL_SKILL_ROOTS  外部技能根目录（唯一来源）

design/security-redesign/
  README.md            v1 设计说明（已被 v2 取代，保留追溯）
  v2/                  v2 设计稿 + 无窗口 headless 构建工装
  implemented/         实现后的真实渲染留档（7 张，含 P0/P2 证据）
  shots/               v1 截图
design/security-preview/   生产预览工装的产物（Electron 版，会弹窗）
```

**关键源码位置**：
- 页面：`src/renderer/modules/settings-security.js`（hero + 防护项行 + 选择器抽屉 + 详情抽屉）
- 行样式：`src/renderer/style.css` 搜 `.sec-rowbody` / `.sec-section-label` / `.sec-picker`
- 共享行组件：`src/renderer/modules/ui-structure.js` 的 `uiAccordion`
- 能力分类：`src/main/features/security/guardrail-status.ts`
- 引擎：`resources/guardrail/skill-sentry/engine/scanner_core/`
- 引擎声明（**权威但未驱动运行时**）：`resources/guardrail/skill-sentry/engine/capabilities.yaml`
- 结构登记册：`docs/renderer-structural-registry.md`（`SEC-PV-001`、`SEC-PV-001-SVG`）

---

## 8. 给下一个窗口的建议开场

> 读 `HANDOFF.md`。确认 §0 的未提交状态是否已由人类按主题提交。
> 然后做 §2 的 P1（组合风险图）。动手前先读
> `docs/renderer-structural-registry.md` 和 `.agents/skills/cogseed-component-change/SKILL.md`。
