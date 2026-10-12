# 安全与信任 · 重构设计稿

> **这是 experiment，不是生产实现。**
> 目录下所有内容都不参与打包、不被 `src/renderer/index.html` 加载、不改动任何生产文件。
> 按 `cogseed-component-change` skill 的分类，它属于 **Experiment**：探索一个视觉/交互方案，
> 供评审拍板后再落地。**没有** `@bonc-ai/reviewers` 的批准，不得据此声称页面已交付。

> ⚠️ **本目录（v1）已被 [`v2/`](v2/README.md) 取代。**
> v1 修掉了重复数据与合规问题，但信息架构仍是 dashboard，收到「太繁琐」的反馈。
> v2 改走杀毒软件式状态页：主屏只有状态 + 若干可展开行。
> v1 保留在此用于对比与追溯，不再继续迭代。

## 这是什么

用**真实的** `tokens.css`、`ui-components.css` 和**真实的**共享组件工厂（`window.ui*`）
渲染重构后的页面结构，再截图。所以截图里看到的按钮、状态胶囊、标签、分段控件、抽屉、
图标、骨架屏，全部是当前代码库里的真实组件，不是照着画的。设计稿只新增页面级布局 CSS。

## 怎么看

- **直接看**：`preview.html` 双击用浏览器打开即可，无需起服务。顶部有场景切换
  （拦截态 / 能力覆盖全部展开 / 组合风险发现路径 / 无扫描器构建 / 打开详情抽屉）。
  它用相对路径引用 `../../src/renderer` 下的真实 CSS 与共享组件脚本，并内联了
  locale 与夹具，所以离线可用。
- **看截图**：`shots/` 下 14 张，桌面（1180）与窄屏（760）各 7 张。
- **重新生成**：

```bash
env -u ELECTRON_RUN_AS_NODE node_modules/.bin/electron design/security-redesign/render-shots.cjs
```

输出 `shots/*.png` 并重建 `preview.html`。

> 两个环境坑，已写进工装注释：
> 1. 本机 shell 设了 `ELECTRON_RUN_AS_NODE=1`，不取消它 Electron 会退化成纯 Node，
>    `require('electron')` 返回 undefined。
> 2. 嵌套沙箱下 Chromium 进程沙箱起不来（SIGTRAP），工装已加 `--no-sandbox` / `--disable-gpu`。
>    另外 `executeJavaScript` 会克隆脚本最后一条语句的求值结果，赋值给含函数的对象会抛
>    "An object could not be cloned"，故统一追加可克隆尾值。

## 为什么改：原设计的六个具体问题

全部有据可查，不是审美偏好。

| # | 问题 | 证据 |
| --- | --- | --- |
| 1 | **同一组数字渲染两遍**：可见的文字摘要一行，紧接着一个内容完全相同的分段控件 | `settings-security.js` `statsHtml()`（`sec-stats-summary` + `uiSegmentedControl`） |
| 2 | **降级能力说两遍**：琥珀横幅列出「密钥检测、依赖漏洞扫描」，下方覆盖网格里再列一次 | `issuesHtml()` 的 `issue_degraded` + `coverageHtml()` 的 `sec-cap` |
| 3 | **来源信息与结论等权**：引擎版本、规则包、**规则条数 181**、完整性 5 个字段铺在 hero，换行后把描述挤成 4 行 | `heroHtml()` 的 `sec-hero-meta` |
| 4 | **注意力倒置**：16 格能力网格里 13 格是「可用」，真正要注意的 3 项排在第 14–16 格 | `coverageHtml()`；折叠态不存在 |
| 5 | **整块报警**：拦截态给 hero 套 2px 红边，满屏报警 | `style.css` `.sec-hero[data-kind="bad"]` |
| 6 | **空态撑出空洞**：组合风险空态是约 350px 的居中图标 + 三行说明 | `compositionHtml()` 的 `uiEmptyState kind="explained"` |

另外两处是审计已确认的合规问题，设计稿一并修掉：

