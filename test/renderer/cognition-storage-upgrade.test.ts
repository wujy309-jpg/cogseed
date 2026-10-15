import { describe, expect, it } from 'vitest';
import { loadCognitionAssets, renderCognition } from './helpers/cognition-renderer';
const report = { dryRun: true, mode: 'mirror', errors: [], assets: { total: 4 }, candidates: { recallMigrated: 3, poMigrated: 2 }, poValues: { total: 6 } };
describe('资产设置认知数据升级真实页面集成', () => {
  it('未检测时隐藏维护；健康兼容存储默认折叠并提供可选升级', () => {
    const initial = renderCognition({ name: 'settings' });
    expect(initial).not.toContain('认知数据升级');
    expect(initial).not.toContain('data-act="storage-activate"');
    const checked = renderCognition({ name: 'settings' }, { cognitionStorageUpgrade: { report } });
    expect(checked).not.toContain('ca-settings-tools');
    expect(checked).not.toContain('检测到数据问题');
    expect(checked).not.toContain('<details class="ui-accordion__item" open');
    expect(checked).not.toContain('data-act="storage-activate"');
    expect(checked).not.toMatch(/disabled[^>]*data-act="storage-activate"|data-act="storage-activate"[^>]*disabled/);
  });
  it('存储运行和失败状态不恢复已退役设置卡片', () => {
    for (const state of [{ report, running: true }, { report: { ...report, errors: ['blocked'] }, failed: true }, { report: { ...report, mode: 'unified', projectionPending: true } }]) {
      const html = renderCognition({ name: 'settings' }, { cognitionStorageUpgrade: state });
      for (const action of ['storage-check', 'storage-activate', 'storage-recover', 'storage-rollback']) expect(html).not.toContain(`data-act="${action}"`);
      expect(html).toContain('nightly-toggle');
    }
  });
  it('检查零写入，激活与回退转发既有 IPC，失败不能伪造成功', async () => {
    const calls: Array<[string, unknown]> = [];
    const fixture = loadCognitionAssets({}, { name: 'settings' }, { cogseed: { invoke: async (channel: string, payload: unknown) => {
      calls.push([channel, payload]); return report;
    } } });
    fixture.ns.reload = async () => {};
    await fixture.ns.actions.cognitionStorageUpgrade('check');
    expect(calls.filter(([channel]) => channel === 'cognition.migration.run')).toEqual([['cognition.migration.run', { dryRun: true, activate: false }]]);
    await fixture.ns.actions.cognitionStorageUpgrade('activate');
    expect(calls.filter(([channel]) => channel === 'cognition.migration.run')[1]).toEqual(['cognition.migration.run', { dryRun: false, activate: true }]);
    await fixture.ns.actions.cognitionStorageUpgrade('rollback');
    expect(calls.filter(([channel]) => channel === 'cognition.migration.run')[2]).toEqual(['cognition.migration.run', { rollback: true }]);
    fixture.window.cogseed.invoke = async () => { throw new Error('storage failure'); };
    await fixture.ns.actions.cognitionStorageUpgrade('activate');
    expect(fixture.store.cognitionStorageUpgrade.failed).toBe(true);
    expect(fixture.render()).not.toContain('data-act="storage-activate"');
  });
});
