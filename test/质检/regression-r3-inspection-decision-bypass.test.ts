/**
 * 探针（本轮红队-数据与注入，主题：契约对齐/写通道参数校验缺口）：
 * decideInspectionFinding 对 decision/findingKey 双参数零校验。
 *
 * 读码链路（asset-inspection-service.ts:140-174）：
 *  - decision 无枚举门：'dismissed' | 'deferred' 之外的任意值（含拼写错误、
 *    null、对象）走不进任何 add 分支，但两个数组都会走**反向 filter**——
 *    `decision !== 'dismissed' ? filter(移除)` 与 `decision !== 'deferred' ?
 *    filter(移除)` 对非法值同时成立，把该 key 从两个处置数组静默删掉——
 *    用户已「不管它」的待办复活回下轮巡检清单，且无任何报错；
 *  - findingKey 无长度/形状校验：IPC 直达可写任意超长字符串进数组
 *    （keysOf 只滤非字符串，add 分支无长度门；对照同域 bounded 先例）。
 *
 * 对照先例：F-r2-1/F-r2-2（po 域 ruleKind/verified 枚举门）、本轮探针 D
 * （资产 type 枚举）——同款「写通道枚举参数零校验」病，本条加一个独有的
 * 「非法值静默撤销既有处置」语义后果。
 *
 * 回归 r3（收尾改名自 probe-r3-inspection-decision-bypass.test.ts · 2026-10-01 记账员）：
 * F-r3-7 已修——decideInspectionFinding 入口补两道 guard（非法 decision /
 * findingKey 非法或超 1024 字符均 throw）。修复员回归在正式目录
 * test/main/features/recall/asset-inspection.test.ts（11 passed）；本探针两个
 * 漏洞用例由记账员按修复后口径翻转断言（基线 2 failed 消除），收尾收编回归。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

let tmpDir: string;
let previousRoot: string | undefined;
const UID = 'probe-r3-insp';

beforeEach(() => {
  vi.resetModules();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cogseed-probe-r3insp-'));
  previousRoot = process.env.COGSEED_WORKSPACE_ROOT;
  process.env.COGSEED_WORKSPACE_ROOT = tmpDir;
});
afterEach(() => {
  if (previousRoot === undefined) delete process.env.COGSEED_WORKSPACE_ROOT;
  else process.env.COGSEED_WORKSPACE_ROOT = previousRoot;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function mod() {
  return import('../../src/main/features/recall/asset-inspection-service');
}

describe('回归 r3 › 巡检处置参数入口校验（F-r3-7 已修）', () => {
  it('对照组：合法 dismissed/deferred 处置互斥生效', async () => {
    const svc = await mod();
    await svc.decideInspectionFinding(UID, 'asset:aa-x:confidence', 'dismissed');
    let settings = await svc.readInspectionSettings(UID);
    expect(settings.dismissedFindingKeys).toContain('asset:aa-x:confidence');
    await svc.decideInspectionFinding(UID, 'asset:aa-y:stale', 'deferred');
    settings = await svc.readInspectionSettings(UID);
    expect(settings.deferredFindingKeys).toContain('asset:aa-y:stale');
  });

  it('回归：非法 decision（拼写错/任意值）被入口拒绝，既有 dismissed 处置不被静默撤销', async () => {
    const svc = await mod();
    await svc.decideInspectionFinding(UID, 'asset:aa-z:stale', 'dismissed');
    expect((await svc.readInspectionSettings(UID)).dismissedFindingKeys).toContain('asset:aa-z:stale');

    // F-r3-7 修复后：'dismiss'（漏 ed）等任意值 → 入口 throw（不再静默双移除）。
    await expect(svc.decideInspectionFinding(UID, 'asset:aa-z:stale', 'dismiss' as never))
      .rejects.toThrow(/invalid inspection decision/);
    // 既有处置保留：key 仍在 dismissed 数组（待办不复活）。
    expect((await svc.readInspectionSettings(UID)).dismissedFindingKeys).toContain('asset:aa-z:stale');
  });

  it('回归：findingKey 超 1024 字符被入口拒绝，不落盘', async () => {
    const svc = await mod();
    const huge = `k:${'x'.repeat(10_000)}`;
    await expect(svc.decideInspectionFinding(UID, huge, 'dismissed'))
      .rejects.toThrow(/invalid inspection finding key/);
    expect((await svc.readInspectionSettings(UID)).dismissedFindingKeys.some((k) => k.length > 1024)).toBe(false);
  });
});
