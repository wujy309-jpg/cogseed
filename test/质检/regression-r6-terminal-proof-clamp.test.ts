/**
 * 回归 r6（收尾改名自 probe-r6-terminal-proof-clamp.test.ts · 2026-10-01 记账员）：
 * 对应 F-r1-24 已修——生产函数 recall-terminal-proof.ts:34 已改走
 * listAllConfirmedProjections，生产级回归在正式目录
 * test/main/features/group_chat/recall-terminal-proof.test.ts（F-r1-24 新增用例）。
 * 本文件锁定 API 层契约：listContextProjections 默认 clamp 20 与全量出口
 * listAllContextProjections 的对照——「必须一个不漏的消费方不得用默认 clamp」
 * 这一教训的机械钉子，不依赖修复代码、修复后仍绿，收尾收编为回归。
 *
 * 原探针 r6（边界测试员 · 本遍循环第 2 轮，编号顺延 r5）→ 主题：分页极限 × 生命周期终点。
 *
 * 疑点（读码推演，group_chat/recall-terminal-proof.ts:34）：turnProjectionIds 用
 * `listContextProjections(userId)`（**不传 limit**）反查「本轮真的注入过」的投影做
 * 终局证明锚点。而 listContextProjections（context-projection.ts:1476-1490）默认
 * `Number(query.limit) || 20` 再 clamp 到 [1,100]，按 createdAt 降序（:1469）取
 * 前 20 条——投影总量超 20 后，目标 turn 的投影只要不是最新 20 条之一就**静默
 * 进不了候选池**，reuse_turn_ids 反查扑空 → 注入过资产的那一轮进不了证明链。
 * 这正是该函数头注释（T2.3 · 2026-09-13）描述过的病（「注入了资产也永远进不了
 * 证明链」）换了触发条件回归：那次是自动投影从不发卡，这次是 clamp 截断。
 *
 * 同文件已有两处同款教训的修复先例：deleteAbilityAssetVersion 全量枚举
 * （asset-service.ts:1601-1603 注释「listContextProjections 默认 clamp 到 20 条，
 * 投影存量超过后老投影漏冻结——删了版本副本就丢」）与 refreshCommitted 投影
 * 版本刷新（context-projection.ts:1277 注释「不走 listContextProjections——它内部
 * clamp」）；listAllContextProjections / listAllConfirmedProjections 即为「要一个不
 * 漏」的消费方准备的出口，此处漏用。
 *
 * 本探针直接构造 25 条 confirmed 投影（目标 turn 的投影第 21 新），用与
 * recall-terminal-proof.ts:34 完全相同的调用形态（只传 userId）复现输入池截断。
 * 风格对齐 probe-r5-purge-earlyreturn-guard-bypass.test.ts。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

vi.mock('../../src/main/features/kb_indexer', () => ({
  enqueue: () => {},
  kbEvents: { on: () => {}, off: () => {}, emit: () => {} },
}));
vi.mock('../../src/main/features/search', () => ({
  upsertContext: () => {},
  dropContext: () => {},
}));

let tmpDir: string;
let prevWs: string | undefined;
const UID = 'probe-r6-clamp';

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cogseed-probe-r6b-'));
  prevWs = process.env.COGSEED_WORKSPACE_ROOT;
  process.env.COGSEED_WORKSPACE_ROOT = tmpDir;
  vi.resetModules();
});

afterEach(() => {
  process.env.COGSEED_WORKSPACE_ROOT = prevWs;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function loadProjection() {
  return import('../../src/main/features/recall/context-projection');
}

/** 手写一条合法 confirmed 投影记录（形状过 asProjection + store 双层校验）。 */
async function writeProjection(
  writeRecallJsonRecord: typeof import('../../src/main/features/recall/store').writeRecallJsonRecord,
  id: string, taskRunId: string, createdAt: string,
) {
  await writeRecallJsonRecord(UID, 'projections', id, {
    schemaVersion: 2,
    ownerId: UID,
    id,
    taskRunId,
    purpose: 'probe',
    authorization: 'user_selected',
    assetIds: [],
    assetVersions: {},
    sourceRefs: [],
    omittedRefs: [],
    status: 'confirmed',
    createdAt,
  });
}

