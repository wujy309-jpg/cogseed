/**
 * kb-meeting-refs — 会议引用面板骨架（specs/013 · T014）
 *
 * 覆盖：
 *   1. mount/destroy 生命周期：五个分区（资产引用/纪要条目/待办草稿/关联建议/
 *      回执）各自渲染一条空态（共享 uiEmptyState），不静默空白；
 *   2. i18n 契约：订阅 i18n-change、destroy 解绑；四语 locale 的 kb.meetingRef.*
 *      键数一致（新增键必须四语齐全，与 kb-i18n-keys 门禁同一口径）；
 *   3. 源码契约：零裸控件（shared-ui-adoption-guard 的另一面）、文案走内联键名。
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vm from 'node:vm';

const root = path.resolve(__dirname, '../..');
const readSrc = (rel: string) => fs.readFileSync(path.join(root, 'src', rel), 'utf8');
const moduleSrc = readSrc('renderer/modules/kb-meeting-refs.js');

const exports = require('../../src/renderer/modules/kb-meeting-refs.js') as {
  SECTION_KEYS: string[];
};

function fakeElement(): any {
  const el: any = {
    _text: '', children: [], innerHTML: '', hidden: false, dataset: {}, style: {}, title: '',
    classList: { add: () => {}, remove: () => {}, contains: () => false, toggle: () => false },
    appendChild: (child: any) => { el.children.push(child); return child; },
    append: (...kids: any[]) => { kids.forEach((k) => el.children.push(k)); },
    addEventListener: () => {}, removeEventListener: () => {},
    querySelector: () => null, querySelectorAll: () => [], closest: () => null,
    setAttribute: () => {}, getAttribute: () => null, removeAttribute: () => {},
    insertBefore: () => {}, insertAdjacentHTML: () => {},
    focus: () => {}, remove: () => {}, replaceWith: () => {},
  };
  Object.defineProperty(el, 'textContent', {
    get: () => el._text,
    set: (v: any) => { el._text = String(v ?? ''); el.children = []; el.innerHTML = ''; },
    configurable: true,
  });
  return el;
}

function loadModule(overrides: Record<string, unknown> = {}) {
  const handlers: Record<string, Array<() => void>> = {};
  const windowMock: any = {
    addEventListener: (name: string, fn: () => void) => { (handlers[name] = handlers[name] || []).push(fn); },
    removeEventListener: (name: string, fn: () => void) => {
      handlers[name] = (handlers[name] || []).filter((h) => h !== fn);
    },
    t: () => '',
    cogseed: { invoke: async () => ({}) },
    uiEmptyState: (o: any) => `<div class="ui-empty-state">${String(o?.title || '')}</div>`,
    ...overrides,
  };
  const context: any = {
    console, setTimeout, clearTimeout, Map, Set, Array, Object, String, Number, JSON,
    document: { createElement: () => fakeElement(), body: fakeElement(), addEventListener: () => {}, removeEventListener: () => {} },
    window: windowMock,
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(moduleSrc, context, { filename: 'kb-meeting-refs.js' });
  return { windowMock, handlers, listenerCount: () => (handlers['i18n-change'] || []).length };
}

function mountPanel(overrides: Record<string, unknown> = {}) {
  const nodes = new Map<string, any>();
  const container = fakeElement();
  container.querySelector = (selector: string) => {
    if (!nodes.has(selector)) nodes.set(selector, fakeElement());
    return nodes.get(selector);
  };
  const loaded = loadModule(overrides);
  const instance = loaded.windowMock.KbMeetingRefs.mount(container, {
    docId: 'meetings/9.15站会.txt',
    displayPath: 'meetings/9.15站会.txt',
  });
  return { instance, nodes, ...loaded, container };
}

describe('kb-meeting-refs 骨架（T014）', () => {
  it('暴露 window.KbMeetingRefs = { mount, destroy }（与 KbTranscriptCorrect 同款形态）', () => {
    const { windowMock } = loadModule();
    expect(typeof windowMock.KbMeetingRefs?.mount).toBe('function');
    expect(typeof windowMock.KbMeetingRefs?.destroy).toBe('undefined'); // destroy 在实例上
  });

  it('五个分区各渲染一条空态：资产引用/纪要条目/待办草稿/关联建议/回执', () => {
    const { nodes, instance } = mountPanel();
    const sectionsHost = nodes.get('[data-mrf-sections]');
    const sections = sectionsHost.children;
    expect(sections.map((s: any) => s.dataset.mrfSection))
      .toEqual(['refs', 'conclusions', 'actions', 'related', 'receipts']);

    const empties = sections.map((s: any) => s.children[1].innerHTML);
    expect(empties[0]).toContain('暂无资产引用');
    expect(empties[1]).toContain('暂无纪要条目');
    expect(empties[2]).toContain('暂无待办草稿');
    expect(empties[3]).toContain('暂无关联建议');
    expect(empties[4]).toContain('暂无回执');

    // 标题与提示也渲染（面板标题/文件名尾段）
    expect(nodes.get('[data-mrf-title]')._text).toBe('会议引用');
    expect(nodes.get('[data-mrf-meta]')._text).toBe('9.15站会.txt');
    expect(nodes.get('[data-mrf-hint]')._text).toContain('冻结版');
    instance.destroy();
  });

  it('i18n-change 重渲染取新语言；destroy 解绑并清空容器', () => {
    const env = mountPanel();
    expect(env.listenerCount()).toBe(1);
    env.instance.destroy();
    expect(env.listenerCount()).toBe(0);
    expect(env.container._text).toBe('');
    expect(env.container.children).toEqual([]);
  });

  it('mount 前置校验：容器 / IPC / 共享原语 / docId 缺一即抛', () => {
    const { windowMock } = loadModule();
    expect(() => windowMock.KbMeetingRefs.mount(null, { docId: 'd' })).toThrow();
    const noIpc = loadModule({ cogseed: undefined }).windowMock;
    expect(() => noIpc.KbMeetingRefs.mount(fakeElement(), { docId: 'd' })).toThrow(/ipc/);
    const noEmpty = loadModule({ uiEmptyState: undefined }).windowMock;
    expect(() => noEmpty.KbMeetingRefs.mount(fakeElement(), { docId: 'd' })).toThrow(/primitives/);
    expect(() => windowMock.KbMeetingRefs.mount(fakeElement(), {})).toThrow(/docId/);
  });

  it('SECTION_KEYS 导出五个分区（后续任务按分区接线数据）', () => {
    expect(exports.SECTION_KEYS).toEqual(['refs', 'conclusions', 'actions', 'related', 'receipts']);
  });
});

describe('kb-meeting-refs 源码与 i18n 契约', () => {
  it('零裸控件：不出现裸 button/input/textarea/select 与 createElement 控件', () => {
    expect(/<(?:button|input|textarea|select)\b/i.test(moduleSrc)).toBe(false);
    expect(/createElement\(\s*['"](?:button|input|textarea|select)['"]/i.test(moduleSrc)).toBe(false);
  });

  it('文案全部走内联键名（kb.meetingRef.*），订阅 i18n-change', () => {
    expect(moduleSrc).toContain("t('kb.meetingRef.");
    expect(moduleSrc).toContain('i18n-change');
  });

  it('四语 locale 的 kb.meetingRef.* 键数一致（新增键必须四语齐全）', () => {
    const counts = ['zh', 'en', 'ja', 'pt'].map((lang) => {
      const dict = JSON.parse(readSrc(`renderer/locales/${lang}.json`)) as Record<string, string>;
      return Object.keys(dict).filter((k) => k.startsWith('kb.meetingRef.')).length;
    });
    expect(counts[0]).toBeGreaterThan(40);
    expect(counts).toEqual([counts[0], counts[0], counts[0], counts[0]]);
  });

  it('zh 值与代码内联回退逐字一致（缺键回退不得给出第二套措辞）', () => {
    const zh = JSON.parse(readSrc('renderer/locales/zh.json')) as Record<string, string>;
    const re = /\bt\(\s*'(kb\.meetingRef\.[a-zA-Z0-9_.]+)'\s*,\s*'((?:[^'\\]|\\.)*)'/g;
    const drift: string[] = [];
    for (const m of moduleSrc.matchAll(re)) {
      const fallback = m[2].replace(/\\n/g, '\n').replace(/\\'/g, "'").replace(/\\\\/g, '\\');
      if (zh[m[1]] !== fallback) drift.push(`${m[1]}\n    代码回退: ${fallback}\n    zh.json : ${zh[m[1]]}`);
    }
    expect(drift).toEqual([]);
  });
});
