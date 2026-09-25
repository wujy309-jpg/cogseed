import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const source = fs.readFileSync(path.join(__dirname, '../../src/renderer/modules/conversation.js'), 'utf8');

describe('conversation Recall citations', () => {
  it('keeps recall_citations in the persisted message record and renders the feedback footer', () => {
    // 本地产品决定（保留版）：recall_citations 在消息透传 + 渲染「提供给本次回答的记忆」
    // footer（有帮助/需改进反馈走 recall.usage.feedback）。远端曾按「后端可见即可」移除
    // footer，合并时保留本地版（用户实际在使用该反馈 UI）。
    expect(source).toContain('recall_citations');
    expect(source).toContain('_renderRecallCitationsHtml');
    expect(source).toContain('_hydrateRecallCitations');
    expect(source).toContain('chat-recall-citations');
    expect(source).toContain('data-recall-feedback');
    expect(source).toContain('recall.usage.feedback');
  });
});
describe('conversation asset approval card (specs/008 US-406)', () => {
  // 卡片本体（渲染/编辑/三态）已抽到 `modules/chat-asset-approval.js`，由
  // `test/renderer/chat-asset-approval-card.test.ts` 真实调用测试。这里只钉
  // conversation.js 这一侧：载荷透传、两个挂载点、已挂守卫，以及那个模块真的被加载。
  const cardSource = fs.readFileSync(path.join(__dirname, '../../src/renderer/modules/chat-asset-approval.js'), 'utf8');
  const indexHtml = fs.readFileSync(path.join(__dirname, '../../src/renderer/index.html'), 'utf8');

  it('mounts the card in both history and live paths, with a dedupe guard', () => {
    // 卡片挂载点与透传：历史重载与实时渲染两条路都要挂（只挂一条会让刷新后卡片消失）。
    expect(source).toContain('asset_change_approval_card');
    expect(source).toContain('_mountAssetApprovalCard');
    // 已挂则不再挂（消息重渲染时不重复插入）。
    expect(source).toContain("if (gm.asset_change_approval_card && !el.querySelector('.chat-asset-approval')) return false;");
    // 挂载点委托给独立模块；模块缺席要吵（以前这里静默不挂，卡片直接消失）。
    expect(source).toContain('ChatAssetApproval.mount(host, payload)');
    expect(source).toContain('chat-asset-approval module missing');
    // 模块必须真的被 index.html 加载，且在 conversation.js 之前。
    expect(indexHtml).toContain('./modules/chat-asset-approval.js');
    expect(indexHtml.indexOf('./modules/chat-asset-approval.js')).toBeLessThan(indexHtml.indexOf('./modules/conversation.js'));
  });

  it('wires the three decisions and re-checks the version on confirm', () => {
    // 三态按钮名与已定口径一致（确认更新 / 稍后处理 / 拒绝）。
    for (const action of ['confirm', 'defer', 'reject']) {
      expect(cardSource).toContain(`'data-asset-approval-action': '${action}'`);
    }
    expect(cardSource).toContain("recall.assets.approval.decide");
    // 历史重载要查一次状态，否则已处置的卡片会又变回"待处理"。
    expect(cardSource).toContain("recall.assets.approval.read");
    // 版本重检不一致：卡片保持待处理 + 如实说明，不静默套用。
    expect(cardSource).toContain('versionConflict');
    expect(cardSource).toContain("state: 'pending'");
    // 拟生效内容可编辑，编辑后的值随确认一起回传。
    expect(cardSource).toContain("'data-asset-approval-field'");
    // 字段值来自**提议记录**（消息载荷里只有摘要）：不查内容"可编辑"就是空话
    // ——2026-09-25 真机抓到卡片上「正文」下面是空的。
    expect(cardSource).toContain('proposal.beforeValues');
    expect(cardSource).toContain('proposal.payload');
    // 当前值与拟生效值都显示出来，用户才判断得了要不要批。
    expect(cardSource).toContain('recall.asset_approval.current_label');
  });

  it('uses the shared component seams instead of page-local controls', () => {
    // 卡片不许自绘按钮/文本域（shared-ui-adoption-guard 的同一要求）。
    expect(cardSource).toContain('uiButton({');
    expect(cardSource).toContain('uiTextarea({');
    expect(cardSource).toContain('uiTag({');
    expect(cardSource).not.toContain('<button data-asset-approval');
  });
});
