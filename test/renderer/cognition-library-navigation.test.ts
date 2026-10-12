import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { loadCognitionAssets } from './helpers/cognition-renderer';

const appSource = readFileSync(resolve(__dirname, '../../src/renderer/modules/cognition-assets/app.js'), 'utf8');
const asset = (id: string) => ({ id, type: 'template', title: `模板 ${id}`, statement: '核对目标、事实、风险与下一步行动。', scope: 'report', status: 'active', version: '1', activeVersion: '1', updatedAt: '2026-10-11T00:00:00Z' });

function delegatedFixture(route: Record<string, unknown> = { name: 'activity' }) {
  const confirm = vi.fn(async () => false);
  const loaded = loadCognitionAssets({ assets: [asset('asset-a'), asset('asset-b')] }, route, {
    matchMedia: () => ({ matches: true, addEventListener() {} }), uiConfirm: confirm,
  });
  const handlers = new Map<string, Array<(event: unknown) => Promise<void>>>();
  const root = loaded.context.document.getElementById('ca-root');
  root.addEventListener = (kind: string, handler: (event: unknown) => Promise<void>) => {
    handlers.set(kind, [...(handlers.get(kind) || []), handler]);
  };
  root.querySelector = () => null;
  loaded.context.document.readyState = 'loading';
  loaded.context.document.addEventListener = () => {};
  // Expose only the real event binder. Bootstrap/background requests are outside
  // this interaction test; every click below runs the actual delegated handler.
  loaded.ns.notify = vi.fn();
  const instrumented = appSource.replace('  let booted = false;', '  let booted = false;\n  NS.__bindLibraryEventsForTest = bindEvents;');
  vm.runInContext(instrumented, loaded.context, { filename: 'cognition-assets/app.js' });
  loaded.ns.__bindLibraryEventsForTest(root);
  delete loaded.ns.__bindLibraryEventsForTest;
  const click = async (act: string, id: string, form?: { dataset: { assetEditId: string } }) => {
    const node: any = {
      dataset: act === 'data-go-asset' ? { goAsset: id } : { act, id, kind: 'agent' },
      getAttribute: () => null,
      classList: { add() {}, remove() {} }, setAttribute() {}, removeAttribute() {},
      closest: (selector: string) => selector === '[data-go-asset]' ? (act === 'data-go-asset' ? node : null)
        : selector === '[data-act]' ? node : selector === '.ca-asset-edit' ? form || null : null,
    };
    await handlers.get('click')![0]({ target: node });
  };
  return { ...loaded, click, confirm };
}

describe('我的认知外部导航与范围草稿委托', () => {
  it.each(['data-go-asset', 'open-asset', 'go-inbox-asset'])('%s显式资产入口清除旧筛选、定位分页并打开窄屏抽屉', async action => {
    const loaded = delegatedFixture();
    loaded.store.assets = [...Array.from({ length: 25 }, (_, index) => asset(`asset-${String(index).padStart(2, '0')}`)), asset('zz-target')];
    Object.assign(loaded.ns.library.state, { query: '排除全部', type: 'rule', scope: 'restricted', page: 5, closed: true, drawer: false });
    await loaded.click(action, 'zz-target');
    expect(loaded.store.route).toMatchObject({ name: 'overview', assetId: 'zz-target' });
    expect(loaded.ns.library.state).toMatchObject({ query: '', type: '', scope: '', page: 2, closed: false, drawer: true });
    const html = loaded.render();
    expect(html).toContain('ca-library-detail is-drawer-open');
    expect(html).toContain('role="dialog" aria-modal="true"');
    expect(html).toContain('data-act="library-select" data-id="zz-target"');
  });

  it('会话全局资产入口在回读取得新资产后重新定位分页，不能停留在空旧列表', async () => {
    const loaded = delegatedFixture();
    loaded.store.assets = [];
    loaded.ns.reload = vi.fn(async () => {
      loaded.store.assets = [...Array.from({ length: 25 }, (_, index) => asset(`asset-${String(index).padStart(2, '0')}`)), asset('zz-created')];
    });
    Object.assign(loaded.ns.library.state, { query: '旧搜索', type: 'rule', drawer: false });
    expect(loaded.window.openCognitionAssetById('zz-created')).toBe(true);
    await Promise.resolve();
    expect(loaded.ns.reload).toHaveBeenCalledOnce();
    expect(loaded.store.route).toMatchObject({ name: 'overview', assetId: 'zz-created' });
    expect(loaded.ns.library.state).toMatchObject({ query: '', type: '', page: 2, drawer: true });
    expect(loaded.render()).toContain('data-act="library-select" data-id="zz-created"');
  });

  it('仅点击取消对象限制也触发未保存确认，取消离开保留草稿、确认放弃才清除', async () => {
    const loaded = delegatedFixture({ name: 'overview', assetId: 'asset-a', assetEdit: '1' });
    loaded.store.assets[0].scopePolicy = { agentIds: ['agent-private'] };
    loaded.store.assetEditDrafts = { 'asset-a': { baseVersion: '1', baseActiveVersion: '1' } };
    expect(loaded.ns.library.state.dirty).toBe(false);
    await loaded.click('asset-scope-unrestrict', 'asset-a', { dataset: { assetEditId: 'asset-a' } });
    expect(loaded.ns.library.state.dirty).toBe(true);
    expect(loaded.store.assetEditDrafts['asset-a'].scopeUnrestrict).toEqual(['agent']);
    expect(loaded.store.assets[0].scopePolicy).toEqual({ agentIds: ['agent-private'] });
    await loaded.click('library-select', 'asset-b');
    expect(loaded.confirm).toHaveBeenCalledOnce();
    expect(loaded.store.route).toMatchObject({ assetId: 'asset-a', assetEdit: '1' });
    expect(loaded.store.assetEditDrafts['asset-a'].scopeUnrestrict).toEqual(['agent']);
    loaded.confirm.mockResolvedValue(true);
    await loaded.click('library-select', 'asset-b');
    expect(loaded.confirm).toHaveBeenCalledTimes(2);
    expect(loaded.store.route).toMatchObject({ assetId: 'asset-b', assetEdit: '' });
    expect(loaded.store.assetEditDrafts).not.toHaveProperty('asset-a');
    expect(loaded.store.assets[0].scopePolicy).toEqual({ agentIds: ['agent-private'] });
  });
});
