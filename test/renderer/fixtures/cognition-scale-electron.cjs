// Fixed synthetic inventory, real index/preload/invoke router/domain reads.
// No app boot scheduler, account credentials, external service or model actor.
const { app, BrowserWindow, ipcMain, session } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const deniedNetworkAttempts = [];
const denyNetwork = () => { deniedNetworkAttempts.push('blocked'); throw new Error('External network disabled in isolated scale fixture'); };
globalThis.fetch = async () => denyNetwork();
for (const protocol of ['node:http', 'node:https']) {
  const client = require(protocol); client.request = denyNetwork; client.get = denyNetwork;
}
const root = path.resolve(__dirname, '../../..');
const recordsOnly = process.env.COGSEED_SCALE_RECORDS_ONLY === '1';
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'cognition-scale-electron-'));
process.env.COGSEED_WORKSPACE_ROOT = temporary;
process.env.CORE_AGENT_AUTH_DIR = path.join(temporary, 'auth');
delete process.env.COGSEED_ONBOARDING_ALWAYS;
for (const key of Object.keys(process.env)) if (/(?:API_KEY|AUTH_TOKEN|ACCESS_TOKEN)$/.test(key)) delete process.env[key];
app.setPath('userData', path.join(temporary, 'electron'));
require('tsx/cjs');
require('tsx/esm/api').register();
const load = file => require(path.join(root, 'src/main', file));
const uid = 'cognition-scale-electron-user';
const at = '2026-10-15T00:00:00.000Z';
const table = JSON.parse(fs.readFileSync(path.join(root, 'src/renderer/locales/zh.json'), 'utf8'));
const outcome = { environment: 'production-renderer-preload-ipc-router-domain-electron', modelCalls: 0,
  mode: recordsOnly ? 'records-only' : 'full', dataRoot: temporary,
  referenceMachine: { platform: process.platform, release: os.release(), arch: process.arch, cpu: os.cpus()[0]?.model,
    logicalCpus: os.cpus().length, memoryGiB: Math.round(os.totalmem() / 2 ** 30), electron: process.versions.electron,
    chromium: process.versions.chrome, viewport: { width: 1280, height: 900 }, visible: false, backgroundThrottling: false },
  fixture: { name: 'scale-fixed-v1', timestamp: at, assets: 1000, usageRecords: 10000,
    immutableVersionJournals: 1000,
    perAssetUsage: 10, active: 800, paused: 200, categories: ['preference', 'method', 'template', 'lesson', 'unclassified'],
    usageKind: 'agent_read', usageBoundary: 'real', note: 'Synthetic records, not evidence of real adoption or effectiveness.' },
  boundary: 'Native input/mouse -> production classic-script DOM -> preload -> Electron IPC -> unchanged production invoke router -> formal-assets/timeline services -> isolated persisted store -> IPC -> DOM -> two animation frames.',
  measurementBoundaries: { searchAndFilter: 'Hot native UI input -> existing production cache filtering/sorting -> DOM -> two frames; no redundant IPC added.',
    detail: 'Native row click -> cached complete asset body -> DOM -> two frames.',
    records: 'Native records click -> production preload/invoke IPC -> versions, full asset timeline and adoption services -> modal -> two frames.',
    refresh: 'Native refresh click -> production snapshot channels -> disk/domain -> IPC -> rendered completion; busy/loading feedback timed separately.' },
  failed: [], ipc: {}, latency: {}, screenshots: [], externalNetworkDisabled: true };
