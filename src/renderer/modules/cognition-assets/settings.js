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

  // Model rows are a business-owned composition (COG-PV-020), using shared
  // controls and modal lifecycle. The backend owns the configured model set.
  let catalog = { status: 'idle', models: [] };
  let catalogRead = 0;
  let saving = false;
  let picker = null;
  let pickerError = '';
  let pendingModel = '';
  let autoApprovalSaving = false;
  function supportsAutoApproval() {
    return !NS.store.captureModelError && !!NS.store.captureSettings
      && NS.store.captureCapabilities?.autoApproval === true;
  }
  function settingCard({ title, hint, controls, bodyHtml }) {
    const { esc } = NS;
    return window.uiCard({
      tag: 'section',
      className: 'ca-setting-card',
      bodyHtml: `<div class="ca-setting-head"><div class="ca-setting-head-copy"><div class="tt">${esc(title)}</div>${hint ? `<p class="note">${esc(hint)}</p>` : ''}</div><div class="ca-setting-head-ctl">${controls || ''}</div></div>${bodyHtml ? `<div class="ca-setting-body">${bodyHtml}</div>` : ''}`,
    });
  }
  function autoApprovalControls() {
    const { T, esc } = NS;
    const known = !NS.store.captureModelError && !!NS.store.captureSettings;
    const supported = supportsAutoApproval();
    const on = supported && NS.store.captureSettings.autoApproval === true;
    const status = autoApprovalSaving ? T('cognition.settings_auto_confirmation_saving', '保存中…') : !known
      ? T('cognition.settings_policy_unknown', '状态未知') : on
        ? T('cognition.settings_discovery_allowed', '允许') : T('cognition.settings_auto_confirmation_off', '需逐条确认');
    const flowNote = NS.store.captureSettings?.autoApproval === true && supported
      ? T('cognition.settings_nightly_auto_review_hint', '符合自动确认规则的完整建议保存后进入“已处理”；其余完整建议留在“需要关注”，由你决定。')
      : T('cognition.settings_nightly_review_hint', '完整建议进入“需要关注”，由你确认后保存到“我的认知”。');
    return settingCard({
      title: T('cognition.settings_auto_confirmation_title', '自动确认'),
      controls: `${window.uiStatusPill({ label: status, tone: on ? 'success' : 'neutral' })}${window.uiSwitch({
        label: T('cognition.settings_auto_confirmation_switch', '允许自动确认'), checked: on,
        disabled: !supported || autoApprovalSaving, attrs: { 'data-act': 'auto-approval-toggle' },
      })}`,
      bodyHtml: `<p class="note">${esc(T('cognition.settings_auto_confirmation_hint', '默认关闭。开启后，原文依据完整、范围明确且无冲突的认知和 A/R 更新可自动保存；T 结构变化、冲突和不确定内容仍需人工确认。'))}</p>
        <p class="note">${esc(T('cognition.settings_auto_confirmation_history', '自动保存也会留下处理依据、来源和版本；可在系统活动的“已处理”查看，再到认知详情修改、暂停或撤回。'))}</p>
        ${known && !supported ? `<p class="note" role="status">${esc(T('cognition.settings_auto_confirmation_unavailable', '当前运行版本尚不支持自动确认；请保持逐条确认。'))}</p>` : ''}
        <p class="note">${esc(flowNote)}</p>`,
    });
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
  function effectiveModels() {
    const selected = candidates();
    if (!selected.length) return catalog.models.slice(0, 1);
    return selected.map(item => catalog.models.find(model => keyOf(model) === keyOf(item)) || {
      ...item, label: `${item.provider} · ${item.model}`, configured: false,
    });
  }
  async function loadModels(force = false) {
    if (!force && catalog.status !== 'idle') return;
    const generation = ++catalogRead;
    if (!force && Array.isArray(NS.store.captureModelSelection?.configured)) {
      catalog = { status: 'ready', models: NS.store.captureModelSelection.configured };
      NS.notify();
      renderPicker();
      return;
    }
    catalog = { ...catalog, status: 'loading' };
    NS.notify();
    renderPicker();
    try {
      const result = await window.cogseed.invoke('recall.captures.settings.get', {});
      if (!result?.ok || !Array.isArray(result.modelSelection?.configured)) throw new Error('model directory unavailable');
      if (generation !== catalogRead) return;
      catalog = { status: 'ready', models: result.modelSelection.configured };
    } catch {
      if (generation !== catalogRead) return;
      catalog = { ...catalog, status: 'error' };
    }
    NS.notify();
    renderPicker();
  }
  function modelNote(item) {
    if (item.available === false) return NS.T('cognition.settings_nightly_model_unavailable', '系统配置中已停用或移除');
    if (item.configured === false) return NS.T('cognition.settings_nightly_model_legacy', '已不在设置列表，保留原配置');
    return '';
  }
  function modelIdentity(item) {
    const label = item.label || `${item.provider} · ${item.model}`;
    const divider = label.indexOf(' · ');
    return { title: divider < 0 ? item.model : label.slice(divider + 3),
      provider: divider < 0 ? item.provider : label.slice(0, divider) };
  }
  // Shared card shell; only the model identity, status and actions are page-owned.
  // The title button stretches its native click target over interactive cards.
  function modelCard({ title, provider, label, icon = 'cpu', status = '', actions = '', action = null, note = '' }) {
    const { esc } = NS;
    const heading = action ? window.uiButton({ label: title, role: 'ghost', className: 'ca-nightly-model-hit', ...action })
      : `<strong class="ca-nightly-model-name">${esc(title)}</strong>`;
    return window.uiCard({ tag: 'div', className: 'ca-nightly-model-card', readonly: !action,
      attrs: { 'aria-label': label, ...(action ? {} : { 'data-readonly': 'true' }) },
      bodyHtml: `<span class="ui-resource-card__icon">${window.uiIconHtml(icon)}</span><div class="ca-nightly-model-copy">${heading}<span class="ca-nightly-model-provider">${esc(provider)}</span>${note ? `<span class="ca-nightly-model-note">${esc(note)}</span>` : ''}</div><div class="ca-nightly-model-trailing">${status}${actions}</div>`,
    });
  }
  function modelControls() {
    const { T, esc } = NS;
    const selected = candidates();
    const models = effectiveModels();
    const blocked = saving || Boolean(NS.store.captureModelError) || !NS.store.captureSettings;
    const button = (key, fallback, act, index, disabled = blocked) => window.uiButton({
      label: T(key, fallback), size: 'sm', disabled,
      attrs: { 'data-act': act, ...(index === undefined ? {} : { 'data-index': String(index) }) },
    });
    const rows = models.map((item, index) => {
      const role = index === 0 ? T('cognition.settings_nightly_model_first', '首选模型')
        : T('cognition.settings_nightly_model_backup', '备用 {number}', { number: String(index) });
      const action = (key, fallback, icon, act, disabled = blocked) => window.uiIconButton({ icon, label: T(key, fallback), size: 'sm', disabled,
        attrs: { 'data-act': act, 'data-index': String(index) } });
      const actions = selected.length ? `<div class="actions">${action('cognition.settings_nightly_model_up', '上移', 'chevron-up', 'nightly-model-up', blocked || index === 0)}${action('cognition.settings_nightly_model_down', '下移', 'chevron-down', 'nightly-model-down', blocked || index === models.length - 1)}${action('cognition.settings_nightly_model_remove', '移除', 'x', 'nightly-model-remove')}</div>` : '';
      return `<li>${modelCard({ ...modelIdentity(item), label: item.label, note: modelNote(item),
        status: window.uiStatusPill({ label: role, tone: 'neutral' }), actions })}</li>`;
    }).join('');
    const state = catalog.status === 'error' ? T('cognition.settings_nightly_model_error', '模型列表读取失败，已保存的顺序保持不变。')
      : catalog.status !== 'ready' ? T('cognition.settings_nightly_model_loading', '正在读取系统模型列表…')
      : !models.length ? T(NS.store.captureModel?.channel === 'cli' ? 'cognition.settings_nightly_model_system_cli'
        : NS.store.captureModel?.apiConfigured ? 'cognition.settings_nightly_model_environment' : 'cognition.settings_nightly_model_empty',
        NS.store.captureModel?.channel === 'cli' ? '未配置系统模型，将使用可用的本地助手；具体模型由本地助手决定。'
          : NS.store.captureModel?.apiConfigured ? '未配置系统模型，将使用环境变量配置的模型。' : '系统中没有可选模型。') : '';
    const addLabel = T('cognition.settings_nightly_model_add_row', '添加模型');
    const add = modelCard({ title: addLabel,
      provider: T('cognition.settings_nightly_model_add_source', '从设置中选择已配置的模型'), label: addLabel, icon: 'plus',
      actions: window.uiIconHtml('chevron-right', 'ca-nightly-model-chevron'),
      action: { disabled: blocked || catalog.status !== 'ready' || !catalog.models.length || models.length >= 32,
        attrs: { 'data-act': 'nightly-model-add', 'aria-haspopup': 'dialog' } } });
    const body = `<div class="ca-nightly-model-controls"${saving ? ' aria-busy="true"' : ''}>
      <ol class="ca-nightly-model-list">${rows}<li>${add}</li></ol>
      <p class="note">${esc(T('cognition.settings_nightly_model_hint', '按列表顺序调用，前一个模型重试后仍不可用时尝试下一个。'))}</p>
      ${state ? `<p class="note" role="status">${esc(state)}</p>` : ''}
      ${saving ? `<p class="note" role="status">${esc(T('cognition.settings_nightly_model_saving', '正在保存…'))}</p>` : ''}
      <div class="actions">${selected.length ? button('cognition.settings_nightly_model_reset', '恢复跟随系统', 'nightly-model-reset') : ''}${catalog.status === 'error' ? button('cognition.settings_nightly_model_retry', '重试读取', 'nightly-model-retry', undefined, saving) : ''}</div>
    </div>`;
    return `<div class="ca-model-fold-slot" data-settings-disclosure="nightly-model"><details class="settings-model-form__advanced ca-model-fold"><summary><span>${esc(T('cognition.settings_nightly_model_title', '夜间发现模型'))}</span><span class="note ca-model-fold-meta">${esc(T(selected.length ? 'cognition.settings_nightly_model_custom' : 'cognition.settings_nightly_model_system', selected.length ? '使用夜间专用顺序' : '跟随系统首个模型'))}</span></summary>${body}</details></div>`;
  }
  function pickerBody() {
    const { T, esc } = NS;
    const models = effectiveModels();
    return `<div class="ca-nightly-model-picker" aria-busy="${saving}"><ul class="ca-nightly-model-list">${catalog.models.map(item => {
      const added = models.some(model => keyOf(model) === keyOf(item));
      const note = added ? T('cognition.settings_nightly_model_added', '已添加') : modelNote(item);
      const selectable = !added && item.available;
      const busy = saving && pendingModel === keyOf(item);
      const status = busy ? window.uiStatusPill({ label: T('cognition.settings_nightly_model_saving', '正在保存…'), tone: 'neutral' })
        : note ? window.uiStatusPill({ label: added ? note : T('cognition.settings_nightly_model_unavailable_short', '不可用'), tone: added ? 'success' : 'attention', check: added }) : window.uiIconHtml('plus', 'ca-nightly-model-chevron');
      return `<li>${modelCard({ ...modelIdentity(item), label: item.label,
        status, note: !added && note ? note : '',
        action: selectable ? { disabled: saving || catalog.status !== 'ready' || models.length >= 32,
          loading: busy, attrs: { 'data-model-key': keyOf(item), 'aria-label': `${item.label} — ${T('cognition.settings_nightly_model_add_row', '添加模型')}` } } : null })}</li>`;
    }).join('')}</ul>${pickerError ? `<p class="ui-form-modal__feedback" role="alert">${esc(pickerError)}</p>` : ''}${catalog.status === 'error' ? `<p role="alert">${esc(T('cognition.settings_nightly_model_error', '模型列表读取失败，已保存的顺序保持不变。'))}</p>` : ''}</div>`;
  }
  function renderPicker() {
    if (!picker) return;
    const { T } = NS;
    const focused = picker.dialog.querySelector(':focus')?.dataset.modelKey;
    picker.dialog.querySelector('.ui-modal__title').textContent = T('cognition.settings_nightly_model_choose', '选择模型');
    picker.dialog.querySelector('[data-ui-modal-close]').setAttribute('aria-label', T('common.close', '关闭'));
    picker.dialog.querySelector('.ui-modal__body').innerHTML = pickerBody();
    if (saving) picker.dialog.focus();
    else if (focused || pickerError) Array.from(picker.dialog.querySelectorAll('[data-model-key]')).find(node => node.dataset.modelKey === (focused || pendingModel))?.focus();
  }
  async function saveModels(selected) {
    saving = true;
    NS.notify();
    renderPicker();
    try { await NS.actions.updateCaptureSettings({ modelCandidates: selected.map(item => ({ provider: item.provider, model: item.model })) }); }
    finally { saving = false; NS.notify(); }
  }
  async function openModelPicker(root) {
    if (picker || catalog.status !== 'ready') return;
    pickerError = '';
    const modal = window.uiModal({ title: NS.T('cognition.settings_nightly_model_choose', '选择模型'),
      closeLabel: NS.T('common.close', '关闭'), size: 'md', bodyHtml: pickerBody(), initialFocus: '[data-model-key]:not([disabled])' });
    picker = modal;
    const onChoose = async event => {
      const control = event.target.closest('[data-model-key]');
      if (!control || control.disabled || saving) return;
      const item = catalog.models.find(model => keyOf(model) === control.dataset.modelKey);
      const selected = effectiveModels();
      if (!item?.available || selected.some(model => keyOf(model) === keyOf(item)) || selected.length >= 32) return;
      pendingModel = keyOf(item);
      pickerError = '';
      try {
        await saveModels([...selected, item]);
        modal.close(null, 'saved');
      } catch {
        pickerError = NS.T('cognition.settings_nightly_model_save_error', '未能保存模型列表，请重试。');
        renderPicker();
      }
    };
    modal.dialog.addEventListener('click', onChoose);
    await modal;
    modal.dialog.removeEventListener('click', onChoose);
    if (picker === modal) picker = null;
    root?.querySelector('[data-act="nightly-model-add"]')?.focus();
  }
  async function modelAction(action, element, root) {
    if (action === 'nightly-model-retry') { await loadModels(true); return; }
    if (saving || NS.store.captureModelError || !NS.store.captureSettings) return;
    if (action === 'nightly-model-add') { await openModelPicker(root); return; }
    const selected = candidates();
    const index = Number(element.dataset.index);
    if (action === 'nightly-model-reset') selected.length = 0;
    else {
      if (!Number.isInteger(index) || index < 0 || index >= selected.length) return;
      if (action === 'nightly-model-remove') selected.splice(index, 1);
      else if (action === 'nightly-model-up' || action === 'nightly-model-down') {
        const target = index + (action === 'nightly-model-up' ? -1 : 1);
        if (target < 0 || target >= selected.length) return;
        [selected[index], selected[target]] = [selected[target], selected[index]];
      } else return;
    }
    await saveModels(selected);
  }
  window.addEventListener?.('cogseed:model-entries-changed', () => {
    NS.store.captureModelSelection = null;
    if (NS.store.route?.name === 'settings' || picker) void loadModels(true);
    else { ++catalogRead; catalog.status = 'idle'; }
  });
  window.addEventListener?.('i18n-change', renderPicker);
  NS.assetSettings = { discoveryStatus, captureDisclosures, restoreDisclosures, loadModels, modelControls, modelAction, supportsAutoApproval, autoApprovalControls, toggleAutoApproval, settingCard };
})();
