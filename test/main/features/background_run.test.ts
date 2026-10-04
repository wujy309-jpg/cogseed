import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/main/i18n', () => ({
  t: (key: string, vars?: Record<string, string>) => (vars ? `${key}:${JSON.stringify(vars)}` : key),
}));

vi.mock('../../../src/main/logger', () => ({
  createLogger: () => ({ warn: vi.fn(), info: vi.fn() }),
}));

import {
  shouldHideOnClose,
  startBackgroundRun,
  statusLabelFor,
  buildMenuItems,
  STATUS_REFRESH_MS,
} from '../../../src/main/features/background_run';
import type {
  BackgroundRunDeps,
  TrayHost,
  TrayMenuItemSpec,
} from '../../../src/main/features/background_run';

const base = { isQuitting: false, closeToTray: true, trayAvailable: true };

describe('shouldHideOnClose', () => {
  it('hides when the preference is on, the tray is live and the app is not quitting', () => {
    expect(shouldHideOnClose(base)).toBe(true);
  });

  it('lets the close through while quitting, even with the preference on', () => {
    expect(shouldHideOnClose({ ...base, isQuitting: true })).toBe(false);
  });

  it('lets the close through when the preference is off', () => {
    expect(shouldHideOnClose({ ...base, closeToTray: false })).toBe(false);
  });

  it('never hides without a live tray — a hidden window with no tray icon is unreachable', () => {
    expect(shouldHideOnClose({ ...base, trayAvailable: false })).toBe(false);
  });
});

interface FakeTray { id: number }

interface HostCalls {
  menus: TrayMenuItemSpec[][];
  poppedMenus: TrayMenuItemSpec[][];
  tooltips: string[];
  balloons: Array<{ title: string; content: string }>;
  destroyed: number;
  refreshIntervalMs: number | null;
  refreshStops: number;
  leftClick: (() => void) | null;
  rightClick: (() => void) | null;
}

function makeHost(overrides: Partial<TrayHost> = {}): { host: TrayHost; calls: HostCalls } {
  const calls: HostCalls = {
    menus: [], poppedMenus: [], tooltips: [], balloons: [],
    destroyed: 0, refreshIntervalMs: null, refreshStops: 0, leftClick: null, rightClick: null,
  };
  const host: TrayHost = {
    createIcon: () => ({ icon: true }),
    createTray: () => ({ id: 1 }) as FakeTray,
    setToolTip: (_tray, text) => { calls.tooltips.push(text); },
    setMenu: (_tray, items) => { calls.menus.push(items); },
    popUpMenu: (_tray, items) => { calls.poppedMenus.push(items); },
    onLeftClick: (_tray, listener) => { calls.leftClick = listener; },
    onRightClick: (_tray, listener) => { calls.rightClick = listener; },
    displayBalloon: (_tray, title, content) => { calls.balloons.push({ title, content }); },
    destroy: () => { calls.destroyed += 1; },
    startStatusRefresh: (_flush, intervalMs) => {
      calls.refreshIntervalMs = intervalMs;
      return () => { calls.refreshStops += 1; };
    },
    ...overrides,
  };
  return { host, calls };
}

function makeDeps(host: TrayHost, overrides: Partial<BackgroundRunDeps> = {}): BackgroundRunDeps {
  return {
    host,
    platform: 'win32',
    showMainWindow: vi.fn(),
    requestQuit: vi.fn(),
    getActiveTaskCount: async () => 0,
    ...overrides,
  };
}

/** 让挂起的 refresh（一次 microtask + 一次 setTimeout(0)）跑完。 */
const settle = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0); });

describe('statusLabelFor', () => {
  it('returns null for an unknown count so no status row is shown', () => {
    expect(statusLabelFor(null)).toBeNull();
  });

  it('treats zero and negatives as idle', () => {
    expect(statusLabelFor(0)).toBe('tray.status.idle');
    expect(statusLabelFor(-3)).toBe('tray.status.idle');
  });

  it('interpolates the running count', () => {
    expect(statusLabelFor(2)).toBe('tray.status.running:{"count":"2"}');
  });
});

describe('buildMenuItems', () => {
  it('always has show first and quit last', () => {
    const items = buildMenuItems({ statusLabel: null, onShow: vi.fn(), onQuit: vi.fn() });
    expect(items.map((item) => item.id)).toEqual(['show', 'quit']);
  });

  it('inserts the status row in the middle and keeps it non-clickable', () => {
    const items = buildMenuItems({ statusLabel: 'busy', onShow: vi.fn(), onQuit: vi.fn() });
    expect(items.map((item) => item.id)).toEqual(['show', 'status', 'quit']);
    expect(items[1].enabled).toBe(false);
    expect(items[1].click).toBeUndefined();
  });
});

