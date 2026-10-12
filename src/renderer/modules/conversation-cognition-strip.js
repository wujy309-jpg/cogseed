/** Pure cognition strip markup; state, visibility and events belong to conversation-info. */
(function () {
  'use strict';
  function render(counts, ui) {
    const settled = counts.settled;
    const pending = counts.pending;
    const { label: _label, button: _button, iconButton: _iconButton, escapeHtml } = ui;
    const settledPart = settled
      ? _label('conversation_info.cognition_strip_settled', '已沉淀 {n} 条认知', { n: String(settled) })
      : '';
    const pendingPart = pending
      ? _label('conversation_info.cognition_strip_pending', '待处理 {n} 条', { n: String(pending) })
      : '';
    const summary = [settledPart, pendingPart].filter(Boolean).join(' · ');
    const dismissLabel = _label('conversation_info.cognition_strip_dismiss', '不再显示本会话的认知提示');
    const dismissButton = _iconButton({
          label: dismissLabel,
          icon: 'x',
          size: 'sm',
          className: 'chat-cognition-strip-dismiss',
          attrs: { 'data-cognition-strip-dismiss': '1' },
        });
    return '<div class="chat-cognition-strip-inner" role="status">' +
        '<span data-ui-icon="git-branch" data-ui-icon-class="ui-icon chat-cognition-strip-icon"></span>' +
        '<span class="chat-cognition-strip-label">' + escapeHtml(summary) + '</span>' +
        _button({ label: _label('conversation_info.cognition_strip_goto', '去处理'), role: 'ghost', size: 'sm',
          className: 'chat-cognition-strip-goto', attrs: { 'data-cognition-strip-goto': '1' } }) +
        dismissButton +
      '</div>';
  }
  window.ConversationCognitionStrip = { render };
})();
