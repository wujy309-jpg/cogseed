/**
 * P-r1-19 钉住测试：反思工具最小允许集不变量。
 * 背景：runReflection 此前把全量工具集（含免确认可真实执行的
 * web_fetch / bash / write_file）交给后台自动反思，而 systemPrompt
 * 谎称只有 2 个工具。2026-10-01 收敛为 REFLECTION_TOOL_ALLOWLIST 白名单。
 * 判据与集合必须同步修改（READ_ONLY_TOOL_ALLOWLIST 同款先例）。
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { REFLECTION_TOOL_ALLOWLIST } from '../src/agent/runner.js';

const runnerSrc = fs.readFileSync(
  path.join(__dirname, '../src/agent/runner.ts'),
  'utf8',
);

describe('反思工具最小允许集（P-r1-19）', () => {
  it('允许集恰含反思的两个既定产出通道，不多不少', () => {
    expect([...REFLECTION_TOOL_ALLOWLIST].sort()).toEqual(['metacognition', 'skill_manage']);
  });

  it('高危工具永不入集：web_fetch / bash / write_file / delete_file / web_search', () => {
    for (const name of ['web_fetch', 'bash', 'write_file', 'delete_file', 'web_search']) {
      expect(REFLECTION_TOOL_ALLOWLIST.has(name), name).toBe(false);
    }
  });

  it('runReflection 的过滤必须走白名单（防回归到「全量减一项」）', () => {
    expect(runnerSrc).toContain('REFLECTION_TOOL_ALLOWLIST.has(name)');
    // 旧的「只排除 manage_execution_plan」全量过滤不得回流
    expect(runnerSrc).not.toContain('name !== "manage_execution_plan"');
  });

  it('systemPrompt 的 Available tools 句与允许集一致（防谎报复发）', () => {
    const m = /systemPrompt: 'You are a self-improvement assistant[^']*'/.exec(runnerSrc);
    expect(m).not.toBeNull();
    const prompt = m![0];
    expect(prompt).toContain('skill_manage');
    expect(prompt).toContain('metacognition');
    // prompt 不得再宣称白名单之外的可用工具
    for (const name of ['web_fetch', 'bash', 'write_file']) {
      expect(prompt.includes(name), `prompt 不应提及 ${name}`).toBe(false);
    }
  });
});
