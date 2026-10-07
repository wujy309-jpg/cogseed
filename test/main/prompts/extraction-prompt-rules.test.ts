/**
 * 提取 prompt 四项规则的防漂移钉子（2026-10-07 Mem0 abb81c8 评估采纳项②落地）：
 * 相对时间双锚、否定保义、转变记新旧两态、通读整段防首题主导。
 * 这些是 LLM-facing 提示词规则，离线只能钉「规则文本在位」，改写或删除即红；
 * 行为效果由真实提取回路验收，不在本测试范围。
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('提取 prompt 规则钉子（Mem0 采纳项②）', () => {
  it('自动提取 system prompt 含四项规则', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../../src/main/features/recall/capture-service.ts'),
      'utf8',
    );
    expect(source, '通读整段防首题主导').toMatch(/Read the entire bounded run before deciding candidates/);
    expect(source, '相对时间锚定消息时间戳').toMatch(/anchor it against the message timestamp/);
    expect(source, '否定保义记转变后状态').toMatch(/Preserve negation and reversal meaning/);
    expect(source, '转变记新旧两态').toMatch(/record B as the current state and note the superseded prior state/);
  });

  it('手动捕获 prompt（cognition_capture.md）含时间锚与否定保义', () => {
    const prompt = fs.readFileSync(
      path.join(__dirname, '../../src/main/prompts/cognition_capture.md'),
      'utf8',
    );
    expect(prompt, '相对时间锚定').toMatch(/anchored against that message's timestamp/);
    expect(prompt, '否定保义').toMatch(/Preserve negation and reversal meaning/);
    expect(prompt, '转变记 B 为当前').toMatch(/record B as current and note the superseded A/);
  });
});
