import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const source = readFileSync(
  resolve(__dirname, '../../src/renderer/modules/cognition/cognition.js'),
  'utf8',
);

interface TestElement {
  innerHTML?: string;
  dataset?: Record<string, string>;
  disabled?: boolean;
  hidden?: boolean;
  isConnected?: boolean;
  textContent?: string;
  className?: string;
  querySelector?: (selector: string) => TestElement | null;
  querySelectorAll?: (selector: string) => TestElement[];
  addEventListener?: (event: string, handler: () => void) => void;
  prepend?: (element: TestElement) => void;
  focus?: () => void;
}

function loadController() {
  const body = new FakeElement('#document-body');
  const windowObject: Record<string, unknown> = {
    cogseed: { invoke: vi.fn(async () => ({ ok: true })) },
    CognitionPages: {
      renderCognitionCapture: () => '<form data-cognition-capture-form />',
    },
    uiModalController: () => ({ isOpen: () => false, open: () => {}, close: () => {} }),
    addEventListener: vi.fn(),
  };
  windowObject.window = windowObject;
  const sandbox: Record<string, unknown> = {
    window: windowObject,
    document: {
      activeElement: null,
      body,
      createElement: (tag: string) => new FakeElement(tag),
      getElementById: () => null,
      querySelector: vi.fn(() => null),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
    t: (key: string) => key,
    encodeURIComponent,
    Map,
    Set,
    Array,
    Number,
    Math,
    Error,
    String,
    Promise,
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'cognition.js' });
  return { windowObject };
}

class FakeElement {
  tagName: string;
  children: FakeElement[] = [];
  value = '';
  parent: FakeElement | null = null;
  listeners = new Map<string, Array<() => void>>();
  constructor(tag: string) { this.tagName = tag; }
  set innerHTML(html: string) { this.html = html; }
  html = '';
  get isConnected() { return true; }
  appendChild(child: FakeElement) { child.parent = this; this.children.push(child); return child; }
  remove() { if (this.parent) this.parent.children = this.children.filter((c) => c !== this); }
  addEventListener(event: string, handler: () => void) {
    this.listeners.set(event, [...(this.listeners.get(event) || []), handler]);
  }
  querySelector(selector: string): FakeElement | null {
    // 只服务本测试的冒烟断言：capture 表单壳。
    if (selector === '[data-cognition-capture-form]') {
      const form = new FakeElement('form');
      form.dataset = { cognitionCaptureForm: 'true' };
      return form;
    }
    return null;
  }
  querySelectorAll() { return []; }
  dataset: Record<string, string> = {};
  focus() {}
}

describe('cognition renderer controller', () => {
  // P-r3-9（2026-10-01 拍板「死页族删链保留 capture」）：认知成长页死页族
  // （零宿主 DOM + /api/cognition REST 死面 + 分页/详情/动作控制器）已整族
  // 删除。本组守卫死链不回潮：REST 读面零引用、死页入口零导出，capture 面
  // （window.openCognitionCapture，conversation.js 气泡入口消费）保持可用。
  it('keeps the dead cognition growth page chain deleted: no REST calls, no page entry', () => {
    // 注：源码注释保留了对已删 REST 路由的历史说明（字符串 '/api/cognition'
    // 出现在注释里），守卫只锚定实际调用与入口标识，不做裸字符串匹配。
    expect(source).not.toContain('apiFetch');
    expect(source).not.toContain('renderCognitionPage');
    expect(source).not.toContain("getElementById('cognition-page')");
    expect(source).toContain('window.openCognitionCapture = openCognitionCapture');
  });

  it('still exposes the capture dialog controller after the page purge', () => {
    const { windowObject } = loadController();
    expect(typeof windowObject.renderCognitionPage).toBe('undefined');
    expect(typeof windowObject.openCognitionCapture).toBe('function');
    // 沙箱里 renderCognitionCapture 返回表单壳：openCognitionCapture 应能
    // 正常开弹窗（返回 true），不再依赖任何页面 DOM。
    const opened = (windowObject.openCognitionCapture as (input: Record<string, unknown>) => boolean)({
      conversationId: 'c1',
      messageId: 'm1',
    });
    expect(opened).toBe(true);
  });
});
