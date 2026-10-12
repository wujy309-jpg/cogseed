/* 我的认知：正式资产目录、筛选和详情工作台。所有写入复用既有 IPC 动作。 */
(function () {
  'use strict';
  const NS = window.CogAssets;
  if (!NS) return;
  const { T, esc } = NS;
  const S = NS.store;
  const { btn, hero, empty, categoryLabel, CATEGORIES } = NS.ui;
  const PAGE_SIZE = 20;
  const state = S.libraryView = { query: '', type: '', status: 'library', scope: '', sort: 'recent', page: 1, drawer: false, closed: false, dirty: false, manualScope: {}, manualDraft: {} };
  let lastCategory = '';
  let busy = false;
  const actions = ['library-select', 'library-page', 'library-clear', 'library-close', 'library-refresh', 'library-review-conflict', 'library-open-inbox', 'library-filter-toggle', 'library-filter-option', 'library-show-sources', 'library-show-versions', 'library-show-records', 'library-show-merge', 'library-organize'];
  const statusOf = a => String(a.status || 'active');
  const isNarrow = () => typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 960px), (max-height: 480px)').matches;
  function scopeNames(a) {
    const policy = a.scopePolicy || {};
    const dirs = S.assetScopeOptions || {};
    const list = (values, options, idKey) => (values || []).map((id, index) => String((options || []).find(o => String(o[idKey]) === String(id))?.name
      || T(idKey === 'agent_id' ? 'cognition.asset_scope_missing_agent' : 'cognition.asset_scope_missing_space', idKey === 'agent_id' ? '已不可用的旧智能体限制 {n}' : '已不可用的旧工作空间限制 {n}', { n: String(index + 1) })));
    const parts = [
      ...list(policy.workspaceIds, dirs.spaces, 'space_id'),
      ...list(policy.agentIds, dirs.agents, 'agent_id'),
      ...(policy.projectIds || []), ...(policy.purposeTags || []),
    ];
    if (Object.values(policy).some(v => Array.isArray(v) && v.length === 0)) parts.push(T('cognition.library_scope_none', '存在禁止使用的范围'));
    return parts.length ? parts.join(' · ') : T('cognition.library_scope_open', '未限定使用对象');
  }
  function uses(a) { return NS.ui.broughtInCountFor ? NS.ui.broughtInCountFor(a.id) : 0; }
  function filtered() {
    const query = state.query.trim().toLocaleLowerCase();
    const types = new Set(CATEGORIES.map(([id]) => id));
    const rows = (S.assets || []).filter(a => {
      if (!types.has(a.type) || ['purged', 'revoked'].includes(statusOf(a))) return false;
      if (state.status === 'library' ? !['active', 'paused'].includes(statusOf(a)) : state.status !== 'all' && statusOf(a) !== state.status) return false;
      if (state.type && a.type !== state.type) return false;
      if (state.scope === 'restricted' && !Object.values(a.scopePolicy || {}).some(v => Array.isArray(v))) return false;
      if (state.scope && state.scope !== 'restricted' && !(a.scopePolicy?.workspaceIds || []).includes(state.scope)) return false;
      return !query || [a.title, a.statement, a.scope, scopeNames(a)].join(' ').toLocaleLowerCase().includes(query);
    });
    // 按使用次数排序时先对 rows 预计算一次计数：uses() 每次调用都会全量遍历
    // 时间线证明（taskExposureProofs 扫 S.proofs），放在比较器里就是
    // N·logN 次全量扫描——资产/证明规模大时单次渲染数百万次冗余迭代。
    const usesByAsset = state.sort === 'used' ? new Map(rows.map(a => [String(a.id), uses(a)])) : null;
    return rows.sort((a, b) => (state.sort === 'name' ? String(a.title || '').localeCompare(String(b.title || ''), undefined, { numeric: true })
      : state.sort === 'used' ? (usesByAsset.get(String(b.id)) || 0) - (usesByAsset.get(String(a.id)) || 0)
        : String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')))
      || String(a.id).localeCompare(String(b.id)));
  }
  function currentRows() {
    const rows = filtered();
    state.page = Math.min(Math.max(1, state.page), Math.max(1, Math.ceil(rows.length / PAGE_SIZE)));
    return { rows, pageRows: rows.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE) };
  }
  function syncSelection() {
    const route = S.route || {};
    if (route.name !== 'overview' || route.experienceId || route.category === 'experiences') {
      const tabs = document.getElementById?.('ca-tabs-nav');
      if (tabs) tabs.inert = false;
      return;
    }
    const category = String(route.category || '');
    if (category !== lastCategory) {
      if (category === 'deleted') state.status = 'deleted';
      else if (CATEGORIES.some(([id]) => id === category)) state.type = category;
      lastCategory = category;
    }
    if (!route.assetId && !route.candCreate && !state.closed && !S.assetsError) {
      const first = currentRows().pageRows[0];
      if (first) S.route.assetId = String(first.id);
    }
  }
  if (NS.onChange) NS.onChange(syncSelection);
  function filterControl(key, label, options) {
    const selected = options.find(([value]) => value === state[key]);
    const native = window.uiSelect({ id: `ca-library-${key}`, native: true, ariaLabel: label, className: 'ca-library-filter-native', value: state[key], options: options.map(([value, text]) => ({ value, label: text })), attrs: { 'data-library-filter': key } });
    const trigger = window.uiButton({ label: selected?.[1] || label, labelPrefix: label, iconEnd: 'chevron-down', className: 'ca-library-filter-trigger', attrs: { role: 'combobox', 'aria-label': `${label} ${selected?.[1] || ''}`, 'aria-haspopup': 'listbox', 'aria-expanded': 'false', 'aria-controls': `ca-library-options-${key}`, 'data-act': 'library-filter-toggle', 'data-id': key } });
    const choices = options.map(([value, text]) => window.uiButton({ label: text, iconEnd: 'check', className: `ca-library-filter-option${value === state[key] ? ' is-selected' : ''}`, attrs: { role: 'option', 'aria-selected': value === state[key] ? 'true' : 'false', 'data-act': 'library-filter-option', 'data-id': key, 'data-value': value } })).join('');
    return `<div class="ca-library-filter" data-library-filter-key="${key}" data-filter-kind="cog-${key}">${native}${trigger}<div class="ca-library-filter-popover" id="ca-library-options-${key}" role="listbox" hidden>${choices}</div></div>`;
  }
  function statusLabel(a) {
    const key = statusOf(a);
    return key === 'active' ? T('cognition.library_active', '启用') : key === 'paused' ? T('cognition.library_paused', '暂停')
      : key === 'deleted' ? T('cognition.library_deleted', '已删除') : a.mergedInto ? T('cognition.library_merged', '已归并') : T('cognition.library_archived', '归档');
  }
  function render(route) {
    syncSelection();
    const { rows, pageRows } = currentRows();
    const selected = (S.assets || []).find(a => String(a.id) === String(route.assetId));
    const dirs = S.assetScopeOptions || {};
    const scopes = [['', T('cognition.library_all_scopes', '所有范围')], ['restricted', T('cognition.library_restricted', '有指定对象限制')], ...(dirs.spaces || []).map(s => [s.space_id, s.name || s.space_id])];
    const hasFilter = state.query || state.type || state.scope || state.status !== 'library';
    const emptyHtml = S.assetsError && !S.assets.length ? empty(T('cognition.library_read_failed', '认知内容未能读取'), T('cognition.library_read_retry', '请重试读取，已有数据不会被清空。'), { label: T('common.retry', '重试'), attrs: { 'data-act': 'library-refresh' } })
      : empty(hasFilter ? T('cognition.library_no_match', '没有匹配内容') : T('cognition.library_empty', '这里还没有已保存的认知'), T('cognition.library_empty_hint', '可以手动添加，或前往系统活动核对新建议。'), { label: hasFilter ? T('cognition.library_clear', '清空筛选') : T('cognition.settings_activity_link', '查看系统活动 ›'), attrs: { 'data-act': hasFilter ? 'library-clear' : 'go-review' } });
    const table = pageRows.length ? `<table class="ca-library-table"><thead><tr><th>${esc(T('cognition.library_content', '内容'))}</th><th>${esc(T('cognition.library_type', '类型'))}</th><th>${esc(T('cognition.library_range', '范围'))}</th><th>${esc(T('cognition.library_status', '状态'))}</th></tr></thead><tbody>${pageRows.map(a => `<tr role="button" tabindex="0" data-act="library-select" data-id="${esc(a.id)}" aria-label="${esc(a.title || a.id)}" aria-pressed="${String(a.id) === String(route.assetId)}" class="${String(a.id) === String(route.assetId) ? 'is-selected' : ''}"><td><strong>${esc(a.title || a.id)}</strong><p>${esc(String(a.statement || '').split('\n').filter(Boolean)[0]?.slice(0, 180) || '')}</p></td><td>${esc(categoryLabel(a.type))}</td><td>${esc(scopeNames(a))}</td><td>${esc(statusLabel(a))}<span aria-hidden="true">›</span></td></tr>`).join('')}</tbody></table>` : emptyHtml;
    const detail = route.candCreate === '1' ? NS.renderLibraryManualForm()
      : selected ? NS.renderLibraryAssetDetail(selected, route) : `<div class="ca-library-detail-empty">${empty(T('cognition.library_select', '选择一项查看内容'), T('cognition.library_select_hint', '内容、依据与可用操作会在这里展开。'))}</div>`;
    const drawer = isNarrow() && (state.drawer || route.candCreate === '1' || route.assetEdit === '1');
    return `<section class="ca-library-page" data-library-selected="${esc(route.candCreate === '1' ? 'new' : `${route.assetId || ''}${route.assetEdit ? ':edit' : ''}`)}">
      ${hero(T('cognition.tab_overview', '我的认知'), T('cognition.library_intro', '查找已保存的内容，理解依据，再决定如何使用。'))}
      <div class="ca-library-toolbar"><div class="ca-prototype-search">${window.uiIconHtml('cognition-search')}${window.uiInput({ id: 'ca-library-search', value: state.query, type: 'search', placeholder: T('cognition.library_search', '搜索标题、正文或范围'), attrs: { 'aria-label': T('cognition.library_search', '搜索标题、正文或范围') } })}</div><span class="note"${S.assetsError ? ' role="alert"' : ''}>${esc(S.assetsError ? T('cognition.library_partial', '读取失败 · 当前显示上次读取的内容') : S.loading ? T('common.loading', '加载中…') : T('cognition.activity_updated', '已更新'))}</span>${btn(T('common.refresh', '刷新'), 'library-refresh', { small: true })}</div>
      <div class="ca-library-filters">${filterControl('type', T('cognition.library_type', '类型'), [['', T('cognition.library_all_types', '所有类型')], ...CATEGORIES.map(([id, key, fallback]) => [id, T(key, fallback)])])}${filterControl('status', T('cognition.library_status', '状态'), [['library', T('cognition.library_in_library', '全部在库')], ['active', T('cognition.library_active', '启用')], ['paused', T('cognition.library_paused', '暂停')], ['archived', T('cognition.library_archived_merged', '归档 / 已归并')], ['deleted', T('cognition.library_deleted', '已删除')], ['all', T('cognition.library_all_status', '所有状态')]])}${filterControl('scope', T('cognition.library_range', '范围'), scopes)}${filterControl('sort', T('cognition.library_sort', '排序'), [['recent', T('cognition.library_recent', '最近修改')], ['name', T('cognition.library_name', '名称')], ['used', T('cognition.library_used', '带入或读取次数')]])}${hasFilter ? btn(T('cognition.library_clear', '清空筛选'), 'library-clear', { small: true, className: 'rnm' }) : ''}<div class="actions ca-library-filter-actions">${btn(T('cognition.library_organize', '整理已有认知'), 'library-organize', { small: true, className: 'rnm' })}${btn(T('cognition.cand_create_entry', '手动添加'), 'cand-create', { primary: true, small: true })}</div></div>
      
      <div class="ca-library-layout"><div class="ca-library-list"><div class="ca-library-table-wrap" id="ca-asset-list">${table}</div><div class="ca-library-pagination"><span>${esc(T('cognition.library_page_count', '每页 20 条 · {start}–{end} / {total}', { start: String(rows.length ? (state.page - 1) * PAGE_SIZE + 1 : 0), end: String(Math.min(state.page * PAGE_SIZE, rows.length)), total: String(rows.length) }))}${S.assetsError ? ` · ${esc(T('cognition.library_cached', '上次读取'))}` : ''}</span><div>${btn(T('common.previous', '上一页'), 'library-page', { small: true, id: '-1', disabled: state.page <= 1 })}<span>${state.page}/${Math.max(1, Math.ceil(rows.length / PAGE_SIZE))}</span>${btn(T('common.next', '下一页'), 'library-page', { small: true, id: '1', disabled: state.page * PAGE_SIZE >= rows.length })}</div></div><p class="note ca-library-footnote">${esc(T('cognition.library_use_hint', '启用不代表所有任务自动使用；仍需满足范围、来源与任务条件。'))}</p></div>
      ${drawer ? window.uiButton({ label: T('common.close', '关闭'), role: 'ghost', className: 'ca-library-scrim', attrs: { 'data-act': 'library-close', 'aria-hidden': 'true' } }) : ''}<aside class="ca-library-detail${drawer ? ' is-drawer-open' : ''}" role="${drawer ? 'dialog' : 'complementary'}"${drawer ? ' aria-modal="true"' : ''} aria-label="${esc(T('cognition.library_detail', '认知详情'))}">${detail}</aside></div></section>`;
  }
  function resetSelection() {
    state.closed = false;
    state.drawer = false;
    NS.router.go({ name: 'overview', assetId: '', candCreate: '', assetEdit: '' }, { replace: true });
  }
  async function guardNavigation() {
    if (!state.dirty) return true;
    if (!(await NS.confirmUser(T('cognition.library_unsaved', '有未保存的修改。放弃这些修改并继续？')))) return false;
    const drafts = Object.assign({}, S.assetEditDrafts || {});
    delete drafts[String(S.route.assetId || '')];
    S.assetEditDrafts = drafts;
    state.dirty = false;
    state.manualScope = {}; state.manualDraft = {};
    return true;
  }
  async function handleClick(el) {
    const action = el.dataset.act;
    if (!actions.includes(action)) return false;
    if (busy || el.disabled) return true;
    if (action === 'library-filter-toggle') {
      const filter = el.closest('.ca-library-filter');
      const menu = filter.querySelector('[role="listbox"]');
      const open = menu.hidden;
      for (const other of document.querySelectorAll('.ca-library-filter-popover')) other.hidden = true;
      for (const trigger of document.querySelectorAll('.ca-library-filter-trigger')) trigger.setAttribute('aria-expanded', 'false');
      menu.hidden = !open; el.setAttribute('aria-expanded', String(open));
      if (open) {
        const rect = el.getBoundingClientRect();
        const below = window.innerHeight - rect.bottom - 10, above = rect.top - 10;
        const useBelow = below >= Math.min(180, menu.scrollHeight) || below >= above;
        const maxHeight = Math.max(80, Math.min(320, useBelow ? below : above));
        menu.style.width = rect.width + 'px'; menu.style.maxHeight = maxHeight + 'px';
        menu.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - rect.width - 8)) + 'px';
        menu.style.top = (useBelow ? rect.bottom + 6 : Math.max(8, rect.top - Math.min(menu.scrollHeight, maxHeight) - 6)) + 'px';
        menu.querySelector('[aria-selected="true"]')?.focus();
      }
      return true;
    }
    if (action === 'library-organize') {
      if (!(await guardNavigation())) return true;
      await NS.showCleanupDialog(true); return true;
    }
    if (action.startsWith('library-show-')) {
      await NS.showLibraryDialog(action.slice('library-show-'.length), el.dataset.id); return true;
    }
    if (!['library-review-conflict'].includes(action) && !(await guardNavigation())) return true;
    if (action === 'library-filter-option') {
      const key = el.dataset.id;
      if (!['type', 'status', 'scope', 'sort'].includes(key)) return true;
      state[key] = el.dataset.value || ''; state.page = 1; resetSelection();
      document.querySelector('.ca-library-filter-trigger[data-id="' + key + '"]')?.focus();
    } else if (action === 'library-select') {
      state.drawer = true; state.closed = false;
      NS.router.go({ name: 'overview', assetId: el.dataset.id }, { replace: true });
    } else if (action === 'library-page') {
      state.page += Number(el.dataset.id); resetSelection();
    } else if (action === 'library-clear') {
      Object.assign(state, { query: '', type: '', status: 'library', scope: '', page: 1 }); resetSelection();
    } else if (action === 'library-close') {
      state.drawer = false; state.closed = true;
      const id = String(S.route.assetId || '');
      NS.router.go({ ...S.route, assetEdit: '', candCreate: '' }, { replace: true });
      const rows = document.querySelectorAll?.('[data-act="library-select"]') || [];
      Array.from(rows).find(row => row.dataset.id === id)?.focus();
    } else if (action === 'library-open-inbox') {
      NS.router.go({ name: 'activity', inboxId: el.dataset.id });
    } else {
      busy = true;
      try {
        if (action === 'library-refresh') {
          if (S.route.assetEdit || S.route.candCreate) NS.router.go({ ...S.route, assetEdit: '', candCreate: '' }, { replace: true });
          await NS.reload();
        }
        if (action === 'library-review-conflict') {
          const id = String(S.route.assetId || '');
          await NS.reload();
          const latest = !S.assetsError && (S.assets || []).find(a => String(a.id) === id);
          const draft = S.assetEditDrafts?.[id];
          if (!latest || !draft || !['active', 'paused'].includes(statusOf(latest))) throw new Error(T('cognition.library_read_retry', '请重试读取，已有数据不会被清空。'));
          const confirmed = await NS.confirmUser(T('cognition.library_rebase_confirm', '当前版本 v{version}：{title}\n\n{content}\n\n使用范围：{scope}\n\n确认已核对上述最新内容，并保留你的草稿继续编辑？再次保存将以此版本为基准。', { version: String(latest.activeVersion || latest.version), title: String(latest.title || ''), content: String(latest.statement || ''), scope: scopeNames(latest) }));
          if (confirmed && S.route.assetId === id && S.assetEditDrafts?.[id] === draft) {
            S.assetEditDrafts[id] = { ...draft, baseVersion: String(latest.version), baseActiveVersion: String(latest.activeVersion || latest.version), saveError: '', saveConflict: false };
            NS.notify();
          }
        }
      } catch (error) { await NS.alertUser(String(error?.message || error)); }
      finally { busy = false; }
    }
    return true;
  }
  async function handleInput(event) {
    const el = event.target;
    if (el.id === 'ca-library-search' && event.isComposing) return true;
    if (el.id === 'ca-library-search' || el.dataset?.libraryFilter) {
      if (!(await guardNavigation())) { if (el.id === 'ca-library-search') el.value = state.query; else el.value = state[el.dataset.libraryFilter]; return true; }
      const key = el.id === 'ca-library-search' ? 'query' : el.dataset.libraryFilter;
      state[key] = el.value; state.page = 1; resetSelection(); return true;
    }
    const form = el.closest?.('.ca-library-detail .ca-asset-edit, .ca-library-detail [data-manual-candidate]');
    if (form) {
      state.dirty = true;
      form.querySelector?.('[data-library-dirty-marker]')?.removeAttribute?.('hidden');
      if (S.route.candCreate && el.dataset.f) state.manualDraft[el.dataset.f] = String(el.value || '');
      if (el.dataset.manualScopeMode || el.dataset.manualScopeKind) {
        const field = el.dataset.manualScopeMode || el.dataset.manualScopeKind;
        const mode = form.querySelector(`[data-manual-scope-mode="${field}"]`)?.value || 'keep';
        const inputs = Array.from(form.querySelectorAll(`[data-manual-scope-kind="${field}"]`));
        state.manualScope[field] = { mode, ids: inputs.flatMap(input => input.multiple ? Array.from(input.selectedOptions).map(option => String(option.value)) : input.checked ? [String(input.value)] : []) };
        for (const input of inputs) input.disabled = mode !== 'restrict' || S.assetScopeOptions?.status !== 'ready';
      }
      if (el.dataset.prototypeScopeMode || el.dataset.prototypeScopeMulti) {
        const id = String(form.dataset.assetEditId || '');
        const field = el.dataset.prototypeScopeMode || el.dataset.prototypeScopeMulti;
        const modeControl = form.querySelector('[data-prototype-scope-mode="' + field + '"]');
        const multi = form.querySelector('[data-prototype-scope-multi="' + field + '"]');
        const mode = modeControl.value;
        const kind = modeControl.dataset.scopeKind;
        const draft = (S.assetEditDrafts || (S.assetEditDrafts = {}))[id] || (S.assetEditDrafts[id] = {});
        draft.scopeSelectionModes = { ...draft.scopeSelectionModes, [field]: mode };
        draft.scopeUnrestrict = [...(draft.scopeUnrestrict || []).filter(value => value !== kind), ...(mode === 'clear' ? [kind] : [])];
        const selection = { ...draft.scopeSelection };
        if (mode === 'restrict') selection[field] = Array.from(multi.selectedOptions).map(option => option.value);
        else delete selection[field];
        draft.scopeSelection = selection;
        multi.disabled = mode !== 'restrict' || S.assetScopeOptions?.status !== 'ready';
      }
      if (el.id === 'ca-manual-type') {
        form.dataset.candType = el.value;
        const boundary = form.querySelector('[data-manual-rule-boundaries]');
        if (boundary) boundary.hidden = el.value !== 'rule';
      }
    }
    return false;
  }
  function shouldGuard(action) {
    return S.route.name === 'overview' && ['tab', 'go-back', 'open-asset', 'go-inbox-asset', 'open-conversation', 'open-cleanup', 'open-cleanup-report', 'open-candidate', 'cand-create', 'cand-create-cancel', 'asset-edit-cancel', 'asset-action', 'select-asset-version'].includes(action);
  }
  function actionFinished() {
    if (!S.route.assetEdit && !S.route.candCreate) { state.dirty = false; state.manualScope = {}; state.manualDraft = {}; }
  }
  function revealAsset(id) {
    const asset = (S.assets || []).find(item => String(item.id) === String(id));
    Object.assign(state, { query: '', type: '', scope: '', status: asset && !['active', 'paused'].includes(statusOf(asset)) ? statusOf(asset) : 'library', page: 1, drawer: true, closed: false, dirty: false });
    const index = filtered().findIndex(item => String(item.id) === String(id));
    if (index >= 0) state.page = Math.floor(index / PAGE_SIZE) + 1;
    NS.notify();
  }
  async function handleKeydown(event) {
    const option = event.target?.closest?.('.ca-library-filter-option');
    const trigger = event.target?.closest?.('.ca-library-filter-trigger');
    if (option && ['ArrowUp', 'ArrowDown', 'Home', 'End', 'Escape'].includes(event.key)) {
      event.preventDefault();
      const filter = option.closest('.ca-library-filter');
      const options = Array.from(filter.querySelectorAll('[role="option"]'));
      const index = options.indexOf(option);
      if (event.key === 'Escape') {
        filter.querySelector('[role="listbox"]').hidden = true;
        const button = filter.querySelector('[role="combobox"]'); button.setAttribute('aria-expanded', 'false'); button.focus();
      } else options[event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : Math.max(0, Math.min(options.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))]?.focus();
      return true;
    }
    if (trigger && ['ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); await handleClick(trigger); return true; }

    if (S.route.name !== 'overview' || !document.querySelector?.('.ca-library-page')) return false;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && (S.route.assetEdit || S.route.candCreate)) {
      event.preventDefault(); document.querySelector(S.route.candCreate ? '[data-act="cand-create-save"]' : '[data-act="asset-edit-save"]')?.click(); return true;
    }
    const dialog = document.querySelector('.ca-library-detail.is-drawer-open');
    if (dialog && event.key === 'Tab') {
      const focusable = Array.from(dialog.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,[tabindex="0"]')).filter(el => el.getClientRects().length);
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      return true;
    }
    if (event.key === 'Escape') { event.preventDefault(); await handleClick({ dataset: { act: 'library-close' } }); return true; }
    if (event.target.closest?.('input,textarea,select,button,summary')) return false;
    const row = event.target.closest?.('[data-act="library-select"]');
    if (!row) return false;
    if (['Enter', ' '].includes(event.key)) { event.preventDefault(); await handleClick(row); return true; }
    if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault(); const rows = Array.from(document.querySelectorAll('[data-act="library-select"]'));
      const next = rows[rows.indexOf(row) + (event.key === 'ArrowDown' ? 1 : -1)]; next?.focus(); return true;
    }
    return false;
  }
  function captureRenderState(root) {
    const page = root?.querySelector?.('.ca-library-page');
    if (!page) return null;
    const active = document.activeElement;
    return { key: page.dataset.librarySelected, drawer: !!page.querySelector('.ca-library-detail.is-drawer-open'), tableScroll: page.querySelector('.ca-library-table-wrap')?.scrollTop || 0,
      bodyScroll: page.querySelector('.ca-library-detail-body')?.scrollTop || 0,
      open: Array.from(page.querySelectorAll('.ca-library-detail details')).map(d => d.open),
      field: active && page.contains(active) ? { id: active.id, name: active.dataset?.f, start: active.selectionStart, end: active.selectionEnd, scroll: active.scrollTop, searchNode: active.id === 'ca-library-search' ? active : null } : null };
  }
  function restoreRenderState(root, before) {
    const page = root?.querySelector?.('.ca-library-page');
    if (!page) return;
    const same = before && before.key === page.dataset.librarySelected;
    const table = page.querySelector('.ca-library-table-wrap'); if (table && before) table.scrollTop = before.tableScroll;
    const body = page.querySelector('.ca-library-detail-body'); if (body) body.scrollTop = same ? before.bodyScroll : 0;
    if (same) Array.from(page.querySelectorAll('.ca-library-detail details')).forEach((d, i) => { d.open = !!before.open[i]; });
    const field = before?.field;
    if (field && (same || field.id === 'ca-library-search')) {
      let el = field.id ? document.getElementById(field.id) : field.name ? Array.from(page.querySelectorAll('[data-f]')).find(n => n.dataset.f === field.name) : null;
      if (el && field.searchNode && typeof el.replaceWith === 'function') {
        field.searchNode.value = state.query;
        el.replaceWith(field.searchNode);
        el = field.searchNode;
      }
      if (el) { el.focus({ preventScroll: true }); if (typeof field.start === 'number' && typeof el.setSelectionRange === 'function' && !['checkbox', 'radio'].includes(el.type)) el.setSelectionRange(field.start, field.end); el.scrollTop = field.scroll; }
    } else if (state.drawer && isNarrow()) page.querySelector('.ca-library-detail button')?.focus({ preventScroll: true });
    const drawer = !!page.querySelector('.ca-library-detail.is-drawer-open');
    for (const selector of ['#ca-tabs-nav', '.ca-library-page > .hero', '.ca-library-topline', '.ca-library-toolbar', '.ca-library-filters', '.ca-library-conversation', '.ca-library-list']) {
      const element = document.querySelector(selector); if (element) element.inert = drawer;
    }
    if (drawer && !before?.drawer) {
      const panel = page.querySelector('.ca-library-detail');
      (panel.querySelector('input,textarea,select') || panel.querySelector('button'))?.focus({ preventScroll: true });
    }
  }
  if (typeof window.matchMedia === 'function') {
    const media = window.matchMedia('(max-width: 960px), (max-height: 480px)');
    media.addEventListener?.('change', () => { if (S.route.name === 'overview') NS.notify(); });
  }
  NS.library = { render, filtered, handledActions: actions, handleClick, handleInput, handleKeydown, shouldGuard, guardNavigation, actionFinished, revealAsset, captureRenderState, restoreRenderState, state };
})();
