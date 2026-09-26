import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import vm from 'node:vm';

const root = resolve(__dirname, '../..');
const routeSource = readFileSync(resolve(root, 'src/renderer/modules/ipc-shim.js'), 'utf8');
const html = readFileSync(resolve(root, 'src/renderer/index.html'), 'utf8');
const boot = readFileSync(resolve(root, 'src/renderer/modules/boot.js'), 'utf8');
const state = readFileSync(resolve(root, 'src/renderer/modules/state.js'), 'utf8');
const lazy = readFileSync(resolve(root, 'src/renderer/modules/lazy-features.js'), 'utf8');
const ontology = readFileSync(resolve(root, 'src/renderer/modules/personal-ontology.js'), 'utf8');
const skills = readFileSync(resolve(root, 'src/renderer/modules/skills.js'), 'utf8');
// 2026-09-14 认知资产前端重建：本体入口与深链兼容迁至 cognition-assets/*。
const cognitionCore = readFileSync(resolve(root, 'src/renderer/modules/cognition-assets/core.js'), 'utf8');
const cognitionViews = readFileSync(resolve(root, 'src/renderer/modules/cognition-assets/views.js'), 'utf8');

function loadPersonalOntology(invoke: any, overrides: Record<string, unknown> = {}) {
  const element = () => ({
    innerHTML: '',
    style: {},
    querySelector: () => null,
    querySelectorAll: () => [],
    listeners: new Map<string, (...args: any[]) => any>(),
    addEventListener(event: string, handler: (...args: any[]) => any) {
      this.listeners.set(event, handler);
    },
    classList: {
      _set: new Set<string>(),
      add(cls: string) { this._set.add(cls); },
      remove(cls: string) { this._set.delete(cls); },
      contains(cls: string) { return this._set.has(cls); },
    },
  });
  const elements = new Map([
    ['personal-onto-nav', element()],
    ['personal-onto-main-header', element()],
    ['personal-onto-main-body', element()],
    // US-102 历史弹层：_pocShowGroupHistory 经这两个节点渲染（只加不删，
    // 既有用例不触达该路径，零影响）。
    ['personal-onto-modal', element()],
    ['personal-onto-modal-body', element()],
  ]);
  const uiToast = vi.fn();
  const sandbox: any = {
    console: { log() {}, warn() {}, error() {} },
    document: {
      getElementById: (id: string) => elements.get(id) || null,
      querySelector: (sel: string) => (sel === '.personal-onto-modal-body'
        ? elements.get('personal-onto-modal-body') || null
        : null),
    },
    t: (key: string) => key === 'personalOntology.profile_sync_warning'
      ? 'profile sync warning'
      : key,
    uiToast,
    cogseed: { invoke },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  // 编辑动作依赖 uiPrompt / uiAlert（沙箱默认不装）：按用例注入。
  Object.assign(sandbox, overrides);
  vm.createContext(sandbox);
  // T040/T041 收敛后 _tag/_statusPill/_statusDot 与 _button 同口径强依赖共享原语
  // （缺则抛错）：沙箱补载真实 ui-status.js（index.html 全局加载的同一份），不再降级。
  for (const file of ['modules/icons.js', 'modules/ui-button.js', 'modules/ui-form.js', 'modules/ui-empty.js', 'modules/ui-status.js']) {
    vm.runInContext(readFileSync(resolve(root, 'src/renderer', file), 'utf8'), sandbox, { filename: file });
  }
  vm.runInContext(ontology, sandbox, { filename: 'personal-ontology.js' });
  return { sandbox, uiToast, elements };
}

async function settleBackgroundWork() {
  // Profile + template loading uses a Promise.all followed by an unawaited
  // group read. Flush a few microtask turns so assertions observe the same
  // settled DOM without making the loading-state test wait for its resolver.
  for (let i = 0; i < 4; i += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 10));
}

function loadShim(invoke: any) {
  const sandbox: any = {
    console, URL, URLSearchParams, ArrayBuffer, Uint8Array, TextEncoder, ReadableStream, btoa,
    fetch: vi.fn(), createLogger: () => ({ warn() {}, info() {}, error() {} }),
    window: { cogseed: { invoke, stream: () => ({ promise: Promise.resolve(), cancel() {} }) } },
  };
  sandbox.window.window = sandbox.window;
  vm.createContext(sandbox);
  vm.runInContext(routeSource, sandbox, { filename: 'ipc-shim.js' });
  return sandbox.apiFetch;
}

