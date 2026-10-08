import { describe, expect, it } from 'vitest';
import { renderCognition, loadCognitionAssets } from './helpers/cognition-renderer';
import { getRecallCandidateCapabilities, projectReviewQueueCandidates } from '../../src/main/features/recall/candidate-capabilities';
const candidate = (id: string, status = 'pending_review') => ({ id, status, judgment: '以后方案比较优先使用表格。', value: '便于反复比较方案差异。', summary: '方案比较格式', suggestedScope: '方案比较', suggestedType: 'personal', suggestedAction: 'create', sourceRefs: [], capabilities: getRecallCandidateCapabilities({ status: status as never }), updatedAt: '2026-10-08T01:00:00Z' });
describe('认知收敛后的单一治理入口', () => {
  it('五个入口；旧待处理深链进入系统活动并保留建议身份', () => {
    const { ns } = loadCognitionAssets();
    expect(ns.TABS.map((tab: { id: string }) => tab.id)).toEqual(['tree', 'overview', 'ontology', 'activity', 'settings']);
    ns.router.go({ name: 'review', candidateId: 'c1' });
    expect(ns.store.route).toMatchObject({ name: 'activity', candidateId: 'c1' });
  });
  it('普通聊天和后台队列不成为需要关注，重复候选治理行只显示一次', () => {
    const html = renderCognition({ name: 'activity' }, { candidates: [candidate('c1')], inbox: [{ id: 'candidate:c1', candidateId: 'c1', title: '不应重复' }], captures: [{ id: 'low', conversationTitle: '无营养闲聊', status: 'queued' }], sources: [{ title: '全部聊天历史' }] });
    expect(html).toContain('方案比较格式');
    expect(html).not.toContain('不应重复');
    expect(html).not.toContain('无营养闲聊');
    expect(html).not.toContain('全部聊天历史');
  });
  it('已保存或拒绝的建议移入已处理，列表不直接放确认按钮', () => {
    const records = [candidate('c1'), candidate('c2', 'confirmed')];
    expect(renderCognition({ name: 'activity' }, { candidates: records })).not.toContain('data-act="candidate-promote"');
    const done = renderCognition({ name: 'activity', activityView: 'done' }, { candidates: records });
    expect(done).toContain('已保存');
    expect(done).toContain('data-act="activity-row"');
  });
  it('读取失败的建议详情给出重试，不伪装成记录不存在', () => {
    const html = renderCognition({ name: 'activity', candidateId: 'c1' }, { candidatesError: 'offline', candidates: [] });
    expect(html).toContain('data-act="retry-candidates"');
    expect(html).not.toContain('这条建议已不在');
  });
  it('新设置只管理夜间发现，移除联动维护和 KSTAR 展示', () => {
    const html = renderCognition({ name: 'settings' }, { captureSettings: { enabled: true, executionPolicy: 'nightly' }, captureModel: { configured: true } });
    expect(html).toContain('夜间自动发现');
    expect(html).toContain('data-act="nightly-toggle"');
    expect(html).not.toContain('data-act="nightly-time"');
    expect(html).not.toContain('KSTAR');
    expect(html).not.toContain('定期检查');
  });
  it('活动历史投影不沿用旧待处理队列的五条历史截断', () => {
    const records = Array.from({ length: 12 }, (_, index) => candidate('done-'+index, 'confirmed'));
    expect(projectReviewQueueCandidates(records)).toHaveLength(5);
    expect(projectReviewQueueCandidates(records, true)).toHaveLength(12);
  });
});
