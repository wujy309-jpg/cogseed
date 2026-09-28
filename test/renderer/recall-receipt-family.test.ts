// 对话里两张「本轮带入了什么」的卡必须是一家人（2026-09-25 收口）。
//   A 回执卡：你引用了 N 条认知资产 —— modules/recall-projection-card.js
//   B 记忆卡：提供给本次回答的记忆   —— modules/conversation.js 的 citations
// 真机上两卡并排出现时被认成「两种引用卡片样式」：B 自带一套硬编码品牌绿
// （4 处 rgba(14,159,110,·) + 2 处 #0b7a4f）和 99px 药丸按钮，A 走的是
// --border/--surface/--radius-field + 共享 uiButton。这里钉住统一后的契约：
// 同壳同 token、同一条「图标 + 标题 + 右侧状态」头部语言、动作行只用共享按钮，
// 页面里不再留第二套变体。
// 2026-09-28 二次收口：从「像一家人」收紧为「样式完全一致的一个」——壳与
// 头部结构类在 style.css 里只准有一份分组选择器（两卡选择器同块），单卡壳
// 覆写（620px 宽度上限）删除；两卡头部 DOM 同构（图标位 / 标题块 / 右侧状态）。
import { describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import vm from 'node:vm';

const ROOT = path.resolve(__dirname, '../..');
const styleSource = fs.readFileSync(path.join(ROOT, 'src/renderer/style.css'), 'utf8');
const conversationSource = fs.readFileSync(path.join(ROOT, 'src/renderer/modules/conversation.js'), 'utf8');
const cardSource = fs.readFileSync(path.join(ROOT, 'src/renderer/modules/recall-projection-card.js'), 'utf8');

const PROJECTION = '.chat-recall-projection-card';
const CITATIONS = '.chat-recall-citations';

/** 取某个顶层选择器的声明块；缺块直接红（样式被合并事故吃掉过一次）。
 *  2026-09-28 起家族共享规则写成分组选择器（A 卡, B 卡 { }），块可能以
 *  「selector,」开头，两种形态都要找得到。 */
function cssBlock(selector: string): string {
  const own = styleSource.indexOf(`\n${selector} {`);
  const grouped = styleSource.indexOf(`\n${selector},`);
  const start = own > -1 ? own : grouped;
  expect(start, `${selector} 顶层样式缺失（含分组选择器）`).toBeGreaterThan(-1);
  const end = styleSource.indexOf('\n}', start);
  expect(end, `${selector} 声明块没有闭合`).toBeGreaterThan(start);
  return styleSource.slice(start, end + 2);
}

/** 注释里会写到"被删掉的旧色值"，所以查硬编码前先把注释剥掉。 */
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

function loadCardModule(withIconPrimitive: boolean) {
  const host: any = { className: '', innerHTML: '', dataset: {}, addEventListener() {} };
  const context: any = {
    window: {
      cogseed: {
        invoke: async (channel: string) => channel === 'recall.projections.card'
          ? {
              ok: true,
              card: {
                projectionId: 'proj-a',
                status: 'confirmed',
                authorization: 'user_confirmed',
                purpose: 'user_pinned',
                totalAssetCount: 1,
                assetSummaries: [{ assetId: 'asset-a', title: '被引用的资产', version: '2' }],
              },
            }
          : { ok: true, assets: [] },
      },
      uiButton: ({ label, attrs }: { label: string; attrs?: Record<string, string> }) => {
        const extra = Object.entries(attrs || {}).map(([key, value]) => ` ${key}="${String(value)}"`).join('');
        return `<button type="button" class="btn ui-button"${extra}><span class="ui-button__label">${String(label)}</span></button>`;
      },
    },
    document: {},
    escapeHtml: (value: unknown) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
    t: (_key: string, varsOrFallback?: unknown) => (typeof varsOrFallback === 'string' ? varsOrFallback : _key),
    uiAlert: vi.fn(),
    console,
  };
  if (withIconPrimitive) {
    context.window.uiIconHtml = (name: string, className: string) => `<svg class="${className} is-${name}" aria-hidden="true"></svg>`;
  }
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(cardSource, context, { filename: 'recall-projection-card.js' });
  return { context, host };
}

describe('对话内引用卡片家族（回执卡 + 记忆卡）', () => {
  it('两卡壳完全一致：一份分组共享块，禁止单卡壳覆写', () => {
    const sharedShell = [
      'margin: 6px 0;',
      'padding: 9px 11px;',
      'border: 1px solid var(--border);',
      'border-radius: var(--radius-field);',
      'background: var(--surface);',
      'color: var(--text);',
      'font-size: var(--font-size-caption);',
      'line-height: 1.45;',
      'box-shadow: none;',
    ];
    const block = stripComments(cssBlock(PROJECTION));
    for (const rule of sharedShell) expect(block, `共享壳缺「${rule}」`).toContain(rule);
    // 分组块必须同时点名两张卡：单一事实源，不是两份各写（防合并事故再次分叉）
    expect(block).toContain(`\n${CITATIONS} {`);
    // 单卡几何覆写已删：is-model-selected 的 620px 曾让回执卡比同气泡的记忆卡
    // 窄一圈，又被认成两种样式（全文件其他 620px 与本家族无关，不做全局禁令）
    expect(styleSource).not.toMatch(/^\.chat-recall-projection-card\.is-model-selected \{/m);
    // 记忆卡侧不得再留自己的壳块：`.chat-recall-citations {` 全文件只允许
    // 出现一次（共享分组块的第二行）
    const shellBlocks = stripComments(styleSource).split(`\n${CITATIONS} {`).length - 1;
    expect(shellBlocks, '记忆卡壳只能来自共享分组块').toBe(1);
  });

  it('记忆卡不再自带硬编码品牌绿，页内药丸变体已删除', () => {
    const block = stripComments(cssBlock(CITATIONS));
    expect(block).not.toContain('rgba(14, 159, 110');
    expect(block).not.toContain('#0b7a4f');
    expect(block).not.toContain('border-radius: 99px');
    // 字号也收进 token（原先散着 12px / 11px 字面量）
    expect(block).not.toMatch(/font-size:\s*\d+px/);
    // 反馈按钮不再被页内重绘成第二个变体：只留业务态（已反馈）这一条
    expect(styleSource).not.toMatch(/^\.chat-recall-feedback-btn \{$/m);
    expect(styleSource).toMatch(/^\.chat-recall-citations\.is-feedback-sent \.chat-recall-feedback-btn \{/m);
  });

  it('头部同一份分组规则：head/icon/title/strong/status 两卡同块，图标同尺寸同色', () => {
    // 记忆卡头部图标（既有）与回执卡头部图标（2026-09-25 补上）
    expect(conversationSource).toContain("_uiIconHtml('brain-circuit', 'ui-icon')");
    expect(cardSource).toContain("_headIcon('book-open')");
    expect(cardSource).toContain('window.uiIconHtml');
    // 结构类两两同块：分组块里必须能同时找到两卡的选择器
    for (const [projectionSel, citationsSel] of [
      ['.chat-recall-projection-head', '.chat-recall-citations-head'],
      ['.chat-recall-projection-icon', '.chat-recall-citations-icon'],
      ['.chat-recall-projection-title', '.chat-recall-citations-title'],
    ] as const) {
      const block = cssBlock(projectionSel);
      expect(block, `${projectionSel} 与 ${citationsSel} 必须同块`).toContain(`\n${citationsSel} {`);
    }
    // 标题排版同一份：caption + semibold + 1.35
    const strong = cssBlock('.chat-recall-projection-title strong');
    expect(strong).toContain('.chat-recall-citations-title strong {');
    expect(strong).toContain('font-size: var(--font-size-caption);');
    expect(strong).toContain('font-weight: var(--font-weight-semibold);');
    expect(strong).toContain('line-height: 1.35;');
    // 头部图标一律 14px + --primary（色在图标位上，两卡同源）
    const icon = cssBlock('.chat-recall-projection-icon');
    expect(icon).toContain('.chat-recall-citations-icon {');
    expect(icon).toContain('color: var(--primary);');
    expect(cssBlock('.chat-recall-projection-icon .ui-icon')).toContain('width: 14px; height: 14px;');
    // 右侧状态与徽标同一份让位规则：flex 不抢标题伸缩位 + 顶部对齐 1px
    const badge = cssBlock('.chat-recall-projection-badge');
    expect(badge).toContain('flex: 0 0 auto;');
    expect(badge).toContain('margin-top: 1px;');
    const status = cssBlock('.chat-recall-feedback-status');
    expect(status).toContain('flex: 0 0 auto;');
    expect(status).toContain('margin-top: 1px;');
    expect(status).toContain('color: var(--muted);');
    expect(status).toContain('font-size: var(--font-size-1);');
    // 头部节奏一致（flex-start + 8px 间距 + 统一 8px 头部下间距）
    const head = stripComments(cssBlock('.chat-recall-projection-head'));
    expect(head).toContain('display: flex;');
    expect(head).toContain('align-items: flex-start;');
    expect(head).toContain('gap: 8px;');
    expect(head).toContain('margin-bottom: 8px;');
  });

  it('记忆卡头部 DOM 与回执卡同构：图标位 / 标题块分立，图标在标题之前', () => {
    expect(conversationSource).toContain('class="chat-recall-citations-icon"');
    expect(conversationSource).toContain('class="chat-recall-citations-title"');
    // 与回执卡同一条头部顺序：图标位在标题块之前
    expect(conversationSource.indexOf('chat-recall-citations-icon'))
      .toBeLessThan(conversationSource.indexOf('chat-recall-citations-title'));
    // 旧头部（图标+标题挤在同一个 span 的 `> span:first-child` 规则）不许回来
    expect(styleSource).not.toContain('.chat-recall-citations-head > span:first-child');
  });

  it('回执卡头部真的渲染图标；图标原语缺席时优雅降级', async () => {
    const withIcons = loadCardModule(true);
    await withIcons.context.window.mountRecallProjectionCard(withIcons.host, { projectionId: 'proj-a' }, { cid: 'cid-a', onlyModelSelected: true });
    expect(withIcons.host.innerHTML).toContain('class="chat-recall-projection-icon"');
    expect(withIcons.host.innerHTML).toContain('is-book-open');
    expect(withIcons.host.innerHTML).toContain('data-asset-citation="asset-a"');
    expect(withIcons.host.innerHTML).toContain('class="ui-button__label">被引用的资产</span>');
    // 头部顺序：图标在标题之前（与记忆卡同构）
    expect(withIcons.host.innerHTML.indexOf('chat-recall-projection-icon'))
      .toBeLessThan(withIcons.host.innerHTML.indexOf('chat-recall-projection-title'));

    const withoutIcons = loadCardModule(false);
    await withoutIcons.context.window.mountRecallProjectionCard(withoutIcons.host, { projectionId: 'proj-a' }, { cid: 'cid-a', onlyModelSelected: true });
    expect(withoutIcons.host.innerHTML).not.toContain('chat-recall-projection-icon');
    // 降级不能顺手把卡也弄丢：标题与撤销口照旧
    expect(withoutIcons.host.innerHTML).toContain('被引用的资产');
    expect(withoutIcons.host.innerHTML).toContain('data-asset-citation="asset-a"');
    expect(withoutIcons.host.innerHTML).toContain('data-recall-projection-revoke');
  });
});
