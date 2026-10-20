/* 外层：导览条。阶段列表由里层 app.js 提供（单一数据源），点击后通过 postMessage 让里层跳转。 */
(function () {
  'use strict';
  const frame = document.getElementById('app');
  const tour = document.getElementById('tour');
  const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const initial = new URLSearchParams(location.search).get('v');
  let items = [];
  let active = '';
  let sentInitial = false;

  let open = false;
  const btnHtml = (t) => `<button type="button" data-key="${esc(t.key)}" class="${t.key === active ? 'is-active' : ''}">${esc(t.label)}</button>`;
  function paint() {
    const by = (g) => items.filter((t) => (t.group || 'other') === g);
    const main = by('main'); const edge = by('edge'); const other = by('other');
    tour.innerHTML = `${main.map(btnHtml).join('')}<button type="button" class="proto-more" data-more aria-expanded="${open}">${open ? '收起 ▴' : '更多场景 ▾'}</button>`
      + (open ? `<div class="proto-panel"><div class="proto-group"><span>异常场景</span>${edge.map(btnHtml).join('')}</div><div class="proto-group"><span>全部阶段（深链接，也都能在原型里点出来）</span>${other.map(btnHtml).join('')}</div></div>` : '');
  }
  tour.addEventListener('click', (e) => {
    if (e.target.closest('[data-more]')) { open = !open; paint(); return; }
    const b = e.target.closest('button[data-key]'); if (!b) return;
    frame.contentWindow.postMessage({ type: 'go', key: b.getAttribute('data-key') }, '*');
  });
  // 内嵌 iframe 可能先于本脚本加载完：主动打招呼，里层收到后回报阶段列表与当前状态。
  const hello = () => { try { frame.contentWindow.postMessage({ type: 'hello' }, '*'); } catch (e) { /* 忽略 */ } };
  frame.addEventListener('load', hello);
  hello();
  window.addEventListener('message', (e) => {
    const d = e.data || {};
    if (d.type === 'ready') {
      items = d.tour || [];
      if (initial && !sentInitial && items.some((t) => t.key === initial)) { sentInitial = true; frame.contentWindow.postMessage({ type: 'go', key: initial }, '*'); }
      paint();
    } else if (d.type === 'state') {
      active = d.key; paint();
    }
  });
})();
