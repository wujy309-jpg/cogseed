// Public shared-select lifecycle in Chromium: portal, event listeners, delayed
// focus and outside listener, and language refresh after a page rebuild.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
app.commandLine.appendSwitch('no-sandbox');
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1100, height: 800, webPreferences: { sandbox: false } });
  const root = path.resolve(__dirname, '../../../src/renderer');
  await win.loadURL('data:text/html,' + encodeURIComponent('<!doctype html><html><body><main id="page" style="contain:paint;position:absolute;top:120px;left:90px;width:700px;padding:20px"></main></body></html>'));
  for (const file of ['tokens.css', 'ui-components.css']) await win.webContents.insertCSS(fs.readFileSync(path.join(root, file), 'utf8'));
  await win.webContents.executeJavaScript('window.t = key => key; true;');
  for (const file of ['modules/icons.js', 'modules/utils.js', 'modules/ui-form.js']) await win.webContents.executeJavaScript(fs.readFileSync(path.join(root, file), 'utf8') + '\n//# sourceURL=' + file);
  const result = await win.webContents.executeJavaScript(`(async () => {
    const checks = [];
    const check = (name, ok, detail) => checks.push({ name, ok: !!ok, detail });
    const pause = () => new Promise(resolve => setTimeout(resolve, 10));
    const tracked = [];
    for (const [surface, kinds] of [[document, ['mousedown', 'keydown']], [window, ['scroll', 'resize']]]) {
      const add = surface.addEventListener.bind(surface), remove = surface.removeEventListener.bind(surface);
      const listeners = new Map(kinds.map(kind => [kind, new Set()]));
      surface.addEventListener = (kind, listener, options) => { listeners.get(kind)?.add(listener); return add(kind, listener, options); };
      surface.removeEventListener = (kind, listener, options) => { listeners.get(kind)?.delete(listener); return remove(kind, listener, options); };
      tracked.push(listeners);
    }
    const countListeners = () => tracked.flatMap(map => [...map.values()]).reduce((n, values) => n + values.size, 0);
    let translations = 0;
    window.t = key => { translations += 1; return key; };
    const page = document.getElementById('page');
    const mount = () => {
      page.innerHTML = uiSelect({ id: 'filter', ariaLabel: 'Category', value: 'a', searchable: true, options: [{ value: 'a', label: 'Understanding' }, { value: 'b', label: 'Experience' }] });
      return hydrateUiFormSelects(page, { filter: () => {} })[0];
    };
    let api = mount();
    api.open();
    let popover = document.querySelector('body > [role="listbox"]');
    const trigger = api.el.querySelector('.ai-select-trigger');
    const box = trigger.getBoundingClientRect();
    check('portal escapes paint containment', popover?.parentNode === document.body);
    check('menu aligns to trigger viewport coordinates', Math.abs(popover.getBoundingClientRect().left - box.left) < 1 && Math.abs(popover.getBoundingClientRect().top - box.bottom - 4) < 1);
    api.close();
    await pause();
    check('immediate open-close cancels delayed outside listener', countListeners() === 0, countListeners());
    check('immediate open-close cancels delayed search focus', document.activeElement?.className !== 'ai-select-search-input');
    check('close returns hidden portal to host', !document.querySelector('body > [role="listbox"]') && api.el.querySelector('[role="listbox"]')?.hidden);
    api.open();
    await pause();
    check('opened select registers all four shared listeners', countListeners() === 4, countListeners());
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    check('Escape closes and restores trigger focus', !api.state.open && document.activeElement === trigger && countListeners() === 0);
    api.open();
    await pause();
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    check('outside click closes portal and listeners', !api.state.open && !document.querySelector('body > [role="listbox"]') && countListeners() === 0);
    api.open();
    api.destroy();
    await pause();
    check('destroy clears immediate-open timers, portal and listeners', countListeners() === 0 && !document.querySelector('[role="listbox"]'));
    const before = translations;
    window.dispatchEvent(new Event('i18n-change'));
    check('destroy releases instance from language refresh', translations === before);
    api.destroy(); api.open(); trigger.click();
    check('destroy is idempotent and old trigger cannot reopen', !api.state.open && countListeners() === 0 && !document.querySelector('[role="listbox"]'));
    for (let i = 0; i < 8; i += 1) {
      api = mount(); api.open(); api.destroy();
    }
    await pause();
    const afterRebuild = translations;
    window.dispatchEvent(new Event('i18n-change'));
    check('repeated rebuild releases every old instance', translations === afterRebuild && countListeners() === 0 && !document.querySelector('[role="listbox"]'));
    api = mount(); api.open();
    await pause();
    page.remove(); api.destroy();
    check('destroy after host removal also removes body portal', countListeners() === 0 && !document.querySelector('[role="listbox"]'));
    const failed = checks.filter(item => !item.ok);
    return { total: checks.length, passed: checks.length - failed.length, failed };
  })()`);
  console.log(JSON.stringify(result));
  app.exit(result.failed.length ? 1 : 0);
}).catch(error => { console.error(error); app.exit(1); });
