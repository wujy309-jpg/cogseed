// Production KB page, shell controls and preload; isolated storage and no model calls.
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-header-'));
app.setPath('userData', path.join(temporary, 'electron'));
const table = JSON.parse(fs.readFileSync(path.join(root, 'src/renderer/locales/zh.json'), 'utf8'));
let completeBoot;
const bootReady = new Promise(resolve => { completeBoot = resolve; });
ipcMain.handle('cogseed.env', () => ({ ok: true, platform: process.platform, isDev: true }));
ipcMain.handle('cogseed.ping', () => ({ ok: true, pong: 'pong' }));
ipcMain.on('cogseed:bootI18n', event => { event.returnValue = { ok: true, lang: 'zh', tables: { zh: table } }; });
ipcMain.handle('cogseed.invoke', async (_event, { channel, payload }) => {
  if (channel === 'prefs.getOnboarding') return { ok: true, completed: true };
  if (channel === 'user.init') return { ok: true, user_id: 'kb-header-test' };
  if (channel === 'config.getLanguage') return { ok: true, language: 'zh' };
  if (channel === 'log.record') {
    if (payload?.module === 'boot' && /^boot total/.test(payload.message)) completeBoot();
    return { ok: true };
  }
  return { ok: false, error: 'unavailable in isolated KB header fixture' };
});

app.whenReady().then(async () => {
  let window;
  const outcome = { passed: 0, failed: [] };
  const record = (name, ok) => {
    if (ok) outcome.passed++;
    else outcome.failed.push({ name });
  };
  const settle = () => new Promise(resolve => setTimeout(resolve, 60));
  try {
    window = new BrowserWindow({ show: false, width: 1280, height: 800,
      ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 12, y: 19 } } : {}),
      webPreferences: { sandbox: true, contextIsolation: true, preload: path.join(root, 'src/main/preload.js') } });
    await window.loadFile(path.join(root, 'src/renderer/index.html'));
    await Promise.race([bootReady, new Promise((_, reject) => {
      const timer = setTimeout(() => reject(new Error('Production renderer boot did not finish')), 10_000);
      timer.unref();
    })]);
    await window.webContents.executeJavaScript(`(async () => {
      await loadRendererFeature('kb');
      setView('kb');
      renderKbEco();
      renderKbWorkbench();
    })()`);
    const click = async selector => {
      const point = await window.webContents.executeJavaScript(`(() => {
        const box = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
        return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
      })()`);
      window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
      window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
      await settle();
    };
    for (const width of [1280, 720]) {
      window.setContentSize(width, 800);
      for (const mac of [true, false]) {
        await window.webContents.executeJavaScript(`document.documentElement.classList.toggle('is-macos', ${mac})`);
        for (const compact of [false, true]) {
          await window.webContents.executeJavaScript(`(() => {
            if (document.querySelector('.kb-eco').classList.contains('kb-eco--compact') !== ${compact}) document.getElementById('kb-eco-compact').click();
            if (document.body.classList.contains('sidebar-collapsed')) document.getElementById('sidebar-collapse-btn').click();
          })()`);
          for (const collapsed of [false, true, false]) {
            if (await window.webContents.executeJavaScript(`document.body.classList.contains('sidebar-collapsed') !== ${collapsed}`)) {
              await click('#sidebar-collapse-btn');
            }
            const checks = await window.webContents.executeJavaScript(`(() => {
              const checks = [];
              const assert = (name, ok) => checks.push({ name, ok: !!ok });
              const header = document.querySelector('.kb-eco-topnav');
              const tabs = document.querySelector('.kb-eco-tabs');
              const recovery = document.getElementById('sidebar-collapse-btn');
              const box = header.getBoundingClientRect();
              const first = tabs.firstElementChild.getBoundingClientRect();
              assert('sidebar toggle works', document.body.classList.contains('sidebar-collapsed') === ${collapsed});
              assert('header fits viewport', box.right <= innerWidth + 1);
              assert('KB tab clears shell controls', first.left >= recovery.getBoundingClientRect().right);
              assert('compact action fits header', document.getElementById('kb-eco-compact').getBoundingClientRect().right <= box.right);
              assert('navigation actions are clickable', [...header.querySelectorAll('button')].every(button => getComputedStyle(button).getPropertyValue('-webkit-app-region') === '${mac ? 'no-drag' : 'none'}'));
              if (${mac && collapsed}) {
                assert('native-control gutter excluded from drag', getComputedStyle(header).getPropertyValue('-webkit-app-region') === 'no-drag');
                assert('inset navigation retains window dragging', getComputedStyle(tabs).getPropertyValue('-webkit-app-region') === 'drag');
              }
              return checks;
            })()`);
            for (const check of checks) record(`${width}/${mac ? 'mac' : 'native-frame'}/${compact ? 'compact' : 'labels'}/${collapsed ? 'collapsed' : 'expanded'}: ${check.name}`, check.ok);
          }
        }
      }
    }
    await window.webContents.executeJavaScript(`document.documentElement.classList.add('is-macos'); document.getElementById('sidebar-collapse-btn').click()`);
    await click('[data-kb-eco="notes"]');
    record('notes navigation receives mouse input', await window.webContents.executeJavaScript(`!document.getElementById('kb-notes').hidden`));
    await click('[data-kb-eco="kb"]');
    record('KB navigation receives mouse input', await window.webContents.executeJavaScript(`!document.getElementById('kb-workbench').hidden`));
    const restoredBoot = new Promise(resolve => { completeBoot = resolve; });
    await window.loadFile(path.join(root, 'src/renderer/index.html'));
    await Promise.race([restoredBoot, new Promise((_, reject) => {
      const timer = setTimeout(() => reject(new Error('Restored renderer boot did not finish')), 10_000);
      timer.unref();
    })]);
    await window.webContents.executeJavaScript(`(async () => {
      await loadRendererFeature('kb'); setView('kb'); renderKbEco(); renderKbWorkbench();
    })()`);
    record('saved collapse restores safe header spacing', await window.webContents.executeJavaScript(`(() => {
      const first = document.querySelector('[data-kb-eco="kb"]').getBoundingClientRect();
      const recovery = document.getElementById('sidebar-collapse-btn').getBoundingClientRect();
      return document.body.classList.contains('sidebar-collapsed') && first.left >= recovery.right;
    })()`));
    await click('#sidebar-collapse-btn');
    record('restored collapse can expand by mouse', await window.webContents.executeJavaScript(`!document.body.classList.contains('sidebar-collapsed')`));
    await click('#sidebar-collapse-btn');
    if (process.env.COGSEED_KB_HEADER_SCREENSHOT) {
      window.setContentSize(1280, 800);
      await window.webContents.executeJavaScript(`if (document.querySelector('.kb-eco').classList.contains('kb-eco--compact')) document.getElementById('kb-eco-compact').click()`);
      await settle();
      fs.writeFileSync(process.env.COGSEED_KB_HEADER_SCREENSHOT, (await window.webContents.capturePage()).toPNG());
    }
    process.stdout.write(JSON.stringify(outcome) + '\n');
    process.exitCode = outcome.failed.length ? 1 : 0;
  } catch (error) {
    process.stdout.write(JSON.stringify({ error: error.message, stack: error.stack }) + '\n');
    process.exitCode = 1;
  } finally {
    window?.destroy();
    fs.rmSync(temporary, { recursive: true, force: true });
    app.exit(process.exitCode || 0);
  }
});
