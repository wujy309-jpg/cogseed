/**
 * 「出生继承」区块的行结构（渲染级）。
 *
 * 锁的是 2026-10-15 真机上量出来的一条：`_inheritanceItemHtml` 只产出一个子元素
 * （`.agents-detail-list-main`），而 `.agents-detail-list-item` 是
 * `grid-template-columns: 18px minmax(0,1fr) auto` 的三列网格 —— 文字因此落进 18px 的
 * 图标列，标题被逐字折行成竖排（headless Chrome 实测：9 个字渲染成 18px 宽、176px 高）。
 *
 * 这里断言的是**意图**：行首第一个单元格必须是图标，文字才会落在 1fr 那一列。
 * 真实像素由浏览器量（style.css 的网格约定由 `agent-shared-ui.test.ts` 锁定）。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as vm from 'node:vm';
import { afterEach, describe, expect, it } from 'vitest';

const noopLogger = { debug() {}, error() {}, info() {}, warn() {} };

/** 只桩掉 `agents.js` 载入时用到的环境缝；被断言的两个函数本身不碰这些桩的行为。 */
function loadAgentsModule() {
  const code = readFileSync(resolve(__dirname, '../../src/renderer/modules/agents.js'), 'utf8');
  const context: Record<string, unknown> = {
    clearTimeout: () => {},
    console,
    createLogger: () => noopLogger,
    document: { addEventListener: () => {}, getElementById: () => null, hidden: false, querySelectorAll: () => [] },
    escapeHtml: (value: unknown) =>
      String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
    setTimeout: () => 0,
    t: (key: string) => key,
    uiIconHtml: (name: string, className: string) => `<svg data-icon="${name}" class="${className}"></svg>`,
    window: { addEventListener: () => {} },
  };
  vm.createContext(context);
  vm.runInContext(code, context, { filename: 'agents.js' });
  return context;
}

const render = (title: string, meta: string, options?: { excludedByUser?: boolean }) =>
  vm.runInContext('_inheritanceItemHtml', loadAgentsModule())(title, meta, options) as string;

afterEach(() => {
  // 纯字符串渲染，无需清理
});

describe('出生继承行：首个单元格是图标', () => {
  it('行首是图标单元 —— 否则文字落进 18px 图标列、逐字竖排', () => {
    const html = render('客户投诉分类标准', 'v3');

    expect(html.trimStart()).toMatch(
      /^<div class="agents-detail-list-item">\s*<span class="agents-detail-list-icon[^"]*"[^>]*>[\s\S]*?<\/span>\s*<div class="agents-detail-list-main">/,
    );
    // 名称与 meta 仍在同一行内（没有被拆成同级单元格）
    expect(html).toContain('<span class="agents-detail-list-text">客户投诉分类标准</span>');
    expect(html).toContain('<span class="agents-detail-list-meta">v3</span>');
  });

  it('用户勾掉的条目带 is-user-choice —— 与系统按状态排除的措辞区分开', () => {
    expect(render('选品分析', '当时已撤销', { excludedByUser: true })).toContain(
      '<span class="agents-detail-list-meta is-user-choice">当时已撤销</span>',
    );
    expect(render('选品分析', '当时已撤销')).not.toContain('is-user-choice');
  });

  it('标题与 meta 走转义，不注入 HTML', () => {
    const html = render('<img src=x onerror=alert(1)>', '<b>v3</b>');

    expect(html).not.toContain('<img');
    expect(html).not.toContain('<b>v3</b>');
    expect(html).toContain('&lt;img');
  });
});
