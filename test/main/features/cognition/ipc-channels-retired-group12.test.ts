import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 组12 渲染零调用通道退役门禁（2026-10-01 认知资产质检循环 P-r1-92 /
 * P-r3-3 / P-r3-4，预审决策卡-20261001 拍板）。
 *
 * 退役清单（渲染层/preload 零调用、通道级测试零，删前已 grep 双证）：
 *  - kb 域 6 条（P-r1-92）：kb.share.needsUpdate / kb.share.appConfig.get /
 *    kb.share.appConfig.clear / kb.share.cogseed.update / kb.share.cogseed.list /
 *    kb.share.cogseed.config.get
 *  - 认知域 4 条（P-r3-3/P-r3-4）：cognition.receipts.list /
 *    cognition.receipts.read / cognition.reviewDecisions.list / cognition.skills.audit
 *
 * 唯一消费者就是死通道的服务函数随通道一并删除（真删原则）：
 *  - getSkillVersionMigrationAudit（P-r3-3）——其 legacy 计数对 v2/legacy 两目录
 *    都调 v2 读口 listSkillVersions，双目录共存时双重计数、真 legacy 零读取
 *    （P-r1-20 的根源函数，随退消解）；
 *  - readCognitionReuseReceipt（P-r3-4）。
 *
 * 本门禁钉住三件事：① 通道名不得原样复活（ipc/index.ts 源码级）；
 * ② 根源函数不得从 cognition 聚合出口复活（运行时导出面）；
 * ③ 基线 fixture（ipc-channel-baseline-014.txt）不得再把已退役通道列回去
 *   （014 反漂移守卫做集合比较，fixture 列了不存在的通道同样会红）。
 */

vi.mock('../../../../src/main/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const RETIRED_CHANNELS = [
  'kb.share.needsUpdate',
  'kb.share.appConfig.get',
  'kb.share.appConfig.clear',
  'kb.share.cogseed.update',
  'kb.share.cogseed.list',
  'kb.share.cogseed.config.get',
  'cognition.receipts.list',
  'cognition.receipts.read',
  'cognition.reviewDecisions.list',
  'cognition.skills.audit',
];

const ipcSource = readFileSync(resolve(__dirname, '../../../../src/main/ipc/index.ts'), 'utf8');
const fixtureSource = readFileSync(
  resolve(__dirname, '../recall/fixtures/ipc-channel-baseline-014.txt'),
  'utf8',
);

describe('组12 渲染零调用通道退役（P-r1-92/P-r3-3/P-r3-4）', () => {
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { vi.resetModules(); });

  it('ipc/index.ts 不得再注册已退役的 10 条通道', () => {
    const registered = [...ipcSource.matchAll(/^  '([A-Za-z0-9_.-]+)':/gm)].map((m) => m[1]);
    const revived = RETIRED_CHANNELS.filter((name) => registered.includes(name));
    expect(revived, '已退役通道被复活，需重审渲染零调用前提并同步基线 fixture').toEqual([]);
  });

  it('基线 fixture 不得把已退役通道列回去', () => {
    const lines = fixtureSource.split('\n').map((line) => line.trim());
    const relisted = RETIRED_CHANNELS.filter((name) => lines.includes(name));
    expect(relisted, 'fixture 与通道现状漂移（014 集合比较会红）').toEqual([]);
  });

  it('唯一消费者为死通道的服务函数不得从 cognition 聚合出口复活（P-r1-20 根源函数随退消解）', async () => {
    const cognition = await import('../../../../src/main/features/cognition');
    const aggregate = cognition as unknown as Record<string, unknown>;
    expect(aggregate.getSkillVersionMigrationAudit, 'getSkillVersionMigrationAudit 已随 cognition.skills.audit 通道退役').toBeUndefined();
    expect(aggregate.readCognitionReuseReceipt, 'readCognitionReuseReceipt 已随 cognition.receipts.read 通道退役').toBeUndefined();
    // 保留侧钉住：有活消费者的服务函数仍在聚合出口上（删通道不删服务）。
    expect(typeof aggregate.listCognitionReuseReceipts).toBe('function');
    expect(typeof aggregate.listRecentReviewDecisions).toBe('function');
  });
});