describe('personal ontology renderer integration', () => {
  it('preserves the formal Recall asset route while removing the legacy candidate UI', async () => {
    // 遗留 CognitionAsset store 的 REST 入口已全部删除；正式资产读口在 ipc/index.ts。
    expect(routeSource).not.toContain("'cognition.assets.list'");
    expect(routeSource).not.toContain("'cognition.assets.create'");
    expect(routeSource).not.toContain("'cognition.assets.capture'");
    const invoke = vi.fn(async () => ({ ok: true, assets: [] }));
    const response = await loadShim(invoke)('/api/cognition/assets');
    await expect(response.json()).resolves.toMatchObject({ ok: false });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('contains the embedded panel inside My assets, rejection modal, and lazy view wiring', () => {
    for (const id of [
      'panel-personal-ontology', 'personal-onto-sidebar',
      'personal-onto-nav', 'personal-onto-main-header', 'personal-onto-main-body',
      'personal-onto-template-library-modal', 'personal-onto-template-library-list',
    ]) expect(html).toContain(`id="${id}"`);
    // 「关于我」并入「我的资产」：不再有独立 tab，个人本体在 personal 分类下展开。
    expect(html).not.toContain('skills-cognition-tab-about-me');
    const paneStart = html.indexOf('id="skills-cognition-personal-ontology"');
    expect(paneStart).toBeGreaterThan(0);
    const paneHtml = html.slice(paneStart, html.indexOf('</main>', paneStart));
    expect(paneHtml).toContain('id="panel-personal-ontology"');
    // 技能库已移出到连接页，personal-ontology 深链在 boot 顶部归一化为 recall
    //（永假分支已删，2026-09-14 终审清理）；展开由 core.js 的深链分支接管。
    expect(boot).toContain("const openPersonalOntology = view === 'personal-ontology'");
    // 2026-09-14 认知资产前端重建：本体入口 = views.js overview 常驻行
    //（data-act="open-ontology"）+ core.js 的 NS.openPersonalOntology
    //（un-hide #skills-cognition-personal-ontology 后调 window.renderPersonalOntology）；
    // 旧 switchSkillsCognitionPage('assets') 跳页入口已随重建移除。
    expect(cognitionViews).toContain('data-act="open-ontology"');
    expect(cognitionCore).toContain('skills-cognition-personal-ontology');
    expect(cognitionCore).toContain('renderPersonalOntology');
    expect(boot).toContain("_loadViewFeature('recall', 'recall'");
    // The sidebar button is gone; personal ontology is reached from Recall's
    // "关于我" tab instead of a fixed primary entry.
    expect(state).not.toContain("document.getElementById('personal-ontology-btn')");
    expect(lazy).toContain("'personal-ontology'");
    expect(lazy).toContain("./modules/personal-ontology.js");
  });

  it('keeps the profile projection read-only and role-template editing on existing channels', () => {
    // 2026-09-19 记忆退役：画像源 = 资产库 personal 资产（recall.assets.list），
    // 旧的 USER.md 投影桥（profile.syncRecall）整体退役。
    expect(ontology).toContain("_pocInvoke('recall.assets.list', {})");
    expect(ontology).not.toContain("personalOntology.profile.syncRecall");
    expect(ontology).toContain("_pocInvoke('personalOntology.templates.list'");
    expect(ontology).toContain("_pocInvoke('personalOntology.templates.install'");
    expect(ontology).toContain("_pocInvoke('personalOntology.groups.read'");
    expect(ontology).toContain("_pocGroupAction('personalOntology.groups.write'");
    expect(ontology).toContain("_pocGroupAction('personalOntology.groups.fields.append'");
    // 2026-09-20 本体分组迁入 + 回流确认首次暴露：groups.create（建组）与
    // personalOntology.candidates.*（本体候选池确认端）成为本页正式通道。
    // 旧约束（候选 UI 不得回本体页）随分组功能落地而过时——那条约束防的是
    // 旧的 recall 候选审核 UI 复活，不是防回流确认。
    expect(ontology).toContain("_pocInvoke('personalOntology.groups.create'");
    expect(ontology).toContain("_pocInvoke('personalOntology.candidates.confirm'");
    expect(ontology).toContain("_pocInvoke('personalOntology.conflicts.list'");
    expect(ontology).not.toContain("_pocInvoke('memory.add'");
    expect(ontology).not.toContain("_pocInvoke('memory.replace'");
    expect(ontology).not.toContain('renderDestinationPanel');
    expect(ontology).not.toContain('showRejectReasonModal');
  });

  it('shows the profile empty state and role-template library when no template is installed', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'personalOntology.templates.list') return { ok: true, templates: [] };
      if (channel === 'recall.assets.list') return { ok: true, assets: [] };
      return { ok: true };
    });
    const { sandbox, elements } = loadPersonalOntology(invoke);

    await sandbox.window.renderPersonalOntology();
    await settleBackgroundWork();

    const nav4 = elements.get('personal-onto-nav')?.innerHTML || '';
    expect(nav4).toContain('统一词表');
    expect(nav4).toContain('我是谁');
    expect(nav4).toContain('我偏好什么');
    expect(nav4).toContain('导出记忆');
    // 默认落在 A 盒（事实），画像空态在盒内呈现
    expect(elements.get('personal-onto-main-body')?.innerHTML).toContain('完成会话沉淀后');
    expect(nav4).not.toContain('候选');
    expect(nav4).not.toContain('记忆分组');
  });

  it('renders one-line subtitles on the three box nav rows without moving badges or clicks', async () => {
    // US-103：三盒导航行带副标题（竖排文字位），角标仍是文字位之后的同层
    // flex 子项（DOM 顺序不变），点击行为走既有 _pocBindNav 分支（口径同
    // 「点 rbox 行 → 主区切到规则盒」的既有用例）。
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'personalOntology.templates.list') return { ok: true, templates: [] };
      if (channel === 'recall.assets.list') return { ok: true, assets: [] };
      if (channel === 'personalOntology.groups.list') return { ok: true, groups: [] };
      if (channel === 'personalOntology.candidates.list') return { ok: true, candidates: [] };
      return { ok: true };
    });
    const { sandbox, elements } = loadPersonalOntology(invoke);
    const nav = elements.get('personal-onto-nav') as any;
    const tboxRow: any = {
      getAttribute: (name: string) => (name === 'data-poc-nav' || name === 'data-poc-id') ? 'tbox' : null,
      addEventListener(event: string, handler: (...args: any[]) => any) { this.listeners.set(event, handler); },
      listeners: new Map<string, (...args: any[]) => any>(),
    };
    nav.querySelectorAll = (selector: string) => selector === '[data-poc-nav]' ? [tboxRow] : [];

    await sandbox.window.renderPersonalOntology();
    await settleBackgroundWork();

    const navHtml = nav.innerHTML || '';
    // T029/T030：三行副标题齐全（沙箱 t(key)=key → _t 回退中文兜底文案）。
    for (const sub of ['系统描述你时的一致用词', '身份、角色与项目关系', 'AI 该怎么配合你做事']) {
      expect(navHtml).toContain(sub);
    }
    expect(navHtml.match(/personal-onto-nav-row-sub/g)).toHaveLength(3);
    // 角标仍在文字位之后的同层（每行最后一个是 muted 角标，DOM 顺序不变）。
    const rowHtmls = navHtml.match(/<button[^>]*class="personal-onto-nav-row[^"]*"[^>]*>[\s\S]*?<\/button>/g) || [];
    expect(rowHtmls).toHaveLength(3);
    for (const rowHtml of rowHtmls) {
      expect(rowHtml).toContain('<span class="muted">');
      expect(rowHtml.lastIndexOf('<span class="muted">')).toBeGreaterThan(rowHtml.lastIndexOf('personal-onto-nav-row-sub'));
    }
    // M4 命名治理后的新口径：分组在盒内管理，「本体分组」同样不是导航入口。
    expect(navHtml).not.toContain('本体分组');
    // 点击行为零变化：点 T 盒行仍切换盒（主区出现词汇盒内容）。
    const click = tboxRow.listeners.get('click');
    expect(click).toBeTypeOf('function');
    await click({ stopPropagation() {} });
    await settleBackgroundWork();
    expect(elements.get('personal-onto-main-body')?.innerHTML).toContain('角色模板');
  });

  it('shows personal assets from the library as the default personal profile', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'personalOntology.templates.list') {
        return { ok: true, templates: [{ template_id: 'student', group_id: 'group-1', name: '学生', installed: true, sections: [] }] };
      }
      if (channel === 'recall.assets.list') {
        return {
          ok: true,
          assets: [{
            id: 'aa-1', type: 'personal', status: 'active',
            lifecycleStatus: 'user_confirmed_unverified',
            statement: '用户是一名拥有 10 年经验的程序员。',
            updatedAt: new Date().toISOString(),
          }],
        };
      }
      return { ok: true };
    });
    const { sandbox, elements } = loadPersonalOntology(invoke);

    await sandbox.window.renderPersonalOntology();
    await settleBackgroundWork();

    expect(invoke).toHaveBeenCalledWith('recall.assets.list', {});
    // 默认 A 盒：画像资产作为「会话沉淀」伪组呈现（六分节保留）
    const body5 = elements.get('personal-onto-main-body')?.innerHTML || '';
    expect(body5).toContain('会话沉淀');
    expect(body5).toContain('用户是一名拥有 10 年经验的程序员。');
    expect(body5).toContain('data-poc-ontology-section="identity"');
    expect(body5).toContain('身份与角色');
  });

  it('groups confirmed profile statements into a visible personal ontology without dropping unknown entries', async () => {
    const statements = [
      '我的工作方式是先明确目标和验收标准，再开始实现。',
      '我偏好界面简洁、信息层次清晰，先给结论再展开细节。',
      '周末会整理本周的重要发现。',
    ];
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'personalOntology.templates.list') return { ok: true, templates: [] };
      if (channel === 'recall.assets.list') {
        return {
          ok: true,
          assets: statements.map((statement, i) => ({
            id: `aa-${i}`, type: 'personal', status: 'active',
            lifecycleStatus: 'user_confirmed_unverified',
            statement,
            updatedAt: new Date().toISOString(),
          })),
        };
      }
      return { ok: true };
    });
    const { sandbox, elements } = loadPersonalOntology(invoke);

    await sandbox.window.renderPersonalOntology();
    await settleBackgroundWork();

    const body = elements.get('personal-onto-main-body')?.innerHTML || '';
    expect(body).toContain('data-poc-ontology-section="workstyle"');
    expect(body).toContain('工作方式');
    expect(body).toContain('data-poc-ontology-section="communication"');
    expect(body).toContain('沟通与交互偏好');
    expect(body).toContain('data-poc-ontology-section="other"');
    expect(body).toContain('其他沉淀');
    expect(body).toContain('周末会整理本周的重要发现。');
  });

  it('keeps unmatched confirmed profile entries visible inside a role template without duplicating matched fields', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'personalOntology.templates.list') {
        return {
          ok: true,
          templates: [{
            template_id: 'student', group_id: 'group-1', name: '学生', installed: true,
            sections: [{ title: '学习背景', fields: [{ name: '教育阶段', values: [] }] }],
          }],
        };
      }
      if (channel === 'recall.assets.list') {
        return {
          ok: true,
          assets: ['我目前在读本科。', '我偏好先看结论，再看实现细节。'].map((statement, i) => ({
            id: `aa-${i}`, type: 'personal', status: 'active',
            lifecycleStatus: 'user_confirmed_unverified',
            statement,
            updatedAt: new Date().toISOString(),
          })),
        };
      }
      if (channel === 'personalOntology.groups.read') {
        return { ok: true, content: '# 学习背景\n教育阶段: 我目前在读本科。' };
      }
      if (channel === 'projects.list') return { ok: true, projects: [] };
      return { ok: true };
    });
    const { sandbox, elements } = loadPersonalOntology(invoke);
    const nav = elements.get('personal-onto-nav') as any;
    const templateButton: any = {
      getAttribute: (name: string) => name === 'data-poc-nav' ? 'template' : name === 'data-poc-id' ? 'group-1' : null,
      addEventListener(event: string, handler: (...args: any[]) => any) {
        this.listeners.set(event, handler);
      },
      listeners: new Map<string, (...args: any[]) => any>(),
    };
    nav.querySelectorAll = (selector: string) => selector === '[data-poc-nav]' ? [templateButton] : [];

    await sandbox.window.renderPersonalOntology();
    await settleBackgroundWork();
    const click = templateButton.listeners.get('click');
    expect(click).toBeTypeOf('function');
    await click({ stopPropagation() {} });
    await settleBackgroundWork();

    const body = elements.get('personal-onto-main-body')?.innerHTML || '';
    const bridgeStart = body.indexOf('personal-onto-template-profile-bridge');
    expect(bridgeStart).toBeGreaterThanOrEqual(0);
    const bridge = body.slice(bridgeStart);
    expect(bridge).toContain('我偏好先看结论，再看实现细节。');
    expect(bridge).not.toContain('我目前在读本科。');
    expect(body).toContain('这些信息已确认，但暂未匹配到当前角色模板字段');
  });

  it('does one library read per render and never wakes the retired profile-sync bridge', async () => {
    let assetReads = 0;
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'personalOntology.templates.list') return { ok: true, templates: [] };
      if (channel === 'recall.assets.list') {
        assetReads += 1;
        return {
          ok: true,
          assets: [{
            id: 'aa-1', type: 'personal', status: 'active',
            lifecycleStatus: 'user_confirmed_unverified',
            statement: '用户偏好先看结论，再看实现细节。',
            updatedAt: new Date().toISOString(),
          }],
        };
      }
      return { ok: true };
    });
    const { sandbox, elements, uiToast } = loadPersonalOntology(invoke);

    await sandbox.window.renderPersonalOntology();
    await settleBackgroundWork();

    // 旧投影桥已退役。默认 A 盒：画像加载与盒数据加载各读一次资产库（语义独立）。
    expect(assetReads).toBe(2);
    expect(invoke).not.toHaveBeenCalledWith('personalOntology.profile.syncRecall', expect.anything());
    expect(uiToast).not.toHaveBeenCalled();
    expect(elements.get('personal-onto-main-body')?.innerHTML).toContain('用户偏好先看结论，再看实现细节。');
  });

  it('keeps role-template entries reachable from the vocabulary box when profile read fails', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'personalOntology.templates.list') {
        return { ok: true, templates: [{ template_id: 'role-1', group_id: 'group-1', name: '默认角色', installed: true, sections: [] }] };
      }
      if (channel === 'recall.assets.list') return { ok: false, error: 'profile offline' };
      if (channel === 'personalOntology.groups.read') return { ok: true, content: '# 默认角色' };
      if (channel === 'projects.list') return { ok: true, projects: [] };
      return { ok: true };
    });
    const { sandbox, elements } = loadPersonalOntology(invoke);
    // 模板行点击由 T 盒渲染——nav mock 需给 tbox 行；切 T 盒后模板可见可点。
    const nav = elements.get('personal-onto-nav') as any;
    const tboxRow: any = {
      getAttribute: (name: string) => name === 'data-poc-nav' ? 'tbox' : null,
      addEventListener(event: string, handler: (...args: any[]) => any) { this.listeners.set(event, handler); },
      listeners: new Map<string, (...args: any[]) => any>(),
    };
    nav.querySelectorAll = (selector: string) => selector === '[data-poc-nav]' ? [tboxRow] : [];

    await sandbox.window.renderPersonalOntology();
    await settleBackgroundWork();
    const clickT = tboxRow.listeners.get('click');
    expect(clickT).toBeTypeOf('function');
    await clickT({ stopPropagation() {} });
    await settleBackgroundWork();

    const body9 = elements.get('personal-onto-main-body')?.innerHTML || '';
    expect(body9).toContain('默认角色');
    expect(body9).toContain('角色模板库');
  });

  it('shows a recoverable error instead of mistaking a template-list failure for an empty library', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'personalOntology.templates.list') return { ok: false, error: 'offline' };
      return { ok: true, written: 0, failed: [] };
    });
    const { sandbox, elements } = loadPersonalOntology(invoke);

    await sandbox.window.renderPersonalOntology();

    expect(elements.get('personal-onto-nav')?.innerHTML).toContain('offline');
    expect(elements.get('personal-onto-main-body')?.innerHTML).toContain('加载失败');
    expect(elements.get('personal-onto-main-body')?.innerHTML).toContain('personal-onto-load-retry');
    expect(elements.get('personal-onto-main-body')?.innerHTML).not.toContain('模板库为空');
  });

  it('defaults to the facts box even with installed templates (no template auto-jump)', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'personalOntology.templates.list') {
        return { ok: true, templates: [{ template_id: 'role-1', group_id: 'group-1', name: '默认角色', installed: true, sections: [] }] };
      }
      if (channel === 'recall.assets.list') return { ok: true, assets: [] };
      if (channel === 'personalOntology.groups.read') return { ok: true, content: '# 默认角色' };
      if (channel === 'projects.list') return { ok: true, projects: [] };
      return { ok: true };
    });
    const { sandbox, elements } = loadPersonalOntology(invoke);

    await sandbox.window.renderPersonalOntology();
    await settleBackgroundWork();

    // 盒子化：默认落在 A 盒（事实）——画像空态在盒内，不自动跳模板编辑器
    const nav11 = elements.get('personal-onto-nav')?.innerHTML || '';
    expect(nav11).toContain('统一词表');
    expect(elements.get('personal-onto-main-body')?.innerHTML).toContain('完成会话沉淀后');
    expect(invoke).not.toHaveBeenCalledWith('personalOntology.groups.read', expect.anything());
  });

  it('keeps a template read-only while its content is still loading', async () => {
    let resolveRead: ((value: unknown) => void) | undefined;
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'personalOntology.templates.list') {
        return {
          ok: true,
          templates: [{
            template_id: 'role-1', group_id: 'group-1', name: '默认角色', installed: true,
            sections: [{ title: '身份', fields: [{ name: '职责', values: [] }] }],
          }],
        };
      }
      if (channel === 'personalOntology.groups.read') return new Promise((resolve) => { resolveRead = resolve; });
      if (channel === 'projects.list') return { ok: true, projects: [] };
      if (channel === 'personalOntology.profile.syncRecall') return { ok: true, written: 0, failed: [] };
      return { ok: true };
    });
    const { sandbox, elements } = loadPersonalOntology(invoke);
    const nav = elements.get('personal-onto-nav') as any;
    const tboxRow: any = {
      getAttribute: (name: string) => name === 'data-poc-nav' ? 'tbox' : null,
      addEventListener(event: string, handler: (...args: any[]) => any) { this.listeners.set(event, handler); },
      listeners: new Map<string, (...args: any[]) => any>(),
    };
    // 模板行在 T 盒 body 内渲染——mock 必须在渲染前就位（绑定时采集）
    const tmplRow: any = {
      getAttribute: (name: string) => name === 'data-poc-nav' ? 'template' : name === 'data-poc-id' ? 'group-1' : null,
      addEventListener(event: string, handler: (...args: any[]) => any) { this.listeners.set(event, handler); },
      listeners: new Map<string, (...args: any[]) => any>(),
    };
    nav.querySelectorAll = (selector: string) => selector === '[data-poc-nav]' ? [tboxRow] : [];
    (elements.get('personal-onto-main-body') as any).querySelectorAll = (selector: string) => selector === '[data-poc-nav]' ? [tmplRow] : [];

    await sandbox.window.renderPersonalOntology();
    await settleBackgroundWork();
    const clickT = tboxRow.listeners.get('click');
    await clickT({ stopPropagation() {} });
    await settleBackgroundWork();
    const clickTmpl = tmplRow.listeners.get('click');
    expect(clickTmpl).toBeTypeOf('function');
    await clickTmpl({ stopPropagation() {} });
    await settleBackgroundWork();
    await settleBackgroundWork();

    expect(elements.get('personal-onto-main-body')?.innerHTML).toContain('正在加载模板内容');
    expect(elements.get('personal-onto-main-body')?.innerHTML).not.toContain('field-add-value');
    resolveRead?.({ ok: true, content: '# 默认角色' });
    await settleBackgroundWork();
  });

  it('guards writes, confirms field-value deletion, and supports Enter-to-save', () => {
    expect(ontology).toContain('const _pocActionLocks = new Set()');
    expect(ontology).toContain('_pocRunOnce(`group-action:${action}:${groupId}:${item}`, el, run)');
    expect(ontology).toContain("e.isComposing || e.keyCode === 229 || e.key !== 'Enter'");
    expect(ontology).toContain("personalOntology.field_value_delete_confirm");
    expect(ontology).toContain("personalOntology.field_value_added");
    expect(ontology).toContain("personalOntology.field_value_updated");
    expect(ontology).toContain("personalOntology.field_value_removed");
  });

  it('renders the rules box with filters, relation values and rule assets', async () => {
    const invoke = vi.fn(async (channel: string, payload?: any) => {
      if (channel === 'personalOntology.templates.list') return { ok: true, templates: [] };
      if (channel === 'recall.assets.list') {
        return { ok: true, assets: [{ id: 'ra-1', type: 'rule', status: 'active', statement: '评审先讲产品模型再谈实现。', updatedAt: new Date().toISOString() }] };
      }
      if (channel === 'personalOntology.groups.list') {
        return { ok: true, groups: [{ group_id: 'grp-t1', title: '总览验证组', rel_path: 'x.md', created_at: '', updated_at: '' }] };
      }
      if (channel === 'personalOntology.candidates.list') return { ok: true, candidates: [] };
      if (channel === 'personalOntology.groups.fields.list' && payload && payload.groupId === 'grp-t1') {
        return {
          ok: true,
          fields: [
            { name: '工作流程', values: [{ value: '评审 → 先讲产品模型', source: '手动', ruleKind: 'operation' }] },
          ],
        };
      }
      if (channel === 'personalOntology.groups.read') return { ok: true, content: '' };
      if (channel === 'personalOntology.conflicts.list') return { ok: true, conflicts: [] };
      return { ok: true };
    });
    const { sandbox, elements } = loadPersonalOntology(invoke);
    const nav = elements.get('personal-onto-nav') as any;
    const rboxRow: any = {
      getAttribute: (name: string) => name === 'data-poc-nav' ? 'rbox' : null,
      addEventListener(event: string, handler: (...args: any[]) => any) { this.listeners.set(event, handler); },
      listeners: new Map<string, (...args: any[]) => any>(),
    };
    nav.querySelectorAll = (selector: string) => selector === '[data-poc-nav]' ? [rboxRow] : [];

    await sandbox.window.renderPersonalOntology();
    await settleBackgroundWork();
    const click = rboxRow.listeners.get('click');
    await click({ stopPropagation() {} });
    await settleBackgroundWork();

    const body = elements.get('personal-onto-main-body')?.innerHTML || '';
    expect(body).toContain('规则');
    expect(body).toContain('全部');
    expect(body).toContain('操作规则');
    expect(body).toContain('总览验证组'); // 组小节（值行极简，字段名不占行）
    expect(body).toContain('评审 → 先讲产品模型');
    expect(body).toContain('评审先讲产品模型再谈实现。'); // 规则资产合并
  });
  it('renders the facts box with terse value rows and expandable detail actions', async () => {
    const invoke = vi.fn(async (channel: string, payload?: any) => {
      if (channel === 'personalOntology.templates.list') return { ok: true, templates: [] };
      if (channel === 'recall.assets.list') return { ok: true, assets: [] };
      if (channel === 'personalOntology.groups.list') {
        return { ok: true, groups: [{ group_id: 'grp-9', title: '基本情况', rel_path: 'g.md', created_at: '', updated_at: '' }] };
      }
      if (channel === 'personalOntology.candidates.list') {
        return { ok: true, candidates: [{ candidate_id: 'asset-backflow-aa-1', kind: 'preference', memory_scope: 'user', summary: '偏好表格旁附通俗说明', memory_text: '偏好表格旁附通俗说明。' }] };
      }
      if (channel === 'personalOntology.groups.fields.list' && payload && payload.groupId === 'grp-9') {
        return {
          ok: true,
          fields: [
            { name: '居住地', values: [{ value: '常住北京', source: '手动', verified: true }, { value: '常住上海', source: '智能', project: 'p1' }] },
            { name: '就读状态', values: [{ value: '目前大四', source: '手动', asOf: '2025-01' }] },
            { name: '工作流程', isRelation: true, values: [{ value: '评审 → 先讲产品模型', source: '手动' }] },
          ],
        };
      }
      if (channel === 'personalOntology.groups.read') {
        return { ok: true, content: '# 基本情况\n\n## 字段区\n\n### 居住地\n\n- 常住北京 [手动]\n\n## 流水区\n\n§ 2026-09 追加了某条内容\n' };
      }
      if (channel === 'personalOntology.conflicts.list') {
        return { ok: true, conflicts: [{ conflict_id: 'oc-x', group_id: 'grp-9', field: '居住地', value_a: '常住北京', value_b: '常住上海', detected_at: '', status: 'open' }] };
      }
      return { ok: true };
    });
    const { sandbox, elements } = loadPersonalOntology(invoke);

    await sandbox.window.renderPersonalOntology();
    await settleBackgroundWork();

    // 默认即 A 盒：组小节 + 极简值行（内容+来源，无 chip 糊脸）+ 状态点
    const body = elements.get('personal-onto-main-body')?.innerHTML || '';
    expect(body).toContain('基本情况');
    expect(body).toContain('居住地'); // 字段小节名
    expect(body).toContain('常住北京');
    expect(body).toContain('ui-status-dot--critical'); // 状态点在（矛盾红）——随 T041 迁移精确化（原锁旧类名 personal-onto-status-dot，总控已批）
    // 标记与操作不在默认渲染里（收进展开）
    expect(body).not.toContain('与同字段另一条值矛盾');
    expect(body).not.toContain('data-poc-group-op="remove-value"');
    // 回流候选区与组选择按钮
    expect(body).toContain('待确认回流');
    expect(body).toContain('写入：基本情况');
    // 关系值不在 A 盒（归 R 盒）
    expect(body).not.toContain('评审 → 先讲产品模型');
    // 流水区
    expect(body).toContain('2026-09 追加了某条内容');

    // 点击值行 → 展开详情：标记 chip + 操作按钮出现
    const bodyEl = elements.get('personal-onto-main-body') as any;
    const lineRow: any = {
      getAttribute: (name: string) => name === 'data-poc-line-key' ? encodeURIComponent('grp-9\u0001居住地\u0001常住北京') : null,
      addEventListener(event: string, handler: (...args: any[]) => any) { this.listeners.set(event, handler); },
      listeners: new Map<string, (...args: any[]) => any>(),
    };
    bodyEl.querySelectorAll = (selector: string) => selector === '[data-poc-line-key]' ? [lineRow] : [];
    await sandbox.window.renderPersonalOntology();
    await settleBackgroundWork();
    const clickLine = lineRow.listeners.get('click');
    expect(clickLine).toBeTypeOf('function');
    await clickLine({ stopPropagation() {} });
    await settleBackgroundWork();
    const expanded = elements.get('personal-onto-main-body')?.innerHTML || '';
    expect(expanded).toContain('有来源支持');
    expect(expanded).toContain('data-poc-group-op="verify-value"');
    expect(expanded).toContain('data-poc-group-op="remove-value"');
  });


  it('retires the legacy profile-sync bridge entirely: no calls, no warnings', async () => {
    // 2026-09-19 记忆退役：画像投影桥（资产→USER.md 反向同步）整体移除。
    // 无论它曾经怎么失败（rejected / partial write），界面都不再调用、不再告警。
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'personalOntology.templates.list') return { ok: true, templates: [] };
      if (channel === 'recall.assets.list') return { ok: true, assets: [] };
      if (channel === 'personalOntology.profile.syncRecall') throw new Error('transport failed');
      return { ok: true };
    });
    const { sandbox, uiToast } = loadPersonalOntology(invoke);

    await sandbox.window.renderPersonalOntology();
    await settleBackgroundWork();
    await sandbox.window.refreshPersonalOntology();
    await settleBackgroundWork();

    expect(invoke).not.toHaveBeenCalledWith('personalOntology.profile.syncRecall', expect.anything());
    expect(uiToast).not.toHaveBeenCalled();
  });

  // ── US-101 条目级编辑（specs/009 Phase 3：T013/T014/T017/T018）─────────────
  function boxInvokeMock(extra: Record<string, (payload?: any) => any> = {}) {
    return vi.fn(async (channel: string, payload?: any) => {
      const override = extra[channel];
      if (override) return override(payload);
      if (channel === 'personalOntology.templates.list') return { ok: true, templates: [] };
      if (channel === 'recall.assets.list') return { ok: true, assets: [] };
      if (channel === 'personalOntology.groups.list') {
        return { ok: true, groups: [{ group_id: 'grp-e1', title: '基本情况', rel_path: 'g.md', created_at: '', updated_at: '' }] };
      }
      if (channel === 'personalOntology.groups.fields.list' && payload && payload.groupId === 'grp-e1') {
        return { ok: true, fields: [{ name: '居住地', values: [{ value: '常住北京', source: '手动' }] }] };
      }
      if (channel === 'personalOntology.groups.read') return { ok: true, content: '# 基本情况' };
      if (channel === 'personalOntology.candidates.list') return { ok: true, candidates: [] };
      if (channel === 'personalOntology.conflicts.list') return { ok: true, conflicts: [] };
      if (channel === 'projects.list') return { ok: true, projects: [] };
      return { ok: true };
    });
  }

  it('shows the edit action only on ontology-owned rows; asset rows stay read-only with the source hint', async () => {
    const invoke = boxInvokeMock({
      // 画像资产行（「来自资产」）：编辑按钮不得出现在这里
      'recall.assets.list': () => ({
        ok: true,
        assets: [{
          id: 'aa-1', type: 'personal', status: 'active',
          lifecycleStatus: 'user_confirmed_unverified',
          statement: '用户是一名拥有 10 年经验的程序员。',
          updatedAt: new Date().toISOString(),
        }],
      }),
    });
    const { sandbox, elements } = loadPersonalOntology(invoke);
    const bodyEl = elements.get('personal-onto-main-body') as any;

    await sandbox.window.renderPersonalOntology();
    await settleBackgroundWork();

    // ①（收起态前置）操作都收在展开区：默认渲染里没有编辑按钮
    let body = elements.get('personal-onto-main-body')?.innerHTML || '';
    expect(body).not.toContain('data-poc-group-op="edit-value"');

    // ④ 「来自资产」画像分节行：无任何组操作入口（只读口径），且带「我的认知」提示
    const secStart = body.indexOf('data-poc-ontology-section=');
    const grpStart = body.indexOf('personal-onto-abox-group');
    expect(secStart).toBeGreaterThan(0);
    expect(grpStart).toBeGreaterThan(secStart);
    const profileZone = body.slice(secStart, grpStart);
    expect(profileZone).toContain('用户是一名拥有 10 年经验的程序员。');
    expect(profileZone).not.toContain('data-poc-group-op');
    expect(profileZone).not.toContain('data-poc-group-op="edit-value"');
    expect(profileZone).toContain('可在「我的认知」查看全文与来源'); // abox_asset_src_hint 兜底文案

    // ① 本体自有值行展开后 → 编辑按钮与删除并列出现
    const lineRow: any = {
      getAttribute: (name: string) => name === 'data-poc-line-key' ? encodeURIComponent('grp-e1\u0001居住地\u0001常住北京') : null,
      addEventListener(event: string, handler: (...args: any[]) => any) { this.listeners.set(event, handler); },
      listeners: new Map<string, (...args: any[]) => any>(),
    };
    bodyEl.querySelectorAll = (selector: string) => selector === '[data-poc-line-key]' ? [lineRow] : [];
    await sandbox.window.renderPersonalOntology();
    await settleBackgroundWork();
    const clickLine = lineRow.listeners.get('click');
    expect(clickLine).toBeTypeOf('function');
    await clickLine({ stopPropagation() {} });
    await settleBackgroundWork();
    body = elements.get('personal-onto-main-body')?.innerHTML || '';
    expect(body).toContain('data-poc-group-op="edit-value"');
    expect(body).toContain('编辑这条值');
    expect(body).toContain('data-poc-group-op="remove-value"');
    // 编辑按钮带全量定位属性（gid/field/value）
    const btnStart = body.indexOf('data-poc-group-op="edit-value"');
    const btnTag = body.slice(Math.max(0, btnStart - 40), btnStart + 220);
    expect(btnTag).toContain('data-poc-gid="grp-e1"');
    expect(btnTag).toContain('data-poc-field="居住地"');
    expect(btnTag).toContain('data-poc-value="常住北京"');
  });

  it('rejects empty or unchanged edits locally without ever calling setValue', async () => {
    const invoke = boxInvokeMock();
    const answers = ['   ', '常住北京'];
    const uiPrompt = vi.fn(async () => answers.shift());
    const { sandbox, elements, uiToast } = loadPersonalOntology(invoke, { uiPrompt });
    const bodyEl = elements.get('personal-onto-main-body') as any;

    await sandbox.window.renderPersonalOntology();
    await settleBackgroundWork();

    const editBtn: any = {
      getAttribute: (name: string) => (name === 'data-poc-group-op' ? 'edit-value'
        : name === 'data-poc-gid' ? 'grp-e1'
          : name === 'data-poc-field' ? '居住地'
            : name === 'data-poc-value' ? '常住北京' : null),
      addEventListener(event: string, handler: (...args: any[]) => any) { this.listeners.set(event, handler); },
      listeners: new Map<string, (...args: any[]) => any>(),
    };
    bodyEl.querySelectorAll = (selector: string) => selector === '[data-poc-group-op]' ? [editBtn] : [];
    await sandbox.window.renderPersonalOntology();
    await settleBackgroundWork();
    const click = editBtn.listeners.get('click');
    expect(click).toBeTypeOf('function');

    // ② 空值/纯空白 → 明确报错文案，且未发任何 setValue 请求
    await click({ stopPropagation() {} });
    await settleBackgroundWork();
    expect(uiPrompt).toHaveBeenCalledWith('编辑这条值', '常住北京');
    expect(uiToast).toHaveBeenCalledWith('值不能为空，未保存', { variant: 'error' });
    expect(invoke).not.toHaveBeenCalledWith('personalOntology.groups.fields.setValue', expect.anything());

    // 与原值相同 → 提示内容没有变化，仍不提交
    await click({ stopPropagation() {} });
    await settleBackgroundWork();
    expect(uiToast).toHaveBeenCalledWith('内容没有变化', { variant: 'info' });
    expect(invoke).not.toHaveBeenCalledWith('personalOntology.groups.fields.setValue', expect.anything());
  });

  it('saves a changed value via setValue and immediately re-reads the group', async () => {
    let edited = false;
    const invoke = boxInvokeMock({
      'personalOntology.groups.fields.setValue': () => { edited = true; return { ok: true }; },
      'personalOntology.groups.fields.list': () => ({
        ok: true,
        fields: [{ name: '居住地', values: [{ value: edited ? '常住杭州' : '常住北京', source: '手动' }] }],
      }),
    });
    const uiPrompt = vi.fn(async () => ' 常住杭州 ');
    const { sandbox, elements, uiToast } = loadPersonalOntology(invoke, { uiPrompt });
    const bodyEl = elements.get('personal-onto-main-body') as any;

    await sandbox.window.renderPersonalOntology();
    await settleBackgroundWork();
    const readsBefore = invoke.mock.calls.filter(([c]) => c === 'personalOntology.groups.read').length;

    const editBtn: any = {
      getAttribute: (name: string) => (name === 'data-poc-group-op' ? 'edit-value'
        : name === 'data-poc-gid' ? 'grp-e1'
          : name === 'data-poc-field' ? '居住地'
            : name === 'data-poc-value' ? '常住北京' : null),
      addEventListener(event: string, handler: (...args: any[]) => any) { this.listeners.set(event, handler); },
      listeners: new Map<string, (...args: any[]) => any>(),
    };
    bodyEl.querySelectorAll = (selector: string) => selector === '[data-poc-group-op]' ? [editBtn] : [];
    await sandbox.window.renderPersonalOntology();
    await settleBackgroundWork();
    await editBtn.listeners.get('click')({ stopPropagation() {} });
    await settleBackgroundWork();

    // ③ 保存成功：trim 后经 setValue 写入，payload 与既有通道形态一致
    expect(invoke).toHaveBeenCalledWith('personalOntology.groups.fields.setValue', {
      groupId: 'grp-e1', fieldName: '居住地', value: '常住杭州', oldValue: '常住北京',
    });
    expect(uiToast).toHaveBeenCalledWith('已更新', { variant: 'success' });
    // 即时刷新：groups.read 被重新拉取，值行直接显示新值（无需整页刷新）
    const readsAfter = invoke.mock.calls.filter(([c]) => c === 'personalOntology.groups.read').length;
    expect(readsAfter).toBeGreaterThan(readsBefore);
    expect(elements.get('personal-onto-main-body')?.innerHTML).toContain('常住杭州');
  });

  it('surfaces a failed edit via the existing failure path instead of failing silently', async () => {
    const invoke = boxInvokeMock({
      'personalOntology.groups.fields.setValue': () => ({ ok: false, error: 'locked' }),
    });
    const uiPrompt = vi.fn(async () => '常住杭州');
    const uiAlert = vi.fn();
    const { sandbox, elements, uiToast } = loadPersonalOntology(invoke, { uiPrompt, uiAlert });
    const bodyEl = elements.get('personal-onto-main-body') as any;

    await sandbox.window.renderPersonalOntology();
    await settleBackgroundWork();
    const readsBefore = invoke.mock.calls.filter(([c]) => c === 'personalOntology.groups.read').length;

    const editBtn: any = {
      getAttribute: (name: string) => (name === 'data-poc-group-op' ? 'edit-value'
        : name === 'data-poc-gid' ? 'grp-e1'
          : name === 'data-poc-field' ? '居住地'
            : name === 'data-poc-value' ? '常住北京' : null),
      addEventListener(event: string, handler: (...args: any[]) => any) { this.listeners.set(event, handler); },
      listeners: new Map<string, (...args: any[]) => any>(),
    };
    bodyEl.querySelectorAll = (selector: string) => selector === '[data-poc-group-op]' ? [editBtn] : [];
    await sandbox.window.renderPersonalOntology();
    await settleBackgroundWork();
    await editBtn.listeners.get('click')({ stopPropagation() {} });
    await settleBackgroundWork();

    // 失败可见（_pocGroupAction → _notifyFail），不算成功、不触发重载
    expect(uiAlert).toHaveBeenCalledWith('操作失败: locked');
    expect(uiToast).not.toHaveBeenCalledWith('已更新', expect.anything());
    const readsAfter = invoke.mock.calls.filter(([c]) => c === 'personalOntology.groups.read').length;
    expect(readsAfter).toBe(readsBefore);
  });
});

