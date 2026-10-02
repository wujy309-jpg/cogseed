/**
 * 准入软提醒可见性（F-r3-6，2026-10-01 第 3 轮修复）。
 *
 * 主进程随 capabilities 专门下发 eligibilityAdvisories（soft_warning 的来源，
 * candidate-capabilities.ts：不阻断但应如实告知的欠缺）。修复前渲染层
 * 全域零消费：soft_warning 与 eligible 界面同形，用户点「保存」时收不到
 * 任何欠缺提醒——主进程「应如实告知 / 留给用户复核」的设计意图在 UI 蒸发。
 *
 * 这里守住四件事：
 *  1. soft_warning 且有 advisories 时，详情（编辑分支与只读分支）都渲染提醒；
 *  2. 提醒位于确认按钮上方（最后可见），不挡按钮（不阻断 ≠ 不可见）；
 *  3. eligible / ineligible / 空 advisories 不渲染提醒（不制造噪音）；
 *  4. 未知码不上屏（主进程契约：码由 UI 翻译，内部标识不直接展示）。
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { renderCognition } from './helpers/cognition-renderer';

const zh: Record<string, string> = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../../src/renderer/locales/zh.json'), 'utf8'),
);

const ACTIONABLE = {
  canView: true, canEdit: true, canConfirm: true, canPromote: true, canReject: true,
  canDefer: true, canRetry: false, canBatchSelect: true, needsUserAction: true,
  countsAsPending: true, isSnoozed: false, isTerminal: false,
};

function candidate(capabilities: Record<string, unknown>) {
  return {
    id: 'cand-soft',
    status: 'pending_review',
    summary: '带软提醒的候选',
    judgment: '发布前用双清单核对交付物。',
    suggestedType: 'rule',
    suggestedScope: 'product',
    suggestedAction: 'create',
    risk: 'low',
    sourceRefs: [{ kind: 'memory', id: 'mem-1' }],
    evidenceRefs: [{ kind: 'memory', id: 'mem-1' }],
    capabilities,
  };
}

function renderDetail(caps: Record<string, unknown>): string {
  return renderCognition(
    { name: 'review', candidateId: 'cand-soft' },
    { candidates: [candidate(caps)] },
  );
}

describe('候选确认前的准入软提醒（soft_warning）', () => {
  it('soft_warning 且有欠缺时：渲染提醒，逐条列出，且在确认按钮上方', () => {
    const html = renderDetail({
      ...ACTIONABLE,
      displayState: 'needs_review',
      eligibility: 'soft_warning',
      ineligibleReasons: [],
      eligibilityAdvisories: ['rule_missing_boundary', 'statement_over_soft_budget'],
    });

    // 词条落在真实 zh 词条上——同时证明新键确实存在于语言文件。
    expect(zh['cognition.candidate_advisory_prefix']).toBeTruthy();
    expect(html).toContain(zh['cognition.candidate_advisory_prefix']);
    expect(html).toContain(zh['cognition.candidate_advisory_rule_missing_boundary']);
    expect(html).toContain(zh['cognition.candidate_advisory_statement_over_soft_budget']);
    // 「不阻止确认」与「按最近一次读取」的口径必须在场（快照口径如实说明）。
    expect(zh['cognition.candidate_advisory_prefix']).toContain('不阻止确认');
    expect(zh['cognition.candidate_advisory_prefix']).toContain('最近一次读取');
    // 提醒在确认按钮上方最后可见，不挡按钮。
    const noteAt = html.indexOf(zh['cognition.candidate_advisory_prefix']);
    const confirmAt = html.lastIndexOf('data-act="cand-adopt-with-form"');
    expect(noteAt).toBeGreaterThan(-1);
    expect(confirmAt).toBeGreaterThan(-1);
    expect(noteAt).toBeLessThan(confirmAt);
  });

  it('只读分支（终态候选）也补一行简版提醒，不静默', () => {
    const html = renderDetail({
      ...ACTIONABLE,
      canEdit: false, canConfirm: false, canPromote: false, canReject: false,
      canDefer: false, canBatchSelect: false, needsUserAction: false,
      countsAsPending: false, isTerminal: true,
      displayState: 'confirmed',
      eligibility: 'soft_warning',
      ineligibleReasons: [],
      eligibilityAdvisories: ['fact_not_stable'],
    });

    expect(zh['cognition.candidate_block_fact_not_stable']).toBeTruthy();
    expect(html).toContain(zh['cognition.candidate_advisory_prefix']);
    expect(html).toContain(zh['cognition.candidate_block_fact_not_stable']);
  });

  it('eligible 候选不渲染提醒（不制造噪音）', () => {
    const html = renderDetail({
      ...ACTIONABLE,
      displayState: 'needs_review',
      eligibility: 'eligible',
      ineligibleReasons: [],
      eligibilityAdvisories: [],
    });

    expect(html).not.toContain(zh['cognition.candidate_advisory_prefix']);
  });

  it('ineligible 候选走阻断原因块，不叠加软提醒', () => {
    const html = renderDetail({
      ...ACTIONABLE,
      canConfirm: false, canPromote: false,
      displayState: 'needs_review',
      eligibility: 'ineligible',
      ineligibleReasons: ['judgment_is_meta_commentary'],
      eligibilityAdvisories: ['rule_missing_boundary'],
    });

    expect(html).toContain(zh['cognition.candidate_error_promotion_blocked']);
    expect(html).not.toContain(zh['cognition.candidate_advisory_prefix']);
  });

  it('soft_warning 但欠缺列表为空时不渲染（前端不猜）', () => {
    const html = renderDetail({
      ...ACTIONABLE,
      displayState: 'needs_review',
      eligibility: 'soft_warning',
      ineligibleReasons: [],
      eligibilityAdvisories: [],
    });

    expect(html).not.toContain(zh['cognition.candidate_advisory_prefix']);
  });

  it('未知码不上屏（内部标识不直接展示）', () => {
    const html = renderDetail({
      ...ACTIONABLE,
      displayState: 'needs_review',
      eligibility: 'soft_warning',
      ineligibleReasons: [],
      eligibilityAdvisories: ['made_up_future_code'],
    });

    expect(html).not.toContain('made_up_future_code');
    expect(html).not.toContain(zh['cognition.candidate_advisory_prefix']);
  });
});
