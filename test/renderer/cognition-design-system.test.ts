import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const rendererRoot = resolve(__dirname, '../../src/renderer');
const pagesSource = readFileSync(resolve(rendererRoot, 'modules/cognition/pages.js'), 'utf8');
const controllerSource = readFileSync(resolve(rendererRoot, 'modules/cognition/cognition.js'), 'utf8');
const rendererCss = readFileSync(resolve(rendererRoot, 'style.css'), 'utf8');

function loadPages() {
  const context: Record<string, unknown> = {};
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  for (const file of [
    'modules/icons.js',
    'modules/ui-button.js',
    'modules/ui-form.js',
    'modules/cognition/pages.js',
  ]) {
    vm.runInContext(readFileSync(resolve(rendererRoot, file), 'utf8'), context, { filename: file });
  }
  return context.CognitionPages as {
    renderCognitionCapture: (input: Record<string, unknown>) => string;
  };
}

describe('cognition design-system integration', () => {
  it('renders capture controls through shared primitives', () => {
    // P-r3-9：认知成长页死页族已删，本契约只覆盖保留的 capture 弹窗。
    const pages = loadPages();
    const capture = pages.renderCognitionCapture({
      state: 'ready',
      title: '名称',
      summary: '方法',
      evidence: '证据',
      sourceLabel: '当前会话',
      suggestedType: 'rule',
      conversationId: 'conv_1',
      messageId: 'msg_1',
    });

    expect(capture).toContain('ui-modal ui-modal--md');
    expect(capture).toContain('ui-modal__header');
    expect(capture).toContain('ui-modal__body');
    expect(capture).toContain('ui-modal__footer');
    expect(capture).toContain('form-input ui-control ui-input');
    expect(capture).toContain('form-input ui-control ui-textarea');
    expect(capture).toContain('ui-icon-button');
  });

  it('delegates modal focus, Escape, and rerender lifecycle to uiModalController', () => {
    expect(controllerSource).toContain("rendered.className = 'ui-modal-overlay cognition-capture-overlay'");
    expect(controllerSource).toContain('window.uiModalController({');
    expect(controllerSource).toContain("modalController.close('rerender', { restoreFocus: false })");
    expect(controllerSource).not.toContain("document.addEventListener('keydown', onKeyDown, true)");
    expect(controllerSource).not.toContain('button[type="submit"]');
  });

  it('keeps only composite or semantic native controls outside shared factories', () => {
    // 死页族删除后 pages.js 只剩 capture 模板：字面原生控件只剩归类的
    // <select>（P-r1-50：两个隐藏域已随死 DOM 删除，hidden 计数为 0）。
    expect((pagesSource.match(/<(?:button|input|textarea|select)\b/gi) || [])).toHaveLength(1);
    expect(pagesSource).toContain('<select class="ui-control"');
    expect((pagesSource.match(/<input type="hidden"/g) || [])).toHaveLength(0);
  });

  it('does not restore page-local modal or control skins over shared components', () => {
    expect(rendererCss).not.toContain('.cognition-capture-actions .btn');
    expect(rendererCss).not.toContain('.cognition-capture-body input, .cognition-capture-body textarea');
    expect(rendererCss).not.toMatch(/\.cognition-capture-modal\s*\{[^}]*border-radius/);
  });
});
