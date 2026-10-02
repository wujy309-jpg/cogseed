/**
 * 判定→池 总装线测试（S3-d）：proposed 进池带次候选、unclassified 进未分类
 * 暂存、确定性+applyDeterministic 直接落库、未分类选家/丢弃出口。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

vi.mock('../../../../src/main/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

let tmpDir: string;
let prevWs: string | undefined;
const UID = 'test-user-001';

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cogseed-ck-pipe-'));
  prevWs = process.env.COGSEED_WORKSPACE_ROOT;
  process.env.COGSEED_WORKSPACE_ROOT = tmpDir;
  vi.resetModules();
});

afterEach(() => {
  process.env.COGSEED_WORKSPACE_ROOT = prevWs;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function mods() {
  return Promise.all([
    import('../../../../src/main/features/cognition_kernel/pipeline'),
    import('../../../../src/main/features/cognition_kernel/pool'),
    import('../../../../src/main/features/cognition_kernel/store'),
  ]).then(([pipeline, pool, store]) => ({ pipeline, pool, store }));
}

function llmRunner(reply: string) {
  return (async () => ({ runner: { runReflection: async () => reply } })) as never;
}

describe('cognition_kernel/pipeline — routeAndSubmit', () => {
  it('模型判定 → 池 pending，次候选记 alternatives', async () => {
    const { pipeline, pool } = await mods();
    const r = await pipeline.routeAndSubmit(UID, { statement: '我不吃辣' }, {
      judge: { buildRunnerFn: llmRunner('{"candidates":[{"home":"personal_fact","confidence":0.7},{"home":"rule","confidence":0.6}],"reason":"两可"}'), ontologyContextFn: async () => '（空）' },
    });
    expect(r.judgement.outcome).toBe('proposed');
    expect(r.poolItemId).toBeTruthy();
    const item = pool.loadPoolSync(UID).items.find((i) => i.id === r.poolItemId);
    expect(item?.status).toBe('pending');
    expect(item?.alternatives).toEqual([{ home: 'rule', confidence: 0.6 }]);
    expect(item?.delta.target.home).toBe('personal_fact');
  });

  it('空候选 → 未分类暂存；选家后转池内提议；丢弃直接清掉', async () => {
    const { pipeline, pool } = await mods();
    const r = await pipeline.routeAndSubmit(UID, { statement: '今天天气不错' }, {
      judge: { buildRunnerFn: llmRunner('{"candidates":[],"reason":"闲聊"}'), ontologyContextFn: async () => '（空）' },
    });
    expect(r.judgement.outcome).toBe('unclassified');
    expect(r.unroutedId).toBeTruthy();
    expect(pool.listUnrouted(UID)).toHaveLength(1);

    const routed = await pool.decideUnrouted(UID, r.unroutedId as string, { routeHome: 'personal_fact' });
    expect(routed.ok).toBe(true);
    expect(routed.poolItemId).toBeTruthy();
    expect(pool.listUnrouted(UID)).toHaveLength(0);
    const item = pool.loadPoolSync(UID).items.find((i) => i.id === routed.poolItemId);
    expect(item?.delta.target.home).toBe('personal_fact');
    expect(item?.status).toBe('pending');

    const r2 = await pipeline.routeAndSubmit(UID, { statement: '在吗' }, {
      judge: { buildRunnerFn: llmRunner('{"candidates":[],"reason":"问候"}'), ontologyContextFn: async () => '（空）' },
    });
    const discard = await pool.decideUnrouted(UID, r2.unroutedId as string, { discard: true });
    expect(discard.ok).toBe(true);
    expect(pool.listUnrouted(UID)).toHaveLength(0);
  });

  it('确定性 + applyDeterministic → 直接落库不进池（用户显式回答路径）', async () => {
    const { pipeline, pool, store } = await mods();
    const r = await pipeline.routeAndSubmit(
      UID,
      { statement: '我的银行卡号是6222…1234', explicitHome: 'personal_fact', fieldName: '银行卡号' },
      { applyDeterministic: true },
    );
    expect(r.judgement.outcome).toBe('deterministic');
    expect(r.appliedCount).toBe(1);
    expect(pool.loadPoolSync(UID).items).toHaveLength(0);
    const doc = store.loadCognitionStoreSync(UID);
    expect(Object.values(doc.objects)[0].statement).toContain('6222');
  });

  it('确定性但未开 applyDeterministic → 照样进池（默认安全）', async () => {
    const { pipeline, pool } = await mods();
    const r = await pipeline.routeAndSubmit(UID, { statement: '记住我在开源项目组', explicitHome: 'personal_fact' });
    expect(r.judgement.outcome).toBe('deterministic');
    expect(r.poolItemId).toBeTruthy();
    expect(pool.loadPoolSync(UID).items[0].status).toBe('pending');
  });
});
