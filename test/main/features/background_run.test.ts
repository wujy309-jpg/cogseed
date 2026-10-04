import * as fs from 'node:fs';
import * as path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/main/i18n', () => ({
  t: (key: string, vars?: Record<string, string>) => (vars ? `${key}:${JSON.stringify(vars)}` : key),
}));

const loggerSpy = vi.hoisted(() => ({ warn: vi.fn() }));

vi.mock('../../../src/main/logger', () => ({
  createLogger: () => ({ warn: loggerSpy.warn, info: vi.fn() }),
}));

beforeEach(() => {
  loggerSpy.warn.mockClear();
});

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
  refreshFlush: (() => void) | null;
  leftClick: (() => void) | null;
  rightClick: (() => void) | null;
}

function makeHost(overrides: Partial<TrayHost> = {}): { host: TrayHost; calls: HostCalls } {
  const calls: HostCalls = {
    menus: [], poppedMenus: [], tooltips: [], balloons: [],
    destroyed: 0, refreshIntervalMs: null, refreshStops: 0, refreshFlush: null,
    leftClick: null, rightClick: null,
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
    startStatusRefresh: (flush, intervalMs) => {
      calls.refreshIntervalMs = intervalMs;
      calls.refreshFlush = flush;
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

  it('treats non-finite counts as unknown instead of idle', () => {
    expect(statusLabelFor(Number.NaN)).toBeNull();
    expect(statusLabelFor(Number.POSITIVE_INFINITY)).toBeNull();
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
    const countSpy = vi.fn(async () => 0);
    const deps = makeDeps(host, { getActiveTaskCount: countSpy });
    startBackgroundRun(deps);
    await settle();

    expect(calls.leftClick).toBeTypeOf('function');
    expect(calls.rightClick).toBeTypeOf('function');
    expect(calls.menus).toHaveLength(0);      // win32 不预先设置菜单，避免和右键菜单重复
    expect(calls.refreshIntervalMs).toBe(STATUS_REFRESH_MS);
    expect(countSpy).toHaveBeenCalledTimes(1);

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
    expect(loggerSpy.warn).toHaveBeenCalled();
  });

  it('destroys the tray on stop', async () => {
    const { host, calls } = makeHost();
    const run = startBackgroundRun(makeDeps(host));
    await settle();
    expect(run.isAvailable()).toBe(true);
    run.stop();
    expect(calls.destroyed).toBe(1);
  });

  it('re-reads the count on each refresh tick', async () => {
    const { host, calls } = makeHost();
    const countSpy = vi.fn(async () => 0);
    startBackgroundRun(makeDeps(host, { getActiveTaskCount: countSpy }));
    await settle();
    expect(countSpy).toHaveBeenCalledTimes(1);
    expect(calls.tooltips.at(-1)).toContain('tray.status.idle');

    countSpy.mockResolvedValue(3);
    calls.refreshFlush?.();
    await settle();
    expect(countSpy).toHaveBeenCalledTimes(2);
    expect(calls.tooltips.at(-1)).toContain('tray.status.running');
  });

  it('does not pop a menu after stop', async () => {
    const { host, calls } = makeHost();
    const run = startBackgroundRun(makeDeps(host));
    await settle();
    run.stop();
    calls.rightClick?.();
    expect(calls.poppedMenus).toHaveLength(0);
  });

  it('ignores a status read that resolves after stop', async () => {
    const { host, calls } = makeHost();
    let release: (value: number) => void = () => { /* 稍后赋值 */ };
    const pending = new Promise<number>((resolve) => { release = resolve; });
    const run = startBackgroundRun(makeDeps(host, { getActiveTaskCount: () => pending }));
    run.stop(); // 读取还没回来
    const tooltipsAfterStop = calls.tooltips.length;
    release(5);
    await settle();
    expect(calls.tooltips).toHaveLength(tooltipsAfterStop);
  });

  it('destroys the tray only once when stopped twice', async () => {
    const { host, calls } = makeHost();
    const run = startBackgroundRun(makeDeps(host));
    await settle();
    run.stop();
    run.stop();
    expect(calls.destroyed).toBe(1);
  });

  it('does not touch a destroyed tray when the window is hidden after stop', async () => {
    const { host, calls } = makeHost();
    const run = startBackgroundRun(makeDeps(host));
    await settle();
    run.stop();
    const tooltipsAfterStop = calls.tooltips.length;
    run.notifyHidden();
    expect(calls.balloons).toHaveLength(0);
    expect(calls.tooltips).toHaveLength(tooltipsAfterStop);
  });

  it('keeps the newest count when two reads resolve out of order', async () => {
    const { host, calls } = makeHost();
    const resolvers: Array<(value: number | null) => void> = [];
    startBackgroundRun(makeDeps(host, {
      getActiveTaskCount: () => new Promise<number | null>((resolve) => { resolvers.push(resolve); }),
    }));

    resolvers[0](0); // 首次读取返回：idle
    await settle();
    expect(calls.tooltips.at(-1)).toContain('tray.status.idle');

    calls.refreshFlush?.(); // 第二次读取（更新的票据）
    calls.refreshFlush?.(); // 第三次读取（票据再 +1）
    resolvers[1](9);        // 旧读取晚到 → 必须被丢弃，不能覆盖
    await settle();
    expect(calls.tooltips.at(-1)).toContain('tray.status.idle');

    resolvers[2](7);        // 最新读取返回
    await settle();
    expect(calls.tooltips.at(-1)).toContain('tray.status.running');
  });

  it('does not reveal the window from a stale left click after stop', async () => {
    const { host, calls } = makeHost();
    const deps = makeDeps(host);
    const run = startBackgroundRun(deps);
    await settle();
    run.stop();
    calls.leftClick?.();
    expect(deps.showMainWindow).not.toHaveBeenCalled();
  });

  it('warns once, not on every tick, when the count keeps failing', async () => {
    const { host, calls } = makeHost();
    const countSpy = vi.fn(async () => { throw new Error('down'); });
    startBackgroundRun(makeDeps(host, { getActiveTaskCount: countSpy }));
    await settle();
    expect(countSpy).toHaveBeenCalledTimes(1);
    expect(loggerSpy.warn).toHaveBeenCalledTimes(1);

    calls.refreshFlush?.();
    await settle();
    calls.refreshFlush?.();
    await settle();
    expect(countSpy).toHaveBeenCalledTimes(3);
    expect(loggerSpy.warn).toHaveBeenCalledTimes(1); // 只在状态翻转时告警
  });

  it('survives a throwing balloon call', async () => {
    const { host } = makeHost({ displayBalloon: () => { throw new Error('no balloon'); } });
    const run = startBackgroundRun(makeDeps(host));
    await settle();
    expect(() => run.notifyHidden()).not.toThrow();
    expect(loggerSpy.warn).toHaveBeenCalled();
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

  it('degrades and destroys the half-built tray when darwin wiring throws', () => {
    const { host, calls } = makeHost({ setMenu: () => { throw new Error('no menu'); } });
    const run = startBackgroundRun(makeDeps(host, { platform: 'darwin' }));
    expect(run.isAvailable()).toBe(false);
    expect(calls.destroyed).toBe(1);
    expect(loggerSpy.warn).toHaveBeenCalled();
  });

  it('degrades and destroys the half-built tray when win32 wiring throws', () => {
    const { host, calls } = makeHost({ onRightClick: () => { throw new Error('no handler'); } });
    const run = startBackgroundRun(makeDeps(host, { platform: 'win32' }));
    expect(run.isAvailable()).toBe(false);
    expect(calls.destroyed).toBe(1);
  });

  it('stays disabled when icon creation throws', () => {
    const { host, calls } = makeHost({ createIcon: () => { throw new Error('boom'); } });
    const run = startBackgroundRun(makeDeps(host));
    expect(run.isAvailable()).toBe(false);
    expect(calls.destroyed).toBe(0);
    expect(loggerSpy.warn).toHaveBeenCalled();
  });

  it('still destroys the tray when stopping the refresh timer throws', async () => {
    const { host, calls } = makeHost({
      startStatusRefresh: () => () => { throw new Error('no clear'); },
    });
    const run = startBackgroundRun(makeDeps(host));
    await settle();
    run.stop();
    expect(calls.destroyed).toBe(1);
    expect(loggerSpy.warn).toHaveBeenCalled();
  });
});

const TRAY_KEYS = [
  'tray.show_window',
  'tray.quit',
  'tray.tooltip',
  'tray.tooltip_with_status',
  'tray.status.idle',
  'tray.status.running',
  'tray.background_hint.title',
  'tray.background_hint.content',
];

describe('main locale coverage', () => {
  it.each(['zh', 'en'])('%s locale defines every tray key', (lang) => {
    const file = path.join(__dirname, '../../../src/main/locales', `${lang}.json`);
    const table = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, string>;
    for (const key of TRAY_KEYS) {
      expect(table[key], `${lang} is missing ${key}`).toBeTruthy();
    }
  });
});
