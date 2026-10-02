// 认知沉淀（capture）弹窗纯渲染层。
// P-r3-9（2026-10-01 拍板「死页族删链保留 capture」）：此前的「认知成长页」
// 视图族（成长树/阶段轨/证据与生命周期列表/分页/创建表单，约 250 行模板）
// 服务于已删除的认知成长页死链，随死页族一并删除；本文件只剩 capture
// 弹窗模板 renderCognitionCapture（cognition.js::openCognitionCapture 消费）。
// P-r1-50：capture 弹窗的两个隐藏域（conversationId/messageId）渲染后全仓
// 零读取——溯源走 draft.sourceRefs/evidenceRefs（主进程解析），连参数链删除。
(function (root) {
  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function text(key, fallback, vars) {
    if (typeof root.t === 'function') {
      const translated = root.t(key, vars);
      if (translated && translated !== key) return translated;
    }
    if (!vars) return fallback;
    return fallback.replace(/\{(\w+)\}/g, (match, name) => vars[name] == null ? match : String(vars[name]));
  }

  function button(options) {
    if (typeof root.uiButton !== 'function') throw new Error('cognition pages require uiButton');
    return root.uiButton(options);
  }

  function iconButton(options) {
    if (typeof root.uiIconButton !== 'function') throw new Error('cognition pages require uiIconButton');
    return root.uiIconButton(options);
  }

  function input(options) {
    if (typeof root.uiInput !== 'function') throw new Error('cognition pages require uiInput');
    return root.uiInput(options);
  }

  function textarea(options) {
    if (typeof root.uiTextarea !== 'function') throw new Error('cognition pages require uiTextarea');
    return root.uiTextarea(options);
  }

  function select(options) {
    if (typeof root.uiSelect !== 'function') throw new Error('cognition pages require uiSelect');
    return root.uiSelect(options);
  }

  function renderCognitionCapture(options) {
    const state = options?.state === 'loading' || options?.state === 'error' ? options.state : 'ready';
    const loading = state === 'loading';
    const error = String(options?.error || '').trim();
    const title = String(options?.title || '').trim();
    const summary = String(options?.summary || '').trim();
    const value = String(options?.value || '').trim();
    const sourceLabel = String(options?.sourceLabel || '').trim();
    const suggestedScope = String(options?.suggestedScope || '').trim();
    const applicableWhen = Array.isArray(options?.applicableWhen) ? options.applicableWhen : [];
    const forbiddenWhen = Array.isArray(options?.forbiddenWhen) ? options.forbiddenWhen : [];
    const risk = String(options?.risk || 'low');
    const uncertainty = String(options?.uncertainty || '').trim();
    // 使用与 Recall 候选一致的五类分类，模型预填仍可由用户修正。
    const assetTypes = ['personal', 'fact', 'rule', 'template', 'skill_method'];
    const suggestedType = assetTypes.indexOf(String(options?.suggestedType || '')) >= 0
      ? String(options.suggestedType)
      : '';
    const disabled = state !== 'ready';
    const status = loading
      ? `<p class="cognition-capture-status" data-cognition-capture-status aria-live="polite">${escapeHtml(text('cognition.capture.generating', '正在从会话中提炼可复用认知…'))}</p>`
      : (state === 'error'
        ? `<p class="cognition-capture-status cognition-capture-status-error" data-cognition-capture-status role="alert">${escapeHtml(error || text('cognition.capture.generation_failed', '认知草稿生成失败，请稍后重试。'))}</p>`
        : `<p class="cognition-capture-status" data-cognition-capture-status>${escapeHtml(text('cognition.capture.generated', '以下内容由模型生成，可编辑后保存。'))}</p>`);
    const actions = loading || state === 'error'
      ? button({ label: text('cognition.action.cancel', '取消'), attrs: { 'data-cognition-capture-cancel': 'true' } })
      : button({ label: text('cognition.action.cancel', '取消'), attrs: { 'data-cognition-capture-cancel': 'true' } })
        + button({ label: text('cognition.capture.submit', '保存待确认认知'), role: 'primary', attrs: { 'data-cognition-capture-submit': 'true' } });
    return `<form class="ui-modal ui-modal--md cognition-capture-modal" data-cognition-capture-form role="dialog" aria-modal="true" aria-busy="${loading ? 'true' : 'false'}">`
      + '<header class="ui-modal__header cognition-capture-header"><div class="ui-modal__heading">'
      + '<h2 class="ui-modal__title">' + escapeHtml(text('cognition.capture.title', '沉淀为认知')) + '</h2>'
      + `<p class="ui-modal__description">${escapeHtml(loading ? text('cognition.capture.subtitle_generating', '正在生成候选草稿。') : text('cognition.capture.subtitle', '把这次有效做法保存为待确认候选。'))}</p>`
      + '</div>'
      + iconButton({ icon: 'x', label: text('common.close', 'Close'), className: 'cognition-capture-close', attrs: { 'data-cognition-capture-cancel': 'true' } })
      + '</header>'
      + '<div class="ui-modal__body cognition-capture-body">'
      + status
      + '<label>' + escapeHtml(text('cognition.capture.name', '认知名称')) + input({ id: 'cognition-capture-title', value: title, disabled, required: true, attrs: { maxlength: 60, 'data-cognition-capture-title': 'true' } }) + '</label>'
      + '<label>' + escapeHtml(text('cognition.capture.summary', '可复用内容')) + textarea({ id: 'cognition-capture-summary', value: summary, disabled, required: true, attrs: { maxlength: 2000, 'data-cognition-capture-summary': 'true' } }) + '</label>'
      + '<label>' + escapeHtml(text('cognition.chain_value_label', '带来的价值')) + textarea({ id: 'cognition-capture-value', value, disabled, required: true, attrs: { maxlength: 2000, 'data-cognition-capture-value': 'true' } }) + '</label>'
      + `<div class="field"><span id="cognition-capture-scope-label">${escapeHtml(text('cognition.candidate_scope_domain', '适用任务范围'))}</span>${select({
        id: 'cognition-capture-scope', labelId: 'cognition-capture-scope-label', value: suggestedScope, placeholder: text('cognition.capture.scope_placeholder', '请选择任务范围…'), required: true,
        options: ['general', 'report', 'code', 'review', 'product'].map((scope) => ({
          value: scope,
          label: text(`cognition.capture.scope_${scope}`, {
            general: '跨任务通用', report: '报告', code: '编程', review: '审查与评审', product: '产品工作',
          }[scope]),
        })),
      })}</div>`
      + '<label>' + escapeHtml(text('cognition.asset_version_applicable', '适用场景')) + textarea({ id: 'cognition-capture-applicable', value: (applicableWhen || []).join('\n'), disabled, attrs: { maxlength: 1000, 'data-cognition-capture-applicable': 'true' } }) + '</label>'
      + '<label>' + escapeHtml(text('cognition.asset_version_forbidden', '禁用场景')) + textarea({ id: 'cognition-capture-forbidden', value: (forbiddenWhen || []).join('\n'), disabled, attrs: { maxlength: 1000, 'data-cognition-capture-forbidden': 'true' } }) + '</label>'
      + '<label>' + escapeHtml(text('cognition.chain_uncertainty_label', '仍不确定的地方')) + textarea({ id: 'cognition-capture-uncertainty', value: uncertainty, disabled, attrs: { maxlength: 1000, 'data-cognition-capture-uncertainty': 'true' } }) + '</label>'
      + `<div class="field"><span>${escapeHtml(text('cognition.capture.risk', '风险等级'))}</span><p class="note">${escapeHtml(text(`cognition.capture.risk_${risk || 'low'}`, { low: '低', medium: '中', high: '高' }[risk || 'low']))}</p></div>`
      + '<label>' + escapeHtml(text('cognition.capture.source', '证据来源')) + input({ id: 'cognition-capture-source', value: sourceLabel, disabled: true, attrs: { maxlength: 160, 'data-cognition-capture-source': 'true' } }) + '</label>'
      + '<label>' + escapeHtml(text('cognition.capture.type', '归入哪一类'))
      + `<select class="ui-control" data-cognition-capture-type required${disabled ? ' disabled' : ''}>`
      + `<option value=""${suggestedType ? '' : ' selected'}>`
      + escapeHtml(text('cognition.capture.type_placeholder', '请选择…')) + '</option>'
      + assetTypes.map((value) => `<option value="${value}"${suggestedType === value ? ' selected' : ''}>`
        + escapeHtml(text(`cognition.asset_category_${value}`, {
          personal: '关于我', fact: '项目与环境事实', rule: '规则与偏好', template: '模板与范例', skill_method: '技能与方法',
        }[value])) + '</option>').join('')
      + '</select></label>'
      + '<p class="cognition-capture-note">' + escapeHtml(text('cognition.capture.note', '保存后会进入「待我处理」；确认后成为正式认知资产，可在后续任务中被复用。')) + '</p>'
      + '</div>'
      + `<footer class="ui-modal__footer cognition-capture-actions">${actions}</footer>`
      + '</form>';
  }

  const api = { escapeHtml, renderCognitionCapture };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CognitionPages = api;
})(typeof window !== 'undefined' ? window : globalThis);
