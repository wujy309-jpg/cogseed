import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const source = readFileSync(
  resolve(__dirname, '../../src/renderer/modules/cognition/cognition.js'),
  'utf8',
);

// 沉淀弹窗（openCognitionCapture）执行级测试：装载 cognition.js 到 vm 沙箱，
// 用假 DOM 驱动真实交互路径——草稿生成、表单校验、保存走主链
// recall.candidates.save、防抖与成功后的关闭 + 提示。

type EventHandler = (event?: unknown) => void;

interface CaptureValues {
  title: string;
  summary: string;
  value: string;
  sourceLabel: string;
  suggestedType: string;
  suggestedScope: string;
  applicableWhen: string[];
  forbiddenWhen: string[];
  risk: string;
  uncertainty: string;
  error: string;
}

interface FormSpec {
  __formSpec: true;
  state: 'loading' | 'ready' | 'error';
  values: CaptureValues;
}

interface ModalOptions {
  onClose?: (reason: string) => void;
}

class FakeElement {
  tagName: string;
  className = '';
  id = '';
  dataset: Record<string, string> = {};
  value = '';
  disabled = false;
  textContent = '';
  _uiSelectApi?: { getValue(): string };
  parent: FakeElement | null = null;
  children: FakeElement[] = [];
  private handlers = new Map<string, Set<EventHandler>>();
  private markup: unknown = '';

  constructor(tagName: string) {
    this.tagName = tagName;
  }

  get innerHTML(): unknown {
    return this.markup;
  }

  // renderMarkup 把 renderCognitionCapture 的产物整体写入 innerHTML；
  // 真实浏览器里字符串会重建子树，这里用 spec 对象承载同样的重建语义。
  set innerHTML(next: unknown) {
    this.markup = next;
    if (next && typeof next === 'object' && (next as FormSpec).__formSpec) {
      this.rebuild(next as FormSpec);
    }
  }

  get isConnected(): boolean {
    let node: FakeElement | null = this;
    while (node) {
      if (node.tagName === '#document-body') return true;
      node = node.parent;
    }
    return false;
  }

  private matches(selector: string): boolean {
    if (selector.startsWith('#')) return this.id === selector.slice(1);
    if (selector.startsWith('.')) return this.className.split(/\s+/).includes(selector.slice(1));
    if (selector.startsWith('[') && selector.endsWith(']')) {
      const key = selector
        .slice(1, -1)
        .replace(/^data-/, '')
        .replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase());
      return this.dataset[key] !== undefined;
    }
    return false;
  }

  querySelector(selector: string): FakeElement | null {
    for (const child of this.children) {
      if (child.matches(selector)) return child;
      const hit = child.querySelector(selector);
      if (hit) return hit;
    }
    return null;
  }

  querySelectorAll(selector: string): FakeElement[] {
    const hits: FakeElement[] = [];
    const walk = (node: FakeElement) => {
      for (const child of node.children) {
        if (child.matches(selector)) hits.push(child);
        walk(child);
      }
    };
    walk(this);
    return hits;
  }

  addEventListener(event: string, handler: EventHandler) {
    const existing = this.handlers.get(event) || new Set<EventHandler>();
    existing.add(handler);
    this.handlers.set(event, existing);
  }

  requestSubmit() {
    for (const handler of this.handlers.get('submit') || []) {
      handler({ preventDefault: () => {} });
    }
  }

  focus() { /* 记录焦点不是本测试关注点 */ }

  appendChild(child: FakeElement) {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  remove() {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter((child) => child !== this);
    this.parent = null;
  }

  private rebuild(spec: FormSpec) {
    for (const child of this.children) child.parent = null;
    this.children = [];
    const values = spec.values;
    const form = new FakeElement('form');
    form.dataset.cognitionCaptureForm = 'true';
    this.appendChild(form);
    const cancel = new FakeElement('button');
    cancel.dataset.cognitionCaptureCancel = 'true';
    form.appendChild(cancel);
    if (spec.state !== 'ready') {
      if (spec.state === 'error') {
        const status = new FakeElement('p');
        status.textContent = values.error;
        form.appendChild(status);
      }
      return;
    }
    const body = new FakeElement('div');
    body.className = 'cognition-capture-body';
    form.appendChild(body);
    const addControl = (tagName: string, key: string, value: string, id = '') => {
      const node = new FakeElement(tagName);
      node.dataset[key] = 'true';
      node.value = value;
      node.id = id;
      body.appendChild(node);
      return node;
    };
    addControl('input', 'cognitionCaptureTitle', values.title, 'cognition-capture-title');
    addControl('textarea', 'cognitionCaptureSummary', values.summary);
    addControl('textarea', 'cognitionCaptureValue', values.value);
    addControl('div', 'cognitionCaptureScope', '', 'cognition-capture-scope');
    addControl('textarea', 'cognitionCaptureApplicable', values.applicableWhen.join('\n'));
    addControl('textarea', 'cognitionCaptureForbidden', values.forbiddenWhen.join('\n'));
    addControl('textarea', 'cognitionCaptureUncertainty', values.uncertainty);
    addControl('input', 'cognitionCaptureSource', values.sourceLabel);
    addControl('select', 'cognitionCaptureType', values.suggestedType);
    const submit = new FakeElement('button');
    submit.dataset.cognitionCaptureSubmit = 'true';
    form.appendChild(submit);
  }
}

