/** 治理动作进入同一条变化详情；列表只负责定位，不在主列表堆放处理表单。 */
import { describe, expect, it } from 'vitest';
import { renderCognition } from './helpers/cognition-renderer';
import { groupCognitionInbox } from '../../src/main/features/recall/formal-assets/inbox';
const conflict = { id: 'conflict:cand-1', kind: 'classification_conflict', urgency: 'confirm', title: '同一句话有两种归属', candidateId: 'cand-1', detail: '需要核对归属', actions: ['claim', 'reject', 'defer'] };
const other = { id: 'rule-boundary:asset-a', kind: 'rule_boundary_missing', urgency: 'low_disturbance', title: '规则适用范围不清', assetId: 'asset-a', boundary: { applicableWhen: ['项目排查'], forbiddenWhen: [] }, actions: ['set_boundary'] };
const state = () => ({ inbox: [conflict, other], inboxGroups: groupCognitionInbox([conflict, other] as never) });
describe('需要关注中的共同治理详情', () => {
  it('主列表显示变化，不直接展开选择归属和补范围表单', () => {
    const html = renderCognition({ name: 'activity' }, state());
    expect(html).toContain('同一句话有两种归属');
    expect(html).toContain('规则适用范围不清');
    expect(html).not.toContain('data-inbox-boundary-form');
    expect(html).toContain('data-id="inbox:conflict:cand-1"');
  });
  it('选择具体冲突后保留后端提供的选择与拒绝操作，不展示无关事项', () => {
    const html = renderCognition({ name: 'activity', inboxId: conflict.id }, state());
    expect(html).toContain(conflict.title);
    expect(html).toContain('data-act="inbox-conflict-claim"');
    expect(html).toContain(conflict.id);
    expect(html.slice(html.indexOf('<aside class="ca-activity-detail'))).not.toContain(other.title);
  });
  it('范围不清的详情保留条件输入，避免点击空操作直接失败', () => {
    const html = renderCognition({ name: 'activity', inboxId: other.id }, state());
    expect(html).toContain('data-inbox-boundary-form');
    expect(html).toContain('data-act="inbox-boundary-save"');
    expect(html).toContain('项目排查');
    expect(html.slice(html.indexOf('<aside class="ca-activity-detail'))).not.toContain(conflict.title);
  });
  it('治理清单部分读失败仍可看到已读到的建议，不声称没有待办', () => {
    const html = renderCognition({ name: 'activity' }, { ...state(), inboxError: 'offline' });
    expect(html).toContain('部分变化未能读取');
    expect(html).toContain(conflict.title);
    expect(html).toContain('data-act="refresh"');
  });
  it('已经移出的旧详情不伪造处理成功，也不打开另一条变化', () => {
    const html = renderCognition({ name: 'activity', inboxId: 'conflict:old' }, state());
    expect(html).toContain('这条变化暂时无法定位');
    expect(html).not.toContain('data-act="inbox-conflict-claim"');
  });
});
