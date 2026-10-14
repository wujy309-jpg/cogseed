/* 资产设置：夜间发现、模型顺序与自动确认的真实状态。由 app.js 委托动作调用。 */
(function () {
  'use strict';
  const NS = window.CogAssets;
  if (!NS) return;

  function discoveryStatus(snapshot, readError) {
    if (readError || !snapshot) return { state: 'unknown' };
    const sweep = snapshot.sweep || {};
    const result = sweep.lastResult;
    if (snapshot.runtime && snapshot.runtime.running) return { state: 'running', at: snapshot.runtime.startedAt };
    if (!result) return { state: 'never' };
    return {
      state: result.error || Number(result.failed) > 0 ? 'failed' : 'completed',
      at: result.finishedAt || sweep.lastRunAt,
      reviewDay: typeof result.reviewDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(result.reviewDay) ? result.reviewDay : '',
      scanned: Math.max(0, Number(result.scanned) || 0),
      queued: Math.max(0, Number(result.queued) || 0),
      failed: Math.max(0, Number(result.failed) || 0),
      deferred: Math.max(0, Number(result.deferred) || 0),
    };
  }

  function captureDisclosures(root) {
    return Array.from(root?.querySelectorAll?.('[data-settings-disclosure]') || []).map((node) => ({
      key: node.dataset.settingsDisclosure,
      open: node.querySelector('details')?.open === true,
    }));
  }

  function restoreDisclosures(root, state) {
    for (const node of root?.querySelectorAll?.('[data-settings-disclosure]') || []) {
      const previous = (state || []).find((item) => item.key === node.dataset.settingsDisclosure);
      const details = node.querySelector('details');
      if (previous && details) details.open = previous.open;
    }
  }

  // Same configured provider directory and model whitelist as system settings.
  let catalog = { status: 'idle', models: [], partial: false };
  let pickerValue = '';
  let saving = false;
  let autoApprovalSaving = false;
  function supportsAutoApproval() {
    return !NS.store.captureModelError && !!NS.store.captureSettings
      && NS.store.captureCapabilities?.autoApproval === true;
  }
  function autoApprovalControls() {
    const { T, esc } = NS;
    const known = !NS.store.captureModelError && !!NS.store.captureSettings;
    const supported = supportsAutoApproval();
    const on = supported && NS.store.captureSettings.autoApproval === true;
    const status = autoApprovalSaving ? T('cognition.settings_auto_confirmation_saving', '保存中…') : !known
      ? T('cognition.settings_policy_unknown', '状态未知') : on
        ? T('cognition.settings_discovery_allowed', '允许') : T('cognition.settings_auto_confirmation_off', '需逐条确认');
    return `<div class="ca-policy-row"><div class="ca-policy-copy">
      <div class="tt">${esc(T('cognition.settings_auto_confirmation_title', '自动确认'))}</div>
      <p class="sub">${esc(T('cognition.settings_auto_confirmation_hint', '默认关闭。开启后，原文依据完整、范围明确且无冲突的认知和 A/R 更新可自动保存；T 结构变化、冲突和不确定内容仍需人工确认。'))}</p>
      <p class="note">${esc(T('cognition.settings_auto_confirmation_history', '自动保存也会留下处理依据、来源和版本；可在系统活动的“已处理”查看，再到认知详情修改、暂停或撤回。'))}</p>
      ${known && !supported ? `<p class="note" role="status">${esc(T('cognition.settings_auto_confirmation_unavailable', '当前运行版本尚不支持自动确认；请保持逐条确认。'))}</p>` : ''}
    </div><div class="ca-policy-switch"><span class="note" role="status">${esc(status)}</span>${window.uiSwitch({
      label: T('cognition.settings_auto_confirmation_switch', '允许自动确认'), checked: on,
      disabled: !supported || autoApprovalSaving, attrs: { 'data-act': 'auto-approval-toggle' },
    })}</div></div>`;
  }
  async function toggleAutoApproval() {
    if (!supportsAutoApproval() || autoApprovalSaving) return;
    const on = NS.store.captureSettings.autoApproval !== true;
    autoApprovalSaving = true;
    NS.notify();
    try {
      if (on && !(await NS.confirmUser(NS.T('cognition.settings_auto_confirmation_confirm', '开启后，系统可自动保存原文依据完整、范围明确且无冲突的认知和 A/R 更新。T 结构变化、冲突和不确定内容仍由你确认；自动处理均保留依据与版本，可查、可改、可撤回。确认开启？')))) return;
      await NS.actions.updateCaptureSettings({ autoApproval: on });
    } finally { autoApprovalSaving = false; NS.notify(); }
  }
  const keyOf = (model) => JSON.stringify([model.provider, model.model]);
  function candidates() { return (NS.store.captureSettings?.modelCandidates || []).map(item => ({ provider: item.provider, model: item.model })); }
  async function loadModels(force = false) {
    if (catalog.status === 'loading' || (!force && catalog.status !== 'idle')) return;
    catalog = { ...catalog, status: 'loading' };
    NS.notify();
    try {
      const entries = await window.cogseed.invoke('auth.listEntries', { includeUnavailable: true });
      if (!entries?.ok || !Array.isArray(entries.entries)) throw new Error('model directory unavailable');
      const providers = new Map(entries.entries.filter(item => item.provider).map(item => [item.provider, item.providerLabel || item.provider]));
      const results = await Promise.allSettled(Array.from(providers, async ([provider, label]) => {
        const result = await window.cogseed.invoke('auth.listModels', { provider });
        if (!result?.ok || !Array.isArray(result.models)) throw new Error('model directory unavailable');
        return result.models.map(item => ({ provider, model: String(item.id), label: `${label} · ${item.name || item.id}`, available: entries.entries.some(entry => entry.provider === provider && entry.modelAvailable !== false) && item.available !== false }));
      }));
      const models = results.flatMap(result => result.status === 'fulfilled' ? result.value : []);
      // Bound manual model IDs may be absent from a provider's published catalog.
      const unique = new Map(models.map(item => [keyOf(item), item]));
      for (const entry of entries.entries) {
        if (!entry.provider || !entry.model) continue;
        const item = { provider: entry.provider, model: entry.model,
          label: `${entry.providerLabel || entry.provider} · ${entry.modelName || entry.model}`,
          available: entry.modelAvailable !== false };
        const existing = unique.get(keyOf(item));
        if (!existing || item.available) unique.set(keyOf(item), item);
      }
      catalog = { status: 'ready', models: Array.from(unique.values()), partial: results.some(result => result.status === 'rejected') };
    } catch {
      catalog = { ...catalog, status: 'error' };
    }
    NS.notify();
  }
  function modelControls() {
    const { T, esc } = NS;
    const selected = candidates();
    const blocked = saving || Boolean(NS.store.captureModelError) || !NS.store.captureSettings;
    const button = (key, fallback, act, index, disabled = blocked) => window.uiButton({
      label: T(key, fallback), size: 'sm', disabled,
      attrs: { 'data-act': act, ...(index === undefined ? {} : { 'data-index': String(index) }) },
    });
    const options = catalog.models.filter(item => item.available !== false && !selected.some(candidate => keyOf(candidate) === keyOf(item)));
    if (!options.some(item => keyOf(item) === pickerValue)) pickerValue = '';
    const rows = selected.map((item, index) => {
      const known = catalog.models.find(model => keyOf(model) === keyOf(item));
      const name = known ? known.label : `${item.provider} · ${item.model}`;
      const unavailable = catalog.status === 'ready' && (!known || known.available === false);
      const role = index === 0 ? T('cognition.settings_nightly_model_first', '首选模型')
        : T('cognition.settings_nightly_model_backup', '备用 {number}', { number: String(index) });
      return `<li><div class="ca-policy-copy"><div class="note">${esc(role)}</div><strong>${esc(name)}</strong>${unavailable ? `<p class="note">${esc(T('cognition.settings_nightly_model_unavailable', '系统配置中已停用或移除'))}</p>` : ''}</div><div class="actions">${button('cognition.settings_nightly_model_up', '上移', 'nightly-model-up', index, blocked || index === 0)}${button('cognition.settings_nightly_model_down', '下移', 'nightly-model-down', index, blocked || index === selected.length - 1)}${button('cognition.settings_nightly_model_remove', '移除', 'nightly-model-remove', index)}</div></li>`;
    }).join('');
    const label = T('cognition.settings_nightly_model_title', '夜间发现模型');
    const picker = window.uiField({ id: 'ca-nightly-model-picker', showRequirement: false,
      label: T(selected.length ? 'cognition.settings_nightly_model_add' : 'cognition.settings_nightly_model_choose_first', selected.length ? '添加备用模型' : '选择专用首选模型'),
      control: { kind: 'select', native: true, value: pickerValue,
        disabled: blocked || catalog.status !== 'ready' || !options.length,
        options: [{ value: '', label: T('cognition.settings_nightly_model_pick', '请选择模型') }, ...options.map(item => ({ value: keyOf(item), label: item.label }))] } });
    const state = catalog.status === 'error' ? T('cognition.settings_nightly_model_error', '模型列表读取失败，已保存的顺序保持不变。')
      : catalog.status !== 'ready' ? T('cognition.settings_nightly_model_loading', '正在读取系统模型列表…')
      : catalog.partial ? T('cognition.settings_nightly_model_partial', '部分模型目录未读到，仍可选择系统已配置的模型。')
      : !options.length ? T(selected.length ? 'cognition.settings_nightly_model_all_added' : 'cognition.settings_nightly_model_empty', selected.length ? '已添加所有可选模型。' : '系统中没有可选模型。') : '';
    const system = NS.store.captureModel || {};
    const knownSystem = catalog.models.find(item => item.provider === system.provider && item.model === system.model);
    const systemName = system.provider && system.model ? (knownSystem?.label || `${system.provider} · ${system.model}`) : '';
    const systemCurrent = NS.store.captureModelError ? T('cognition.settings_nightly_model_system_unknown', '暂未读到系统首选模型。') : systemName ? T('cognition.settings_nightly_model_system_first', '系统首选：{model}', { model: systemName })
      : system.channel === 'cli' ? T('cognition.settings_nightly_model_system_cli', '未配置系统模型，将使用可用的本地助手；具体模型由本地助手决定。')
      : T('cognition.settings_nightly_model_system_unknown', '暂未读到系统首选模型。');
    return `<div class="ca-policy-row"><div class="ca-policy-copy ca-nightly-model-controls"><div class="tt">${esc(label)}</div>
      <p class="sub">${esc(T(selected.length ? 'cognition.settings_nightly_model_custom' : 'cognition.settings_nightly_model_system', selected.length ? '使用夜间专用顺序' : '跟随系统模型顺序'))}</p>
      ${selected.length ? `<ol class="ca-nightly-model-list">${rows}</ol>` : `<p class="note">${esc(systemCurrent)}</p>`}
      <p class="note">${esc(T(selected.length ? 'cognition.settings_nightly_model_hint' : 'cognition.settings_nightly_model_system_hint', selected.length ? '摘要、价值判断和提取都按保存的顺序尝试。前一个模型重试后仍无法调用，才尝试下一个；内容不合格不会靠换模型跳过检查。思考强度等参数沿用系统设置。' : '摘要、价值判断和提取沿用系统设置的模型顺序与调用参数。选择专用首选模型后，可另设备用顺序。'))}</p>
      <div class="ca-nightly-model-picker-row">${picker}<div class="actions">${button(saving ? 'cognition.settings_nightly_model_saving' : selected.length ? 'cognition.settings_nightly_model_add' : 'cognition.settings_nightly_model_primary', saving ? '正在保存…' : selected.length ? '添加备用模型' : '设为首选模型', 'nightly-model-add', undefined, blocked || catalog.status !== 'ready' || !pickerValue || selected.length >= 32)}</div></div>
      <div class="actions">${selected.length ? button('cognition.settings_nightly_model_reset', '恢复跟随系统', 'nightly-model-reset') : ''}${catalog.status === 'error' || catalog.partial ? button('cognition.settings_nightly_model_retry', '重试读取', 'nightly-model-retry', undefined, saving) : ''}</div>
      ${state ? `<p class="note" role="status">${esc(state)}</p>` : ''}</div></div>`;
  }
  function modelInput(event, root) {
    if (event.target?.id !== 'ca-nightly-model-picker') return;
    pickerValue = String(event.target.value || '');
    const item = catalog.models.find(model => keyOf(model) === pickerValue);
    const add = root.querySelector('[data-act="nightly-model-add"]');
    if (add) {
      add.disabled = saving || Boolean(NS.store.captureModelError) || !NS.store.captureSettings
        || catalog.status !== 'ready' || !item || item.available === false || candidates().length >= 32
        || candidates().some(candidate => keyOf(candidate) === pickerValue);
      add.classList.toggle('is-disabled', add.disabled);
    }
  }

  async function modelAction(action, element, root) {
    if (action === 'nightly-model-retry') { await loadModels(true); return; }
    if (saving || NS.store.captureModelError || !NS.store.captureSettings) return;
    const selected = candidates();
    const index = Number(element.dataset.index);
    if (action === 'nightly-model-add') {
      const value = root.querySelector('#ca-nightly-model-picker')?.value || pickerValue;
      const item = catalog.models.find(model => keyOf(model) === value);
      if (!item || item.available === false || selected.length >= 32 || selected.some(candidate => keyOf(candidate) === keyOf(item))) return;
      selected.push({ provider: item.provider, model: item.model });
    } else if (action === 'nightly-model-reset') selected.length = 0;
    else {
      if (!Number.isInteger(index) || index < 0 || index >= selected.length) return;
      if (action === 'nightly-model-remove') selected.splice(index, 1);
      else {
        const target = index + (action === 'nightly-model-up' ? -1 : 1);
        if (target < 0 || target >= selected.length) return;
        [selected[index], selected[target]] = [selected[target], selected[index]];
      }
    }
    saving = true;
    NS.notify();
    try { await NS.actions.updateCaptureSettings({ modelCandidates: selected }); pickerValue = ''; }
    finally { saving = false; NS.notify(); }
  }
  window.addEventListener?.('cogseed:model-entries-changed', () => { if (NS.store.route?.name === 'settings') void loadModels(true); else catalog.status = 'idle'; });
  NS.assetSettings = { discoveryStatus, captureDisclosures, restoreDisclosures, loadModels, modelControls, modelAction, modelInput, supportsAutoApproval, autoApprovalControls, toggleAutoApproval };
})();
