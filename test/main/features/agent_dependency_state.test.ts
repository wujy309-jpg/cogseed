/**
 * 已安装 Agent 的依赖状态：停用与不支持优先、缺失只提示、存量写法不误伤。
 * 判定是纯函数，直接表驱动；读盘版本用真实临时目录验证"读到了什么"。
 */
import { describe, expect, it } from 'vitest';

import { dependencyStateFromPlan } from '../../../src/main/features/agent_dependency_state';
import { planAgentDependencies, type LocalSkillState } from '../../../src/main/features/marketplace_agent_deps';

const none = new Set<string>();
const localFrom = (table: Record<string, Partial<LocalSkillState>>) => (id: string): LocalSkillState => ({
  present: false, disabled: false, ...(table[id] ?? {}),
});
const stateOf = (list: string[], priv: string[], local: Record<string, Partial<LocalSkillState>>) =>
  dependencyStateFromPlan(planAgentDependencies(list, new Set(priv), localFrom(local)));

describe('dependencyStateFromPlan', () => {
  it('全部就绪（复用 + 随包）→ ready', () => {
    expect(stateOf(['a3f09c21b7e4', 'invoice-ocr'], ['invoice-ocr'], { a3f09c21b7e4: { present: true } }))
      .toEqual({ status: 'ready', ids: [] });
  });

  it('没有依赖 → ready', () => {
    expect(dependencyStateFromPlan(planAgentDependencies([], none, localFrom({})))).toEqual({ status: 'ready', ids: [] });
    expect(dependencyStateFromPlan(planAgentDependencies(undefined, none, localFrom({})))).toEqual({ status: 'ready', ids: [] });
  });

  it('依赖被 Hub 停用 → deps_blocked，并指出是哪个', () => {
    expect(stateOf(['a3f09c21b7e4', '9b27f4a1c0e6'], [], { a3f09c21b7e4: { present: true }, '9b27f4a1c0e6': { present: true, disabled: true } }))
      .toEqual({ status: 'deps_blocked', ids: ['9b27f4a1c0e6'] });
  });

  it('引用内置能力：本机具备 → ready；不具备 → deps_blocked', () => {
    const plan = (available: boolean) => dependencyStateFromPlan(planAgentDependencies(['builtin:coding'], none, localFrom({}), () => available));
    expect(plan(true)).toEqual({ status: 'ready', ids: [] });
    expect(plan(false)).toEqual({ status: 'deps_blocked', ids: ['builtin:coding'] });
  });

  it('本机缺少依赖 → deps_missing（只提示，不是 blocked）', () => {
    expect(stateOf(['5e1c8a02d9b3'], [], {})).toEqual({ status: 'deps_missing', ids: ['5e1c8a02d9b3'] });
  });

  it('停用优先于缺失：两者并存时按 blocked 处理', () => {
    expect(stateOf(['5e1c8a02d9b3', '9b27f4a1c0e6'], [], { '9b27f4a1c0e6': { present: true, disabled: true } }))
      .toEqual({ status: 'deps_blocked', ids: ['9b27f4a1c0e6'] });
  });

  it('随包私有 Skill 即使本机有同名且被停用的 Skill，也不会被误判停用', () => {
    expect(stateOf(['invoice-ocr'], ['invoice-ocr'], { 'invoice-ocr': { present: true, disabled: true } }))
      .toEqual({ status: 'ready', ids: [] });
  });
});
