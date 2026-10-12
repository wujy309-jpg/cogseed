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
  it('处理中禁用动作，失败保留检查入口，兼容副本失败明确显示主档已生效', () => {
    const running = renderCognition({ name: 'settings' }, { cognitionStorageUpgrade: { report, running: true } });
    expect(running).toContain('正在核对和处理');
    const failed = renderCognition({ name: 'settings' }, { cognitionStorageUpgrade: { report: { ...report, errors: ['blocked'] }, failed: true } });
    expect(failed).toContain('数据检查未完成');
    expect(failed).toContain('需要核对');
    expect(failed).toMatch(/disabled[^>]*data-act="storage-activate"|data-act="storage-activate"[^>]*disabled/);
    const pending = renderCognition({ name: 'settings' }, { cognitionStorageUpgrade: { report: { ...report, mode: 'unified', projectionPending: true } } });
    expect(pending).toContain('统一存储已生效'); expect(pending).toContain('data-act="storage-recover"'); expect(pending).toContain('data-act="storage-rollback"');
    const partial = renderCognition({ name: 'settings' }, { cognitionStorageUpgrade: { report: { mode: 'mirror', errors: ['blocked'], assets: { total: 0 } }, failed: true } });
    expect(partial).toContain('数据检查未完成');
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
    expect(fixture.render()).toContain('数据维护未完成');
  });
  it('旧记忆整体读取失败保留重试；来源异常不冒充零条待迁移', () => {
    const failed = renderCognition({ name: 'settings' }, { legacyMemoryMigration: { failed: true } });
    expect(failed).toContain('检查未完成');
    expect(failed).toContain('data-act="legacy-memory-refresh"');
    expect(failed).not.toContain('0 条待迁移');
    const unavailable = renderCognition({ name: 'settings' }, { legacyMemoryMigration: { preview: { items: [], sources: { memory: { status: 'unavailable' } } } } });
    expect(unavailable).toContain('来源需核对');
    expect(unavailable).not.toContain('0 条待迁移');
  });
});
