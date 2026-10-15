import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const settingsSource = readFileSync(resolve(__dirname, '../../src/renderer/modules/settings.js'), 'utf8');
const htmlSource = readFileSync(resolve(__dirname, '../../src/renderer/index.html'), 'utf8');

function pageHarness() {
  let enabled = false;
  let click: (() => Promise<void>) | undefined;
  const toggle = {
    getAttribute: () => String(enabled),
    addEventListener: (_event: string, handler: () => Promise<void>) => { click = handler; },
  };
  const host = { innerHTML: '', querySelector: (selector: string) => selector === '#settings-semantica-enabled' ? toggle : null };
  const invoke = vi.fn(async (channel: string, payload?: { semanticaEnabled: boolean }) => {
    if (channel === 'semantica.settings.save') enabled = payload!.semanticaEnabled;
    return { ok: true, settings: { semanticaEnabled: enabled, semanticaStatus: enabled ? 'running' : 'disabled' } };
  });
  const context = vm.createContext({
    createLogger: () => ({ warn: vi.fn() }), t: (key: string) => key, escapeHtml: String,
    uiSwitch: ({ checked }: { checked: boolean }) => `<button id="settings-semantica-enabled" aria-checked="${checked}">Semantica</button>`,
    document: { getElementById: (id: string) => id === 'settings-semantica-host' ? host : null, addEventListener: vi.fn() },
    window: { addEventListener: vi.fn(), cogseed: { invoke } },
  });
  vm.runInContext(settingsSource, context);
  return { context, host, invoke, click: () => click!() };
}

describe('Settings -> Semantica', () => {
  it('renders the settings page toggle with no demo create/delete actions and still saves both states', async () => {
    const f = pageHarness();
    expect(htmlSource).toContain('id="settings-semantica-host"');
    await vm.runInContext('_settingsRefreshSemantica();', f.context);
    vm.runInContext('_settingsRenderSemantica();', f.context);
    expect(f.host.innerHTML).toContain('aria-checked="false"');
    expect(f.host.innerHTML).not.toMatch(/semantica-demo|Initialize demo|Remove demo/);
    await f.click();
    expect(f.invoke).toHaveBeenLastCalledWith('semantica.settings.save', { semanticaEnabled: true });
    expect(f.host.innerHTML).toContain('aria-checked="true"');
    await f.click();
    expect(f.invoke).toHaveBeenLastCalledWith('semantica.settings.save', { semanticaEnabled: false });
    expect(settingsSource).not.toContain('semantica.demo.');
  });
});
