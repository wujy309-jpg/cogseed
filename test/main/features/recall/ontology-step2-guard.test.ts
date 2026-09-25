/**
 * 014 反漂移守卫（specs/014 T024③）。
 *  本 spec 零新增 IPC 通道：当前通道名集合与开工基线（014 开工前提交
 *  660f82e8 的快照）做**集合比较**（顺序无关）——能抓住「偷偷加通道」；
 *  010 的 recall.assets.sensitivity.batch 是 014 之前已交付的显式登记通道，
 *  计入基线（fixture 由该提交直接生成）。
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '../../../..');
const ipcSource = fs.readFileSync(path.join(ROOT, 'src/main/ipc/index.ts'), 'utf8');

describe('014 anti-drift（specs/014 T024）', () => {
  it('③ 零新增 IPC 通道：通道名集合与开工基线逐字相等（顺序无关）', () => {
    const current = [...ipcSource.matchAll(/^  '([A-Za-z0-9_.-]+)':/gm)].map((m) => m[1]);
    expect(current.length).toBeGreaterThan(300); // 解析护栏：抓不到通道说明正则失效
    const baseline = fs.readFileSync(path.join(__dirname, 'fixtures/ipc-channel-baseline-014.txt'), 'utf8')
      .split('\n').map((line) => line.trim()).filter(Boolean);
    const sneaked = [...new Set(current)].filter((name) => !baseline.includes(name));
    const removed = baseline.filter((name) => !current.includes(name));
    expect(sneaked, '014 期间出现未登记的新通道').toEqual([]);
    expect(removed, '014 期间不应删除通道').toEqual([]);
  });
});
