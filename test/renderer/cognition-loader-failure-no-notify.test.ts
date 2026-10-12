import { describe, expect, it } from 'vitest';

/**
 * 经验/失败面通道的「失败自重试死循环」断环回归（P-r2-21 / P-r1-54 /
 * P-r1-56，预审决策卡组 4「失败不 notify——保留自愈自重试，零 UI 改动」）。
 *
 * 环的构成（修前）：按需 loader 的守卫放行失败态（有意设计）+ 装载尾部
 * 无条件 notify × onChange 钩子看到 failed 就补拉 → 「失败→重画→再拉」
 * 自激死循环（探针实测 2 秒自续 10001 次 IPC）。修法只掐环的后一半：
 * 失败路径不再 notify；成功路径照常 notify。自愈自重试必须保留——下一次
 * 任意 notify（用户操作/其他区块成功）经钩子看到 failed 仍会重拉。
 *
 * 装配与 cognition-inbox-error-state.test.ts 同构：core.js 是 IIFE，require
 * 一次即挂 window.CogAssets，唯一 IPC 出口是 window.cogseed.invoke。
 */

const globalScope = globalThis as unknown as Record<string, unknown>;
type Invoke = (channel: string, payload: Record<string, unknown>) => Promise<unknown>;
let invokeImpl: Invoke = async () => ({ ok: true });
const ipcCounts = new Map<string, number>();
const invoke = (channel: string, payload: Record<string, unknown>) => {
  ipcCounts.set(channel, (ipcCounts.get(channel) || 0) + 1);
  return invokeImpl(channel, payload);
};
const count = (channel: string) => ipcCounts.get(channel) || 0;

const NS = (() => {
  const stub: Record<string, unknown> = {};
  globalScope.window = {
    CogAssets: stub,
    cogseed: { invoke },
  };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../../src/renderer/modules/cognition-assets/core.js');
  return stub as unknown as {
    store: Record<string, unknown>;
    notify: () => void;
    onChange: (fn: () => void) => () => void;
    loadExperiences: (force?: boolean) => Promise<void>;
    loadExperienceDetail: (id: string, force?: boolean) => Promise<void>;
    loadImprovementOutcomes: (force?: boolean) => Promise<void>;
    loadKstarFailures: (force?: boolean) => Promise<void>;
  };
})();

async function settle() {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 10));
}

describe('组4：经验/失败面通道失败不 notify（P-r2-21 / P-r1-54）', () => {
  it('标签加载器已退役，重绘不请求标签库', async () => {
    expect((NS as unknown as Record<string, unknown>).loadTags).toBeUndefined();
    const before = count('recall.tags.list');
    NS.notify();
    await settle();
    expect(count('recall.tags.list')).toBe(before);
  });

  it('loadExperiences 失败：失败尾部不 notify（app.js 钩子每帧补拉的环被掐断）', async () => {
    let notifies = 0;
    const off = NS.onChange(() => { notifies += 1; });
    invokeImpl = async (channel) => (channel === 'recall.experiences.list'
      ? { ok: false, error: 'experiences unreadable', code: 'E_IO' }
      : { ok: true });
    const before = notifies;
    await NS.loadExperiences();
    await settle();
    expect(NS.store.experiences).toMatchObject({ loading: false, failed: true });
    expect(notifies).toBe(before + 1);
    off();
  });

  it('loadExperienceDetail 失败：失败尾部不 notify（详情路由补拉环被掐断）', async () => {
    let notifies = 0;
    const off = NS.onChange(() => { notifies += 1; });
    invokeImpl = async (channel) => (channel === 'recall.experiences.read'
      ? { ok: false, error: 'experience unreadable', code: 'E_IO' }
      : { ok: true });
    const before = notifies;
    await NS.loadExperienceDetail('exp-loop');
    await settle();
    expect(NS.store.experienceDetail).toMatchObject({ experienceId: 'exp-loop', loading: false, failed: true });
    expect(notifies).toBe(before + 1);
    off();
  });
});
