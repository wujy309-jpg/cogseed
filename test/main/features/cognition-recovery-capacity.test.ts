/**
 * cognition deactivate 恢复的容量毒丸回归（P-r1-39）。
 *
 * 修复前：transitions 恰为 1199（非失效上限）且带存量 deactivate 意图的资产，
 * 每次 listCognitionAssetPage / listActiveCognitionSourceIds 都在 reconcile
 * 阶段抛 `cognition transition count exceeds 1200`（数值还是错的，实际闸在
 * 1199）——该用户资产分页永久不可用，且抛错发生在写盘之前、盘上毒丸组合
 * 永不被清（亲跑复现无自愈）。
 *
 * 修复后（invalidate 自愈降级 + 残余隔离）：
 * - 已确认过（confirmedAt 在场）的毒丸资产：先取下共享记忆，再把恢复落成
 *   带审计轨迹的失效终态（reason='removed'）——恢复完成、毒丸被清出盘面；
 * - 从未确认过的毒丸资产（invalidated 终态要求 confirmedAt，写盘校验会反
 *   炸）：跳过该资产的恢复（隔离），读路径继续、盘面不动。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

vi.mock('../../../src/main/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

let tmpDir: string;
let prevRoot: string | undefined;
const UID = 'uCogCap';

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cogseed-cog-cap-'));
  prevRoot = process.env.COGSEED_WORKSPACE_ROOT;
  process.env.COGSEED_WORKSPACE_ROOT = tmpDir;
  vi.resetModules();
});

afterEach(() => {
  process.env.COGSEED_WORKSPACE_ROOT = prevRoot;
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.resetModules();
});

function ts(i: number): string {
  return new Date(Date.UTC(2024, 0, 1, 0, 0, 0) + i * 1000).toISOString().slice(0, 19);
}

/** 毒丸资产 B：已确认过、后被失效、带未完成 deactivate 意图，1199 条 transitions。 */
async function buildPoisonInvalidated() {
  const { memoryContentHash } = await import('../../../src/main/features/memory-records');
  const summary = '被容量卡住的已确认认知';
  const assetId = 'ca_poison_cap_b';
  const transitions: Array<Record<string, string>> = [
    { id: 'transition_created', kind: 'created', at: ts(0) },
    { id: 'transition_confirmed', kind: 'confirmed', at: ts(1) },
  ];
  let i = 2;
  // 597 对 deferred/reconfirmed + 1 条 deferred = 1195 条填充
  for (let pair = 0; pair < 597; pair++) {
    transitions.push({ id: `transition_pad_d_${pair}`, kind: 'deferred', at: ts(i++) });
    transitions.push({ id: `transition_pad_r_${pair}`, kind: 'reconfirmed', at: ts(i++) });
  }
  transitions.push({ id: 'transition_pad_tail', kind: 'deferred', at: ts(i++) });
  transitions.push({ id: 'transition_invalidated', kind: 'invalidated', at: ts(i++), reason: 'removed' });
  transitions.push({ id: 'transition_defer_req', kind: 'defer_requested', at: ts(i++) });
  expect(transitions).toHaveLength(1199);
  return {
    id: assetId,
    title: '毒丸 B',
    summary,
    stage: 'seed',
    reviewState: 'invalidated',
    evidence: [],
    reuseEvents: [],
    transitions,
    createdAt: ts(0),
    updatedAt: ts(1),
    confirmedAt: ts(1),
    memoryTransition: {
      kind: 'deactivate',
      sourceId: assetId,
      contentSha256: memoryContentHash(summary),
      requestedAt: ts(1198),
    },
    invalidation: { at: ts(1197), reason: 'removed' },
  };
}

/** 毒丸资产 A：从未确认、带未完成 deactivate 意图，1199 条 transitions。 */
async function buildPoisonPending() {
  const { memoryContentHash } = await import('../../../src/main/features/memory-records');
  const summary = '被容量卡住的未确认认知';
  const assetId = 'ca_poison_cap_a';
  const transitions: Array<Record<string, string>> = [
    { id: 'transition_created', kind: 'created', at: ts(0) },
  ];
  for (let k = 0; k < 1197; k++) {
    transitions.push({ id: `transition_pad_${k}`, kind: 'deferred', at: ts(k + 1) });
  }
  transitions.push({ id: 'transition_defer_req', kind: 'defer_requested', at: ts(1198) });
  expect(transitions).toHaveLength(1199);
  return {
    id: assetId,
    title: '毒丸 A',
    summary,
    stage: 'seed',
    reviewState: 'pending',
    evidence: [],
    reuseEvents: [],
    transitions,
    createdAt: ts(0),
    updatedAt: ts(1),
    memoryTransition: {
      kind: 'deactivate',
      sourceId: assetId,
      contentSha256: memoryContentHash(summary),
      requestedAt: ts(1198),
    },
  };
}

async function writePoisonStore(asset: unknown): Promise<string> {
  const { userCognitionFile } = await import('../../../src/main/paths');
  const file = userCognitionFile(UID);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const before = JSON.stringify({ version: 3, assets: [asset] }, null, 2);
  fs.writeFileSync(file, before, 'utf8');
  return before;
}

describe('cognition › P-r1-39 deactivate 恢复容量毒丸', () => {
  it('已确认过的毒丸：分页可用，恢复降级为带审计的失效终态并清出盘面', async () => {
    const before = await writePoisonStore(await buildPoisonInvalidated());
    const { userCognitionFile } = await import('../../../src/main/paths');
    const cognition = await import('../../../src/main/features/cognition');

    // 修复前：这里抛 `cognition transition count exceeds 1200`，分页永久不可用。
    const page = await cognition.listCognitionAssetPage(UID, 1, 50);
    expect(page.total).toBe(1);
    expect(page.items[0].reviewState).toBe('invalidated');

    // 恢复完成即写盘：毒丸组合被清出（快照翻新、文件变化），且二次读稳定。
    const after = fs.readFileSync(userCognitionFile(UID), 'utf8');
    expect(after).not.toBe(before);
    expect(JSON.parse(after).assets[0].memoryTransition).toBeUndefined();
    const page2 = await cognition.listCognitionAssetPage(UID, 1, 50);
    expect(page2.total).toBe(1);
    expect(page2.items[0].reviewState).toBe('invalidated');
  });

  it('从未确认的毒丸：分页可用，恢复被隔离跳过、盘面原样保留', async () => {
    const before = await writePoisonStore(await buildPoisonPending());
    const { userCognitionFile } = await import('../../../src/main/paths');
    const cognition = await import('../../../src/main/features/cognition');

    // 修复前：同样的容量抛错锁死分页。修复后：隔离跳过，读路径继续。
    const page = await cognition.listCognitionAssetPage(UID, 1, 50);
    expect(page.total).toBe(1);
    expect(page.items[0].reviewState).toBe('pending');

    // 隔离 = 不产生任何恢复写盘（无效终态无处可落，宁可保持现状）。
    expect(fs.readFileSync(userCognitionFile(UID), 'utf8')).toBe(before);
    const page2 = await cognition.listCognitionAssetPage(UID, 1, 50);
    expect(page2.items[0].reviewState).toBe('pending');
  });

  it('listActiveCognitionSourceIds 同样不再被容量毒丸锁死', async () => {
    await writePoisonStore(await buildPoisonPending());
    const cognition = await import('../../../src/main/features/cognition');
    const active = await cognition.listActiveCognitionSourceIds(UID);
    expect(active.size).toBe(0);
  });
});