describe('startBackgroundRun on win32', () => {
  it('shows the window on left click and rebuilds the menu on right click', async () => {
    const { host, calls } = makeHost();
    const deps = makeDeps(host);
    startBackgroundRun(deps);
    await settle();

    expect(calls.leftClick).toBeTypeOf('function');
    expect(calls.rightClick).toBeTypeOf('function');
    expect(calls.menus).toHaveLength(0);      // win32 不预先设置菜单，避免和右键菜单重复
    expect(calls.refreshIntervalMs).toBeNull(); // win32 不轮询

    calls.leftClick?.();
    expect(deps.showMainWindow).toHaveBeenCalledTimes(1);

    calls.rightClick?.();
    expect(calls.poppedMenus).toHaveLength(1);
    expect(calls.poppedMenus[0].map((item) => item.id)).toEqual(['show', 'status', 'quit']);
  });

  it('shows the background hint balloon once per session', async () => {
    const { host, calls } = makeHost();
    const run = startBackgroundRun(makeDeps(host));
    await settle();

    run.notifyHidden();
    run.notifyHidden();
    expect(calls.balloons).toHaveLength(1);
    expect(calls.balloons[0].title).toBe('tray.background_hint.title');
  });

  it('hides the status row when the count is unknown', async () => {
    const { host, calls } = makeHost();
    startBackgroundRun(makeDeps(host, { getActiveTaskCount: async () => null }));
    await settle();

    expect(calls.tooltips.at(-1)).toBe('tray.tooltip');
    calls.rightClick?.();
    expect(calls.poppedMenus[0].map((item) => item.id)).toEqual(['show', 'quit']);
  });

  it('hides the status row (and warns) when the count lookup throws', async () => {
    const { host, calls } = makeHost();
    startBackgroundRun(makeDeps(host, {
      getActiveTaskCount: async () => { throw new Error('boom'); },
    }));
    await settle();

    calls.rightClick?.();
    expect(calls.poppedMenus[0].map((item) => item.id)).toEqual(['show', 'quit']);
  });

  it('destroys the tray on stop', async () => {
    const { host, calls } = makeHost();
    const run = startBackgroundRun(makeDeps(host));
    await settle();
    expect(run.isAvailable()).toBe(true);
    run.stop();
    expect(calls.destroyed).toBe(1);
  });
});

describe('startBackgroundRun on darwin', () => {
  it('sets the context menu and refreshes on a timer instead of polling menu clicks', async () => {
    const { host, calls } = makeHost();
    startBackgroundRun(makeDeps(host, { platform: 'darwin' }));
    await settle();

    // 启动时先立刻设一次菜单（计数未知 → 只有显示/退出两项），首次计数读回后
    // 再由 paint() 重建一次（这次带上状态行）。这里断言"最后一次是对的"，
    // 不锁死 setMenu 的调用次数。
    expect(calls.menus.length).toBeGreaterThanOrEqual(1);
    expect(calls.menus.at(-1)!.map((item) => item.id)).toEqual(['show', 'status', 'quit']);
    expect(calls.refreshIntervalMs).toBe(STATUS_REFRESH_MS);
    expect(calls.leftClick).toBeNull();
    expect(calls.balloons).toHaveLength(0);
  });

  it('has a usable menu before the first count read resolves', () => {
    const { host, calls } = makeHost();
    // 计数读取永不 resolve。macOS 的托盘菜单不能在点击时才构建，若只靠
    // refresh() 去设置菜单，这里就会留下一个点了没反应的托盘图标。
    startBackgroundRun(makeDeps(host, {
      platform: 'darwin',
      getActiveTaskCount: () => new Promise<number | null>(() => { /* never */ }),
    }));

    expect(calls.menus).toHaveLength(1);
    expect(calls.menus[0].map((item) => item.id)).toEqual(['show', 'quit']);
  });

  it('never shows the windows balloon', async () => {
    const { host, calls } = makeHost();
    const run = startBackgroundRun(makeDeps(host, { platform: 'darwin' }));
    await settle();
    run.notifyHidden();
    expect(calls.balloons).toHaveLength(0);
  });

  it('stops the refresh timer on stop', async () => {
    const { host, calls } = makeHost();
    const run = startBackgroundRun(makeDeps(host, { platform: 'darwin' }));
    await settle();
    run.stop();
    expect(calls.refreshStops).toBe(1);
    expect(calls.destroyed).toBe(1);
  });
});

describe('startBackgroundRun degradation', () => {
  it('stays disabled when the icon is unavailable', () => {
    const { host, calls } = makeHost({ createIcon: () => null });
    const run = startBackgroundRun(makeDeps(host));
    expect(run.isAvailable()).toBe(false);
    run.stop();
    expect(calls.destroyed).toBe(0);
    expect(calls.menus).toHaveLength(0);
  });

  it('stays disabled when tray creation throws', () => {
    const { host, calls } = makeHost({ createTray: () => { throw new Error('no tray'); } });
    const run = startBackgroundRun(makeDeps(host));
    expect(run.isAvailable()).toBe(false);
    run.stop();
    expect(calls.destroyed).toBe(0);
  });

  it('tears down the previous tray when started twice (idempotent)', async () => {
    const { host, calls } = makeHost();
    startBackgroundRun(makeDeps(host));
    await settle();
    startBackgroundRun(makeDeps(host));
    await settle();
    expect(calls.destroyed).toBe(1);
  });
});
