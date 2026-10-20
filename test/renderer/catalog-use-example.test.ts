/**
 * S4 「使用」与点示例（specs/009-agent-skill-pages FR-008）：
 * 智能体页详情的 use / sendExample 处理函数，以及新任务初始消息的发送。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const source = fs.readFileSync(path.join(__dirname, '../../src/renderer/modules/agents.js'), 'utf8');

function load(): any {
  const window: any = { addEventListener() {}, removeEventListener() {}, cogseed: { invoke() {} } };
  window.window = window;
  const timers: Array<() => void> = [];
  const elements: Record<string, any> = {};
  const context: any = {
    window, console, clearTimeout, timers, elements,
    setTimeout: (fn: () => void) => { timers.push(fn); return timers.length; },
    Event: class { type: string; constructor(type: string) { this.type = type; } },
    document: { getElementById: (id: string) => elements[id] || null },
    createLogger: () => ({ warn() {}, error() {}, info() {} }),
    t: (key: string) => key,
    escapeHtml: (v: string) => String(v),
    getLang: () => 'zh',
    pickDesc: () => '',
    renderAvatarHtml: () => '',
    normalizeDisplayText: (v: string) => String(v || '').trim(),
    normalizeCatalogSource: (s: string) => String(s || '').trim().toLowerCase(),
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'agents.js' });
  return context;
}

function capturePopup(ctx: any) {
  const calls: any[] = [];
  ctx.openCatalogPopup = (view: any, handlers: any) => { calls.push({ view, handlers }); };
  ctx.useAgent = (...args: unknown[]) => { calls.push({ use: args }); };
  return calls;
}

describe('详情里的「使用」与示例', () => {
  it('已安装：使用调用 useAgent；示例作为初始消息传给 useAgent', () => {
    const ctx = load();
    vm.runInContext('_agentsCache = [{ agent_id: "p1", name: "P1", source: "marketplace" }]', ctx);
    const calls = capturePopup(ctx);
    vm.runInContext('_openAgentCatalogPopup', ctx)('p1');
    const { view, handlers } = calls[0];
    expect(view.origin).toBe('platform');
    expect(view.installed).toBe(true);
    handlers.use();
    handlers.sendExample('帮我写周报');
    expect(calls.slice(1).map((c) => c.use)).toEqual([['p1', 'agent_card'], ['p1', 'agent_card', '帮我写周报']]);
  });

  it('未安装：示例先安装，装好后才带着示例进入新任务', async () => {
    const ctx = load();
    const calls = capturePopup(ctx);
    ctx.catalogInstall = async (_kind: string, row: any) => {
      vm.runInContext(`_agentsCache = [{ agent_id: ${JSON.stringify(row.id)}, source: "marketplace" }]`, ctx);
      return true;
    };
    vm.runInContext('_agentsCache = []', ctx);
    vm.runInContext('_openAgentCatalogPopup', ctx)(null, { id: 'p2', name: 'P2' });
    expect(calls[0].view.installed).toBe(false);
    await calls[0].handlers.sendExample('试一下');
    expect(calls[1].use).toEqual(['p2', 'agent_card', '试一下']);
  });

  it('未安装且安装失败：不进入任务', async () => {
    const ctx = load();
    const calls = capturePopup(ctx);
    ctx.catalogInstall = async () => false;
    vm.runInContext('_agentsCache = []', ctx);
    vm.runInContext('_openAgentCatalogPopup', ctx)(null, { id: 'p3', name: 'P3' });
    await calls[0].handlers.sendExample('试一下');
    expect(calls.filter((c) => c.use)).toHaveLength(0);
  });
});

describe('新任务初始消息', () => {
  it('填入输入框并提交', () => {
    const ctx = load();
    const events: string[] = [];
    ctx.elements['new-chat-input'] = { value: '', dispatchEvent: (e: any) => events.push(e.type) };
    let submitted = 0;
    ctx.handleNewChatSubmit = () => { submitted++; };
    vm.runInContext('_sendNewChatInitialMessage', ctx)('  你好  ');
    ctx.timers.forEach((fn: () => void) => fn());
    expect(ctx.elements['new-chat-input'].value).toBe('你好');
    expect(events).toEqual(['input']);
    expect(submitted).toBe(1);
  });

  it('空消息不提交', () => {
    const ctx = load();
    vm.runInContext('_sendNewChatInitialMessage', ctx)('   ');
    expect(ctx.timers).toHaveLength(0);
  });
});
