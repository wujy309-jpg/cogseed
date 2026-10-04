/**
 * 托盘常驻与后台运行（Windows 任务栏 / macOS 菜单栏）。
 *
 * 这个模块**不 import electron**：托盘、菜单、图标全部通过 `TrayHost`
 * 注入，因此可在 vitest 的 node 环境完整单测（与 task_notifications.ts
 * 的 `createNotification` 注入同构）。真实 Electron 实现由 index.ts 提供。
 */
import { createLogger } from '../logger';
import { t } from '../i18n';

const log = createLogger('background_run');

/** darwin 的托盘菜单不能惰性构建（点击即展开），后台驻留期间按这个周期刷新。 */
export const STATUS_REFRESH_MS = 5_000;

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
 *   `updates.install` 三条路径的共同上游（Windows 关机不走 `app.quit()`，另由
 *   `session-end` 兜底）。若在安装流程里也返回 true，
 *   `app.quit()` 会被窗口的 preventDefault 中止，分离助手 `bin/apply-update.cjs`
 *   等不到父进程退出（60 s 超时）→ 安装会静默失败。
 * - `closeToTray`：用户偏好。
 * - `trayAvailable`：托盘创建失败时必须放行关闭，否则窗口被隐藏、又没有任何
 *   入口能把它叫回来。
 */
export function shouldHideOnClose(input: ClosePolicyInput): boolean {
  return !input.isQuitting && input.closeToTray && input.trayAvailable;
}

export interface TrayMenuItemSpec {
  id: 'show' | 'status' | 'quit';
  label: string;
  enabled: boolean;
  click?: () => void;
}

export interface TrayHost {
  /** 图标不可用（文件缺失/解码失败）时返回 null。 */
  createIcon(): unknown | null;
  /** 创建失败可以抛错；模块会降级为"没有托盘"。 */
  createTray(icon: unknown): unknown;
  setToolTip(tray: unknown, text: string): void;
  setMenu(tray: unknown, items: TrayMenuItemSpec[]): void;
  popUpMenu(tray: unknown, items: TrayMenuItemSpec[]): void;
  onLeftClick(tray: unknown, listener: () => void): void;
  onRightClick(tray: unknown, listener: () => void): void;
  displayBalloon(tray: unknown, title: string, content: string): void;
  destroy(tray: unknown): void;
  /** 返回停止函数。实现必须 `unref()`，不得阻止进程退出。 */
  startStatusRefresh(flush: () => void, intervalMs: number): () => void;
}

export interface BackgroundRunDeps {
  host: TrayHost;
  platform: NodeJS.Platform;
  showMainWindow(): void;
  requestQuit(): void;
  /** null = 未知 → 状态行整行隐藏，绝不显示错误。 */
  getActiveTaskCount(): Promise<number | null>;
}

export interface BackgroundRun {
  /** 托盘是否真的可用；false 时 index.ts 必须放行关闭（见 shouldHideOnClose）。 */
  isAvailable(): boolean;
  /** 销毁托盘并停表；幂等。 */
  stop(): void;
  /** 窗口刚被隐藏时调用：每个应用会话只提示一次（仅 Windows）。 */
  notifyHidden(): void;
}

/** 状态行文案；null 表示"未知"，调用方不得显示任何一行。 */
export function statusLabelFor(count: number | null): string | null {
  if (count === null) return null;
  if (!Number.isFinite(count) || count <= 0) return t('tray.status.idle');
  return t('tray.status.running', { count: String(Math.trunc(count)) });
}

export function buildMenuItems(input: {
  statusLabel: string | null;
  onShow(): void;
  onQuit(): void;
}): TrayMenuItemSpec[] {
  const items: TrayMenuItemSpec[] = [
    { id: 'show', label: t('tray.show_window'), enabled: true, click: input.onShow },
  ];
  // 只读状态行：`enabled:false` 让它不可点，只作为信息展示。
  if (input.statusLabel) {
    items.push({ id: 'status', label: input.statusLabel, enabled: false });
  }
  items.push({ id: 'quit', label: t('tray.quit'), enabled: true, click: input.onQuit });
  return items;
}

function noopRun(): BackgroundRun {
  return {
    isAvailable: () => false,
    stop() { /* 没有托盘可销毁 */ },
    notifyHidden() { /* 没有托盘可提示 */ },
  };
}

/** 最近的实例；重复 start 时先拆掉旧的（幂等）。 */
let active: BackgroundRun | null = null;

export function startBackgroundRun(deps: BackgroundRunDeps): BackgroundRun {
  if (active) { active.stop(); active = null; }

  const icon = deps.host.createIcon();
  if (!icon) {
    log.warn('tray icon unavailable; background run stays disabled');
    return noopRun();
  }

  let tray: unknown;
  try {
    tray = deps.host.createTray(icon);
  } catch (err) {
    log.warn('tray creation failed; background run stays disabled', {
      error: err instanceof Error ? err.message : String(err),
    });
    return noopRun();
  }
  if (!tray) {
    log.warn('tray creation returned nothing; background run stays disabled');
    return noopRun();
  }

  const isMac = deps.platform === 'darwin';
  let activeTaskCount: number | null = null;
  let hinted = false;
  let stopped = false;

  const menu = (): TrayMenuItemSpec[] => buildMenuItems({
    statusLabel: statusLabelFor(activeTaskCount),
    onShow: () => deps.showMainWindow(),
    onQuit: () => deps.requestQuit(),
  });

  const paint = (): void => {
    if (stopped) return;
    const status = statusLabelFor(activeTaskCount);
    deps.host.setToolTip(tray, status ? t('tray.tooltip_with_status', { status }) : t('tray.tooltip'));
    if (isMac) deps.host.setMenu(tray, menu());
  };

  const refresh = async (): Promise<void> => {
    if (stopped) return;
    try {
      const next = await deps.getActiveTaskCount();
      activeTaskCount = next === null ? null : Math.max(0, Math.trunc(next));
    } catch (err) {
      activeTaskCount = null; // 未知 → 隐藏状态行，不向用户暴露错误
      log.warn('tray status unavailable', { error: err instanceof Error ? err.message : String(err) });
    }
    paint();
  };

  if (isMac) {
    // macOS：设置 contextMenu 后"点击即展开菜单"由系统接管，不绑单击呼出。
    deps.host.setMenu(tray, menu());
  } else {
    deps.host.onLeftClick(tray, () => deps.showMainWindow());
    // Windows：每次右键都重新构建菜单，拿到的计数必然是最新的。
    deps.host.onRightClick(tray, () => deps.host.popUpMenu(tray, menu()));
  }

  void refresh();
  const stopRefresh = isMac
    ? deps.host.startStatusRefresh(() => { void refresh(); }, STATUS_REFRESH_MS)
    : () => { /* win32 用右键重建菜单替代轮询 */ };

  const run: BackgroundRun = {
    isAvailable: () => true,
    stop(): void {
      if (stopped) return;
      stopped = true;
      stopRefresh();
      deps.host.destroy(tray);
      if (active === run) active = null;
    },
    notifyHidden(): void {
      if (stopped || hinted) return;
      hinted = true;
      if (deps.platform !== 'win32') return; // macOS 没有气泡 API
      deps.host.displayBalloon(tray, t('tray.background_hint.title'), t('tray.background_hint.content'));
    },
  };
  active = run;
  return run;
}
