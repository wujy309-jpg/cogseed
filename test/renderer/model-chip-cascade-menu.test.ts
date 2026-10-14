// Exec-config chip — provider → model menu plus direct task effort selection.
// Uses the production classic script with a DOM double, including override
// persistence and reopen paths. Real Electron verification is separate.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const root = resolve(__dirname, '../..');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// 悬停开启 90ms / 收起 220ms（见 model-chip.js 的 _FLYOUT_*_DELAY）。
const afterOpen = () => sleep(140);
const afterClose = () => sleep(280);

/** 选择器匹配：支持 tag / #id / .class 及其组合（'.row.is-disabled'）。 */
function matchesSelector(el: FakeElement, selector: string): boolean {
  const id = selector.match(/#([^.#]+)/)?.[1];
  const classes = Array.from(selector.matchAll(/\.([^.#]+)/g), (m) => m[1]);
  const tag = selector.replace(/[#.][^.#]+/g, '').trim();
  if (tag && el.tagName.toLowerCase() !== tag.toLowerCase()) return false;
  if (id && el.id !== id) return false;
  const own = el.className.split(/\s+/);
  return classes.every((name) => own.includes(name));
}

class FakeClassList {
  constructor(private readonly el: FakeElement) {}
  private names() { return this.el.className.split(/\s+/).filter(Boolean); }
  add(...names: string[]) { this.el.className = Array.from(new Set([...this.names(), ...names])).join(' '); }
  remove(...names: string[]) { this.el.className = this.names().filter((n) => !names.includes(n)).join(' '); }
  contains(name: string) { return this.names().includes(name); }
  toggle(name: string, force?: boolean) {
    const next = force === undefined ? !this.contains(name) : force;
    if (next) this.add(name);
    else this.remove(name);
    return next;
  }
}

class FakeElement {
  id = '';
  readonly tagName: string;
  dataset: Record<string, string> = {};
  // classList 以 className 为准（真实 DOM 里两者是同一份状态；分成两套会让
  // 直接赋 className 的渲染代码在断言里"看不见"自己的类）。
  classList = new FakeClassList(this);
  className = '';
  hidden = false;
  tabIndex = 0;
  title = '';
  textContent = '';
  type = '';
  focusCalls = 0;
  focus() { this.focusCalls += 1; }
  style: Record<string, string> = {};
  parentElement: FakeElement | null = null;
  readonly children: FakeElement[] = [];
  readonly listeners = new Map<string, Array<(event?: any) => unknown>>();
  private readonly registry: Map<string, FakeElement>;
  private html = '';

  constructor(registry: Map<string, FakeElement>, id = '', tagName = 'div') {
    this.registry = registry;
    this.tagName = tagName.toUpperCase();
    if (id) this.setId(id);
  }

  private setId(id: string) { this.id = id; this.registry.set(id, this); }

  appendChild(child: FakeElement) {
    this.children.push(child);
    child.parentElement = this;
    if (child.id) this.registry.set(child.id, child);
    return child;
  }

  remove() {
    if (this.parentElement) {
      const siblings = this.parentElement.children;
      const index = siblings.indexOf(this);
      if (index >= 0) siblings.splice(index, 1);
      this.parentElement = null;
    }
    if (this.id) this.registry.delete(this.id);
  }

  /** 成员来源层重画时会清空宿主：`host.replaceChildren()`（MA-05 用例用到）。 */
  replaceChildren(...nodes: FakeElement[]) {
    for (const child of this.children.splice(0, this.children.length)) {
      child.parentElement = null;
      if (child.id) this.registry.delete(child.id);
    }
    for (const node of nodes) this.appendChild(node);
  }

  get isConnected() {
    let node: FakeElement | null = this;
    while (node) { if (node.tagName === 'BODY') return true; node = node.parentElement; }
    return false;
  }

  contains(node: FakeElement | null) {
    if (!node) return false;
    if (node === this) return true;
    return this.children.some((child) => child.contains(node));
  }

  closest(selector: string) {
    let node: FakeElement | null = this;
    while (node) { if (matchesSelector(node, selector)) return node; node = node.parentElement; }
    return null;
  }

  setAttribute(name: string, value: string) {
    if (name === 'id') this.setId(value);
    else if (name === 'class') this.className = value;
    else (this as any)[name] = value;
  }

  addEventListener(type: string, handler: (event?: any) => unknown) {
    const list = this.listeners.get(type) || [];
    list.push(handler);
    this.listeners.set(type, list);
  }

  removeEventListener(type: string, handler: (event?: any) => unknown) {
    const list = this.listeners.get(type) || [];
    this.listeners.set(type, list.filter((h) => h !== handler));
  }

  private async emit(type: string, extra: Record<string, unknown> = {}) {
    const event = {
      type,
      target: this,
      currentTarget: this,
      preventDefault() {},
      stopPropagation() {},
      ...extra,
    };
    for (const handler of this.listeners.get(type) || []) await handler(event);
  }

  async dispatch(type: string, extra: Record<string, unknown> = {}) { await this.emit(type, extra); }
  async click() { await this.emit('click'); }
  async hover() { await this.emit('mouseenter'); }
  async unhover() { await this.emit('mouseleave'); }

  getBoundingClientRect() {
    return { top: 100, bottom: 124, left: 300, right: 460, width: 160, height: 24 };
  }

  querySelector(selector: string) { return this.querySelectorAll(selector)[0] || null; }

  querySelectorAll(selector: string) {
    const out: FakeElement[] = [];
    const visit = (el: FakeElement) => {
      if (matchesSelector(el, selector)) out.push(el);
      for (const child of el.children) visit(child);
    };
    for (const child of this.children) visit(child);
    return out;
  }

  set innerHTML(value: string) {
    this.html = value;
    for (const child of this.children) child.parentElement = null;
    this.children.length = 0;
    this.textContent = '';
    // 迷你 HTML 解析（含嵌套与文本）：行内是 <span class="main"><span
    // class="name">文本</span>…</span> 结构，扁平解析会把文本丢掉、把嵌套
    // 层级压平——回显类断言就查不到行名。
    const stack: FakeElement[] = [this];
    const token = /<\/?([a-z0-9-]+)\b([^>]*)>|([^<]+)/gi;
    let match: RegExpExecArray | null;
    while ((match = token.exec(value))) {
      const raw = match[0];
      const text = match[3];
      if (text !== undefined) {
        const node = stack[stack.length - 1];
        const trimmed = text.trim();
        if (trimmed) node.textContent += trimmed;
        continue;
      }
      if (raw.startsWith('</')) {
        if (stack.length > 1) stack.pop();
        continue;
      }
      const attrs = match[2] || '';
      const id = attrs.match(/\bid="([^"]+)"/)?.[1] || '';
      const className = attrs.match(/\bclass="([^"]+)"/)?.[1] || '';
      const child = new FakeElement(this.registry, id, match[1]);
      child.className = className;
      stack[stack.length - 1].appendChild(child);
      if (!/\/>$/.test(raw)) stack.push(child);
    }
  }

  /** 序列化子树：appendChild 出来的行也要能在 innerHTML 断言里看到。 */
  outerHtml(): string {
    const tag = this.tagName.toLowerCase();
    const id = this.id ? ` id="${this.id}"` : '';
    const cls = this.className ? ` class="${this.className}"` : '';
    const inner = this.children.length
      ? this.children.map((child) => child.outerHtml()).join('')
      : this.textContent;
    return `<${tag}${id}${cls}>${inner}</${tag}>`;
  }

  get innerHTML() {
    return this.children.length ? this.children.map((child) => child.outerHtml()).join('') : this.html;
  }
}

function buildHarness(options: { override?: Record<string, unknown>; globalEffort?: string; recipient?: Record<string, unknown> } = {}) {
  let override = options.override || null;
  const registry = new Map<string, FakeElement>();
  const body = new FakeElement(registry, '', 'body');
  body.setAttribute('id', '');

  const entries = [
    { provider: 'cp:cp-1', providerLabel: 'command', providerKind: 'custom', model: 'deepseek/deepseek-v4.1-flash', modelName: 'deepseek/deepseek-v4.1-flash' },
    { provider: 'anthropic', providerLabel: 'Anthropic', providerKind: 'builtin', model: 'claude-sonnet-4-5', modelName: 'Claude Sonnet 4.5' },
  ];
  const modelsByProvider: Record<string, Array<Record<string, unknown>>> = {
    'cp:cp-1': [
      { id: 'deepseek/deepseek-v4.1-flash', name: 'deepseek/deepseek-v4.1-flash', reasoning: true },
      { id: 'deepseek-v4.1-lite', name: 'deepseek-v4.1-lite', reasoning: false },
    ],
    anthropic: [{ id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', reasoning: true }],
  };
  const overrides: Array<Record<string, unknown> | null> = [];
  const invoke = vi.fn(async (channel: string, payload?: any) => {
    if (channel === 'auth.listEntries') return { ok: true, entries };
    if (channel === 'auth.listModels') return { ok: true, models: modelsByProvider[payload?.provider] || [] };
    if (channel === 'customProviders.list') {
      return {
        ok: true,
        providers: [{
          id: 'cp-1',
          models: [{ id: 'deepseek/deepseek-v4.1-flash', reasoningLevels: ['low', 'medium', 'high'] }],
        }],
      };
    }
    if (channel === 'prefs.getThinkingLevel') return { ok: true, level: options.globalEffort || 'auto' };
    return { ok: true };
  });

  const windowObj: any = {
    cogseed: { invoke },
    uiIconHtml: (name: string) => `<i data-icon="${name}"></i>`,
    innerWidth: 1440,
    innerHeight: 900,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
    // 「管理模型」跳转的官方缝（boot.js 暴露的 setView + settings_tabs 的
    // activateSettingsTab），用 spy 断言语义而不是断言实现细节。
    setView: vi.fn(),
    activateSettingsTab: vi.fn(),
  };
  windowObj.window = windowObj;

  const documentListeners = new Map<string, Array<(event?: any) => unknown>>();
  const documentObj: any = {
    body,
    getElementById: (id: string) => registry.get(id) || null,
    createElement: (tag: string) => new FakeElement(registry, '', tag),
    querySelector: (selector: string) => documentObj.querySelectorAll(selector)[0] || null,
    querySelectorAll: (selector: string) => body.querySelectorAll(selector),
    addEventListener(type: string, handler: (event?: any) => unknown) {
      const list = documentListeners.get(type) || [];
      list.push(handler);
      documentListeners.set(type, list);
    },
    removeEventListener(type: string, handler: (event?: any) => unknown) {
      const list = documentListeners.get(type) || [];
      documentListeners.set(type, list.filter((h) => h !== handler));
    },
  };

  const context: any = {
    console,
    createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
    t: (key: string, vars?: Record<string, string>) => (vars ? `${key} ${JSON.stringify(vars)}` : key),
    escapeHtml: (value: unknown) => String(value ?? ''),
    document: documentObj,
    window: windowObj,
    URL,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    getChatRecipient: () => options.recipient || ({ kind: 'commander' }),
    getExecOverride: () => override,
    setExecOverride: (target: string, value: Record<string, unknown> | null) => { override = value; overrides.push(value); },
  };
  vm.createContext(context);
  vm.runInContext(readFileSync(resolve(root, 'src/renderer/modules/model-chip.js'), 'utf8'), context, { filename: 'model-chip.js' });
  return { context, registry, body, invoke, overrides, entries, documentListeners, windowObj };
}

async function openMenu(h: ReturnType<typeof buildHarness>) {
  const anchor = h.context.document.createElement('button');
  anchor.className = 'model-chip exec-config-chip';
  anchor.dataset.modelTarget = 'conversation';
  h.context.document.body.appendChild(anchor);
  h.context.__anchor = anchor;
  vm.runInContext('_modelChipEntries = __entries;', Object.assign(h.context, { __entries: h.entries }));
  await h.context.refreshModelChipEffort();
  await h.context._prefetchReasoningForEntries();
  h.context._toggleExecConfigMenu(anchor);
  return anchor;
}

describe('exec-config chip — provider → model + direct thinking strength', () => {
  it('keeps the card itself showing the invoked model name', async () => {
    const h = buildHarness();
    const anchor = await openMenu(h);
    expect(h.context._effectiveExecConfig('conversation').modelLabel).toBe('deepseek/deepseek-v4.1-flash');
    expect(h.context._effectiveExecConfig('conversation').provider).toBe('cp:cp-1');
    expect(anchor.title).toBe('exec_config.title');
  });

  it('lists providers (not models) at the first level, current one badged', async () => {
    const h = buildHarness();
    await openMenu(h);
    const menu = h.registry.get('model-chip-menu')!;
    const rows = menu.querySelectorAll('.model-chip-menu-item--provider');
    expect(rows.map((row) => row.querySelector('.model-chip-menu-name')!.textContent)).toEqual(['command', 'Anthropic']);
    expect(rows.map((row) => row.dataset.provider)).toEqual(['cp:cp-1', 'anthropic']);
    // 当前 provider 带「当前」徽标；副行保留该 provider 生效中的模型名。
    expect(rows[0].classList.contains('is-default')).toBe(true);
    expect(rows[0].querySelector('.model-chip-menu-sub')!.textContent).toBe('deepseek/deepseek-v4.1-flash');
    expect(menu.innerHTML).toContain('exec_config.section_provider');
    // 一级不再平铺模型行，思考强度也不再挂在一级。
    expect(menu.innerHTML).not.toContain('model-chip-menu-segmented');
  });

  it.each([1440, 760])('at width %s opens only model choices; thinking strength stays in the main menu', async (width) => {
    const h = buildHarness();
    h.windowObj.innerWidth = width;
    await openMenu(h);
    const menu = h.registry.get('model-chip-menu')!;
    expect(menu.querySelectorAll('.model-chip-menu-item').filter((row) => row.dataset.memberEffort)
      .map((row) => row.dataset.memberEffort)).toEqual(['auto', 'off', 'low', 'high']);
    await menu.querySelectorAll('.model-chip-menu-item--provider')[0].hover();
    await afterOpen();
    const models = h.registry.get('model-chip-flyout-models')!;
    const modelRows = models.querySelectorAll('.model-chip-menu-item--provider');
    expect(modelRows.map((row) => row.dataset.model)).toEqual(['deepseek/deepseek-v4.1-flash', 'deepseek-v4.1-lite']);
    expect(models.innerHTML).toContain('exec_config.model_levels_configured');
    await modelRows[0].hover();
    await afterOpen();
    expect(h.registry.get('model-chip-flyout-levels')).toBeUndefined();
  });

  it.each(['commander', 'model'])('distinguishes auto selection from low default for %s and keeps model selection when clearing effort', async (kind) => {
    const h = buildHarness({ globalEffort: 'low', override: { provider: 'cp:cp-1', model: 'deepseek/deepseek-v4.1-flash' },
      recipient: kind === 'model' ? { kind, provider: 'cp:cp-1', model: 'deepseek/deepseek-v4.1-flash' } : { kind } });
    const anchor = await openMenu(h);
    const effort = h.context.document.createElement('span');
    effort.className = 'exec-config-effort';
    anchor.appendChild(effort);
    const selected = () => h.registry.get('model-chip-menu')!.querySelectorAll('.model-chip-menu-item')
      .filter((row) => row.dataset.memberEffort && row.classList.contains('is-default')).map((row) => row.dataset.memberEffort);
    expect(h.context._effectiveExecConfig('conversation').effort).toBe('low');
    h.context._modelChipRenderChip(anchor);
    expect(effort.textContent).toBe('model_effort.auto');
    expect(selected()).toEqual(['auto']);
    expect(h.registry.get('model-chip-menu')!.innerHTML).toContain('model_effort.auto_follows_default');
    expect(h.registry.get('model-chip-menu')!.innerHTML).toContain('model_effort.default_effective');
    const pick = async (level: string) => {
      await h.registry.get('model-chip-menu')!.querySelectorAll('.model-chip-menu-item').find((row) => row.dataset.memberEffort === level)!.click();
      h.context._modelChipRenderChip(anchor);
    };
    await pick('low');
    expect(effort.textContent).toBe('model_effort.low');
    expect(effort.classList.contains('is-override')).toBe(true);
    expect(selected()).toEqual(['low']);
    await pick('high');
    expect(h.overrides.at(-1)).toMatchObject({ effort: 'high' });
    expect(effort.textContent).toBe('model_effort.high');
    expect(selected()).toEqual(['high']);
    await pick('auto');
    expect(h.overrides.at(-1)).toEqual({ provider: 'cp:cp-1', model: 'deepseek/deepseek-v4.1-flash' });
    expect(effort.textContent).toBe('model_effort.auto');
    expect(selected()).toEqual(['auto']);
    expect(h.context._effectiveExecConfig('conversation').effort).toBe('low');
    h.context._toggleExecConfigMenu(anchor);
    h.context._toggleExecConfigMenu(anchor);
    expect(selected()).toEqual(['auto']);
    await h.registry.get('model-chip-menu')!.querySelectorAll('.model-chip-menu-item')
      .find((row) => row.dataset.memberEffort === 'high')!.dispatch('keydown', { key: 'Enter' });
    expect(selected()).toEqual(['high']);
    expect(h.registry.get('model-chip-menu')!.querySelectorAll('.model-chip-menu-item')
      .find((row) => row.dataset.memberEffort === 'high')!.focusCalls).toBe(1);
    for (const handler of h.documentListeners.get('keydown') || []) await handler({ key: 'Escape', preventDefault() {} });
    expect(h.registry.get('model-chip-menu')).toBeUndefined();
    expect(h.registry.get('model-chip-flyout-models')).toBeUndefined();
    expect(anchor.focusCalls).toBe(1);
  });

  it('disables unsupported thinking levels after changing to a non-reasoning model', async () => {
    const h = buildHarness();
    const anchor = await openMenu(h);
    await h.registry.get('model-chip-menu')!.querySelectorAll('.model-chip-menu-item--provider')[0].click();
    await afterOpen();
    await h.registry.get('model-chip-flyout-models')!.querySelectorAll('.model-chip-menu-item--provider')[1].click();
    h.context._toggleExecConfigMenu(anchor);
    const menu = h.registry.get('model-chip-menu')!;
    const disabled = menu.querySelectorAll('.model-chip-menu-item.is-disabled');
    expect(disabled.map((row) => row.dataset.memberEffort)).toEqual(['low', 'high']);
    await disabled[1].click();
    expect(h.overrides.at(-1)).not.toHaveProperty('effort');
    expect(menu.innerHTML).toContain('model_effort.unsupported_hint');
  });

  it('switches the level-2 list instead of stacking flyouts when the pointer moves across providers', async () => {
    const h = buildHarness();
    await openMenu(h);
    const menu = h.registry.get('model-chip-menu')!;
    const providerRows = menu.querySelectorAll('.model-chip-menu-item--provider');
    await providerRows[0].hover();
    await afterOpen();
    await providerRows[1].hover();
    await afterOpen();
    const flyouts = h.body.querySelectorAll('.model-chip-flyout');
    expect(flyouts.filter((el) => el.dataset.flyout === 'models')).toHaveLength(1);
    expect(h.registry.get('model-chip-flyout-models')!.querySelector('.model-chip-menu-name')!.textContent)
      .not.toBe('deepseek/deepseek-v4.1-flash');
    // 换 provider 时上一级的模型飞出层必须已经被替换（没有第三级残留）。
    expect(h.registry.get('model-chip-flyout-levels')).toBeUndefined();
  });

  it('collapses the flyouts when the pointer leaves, and keeps the menu open', async () => {
    const h = buildHarness();
    await openMenu(h);
    const menu = h.registry.get('model-chip-menu')!;
    const providerRow = menu.querySelectorAll('.model-chip-menu-item--provider')[0];
    await providerRow.hover();
    await afterOpen();
    const modelRow = h.registry.get('model-chip-flyout-models')!.querySelectorAll('.model-chip-menu-item--provider')[0];
    expect(h.registry.get('model-chip-flyout-levels')).toBeUndefined();

    await h.registry.get('model-chip-flyout-models')!.unhover();
    await afterClose();
    expect(h.registry.get('model-chip-flyout-levels')).toBeUndefined();
    expect(h.registry.get('model-chip-flyout-models')).toBeUndefined();
    // 一级菜单仍在——收起的是级联，不是整个入口。
    expect(h.registry.get('model-chip-menu')).toBeTruthy();
  });

  it('puts a 「管理模型」entry under the provider list and jumps to Settings → Configuration', async () => {
    const h = buildHarness();
    await openMenu(h);
    const menu = h.registry.get('model-chip-menu')!;
    // 位置：provider 列表之后（隔一条分隔线），与列表项同款行样式。
    const orderedChildren = menu.children.filter((child) => child.className.includes('model-chip-menu-item') || child.className.includes('model-chip-menu-divider'));
    const last = orderedChildren[orderedChildren.length - 1];
    expect(last.dataset.action).toBe('manage-models');
    expect(orderedChildren[orderedChildren.length - 2].classList.contains('model-chip-menu-divider')).toBe(true);
    expect(last.querySelector('.model-chip-menu-name')!.textContent).toBe('exec_config.manage_models');
    expect(last.classList.contains('model-chip-menu-item--action')).toBe(true);

    await last.click();
    // 跳转走官方缝：先切视图（带 configuration tab + models 锚点），再切 tab。
    expect(h.windowObj.setView).toHaveBeenCalledWith('settings', undefined, {
      settingsTab: 'configuration',
      settingsAnchor: 'models',
    });
    expect(h.windowObj.activateSettingsTab).toHaveBeenCalledWith('configuration', { anchor: 'models' });
    // 跳转前整层收起，不把菜单/飞出层留在新页面上。
    expect(h.registry.get('model-chip-menu')).toBeUndefined();
    expect(h.registry.get('model-chip-flyout-models')).toBeUndefined();
  });

  it('pins the flyout on click and collapses flyouts before the menu on Escape', async () => {
    const h = buildHarness();
    await openMenu(h);
    const menu = h.registry.get('model-chip-menu')!;
    const providerRow = menu.querySelectorAll('.model-chip-menu-item--provider')[0];
    // 触屏/键盘路径：点击即可打开二级（不依赖 hover），并钉住。
    await providerRow.click();
    await afterOpen();
    expect(h.registry.get('model-chip-flyout-models')).toBeTruthy();
    await afterClose();
    expect(h.registry.get('model-chip-flyout-models')).toBeTruthy();

    const pressEscape = async () => {
      for (const handler of h.documentListeners.get('keydown') || []) {
        await handler({ key: 'Escape', preventDefault() {} });
      }
    };
    // 级联两层：Escape 先收飞出层（菜单还在），再按一次才收菜单。
    await pressEscape();
    expect(h.registry.get('model-chip-flyout-models')).toBeUndefined();
    expect(h.registry.get('model-chip-menu')).toBeTruthy();
    await pressEscape();
    expect(h.registry.get('model-chip-menu')).toBeUndefined();
  });

  it('keeps the flyout alive while the pointer travels into it', async () => {
    const h = buildHarness();
    await openMenu(h);
    const menu = h.registry.get('model-chip-menu')!;
    const providerRow = menu.querySelectorAll('.model-chip-menu-item--provider')[0];
    await providerRow.hover();
    await afterOpen();
    const models = h.registry.get('model-chip-flyout-models')!;
    const modelRow = models.querySelectorAll('.model-chip-menu-item--provider')[0];
    await modelRow.hover();
    await afterOpen();
    // 指针从模型行移向三级飞出层：先离开行、再进入层（真实事件的顺序）。
    await modelRow.unhover();
    await models.dispatch('mouseenter');
    await afterClose();
    expect(h.registry.get('model-chip-flyout-models')).toBeTruthy();
    expect(h.registry.get('model-chip-flyout-levels')).toBeUndefined();
  });
});

// MA-05（验收报告 P2）：外接来源支持模型下发时，菜单里同样要有竖排思考强度。
//
// 真机现象：选 CogSeed、Codex、WorkBuddy 后打开模型配置再进入 Codex，可见模型
// 列表 / 手输模型 / 重新扫描，但**没有**竖排思考强度——`_renderMemberSourceBody`
// 在「支持模型控制 + 走标准 CLI 模型列表」的分支里提前 return，绕过了尾部的
// `_renderMemberEffortRows`（内部来源与无模型通道来源都还有强度行）。
describe('member source menu effort rows (MA-05)', () => {
  it('renders thinking-strength rows for an external CLI source with model control', async () => {
    const h = buildHarness();
    h.windowObj.cliExecControl = {
      cachedCliModels: () => ({ models: [{ id: 'gpt-6-astra', name: 'gpt-6-astra' }] }),
      mergedCliModels: (_cli: string, scan: any) => (scan && scan.models) || [],
      modelControllableFor: () => true,
      effortControllableFor: () => true,
      loadCliModels: async () => ({ models: [{ id: 'gpt-6-astra', name: 'gpt-6-astra' }] }),
      scanInFlight: () => false,
      execControlFor: () => ({ effortOff: true }),
    };
    h.context._agentsCache = [
      { agent_id: 'agent-codex', name: 'Codex', runtime: { kind: 'cli', cli: 'codex' } },
    ];

    // 来源配置读写来自 composer-members（真实页面里由该模块持有）。
    let sourceConfig: Record<string, string> = {};
    h.windowObj.composerMembers = {
      getSourceConfig: () => sourceConfig,
      setSourceConfig: (_target: string, _source: string, patch: Record<string, string>) => { sourceConfig = { ...sourceConfig, ...patch }; },
      isMember: () => true,
    };

    const container = h.context.document.createElement('div');
    h.context.document.body.appendChild(container);
    vm.runInContext(
      '_renderMemberSourceBody(__container, "conversation", { id: "agent-codex", external: true }, {})',
      Object.assign(h.context, { __container: container }),
    );
    // _renderCliModelList 先画 loading 再 await 模型清单；等它填充完成。
    await sleep(50);

    const effortRows: FakeElement[] = [];
    const walk = (el: FakeElement) => {
      for (const child of el.children) {
        if (child.dataset.memberEffort) effortRows.push(child);
        walk(child);
      }
    };
    walk(container);
    expect(effortRows.map((row) => row.dataset.memberEffort)).toEqual(['auto', 'off', 'low', 'high']);
    expect(effortRows[0].innerHTML).toContain('model_effort.auto_follows_default');
    await effortRows[3].click();
    await sleep(50);
    expect(sourceConfig.effort).toBe('high');
    let currentRows = container.querySelectorAll('.model-chip-menu-item').filter((row) => row.dataset.memberEffort);
    expect(currentRows.filter((row) => row.classList.contains('is-default')).map((row) => row.dataset.memberEffort)).toEqual(['high']);
    await currentRows[0].click();
    await sleep(50);
    expect(sourceConfig.effort).toBe('');
    currentRows = container.querySelectorAll('.model-chip-menu-item').filter((row) => row.dataset.memberEffort);
    expect(currentRows.filter((row) => row.classList.contains('is-default')).map((row) => row.dataset.memberEffort)).toEqual(['auto']);
  });
});