// ── US-102 删除/恢复闭环渲染段（specs/009 Phase 4：T022/T023/T024）──────────
describe('personal ontology deleted-groups fold (US-102 D5b renderer / T027-T028)', () => {
  /** 可点击控件 mock：含 _pocRunOnce 忙态路径需要的 setAttribute/removeAttribute。 */
  function ctrl(attrs: Record<string, string>) {
    return {
      disabled: false,
      getAttribute: (name: string) => (name in attrs ? attrs[name] : null),
      setAttribute() {},
      removeAttribute() {},
      listeners: new Map<string, (...args: any[]) => any>(),
      addEventListener(event: string, handler: (...args: any[]) => any) {
        this.listeners.set(event, handler);
      },
    };
  }

  /** 有状态 invoke：真实模拟「删组进已删除列表 → 恢复回列表」的主进程行为。 */
  function makeDeletedGroupsWorld() {
    const BEFORE = '# 基本情况\n\n## 字段区\n\n### 居住地\n\n- 常住北京 [手动]\n';
    const world = {
      BEFORE,
      groups: [{ group_id: 'grp-d1', title: '基本情况', rel_path: '.personal_ontology_groups/grp-d1.md', created_at: '', updated_at: '' }],
      deleted: [] as any[],
      history: [] as any[],
      content: BEFORE,
      reads: [] as string[],
      restoreCalls: [] as any[],
    };
    const invoke = vi.fn(async (channel: string, payload?: any) => {
      if (channel === 'personalOntology.templates.list') return { ok: true, templates: [] };
      if (channel === 'recall.assets.list') return { ok: true, assets: [] };
      if (channel === 'personalOntology.groups.list') return { ok: true, groups: world.groups };
      if (channel === 'personalOntology.candidates.list') return { ok: true, candidates: [] };
      if (channel === 'personalOntology.conflicts.list') return { ok: true, conflicts: [] };
      if (channel === 'personalOntology.groups.fields.list') {
        const hasValue = world.content.includes('常住北京');
        return { ok: true, fields: hasValue ? [{ name: '居住地', values: [{ value: '常住北京', source: '手动' }] }] : [] };
      }
      if (channel === 'personalOntology.groups.read') {
        world.reads.push(world.content);
        return { ok: true, content: world.content };
      }
      if (channel === 'personalOntology.groups.delete') {
        // 主进程 T021 口径：rm 前留档（= 删除前最后一版）→ 删台账行
        world.history.unshift({ id: 'snap-del', savedAt: '2026-09-25T10:00:00.000Z', bytes: BEFORE.length, preview: BEFORE.replace(/\s+/g, ' ').slice(0, 80) });
        world.groups = [];
        world.deleted = [{ groupId: 'grp-d1', title: '基本情况', deletedAt: '2026-09-25T10:00:00.000Z', snapshotCount: 1 }];
        return { ok: true };
      }
      if (channel === 'personalOntology.groups.deleted.list') return { ok: true, deleted: world.deleted };
      if (channel === 'personalOntology.groups.history.list') return { ok: true, history: world.history };
      if (channel === 'personalOntology.groups.history.restore') {
        world.restoreCalls.push(payload);
        // 主进程 T025 口径：meta 缺失 → 重建 meta + 写回快照 → 组回台账
        world.content = BEFORE;
        world.groups = [{ group_id: 'grp-d1', title: '基本情况', rel_path: '.personal_ontology_groups/grp-d1.md', created_at: '', updated_at: '' }];
        world.deleted = [];
        return { ok: true };
      }
      return { ok: true };
    });
    return { world, invoke };
  }

  async function openTBox(sandbox: any, elements: any) {
    const nav = elements.get('personal-onto-nav') as any;
    const tboxRow = ctrl({ 'data-poc-nav': 'tbox', 'data-poc-id': 'tbox' });
    nav.querySelectorAll = (selector: string) => (selector === '[data-poc-nav]' ? [tboxRow] : []);
    // nav mock 装好后重渲染一次，_pocBindNav 才会把点击监听绑到 mock 行上
    await sandbox.window.renderPersonalOntology();
    await settleBackgroundWork();
    await tboxRow.listeners.get('click')({ stopPropagation() {} });
    await settleBackgroundWork();
  }

  it('T028 删除测试分组 → 「已删除分组」可见（标题/时间/快照数）→ 恢复 → 分组回到列表且内容逐字一致', async () => {
    const { world, invoke } = makeDeletedGroupsWorld();
    const { sandbox, elements } = loadPersonalOntology(invoke, { uiConfirmDanger: async () => true });
    const bodyEl = elements.get('personal-onto-main-body') as any;

    // ① T 盒：组卡在；折叠入口在但未展开，且展开前不拉已删除列表（懒加载/IPC 纪律）
    await sandbox.window.renderPersonalOntology();
    await settleBackgroundWork();
    await openTBox(sandbox, elements);
    let body = elements.get('personal-onto-main-body')?.innerHTML || '';
    expect(body).toContain('基本情况');
    expect(body).toContain('data-poc-deleted-op="toggle"');
    expect(body).toContain('已删除分组');
    expect(body).not.toContain('data-poc-deleted-op="restore"');
    expect(invoke).not.toHaveBeenCalledWith('personalOntology.groups.deleted.list', expect.anything());

    // ② 删除分组（确认直过）→ 组卡消失
    const deleteBtn = ctrl({ 'data-poc-group-op': 'delete-group', 'data-poc-gid': 'grp-d1' });
    bodyEl.querySelectorAll = (selector: string) => (selector === '[data-poc-group-op]' ? [deleteBtn] : []);
    await sandbox.window.renderPersonalOntology();
    await settleBackgroundWork();
    await deleteBtn.listeners.get('click')({ stopPropagation() {} });
    await settleBackgroundWork();
    expect(invoke).toHaveBeenCalledWith('personalOntology.groups.delete', { groupId: 'grp-d1' });
    body = elements.get('personal-onto-main-body')?.innerHTML || '';
    expect(body).not.toContain('data-poc-group-op="delete-group"');

    // ③ 展开「已删除分组」：标题 / 删除时刻 / 快照数 / 恢复按钮都可见
    const toggleBtn = ctrl({ 'data-poc-deleted-op': 'toggle' });
    bodyEl.querySelectorAll = (selector: string) => (selector === '[data-poc-deleted-op]' ? [toggleBtn] : []);
    await sandbox.window.renderPersonalOntology();
    await settleBackgroundWork();
    await toggleBtn.listeners.get('click')({ stopPropagation() {} });
    await settleBackgroundWork();
    expect(invoke).toHaveBeenCalledWith('personalOntology.groups.deleted.list', {});
    body = elements.get('personal-onto-main-body')?.innerHTML || '';
    expect(body).toContain('基本情况');
    expect(body).toContain('2026-09-25T10:00:00.000Z');
    expect(body).toMatch(/·\s*1</); // 快照数
    expect(body).toContain('data-poc-deleted-op="restore"');
    expect(body).toContain('data-poc-gid="grp-d1"');
    expect(body).toContain('恢复这个分组');

    // ④ 恢复 → 复用 history.restore（最新一版）→ 分组卡回到列表、内容与删除前逐字一致
    const restoreBtn = ctrl({ 'data-poc-deleted-op': 'restore', 'data-poc-gid': 'grp-d1' });
    bodyEl.querySelectorAll = (selector: string) => (selector === '[data-poc-deleted-op]' ? [restoreBtn] : []);
    await sandbox.window.renderPersonalOntology();
    await settleBackgroundWork();
    await restoreBtn.listeners.get('click')({ stopPropagation() {} });
    await settleBackgroundWork();
    expect(world.restoreCalls).toEqual([{ groupId: 'grp-d1', snapshotId: 'snap-del' }]);
    body = elements.get('personal-onto-main-body')?.innerHTML || '';
    expect(body).toContain('基本情况'); // 组卡回到列表（T 盒显示组卡与字段名）
    expect(body).toContain('居住地'); // 重读后的字段也回来了
    expect(body).not.toContain('data-poc-deleted-op="restore"'); // 已删除列表里没有它了
    expect(body).toContain('没有已删除的分组'); // 空态（恢复后列表刷新为空）
    expect(world.reads[world.reads.length - 1]).toBe(world.BEFORE); // groups.read 内容逐字一致
  });

  it('T028 空态：没有已删除的分组时展开可读、不报错（_emptyState 呈现）', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'personalOntology.templates.list') return { ok: true, templates: [] };
      if (channel === 'recall.assets.list') return { ok: true, assets: [] };
      if (channel === 'personalOntology.groups.list') return { ok: true, groups: [] };
      if (channel === 'personalOntology.candidates.list') return { ok: true, candidates: [] };
      if (channel === 'personalOntology.groups.deleted.list') return { ok: true, deleted: [] };
      return { ok: true };
    });
    const { sandbox, elements } = loadPersonalOntology(invoke);
    const bodyEl = elements.get('personal-onto-main-body') as any;
    await sandbox.window.renderPersonalOntology();
    await settleBackgroundWork();
    await openTBox(sandbox, elements);

    const toggleBtn = ctrl({ 'data-poc-deleted-op': 'toggle' });
    bodyEl.querySelectorAll = (selector: string) => (selector === '[data-poc-deleted-op]' ? [toggleBtn] : []);
    await sandbox.window.renderPersonalOntology();
    await settleBackgroundWork();
    await toggleBtn.listeners.get('click')({ stopPropagation() {} });
    await settleBackgroundWork();

    const body = elements.get('personal-onto-main-body')?.innerHTML || '';
    expect(body).toContain('没有已删除的分组');
    expect(body).toContain('ui-empty-state'); // 走共享空态原语
    expect(body).not.toContain('data-poc-deleted-op="restore"');
  });

  it('T028 同名组已存在 → 恢复被拒绝且提示可见，分组不回列表', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'personalOntology.templates.list') return { ok: true, templates: [] };
      if (channel === 'recall.assets.list') return { ok: true, assets: [] };
      if (channel === 'personalOntology.groups.list') return { ok: true, groups: [] };
      if (channel === 'personalOntology.candidates.list') return { ok: true, candidates: [] };
      if (channel === 'personalOntology.conflicts.list') return { ok: true, conflicts: [] };
      if (channel === 'personalOntology.groups.fields.list') return { ok: true, fields: [] };
      if (channel === 'personalOntology.groups.deleted.list') {
        return { ok: true, deleted: [{ groupId: 'grp-dup', title: '同名组', deletedAt: '2026-09-25T10:00:00.000Z', snapshotCount: 2 }] };
      }
      if (channel === 'personalOntology.groups.history.list') {
        return { ok: true, history: [{ id: 'snap-dup', savedAt: '2026-09-25T10:00:00.000Z' }] };
      }
      if (channel === 'personalOntology.groups.history.restore') {
        // 主进程 T025 唯一新增错误码：同名 group_id 已存在
        return { ok: false, error: 'group already exists' };
      }
      return { ok: true };
    });
    const { sandbox, elements, uiToast } = loadPersonalOntology(invoke);
    const bodyEl = elements.get('personal-onto-main-body') as any;
    await sandbox.window.renderPersonalOntology();
    await settleBackgroundWork();
    await openTBox(sandbox, elements);

    const toggleBtn = ctrl({ 'data-poc-deleted-op': 'toggle' });
    const restoreBtn = ctrl({ 'data-poc-deleted-op': 'restore', 'data-poc-gid': 'grp-dup' });
    bodyEl.querySelectorAll = (selector: string) => (selector === '[data-poc-deleted-op]' ? [toggleBtn] : []);
    await sandbox.window.renderPersonalOntology();
    await settleBackgroundWork();
    await toggleBtn.listeners.get('click')({ stopPropagation() {} });
    await settleBackgroundWork();
    let body = elements.get('personal-onto-main-body')?.innerHTML || '';
    expect(body).toContain('同名组');

    bodyEl.querySelectorAll = (selector: string) => (selector === '[data-poc-deleted-op]' ? [restoreBtn] : []);
    await sandbox.window.renderPersonalOntology();
    await settleBackgroundWork();
    await restoreBtn.listeners.get('click')({ stopPropagation() {} });
    await settleBackgroundWork();

    expect(invoke).toHaveBeenCalledWith('personalOntology.groups.history.restore', { groupId: 'grp-dup', snapshotId: 'snap-dup' });
    // 拒绝必须可见：失败 toast 带错误码（沙箱 t(key)=key → 兜底串 = 错误码本身）
    expect(uiToast).toHaveBeenCalledWith('group already exists', { variant: 'error' });
    // 分组没有回来、行仍在已删除列表（可重试）
    body = elements.get('personal-onto-main-body')?.innerHTML || '';
    expect(body).toContain('同名组');
    expect(body).toContain('data-poc-deleted-op="restore"');
  });
});

