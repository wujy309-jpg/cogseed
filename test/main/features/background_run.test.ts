import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/main/i18n', () => ({
  t: (key: string, vars?: Record<string, string>) => (vars ? `${key}:${JSON.stringify(vars)}` : key),
}));

vi.mock('../../../src/main/logger', () => ({
  createLogger: () => ({ warn: vi.fn(), info: vi.fn() }),
}));

import { shouldHideOnClose } from '../../../src/main/features/background_run';

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