| 问题 | 原实现 | 设计稿 |
| --- | --- | --- |
| **第二套状态色板** | 手写 `.sec-pill`，词汇 `ok｜warn｜bad｜muted`，3 处（表格、组合路径、发现项） | 全部 `uiStatusPill`，只用 `success｜attention｜critical｜neutral`。**5 处状态胶囊现在同一套契约** |
| **假确定性进度** | 抽屉加载同时渲染固定 `uiProgressBar value:40` 与 `uiSkeleton` | 只用 `uiSkeleton`（时长未知）。`uiProgressBar` 留给可度量进度 |

顺带清掉一个孤儿：`decisionTone()`（已映射到共享色调词汇）在生产页**零调用**——
共享化做了半途而废。设计稿让 `decisionTone` 成为唯一映射。

## 改了什么

1. **结论条**：左侧 3px 强调条承载严重级（不再整块红边）；主标题只剩一句结论
   （拦截态显示「1 个技能被拦截」）；来源信息折进「检查来源与完整性」disclosure；
   主行动按钮「查看被拦截的技能 →」直接跳到被拦截项。
2. **一条提示**：只保留能力账本表达不了的告警（扫描器缺失/被篡改）。降级项交回账本。
3. **能力覆盖注意力倒置**：默认只列需要注意的项并高亮，健康项折叠为「共 16 项能力 · 13 可用 · 3 项需要注意」。
   展开后仍把需要注意的排在前面。
4. **组合风险压扁**：空态从 350px 居中块变成一行虚线提示条。
5. **检测记录去重**：唯一控件是分段控件；为屏幕阅读器保留同一句话但视觉隐藏
   （尊重原作者「数字是信息、筛选是控件」的意图，只是不再视觉重复）。
   行操作从「详情 + 重新检查」两个文字按钮改为「详情」+ 一个 `uiIconButton`（共享缝，此前该页 0 使用）。
6. **抽屉**：3 条警告改为带色调与图标的内联列表（原来是连续正文段落）；
   发现项的标准编号与上下文折进「标准映射与上下文」——原来每张卡摊开 7 个标签并换行。

## 尚未解决 / 需要评审决定

- **`uiSegmentedControl` 不携带 value**。它只在内部用 `value` 比较选中态，从不写进 DOM
  （`ui-segmented-control.js:39-40`），所以页面只能靠**本地化标签文本反查取值**
  （`filterValueFromLabel()`，两套词汇 9+ 个标签，兜底 `'all'`）。翻译碰撞会静默选错筛选器。
  正确修法在共享层（加 `data-value`），属于**组件契约变更**，会波及其他调用方。
  **设计稿没有解决它**，因为它不是布局问题。
- **共享层缺内联 banner 缝**。`uiAlert` 是模态对话框，不是内联提示。设计稿的提示条保持
  页面本地组合（原生语义 + token 上色）。若第二个页面需要同样的内联提示，应提议共享缝。
- **`uiCard` 不适合这里**。它产出 `.ui-resource-card` 且带 `max-width: var(--card-width-max)`，
  是栅格卡片而非全宽页面区块。因此各区块仍是页面本地组合——这正是 `SEC-PV-001` 的边界。
- **新增文案没有 i18n 键**。`draft.js` 的 `DX` 对象是临时措辞（如「共 {total} 项能力 · …」）。
  落地时必须补 `settings.security.*` 键，否则违反 i18n 规则。
- **状态仍是 `Proposed`**。`SEC-PV-001` 目前只存在于未提交的工作区改动里，
  `Decision owner/date` = `@bonc-ai/reviewers, TBD`。按 skill 规定，未决条目必须**报告为 blocked**，
  不能拿现状当批准。

## 验证状态（分轨，勿混为一谈）

| 轨道 | 状态 |
| --- | --- |
| 产品契约 | **blocked** — `cogseed-product` 仓库在本机不存在，产品清单读不到 |
| 生产实现 | **未开始**（本目录不触碰生产文件） |
| 组件预览页 | **not run**（未改动共享组件） |
| 真实页面 | **blocked** — 需先落地实现并跑 `scripts/restart-cogseed.sh` |
| 验证档位 | reference spike — 仅渲染截图，未跑测试套件 |
| 交付 | 本地未提交 |

截图证明的是**这个设计长什么样**，不证明它可以合并、也不证明真实页面已经改了。