function makeDraft(overrides: Record<string, unknown> = {}) {
  return {
    summary: '草稿标题',
    judgment: '草稿判断',
    value: '草稿价值',
    sourceLabel: '当前会话',
    suggestedType: 'personal',
    suggestedScope: 'code',
    applicableWhen: ['适用场景一'],
    forbiddenWhen: ['禁用场景一'],
    risk: 'medium',
    uncertainty: '暂无',
    sourceRefs: ['conv:c1'],
    evidenceRefs: ['msg:m1'],
    ...overrides,
  };
}

function loadHarness() {
  const body = new FakeElement('#document-body');
  const closeReasons: string[] = [];
  const hydrateCalls: FakeElement[] = [];
  const renderCalls: Array<Record<string, unknown>> = [];
  // scope 值由 hydrate 灌入（真实语义：草稿 suggestedScope 初始化 select），
  // 测试可通过 setScopeValue 模拟用户改选。
  let scopeValue = '';
  let scopeTouched = false;
  const toast = vi.fn();
  const draftHolder: { result: unknown } = {
    result: { ok: true, status: 'ready', draft: makeDraft() },
  };
  const saveHolder: { result: unknown } = { result: { ok: true } };
  const invoke = vi.fn(async (channel: string, _payload?: unknown) => {
    if (channel === 'cognition.capture.draft') return draftHolder.result;
    if (channel === 'recall.candidates.save') {
      return typeof saveHolder.result === 'function'
        ? await (saveHolder.result as () => unknown)()
        : saveHolder.result;
    }
    throw new Error(`unexpected channel: ${channel}`);
  });
  const apiFetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({ page: { items: [], page: 1, pageSize: 50, total: 0, totalPages: 0 } }),
  }));
  const windowObject: Record<string, unknown> = {
    apiFetch,
    cogseed: { invoke },
    CognitionPages: {
      renderCognitionCapture(options: Record<string, unknown>) {
        renderCalls.push(options);
        const state = options.state === 'loading' || options.state === 'error'
          ? (options.state as 'loading' | 'error')
          : 'ready';
        const spec: FormSpec = {
          __formSpec: true,
          state,
          values: {
            title: String(options.title || ''),
            summary: String(options.summary || ''),
            value: String(options.value || ''),
            sourceLabel: String(options.sourceLabel || ''),
            suggestedType: String(options.suggestedType || ''),
            suggestedScope: String(options.suggestedScope || ''),
            applicableWhen: Array.isArray(options.applicableWhen) ? options.applicableWhen : [],
            forbiddenWhen: Array.isArray(options.forbiddenWhen) ? options.forbiddenWhen : [],
            risk: String(options.risk || 'low'),
            uncertainty: String(options.uncertainty || ''),
            error: String(options.error || ''),
          },
        };
        return spec;
      },
    },
    uiModalController: (options: ModalOptions) => {
      let open = false;
      return {
        isOpen: () => open,
        open: () => { open = true; },
        close: (reason: string) => {
          open = false;
          closeReasons.push(reason);
          options.onClose?.(reason);
        },
      };
    },
    hydrateUiFormSelects: (dialog: FakeElement) => {
      hydrateCalls.push(dialog);
      const scope = dialog.querySelector('#cognition-capture-scope');
      if (scope) {
        if (!scopeTouched) scopeValue = String(renderCalls.at(-1)?.suggestedScope || '');
        scope._uiSelectApi = { getValue: () => scopeValue };
      }
    },
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
      querySelector: (selector: string) => body.querySelector(selector),
    },
    t: (key: string) => key,
    uiToast: toast,
    encodeURIComponent,
    Map,
    Set,
    Array,
    Number,
    Math,
    Error,
    String,
    Promise,
    JSON,
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'cognition.js' });
  const form = () => {
    const node = body.querySelector('[data-cognition-capture-form]');
    if (!node) throw new Error('capture form is not rendered');
    return node;
  };
  return {
    invoke,
    apiFetch,
    toast,
    renderCalls,
    closeReasons,
    hydrateCalls,
    draftHolder,
    saveHolder,
    open: (input: Record<string, unknown>) =>
      (windowObject.openCognitionCapture as (input: Record<string, unknown>) => boolean)(input),
    overlay: () => body.querySelector('[data-cognition-capture-overlay]'),
    form,
    submitForm: () => form().requestSubmit(),
    setScopeValue: (value: string) => { scopeTouched = true; scopeValue = value; },
    setControlValue: (selector: string, value: string) => {
      const node = form().querySelector(selector);
      if (!node) throw new Error(`missing capture control: ${selector}`);
      node.value = value;
    },
    errorText: () => form().querySelector('[data-cognition-capture-error]')?.textContent || '',
    saveCalls: () => invoke.mock.calls.filter(([channel]) => channel === 'recall.candidates.save'),
  };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise<void>((resolve) => setImmediate(resolve));
}

