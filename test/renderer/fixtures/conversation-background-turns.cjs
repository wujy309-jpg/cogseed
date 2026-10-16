// Actual conversation and chat-stream renderer; synthetic events and IPC only.
const { app, BrowserWindow, ipcMain, session } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'background-turns-'));
app.setPath('userData', path.join(temporary, 'electron'));
const table = JSON.parse(fs.readFileSync(path.join(root, 'src/renderer/locales/en.json'), 'utf8'));
let boot;
const ready = new Promise(resolve => { boot = resolve; });
ipcMain.handle('cogseed.env', () => ({ ok: true, platform: process.platform, isDev: true }));
ipcMain.handle('cogseed.ping', () => ({ ok: true }));
ipcMain.on('cogseed:bootI18n', event => { event.returnValue = { ok: true, lang: 'en', tables: { en: table } }; });
ipcMain.handle('cogseed.invoke', async (_event, { channel, payload }) => {
  if (channel === 'prefs.getOnboarding') return { ok: true, completed: true };
  if (channel === 'user.init') return { ok: true, user_id: 'synthetic-stream-user' };
  if (channel === 'config.getLanguage') return { ok: true, language: 'en' };
  if (channel === 'log.record') {
    if (payload?.module === 'boot' && /^boot total/.test(payload.message)) boot();
    return { ok: true };
  }
  return { ok: false, error: 'Unavailable in isolated stream fixture' };
});
app.whenReady().then(async () => {
  let window;
  const outcome = { scenarios: [], failed: [] };
  try {
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }));
    window = new BrowserWindow({ show: false, width: 1280, height: 900,
      webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false, preload: path.join(root, 'src/main/preload.js') } });
    await window.loadFile(path.join(root, 'src/renderer/index.html'));
    await Promise.race([ready, new Promise((_, reject) => {
      const timer = setTimeout(() => reject(new Error('Renderer boot did not finish')), 10_000);
      timer.unref();
    })]);
    const scenarios = await window.webContents.executeJavaScript(`(async () => {
      const assert = (ok, message) => { if (!ok) throw new Error(message); };
      setView('conversation', 'synthetic-task', { skipLoad: true });
      const history = document.getElementById('chat-history');
      const scenarios = [];
      // Avoid unrelated polling/network activity; production event ownership,
      // stream painting, terminal rendering and replay remain unchanged.
      _evaluateAutoRecipient = async () => {};
      _bumpConvToTop = () => {};
      _scheduleConversationInfoFileRefresh = () => {};
      startPolling = () => {};
      _agentsCache = [];
      let reviewNodes;
      for (const kind of ['background-replay', 'history-claim', 'silent-replay', 'segment-replay', 'silent-handoff']) {
        const cid = 'synthetic-' + kind;
        currentCid = cid; history.replaceChildren();
        const first = _createStreamingAssistantMessage(history, { hiddenUntilActor: true });
        pendingConvs.set(cid, { loadingEl: first, controller: {} });
        const send = event => _handleStreamEvent(cid, first, { type: 'event', event: { stream: 'chat', data: event } }, { actorIdentity: true });
        const text = (turnId, body) => send({ type: 'chat.item', turnId, kind: 'text', status: 'inProgress', itemId: turnId + '-text', payload: { delta: body } });
        send({ type: 'chat.turn.started', actorId: 'commander', turnId: 'first-turn' });
        send({ type: 'chat.item', turnId: 'first-turn', kind: 'toolExecution', status: 'completed', itemId: 'first-tool', payload: { toolName: 'synthetic_read', arguments: { file: 'sample.txt' }, result: 'Synthetic evidence' } });
        text('first-turn', 'First synthetic reply.');
        currentCid = 'synthetic-other'; history.replaceChildren();
        _handleGroupBusEvent(cid, first, { type: 'process', actor: 'commander', turn_id: 'first-turn', data: { type: 'progress', text: 'First legacy progress' } });
        send({ type: 'chat.turn.completed', turnId: 'first-turn', status: 'completed' });
        const gm = { id: cid + '-first-message', from: 'commander', turn_id: 'first-turn', text: 'First synthetic reply.', ts: '2026-01-01T00:00:01Z', ...(kind === 'segment-replay' ? { seg: 0 } : {}) };
        const terminal = kind.startsWith('silent-') ? { type: 'turn_silent', actor: 'commander', turn_id: 'first-turn', ...(kind === 'silent-handoff' ? { reason: 'terminal_handoff' } : {}) }
          : { type: 'message', turn_id: 'first-turn', turn_end: kind !== 'segment-replay', msg: gm };
        _handleGroupBusEvent(cid, first, terminal);
        const nextId = kind === 'segment-replay' ? 'first-turn' : 'second-turn';
        send({ type: 'chat.turn.started', actorId: 'commander', turnId: nextId });
        text(nextId, 'Second synthetic reply.');
        const second = _groupPlaceholders.get(_phKey(cid, 'commander', nextId));
        assert(second && first !== second, kind + ': next turn reused finished node');
        assert(history.children.length === 0, kind + ': background node leaked into other task');
        assert(!first.textContent.includes('Second synthetic reply'), kind + ': first turn contains second body');
        _handleGroupBusEvent(cid, first, terminal); // duplicate after next start
        currentCid = cid;
        if (kind === 'history-claim') {
          const originalFetch = apiFetch;
          apiFetch = async url => ({ json: async () => String(url).includes('/history?') ? {
            ok: true, history: [gm], history_indexes: [0], conversation: { conversation_id: cid,
              backend_active: true, in_flight: ['commander'], active_turns: [{ actor: 'commander', turn_id: nextId }] },
          } : { ok: true, actors: [] } });
          try { await loadConversationHistory(cid); } finally { apiFetch = originalFetch; }
        }
        _ensureActorPlaceholder(cid, 'commander', first, nextId);
        _replayBufferedGroupEvents(cid, { archive: false });
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        assert(second.isConnected && first.isConnected === (kind !== 'silent-handoff'), kind + ': wrong restored turns');
        assert(first.querySelector('.cs-flow'), kind + ': lost first tool timeline');
        assert(second.dataset.finalized !== '1', kind + ': replay ended new turn');
        assert(first.querySelectorAll('.cs-flow').length === 1 && second.querySelectorAll('.cs-flow').length === 1, kind + ': mixed process timelines');
        assert(history.querySelectorAll(':scope > .chat-message').length === (kind === 'silent-handoff' ? 1 : 2), kind + ': duplicated or lost bubble');
        assert(second.textContent.includes('Second synthetic reply'), kind + ': lost second body');
        if (!kind.startsWith('silent-')) assert(first.querySelector('[data-role="final"]').textContent.includes('First synthetic reply'), kind + ': lost first body');
        if (kind === 'history-claim') reviewNodes = [first, second];
        scenarios.push(kind);
      }
      // Leave the representative history-reconciled pair visible for inspection,
      // rather than the deliberately discarded terminal-handoff tail.
      history.replaceChildren(...reviewNodes);
      await new Promise(resolve => requestAnimationFrame(resolve));
      return scenarios;
    })()`);
    outcome.scenarios = scenarios;
    if (process.env.COGSEED_REVIEW_SCREENSHOTS) {
      fs.mkdirSync(process.env.COGSEED_REVIEW_SCREENSHOTS, { recursive: true });
      fs.writeFileSync(path.join(process.env.COGSEED_REVIEW_SCREENSHOTS, 'background-turns.png'), (await window.webContents.capturePage()).toPNG());
    }
  } catch (error) {
    outcome.failed.push({ error: error.message, stack: error.stack });
  } finally {
    window?.destroy();
    fs.rmSync(temporary, { recursive: true, force: true });
    process.stdout.write(JSON.stringify(outcome) + '\n');
    app.exit(outcome.failed.length ? 1 : 0);
  }
});
