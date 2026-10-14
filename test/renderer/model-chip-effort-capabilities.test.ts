/**
 * 推理强度 Option C —— 渲染层按模型声明的档位暴露（菜单只列支持的）。
 *
 * 渲染层没有模块系统，沿用 `marketplace-card-states.test.ts` 的 vm 装载法：脚本
 * 顶层的函数声明即上下文属性，`let`/`const` 绑定用 `runInContext` 读写。
 * 数据源与后端 preflight 同一份（auth.listModels 的 reasoningLevels），所以这里
 * 断言菜单选项集合而不是某段 HTML。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vm from 'node:vm';

import { describe, expect, it } from 'vitest';

interface InvokeCall { channel: string; payload: unknown }

function loadModelChip(): any {
  const src = fs.readFileSync(
    path.join(__dirname, '../../src/renderer/modules/model-chip.js'), 'utf8',
  );
  const calls: InvokeCall[] = [];
  const context: any = {
    console,
    setTimeout: () => 0,
    clearTimeout: () => {},
    createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
    t: (key: string) => key,
    escapeHtml: (v: unknown) => String(v ?? ''),
    document: { querySelector: () => null, createElement: () => ({ addEventListener: () => {} }) },
    window: { addEventListener: () => {}, cogseed: { invoke: async () => ({}) } },
    __calls: calls,
  };
  vm.createContext(context);
  vm.runInContext(src, context, { filename: 'model-chip.js' });
  context.window.cogseed.invoke = async (channel: string, payload: unknown) => {
    calls.push({ channel, payload });
    return context.__invokeResult ? context.__invokeResult(channel, payload) : {};
  };
  return context;
}

function setEntries(ctx: any, entries: unknown[]): void {
  ctx.__entries = entries;
  vm.runInContext('_modelChipEntries = globalThis.__entries', ctx);
}

describe('exec-config chip — Option C 档位按模型声明暴露', () => {
  it('没有声明时只给 Auto（不再靠模型名正则猜）', async () => {
    const ctx = loadModelChip();
    ctx.__invokeResult = () => ({ ok: true, models: [] });
    setEntries(ctx, [{ provider: 'p1', model: 'deepseek-v4-pro' }]);

    await ctx._prefetchReasoningForEntries(true);

    expect(ctx._modelEffortOptionsFor('p1', 'deepseek-v4-pro')).toEqual(['auto']);
  });

  it('⭐ 只列声明支持的档位：声明 low 时没有 High', async () => {
    const ctx = loadModelChip();
    ctx.__invokeResult = () => ({
      ok: true,
      models: [{ id: 'model-a', reasoning: true, reasoningLevels: ['low'] }],
    });
    setEntries(ctx, [{ provider: 'p1', model: 'model-a' }]);

    await ctx._prefetchReasoningForEntries(true);

    const options = ctx._modelEffortOptionsFor('p1', 'model-a');
    expect(options).toContain('auto');
    expect(options).toContain('low');
    expect(options).not.toContain('high');
  });

  it('声明 off+high 时 low 不出现，且顺序固定', async () => {
    const ctx = loadModelChip();
    ctx.__invokeResult = () => ({
      ok: true,
      models: [{ id: 'model-b', reasoning: true, reasoningLevels: ['high', 'off'] }],
    });
    setEntries(ctx, [{ provider: 'p1', model: 'model-b' }]);

    await ctx._prefetchReasoningForEntries(true);

    expect(ctx._modelEffortOptionsFor('p1', 'model-b')).toEqual(['auto', 'off', 'high']);
  });

  it('provider 之间互不串档', async () => {
    const ctx = loadModelChip();
    ctx.__invokeResult = (channel: string, payload: any) => (
      payload?.provider === 'p1'
        ? { ok: true, models: [{ id: 'm', reasoning: true, reasoningLevels: ['low'] }] }
        : { ok: true, models: [{ id: 'm', reasoning: true, reasoningLevels: ['high'] }] }
    );
    setEntries(ctx, [{ provider: 'p1', model: 'm' }, { provider: 'p2', model: 'm' }]);

    await ctx._prefetchReasoningForEntries(true);

    expect(ctx._modelEffortOptionsFor('p1', 'm')).toEqual(['auto', 'low']);
    expect(ctx._modelEffortOptionsFor('p2', 'm')).toEqual(['auto', 'high']);
  });
});

describe('exec-config chip — 选择持久化到该模型设置', () => {
  it('点选档位写回该模型（prefs.setModelThinkingLevel）', async () => {
    const ctx = loadModelChip();
    ctx._effectiveExecConfig = () => ({ provider: 'cp:a', model: 'm1' });
    ctx.setExecOverride = () => {};
    ctx._modelChipRenderAll = () => {};

    ctx._setTaskEffort('conversation', 'high');

    const write = ctx.__calls.find((c: InvokeCall) => c.channel === 'prefs.setModelThinkingLevel');
    expect(write).toBeTruthy();
    expect(write.payload).toEqual({ provider: 'cp:a', model: 'm1', level: 'high' });
  });

  it('Auto 清除该模型的记录（写 auto，不写假档位）', async () => {
    const ctx = loadModelChip();
    ctx._effectiveExecConfig = () => ({ provider: 'cp:a', model: 'm1' });
    ctx.setExecOverride = () => {};
    ctx._modelChipRenderAll = () => {};

    ctx._setTaskEffort('conversation', 'auto');

    const write = ctx.__calls.find((c: InvokeCall) => c.channel === 'prefs.setModelThinkingLevel');
    expect(write.payload.level).toBe('auto');
  });

  it('⭐ 切模型回落 Auto：新模型没有持久化记录时清掉 override 的 effort', () => {
    const ctx = loadModelChip();
    const overrides: any[] = [];
    ctx.getChatRecipient = () => ({ kind: 'agent', id: 'a1' });
    ctx.getExecOverride = () => ({ effort: 'high', model: 'old' });
    ctx.setExecOverride = (_target: string, value: any) => overrides.push(value);
    ctx._modelChipRenderAll = () => {};

    ctx._applyModelPick('conversation', {}, 'cp:a', 'new-model', 'New', 'A');

    expect(overrides).toHaveLength(1);
    expect(overrides[0].effort).toBeUndefined();
    expect(overrides[0].model).toBe('new-model');
  });

  it('⭐ 切回有持久化记录的模型时恢复该模型的档位', async () => {
    const ctx = loadModelChip();
    ctx.__invokeResult = () => ({ levels: { 'cp:a\u0000saved': 'high' } });
    await ctx.refreshModelChipModelEffort();
    const overrides: any[] = [];
    ctx.getChatRecipient = () => ({ kind: 'agent', id: 'a1' });
    ctx.getExecOverride = () => ({ effort: 'low', model: 'other' });
    ctx.setExecOverride = (_target: string, value: any) => overrides.push(value);
    ctx._modelChipRenderAll = () => {};

    ctx._applyModelPick('conversation', {}, 'cp:a', 'saved', 'Saved', 'A');

    expect(overrides[0].effort).toBe('high');
  });
});
