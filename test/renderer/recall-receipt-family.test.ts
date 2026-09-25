// 对话里两张「本轮带入了什么」的卡必须是一家人（2026-09-25 收口）。
//   A 回执卡：你引用了 N 条认知资产 —— modules/recall-projection-card.js
//   B 记忆卡：提供给本次回答的记忆   —— modules/conversation.js 的 citations
// 真机上两卡并排出现时被认成「两种引用卡片样式」：B 自带一套硬编码品牌绿
// （4 处 rgba(14,159,110,·) + 2 处 #0b7a4f）和 99px 药丸按钮，A 走的是
// --border/--surface/--radius-field + 共享 uiButton。这里钉住统一后的契约：
// 同壳同 token、同一条「图标 + 标题 + 右侧状态」头部语言、动作行只用共享按钮，
// 页面里不再留第二套变体。
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

/** 取某个顶层选择器的声明块；缺块直接红（样式被合并事故吃掉过一次）。 */
function cssBlock(selector: string): string {
  const start = styleSource.indexOf(`\n${selector} {`);
  expect(start, `${selector} 顶层样式缺失`).toBeGreaterThan(-1);
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
  it('两卡共用同一套壳 token，不再各写一份视觉', () => {
    const sharedShell = [
      'margin: 6px 0;',
      'padding: 9px 11px;',
      'border: 1px solid var(--border);',
      'border-radius: var(--radius-field);',
      'background: var(--surface);',
    ];
    for (const selector of [PROJECTION, CITATIONS]) {
      const block = stripComments(cssBlock(selector));
      for (const rule of sharedShell) expect(block, `${selector} 缺「${rule}」`).toContain(rule);
    }
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

  it('两卡头部同构：都是「图标 + 标题 + 右侧状态」，图标同尺寸同色', () => {
    // 记忆卡头部图标（既有）与回执卡头部图标（本次补上）
    expect(conversationSource).toContain("_uiIconHtml('brain-circuit', 'ui-icon')");
    expect(cardSource).toContain("_headIcon('book-open')");
    expect(cardSource).toContain('window.uiIconHtml');
    // 头部图标一律 14px + --primary，两卡一致
    expect(styleSource).toContain('.chat-recall-citations-head .ui-icon { width: 14px; height: 14px; color: var(--primary); }');
    expect(styleSource).toContain('.chat-recall-projection-icon .ui-icon { width: 14px; height: 14px; }');
    expect(stripComments(cssBlock('.chat-recall-projection-icon'))).toContain('color: var(--primary);');
    // 两卡的头部节奏一致（flex-start + 8px 间距），状态/徽标都不抢标题的伸缩位
    for (const selector of ['.chat-recall-projection-head', '.chat-recall-citations-head']) {
      const block = stripComments(cssBlock(selector));
      expect(block).toContain('display: flex;');
      expect(block).toContain('align-items: flex-start;');
      expect(block).toContain('gap: 8px;');
    }
  });

  it('回执卡头部真的渲染图标；图标原语缺席时优雅降级', async () => {
    const withIcons = loadCardModule(true);
    await withIcons.context.window.mountRecallProjectionCard(withIcons.host, { projectionId: 'proj-a' }, { cid: 'cid-a', onlyModelSelected: true });
    expect(withIcons.host.innerHTML).toContain('class="chat-recall-projection-icon"');
    expect(withIcons.host.innerHTML).toContain('is-book-open');
    // 头部顺序：图标在标题之前（与记忆卡同构）
    expect(withIcons.host.innerHTML.indexOf('chat-recall-projection-icon'))
      .toBeLessThan(withIcons.host.innerHTML.indexOf('chat-recall-projection-title'));

    const withoutIcons = loadCardModule(false);
    await withoutIcons.context.window.mountRecallProjectionCard(withoutIcons.host, { projectionId: 'proj-a' }, { cid: 'cid-a', onlyModelSelected: true });
    expect(withoutIcons.host.innerHTML).not.toContain('chat-recall-projection-icon');
    // 降级不能顺手把卡也弄丢：标题与撤销口照旧
    expect(withoutIcons.host.innerHTML).toContain('被引用的资产');
    expect(withoutIcons.host.innerHTML).toContain('data-recall-projection-revoke');
  });
});
