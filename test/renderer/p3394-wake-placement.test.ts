import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const conversationSource = readFileSync(
  resolve(__dirname, '../../src/renderer/modules/conversation.js'),
  'utf8',
);
const styleSource = readFileSync(
  resolve(__dirname, '../../src/renderer/style.css'),
  'utf8',
);

describe('P3394 wake approval placement', () => {
  it('mounts wake approval cards in the current composer pending area', () => {
    const start = conversationSource.indexOf('function _wakeRequestHost');
    const end = conversationSource.indexOf('\nfunction _renderWakeRequestCard', start);
    const hostSource = conversationSource.slice(start, end);

    expect(hostSource).toContain("#panel-conversation .chat-input-wrapper");
    expect(hostSource).toContain("wrap.querySelector('.chat-wake-pending-host')");
    expect(hostSource).toContain('host.dataset.cid = cid');
    expect(hostSource).toContain('host.dataset.cid !== cid');
    expect(hostSource).toContain("wrap.querySelector('.chat-input-area')");
    expect(hostSource).toContain('wrap.insertBefore(host, anchor || wrap.firstChild)');
    expect(styleSource).toContain('.chat-wake-pending-host');
    expect(styleSource).toContain('pointer-events: auto');
  });

  it('does not attach new wake approvals to historical user chat bubbles', () => {
    expect(conversationSource).not.toContain("role === 'user' && Array.isArray(message.wake_requests)");
    expect(conversationSource).not.toContain("latest?.querySelector('.chat-bubble')");
  });

  it('uses a compact approval strip with clickable buttons', () => {
    const start = conversationSource.indexOf('function _renderWakeRequestCard');
    const end = conversationSource.indexOf('\nfunction _pruneWakeRequestHost', start);
    const renderSource = conversationSource.slice(start, end);

    const cssStart = styleSource.indexOf('.chat-wake-pending-host');
    const cssEnd = styleSource.indexOf('.chat-kstar-review', cssStart);
    const wakeCss = styleSource.slice(cssStart, cssEnd);

    expect(renderSource).toContain('chat-wake-request-main');
    expect(renderSource).toContain("role: 'primary', size: 'sm'");
    expect(renderSource).toContain("data-wake-decision': 'reject'");
    expect(renderSource).toContain('event.stopPropagation()');
    expect(wakeCss).toContain('min-height: 36px');
    expect(wakeCss).toContain('white-space: nowrap');
    expect(wakeCss).not.toContain('flex-direction: column');
  });





  it('shows a short preview by default and keeps the full wake objective behind details', () => {
    const start = conversationSource.indexOf('function _wakeRequestPreview');
    const end = conversationSource.indexOf('\nfunction _mountWakeRequestCards', start);
    const wakeSource = conversationSource.slice(start, end);
    const cssStart = styleSource.indexOf('.chat-wake-pending-host');
    const cssEnd = styleSource.indexOf('.chat-kstar-review', cssStart);
    const wakeCss = styleSource.slice(cssStart, cssEnd);

    expect(wakeSource).toContain('function _wakeRequestPreview');
    expect(wakeSource).toContain('p3394.wake.details.show');
    expect(wakeSource).toContain('p3394.wake.details.hide');
    expect(wakeSource).toContain('chat-wake-request-details');
    expect(wakeCss).toContain('max-height: min(220px, 32vh)');
    expect(wakeCss).toContain('overflow: auto');
  });

  it('deduplicates pending wake cards by agent and objective as a stale-state fallback', () => {
    const start = conversationSource.indexOf('function _mountWakeRequestCards');
    const end = conversationSource.indexOf('\nasync function _resolveWakeRequest', start);
    const mountSource = conversationSource.slice(start, end);

    expect(conversationSource).toContain('function _wakeRequestSemanticKey');
    expect(mountSource).toContain('const requestsByKey = new Map()');
    expect(mountSource).toContain('requestsByKey.has(key)');
    expect(mountSource).toContain('data-wake-request-key');
    expect(mountSource).not.toContain('document.querySelector(selector)');
  });

  it('settles the composer wake card with its outcome instead of removing it silently', () => {
    const start = conversationSource.indexOf('async function _resolveWakeRequest');
    const end = conversationSource.indexOf('\n// ── 外接智能体', start);
    const resolveSource = conversationSource.slice(start, end);

    // 需求口径（2026-10-14 需求方）：批准后卡片退场（授权已生效，回执交给工人气泡上
    // 的运行指示）；拒绝保留定格回执（没有别的信号能说明这次拒绝）。
    expect(resolveSource).toContain("if (decision === 'approve')");
    expect(resolveSource).toContain('card.remove()');
    expect(resolveSource).toContain('_pruneWakeRequestHost(_wakeRequestHost(cid, { create: false }))');
    expect(resolveSource).toContain('_renderWakeRequestCard(card, settled, cid)');
    expect(resolveSource).toContain("status: decision === 'approve' ? 'approved' : 'rejected'");
  });
});