describe('personal ontology delete-recover roundtrip (US-102 renderer)', () => {
  /** 可点击控件 mock：含 _pocRunOnce 忙态路径需要的 setAttribute/removeAttribute。 */
  function ctrl(attrs: Record<string, string>) {
    return {
      disabled: false,
      getAttribute: (name: string) => (name in attrs ? attrs[name] : null),
      setAttribute() {},
      removeAttribute() {},
      listeners: new Map<string, (...args: any[]) => any>(),
      addEventListener(event: string, handler: (...args: any[]) => any) {
        this.listeners.set(event, handler);
      },
    };
  }

  it('T024 删值 → 历史入口找到删除前那版（带 T023 台账摘要）→ 恢复 → 内容逐字一致', async () => {
    const BEFORE = '# 基本情况\n\n## 字段区\n\n### 居住地\n\n- 常住北京 [手动]\n';
    const AFTER = '# 基本情况\n\n## 字段区\n\n### 居住地\n\n';
    let content = BEFORE;
    let restored = false;
    const history: any[] = [];
    const reads: string[] = [];
    const invoke = vi.fn(async (channel: string, payload?: any) => {
      if (channel === 'personalOntology.templates.list') return { ok: true, templates: [] };
      if (channel === 'recall.assets.list') return { ok: true, assets: [] };
      if (channel === 'personalOntology.groups.list') {
        return { ok: true, groups: [{ group_id: 'grp-d1', title: '基本情况', rel_path: 'g.md', created_at: '', updated_at: '' }] };
      }
      if (channel === 'personalOntology.candidates.list') return { ok: true, candidates: [] };
      if (channel === 'personalOntology.conflicts.list') return { ok: true, conflicts: [] };
      if (channel === 'personalOntology.groups.fields.list') {
        const hasValue = content.includes('常住北京');
        return { ok: true, fields: [{ name: '居住地', values: hasValue ? [{ value: '常住北京', source: '手动' }] : [] }] };
      }
      if (channel === 'personalOntology.groups.read') {
        reads.push(content);
        return { ok: true, content };
      }
      // 主进程 T020/T021 口径：写前留档——删除前整组原文进历史并配台账。
      if (channel === 'personalOntology.groups.fields.removeValue') {
        history.unshift({
          id: 'snap-1', savedAt: '2026-09-25T10:00:00.000Z', bytes: BEFORE.length,
          preview: BEFORE.replace(/\s+/g, ' ').slice(0, 80),
          audit: { action: 'value_remove', field: '居住地', at: '2026-09-25T10:00:00.001Z' },
        });
        content = AFTER;
        return { ok: true };
      }
      // snap-0：更早的一版，无台账（audit 键缺席）——T023 验收「不留空行」。
      if (channel === 'personalOntology.groups.history.list') {
        return { ok: true, history: history.concat([{ id: 'snap-0', savedAt: '2026-09-24T09:00:00.000Z', bytes: 4, preview: '# 基本情况' }]) };
      }
      if (channel === 'personalOntology.groups.history.restore') {
        if (payload && payload.snapshotId === 'snap-1' && !restored) {
          restored = true;
          content = BEFORE;
        }
        return { ok: true };
      }
      return { ok: true };
    });
    const { sandbox, elements } = loadPersonalOntology(invoke);
    const bodyEl = elements.get('personal-onto-main-body') as any;
    const modalBody = elements.get('personal-onto-modal-body') as any;
    const modal = elements.get('personal-onto-modal') as any;

    // ① 初始：A 盒显示这条值
    await sandbox.window.renderPersonalOntology();
    await settleBackgroundWork();
    expect(elements.get('personal-onto-main-body')?.innerHTML).toContain('常住北京');

    // ② 展开值行 → 删除这条值
    const lineRow = ctrl({ 'data-poc-line-key': encodeURIComponent('grp-d1\u0001居住地\u0001常住北京') });
    bodyEl.querySelectorAll = (selector: string) => (selector === '[data-poc-line-key]' ? [lineRow] : []);
    await sandbox.window.renderPersonalOntology();
    await settleBackgroundWork();
    await lineRow.listeners.get('click')({ stopPropagation() {} });
    await settleBackgroundWork();

    const removeBtn = ctrl({
      'data-poc-group-op': 'remove-value', 'data-poc-gid': 'grp-d1',
      'data-poc-field': '居住地', 'data-poc-value': '常住北京',
    });
    bodyEl.querySelectorAll = (selector: string) => (selector === '[data-poc-group-op]' ? [removeBtn] : []);
    await sandbox.window.renderPersonalOntology();
    await settleBackgroundWork();
    await removeBtn.listeners.get('click')({ stopPropagation() {} });
    await settleBackgroundWork();

    expect(invoke).toHaveBeenCalledWith('personalOntology.groups.fields.removeValue', {
      groupId: 'grp-d1', fieldName: '居住地', value: '常住北京',
    });
    expect(elements.get('personal-onto-main-body')?.innerHTML).not.toContain('常住北京');

    // ③ 「历史」入口：删除前那版可见，带台账摘要行
    const historyBtn = ctrl({ 'data-poc-group-op': 'show-history', 'data-poc-gid': 'grp-d1' });
    const restoreBtn = ctrl({ 'data-poc-group-op': 'restore-snapshot', 'data-poc-snapshot': 'snap-1' });
    bodyEl.querySelectorAll = (selector: string) => (selector === '[data-poc-group-op]' ? [historyBtn] : []);
    modalBody.querySelectorAll = (selector: string) => (selector === '[data-poc-group-op="restore-snapshot"]' ? [restoreBtn] : []);
    await sandbox.window.renderPersonalOntology();
    await settleBackgroundWork();
    await historyBtn.listeners.get('click')({ stopPropagation() {} });
    await settleBackgroundWork();

    const modalHtml = modalBody.innerHTML || '';
    expect(modal.style.display).toBe('flex');
    expect(invoke).toHaveBeenCalledWith('personalOntology.groups.history.list', { groupId: 'grp-d1' });
    // 既有字段零改动：时间 / 预览 / 恢复按钮照旧，两版都在
    expect(modalHtml).toContain('data-poc-snapshot="snap-1"');
    expect(modalHtml).toContain('data-poc-snapshot="snap-0"');
    expect(modalHtml).toContain('恢复这版');
    // T023：有台账的版本显示「谁·何时·改的哪个字段」摘要（可读化动作 + 字段 + 操作者）
    expect(modalHtml).toContain('用户');
    expect(modalHtml).toContain('删除值');
    expect(modalHtml).toContain('居住地');
    expect(modalHtml).not.toContain('value_remove'); // 枚举原词不外露
    expect(modalHtml).toContain('2026-09-25T10:00:00.001Z'); // 台账时间
    // 无台账的版本不留空行：audit 摘要行数量 == 带台账的版本数（仅 snap-1）
    expect(modalHtml.match(/personal-onto-history-audit"/g)).toHaveLength(1);

    // ④ 恢复删除前那版 → 内容逐字一致
    await restoreBtn.listeners.get('click')({ stopPropagation() {} });
    await settleBackgroundWork();
    expect(invoke).toHaveBeenCalledWith('personalOntology.groups.history.restore', {
      groupId: 'grp-d1', snapshotId: 'snap-1',
    });
    expect(modal.style.display).toBe('none');
    expect(elements.get('personal-onto-main-body')?.innerHTML).toContain('常住北京');
    expect(reads[reads.length - 1]).toBe(BEFORE); // groups.read 返回值与删除前逐字相等
  });

  it('T024 既有 field_value_delete_confirm 确认流未被绕过（模板编辑器删值先确认）', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'personalOntology.templates.list') {
        return {
          ok: true,
          templates: [{
            template_id: 'student', group_id: 'group-1', name: '学生', installed: true,
            sections: [{ title: '身份', fields: [{ name: '称呼', values: [{ value: '子安', source: '手动' }] }] }],
          }],
        };
      }
      if (channel === 'recall.assets.list') return { ok: true, assets: [] };
      if (channel === 'personalOntology.groups.list') return { ok: true, groups: [] };
      if (channel === 'personalOntology.candidates.list') return { ok: true, candidates: [] };
      if (channel === 'personalOntology.groups.read') return { ok: true, content: '# 学生\n\n## 身份\n\n### 称呼\n\n- 子安 [手动]\n' };
      if (channel === 'projects.list') return { ok: true, projects: [] };
      return { ok: true };
    });
    let confirmed = false;
    const uiConfirm = vi.fn(async () => confirmed);
    const { sandbox, elements, uiToast } = loadPersonalOntology(invoke, { uiConfirm });
    const nav = elements.get('personal-onto-nav') as any;
    const bodyEl = elements.get('personal-onto-main-body') as any;
    const templateRow = ctrl({ 'data-poc-nav': 'template', 'data-poc-id': 'group-1' });
    nav.querySelectorAll = (selector: string) => (selector === '[data-poc-nav]' ? [templateRow] : []);
    const removeBtn = ctrl({
      'data-poc-group-action': 'field-remove-value', 'data-poc-ref': 'group-1::身份',
      'data-poc-field': '称呼', 'data-poc-value': '子安',
    });
    bodyEl.querySelectorAll = (selector: string) => (selector === '[data-poc-group-action]' ? [removeBtn] : []);

    await sandbox.window.renderPersonalOntology();
    await settleBackgroundWork();
    await templateRow.listeners.get('click')({ stopPropagation() {} });
    await settleBackgroundWork();
    expect(elements.get('personal-onto-main-body')?.innerHTML).toContain('子安');

    // 确认拒绝 → 不发 removeValue
    const click = removeBtn.listeners.get('click');
    expect(click).toBeTypeOf('function');
    await click();
    await settleBackgroundWork();
    expect(uiConfirm).toHaveBeenCalledWith({ message: '删除字段值「子安」？' });
    expect(invoke).not.toHaveBeenCalledWith('personalOntology.groups.fields.removeValue', expect.anything());

    // 确认同意 → 才发 removeValue（确认在前，未被绕过）
    confirmed = true;
    await click();
    await settleBackgroundWork();
    expect(invoke).toHaveBeenCalledWith('personalOntology.groups.fields.removeValue', {
      groupId: 'group-1::身份', fieldName: '称呼', value: '子安',
    });
    expect(uiToast).toHaveBeenCalledWith('已删除', { variant: 'success' });
  });

  it('T022 模板组在组管理区没有删除入口（_pocLoadGroups 过滤 template_id，删除按钮只属于普通组）', async () => {
    const invoke = vi.fn(async (channel: string, payload?: any) => {
      if (channel === 'personalOntology.templates.list') return { ok: true, templates: [] };
      if (channel === 'recall.assets.list') return { ok: true, assets: [] };
      if (channel === 'personalOntology.groups.list') {
        return {
          ok: true,
          groups: [
            { group_id: 'grp-n', title: '普通组', rel_path: 'n.md', created_at: '', updated_at: '' },
            // 模板组：meta 带 template_id——主进程 deleteGroup 对它返回 role_template_group
            { group_id: 'grp-tpl', title: '学生模板组', template_id: 'student', rel_path: 't.md', created_at: '', updated_at: '' },
          ],
        };
      }
      if (channel === 'personalOntology.candidates.list') return { ok: true, candidates: [] };
      if (channel === 'personalOntology.conflicts.list') return { ok: true, conflicts: [] };
      if (channel === 'personalOntology.groups.fields.list') return { ok: true, fields: [] };
      if (channel === 'personalOntology.groups.read') return { ok: true, content: '' };
      return { ok: true };
    });
    const { sandbox, elements } = loadPersonalOntology(invoke);
    const nav = elements.get('personal-onto-nav') as any;
    const tboxRow = ctrl({ 'data-poc-nav': 'tbox', 'data-poc-id': 'tbox' });
    nav.querySelectorAll = (selector: string) => (selector === '[data-poc-nav]' ? [tboxRow] : []);

    await sandbox.window.renderPersonalOntology();
    await settleBackgroundWork();
    await tboxRow.listeners.get('click')({ stopPropagation() {} });
    await settleBackgroundWork();

    const body = elements.get('personal-onto-main-body')?.innerHTML || '';
    // 普通组：组卡与删除入口在
    expect(body).toContain('普通组');
    expect(body).toContain('data-poc-group-op="delete-group"');
    expect(body).toContain('data-poc-gid="grp-n"');
    // 模板组：整个组管理区不出现（无组卡、无删除按钮）——提前禁用的最强形式
    // 是「没有入口」，主进程 role_template_group 只是兜底。
    expect(body).not.toContain('grp-tpl');
    expect(body).not.toContain('学生模板组');
    // 过滤机制钉住（防止后续重构把 template_id 组放回组卡区）
    expect(ontology).toContain('!g.template_id');
  });

  it('T022 删除确认文案四语如实：后果 + 恢复路径，不再出现「不可恢复」式假承诺', () => {
    const tables = ['zh', 'en', 'ja', 'pt'].map((name) => JSON.parse(
      readFileSync(resolve(root, `src/renderer/locales/${name}.json`), 'utf8'),
    ) as Record<string, string>);
    const KEY = 'personalOntology.group_delete_confirm';
    for (const table of tables) {
      const message = table[KEY];
      expect(typeof message).toBe('string');
      // 旧假承诺词形（四语）一律不得再出现
      expect(message).not.toMatch(/不可恢复|permanently|復元できません|permanentemente/i);
      // 恢复路径要如实指向本机保留的历史快照
      expect(message.length).toBeGreaterThan(20);
    }
    expect(tables[0][KEY]).toContain('历史快照保留在本机');
    expect(tables[1][KEY]).toContain('snapshots stay on this device');
    expect(tables[2][KEY]).toContain('この端末に残り');
    expect(tables[3][KEY]).toContain('permanecem neste dispositivo');

    // T023 台账词条四语齐全（动态拼键扫不到 i18n 覆盖门禁，这里自己钉住）
    const auditKeys = [
      'personalOntology.history_audit_actor_user',
      'personalOntology.history_audit_action_value_add',
      'personalOntology.history_audit_action_value_edit',
      'personalOntology.history_audit_action_value_remove',
      'personalOntology.history_audit_action_field_remove',
      'personalOntology.history_audit_action_entry_promote',
      'personalOntology.history_audit_action_group_rename',
      'personalOntology.history_audit_action_group_delete',
      'personalOntology.history_audit_action_snapshot_restore',
    ];
    for (const table of tables) {
      for (const key of auditKeys) {
        expect(table[key], `missing ${key}`).toBeTruthy();
      }
    }
  });
});

