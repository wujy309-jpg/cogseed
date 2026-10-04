/**
 * 托盘常驻与后台运行（Windows 任务栏 / macOS 菜单栏）。
 *
 * 这个模块**不 import electron**：托盘、菜单、图标全部通过 `TrayHost`
 * 注入，因此可在 vitest 的 node 环境完整单测（与 task_notifications.ts
 * 的 `createNotification` 注入同构）。真实 Electron 实现由 index.ts 提供。
 */

export interface ClosePolicyInput {
  isQuitting: boolean;
  closeToTray: boolean;
  /** 托盘真的建起来了吗？没建起来就绝不能隐藏窗口。 */
  trayAvailable: boolean;
}

/**
 * 关闭按钮是否应该只隐藏窗口。
 *
 * 三个条件缺一不可：
 * - `isQuitting`：由 index.ts 在 `before-quit` 里置位——它是托盘退出、Cmd+Q、
 *   `updates.install`、系统关机四条路径的共同上游。若在安装流程里也返回 true，
 *   `app.quit()` 会被窗口的 preventDefault 中止，分离助手 `bin/apply-update.cjs`
 *   等不到父进程退出（60 s 超时）→ 安装会静默失败。
 * - `closeToTray`：用户偏好。
 * - `trayAvailable`：托盘创建失败时必须放行关闭，否则窗口被隐藏、又没有任何
 *   入口能把它叫回来。
 */
export function shouldHideOnClose(input: ClosePolicyInput): boolean {
  return !input.isQuitting && input.closeToTray && input.trayAvailable;
}
