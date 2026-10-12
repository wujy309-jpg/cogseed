/**
 * 安装 Agent 前的「将同时安装」确认（产品第 2 条）。
 * 预览只是告知：预览失败不得挡住安装；被停用的依赖在下载前就说清楚；
 * 没有额外依赖时不多打扰用户一次。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

type Plan = { items: Array<{ id: string; name?: string; kind: string; action: string }>; readiness: string; appUpdateRequired: boolean; minAppVersion: string };

function load(invoke: (channel: string, payload: unknown) => Promise<unknown>, modalResult: string | null = 'install') {
  const code = fs.readFileSync(path.join(__dirname, '../../src/renderer/modules/marketplace.js'), 'utf8');
  const alerts: string[] = [];
  const modals: Array<{ title: string; bodyHtml: string }> = [];
  const strings: Record<string, string> = {
    'marketplace.agent_plan_title': 'TITLE',
    'marketplace.agent_plan_intro': 'INTRO {name}',
    'marketplace.agent_plan_hub': 'HUB',
    'marketplace.agent_plan_bundled': 'BUNDLED',
    'marketplace.agent_plan_reuse_intro': 'REUSE-INTRO',
    'marketplace.agent_plan_reuse': 'REUSED',
    'marketplace.agent_plan_safety': 'SAFETY',
    'marketplace.agent_plan_confirm': 'Install',
    'marketplace.agent_plan_blocked_intro': 'BLOCKED-INTRO',
    'marketplace.agent_plan_blocked_disabled': 'DISABLED',
    'marketplace.agent_plan_blocked_builtin': 'BUILTIN',
  };
  const context: any = {
    console,
    clearTimeout: () => {},
    setTimeout: () => 0,
    localStorage: { getItem: () => null, setItem: () => {} },
    document: { hidden: false, addEventListener: () => {}, getElementById: () => null, querySelectorAll: () => [] },
    window: { addEventListener: () => {}, cogseed: { invoke } },
    escapeHtml: (v: string) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;'),
    uiAlert: async (m: string) => { alerts.push(m); },
    uiModal: async (opts: { title: string; bodyHtml: string }) => { modals.push(opts); return modalResult === null ? { value: undefined, reason: 'dismiss' } : { value: modalResult }; },
    t: (key: string) => strings[key] ?? key,
    _alerts: alerts,
    _modals: modals,
  };
  vm.createContext(context);
  vm.runInContext(code, context, { filename: 'marketplace.js' });
  return context;
}

const item = { id: 'abcdef123456', name: '发票识别报销助手', version: '1.0.0', published_at: 1, updated_at: 2 };
const plan = (items: Plan['items'], over: Partial<Plan> = {}): Plan => ({ items, readiness: 'deps_blocked', appUpdateRequired: false, minAppVersion: '', ...over });

describe('Agent 安装前确认', () => {
  it('有要一起装的依赖：列出 Hub 技能与随包技能，并说明已有的会直接复用', async () => {
    const ctx = load(async () => plan([
      { id: 'a3f09c21b7e4', name: '依据材料作答', kind: 'hub', action: 'reuse' },
      { id: '5e1c8a02d9b3', name: '发票字段抽取', kind: 'hub', action: 'install' },
      { id: 'invoice-ocr', name: 'invoice-ocr', kind: 'bundled', action: 'bundled' },
    ]));
    expect(await vm.runInContext('_mpConfirmAgentInstall', ctx)(item)).toBe(true);
    const body = ctx._modals[0].bodyHtml as string;
    expect(body).toContain('发票字段抽取');
    expect(body).toContain('invoice-ocr');
    expect(body).toContain('依据材料作答');
    expect(body).toContain('HUB');
    expect(body).toContain('BUNDLED');
    expect(body).toContain('REUSE-INTRO');
    expect(body).toContain('SAFETY');
  });

  it('用户取消 → 不安装', async () => {
    const ctx = load(async () => plan([{ id: '5e1c8a02d9b3', name: 'x', kind: 'hub', action: 'install' }]), 'cancel');
    expect(await vm.runInContext('_mpConfirmAgentInstall', ctx)(item)).toBe(false);
  });

  it('关闭弹窗（无选择）→ 不安装', async () => {
    const ctx = load(async () => plan([{ id: '5e1c8a02d9b3', name: 'x', kind: 'hub', action: 'install' }]), null);
    expect(await vm.runInContext('_mpConfirmAgentInstall', ctx)(item)).toBe(false);
  });

  it('没有额外依赖（全部复用或无依赖）：不弹确认，直接继续', async () => {
    const ctx = load(async () => plan([{ id: 'a3f09c21b7e4', kind: 'hub', action: 'reuse' }], { readiness: 'ready' }));
    expect(await vm.runInContext('_mpConfirmAgentInstall', ctx)(item)).toBe(true);
    expect(ctx._modals).toEqual([]);
  });

  it('依赖已被停用：下载前就说清楚原因并停止，不弹确认', async () => {
    const ctx = load(async () => plan([{ id: '9b27f4a1c0e6', name: '报销制度预检', kind: 'hub', action: 'blocked_disabled' }]));
    expect(await vm.runInContext('_mpConfirmAgentInstall', ctx)(item)).toBe(false);
    expect(ctx._alerts[0]).toContain('BLOCKED-INTRO');
    expect(ctx._alerts[0]).toContain('报销制度预检');
    expect(ctx._alerts[0]).toContain('DISABLED');
    expect(ctx._modals).toEqual([]);
  });

  it('引用内置能力（本期不支持）：说明原因并停止', async () => {
    const ctx = load(async () => plan([{ id: 'builtin:x', kind: 'builtin', action: 'blocked_builtin_unsupported' }]));
    expect(await vm.runInContext('_mpConfirmAgentInstall', ctx)(item)).toBe(false);
    expect(ctx._alerts[0]).toContain('BUILTIN');
  });

  it('预览失败或返回异常：不挡安装（安装路径自带检查）', async () => {
    expect(await vm.runInContext('_mpConfirmAgentInstall', load(async () => { throw new Error('offline'); }))(item)).toBe(true);
    expect(await vm.runInContext('_mpConfirmAgentInstall', load(async () => ({ nope: true })))(item)).toBe(true);
    expect(await vm.runInContext('_mpConfirmAgentInstall', load(async () => null))(item)).toBe(true);
  });

  it('客户端版本过低：交给安装路径给出本地化提示，这里不重复也不弹窗', async () => {
    const ctx = load(async () => plan([{ id: '5e1c8a02d9b3', kind: 'hub', action: 'install' }], { appUpdateRequired: true, minAppVersion: '1.4.0' }));
    expect(await vm.runInContext('_mpConfirmAgentInstall', ctx)(item)).toBe(true);
    expect(ctx._modals).toEqual([]);
    expect(ctx._alerts).toEqual([]);
  });

  it('名称里的 HTML 被转义，不会注入确认框', async () => {
    const ctx = load(async () => plan([{ id: 'x', name: '<img src=x onerror=alert(1)>', kind: 'hub', action: 'install' }]));
    await vm.runInContext('_mpConfirmAgentInstall', ctx)(item);
    expect(ctx._modals[0].bodyHtml).not.toContain('<img');
    expect(ctx._modals[0].bodyHtml).toContain('&lt;img');
  });

  it('请求预览时带上 Agent 的版本信息', async () => {
    const invoke = vi.fn(async () => plan([]));
    const ctx = load(invoke);
    await vm.runInContext('_mpConfirmAgentInstall', ctx)(item);
    expect(invoke).toHaveBeenCalledWith('marketplace.agentInstallPlan', expect.objectContaining({ id: 'abcdef123456', version: '1.0.0', published_at: 1, updated_at: 2 }));
  });
});
