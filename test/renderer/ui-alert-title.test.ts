/**
 * `uiAlert(message, title)` 的第二参数必须真的变成标题栏。
 *
 * 锁的是 2026-10-15 实测到的一条：`marketplace.js` 在安全拦截弹窗上一直传第二个参数
 * （`marketplace.security_blocked_title` / `security_unavailable_title`，四份语言文件里
 * 都有译文），但 `uiAlert` 只接收一个参数、`_uiShowDialog` 也不透传 —— 于是这两枚键成了
 * 死键，弹窗只剩正文直接顶到顶部。
 *
 * 这里不加载整个 `dialogs.js`（它依赖 DOM 与一堆兄弟模块），而是把两个函数源码抽出来，
 * 用替身注入依赖后直接调用，断言**传参行为**本身。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(__dirname, '../../src/renderer/modules/dialogs.js'), 'utf8');

/**
 * 从源码里取出一个具名函数的完整文本。
 *
 * 两个坑都踩过：
 * 1. 参数表本身可能是解构（`function _uiShowDialog({ message, … })`）——从第一个 `{`
 *    开始数括号会在参数表的 `}` 处就归零，抽出 75 个字符的函数头
 *    （症状是 `new Function` 报 `Unexpected token 'return'`）。所以先跨过参数表的 `()`。
 * 2. 函数体里有模板串 `` `${showCancel ? _dialogButton({ … }) : ''}` ``，字符串内的花括号
 *    不能计入配对。下面按状态机跳过字符串、模板串与注释。
 */
function extractFunction(input: string, name: string): string {
  const start = input.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`function not found: ${name}`);
  const bodyBrace = findBodyBrace(input, start);
  let depth = 0;
  let state: 'block' | 'code' | 'double' | 'line' | 'single' | 'template' = 'code';
  // 进入模板串的 `${...}` 时压栈：表达式结束后要回到模板串状态继续读。
  const stack: Array<{ depth: number; state: 'template' }> = [];
  for (let i = bodyBrace; i < input.length; i += 1) {
    const c = input[i];
    const next = input[i + 1];
    if (state === 'code') {
      if (c === "'") state = 'single';
      else if (c === '"') state = 'double';
      else if (c === '`') state = 'template';
      else if (c === '/' && next === '/') { state = 'line'; i += 1; }
      else if (c === '/' && next === '*') { state = 'block'; i += 1; }
      else if (c === '{') depth += 1;
      else if (c === '}') {
        depth -= 1;
        const top = stack[stack.length - 1];
        if (top && depth === top.depth) {
          stack.pop();
          state = top.state;
        } else if (depth === 0) {
          return input.slice(start, i + 1);
        }
      }
      continue;
    }
    if (state === 'single') { if (c === '\\') i += 1; else if (c === "'") state = 'code'; continue; }
    if (state === 'double') { if (c === '\\') i += 1; else if (c === '"') state = 'code'; continue; }
    if (state === 'template') {
      if (c === '\\') i += 1;
      else if (c === '`') state = 'code';
      else if (c === '$' && next === '{') {
        stack.push({ depth, state: 'template' });
        depth += 1;
        state = 'code';
        i += 1;
      }
      continue;
    }
    if (state === 'line') { if (c === '\n') state = 'code'; continue; }
    if (state === 'block' && c === '*' && next === '/') { state = 'code'; i += 1; }
  }
  throw new Error(`unbalanced function: ${name}`);
}

/** 跳过参数表（可能含解构花括号与默认值），返回函数体 `{` 的下标。 */
function findBodyBrace(input: string, start: number): number {
  const open = input.indexOf('(', start);
  if (open < 0) throw new Error('parameter list not found');
  let depth = 0;
  let quote: '' | '"' | "'" | '`' = '';
  for (let i = open; i < input.length; i += 1) {
    const c = input[i];
    if (quote !== '') {
      if (c === '\\') i += 1;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '(') depth += 1;
    else if (c === ')') {
      depth -= 1;
      if (depth === 0) return input.indexOf('{', i);
    }
  }
  throw new Error('parameter list not closed');
}

/** 用替身把 `uiAlert` 抽出来执行，记录它交给 `_uiShowDialog` 的选项。 */
function loadUiAlert() {
  const seen: Array<Record<string, unknown>> = [];
  const factory = new Function(
    '_uiShowDialog',
    `${extractFunction(source, 'uiAlert')}\nreturn uiAlert;`,
  ) as (showDialog: (options: Record<string, unknown>) => Promise<unknown>) => (
    message: string,
    title?: string,
  ) => Promise<void>;
  const uiAlert = factory((options) => {
    seen.push(options);
    return Promise.resolve(true);
  });
  return { seen, uiAlert };
}

/** 同上，但抽的是 `_uiShowDialog`，看它有没有把 title 交给 `_uiMountDialog`。 */
function loadShowDialog() {
  const mounted: Array<Record<string, unknown>> = [];
  const factory = new Function(
    'escapeHtml',
    '_dialogLabel',
    '_dialogButton',
    '_uiMountDialog',
    `${extractFunction(source, '_uiShowDialog')}\nreturn _uiShowDialog;`,
  ) as (...args: unknown[]) => (options: Record<string, unknown>) => unknown;
  const showDialog = factory(
    (value: unknown) => String(value),
    (key: string) => key,
    () => '<button></button>',
    (options: Record<string, unknown>) => {
      mounted.push(options);
      return Promise.resolve(true);
    },
  );
  return { mounted, showDialog };
}

describe('uiAlert 的标题参数', () => {
  it('传了标题 → 交给 _uiShowDialog（弹窗因此渲染标题栏）', async () => {
    const { seen, uiAlert } = loadUiAlert();

    await uiAlert('已阻止安装：这个 Agent 命中安全规则。', '已阻止安装');

    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({
      message: '已阻止安装：这个 Agent 命中安全规则。',
      showCancel: false,
      title: '已阻止安装',
    });
  });

  it('没传标题 → 行为与从前一致（title 为 undefined，不渲染标题栏）', async () => {
    const { seen, uiAlert } = loadUiAlert();

    await uiAlert('普通提示');

    expect(seen[0]).toEqual({ message: '普通提示', showCancel: false, title: undefined });
  });
});

describe('_uiShowDialog 的标题透传', () => {
  it('有 title → 进 _uiMountDialog 的 title', () => {
    const { mounted, showDialog } = loadShowDialog();

    showDialog({ message: 'm', showCancel: false, title: 'T' });

    expect(mounted[0].title).toBe('T');
  });

  it('没 title → 仍然是 undefined（_uiMountDialog 据此不输出 header）', () => {
    const { mounted, showDialog } = loadShowDialog();

    showDialog({ message: 'm', showCancel: false });

    expect(mounted[0].title).toBeUndefined();
    expect(mounted[0].bodyHtml).toBe('m');
  });
});