describe('cognition capture dialog', () => {
  it('rejects a submission without scope, keeps the dialog open and the button enabled', async () => {
    const harness = loadHarness();
    expect(harness.open({ conversationId: 'c1', messageId: 'm1' })).toBe(true);
    await flush();
    expect(harness.renderCalls.at(-1)?.state).toBe('ready');

    harness.setScopeValue('');
    harness.submitForm();
    await flush();

    expect(harness.errorText()).toContain('先填写作用范围');
    expect(harness.saveCalls()).toHaveLength(0);
    expect(harness.form().querySelector('[data-cognition-capture-submit]')?.disabled).toBe(false);
    expect(harness.overlay()).not.toBeNull();
  });

  it('requires both rule boundaries before a rule-type draft can be saved', async () => {
    const harness = loadHarness();
    harness.draftHolder.result = {
      ok: true,
      status: 'ready',
      draft: makeDraft({ suggestedType: 'rule', applicableWhen: [], forbiddenWhen: [] }),
    };
    expect(harness.open({ conversationId: 'c1', messageId: 'm1' })).toBe(true);
    await flush();

    harness.submitForm();
    await flush();
    expect(harness.errorText()).toContain('规则要先确认适用与禁止范围');

    harness.setControlValue('[data-cognition-capture-applicable]', '适用场景一');
    harness.submitForm();
    await flush();
    expect(harness.errorText()).toContain('规则要先确认适用与禁止范围');
    expect(harness.saveCalls()).toHaveLength(0);
  });

  it('blocks saving when the draft has no traceable sources', async () => {
    const harness = loadHarness();
    harness.draftHolder.result = {
      ok: true,
      status: 'ready',
      draft: makeDraft({ evidenceRefs: [] }),
    };
    expect(harness.open({ conversationId: 'c1', messageId: 'm1' })).toBe(true);
    await flush();

    harness.submitForm();
    await flush();

    expect(harness.errorText()).toContain('缺少可追溯的来源');
    expect(harness.saveCalls()).toHaveLength(0);
    expect(harness.overlay()).not.toBeNull();
  });

  it('ignores repeat submissions while the save request is in flight', async () => {
    const harness = loadHarness();
    expect(harness.open({ conversationId: 'c1', messageId: 'm1' })).toBe(true);
    await flush();
    let finishSave!: (value: { ok: boolean }) => void;
    harness.saveHolder.result = () => new Promise((done) => { finishSave = done; });

    harness.submitForm();
    await flush();
    expect(harness.saveCalls()).toHaveLength(1);
    expect(harness.form().querySelector('[data-cognition-capture-submit]')?.disabled).toBe(true);

    harness.submitForm();
    harness.submitForm();
    await flush();
    expect(harness.saveCalls()).toHaveLength(1);

    finishSave({ ok: true });
    await flush();
    expect(harness.saveCalls()).toHaveLength(1);
    expect(harness.toast).toHaveBeenCalledTimes(1);
  });

  it('maps capture draft failure codes to localized text instead of raw English (P-r1-6/P-r3-26)', async () => {
    const harness = loadHarness();
    harness.draftHolder.result = {
      ok: false,
      code: 'anchor_not_found',
      error: 'selected assistant reply was not found',
    };
    expect(harness.open({ conversationId: 'c1', messageId: 'm1' })).toBe(true);
    await flush();

    expect(harness.renderCalls.at(-1)?.state).toBe('error');
    const errorText = String(harness.renderCalls.at(-1)?.error);
    expect(errorText).toContain('选中的回复不可用');
    expect(errorText).not.toContain('selected assistant reply');
  });

  it('keeps surfacing the raw error for unknown capture failure codes', async () => {
    const harness = loadHarness();
    harness.draftHolder.result = { ok: false, code: 'not_a_known_code', error: 'internal failure detail' };
    expect(harness.open({ conversationId: 'c1', messageId: 'm1' })).toBe(true);
    await flush();

    expect(harness.renderCalls.at(-1)?.state).toBe('error');
    expect(String(harness.renderCalls.at(-1)?.error)).toContain('internal failure detail');
  });

  it('saves through the recall candidate channel, closes the dialog and toasts success', async () => {
    const harness = loadHarness();
    expect(harness.open({ conversationId: 'c1', messageId: 'm1' })).toBe(true);
    await flush();

    harness.submitForm();
    await flush();

    const saveCalls = harness.saveCalls();
    expect(saveCalls).toHaveLength(1);
    expect(saveCalls[0][1]).toEqual({
      judgment: '草稿判断',
      value: '草稿价值',
      summary: '草稿标题',
      suggestedType: 'personal',
      suggestedScope: 'code',
      suggestedAction: 'create',
      risk: 'medium',
      uncertainty: '暂无',
      applicableWhen: ['适用场景一'],
      forbiddenWhen: ['禁用场景一'],
      sourceRefs: ['conv:c1'],
      evidenceRefs: ['msg:m1'],
    });
    expect(harness.closeReasons).toContain('action');
    expect(harness.overlay()).toBeNull();
    expect(harness.toast).toHaveBeenCalledTimes(1);
    expect(String(harness.toast.mock.calls[0][0])).toContain('已存为待确认候选');
    expect(harness.toast.mock.calls[0][1]).toEqual({ variant: 'success' });
    // P-r1-49：保存成功后不再触发旧认知成长页死刷新链（原先 reload 打到
    // /api/cognition/assets/page 必 404 白跑两条）——capture 全程零 REST。
    expect(harness.apiFetch).not.toHaveBeenCalled();
  });
});
