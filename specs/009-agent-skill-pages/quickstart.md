# Quickstart: 验证 S4 智能体 / 技能页面改版

## 前置

- 从最新 `origin/develop` 建功能分支；**不提交** `run.sh`、`src/main/index.ts`、`test/main/util/runtime-launcher.test.ts` 三个本地改动。
- 可用的测试 Hub（23 号恢复后）与测试账号；一个已有随包内容的老用户数据目录、一个全新用户。

## 自动检查

```bash
npm run typecheck
```

```bash
npm test
```

```bash
node specs/009-agent-skill-pages/prototype/check/flow.cjs
```

最后一条只是原型交互基线，不代表客户端完成。

## 手工验证（真实客户端，macOS 与 Windows 各一遍）

按 [contracts/ui-and-ipc.md](contracts/ui-and-ipc.md) 的 UI-01 ～ UI-13 逐条走，记录结果：

1. 老用户：打开智能体页、技能页，核对分组、排序与「已安装 · N」包含原随包内容（UI-01）；记录从打开页面到开始使用一个已安装智能体的点击次数（≤2），从未安装到使用（≤3）（SC-001）。
2. 安装一个未安装智能体（带依赖技能），核对不弹「将同时安装」、不跳转（UI-02）；再对另一个在详情点示例（UI-03）。
3. 断网后安装，核对失败与重试（UI-04）；断网打开首页（UI-11）。
4. 已安装页停用、卸载各一次（UI-05、UI-06）；卸载一个随包技能后重启，确认没有被装回（research R-06 风险）。
5. 停用一个被智能体引用的技能（UI-07）。
6. 让 Hub 发布一个新版本，核对更新（UI-08）。
7. 我的技能：总开关、移除外部包（UI-09、UI-10）。
8. 退出登录后打开两个页面（UI-12）。
9. 停用后发起新任务，确认主智能体不调用被停用的内容（spec SC-006）。

检查通过、人工验收、上线分别记录，不能互相替代（宪章 V）。
