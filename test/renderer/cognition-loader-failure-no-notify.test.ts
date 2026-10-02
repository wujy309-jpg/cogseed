import { describe, expect, it } from 'vitest';

/**
 * 经验/标签/失败面通道的「失败自重试死循环」断环回归（P-r2-21 / P-r1-54 /
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
    loadTags: (options?: { force?: boolean }) => Promise<void>;
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

describe('组4：经验/标签/失败面通道失败不 notify（P-r2-21 / P-r1-54）', () => {
  it('loadTags 失败：只发起始 notify、显式记 failed；成功路径仍两次 notify（回归）', async () => {
    let notifies = 0;
    const off = NS.onChange(() => { notifies += 1; });
    invokeImpl = async (channel) => (channel === 'recall.tags.list'
      ? { ok: false, error: 'tags unreadable', code: 'E_IO' }
      : { ok: true });
    const before = notifies;
    await NS.loadTags();
    await settle();
    expect(NS.store.tags).toMatchObject({ loading: false, failed: true });
    expect(notifies).toBe(before + 1); // 修前：失败尾部再 notify = before+2（环的一环）
    // 自愈保留：失败态不被守卫冻结，下一次调用（无 force）能重拉。
    invokeImpl = async () => ({ ok: true, tags: [{ id: 't1' }] });
    await NS.loadTags();
    await settle();
    expect(NS.store.tags).toMatchObject({ loading: false, failed: false });
    expect(notifies).toBe(before + 3); // 成功路径：起始 + 结束两次 notify 照常
    off();
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

  it('loadKstarFailures 失败：activity 路由下 IPC 恰发一次（修前自激成环、探针实测 10001 次）；外部 notify 后自愈重拉', async () => {
    // 复刻真实触发链：route=activity + improvementOutcomes 健康且含失败类结论
    // → core.js 的 onChange 钩子在每次 notify 后看到 kstarFailures.failed 就补拉。
    NS.store.route = { name: 'activity' };
    NS.store.improvementOutcomes = {
      items: [{ conclusion: 'analysis_failed', episodeId: 'kse-1' }],
      loading: false, failed: false, stale: false,
    };
    NS.store.kstarFailures = null;
    ipcCounts.delete('kstar.failures.list');
    invokeImpl = async (channel) => (channel === 'kstar.failures.list'
      ? { ok: false, error: 'failures unreadable', code: 'E_IO' }
      : { ok: true });
    await NS.loadKstarFailures();
    await settle();
    expect(NS.store.kstarFailures).toMatchObject({ loading: false, failed: true });
    expect(count('kstar.failures.list')).toBe(1); // 修前：notify→钩子→再拉→notify… 计数持续增长
    // 自愈自重试保留：下一次任意 notify（用户操作/其他区块成功）经钩子重拉一次。
    NS.notify();
    await settle();
    expect(count('kstar.failures.list')).toBe(2);
    NS.notify();
    await settle();
    expect(count('kstar.failures.list')).toBe(3); // 每次 notify 至多补拉一次，不再自激
    // 成功路径照常 notify：清 failed 后钩子不再补拉。
    invokeImpl = async () => ({ ok: true, failures: [{ id: 'f1' }] });
    NS.notify();
    await settle();
    expect(NS.store.kstarFailures).toMatchObject({ loading: false, failed: false });
    const settled = count('kstar.failures.list');
    await settle();
    expect(count('kstar.failures.list')).toBe(settled); // 健康态不再补拉
    NS.store.route = { name: 'tree' };
  });

  it('P-r2-21 另半边：loadImprovementOutcomes 失败后守卫放行重拉（修前判重挡死、无恢复路径）', async () => {
    NS.store.route = { name: 'activity' };
    NS.store.improvementOutcomes = null;
    NS.store.kstarFailures = null;
    ipcCounts.delete('kstar.improvement.outcomes.list');
    invokeImpl = async (channel) => (channel === 'kstar.improvement.outcomes.list'
      ? { ok: false, error: 'outcomes unreadable', code: 'E_IO' }
      : { ok: true });
    await NS.loadImprovementOutcomes();
    await settle();
    expect(NS.store.improvementOutcomes).toMatchObject({ loading: false, failed: true });
    expect(count('kstar.improvement.outcomes.list')).toBe(1);
    // 修前：守卫只认 stale（失败时 stale=false），钩子的补拉被判重挡死 → 恒为 1。
    NS.notify();
    await settle();
    expect(count('kstar.improvement.outcomes.list')).toBe(2);
    NS.store.route = { name: 'tree' };
  });
});
