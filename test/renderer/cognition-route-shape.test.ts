import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * router 白名单键形状（F-r4-3，2026-09-30 认知资产质检 R4）：
 *
 * store.route 的初始字面量（store 定义处）与 router.go 里 merged 的
 * Object.assign 模板是**手工双维护**的两份键清单——:1434 的
 * JSON.stringify(current) === JSON.stringify(merged) 相等性依赖两侧
 * 键集一致，只删/加一侧会使 same 恒 false，连点同一 tab 会堆积重复
 * 返回栈项。familyRename（随 849ec341 族命名功能删除后遗留）与
 * ontologyBox（自加入起从未有读写方）是两份清单里的死键，且已扩散进
 * 3 个测试夹具被当契约形状复制——本轮五处联动删除（零行为变化）。
 *
 * 这里钉两层：
 *  1. 行为级：连点同一 tab，第二次 go 必须命中 same 判定不再入栈
 *     （键集不一致时此断言红，正是「只删一侧」的事故形态）；
 *  2. 源码级：死键不得回流；初始键集必须是 merged 模板键集的子集
 *     （模板缺键会让 same 恒 false）。
 *
 * 已知相邻问题（甄别另立，不在此修）：merged 模板含 taskFailedOpen 而
 * 初始字面量没有——子集断言对它是放行的。
 */

const coreSource = readFileSync(
  resolve(__dirname, '../../src/renderer/modules/cognition-assets/core.js'),
  'utf8',
);

/** 抓两份键清单：route: { ... } 初始字面量 与 Object.assign({ ... }, target) 模板。 */
function routeKeySets(): { initial: string[]; merged: string[] } {
  const initialMatch = coreSource.match(/route:\s*\{([^}]*)\}/);
  const mergedMatch = coreSource.match(/Object\.assign\(\s*\{([^}]*)\},\s*target\)/);
  if (!initialMatch || !mergedMatch) throw new Error('route key literals not found');
  const keys = (body: string) => [...body.matchAll(/([A-Za-z]+):\s*(?:''|'tree')/g)].map((m) => m[1]);
  return { initial: keys(initialMatch[1]), merged: keys(mergedMatch[1]) };
}

const globalScope = globalThis as unknown as Record<string, unknown>;
const NS = (() => {
  const stub: Record<string, unknown> = {};
  globalScope.window = {
    CogAssets: stub,
    cogseed: { invoke: async () => ({ ok: true }) },
  };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../../src/renderer/modules/cognition-assets/core.js');
  return stub as unknown as {
    store: { route: Record<string, unknown>; backStack: Array<Record<string, unknown>> };
    router: { go: (next: Record<string, unknown>, options?: { replace?: boolean }) => void };
  };
})();

describe('router 白名单键形状（F-r4-3）', () => {
  it('死键 familyRename/ontologyBox 不得回流到 core.js', () => {
    expect(coreSource).not.toContain('familyRename');
    expect(coreSource).not.toContain('ontologyBox');
  });

  it('route 初始键集 ⊆ merged 模板键集（stringify 相等性的前提）', () => {
    const { initial, merged } = routeKeySets();
    // 解析失败会让门禁变成空断言——先证明确实读到了两份清单。
    expect(initial).toContain('name');
    expect(initial).toContain('manage');
    expect(merged).toContain('name');
    expect(merged).toContain('manage');
    const missing = initial.filter((key) => !merged.includes(key));
    expect(missing).toEqual([]);
  });

  it('连点同一 tab 只入栈一次：same 判定依赖的两侧键集一致（键集漂移即红）', () => {
    const tab = { name: 'overview', category: '' };
    NS.router.go(tab);
    // 第一次 go：与初始 route 不同，入栈一次。
    expect(NS.store.backStack).toHaveLength(1);
    // 第二次 go 同一 tab：store.route 已是 merged 形状（全键），再 merge
    // 同一 target 得到逐键相等的对象 → same=true → 不再入栈。两侧键集
    // 不一致（如只删一侧死键）时 same 恒 false，这里会红。
    NS.router.go(tab);
    expect(NS.store.backStack).toHaveLength(1);
    NS.router.go(tab);
    expect(NS.store.backStack).toHaveLength(1);
    // 目标真的变了才允许再入栈。
    NS.router.go({ name: 'review' });
    expect(NS.store.backStack).toHaveLength(2);
  });
});
