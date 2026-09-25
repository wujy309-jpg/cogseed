// Task-level Recall projection card. Edits only the current projection draft;
// it never mutates or deletes formal ability assets.
//
// 这张卡渲染的是**正式 Ability Asset**（context-projection 全程只有 assetId /
// maturity），不是候选池对象。文案一律用「资产」：叫成「候选」会把 Candidate
// 生命周期和 Asset 成熟度两层重新混掉，用户会以为这些东西还等着确认。
(function () {
  function _escape(value) {
    if (typeof escapeHtml === 'function') return escapeHtml(value);
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function _label(key, fallback, vars) {
    try {
      if (typeof t === 'function') {
        const value = t(key, vars || undefined);
        if (value && value !== key) return value;
      }
    } catch (_) {}
    let out = String(fallback || '');
    if (vars) out = out.replace(/\{(\w+)\}/g, (match, name) => vars[name] != null ? String(vars[name]) : match);
    return out;
  }


  /**
   * 新控件一律走共享按钮原语（shared-ui-adoption-guard 的规矩）；本模块既有的
   * 四个历史控件保持原样、由守卫基线冻结。原语缺席（极简渲染上下文）时返回空串，
   * 不在这里自造控件标记——那又会在基线之外多出一个原始控件。
   */
  function _sharedButton(label, attrs) {
    if (typeof window.uiButton !== 'function') return '';
    return window.uiButton({ label, size: 'sm', attrs });
  }

  function _assetStatusLabel(status) {
    if (status === 'active') return _label('recall.asset.status.active', 'Active');
    if (status === 'paused') return _label('recall.asset.status.paused', 'Paused');
    if (status === 'revoked') return _label('recall.asset.status.revoked', 'Revoked');
    return String(status || '');
  }

  function _assetRecommendationLabel(action) {
    if (action === 'pause') return _label('recall.asset.recommend.pause', 'Pause recommended');
    if (action === 'rework') return _label('recall.asset.recommend.rework', 'Rework recommended');
    return String(action || '');
  }

  /** 被拦规则标识 → 规则名（US-604 AC1）：与资产页/选择器共用同一套
   *  `cognition.block_reason_*` 文案，三处说法一致。只翻标识，不上屏原文。 */
  function _omissionReasonLabel(rule) {
    const key = String(rule || '');
    if (key === 'paused') return _label('cognition.block_reason_paused', 'Paused by you');
    if (key === 'archived') return _label('cognition.block_reason_archived', 'Archived');
    if (key === 'revoked') return _label('cognition.block_reason_revoked', 'Use revoked');
    if (key === 'deleted') return _label('cognition.block_reason_deleted', 'Deleted (recoverable)');
    if (key === 'purged') return _label('cognition.block_reason_purged', 'Permanently deleted');
    if (key === 'inactive') return _label('cognition.block_reason_inactive', 'Not in an active state');
    if (key === 'missing') return _label('cognition.block_reason_missing', 'No longer exists');
    if (key === 'source_unavailable') return _label('cognition.block_reason_source_unavailable', 'Source no longer available');
    if (key === 'agent') return _label('cognition.block_reason_agent', 'Recipient not allowed');
    if (key === 'scope') return _label('cognition.block_reason_scope', 'Scope not allowed');
    if (key === 'sensitivity_high') return _label('cognition.block_reason_sensitivity_high', 'Sensitivity above the limit');
    if (key === 'sensitivity_unknown') return _label('cognition.block_reason_sensitivity_unknown', 'Sensitivity not classified');
    if (key === 'maturity') return _label('cognition.block_reason_maturity', 'Use contract does not allow it');
    if (key === 'forbidden_context') return _label('cognition.block_reason_forbidden_context', 'Forbidden context');
    if (key === 'not_applicable_context') return _label('cognition.block_reason_not_applicable_context', 'Not applicable here');
    if (key === 'version_changed') return _label('cognition.block_reason_version_changed', 'Version changed');
    if (key === 'versions_missing') return _label('cognition.block_reason_versions_missing', 'Version snapshot missing');
    return _label('cognition.block_reason_unknown', 'Blocked');
  }

  /** 「本轮未带入」行（US-604 AC4/AC7）：发送前重检被拦不再静默——卡片上说明是哪条
   *  内容、被哪条规则拦下。只给标题与规则名，不含正文、不含内部 id。 */
  function _omissionRowsHtml(omissions) {
    const rows = (Array.isArray(omissions) ? omissions : []).map((item) => {
      const title = String(item?.title || '').trim() || _label('recall.projection.asset_untitled', 'Untitled asset');
      const reason = _omissionReasonLabel(String(item?.reason || ''));
      return `<div class="chat-recall-projection-omitted-row">${_escape(_label(
        'recall.projection.omitted_this_turn',
        'Not carried this turn: {title} ({reason})',
        { title, reason },
      ))}</div>`;
    }).join('');
    return rows ? `<div class="chat-recall-projection-omitted">${rows}</div>` : '';
  }

  function _statusLabel(status) {    if (status === 'revoked') return _label('recall.projection.status.revoked', 'Revoked');
    if (status === 'confirmed') return _label('recall.projection.status.confirmed', 'Confirmed');
    if (status === 'preview') return _label('recall.projection.status.preview', 'Preview');
    if (status === 'deferred') return _label('recall.projection.status.deferred', 'Deferred');
    if (status === 'rejected') return _label('recall.projection.status.rejected', 'Rejected');
    if (status === 'expired') return _label('recall.projection.status.expired', 'Expired');
    return String(status || '');
  }

  function _renderModelSelectedReceipt(host, card, userPinned, omissions) {
    // Only a transport sidecar owns fallback prose. A receipt mounted on the
    // final reply must never hide that reply's markdown body.
    if (host.dataset.recallProjectionTransport === 'sidecar') {
      const bubble = typeof host.closest === 'function' ? host.closest('.chat-bubble') : null;
      const prose = bubble && typeof bubble.querySelector === 'function' ? bubble.querySelector('.markdown-body') : null;
      if (prose) prose.hidden = true;
    }
    const assets = Array.isArray(card?.assetSummaries) ? card.assetSummaries : [];
    const omitted = Array.isArray(card?.omittedAssetRefs) ? card.omittedAssetRefs : [];
    const revoked = card?.status === 'revoked';
    const status = _statusLabel(card?.status);
    const primaryNote = revoked
      ? (userPinned
        // US-604 AC8：撤销要如实说明已生效范围——已经发出去的那一轮收不回来。
        ? _label('recall.projection.user_pinned_revoked_note', 'Revoked. What was already sent this turn cannot be recalled; later turns will not carry it.')
        : _label('recall.projection.revoked_note', 'Revoked: later turns no longer carry these assets.'))
      : userPinned
        // 用户自己 @ 钉的（2026-09-25 US-601）：说的是"你引用的"，且明确可撤销。
        ? _label('recall.projection.user_pinned_locked', 'You referenced these for this conversation; later turns keep carrying them until you revoke.')
        : _label('recall.projection.model_selected_locked', 'The model picked these for the current task; later turns keep carrying them until you revoke.');
    const modelIds = Array.isArray(card?.modelSelectedAssetIds) ? card.modelSelectedAssetIds : null;
    const hasModelLedger = Boolean(modelIds);
    const modelIdSet = new Set(modelIds || []);
    const modelAssets = hasModelLedger ? assets.filter((asset) => modelIdSet.has(String(asset?.assetId || asset?.id || ''))) : assets;
    const baselineAssets = hasModelLedger ? assets.filter((asset) => !modelIdSet.has(String(asset?.assetId || asset?.id || ''))) : [];
    const summary = userPinned
      ? _label('recall.projection.user_pinned_summary', 'You referenced {count} cognition assets', {
          count: Number(card?.totalAssetCount ?? assets.length),
        })
      : hasModelLedger
        ? _label('recall.projection.model_selected_summary_precise', 'Model attached {count} cognition assets · {total} in projection', {
            count: Number(card?.modelSelectedCount ?? modelIds?.length ?? 0),
            total: Number(card?.totalAssetCount ?? assets.length),
          })
        : _label('recall.projection.model_selected_summary_legacy', 'Model-selected projection · {total} cognition assets', {
            total: Number(card?.totalAssetCount ?? assets.length),
          });
    const assetRows = (rows, emptyLabel) => rows.length
      ? rows.map((asset) => _assetRow(asset, false)).join('')
      : `<div class="chat-recall-projection-empty">${_escape(emptyLabel)}</div>`;
    const detailSections = hasModelLedger
      ? `<div class="chat-recall-projection-section"><div class="chat-recall-projection-section-title">${_escape(_label('recall.projection.model_selected_assets', 'Model-selected assets'))}</div>${assetRows(modelAssets, _label('recall.projection.no_included_assets', 'No preloaded assets selected.'))}</div>
          ${baselineAssets.length ? `<div class="chat-recall-projection-section"><div class="chat-recall-projection-section-title">${_escape(_label('recall.projection.semantic_baseline_assets', 'Semantic baseline assets'))}</div>${assetRows(baselineAssets, _label('recall.projection.no_included_assets', 'No preloaded assets selected.'))}</div>` : ''}`
      : `<div class="chat-recall-projection-section"><div class="chat-recall-projection-section-title">${_escape(_label('recall.projection.included_assets', 'Preloaded assets'))}</div>${assetRows(assets, _label('recall.projection.no_included_assets', 'No preloaded assets selected.'))}</div>`;
    host.className = `chat-recall-projection-card ${userPinned ? 'is-user-pinned' : 'is-model-selected'} is-${revoked ? 'revoked' : String(card?.status || 'unknown')}`;
    host.dataset.projectionId = String(card?.projectionId || '');
    host.innerHTML = `<div class="chat-recall-projection-head">
        <div class="chat-recall-projection-title">
          <strong>${_escape(summary)}</strong>
          <small>${_escape(primaryNote)}</small>
        </div>
        <span class="chat-recall-projection-badge">${_escape(userPinned
          ? _label('recall.projection.user_pinned_badge', 'You referenced')
          : _label('recall.projection.model_selected_badge', 'Model-picked'))}</span>
        <span class="chat-recall-projection-status">${_escape(status)}</span>
      </div>
      <div class="chat-recall-projection-summary-actions">
        ${revoked ? '' : _sharedButton(_label('recall.projection.revoke', 'Revoke'), { 'data-recall-projection-revoke': '1' })}
      </div>
      <details class="chat-recall-projection-details">
        <summary>${_escape(_label('recall.projection.view_details', 'View details'))}</summary>
        <div class="chat-recall-projection-body">
          ${detailSections}
          ${omitted.length ? `<div class="chat-recall-projection-omitted">${_escape(_label('recall.projection.omitted_count', '{count} assets hidden', { count: omitted.length }))}</div>` : ''}
        </div>
      </details>
      ${_omissionRowsHtml(omissions)}`;
  }

  function _assetRow(asset, editable) {
    const id = String(asset?.assetId || asset?.id || '');
    // 资产 id 是定位键，不是名字：解析不出标题时给语义占位。
    const title = String(asset?.title || '').trim() || _label('recall.projection.asset_untitled', 'Untitled asset');
    // 已确认投影注入的是确认时那一版，所以这里显示确认版本而不是 live 版本，
    // 否则用户会以为运行中用的是他刚改出来的新版。
    const shownVersion = asset?.confirmedVersion || asset?.version;
    const meta = [asset?.type, asset?.scope, shownVersion ? `v${shownVersion}` : ''].filter(Boolean).join(' · ');
    const governance = [asset?.status && asset.status !== 'active' ? _assetStatusLabel(asset.status) : '', asset?.recommendedAction ? _assetRecommendationLabel(asset.recommendedAction) : ''].filter(Boolean).join(' · ');
    const reason = asset?.recommendationReason ? `<em>${_escape(asset.recommendationReason)}</em>` : '';
    // 版本钉住是有意的（不在用户背后换掉他确认过的内容），所以这里只告知，
    // 不提供"就地升到新版"——已确认投影不可再改，新版本要靠下次重新选择。
    const stale = asset?.stale
      ? `<small class="chat-recall-projection-stale">${_escape(_label(
          'recall.projection.asset_stale',
          'Still running the confirmed v{confirmed}; the asset is now v{current}. It takes effect after you select it again.',
          { confirmed: asset?.confirmedVersion || '', current: asset?.version || '' },
        ))}</small>`
      : '';
    return `<div class="chat-recall-projection-asset${asset?.stale ? ' is-stale' : ''}" data-recall-projection-asset="${_escape(id)}"><div><strong>${_escape(title)}</strong>${meta ? `<small>${_escape(meta)}</small>` : ''}${governance ? `<small class="chat-recall-projection-governance">${_escape(governance)}</small>` : ''}${stale}${reason}</div>${editable ? `<button type="button" class="btn btn-sm" data-recall-projection-remove="${_escape(id)}">${_escape(_label('recall.projection.remove_task_asset', 'Remove asset'))}</button>` : ''}</div>`;
  }

  function _availableRow(asset) {
    const id = String(asset?.id || asset?.assetId || '');
    const title = String(asset?.title || id);
    const meta = [asset?.type, asset?.scope, asset?.version].filter(Boolean).join(' · ');
    return `<div class="chat-recall-projection-available"><div><strong>${_escape(title)}</strong>${meta ? `<small>${_escape(meta)}</small>` : ''}</div><button type="button" class="btn btn-sm" data-recall-projection-add="${_escape(id)}">${_escape(_label('recall.projection.add_task_asset', 'Add asset'))}</button></div>`;
  }

  function _render(host, card, available, opts, forecastFailure, omissions) {
    host.__recallProjectionRenderState = { card, available, opts, forecastFailure, omissions };
    // 模型自选（2026-09-18）：卡片是"模型为这个任务挑的资产"，不是等用户
    // 确认的预载草稿——所以文案与动作都不同（confirmed + 一键撤销）。
    // 用户 @ 钉住（2026-09-25 US-601）：同一张回执卡，只是"谁做的决定"不同，
    // 撤销口也不同（revokePinned）——引用回执必须可撤销，否则挂上去就下不来。
    const modelSelected = card?.authorization === 'model_selected';
    const userPinned = card?.authorization === 'user_confirmed' && card?.purpose === 'user_pinned';
    if (opts?.onlyModelSelected && !modelSelected && !userPinned) {
      // 只挂"模型自选"与"用户 @ 钉住"两类回执：其它授权（工作区策略/预载草稿）
      // 保持"不挂卡"的现状。
      host.className = '';
      host.innerHTML = '';
      delete host.dataset.projectionId;
      return;
    }
    const editable = card?.status === 'preview';
    const assets = Array.isArray(card?.assetSummaries) ? card.assetSummaries : [];
    const omitted = Array.isArray(card?.omittedAssetRefs) ? card.omittedAssetRefs : [];
    const availableRows = editable && Array.isArray(available) && available.length
      ? `<div class="chat-recall-projection-available-list">${available.map(_availableRow).join('')}</div>`
      : editable
        ? `<div class="chat-recall-projection-empty">${_escape(_label('recall.projection.no_available_assets', 'No more assets to add.'))}</div>`
        : '';
    if (modelSelected || userPinned) {
      _renderModelSelectedReceipt(host, card, userPinned, omissions);
      return;
    }
    host.className = 'chat-recall-projection-card';
    host.dataset.projectionId = String(card?.projectionId || opts?.projectionId || '');
    const revoked = card?.status === 'revoked';
    const actions = forecastFailure
      ? `<div class="chat-recall-projection-forecast-failure" role="alert"><strong>${_escape(_label('recall.projection.forecast_failed', 'Forecast failed; task has not started.'))}</strong><small>${_escape(forecastFailure.message || '')}</small><button type="button" class="btn btn-sm" data-recall-projection-retry="1">${_escape(_label('recall.projection.retry_forecast', 'Retry forecast'))}</button></div>`
      : editable
        ? `<div class="chat-recall-projection-actions"><button type="button" class="btn btn-primary btn-sm" data-recall-projection-confirm="1">${_escape(_label('recall.projection.confirm_assets', 'Confirm assets'))}</button></div>`
        : modelSelected && !revoked
          ? `<div class="chat-recall-projection-actions">${_sharedButton(_label('recall.projection.revoke', 'Revoke'), { 'data-recall-projection-revoke': '1' })}</div>`
          : '';
    const title = modelSelected
      ? _label('recall.projection.model_selected_title', 'Assets the model picked for this task')
      : _label('recall.projection.title', 'Preloaded assets');
    const lockedNote = revoked && modelSelected
      ? _label('recall.projection.revoked_note', 'Revoked: later turns no longer carry these assets.')
      : modelSelected
        ? _label('recall.projection.model_selected_locked', 'The model picked these for the current task; later turns keep carrying them until you revoke.')
        : _label('recall.projection.locked', 'These preloaded assets are locked.');
    host.innerHTML = `<div class="chat-recall-projection-head"><div><strong>${_escape(title)}</strong>${modelSelected ? `<span class="chat-recall-projection-badge">${_escape(_label('recall.projection.model_selected_badge', 'Model-picked'))}</span>` : ''}<small>${_escape(card?.purpose || '')}</small></div><span class="chat-recall-projection-status">${_escape(_statusLabel(card?.status))}</span></div>
      <div class="chat-recall-projection-summary">${_escape(_label('recall.projection.summary', '{count} preloaded assets.', { count: assets.length }))}</div>
      <div class="chat-recall-projection-section"><div class="chat-recall-projection-section-title">${_escape(_label('recall.projection.included_assets', 'Preloaded assets'))}</div>${assets.length ? assets.map((asset) => _assetRow(asset, editable)).join('') : `<div class="chat-recall-projection-empty">${_escape(_label('recall.projection.no_included_assets', 'No preloaded assets selected.'))}</div>`}</div>
      ${editable ? `<div class="chat-recall-projection-section"><div class="chat-recall-projection-section-title">${_escape(_label('recall.projection.add_assets', 'Add asset'))}</div>${availableRows}</div>` : `<div class="chat-recall-projection-locked">${_escape(lockedNote)}</div>`}
      ${actions}
      ${omitted.length ? `<div class="chat-recall-projection-omitted">${_escape(_label('recall.projection.omitted_count', '{count} assets hidden', { count: omitted.length }))}</div>` : ''}`;
  }

  async function _loadCard(projectionId) {
    const result = await window.cogseed.invoke('recall.projections.card', { projectionId });
    if (!result?.ok || !result.card) throw new Error(result?.error || 'projection card unavailable');
    return result.card;
  }

  async function _loadAvailable(projectionId, editable) {
    if (!editable) return [];
    const result = await window.cogseed.invoke('recall.projections.availableAssets', { projectionId });
    if (!result?.ok) return [];
    return Array.isArray(result.assets) ? result.assets : [];
  }

  async function mountRecallProjectionCard(host, messageCard, opts = {}) {
    if (!host || !messageCard?.projectionId) return;
    const projectionId = String(messageCard.projectionId);
    const cid = String(opts.cid || '');
    let forecastFailure = null;
    async function refresh() {
      host.dataset.loading = '1';
      try {
        const card = await _loadCard(projectionId);
        const available = await _loadAvailable(projectionId, card.status === 'preview');
        // 用户引用的资产被拦留痕（US-604 AC4/AC7）：只有用户钉住的卡需要显示
        // 「本轮未带入」，模型自选/其它授权不查这个口。
        let omissions = [];
        if (cid && card?.authorization === 'user_confirmed' && card?.purpose === 'user_pinned') {
          try {
            const result = await window.cogseed.invoke('recall.injections.omissions', { cid });
            omissions = (result && result.ok && Array.isArray(result.omissions)) ? result.omissions : [];
          } catch (_) {
            omissions = [];
          }
        }
        _render(host, card, available, { ...opts, projectionId }, forecastFailure, omissions);
      } catch (error) {
        host.className = 'chat-recall-projection-card is-error';
        host.innerHTML = _escape((error && error.message) || String(error));
      } finally {
        host.dataset.loading = '0';
      }
    }
    if (!host.dataset.recallProjectionBound) {
      host.dataset.recallProjectionBound = '1';
      host.addEventListener('click', async (event) => {
        const confirm = event.target.closest('[data-recall-projection-confirm]');
        const retry = !confirm ? event.target.closest('[data-recall-projection-retry]') : null;
        const revoke = !confirm && !retry ? event.target.closest('[data-recall-projection-revoke]') : null;
        const remove = !confirm && !retry && !revoke ? event.target.closest('[data-recall-projection-remove]') : null;
        const add = !confirm && !retry && !revoke && !remove ? event.target.closest('[data-recall-projection-add]') : null;
        const button = confirm || retry || revoke || remove || add;
        if (!button || button.disabled || host.dataset.loading === '1') return;
        const assetId = remove ? remove.dataset.recallProjectionRemove : add?.dataset.recallProjectionAdd;
        if (!confirm && !retry && !revoke && !assetId) return;
        button.disabled = true;
        try {
          const result = confirm
            ? await window.cogseed.invoke('recall.projections.confirm', { projectionId, ...(cid ? { cid } : {}) })
            : retry
              ? await window.cogseed.invoke('recall.projections.retryForecast', { projectionId, ...(cid ? { cid } : {}) })
              : revoke
                // 撤销口按授权分流（US-601 AC3）：用户 @ 钉住的走 revokePinned，
                // 模型自选仍走原口——两条线的授权语义不同，各自可审计。
                ? await window.cogseed.invoke(
                    (host.__recallProjectionRenderState?.card?.authorization === 'user_confirmed'
                      && host.__recallProjectionRenderState?.card?.purpose === 'user_pinned')
                      ? 'recall.projections.revokePinned'
                      : 'recall.projections.revoke',
                    { projectionId },
                  )
                : await window.cogseed.invoke('recall.projections.revise', remove
                  ? { projectionId, removeAssetIds: [assetId] }
                  : { projectionId, addAssetIds: [assetId] });
          if (!result?.ok) throw Object.assign(new Error(result?.error || (confirm ? 'projection confirmation failed' : retry ? 'forecast retry failed' : revoke ? 'projection revoke failed' : 'projection revision failed')), { code: result?.code });
          forecastFailure = null;
          await refresh();
        } catch (error) {
          const code = error && error.code;
          const retryable = ['model_not_configured', 'model_unavailable', 'model_auth_failed', 'forecast_unavailable'].includes(code);
          if (confirm && retryable) {
            forecastFailure = { message: (error && error.message) || String(error) };
            await refresh();
          } else if (typeof uiAlert === 'function') await uiAlert((error && error.message) || String(error));
        } finally {
          button.disabled = false;
        }
      });
    }
    await refresh();
  }

  window.mountRecallProjectionCard = mountRecallProjectionCard;
  if (typeof window.addEventListener === 'function') window.addEventListener('i18n-change', () => {
    document.querySelectorAll('.chat-recall-projection-card').forEach((host) => {
      const state = host.__recallProjectionRenderState;
      if (state) _render(host, state.card, state.available, state.opts, state.forecastFailure, state.omissions);
    });
  });
})();
