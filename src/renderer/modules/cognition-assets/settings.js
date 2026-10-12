/* 资产设置：真实运行状态与自动批准边界。由 app.js 委托动作调用。 */
(function () {
  'use strict';
  const NS = window.CogAssets;
  if (!NS) return;
  const { T } = NS;
  const S = NS.store;

  function modelStatus(model, readError) {
    if (readError || !model || model.runtimeStatus === 'unknown') return 'unknown';
    if (model.authorizationRequired) return 'authorization';
    if (model.runtimeStatus === 'legacy' && model.apiConfigured === true) return 'configured';
    if (model.channel === 'api') return 'api';
    if (model.channel === 'cli') return 'cli';
    if (model.channel === 'unavailable' || model.available === false) return 'unavailable';
    return 'unknown';
  }

  function discoveryStatus(snapshot, readError) {
    if (readError || !snapshot) return { state: 'unknown' };
    const sweep = snapshot.sweep || {};
    const result = sweep.lastResult;
    if (snapshot.runtime && snapshot.runtime.running) return { state: 'running', at: snapshot.runtime.startedAt };
    if (!result) return { state: 'never' };
    return {
      state: result.error || Number(result.failed) > 0 ? 'failed' : 'completed',
      at: result.finishedAt || sweep.lastRunAt,
      scanned: Math.max(0, Number(result.scanned) || 0),
      queued: Math.max(0, Number(result.queued) || 0),
      failed: Math.max(0, Number(result.failed) || 0),
      deferred: Math.max(0, Number(result.deferred) || 0),
    };
  }

  function autoApprovalBoundary() {
    return T('cognition.settings_auto_boundary_copy', '只对开启后新发现的建议评估，当前积压不会被批量批准。仅在来源项目或工作空间的授权范围可核实时自动批准；未标明范围的普通会话仍需人工确认。\n\n必须同时满足：\n• 证据完整、可审核，并已完成证据核对\n• 明确属于低风险，且确认无内容或分类冲突\n• 具有写入权限，使用范围与授权不会扩大\n• 更新类建议的目标与基准版本完全一致\n\n任何字段缺失、状态未知或保存失败，都保留人工确认。关闭后停止后续自动批准。系统活动会标明自动处理者与批准依据。');
  }

  let saving = false;
  function supportsAutoApproval() {
    return S.captureCapabilities?.autoApproval === true;
  }

  async function toggleAutoApproval() {
    if (saving || S.captureModelError || !S.captureSettings) return;
    if (!supportsAutoApproval()) {
      await NS.alertUser(T('cognition.settings_auto_restart_required', '当前运行版本尚不支持自动批准。请完全退出并重新打开 CogSeed 后再开启；仅刷新页面不会更新后台服务。'));
      return;
    }
    saving = true;
    S.autoApprovalSaving = true;
    NS.notify();
    try {
      const on = S.captureSettings.autoApproval !== true;
      if (on && !(await NS.confirmUser(`${T('cognition.settings_auto_confirm', '开启自动批准低风险建议？')}\n\n${autoApprovalBoundary()}`))) return;
      await NS.actions.updateCaptureSettings({ autoApproval: on });
    } finally {
      saving = false;
      S.autoApprovalSaving = false;
      NS.notify();
    }
  }

  // 首次进入设置只读核对一次；在请求前落标记，避免 notify 重入或失败自续。
  let storageInspectionStarted = false;
  function inspectStorageOnce() {
    if (storageInspectionStarted || String(S.route && S.route.name || '') !== 'settings') return;
    storageInspectionStarted = true;
    const previous = S.cognitionStorageUpgrade;
    if (previous && (previous.report || previous.running || previous.failed)) return;
    void NS.actions.cognitionStorageUpgrade('check');
  }
  if (typeof NS.onChange === 'function') NS.onChange(inspectStorageOnce);
  inspectStorageOnce();

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

  NS.assetSettings = { modelStatus, discoveryStatus, supportsAutoApproval, autoApprovalBoundary, toggleAutoApproval, captureDisclosures, restoreDisclosures };
})();
