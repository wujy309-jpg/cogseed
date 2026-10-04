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

/** 统一的错误文案提取，避免每处都写一遍三元表达式。 */
const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * 状态轮询周期。两个平台都靠它保持 tooltip / 状态行新鲜：Windows 的 tooltip 悬停可见，
 * macOS 的托盘菜单不能惰性构建（点击即展开），两者都必须由定期刷新驱动。
 */
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
  /** 窗口刚被隐藏时调用：每个 BackgroundRun 实例只提示一次（index.ts 只在启动时创建一次，因此等价于每个应用会话一次）。仅 Windows 生效。 */
  notifyHidden(): void;
}

/** 状态行文案；null 表示"未知"，调用方不得显示任何一行（绝不显示会误导的 0）。 */
export function statusLabelFor(count: number | null): string | null {
  if (count === null || !Number.isFinite(count)) return null;
  if (count <= 0) return t('tray.status.idle');
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

  let icon: unknown = null;
  try {
    icon = deps.host.createIcon();
  } catch (err) {
    log.warn('tray icon creation failed; background run stays disabled', { error: errorMessage(err) });
    return noopRun();
  }
  if (!icon) {
    log.warn('tray icon unavailable; background run stays disabled');
    return noopRun();
  }

  let tray: unknown;
  try {
    tray = deps.host.createTray(icon);
  } catch (err) {
    log.warn('tray creation failed; background run stays disabled', {
      error: errorMessage(err),
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
  let seq = 0;
  let statusReadFailed = false;

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
    const ticket = ++seq;
    try {
      const next = await deps.getActiveTaskCount();
      if (ticket !== seq) return; // 有更新的读取在飞，丢弃这次结果
      activeTaskCount = (next === null || !Number.isFinite(next))
        ? null
        : Math.max(0, Math.trunc(next));
      statusReadFailed = false;
    } catch (err) {
      if (ticket !== seq) return;
      activeTaskCount = null; // 未知 → 隐藏状态行，不向用户暴露错误
      // 轮询每 5 s 会重试；只在"正常 → 失败"翻转时告警，避免持续失败刷爆日志。
      if (!statusReadFailed) {
        statusReadFailed = true;
        log.warn('tray status unavailable', { error: errorMessage(err) });
      }
    }
    paint();
  };

  // 构造期同样可能抛（setContextMenu / on(...) / startStatusRefresh 都是外部实现），
  // 任何一步失败都必须拆掉半成品托盘并降级——否则 index.ts 会以为托盘可用，
  // 进而把窗口藏到一个没有入口的进程里。
  let stopRefresh: () => void = () => { /* 尚未启动 */ };
  try {
    if (isMac) {
      // macOS：设置 contextMenu 后"点击即展开菜单"由系统接管，不绑单击呼出。
      deps.host.setMenu(tray, menu());
    } else {
      deps.host.onLeftClick(tray, () => { if (!stopped) deps.showMainWindow(); });
      // Windows：每次右键都重建菜单。计数由下面的轮询保持最新，因此这里能立刻拿到值。
      deps.host.onRightClick(tray, () => { if (stopped) return; deps.host.popUpMenu(tray, menu()); });
    }
    stopRefresh = deps.host.startStatusRefresh(() => { void refresh(); }, STATUS_REFRESH_MS);
  } catch (err) {
    log.warn('tray wiring failed; background run stays disabled', { error: errorMessage(err) });
    try { deps.host.destroy(tray); } catch { /* 拆不掉也不能让启动失败 */ }
    return noopRun();
  }

  // 两个平台都轮询：Windows 的 tooltip 是悬停可见的，不轮询就会永远停在启动时的值。
  // Windows 的右键菜单仍然每次重建，只是数据来自最近一次轮询结果。
  void refresh();

  const run: BackgroundRun = {
    isAvailable: () => true,
    stop(): void {
      if (stopped) return;
      stopped = true;
      try { stopRefresh(); } catch (err) { log.warn('tray refresh stop failed', { error: errorMessage(err) }); }
      try { deps.host.destroy(tray); } catch (err) { log.warn('tray destroy failed', { error: errorMessage(err) }); }
      if (active === run) active = null;
    },
    notifyHidden(): void {
      if (stopped || hinted) return;
      hinted = true;
      if (deps.platform !== 'win32') return; // macOS 没有气泡 API
      try {
        deps.host.displayBalloon(tray, t('tray.background_hint.title'), t('tray.background_hint.content'));
      } catch (err) {
        log.warn('tray balloon failed', { error: errorMessage(err) });
      }
    },
  };
  active = run;
  return run;
}
