import { describe, expect, it } from 'vitest';
import { loadCognitionAssets } from './helpers/cognition-renderer';

function renderCandidate(extra: Record<string, unknown> = {}) {
  const candidate = {
    id: 'detail-a', summary: '周报模板', judgment: '周报包含进展、风险和计划，每项行动说明负责人。',
    value: '减少重复整理', suggestedType: 'template', suggestedScope: 'general',
    status: 'pending_review', origin: 'manual', sourceRefs: [], createdAt: '2026-10-11T08:00:00Z',
    capabilities: { countsAsPending: true, canEdit: true, canPromote: true, canReject: true }, ...extra,
  };
  return loadCognitionAssets({ candidates: [candidate] }, { name: 'activity', ...(extra.status === 'confirmed' ? { activityView: 'done' } : {}) }).render();
}

describe('建议详情的内容与适用任务表单', () => {
  it('以中文解释任务选择，保留底层值并统一两种选择控件的样式', () => {
    const html = renderCandidate();
    expect(html).toContain('认知类型');
    expect(html).toContain('适用任务帮助系统在合适的任务中选择这条认知');
    expect(html).toContain('type="text" value="跨任务通用"');
    expect(html).not.toContain('type="text" value="general"');
    expect(html).not.toContain('作用域');
    expect(html.match(/class="ui-native-select ui-control ca-review-select"/g)).toHaveLength(1);
  });

  it('缺范围时必须明确选择，旧多值范围展示中文但不静默改成通用', () => {
    expect(renderCandidate({ suggestedScope: '' })).toMatch(/type="text"[^>]*required[^>]*data-f="scope"/);
    const legacy = renderCandidate({ suggestedScope: 'review,code' });
    expect(legacy).toContain('value="review,code"');
    expect(legacy).not.toContain('<option value="general" selected>');
    expect(renderCandidate({ suggestedScope: '<私有范围>' })).toContain('value="&lt;私有范围&gt;"');
  });

  it('正文先于使用方式和来源核对，权限与任务类别分开展示', () => {
    const html = renderCandidate({ scopePolicy: { workspaceIds: ['space-a'] } });
    const content = html.indexOf('ca-review-content');
    const usage = html.indexOf('ca-review-usage');
    const evidence = html.indexOf('ca-review-evidence');
    expect(content).toBeLessThan(usage);
    expect(usage).toBeLessThan(evidence);
    expect(html).toContain('查看使用权限');
    expect(html).toContain('space-a');
    expect(html).toContain('价值与不确定性');
    expect(html).toContain('保存的影响');
    expect(html).toContain('<h2>周报模板</h2>');
    expect(html).not.toContain('<h2 class="cand-title">周报模板</h2>');
  });
});

describe('HTML 原型的完整审核详情与真实状态', () => {
  it('完整名称、操作性质和目标版本在编辑字段前显示，保存影响与记录在证据后显示', () => {
    const name = '这是一条超过列表截断长度的完整项目周报交付认知模板';
    const html = renderCandidate({ summary: name });
    expect(html).toContain(`<h2>${name}</h2>`);
    expect(html).toContain('建议新增 · 模板与范例');
    const markers = ['ca-review-target', 'ca-review-content', 'ca-review-usage', 'ca-review-value', 'ca-review-evidence', 'ca-review-impact', 'ca-review-history'];
    const positions = markers.map(marker => html.indexOf(marker));
    expect(positions.every(position => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(html).toContain('拟新建正式资产 · 无已有资产版本');
    expect(html).toContain('修改并保存');
    expect(html).toContain('保存修改并校验');
    expect(html).not.toContain('<h3>使用方式</h3>');
  });
  it('更新型显示真实在用版本与候选基线；缺失时不编造版本', () => {
    const loaded = loadCognitionAssets({ candidates: [{ id: 'a', summary: '更新周报', suggestedAction: 'update', targetAssetId: 'asset-a', targetVersionUsed: '2', capabilities: { canEdit: true, canPromote: true, canReject: true, countsAsPending: true } }], assets: [{ id: 'asset-a', title: '当前周报', version: '5', activeVersion: '4', statement: '当前正文' }] }, { name: 'activity' });
    const html = loaded.render();
    expect(html).toContain('目标：当前周报 · 当前在用 v4 · 候选基于 v2');
    expect(html).toContain('依据与版本对比');
    expect(html).toContain('保存更新');
    expect(renderCandidate({ suggestedAction: 'update', targetAssetId: 'missing' })).toContain('未读到目标资产');
    expect(renderCandidate({ suggestedAction: 'update', targetAssetId: 'missing' })).not.toContain('当前在用 v1');
  });
  it('来源摘录与真实来源入口一起显示；不可用来源不显示旧摘录或假入口', () => {
    const html = renderCandidate({ evidenceRefs: [{ kind: 'conversation', id: 'chat-a', title: '项目周报讨论', excerpt: '周报按进展、风险、计划组织。' }, { kind: 'conversation', id: 'chat-b', degraded: true, excerpt: '不应显示的旧摘录' }] });
    expect(html).toContain('项目周报讨论');
    expect(html).toContain('<blockquote class="ca-review-quote">周报按进展、风险、计划组织。</blockquote>');
    expect(html).toContain('data-act="open-conversation" data-id="chat-a"');
    expect(html).not.toContain('data-act="open-conversation" data-id="chat-b"');
    expect(html).not.toContain('不应显示的旧摘录');
    expect(html).toContain('当前无法读取此来源');
  });
  it('已处理详情保持同一阅读结构但不提供编辑，正文和处理记录保留', () => {
    const html = renderCandidate({ status: 'confirmed', capabilities: { isTerminal: true }, judgment: '正式处理前保留的正文' });
    expect(html).toContain('正式处理前保留的正文');
    expect(html).toContain('来源与证据');
    expect(html).toContain('价值与不确定性');
    expect(html).toContain('查看本条处理记录');
    expect(html).not.toContain('data-f="judgment"');
    expect(html).not.toContain('data-act="activity-save-draft"');
  });
  it('补边界建议将适用与禁用条件直接展示，不折叠关键输入', () => {
    const html = renderCandidate({ suggestedType: 'rule', suggestedAction: 'limit_scope', targetAssetId: 'asset-a', applicableWhen: ['需要评审时'], forbiddenWhen: ['来源未核对时'] });
    expect(html).toContain('<section class="details ca-review-boundaries">');
    expect(html).toContain('data-f="applicable"');
    expect(html).toContain('data-f="forbidden"');
    expect(html).toContain('不修改全局设置');
  });
  it('版本冲突的重新确认留在冲突区，正式操作固定在底部', () => {
    const loaded = loadCognitionAssets({ candidates: [{ id: 'a', summary: '更新周报', suggestedAction: 'update', targetAssetId: 'asset-a', targetVersionUsed: '2', capabilities: { canEdit: true, canPromote: true, canReject: true, countsAsPending: true } }], assets: [{ id: 'asset-a', title: '周报', activeVersion: '3', version: '3' }], candidateVersionConflict: { candidateId: 'a', baselineVersion: '2', currentVersion: '3', currentStatement: '当前正文', currentSnapshot: { statement: '当前正文' } } }, { name: 'activity' });
    const html = loaded.render();
    const footer = html.slice(html.indexOf('<footer class="ca-activity-detail-footer">'));
    expect(footer).toContain('保存更新');
    expect(footer).toContain('保存修改并校验');
    expect(footer).not.toContain('data-rebase="1"');
    expect(html).toContain('data-rebase="1"');
  });
});
