import { describe, expect, it } from 'vitest';
import { loadCognitionAssets, renderCognition } from './helpers/cognition-renderer';
const report = { dryRun: true, mode: 'mirror', errors: [], assets: { total: 4 }, candidates: { recallMigrated: 3, poMigrated: 2 }, poValues: { total: 6 } };
describe('资产设置认知数据升级真实页面集成', () => {
  it('默认只提供检查，升级不可用；成功核对后显示计数并允许升级', () => {
    const initial = renderCognition({ name: 'settings' });
    expect(initial).toContain('认知数据升级'); expect(initial).toContain('ui-accordion');
    expect(initial).toMatch(/disabled[^>]*data-act="storage-activate"|data-act="storage-activate"[^>]*disabled/);
    const checked = renderCognition({ name: 'settings' }, { cognitionStorageUpgrade: { report } });
    expect(checked).toContain('资产 4 条、候选 5 条、本体值 6 条');
    expect(checked).not.toMatch(/disabled[^>]*data-act="storage-activate"|data-act="storage-activate"[^>]*disabled/);
  });
  it('处理中禁用动作，失败保留检查入口，兼容副本失败明确显示主档已生效', () => {
    const running = renderCognition({ name: 'settings' }, { cognitionStorageUpgrade: { report, running: true } });
    expect(running).toContain('正在核对和处理');
    const failed = renderCognition({ name: 'settings' }, { cognitionStorageUpgrade: { report: { ...report, errors: ['blocked'] }, failed: true } });
    expect(failed).toContain('未确认升级成功');
    const pending = renderCognition({ name: 'settings' }, { cognitionStorageUpgrade: { report: { ...report, mode: 'unified', projectionPending: true } } });
    expect(pending).toContain('统一存储已生效'); expect(pending).toContain('data-act="storage-recover"'); expect(pending).toContain('data-act="storage-rollback"');
    const partial = renderCognition({ name: 'settings' }, { cognitionStorageUpgrade: { report: { mode: 'mirror', errors: ['blocked'], assets: { total: 0 } }, failed: true } });
    expect(partial).toContain('未确认升级成功');
    expect(partial).not.toContain('已核对：');
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
    expect(fixture.render()).toContain('未确认升级成功');
  });
});
