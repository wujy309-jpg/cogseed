import { describe, it, expect } from 'vitest';

import type { buildRunner } from '../../../../src/main/model/core-agent/runner';
import {
  AUTO_CONFIDENCE,
  FLOOR_CONFIDENCE,
  buildJudgePrompt,
  judgeContentHome,
  parseJudgeReply,
} from '../../../../src/main/features/cognition_kernel/judge';
import { HOME_DEFINITIONS } from '../../../../src/main/features/cognition_kernel/routing';

const EMPTY_RULES = { schemaVersion: 1 as const, rules: [], corrections: [] };

function stubModel(reply: string) {
  return (async () => ({ runner: { runReflection: async () => reply } })) as unknown as typeof buildRunner;
}

function deps(reply: string) {
  return {
    buildRunnerFn: stubModel(reply),
    readRulesFn: () => EMPTY_RULES,
    ontologyContextFn: async () => '（无本体）',
  };
}

describe('cognition_kernel/judge — 模型按本体判定 + 三档门控', () => {
  it('高置信 → auto（归入候选池；判定本身不写档案）', async () => {
    const j = await judgeContentHome('u1', { statement: '对外报价不要承诺交期' }, deps(
      JSON.stringify({ home: 'rule', confidence: 0.9, reason: '含禁止边界的做法', matchedRuleIds: [] }),
    ));
    expect(j.outcome).toBe('auto');
    expect(j.home).toBe('rule');
    expect(j.confidence).toBeCloseTo(0.9);
    expect(j.model).toBe('llm');
  });

  it('中置信 → ask（转成一次提问）', async () => {
    const mid = (AUTO_CONFIDENCE + FLOOR_CONFIDENCE) / 2;
    const j = await judgeContentHome('u1', { statement: '我在开源项目组' }, deps(
      JSON.stringify({ home: 'personal_fact', confidence: mid, reason: '像是长期事实', matchedRuleIds: [] }),
    ));
    expect(j.outcome).toBe('ask');
    expect(j.home).toBe('personal_fact');
  });

  it('低置信 → unclassified（不猜、不进任何家）', async () => {
    const j = await judgeContentHome('u1', { statement: '嗯' }, deps(
      JSON.stringify({ home: 'personal_fact', confidence: 0.1, reason: '信息不足', matchedRuleIds: [] }),
    ));
    expect(j.outcome).toBe('unclassified');
    expect(j.home).toBeNull();
  });

  it('模型自己说 unclassified → 不猜', async () => {
    const j = await judgeContentHome('u1', { statement: '随便一句' }, deps(
      JSON.stringify({ home: 'unclassified', confidence: 0.95, reason: '不属于任何家', matchedRuleIds: [] }),
    ));
    expect(j.outcome).toBe('unclassified');
    expect(j.home).toBeNull();
  });

  it('回复不可解析 → 降级为未分类（不制造错误归属）', async () => {
    const j = await judgeContentHome('u1', { statement: 'x' }, deps('我觉得这是规则吧'));
    expect(j).toMatchObject({ outcome: 'unclassified', home: null, model: 'degraded' });
  });

  it('模型不可用（抛错）→ 降级为未分类', async () => {
    const j = await judgeContentHome('u1', { statement: 'x' }, {
      buildRunnerFn: (async () => { throw new Error('model down'); }) as unknown as typeof buildRunner,
      readRulesFn: () => EMPTY_RULES,
      ontologyContextFn: async () => '',
    });
    expect(j).toMatchObject({ outcome: 'unclassified', model: 'degraded' });
  });

  it('空内容不调模型', async () => {
    const j = await judgeContentHome('u1', { statement: '   ' }, deps('{}'));
    expect(j).toMatchObject({ outcome: 'unclassified', model: 'degraded' });
  });
});

describe('cognition_kernel/judge — prompt 带本体与用户规则（判定有依据）', () => {
  it('prompt 含：家的定义、本体上下文、用户规则、纠正样例、待判内容', () => {
    const prompt = buildJudgePrompt({
      statement: '本周上线支付网关',
      ontology: '分类与字段（T-Box）：\n- 项目：名称、对接人',
      rules: [{ id: 'r-1', home: 'task_local', note: '项目进度一律算临时事实', origin: 'user', createdAt: 'x' }],
      corrections: [{ statement: '这周要交方案', fromHome: 'personal_fact', toHome: 'task_local', note: '临时', at: 'x' }],
    });
    expect(prompt).toContain('你是「认知归属判定员」');
    for (const entry of HOME_DEFINITIONS) expect(prompt).toContain(entry.home);
    expect(prompt).toContain('项目：名称、对接人');
    expect(prompt).toContain('r-1');
    expect(prompt).toContain('用户把它从 personal_fact 改成 task_local');
    expect(prompt).toContain('本周上线支付网关');
  });
});

describe('cognition_kernel/judge — 回复解析收口', () => {
  it('容忍代码块包裹，只取第一个 JSON', () => {
    const parsed = parseJudgeReply('好\n```json\n{"home":"method","confidence":0.8,"reason":"有步骤"}\n```');
    expect(parsed).toMatchObject({ home: 'method', confidence: 0.8 });
  });

  it('非法 home → null（幻觉标签进不来）', () => {
    expect(parseJudgeReply('{"home":"secret_box","confidence":0.9}')).toBeNull();
  });

  it('置信度被夹到 0..1', () => {
    expect(parseJudgeReply('{"home":"rule","confidence":7}')?.confidence).toBe(1);
    expect(parseJudgeReply('{"home":"rule","confidence":-3}')?.confidence).toBe(0);
  });

  it('非 JSON → null', () => {
    expect(parseJudgeReply('规则')).toBeNull();
    expect(parseJudgeReply('')).toBeNull();
  });
});