describe('回归 r6 › listContextProjections 默认 clamp 20 契约与全量出口对照（F-r1-24 教训钉）', () => {
  it('25 条投影（目标第 21 新）：与 recall-terminal-proof.ts:34 同参调用查不到目标，全量枚举查得到', async () => {
    const { writeRecallJsonRecord } = await import('../../src/main/features/recall/store');
    const projection = await loadProjection();

    const TARGET = 'proj-p6target01';
    const TARGET_TURN = 'turn-p6-target';
    // 目标投影第 21 新（其后又有 20 条更新的投影），前面再垫 4 条更旧的。
    const base = Date.parse('2026-09-30T00:00:00.000Z');
    const iso = (offsetSec: number) => new Date(base + offsetSec * 1000).toISOString();
    for (let i = 0; i < 4; i += 1) {
      await writeProjection(writeRecallJsonRecord, `proj-p6old${String(i).padStart(2, '0')}`, `turn-old-${i}`, iso(i));
    }
    await writeProjection(writeRecallJsonRecord, TARGET, TARGET_TURN, iso(10));
    for (let i = 0; i < 20; i += 1) {
      await writeProjection(writeRecallJsonRecord, `proj-p6new${String(i).padStart(2, '0')}`, `turn-new-${i}`, iso(100 + i));
    }
    expect((await projection.listAllContextProjections(UID)).length).toBe(25); // 全量在场

    // 与 turnProjectionIds（recall-terminal-proof.ts:34）完全同参的调用形态。
    const clamped = await projection.listContextProjections(UID);
    expect(clamped.length).toBe(20); // 默认 clamp：Number(undefined)||20 → min(100,20)
    // 复刻 turnProjectionIds 的过滤体（:37-39：confirmed + taskRunId 命中 + 未过期）。
    const found = clamped
      .filter((p) => p.status === 'confirmed' && p.taskRunId === TARGET_TURN
        && !(p.expiresAt && Date.parse(p.expiresAt) <= Date.now()))
      .map((p) => p.id);
    expect(found).toEqual([]); // 目标 turn 的投影不在输入池 → 反查扑空，证明锚点漏

    // 对照：全量枚举（listAllContextProjections）下同样的过滤能找到目标——
    // 修复出口（换成全量或带 taskRunId 查询的调用）在本仓库已存在。
    const foundAll = (await projection.listAllContextProjections(UID))
      .filter((p) => p.status === 'confirmed' && p.taskRunId === TARGET_TURN)
      .map((p) => p.id);
    expect(foundAll).toEqual([TARGET]);
  });

  it('对照组：目标投影在最新 20 条内时，同款调用能找到（无截断时路径正常）', async () => {
    const { writeRecallJsonRecord } = await import('../../src/main/features/recall/store');
    const projection = await loadProjection();
    const base = Date.parse('2026-09-30T00:00:00.000Z');
    const iso = (offsetSec: number) => new Date(base + offsetSec * 1000).toISOString();
    for (let i = 0; i < 19; i += 1) {
      await writeProjection(writeRecallJsonRecord, `proj-p6c${String(i).padStart(2, '0')}`, `turn-c-${i}`, iso(i));
    }
    await writeProjection(writeRecallJsonRecord, 'proj-p6ctarget', 'turn-c-target', iso(50));
    const clamped = await projection.listContextProjections(UID);
    expect(clamped.length).toBe(20);
    expect(clamped.filter((p) => p.taskRunId === 'turn-c-target').map((p) => p.id)).toEqual(['proj-p6ctarget']);
  });
});
