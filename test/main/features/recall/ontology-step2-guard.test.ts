/**
 * 014 反漂移守卫（specs/014 T024③）。
 *  本 spec 零新增 IPC 通道：当前通道名集合与开工基线（014 开工前提交
 *  660f82e8 的快照）做**集合比较**（顺序无关）——能抓住「偷偷加通道」。
 *  后续认知资产迁移为显式用户选择新增了两个登记通道；白名单只登记这两个，
 *  仍拒绝任何未登记的新增，同时继续检测基线通道删除（基线随通道退役同步，
 *  如 2026-09-28 敏感级机制删除时下线的 recall.assets.sensitivity.batch）。
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '../../../..');
const ipcSource = fs.readFileSync(path.join(ROOT, 'src/main/ipc/index.ts'), 'utf8');

describe('014 anti-drift（specs/014 T024）', () => {
  it('③ IPC 通道与 014 基线一致，且只允许已登记的后续迁移通道', () => {
    const current = [...ipcSource.matchAll(/^  '([A-Za-z0-9_.-]+)':/gm)].map((m) => m[1]);
    expect(current.length).toBeGreaterThan(300); // 解析护栏：抓不到通道说明正则失效
    const baseline = fs.readFileSync(path.join(__dirname, 'fixtures/ipc-channel-baseline-014.txt'), 'utf8')
      .split('\n').map((line) => line.trim()).filter(Boolean);
    const sneaked = [...new Set(current)].filter((name) => !baseline.includes(name));
    const removed = baseline.filter((name) => !current.includes(name));
    const registeredPost014 = [
      'recall.scopedMemoryMigration.preview',
      'recall.scopedMemoryMigration.run',
    ];
    expect(sneaked.sort(), '出现未登记的新通道').toEqual([...registeredPost014].sort());
    expect(removed, '014 期间不应删除通道').toEqual([]);
  });
});