let window, finishBoot, mainHeartbeat, previousBeat, mainMaxLag = 0;
let monitoring = false;
let cognitionFile, cognitionMainFileReads = 0;
const readFileSync = fs.readFileSync;
fs.readFileSync = function (file, ...args) {
  if (monitoring && String(file) === cognitionFile) cognitionMainFileReads++;
  return readFileSync.call(this, file, ...args);
};
const bootReady = new Promise(resolve => { finishBoot = resolve; });
const samples = { search: [], filter: [], detail: [], records: [], refresh: [] };
const feedback = [];
const record = (name, ok, details) => { if (!ok) outcome.failed.push({ name, ...(details ? { details } : {}) }); };
const settle = ms => new Promise(resolve => setTimeout(resolve, ms));
const js = code => window.webContents.executeJavaScript(code);
const waitFor = async (name, predicate) => {
  const end = Date.now() + 15_000;
  while (Date.now() < end) { if (await predicate()) return; await settle(20); }
  throw new Error('Timed out: ' + name);
};

// Keep the actual production handler, sender trust check, envelope validation,
// user resolution and domain implementation. Only unrelated boot channels are
// unavailable; no business response used by this benchmark is mocked.
const allowed = new Set(['user.init', 'prefs.getOnboarding', 'prefs.getTourCompleted', 'config.getLanguage', 'config.getUiLanguage', 'log.record',
  'agents.list', 'spaces.list', 'conversations.titles', 'cognition.ontology.snapshot', 'recall.assets.list', 'recall.timeline.list',
  'recall.timeline.forAsset', 'recall.assets.versions.list', 'recall.assets.adoptionReceipts', 'recall.catalog.ranking',
  'recall.reviewEvidence.read', 'recall.candidates.list', 'recall.captures.list', 'recall.captures.settings.get', 'recall.captures.stats']);
const handle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) => handle(channel, channel === 'cogseed.invoke' ? async (event, request) => {
  const logical = request?.channel;
  if (logical === 'log.record' && request?.payload?.module === 'boot' && /^boot total/.test(request.payload.message)) finishBoot();
  if (!allowed.has(logical)) return { ok: false, error: 'Unrelated channel unavailable in isolated scale fixture: ' + logical };
  const started = performance.now();
  const storeReadsBefore = cognitionMainFileReads;
  const result = await listener(event, request);
  const row = outcome.ipc[logical] || (outcome.ipc[logical] = { count: 0, failures: 0, durationsMs: [] });
  row.count++; row.durationsMs.push(performance.now() - started); if (!result.ok) row.failures++;
  if (logical === 'conversations.titles') row.returnedTitles = (row.returnedTitles || 0) + (result.titles?.length || 0);
  if (logical === 'recall.timeline.forAsset') row.realUsageKinds = result.realUsageKinds;
  // The first global timeline read is isolated from other data requests.
  if (logical === 'recall.timeline.list') (row.mainFileReads ||= []).push(cognitionMainFileReads - storeReadsBefore);
  return result;
} : listener);
load('ipc/index.ts').register();
ipcMain.handle = handle;
handle('cogseed.env', () => ({ ok: true, platform: process.platform, isDev: true }));
handle('cogseed.ping', () => ({ ok: true, pong: 'pong' }));
ipcMain.on('cogseed:bootI18n', event => { event.returnValue = { ok: true, lang: 'zh', tables: { zh: table } }; });

