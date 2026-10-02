import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * cognition 主模块不得再引用已删除的 dashboard（2026-09-30 认知资产质检 R2）：
 *
 * R1 删除 src/main/features/cognition/dashboard.ts（死代码）后，index.ts 的
 * 「develop 侧能力」分节注释里仍列着 dashboard——注释尾巴会误导后来人以为
 * 该能力仍从这里导出。删除注释残留后用这条门禁钉住：index.ts 源码任何位置
 * （import/export/注释）不得再出现 dashboard 字样。
 *
 * 同时守住注释本身：分节注释不得被顺手整行删掉，列举的模块名应与实际
 * 存在的 adapter 导出保持一致。
 */

const indexSource = readFileSync(
  resolve(__dirname, '../../../src/main/features/cognition/index.ts'),
  'utf8',
);

describe('cognition 主模块不再引用已删除的 dashboard（质检 R2）', () => {
  it('index.ts 源码任何位置不得出现 dashboard 字样', () => {
    expect(indexSource).not.toContain('dashboard');
  });

  it('develop 侧能力分节注释仍在且不再列举 dashboard', () => {
    expect(indexSource).toMatch(/── develop 侧能力（candidates\/receipts\/skill-summary 等）/);
  });
});
