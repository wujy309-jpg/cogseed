/**
 * 探针 r7（边界测试员 · 本遍循环第 2 轮）→ 主题：IPC 往返乱序（渲染层双态加载器）。
 *
 * 疑点（读码推演，core.js:708-731 loadTags）：
 * - app.js:918-926 的 onChange 在 tagOverlay==='manage' 时**同 tick 背靠背双发**：
 *   `loadTags()`（active-only）+ `loadTags({ includeRetired: true })`（管理弹层）。
 * - loadTags 的响应落地（core.js:729）**无条件覆盖** store.tags，不带「本次请求
 *   参数是否仍是最新意图」的守卫——对比同文件 :885（loadAssetVersions 的
 *   `store.assetVersions.assetId !== id` return）与 :909（loadAssetTimeline 同款），
 *   唯独这个带参数二态（includeRetired true/false）的加载器没有往返乱序防护。
 * - 乱序危害：active-only 响应后到时把含 retired 的结果整体覆盖——管理弹层
 *   打开期间 retired 标签消失，store.includeRetired 回落 false；自愈依赖下一次
 *   onChange 重拉（:712 守卫对 includeRetired=false 的 state 不再放行 active
 *   调用，但 :924 的 retired 调用会重拉）。
 * - 触发概率评估：retired 查询是超集，常态下更慢、后到覆盖无害；乱序只在
 *   active 查询恰好慢于 retired 查询（调度/缓存错位）时发生——机制真实、
 *   窗口罕见，故本探针只坐实机制，判定交甄别（pending）。
 *
 * 手法：vm 沙箱装载真实 core.js（cognition-renderer 既有助手），stub
 * window.cogseed.invoke 用手动 deferred 控制 two 个往返的完成序：active-only
 * 挂起 → includeRetired 先回 → 放行 active-only 后回。复刻 app.js:922-924 的
 * 同 tick 双发顺序。
 *
 * 收尾状态（2026-10-01 记账员）：对应待议 **P-r2-45**。
 * 【2026-10-02 拍板修复启用（wo-b6-lock-renderer）】：拍板=落地前接管检查
 * （进入置 in-flight 对象、落地前 store.tags!==inFlight 则本次响应作废，对齐
 * 同文件 loadAssetVersions/loadAssetTimeline 的落地前身份检查先例）。主用例
 * 断言已反转：迟到的 active-only 响应不再覆盖新意图（includeRetired=true 与
 * retired-tag 保留）。对照组（无竞态/串行序时链路正常）不依赖漏洞，保留 active。
 */
import { describe, it, expect } from 'vitest';
import { loadCognitionAssets } from '../renderer/helpers/cognition-renderer';

describe('probe r7 › loadTags includeRetired 双态的 IPC 往返乱序：后到的旧响应覆盖新意图', () => {
  it('【P-r2-45 已修】同 tick 双发（复刻 app.js:922-924），active-only 后到不再覆盖——弹层期间 retired 保留', async () => {
    let resolveActiveOnly: ((value: unknown) => void) | undefined;
    const activeOnlyTrip = new Promise<unknown>((resolve) => { resolveActiveOnly = resolve; });
    const invokeCalls: Array<Record<string, unknown>> = [];
    const { ns, store } = loadCognitionAssets({}, {}, {
      cogseed: {
        invoke: async (_channel: string, payload: Record<string, unknown>) => {
          invokeCalls.push({ ...payload });
          if (payload && payload.includeRetired) {
            // retired 超集查询先完成（乱序注入点）
            return { ok: true, tags: [{ name: 'active-tag' }, { name: 'retired-tag', retired: true }] };
          }
          // active-only 查询在途挂起
          return activeOnlyTrip;
        },
      },
    });

    // 复刻 app.js 的同 tick 双发：先 active-only，后 includeRetired。
    const first = ns.loadTags();
    const second = ns.loadTags({ includeRetired: true });
    await second; // retired 响应先落地
    expect(store.tags.loading).toBe(false);
    expect(store.tags.includeRetired).toBe(true);
    expect(store.tags.items.map((t: { name: string }) => t.name)).toContain('retired-tag');
    expect(invokeCalls.length).toBe(2); // 两次请求都真实发出（未被守卫吞掉）

    // 迟到的 active-only 响应到达：落地前接管检查作废本次响应——最新意图
    // 仍是 includeRetired=true（管理弹层在开），不再无条件覆盖。
    resolveActiveOnly!({ ok: true, tags: [{ name: 'active-tag' }] });
    await first;

    // 修复后断言（反转）：新意图保留，retired 标签不消失。
    expect(store.tags.includeRetired).toBe(true);
    expect(store.tags.items.map((t: { name: string }) => t.name)).toEqual(['active-tag', 'retired-tag']);
    expect(store.tags.items.map((t: { name: string }) => t.name)).toContain('retired-tag');
  });

  it('对照组：正常序（active-only 先回）最终态正确——retired 覆盖生效', async () => {
    const { ns, store } = loadCognitionAssets({}, {}, {
      cogseed: {
        invoke: async (_channel: string, payload: Record<string, unknown>) => ({
          ok: true,
          tags: payload && payload.includeRetired
            ? [{ name: 'active-tag' }, { name: 'retired-tag', retired: true }]
            : [{ name: 'active-tag' }],
        }),
      },
    });
    await ns.loadTags();
    await ns.loadTags({ includeRetired: true });
    expect(store.tags.includeRetired).toBe(true);
    expect(store.tags.items.map((t: { name: string }) => t.name)).toContain('retired-tag');
  });
});
