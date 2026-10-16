import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

const chat = readFileSync(resolve(__dirname, '../../src/renderer/modules/conversation.js'), 'utf8');
const core = readFileSync(resolve(__dirname, '../../src/renderer/modules/cognition-assets/core.js'), 'utf8');
function fn(name: string) {
  const start = chat.indexOf(`function ${name}(`);
  return chat.slice(start, chat.indexOf('\n}\n', start) + 2);
}
function replacement(insideCode = false) {
  const children: any[] = [];
  const node = { nodeValue: '查看：\uE000PROPOSALREF0\uE001。', parentElement: { closest: () => insideCode ? {} : null }, parentNode: { replaceChild: vi.fn() } };
  let visited = false;
  const context: any = {
    NodeFilter: { SHOW_TEXT: 4 }, t: () => '查看变更提议', uiButton: (props: unknown) => JSON.stringify(props),
    document: {
      createTreeWalker: () => ({ currentNode: node, nextNode: () => !visited && (visited = true) }),
      createDocumentFragment: () => ({ appendChild: (child: unknown) => children.push(child) }),
      createTextNode: (text: string) => ({ text }),
      createElement: () => { let html = ''; return { set innerHTML(value: string) { html = value; }, content: { cloneNode: () => ({ props: JSON.parse(html) }) } }; },
    },
  };
  runInNewContext(`${fn('_replaceProposalCitationsIn')}\nthis.run = _replaceProposalCitationsIn`, context);
  context.run({}, ['ap-target']);
  return children;
}
function activation(id: string, lazy = false) {
  const opened = vi.fn();
  const window: any = { ...(lazy ? {} : { openCognitionApprovalById: opened }) };
  window.loadRendererFeature = vi.fn(async () => { window.openCognitionApprovalById = opened; });
  let handler: any;
  const start = chat.indexOf('// [proposal:<id>] opens');
  const end = chat.indexOf('\n});', start) + 4;
  runInNewContext(chat.slice(start, end), { window, _convLog: { warn: vi.fn() }, document: { addEventListener: (_type: string, callback: unknown) => { handler = callback; } } });
  handler({ target: { closest: () => ({ dataset: { proposalCitation: id } }) } });
  return { opened, loader: window.loadRendererFeature };
}

describe('existing proposal conversation citations', () => {
  it('uses the existing markdown chokepoint without NUL placeholders or accepting invalid IDs', () => {
    let markdown = '';
    const context: any = { _skillsForDisplayNameRewrite: () => [], _htmlMayContainKnownSkillIdForDisplay: () => false,
      renderMarkdownFull: (text: string) => { markdown = text; return ''; } };
    runInNewContext(`${fn('_renderMessageMarkdown')}\nthis.run = _renderMessageMarkdown`, context);
    context.run('请查看 [proposal:ap-target]，不是 [proposal:../outside]');
    expect(markdown).not.toContain('[proposal:ap-target]');
    expect(markdown).not.toMatch(/[\u0000-\u001f]/);
    expect(markdown).toContain('[proposal:../outside]');
  });
  it('uses a shared button for the exact existing proposal; code blocks keep the literal marker', () => {
    expect(replacement()).toEqual([{ text: '查看：' }, { props: { label: '查看变更提议', role: 'ghost', size: 'sm', attrs: { 'data-proposal-citation': 'ap-target' } } }, { text: '。' }]);
    expect(replacement(true)).toEqual([{ text: '查看：' }, { text: '[proposal:ap-target]' }, { text: '。' }]);
  });
  it('opens exactly the referenced proposal, including the first lazy-loaded click', async () => {
    for (const lazy of [false, true]) {
      const result = activation('ap-target', lazy);
      await Promise.resolve(); await Promise.resolve();
      expect(result.opened).toHaveBeenCalledExactlyOnceWith('ap-target');
      expect(result.loader).toHaveBeenCalledTimes(lazy ? 1 : 0);
      if (lazy) expect(result.loader).toHaveBeenCalledWith('recall');
    }
    expect(activation('../outside').opened).not.toHaveBeenCalled();
  });
  it('routes and reloads the existing activity without creating or deciding a proposal', () => {
    const start = core.indexOf('window.openCognitionApprovalById =');
    const end = core.indexOf('\n  };', start) + 5;
    const route = vi.fn(), reload = vi.fn(), show = vi.fn();
    const context: any = { window: {}, showRecallPanel: show, router: { go: route }, NS: { reload } };
    runInNewContext(core.slice(start, end), context);
    expect(context.window.openCognitionApprovalById('ap-target')).toBe(true);
    expect(route).toHaveBeenCalledExactlyOnceWith({ name: 'activity', approvalId: 'ap-target' });
    expect(reload).toHaveBeenCalledOnce();
    expect(context.window.openCognitionApprovalById('../outside')).toBe(false);
    expect(route).toHaveBeenCalledOnce();
  });
});
