import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
const root = resolve(__dirname, '../../src/renderer');
const source = readFileSync(resolve(root, 'modules/conversation.js'), 'utf8');
const lazy = readFileSync(resolve(root, 'modules/lazy-features.js'), 'utf8');

describe('对话认知形成入口统一为夜间发现', () => {
  it('消息菜单不再手动生成认知，复制引用与原始归档操作保留', () => {
    expect(source).not.toContain('bubble-cognition-btn');
    expect(source).not.toContain('_openCognitionCaptureFromBubble');
    expect(source).not.toContain('openCognitionCapture');
    for (const action of ['bubble-copy-btn', 'bubble-quote-btn', 'bubble-select-btn', 'bubble-archive-btn']) expect(source).toContain(action);
  });
  it('不再懒加载手动草稿表单，既有资产与保存回执回看保持可达', () => {
    expect(lazy).not.toContain('./modules/cognition/');
    expect(lazy).toContain('./modules/personal-context-review.js');
    expect(existsSync(resolve(root, 'modules/cognition/cognition.js'))).toBe(false);
    expect(existsSync(resolve(root, 'modules/cognition/pages.js'))).toBe(false);
    expect(source).toContain('data-asset-citation');
    expect(source).toContain('chat-cognition-save-receipt');
  });
});
