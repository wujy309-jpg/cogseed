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
  const fragment: any[] = [];
  const node = { nodeValue: '依据：\uE000ONTOLOGYREF0\uE001。', parentElement: { closest: () => insideCode ? {} : null }, parentNode: { replaceChild: vi.fn() } };
  let visited = false;
  const context: any = {
    NodeFilter: { SHOW_TEXT: 4, FILTER_REJECT: 2, FILTER_ACCEPT: 1 }, t: () => '查看本体依据',
    uiButton: (props: unknown) => JSON.stringify(props),
    document: {
      createTreeWalker: (_root: unknown, _what: unknown, filter: any) => ({ currentNode: node, nextNode: () => !visited && (visited = true) && filter.acceptNode(node) === 1 }),
      createDocumentFragment: () => ({ appendChild: (child: unknown) => fragment.push(child) }),
      createTextNode: (text: string) => ({ text }),
      createElement: () => { let html = ''; return { set innerHTML(value: string) { html = value; }, content: { cloneNode: () => ({ props: JSON.parse(html) }) } }; },
    },
  };
  runInNewContext(`${fn('_replaceOntologyCitationsIn')}\nthis.run = _replaceOntologyCitationsIn`, context);
  context.run({}, [{ moduleId: 'module-a', recordId: 'record-a', version: 3 }]);
  return { fragment, replace: node.parentNode.replaceChild };
}
function activation(data: Record<string, string>, lazy = false) {
  const opened = vi.fn();
  const loader = vi.fn(async () => { window.openCognitionOntologyRecord = opened; });
  const window: any = { loadRendererFeature: loader, ...(lazy ? {} : { openCognitionOntologyRecord: opened }) };
  let handler: any;
  const start = chat.indexOf('// [[ontology:module/record@version]]');
  const end = chat.indexOf('\n});', start) + 4;
  runInNewContext(chat.slice(start, end), { window, document: { addEventListener: (_type: string, callback: unknown) => { handler = callback; } } });
  handler({ target: { closest: () => ({ dataset: data }) } });
  return { opened, loader };
}

describe('最终答复本体依据', () => {
  it('传入 Markdown 的引用占位符不含会被 HTML 解析丢弃的控制字符，非法版本保持原文', () => {
    let input = '';
    const context: any = {
      _skillsForDisplayNameRewrite: () => [],
      _htmlMayContainKnownSkillIdForDisplay: () => false,
      renderMarkdownFull: (text: string) => { input = text; return ''; },
    };
    runInNewContext(`${fn('_renderMessageMarkdown')}\nthis.run = _renderMessageMarkdown`, context);
    context.run('正文 [[ontology:module-a/record-a@3]] [[ontology:module-a/record-a@0]]');
    expect(input).not.toMatch(/[\u0000-\u001f]/);
    expect(input).not.toContain('[[ontology:module-a/record-a@3]]');
    expect(input).toContain('[[ontology:module-a/record-a@0]]');
  });
  it('共享按钮保留确切模块、记录和版本，以及前后正文', () => {
    const result = replacement();
    expect(result.fragment).toEqual([{ text: '依据：' }, { props: {
      label: '查看本体依据 · v3', role: 'ghost', size: 'sm', attrs: { 'data-ontology-citation': 'record-a', 'data-ontology-module': 'module-a', 'data-ontology-version': '3' },
    } }, { text: '。' }]);
    expect(result.replace).toHaveBeenCalledOnce();
  });
  it('代码块不产生可点击依据按钮', () => {
    const result = replacement(true);
    expect(result.fragment).toEqual([{ text: '依据：' }, { text: '[[ontology:module-a/record-a@3]]' }, { text: '。' }]);
    expect(result.replace).toHaveBeenCalledOnce();
  });
  it('点击后打开引用版本，不能默认跳到最新版本', () => {
    const result = activation({ ontologyCitation: 'record-a', ontologyModule: 'module-a', ontologyVersion: '3' });
    expect(result.opened).toHaveBeenCalledWith('module-a', 'record-a', 3);
    expect(result.loader).not.toHaveBeenCalled();
  });
  it('首次点击先加载认知资产，再打开相同版本', async () => {
    const result = activation({ ontologyCitation: 'record-a', ontologyModule: 'module-a', ontologyVersion: '7' }, true);
    await Promise.resolve(); await Promise.resolve();
    expect(result.loader).toHaveBeenCalledWith('recall');
    expect(result.opened).toHaveBeenCalledWith('module-a', 'record-a', 7);
  });
  it('拒绝无效身份、路径和非正整数版本', () => {
    for (const bad of [{ ontologyCitation: '../outside' }, { ontologyModule: 'a/b' }, { ontologyVersion: '0' }, { ontologyVersion: '1.5' }, { ontologyVersion: '1000000000' }]) {
      const result = activation({ ontologyCitation: 'record-a', ontologyModule: 'module-a', ontologyVersion: '3', ...bad });
      expect(result.opened).not.toHaveBeenCalled();
      expect(result.loader).not.toHaveBeenCalled();
    }
  });
  it('正式入口按确切版本路由并刷新主档，非法请求无副作用', () => {
    const start = core.indexOf('window.openCognitionOntologyRecord =');
    const end = core.indexOf('\n  };', start) + 5;
    const route = vi.fn(), reload = vi.fn(), show = vi.fn();
    const context: any = { window: {}, showRecallPanel: show, NS: { openPersonalOntology: route, reload } };
    runInNewContext(core.slice(start, end), context);
    expect(context.window.openCognitionOntologyRecord('module-a', 'record-a', 3)).toBe(true);
    expect(route).toHaveBeenCalledWith({ moduleId: 'module-a', recordId: 'record-a', recordVersion: 3 });
    expect(reload).toHaveBeenCalledOnce();
    expect(context.window.openCognitionOntologyRecord('module-a', 'record-a', 0)).toBe(false);
    expect(show).toHaveBeenCalledOnce();
  });
});