async function seed() {
  load('i18n.ts').setCurrentLang('zh'); load('i18n.ts').setCurrentUiLang('zh');
  load('features/users.ts').activateUser(uid);
  load('features/onboarding_state.ts').setOnboardingCompleted(true);
  const records = {};
  for (let n = 0; n < 1000; n++) {
    const id = `aa-scale-${String(n).padStart(4, '0')}`;
    records[id] = { schemaVersion: 2, ownerId: uid, id, candidateId: `scale-candidate-${n}`, reviewDecisionId: `scale-decision-${n}`,
      type: 'cognition', contentCategory: outcome.fixture.categories[n % 5], title: `项目会议准备 ${String(n).padStart(4, '0')}`,
      statement: `先说明目标和证据，再列负责人及下一步。范围编号 ${n}。\n边界：只处理本次会议，不替用户作最终决定。`,
      evidenceRefs: [], origin: 'manual', status: n % 5 ? 'active' : 'paused', maturity: 'bud', lifecycleStatus: 'user_confirmed_unverified',
      scope: 'general', version: '1', applicableWhen: ['项目会议'], forbiddenWhen: ['临时闲聊'], createdAt: at, updatedAt: at };
  }
  await load('features/cognition_bridge.ts').replaceCognitionSources(uid, { mode: 'unified', revision: 1,
    records: { 'ability-assets': records, candidates: {} }, po: { groups: [], trash: [] }, pendingProjection: false, migratedAt: at });
  cognitionFile = load('features/cognition_kernel/store.ts').cognitionStorePath(uid);
  // Ordinary saved assets have immutable v1 content as well as a live head.
  // Use the production snapshot shape and real per-asset JSONL journal files;
  // do not benchmark the cheaper legacy/missing-history branch.
  const { recallJsonlPath } = load('features/recall/paths.ts');
  const { assetVersionSnapshot } = load('features/recall/asset-version-journal.ts');
  const versionDirectory = path.dirname(recallJsonlPath(uid, 'ability-asset-versions', Object.keys(records)[0]));
  fs.mkdirSync(versionDirectory, { recursive: true });
  let versionJournalBytes = 0;
  for (const asset of Object.values(records)) {
    const row = { schemaVersion: 1, ownerId: uid, id: `${asset.id}-v1`, assetId: asset.id, version: '1', at,
      actor: 'user', reason: 'Synthetic fixed initial save, not real user evidence', snapshot: assetVersionSnapshot(asset) };
    const text = JSON.stringify(row) + '\n';
    fs.writeFileSync(recallJsonlPath(uid, 'ability-asset-versions', asset.id), text);
    versionJournalBytes += Buffer.byteLength(text);
  }
  const usageFile = load('features/recall/paths.ts').recallJsonlPath(uid, 'usage-records', 'events');
  fs.mkdirSync(path.dirname(usageFile), { recursive: true });
  const usage = Array.from({ length: 10000 }, (_, n) => ({ schemaVersion: 1, ownerId: uid, id: `usage-scale-${n}`,
    assetId: `aa-scale-${String(n % 1000).padStart(4, '0')}`, assetVersion: '1', taskRunId: `scale-task-${n}`,
    boundary: 'real', outcome: 'agent_read', createdAt: new Date(Date.parse(at) + n * 1000).toISOString() }));
  if (recordsOnly) {
    // The existing timeline derives usage conversation IDs from the task's
    // projection, not from an arbitrary extra property on a usage row.
    // Give each of the 20 measured assets' original 10 reads its matching
    // task/projection -> one real synthetic conversation metadata record.
    const chats = load('features/chats.ts');
    const { recallJsonRecordPath } = load('features/recall/paths.ts');
    fs.mkdirSync(path.dirname(recallJsonRecordPath(uid, 'projections', 'fixture')), { recursive: true });
    for (let n = 0; n < 20; n++) await chats.createConversation(uid, { conversationId: `scale-source-${n}`, title: `规模来源会议 ${String(n).padStart(2, '0')}` });
    let links = 0;
    for (const row of usage) {
      const assetNumber = Number(row.assetId.slice(-4));
      if (assetNumber >= 20) continue;
      row.projectionId = `scale-source-projection-${row.id}`;
      fs.writeFileSync(recallJsonRecordPath(uid, 'projections', row.projectionId), JSON.stringify({ schemaVersion: 1, ownerId: uid,
        id: row.projectionId, taskRunId: row.taskRunId, conversationId: `scale-source-${assetNumber}`, purpose: 'Synthetic scale source linkage',
        authorization: 'model_selected', status: 'confirmed', assetIds: [row.assetId], assetVersions: { [row.assetId]: row.assetVersion },
        sourceRefs: [], omittedRefs: [], createdAt: row.createdAt, confirmedAt: row.createdAt }));
      links++;
    }
    outcome.sourceDataDelta = { conversations: 20, matchingProjectionLinks: links, usageRowsWithSourceBinding: links,
      assetsChanged: 0, usageRowsAdded: 0, outcomesChanged: 0, note: 'Existing 10 reads per measured asset keep their outcome and task identity; only matching source linkage is added.' };
  }
  fs.writeFileSync(usageFile, usage.map(row => JSON.stringify(row)).join('\n') + '\n');
  outcome.inventory = { persistedAssets: (await load('features/recall/asset-service.ts').listAbilityAssets(uid)).length,
    persistedUsageRecords: (await load('features/recall/usage-service.ts').listRecallUsage(uid)).length,
    immutableVersionJournalFiles: fs.readdirSync(versionDirectory).filter(file => file.endsWith('.jsonl')).length, versionJournalBytes,
    storeBytes: fs.statSync(load('features/cognition_kernel/store.ts').cognitionStorePath(uid)).size, usageBytes: fs.statSync(usageFile).size };
}
async function point(selector) {
  return js(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error('Missing control: ' + ${JSON.stringify(selector)});
    el.scrollIntoView({ block: 'center', behavior: 'instant' }); const r = el.getBoundingClientRect();
    const p = { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    if (!el.contains(document.elementFromPoint(p.x, p.y))) throw new Error('Control is occluded: ' + ${JSON.stringify(selector)}); return p; })()`);
}
async function click(selector) {
  const p = await point(selector);
  window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...p });
  window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...p });
}
async function arm(selector, event, predicate, feedbackPredicate) {
  await js(`scaleArm(${JSON.stringify(selector)}, ${JSON.stringify(event)}, () => (${predicate}), ${feedbackPredicate ? '() => (' + feedbackPredicate + ')' : 'null'})`);
}
async function result(kind) {
  const value = await js('scaleResult');
  samples[kind].push(value.ms);
  if (value.feedbackMs !== null) feedback.push({ kind, ms: value.feedbackMs, operationMs: value.ms });
  return value;
}
async function search(query, expectedRows = 1000) {
  await js(`(() => { const el = document.getElementById('ca-library-search'); el.focus(); el.select(); })()`);
  await arm('#ca-library-search', 'input', `CogAssets.store.libraryView.query === ${JSON.stringify(query)} && document.querySelector('#ca-library-search')?.value === ${JSON.stringify(query)} && document.querySelector('.ca-library-pagination')?.textContent.includes('/ ${expectedRows}')`);
  if (query) await window.webContents.insertText(query);
  else {
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Backspace' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Backspace' });
  }
  return result('search');
}
async function filter(key, value, expectedRows) {
  await click(`#ca-library-filter-${key} .ai-select-trigger`);
  const selector = await js(`(() => { const host = document.getElementById('ca-library-filter-${key}'); const api = host._uiSelectApi;
    const index = api.state.options.findIndex(option => option.value === ${JSON.stringify(value)});
    if (index < 0) throw new Error('Missing filter option'); return '#' + host.querySelector('.ai-select-trigger').getAttribute('aria-controls') + '-option-' + index; })()`);
  await arm(selector, 'mousedown', `CogAssets.store.libraryView[${JSON.stringify(key)}] === ${JSON.stringify(value)} && document.querySelector('.ca-library-pagination')?.textContent.includes('/ ${expectedRows}')`
    + (key === 'sort' && value === 'used' ? ' && CogAssets.store.blockStatus.timeline?.loaded && !CogAssets.store.blockStatus.timeline.loading' : ''));
  await click(selector);
  return result('filter');
}
function distribution(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const q = n => Math.round(sorted[Math.ceil(sorted.length * n) - 1] * 100) / 100;
  return { samples: values.length, p50Ms: q(.5), p95Ms: q(.95), maxMs: q(1), valuesMs: values.map(x => Math.round(x * 100) / 100) };
}
async function screenshot(name) {
  const file = path.join('/tmp', `cognition-scale-electron-${name}.png`);
  fs.writeFileSync(file, (await window.webContents.capturePage()).toPNG()); outcome.screenshots.push(file);
}
app.whenReady().then(async () => {
  try {
    await seed();
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }));
    window = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { sandbox: true, contextIsolation: true,
      backgroundThrottling: false, preload: path.join(root, 'src/main/preload.js') } });
    await window.loadFile(path.join(root, 'src/renderer/index.html'));
    await Promise.race([bootReady, settle(15000).then(() => { throw new Error('Production renderer boot did not finish'); })]);
    outcome.referenceMachine.viewport = await js(`({ width: innerWidth, height: innerHeight, pixelRatio: devicePixelRatio })`);
    await js(`(() => {
      if (!${recordsOnly}) {
      window.scaleLag = []; window.scaleLongTasks = []; let previous = performance.now();
      window.scaleHeartbeat = setInterval(() => { const now = performance.now(); scaleLag.push(Math.max(0, now - previous - 10)); previous = now; }, 10);
      new PerformanceObserver(list => scaleLongTasks.push(...list.getEntries().map(row => ({ start: row.startTime, duration: row.duration })))).observe({ type: 'longtask', buffered: false });
      }
      window.scaleArm = (selector, event, complete, feedback) => {
        const el = document.querySelector(selector); if (!el) throw new Error('Missing measurement control: ' + selector);
        window.scaleResult = new Promise((resolve, reject) => { el.addEventListener(event, () => {
          const started = performance.now(); let feedbackMs = null;
          const timer = setTimeout(() => reject(new Error('Action timed out: ' + selector)), 15000);
          function frame() { try {
            const now = performance.now();
            if (feedback && feedbackMs === null && (feedback() || complete())) feedbackMs = now - started;
            if (!complete()) { requestAnimationFrame(frame); return; }
            requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(timer); resolve({ ms: performance.now() - started, feedbackMs }); }));
          } catch (error) { clearTimeout(timer); reject(error); }
          }
          requestAnimationFrame(frame);
        }, { once: true, capture: true }); });
      };
    })()`);
    if (recordsOnly) {
      await js(`(async () => { await loadRendererFeature('recall'); setView('recall'); await CogAssets.loadRoute(); })()`);
      await waitFor('1000 assets loaded for records-only', () => js(`CogAssets.store.assets.length === 1000 && !!document.querySelector('.ca-library-table')`));
      outcome.inventory.rendererAssets = await js('CogAssets.store.assets.length');
      for (let n = 0; n < 20; n++) {
        const id = `aa-scale-${String(n).padStart(4, '0')}`;
        const cid = `scale-source-${n}`, title = `规模来源会议 ${String(n).padStart(2, '0')}`;
        await click(`.ca-library-table [data-act="library-select"][data-id="${id}"]`);
        await waitFor('selected records asset', () => js(`CogAssets.store.route.assetId === ${JSON.stringify(id)} && document.querySelector('.ca-library-page')?.dataset.librarySelected === ${JSON.stringify(id)}`));
        await arm('[data-act="library-show-records"]', 'click', `!!document.querySelector('.ui-modal .ca-library-records') && CogAssets.store.assetTimeline?.assetId === ${JSON.stringify(id)} && !CogAssets.store.assetTimeline.loading && CogAssets.store.conversationTitles?.[${JSON.stringify(cid)}] === ${JSON.stringify(title)}`);
        await click('[data-act="library-show-records"]'); await result('records');
        record('records-only preserves 10 reads, live v1 and actual source title', await js(`(() => {
          const state = CogAssets.store, body = document.querySelector('.ui-modal .ca-library-records').textContent;
          return state.assetTimeline.items.filter(row => row.kind === 'usage_recorded').length === 10
            && state.assetVersions.versions.some(row => row.version === '1' && row.snapshot.statement === state.assets.find(asset => asset.id === ${JSON.stringify(id)}).statement)
            && state.realUsageKinds.includes('usage_recorded') && state.realUsageKinds.includes('projection_confirmed')
            && body.includes(${JSON.stringify(title)}) && !body.includes('该版本后来已删除');
        })()`), { id });
        if (n === 19) await screenshot('records-only-1280');
        window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
        window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
        await waitFor('records-only dialog closed', () => js(`!document.querySelector('.ui-modal .ca-library-records')`));
      }
      outcome.latency = { records: distribution(samples.records) };
      outcome.measurement = 'Only 20 records dialogs: native click -> forAsset and other production IPC services -> awaited per-asset conversations.titles -> modal -> two frames. No search/filter/feedback samples repeated.';
      record('records-only p95 <=800ms', outcome.latency.records.p95Ms <= 800, outcome.latency.records);
      record('actual titles IPC returned all measured source names', outcome.ipc['conversations.titles']?.count >= 20
        && outcome.ipc['conversations.titles'].failures === 0 && outcome.ipc['conversations.titles'].returnedTitles >= 20, outcome.ipc['conversations.titles']);
      record('forAsset returned the authoritative real-usage whitelist', outcome.ipc['recall.timeline.forAsset']?.realUsageKinds?.includes('usage_recorded'));
      return;
    }
    previousBeat = performance.now(); monitoring = true;
    mainHeartbeat = setInterval(() => { const now = performance.now(); if (monitoring) mainMaxLag = Math.max(mainMaxLag, now - previousBeat - 10); previousBeat = now; }, 10);
    const initial = performance.now();
    await js(`(async () => { await loadRendererFeature('recall'); setView('recall'); await CogAssets.loadRoute(); })()`);
    await waitFor('1000 real IPC assets rendered', () => js(`CogAssets.store.assets.length === 1000 && document.querySelector('.ca-library-pagination')?.textContent.includes('/ 1000')`));
    outcome.coldLibraryMs = performance.now() - initial;
    await filter('sort', 'used', 1000); outcome.coldUsedSortMs = samples.filter.pop();
    await waitFor('real bounded timeline loaded', () => js(`CogAssets.store.blockStatus.timeline?.loaded && !CogAssets.store.blockStatus.timeline?.loading`));
    Object.assign(outcome.inventory, await js(`({ rendererAssets: CogAssets.store.assets.length, rendererGlobalTimelineWindow: CogAssets.store.proofs.length })`));
    record('production global timeline is the documented bounded window', outcome.inventory.rendererGlobalTimelineWindow === 500);
    record('global timeline reads the canonical main file once, not once per asset', outcome.ipc['recall.timeline.list']?.mainFileReads[0] === 1,
      outcome.ipc['recall.timeline.list']?.mainFileReads);
    const queries = [['会议', 1000], ['范围编号 9', 111], ['项目', 1000], ['范围编号 4', 111]];
    for (let n = 0; n < 40; n++) await search(...queries[n % queries.length]);
    await search(''); samples.search.pop();
    for (let n = 0; n < 40; n++) await filter('contentCategory', n % 2 ? 'preference' : 'method', 200);
    await filter('contentCategory', '', 1000); samples.filter.pop();
    for (let n = 0; n < 20; n++) {
      const selector = `.ca-library-table [data-act="library-select"]:nth-child(${n + 1})`;
      const id = await js(`document.querySelector(${JSON.stringify(selector)}).dataset.id`);
      await arm(selector, 'click', `CogAssets.store.route.assetId === ${JSON.stringify(id)} && document.querySelector('.ca-library-page')?.dataset.librarySelected === ${JSON.stringify(id)}`);
      await click(selector); await result('detail');
      await arm('[data-act="library-show-records"]', 'click', `!!document.querySelector('.ui-modal .ca-library-records') && CogAssets.store.assetTimeline?.assetId === ${JSON.stringify(id)} && !CogAssets.store.assetTimeline.loading`, `!!document.querySelector('[data-act="library-show-records"][aria-busy="true"]')`);
      await click('[data-act="library-show-records"]'); await result('records');
      const count = await js(`CogAssets.store.assetTimeline.items.filter(row => row.kind === 'usage_recorded').length`);
      record('single-asset detail retains all 10 actual persisted usage records', count === 10, { id, count });
      record('v1 resolves to its real immutable body, never missing/deleted history', await js(`(() => {
        const asset = CogAssets.store.assets.find(row => row.id === ${JSON.stringify(id)});
        const version = CogAssets.store.assetVersions?.versions.find(row => row.version === '1');
        return version?.snapshot?.statement === asset.statement
          && JSON.stringify(version.snapshot.forbiddenWhen) === JSON.stringify(asset.forbiddenWhen)
          && !document.querySelector('.ui-modal .ca-library-records').textContent.includes('该版本后来已删除');
      })()`), { id });
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
      window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
      await waitFor('record dialog closed', () => js(`!document.querySelector('.ui-modal .ca-library-records')`));
    }
    await screenshot('1280');
    for (let n = 0; n < 3; n++) {
      await arm('[data-act="library-refresh"]', 'click', `!CogAssets.store.loading && !CogAssets.isRouteLoading() && CogAssets.store.assets.length === 1000`, `CogAssets.store.loading && document.querySelector('.ca-library-toolbar')?.textContent.includes('加载')`);
      await click('[data-act="library-refresh"]'); await result('refresh');
    }
    monitoring = false; clearInterval(mainHeartbeat);
    const renderer = await js(`(() => { clearInterval(scaleHeartbeat); return { maxLagMs: Math.max(0, ...scaleLag), ticks: scaleLag.length, longTasks: scaleLongTasks }; })()`);
    outcome.latency = Object.fromEntries(Object.entries(samples).map(([kind, values]) => [kind, distribution(values)]));
    outcome.feedback = { samples: feedback.length, maxMs: Math.max(0, ...feedback.map(row => row.ms)), values: feedback };
    outcome.freeze = { thresholdMs: 1000, rendererMaxLagMs: renderer.maxLagMs, mainMaxLagMs: Math.max(0, mainMaxLag), rendererHeartbeatTicks: renderer.ticks,
      rendererLongTasks: renderer.longTasks, observation: '10ms timer drift during the production scale interaction sequence; long tasks >=50ms also retained.' };
    for (const [kind, limit] of [['search', 300], ['filter', 300], ['detail', 800], ['records', 800]]) record(kind + ' p95 threshold', outcome.latency[kind].p95Ms <= limit, outcome.latency[kind]);
    record('long-operation feedback <=200ms', outcome.feedback.maxMs <= 200, outcome.feedback);
    record('renderer has no >=1s heartbeat stall', renderer.maxLagMs < 1000, outcome.freeze);
    record('main has no >=1s heartbeat stall', mainMaxLag < 1000, outcome.freeze);
    for (const channel of ['recall.assets.list', 'recall.timeline.list', 'recall.timeline.forAsset', 'recall.assets.versions.list', 'recall.assets.adoptionReceipts']) record('actual production IPC succeeded: ' + channel, outcome.ipc[channel]?.count > 0 && outcome.ipc[channel]?.failures === 0, outcome.ipc[channel]);
  } catch (error) {
    outcome.failed.push({ name: error.message, stack: error.stack });
    if (window) { outcome.rendererState = await js(`({ route: window.CogAssets?.store?.route, errors: window.CogAssets?.store?.errors, body: document.body.textContent.slice(-1000) })`).catch(() => ({})); await screenshot('failure').catch(() => {}); }
  } finally {
    clearInterval(mainHeartbeat);
    outcome.deniedNetworkAttempts = deniedNetworkAttempts.length;
    for (const row of Object.values(outcome.ipc)) { row.latency = distribution(row.durationsMs); delete row.durationsMs; }
    window?.destroy();
    if (recordsOnly) {
      outcome.reportFile = path.join('/tmp', `cognition-scale-records-${path.basename(temporary)}.json`);
      fs.writeFileSync(outcome.reportFile, JSON.stringify(outcome, null, 2));
    }
    process.stdout.write(JSON.stringify(outcome) + '\n');
    if (!recordsOnly) fs.rmSync(temporary, { recursive: true, force: true });
    app.exit(outcome.failed.length ? 1 : 0);
  }
});
