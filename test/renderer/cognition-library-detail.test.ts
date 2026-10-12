import { describe, expect, it } from 'vitest';
import { loadCognitionAssets } from './helpers/cognition-renderer';

const asset = { id: 'library-a', type: 'rule', title: '验收规则', statement: '产出后检查来源。', status: 'active', version: '3', activeVersion: '2', scope: 'review', applicableWhen: ['审核时'], forbiddenWhen: ['来源失效'], evidenceRefs: [], scopePolicy: { agentIds: ['commander'], workspaceIds: ['workspace-a'], purposeTags: ['review'] } };
const versions = { assetId: asset.id, versions: [{ version: '2', snapshot: { title: asset.title, statement: asset.statement } }, { version: '1', snapshot: { title: asset.title, statement: '旧正文' } }] };

describe('我的认知：同区资产详情与编辑', () => {
  it('正文与范围在前，来源版本记录下钻，真实操作保留在固定页脚', () => {
    const loaded = loadCognitionAssets({ assets: [asset], assetVersions: versions, assetScopeOptions: { status: 'ready', agents: [], spaces: [{ space_id: 'workspace-a', name: '产品工作区' }] } });
    const html = loaded.ns.renderLibraryAssetDetail(asset, {});
    expect(html.indexOf('ca-library-content')).toBeLessThan(html.indexOf('ca-library-scope'));
    expect(html.indexOf('ca-library-scope')).toBeLessThan(html.indexOf('ca-library-deep-links'));
    expect(loaded.ns.renderLibraryDialog('sources', asset.id)).toContain('没有可追溯的来源记录');
    expect(html).toContain('产品工作区');
    expect(html).toContain('主助手');
    expect(html).toContain('审核时');
    expect(html).toContain('来源失效');
    expect(loaded.ns.renderLibraryDialog('versions', asset.id)).toContain('data-prototype-version-select');
    expect(html).toContain('library-show-sources');
    expect(html).toContain('library-show-versions');
    expect(html).toContain('library-show-records');
    const footer = html.slice(html.indexOf('<footer'));
    expect(footer).not.toContain('data-act="asset-use-in-chat"');
    expect(footer).toContain('data-act="edit-asset"');
    expect(footer).toContain('data-action="pause"');
    expect(footer).toContain('data-act="library-show-merge"');
  });

  it('没有额外对象限制时显示任务范围摘要，避免重复四行未限定', () => {
    const loaded = loadCognitionAssets({ assets: [asset] });
    const html = loaded.ns.renderLibraryAssetDetail({ ...asset, type: 'fact', scope: 'code', scopePolicy: undefined }, {});
    const scope = html.split('class="ca-library-scope"')[1]?.split('</section>')[0] || '';
    expect(scope).toContain('编程');
    expect(scope).toContain('未额外限定使用对象');
    expect(scope).not.toContain('ca-prototype-kv');
  });

  it('压缩范围展示仍保留明确禁用与坏数据提示，不冒充无额外限制', () => {
    const loaded = loadCognitionAssets({ assets: [asset] });
    for (const [scopePolicy, expected] of [[{ agentIds: [] }, '明确禁止任何对象使用'], [{ workspaceIds: 'bad' }, '范围信息不完整，请核对']]) {
      const html = loaded.ns.renderLibraryAssetDetail({ ...asset, scopePolicy }, {});
      const scope = html.split('class="ca-library-scope"')[1]?.split('</section>')[0] || '';
      expect(scope).toContain(expected);
      expect(scope).not.toContain('未额外限定使用对象');
    }
  });

  it('编辑保持初始版本基线与已输入草稿，后台新版本和失败回执不覆盖它们', () => {
    const loaded = loadCognitionAssets({ assets: [asset], assetScopeOptions: { status: 'error', agents: [], spaces: [] } });
    const initial = loaded.ns.renderLibraryAssetDetail(asset, { assetEdit: '1' });
    expect(initial).toContain('data-asset-edit-id="library-a"');
    expect(loaded.store.assetEditDrafts[asset.id]).toMatchObject({ baseVersion: '3', baseActiveVersion: '2' });
    Object.assign(loaded.store.assetEditDrafts[asset.id], { statement: '尚未保存的新正文', saveError: '在用版本已变化，请核对。' });
    const html = loaded.ns.renderLibraryAssetDetail({ ...asset, version: '4', activeVersion: '4' }, { assetEdit: '1' });
    expect(loaded.store.assetEditDrafts[asset.id]).toMatchObject({ baseVersion: '3', baseActiveVersion: '2' });
    expect(html).toContain('尚未保存的新正文');
    expect(html).toContain('role="alert"');
    expect(html).toContain('在用版本已变化，请核对。');
    expect(html).toContain('当前不能更改对象限制');
    expect(html).toContain('data-act="asset-edit-save"');
    expect(html).toContain('data-act="asset-edit-cancel"');
  });

  it('终态保留来源和版本追溯，隐藏使用编辑以及版本修改动作', () => {
    const ended = { ...asset, status: 'archived' };
    const loaded = loadCognitionAssets({ assets: [ended], assetVersions: versions }, { assetVersionId: '1' });
    const html = loaded.ns.renderLibraryAssetDetail(ended, {});
    expect(loaded.ns.renderLibraryDialog('versions', asset.id)).toContain('旧正文');
    expect(loaded.ns.renderLibraryDialog('versions', asset.id)).toContain('差异摘要');
    for (const action of ['asset-use-in-chat', 'edit-asset', 'select-asset-version', 'edit-from-version', 'merge-asset-version', 'delete-asset-version']) expect(html).not.toContain(`data-act="${action}"`);
  });

  it('紧凑手动添加使用原生类型和中文任务范围，规则边界和真实提交控件都在表单内', () => {
    const loaded = loadCognitionAssets();
    const html = loaded.ns.renderLibraryManualForm();
    expect(html).toContain('data-manual-candidate');
    expect(html).toContain('id="ca-manual-type"');
    expect(html).toContain('data-f="type"');
    expect(html).toMatch(/type="hidden"[^>]*data-f="scope"/);
    expect(html).toContain('value="general"');
    expect(html).toContain('data-manual-rule-boundaries');
    expect(html).toContain('data-f="applicable"');
    expect(html).toContain('data-f="forbidden"');
    expect(html.slice(html.indexOf('<footer'))).toContain('data-act="cand-create-save"');
  });

  it('保存冲突提供核对最新版本入口，并保持草稿正文和初始编辑基线', () => {
    const loaded = loadCognitionAssets({ assets: [asset], assetEditDrafts: { [asset.id]: { statement: '我的草稿', baseVersion: '2', baseActiveVersion: '1', saveConflict: true, saveError: '在用版本变化' } } });
    const html = loaded.ns.renderLibraryAssetDetail(asset, { assetEdit: '1' });
    expect(html).toContain('data-act="library-review-conflict"');
    expect(html).toContain('核对最新版本');
    expect(html).toContain('我的草稿');
    expect(loaded.store.assetEditDrafts[asset.id].baseActiveVersion).toBe('1');
  });

  it('删除恢复以服务端保留期为准，缺失、未知和过期均不允许恢复', () => {
    const deleted = { ...asset, status: 'deleted' };
    for (const [record, allowed] of [
      [null, false],
      [{ id: asset.id, retentionUnknown: true, retentionDaysLeft: null, restorable: false }, false],
      [{ id: asset.id, retentionUnknown: false, retentionDaysLeft: 0, restorable: false }, false],
      [{ id: asset.id, retentionUnknown: false, retentionDaysLeft: 12, restorable: true }, true],
    ] as const) {
      const loaded = loadCognitionAssets({ assets: [deleted], deletedAssets: record ? { loading: false, stale: false, items: [record] } : null });
      const html = loaded.ns.renderLibraryAssetDetail(deleted, {});
      const restore = html.match(/<button[^>]*data-action="restore"[^>]*>/)?.[0] || '';
      expect(restore).toBeTruthy();
      expect(restore.includes('disabled')).toBe(!allowed);
      if (allowed) expect(html).toContain('12');
      if (!record) expect(html).toContain('尚未读到有效的删除保留期记录');
    }
  });

  it('模板占位符从实际正文提取去重并转义，方法只展示说明而不声称技能已安装', () => {
    const loaded = loadCognitionAssets();
    const html = loaded.ns.renderLibraryAssetDetail({ ...asset, type: 'template', statement: '{{项目}} {{责任人}} {{项目}} {{<script>}}' }, {});
    const placeholders = html.split('ca-library-template-slots')[1]?.split('</p>')[0] || '';
    expect(placeholders).toContain('{{项目}}、{{责任人}}、{{&lt;script&gt;}}');
    expect(placeholders).not.toContain('<script>');
    expect(loaded.ns.renderLibraryAssetDetail({ ...asset, type: 'skill_method' }, {})).toContain('内容说明不代表已安装可执行技能');
  });

  it('相关变化按真实目标和关联ID匹配，终态候选不再列为待确认', () => {
    const pending = { status: 'pending_review', capabilities: { countsAsPending: true }, suggestedType: 'rule', judgment: '更新正文' };
    const loaded = loadCognitionAssets({ assets: [asset], candidates: [
      { ...pending, id: 'target', targetAssetId: asset.id, summary: '修改现有规则' },
      { ...pending, id: 'pair', pair: [asset.id, 'other'], summary: '核对重复条目' },
      { ...pending, id: 'done', targetAssetId: asset.id, summary: '已完成变化', status: 'confirmed' },
      { ...pending, id: 'unrelated', targetAssetId: 'other', summary: '其他变化' },
    ], inbox: [{ id: 'linked-inbox', assetIds: [asset.id], title: '范围需要核对' }] });
    const html = loaded.ns.renderLibraryAssetDetail(asset, {});
    expect(html).toContain('修改现有规则');
    expect(html).toContain('核对重复条目');
    expect(html).toContain('data-act="library-open-inbox"');
    expect(html).toContain('范围需要核对');
    expect(html).not.toContain('已完成变化');
    expect(html).not.toContain('其他变化');
  });

  it('无论有无当前对话或来源，资产详情都不再提供对话挂载入口', () => {
    const evidenceAsset = { ...asset, evidenceRefs: [{ kind: 'conversation', id: 'source-a', title: '来源对话' }] };
    for (const [libraryConversation, evidenceRefs] of [
      [{}, evidenceAsset.evidenceRefs, false],
      [{ conversationId: 'chat-a', error: 'unavailable' }, evidenceAsset.evidenceRefs, false],
      [{ conversationId: 'chat-a' }, [], false],
      [{ conversationId: 'chat-a' }, [{ kind: 'conversation', id: 'missing' }], false],
      [{ conversationId: 'chat-a' }, evidenceAsset.evidenceRefs, true],
    ] as const) {
      const loaded = loadCognitionAssets({ assets: [evidenceAsset], libraryConversation });
      const html = loaded.ns.renderLibraryAssetDetail({ ...evidenceAsset, evidenceRefs }, {});
      const use = html.match(/<button[^>]*data-act="asset-use-in-chat"[^>]*>/)?.[0] || '';
      expect(use).toBe('');
      expect(html).not.toContain('暂不能带入当前对话');
    }
  });

  it('手动添加从真实目录展示使用对象，默认不额外限制且不虚构个人工作空间', () => {
    const loaded = loadCognitionAssets({ assetScopeOptions: { status: 'ready', agents: [{ agent_id: 'agent-real', name: '评审助手' }], spaces: [{ space_id: 'ws-real', name: '产品团队' }] } });
    const html = loaded.ns.renderLibraryManualForm();
    expect(html).toContain('评审助手');
    expect(html).toContain('产品团队');
    expect(html).toContain('data-manual-scope-mode="agentIds"');
    expect(html).toContain('data-manual-scope-mode="workspaceIds"');
    expect(html.match(/value="keep" selected/g)).toHaveLength(2);
    expect(html.match(/<select[^>]*data-manual-scope-kind="agentIds"[^>]*>/)?.[0]).toContain('disabled');
    expect(html.match(/<select[^>]*data-manual-scope-kind="workspaceIds"[^>]*>/)?.[0]).toContain('disabled');
    expect(html).not.toContain('ws-personal');
    expect(html).not.toContain('value="commander"');
    expect(html).not.toContain('data-f="spaceId"');
  });

  it('手动范围草稿重绘后保持restrict和真实ID选择，两维分别处理', () => {
    const loaded = loadCognitionAssets({ assetScopeOptions: { status: 'ready', agents: [{ agent_id: 'agent-a', name: '助手 A' }, { agent_id: 'agent-b', name: '助手 B' }], spaces: [{ space_id: 'ws-a', name: '团队 A' }] } });
    loaded.store.libraryView.manualScope = { agentIds: { mode: 'restrict', ids: ['agent-b'] }, workspaceIds: { mode: 'keep', ids: [] } };
    const html = loaded.ns.renderLibraryManualForm();
    expect(html).toContain('class="details ca-manual-scope-editor" open');
    expect(html).toMatch(/option value="agent-b" selected/);
    expect(html).toContain('<option value="agent-a">');
    expect(html.match(/<select[^>]*data-manual-scope-kind="agentIds"[^>]*>/)?.[0]).not.toContain('disabled');
    expect(html.match(/<select[^>]*data-manual-scope-kind="workspaceIds"[^>]*>/)?.[0]).toContain('disabled');
    expect(loaded.ns.renderLibraryManualForm()).toBe(html);
  });

  it('目录未就绪时禁用所有对象模式和复选框，提供真实重试入口且保留范围草稿', () => {
    const loaded = loadCognitionAssets({ assetScopeOptions: { status: 'error', agents: [{ agent_id: 'agent-old', name: '上次的助手' }], spaces: [{ space_id: 'ws-old', name: '上次的团队' }] } });
    loaded.store.libraryView.manualScope = { agentIds: { mode: 'restrict', ids: ['agent-old'] }, workspaceIds: { mode: 'restrict', ids: ['ws-old'] } };
    const html = loaded.ns.renderLibraryManualForm();
    expect(html).toContain('data-act="asset-scope-options-retry"');
    expect(html).toContain('对象目录尚未就绪');
    const controls = [...html.matchAll(/<(?:select|input)[^>]*data-manual-scope-(?:mode|kind)=[^>]*>/g)].map(match => match[0]);
    expect(controls).toHaveLength(4);
    expect(controls.every(control => control.includes('disabled'))).toBe(true);
    expect(loaded.store.libraryView.manualScope.agentIds.ids).toEqual(['agent-old']);
  });
});
