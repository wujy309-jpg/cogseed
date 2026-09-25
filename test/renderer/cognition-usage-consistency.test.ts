/**
 * US-602（2026-09-25 验收修复）渲染层：
 *  ① 列表「最近使用」与详情使用记录同口径——只算「真实使用」（白名单来自主进程），
 *     创建 / 版本 / 治理 / 撤销都不抬高最近使用；白名单缺失时 fail-closed；
 *  ② 「实际采用记录」只认有据回执：applied 才算采用，contradicted 单列，其余如实
 *     标「证据不足 · 未知」；宿主注入过的 usage_recorded 一律归「被带入任务」。
 */
import { describe, expect, it } from 'vitest';

import { renderCognition } from './helpers/cognition-renderer';

const ASSET = {
  id: 'aa-use',
  title: '性能归因规则',
  type: 'rule',
  status: 'active',
  scope: 'general',
  statement: '性能类提问需用真实日志做分层归因。',
  version: '3',
  activeVersion: '3',
  updatedAt: '2026-09-18T00:00:00.000Z',
};

function visibleText(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

const detail = (state: Record<string, unknown>) => renderCognition(
  { name: 'overview', assetId: ASSET.id },
  { assets: [ASSET], ...state },
);

const list = (state: Record<string, unknown>) => renderCognition(
  { name: 'overview' },
  { assets: [ASSET], ...state },
);

describe('列表与详情同口径（US-602 AC1/AC2/AC4）', () => {
  it('新建或只改过版本：两处都显示"最近无使用记录"，版本事件不进使用记录', () => {
    const proofs = [
      { id: 'p-1', kind: 'asset_created', occurredAt: '2026-09-18T01:00:00.000Z', refs: { assetId: ASSET.id } },
      { id: 'p-2', kind: 'asset_version', occurredAt: '2026-09-18T02:00:00.000Z', refs: { assetId: ASSET.id, version: '3' } },
      { id: 'p-3', kind: 'asset_version_selected', occurredAt: '2026-09-18T03:00:00.000Z', refs: { assetId: ASSET.id, version: '2' } },
    ];

    expect(visibleText(list({ proofs }))).toContain('最近无使用记录');
    const detailHtml = visibleText(detail({ proofs }));
    expect(detailHtml).toContain('还没有被真实使用过');
    expect(detailHtml).not.toContain('被带入任务 1 次');
  });

  it('被带入后：列表显示最近使用，详情同一条事件可定位会话', () => {
    const proofs = [
      {
        id: 'p-1', kind: 'projection_confirmed', occurredAt: '2026-09-18T05:00:00.000Z',
        refs: { assetId: ASSET.id, projectionId: 'proj-1', conversationId: 'conv-a' },
      },
    ];
    const state = {
      proofs,
      sources: [{ kind: 'conversation', items: [{ id: 'conv-a', kind: 'conversation', title: '季度复盘', status: 'ready' }] }],
    };

    expect(visibleText(list(state))).toContain('最近使用');
    const detailHtml = visibleText(detail(state));
    expect(detailHtml).toContain('被带入任务 1 次');
    expect(detailHtml).toContain('对话《季度复盘》里');
  });

  it('撤销事件进时间线但不计数；重复撤销不产生第二条', () => {
    const proofs = [
      {
        id: 'p-1', kind: 'projection_confirmed', occurredAt: '2026-09-18T05:00:00.000Z',
        refs: { assetId: ASSET.id, projectionId: 'proj-1', conversationId: 'conv-a' },
      },
      {
        id: 'p-2', kind: 'projection_revoked', occurredAt: '2026-09-18T06:00:00.000Z',
        refs: { assetId: ASSET.id, projectionId: 'proj-1', conversationId: 'conv-a' },
      },
    ];

    const detailHtml = visibleText(detail({ proofs }));
    expect(detailHtml).toContain('撤销');
    // 撤销不是使用：不抬高最近使用，也不进任何计数。
    expect(visibleText(list({ proofs }))).toContain('最近使用');
    expect(detailHtml).toContain('被带入任务 1 次');
    expect(detailHtml).not.toContain('被带入任务 2 次');
  });

  it('白名单缺失时 fail-closed（按空集处理，绝不回落成"不过滤"）', () => {
    const proofs = [
      { id: 'p-1', kind: 'asset_version', occurredAt: '2026-09-18T02:00:00.000Z', refs: { assetId: ASSET.id, version: '3' } },
    ];

    expect(visibleText(list({ proofs, realUsageKinds: [] }))).toContain('最近无使用记录');
    expect(visibleText(detail({ proofs, realUsageKinds: [] }))).toContain('还没有被真实使用过');
  });
});

describe('实际采用记录（US-602 AC5/AC6）', () => {
  const appliedReceipt = {
    id: 'aur-1', assetVersion: '3', taskRunId: 'turn-1', status: 'applied',
    evidenceKind: 'artifact',
    evidence: [{ kind: 'artifact_file', id: 'art-1', title: '归因报告.html' }],
    boundary: 'real', createdAt: '2026-09-18T07:00:00.000Z',
  };

  it('applied 回执显示为已实际采用，带版本、时间与证据来源名', () => {
    const html = visibleText(detail({ adoptionReceipts: { assetId: ASSET.id, items: [appliedReceipt] } }));

    expect(html).toContain('实际采用记录');
    expect(html).toContain('已实际采用');
    expect(html).toContain('v3');
    expect(html).toContain('产物');
    expect(html).toContain('归因报告.html');
    expect(html).toContain('实际采用 1 次');
    // 证据里的内部 id 不上屏。
    expect(html).not.toContain('art-1');
  });

  it('usage_unknown 如实标「证据不足 · 未知」且不计入实际采用', () => {
    const html = visibleText(detail({
      adoptionReceipts: {
        assetId: ASSET.id,
        items: [{ ...appliedReceipt, id: 'aur-2', status: 'usage_unknown', evidenceKind: 'none', evidence: [] }],
      },
    }));

    expect(html).toContain('证据不足 · 未知');
    expect(html).toContain('证据不足 1 次');
    expect(html).not.toContain('已实际采用');
    expect(html).not.toContain('实际采用 1 次');
  });

  it('contradicted 单列为被否定，不计入采用', () => {
    const html = visibleText(detail({
      adoptionReceipts: { assetId: ASSET.id, items: [{ ...appliedReceipt, id: 'aur-3', status: 'contradicted' }] },
    }));

    expect(html).toContain('被否定');
    expect(html).toContain('被否定 1 次');
    expect(html).not.toContain('已实际采用');
  });

  it('没有回执时说明还没有可核对的采用证据；宿主注入过也不算采用', () => {
    const proofs = [
      { id: 'p-1', kind: 'usage_recorded', occurredAt: '2026-09-18T05:00:00.000Z', refs: { assetId: ASSET.id, projectionId: 'proj-1', usageOutcome: 'injected' } },
    ];
    const html = visibleText(detail({ proofs, adoptionReceipts: { assetId: ASSET.id, items: [] } }));

    expect(html).toContain('还没有可核对的采用证据');
    expect(html).toContain('带进了上下文');
    expect(html).not.toContain('已实际采用');
    expect(html).not.toContain('被实际使用');
  });
});