describe('personal ontology shared-control convergence (US-105 T040/T041)', () => {
  it('T040/T041 源内零残留：ca-chip 与私产状态点类名不再出现，标记全走共享 seam', () => {
    // 验收口径：grep ca-chip / personal-onto-status-dot 于 personal-ontology.js 无输出
    expect(ontology).not.toContain('ca-chip');
    expect(ontology).not.toContain('personal-onto-status-dot');
    // 不新增裸控件：三类标记均经共享 ui-status.js 的 <span> 工厂
    expect(ontology).toContain('window.uiTag');
    expect(ontology).toContain('window.uiStatusPill');
    expect(ontology).toContain('window.uiStatusDot');
  });

  it('T040/T041 状态语义不丢：值行状态点与展开标记的色调映射仍可辨（绿/琥珀/红）', async () => {
    const invoke = vi.fn(async (channel: string, payload?: any) => {
      if (channel === 'personalOntology.templates.list') return { ok: true, templates: [] };
      if (channel === 'recall.assets.list') return { ok: true, assets: [] };
      if (channel === 'personalOntology.groups.list') {
        return { ok: true, groups: [{ group_id: 'grp-c', title: '基本情况', rel_path: 'g.md', created_at: '', updated_at: '' }] };
      }
      if (channel === 'personalOntology.candidates.list') return { ok: true, candidates: [] };
      if (channel === 'personalOntology.groups.fields.list' && payload && payload.groupId === 'grp-c') {
        return {
          ok: true,
          fields: [{
            name: '居住地',
            values: [
              { value: '常住北京', source: '手动', verified: false },            // 命中冲突 → 红
              { value: '常住上海', source: '手动', sensitivity: 'restricted' },  // 受限 → 琥珀
              { value: '常用邮箱', source: '手动', verified: true },             // 已核实 → 绿
            ],
          }],
        };
      }
      if (channel === 'personalOntology.groups.read') {
        return { ok: true, content: '# 基本情况\n\n## 字段区\n\n### 居住地\n\n- 常用邮箱 [手动]\n' };
      }
      if (channel === 'personalOntology.conflicts.list') {
        return { ok: true, conflicts: [{ conflict_id: 'oc-c1', group_id: 'grp-c', field: '居住地', value_a: '常住北京', value_b: '外地', detected_at: '', status: 'open' }] };
      }
      return { ok: true };
    });
    const { sandbox, elements } = loadPersonalOntology(invoke);

    await sandbox.window.renderPersonalOntology();
    await settleBackgroundWork();

    // 默认值行：共享状态点三色调并存（冲突 critical > 受限 attention > 核实 success），旧类名零残留
    const body = elements.get('personal-onto-main-body')?.innerHTML || '';
    expect(body).toContain('ui-status-dot--critical');
    expect(body).toContain('ui-status-dot--attention');
    expect(body).toContain('ui-status-dot--success');
    expect(body).not.toContain('personal-onto-status-dot');
    expect(body).not.toContain('ca-chip');

    // 展开受限值与已核实值：胶囊/标记的色调语义不丢（琥珀胶囊、绿 tag）
    const bodyEl = elements.get('personal-onto-main-body') as any;
    const rowFor = (value: string) => ({
      getAttribute: (name: string) => (name === 'data-poc-line-key' ? encodeURIComponent(`grp-c\u0001居住地\u0001${value}`) : null),
      addEventListener(event: string, handler: (...args: any[]) => any) { (this as any).listeners.set(event, handler); },
      listeners: new Map<string, (...args: any[]) => any>(),
    });
    const restrictedRow = rowFor('常住上海');
    const verifiedRow = rowFor('常用邮箱');
    bodyEl.querySelectorAll = (selector: string) => (selector === '[data-poc-line-key]' ? [restrictedRow, verifiedRow] : []);
    await sandbox.window.renderPersonalOntology();
    await settleBackgroundWork();
    await (restrictedRow.listeners.get('click') as any)({ stopPropagation() {} });
    await (verifiedRow.listeners.get('click') as any)({ stopPropagation() {} });
    await settleBackgroundWork();
    const expanded = elements.get('personal-onto-main-body')?.innerHTML || '';
    expect(expanded).toContain('ui-status-pill--attention'); // 受限·不自动注入 → 琥珀胶囊
    expect(expanded).toContain('ui-tag--success');           // 有来源支持 → 绿 tag
    expect(expanded).not.toContain('ca-chip');
  });
});
