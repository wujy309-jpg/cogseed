import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 渲染层不得再维护后端判定的镜像副本（2026-09-30 认知资产质检 R1）：
 *
 * core.js 曾把 fuseStatements / resolveMergeChainTarget /
 * isAutoCaptureEligible / dedupRefs 四个后端函数移植到前端并挂上
 * CogAssets 命名空间——迁移残留，全仓零消费，且常量口径随后端各自演进
 * 已经分叉（前端 isAutoCaptureEligible 还认 risk/capabilities，后端
 * candidate-service.ts:888 只看 status）。留着的风险是：哪天有人从
 * CogAssets 上取到它，拿的是一份过时的判定。删除后用这条门禁钉住：
 * 四个镜像名不得再出现在 CogAssets 上，也不得再定义回 core.js。
 *
 * 同时守住删除的边界：core.js 其余导出（api/store/文案与加载入口）
 * 必须原样健在，防止「删死代码删崩活代码」。
 */

const globalScope = globalThis as unknown as Record<string, unknown>;
const NS = (() => {
  const stub: Record<string, unknown> = {};
  globalScope.window = {
    CogAssets: stub,
    cogseed: { invoke: async () => ({ ok: true }) },
  };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../../src/renderer/modules/cognition-assets/core.js');
  return stub;
})();

const coreSource = readFileSync(
  resolve(__dirname, '../../src/renderer/modules/cognition-assets/core.js'),
  'utf8',
);

describe('渲染层不再暴露后端判定镜像（质检 R1）', () => {
  it('CogAssets 上四个镜像导出已移除', () => {
    expect(NS.fuseStatements).toBeUndefined();
    expect(NS.resolveMergeChainTarget).toBeUndefined();
    expect(NS.isAutoCaptureEligible).toBeUndefined();
    expect(NS.dedupRefs).toBeUndefined();
  });

  it('core.js 源码不再定义镜像实现，只留指向后端真源的注释', () => {
    expect(coreSource).not.toMatch(/function\s+(fuseStatements|resolveMergeChainTarget|isAutoCaptureEligible|dedupRefs)\s*\(/);
    expect(coreSource).toContain('statement-fusion.ts');
    expect(coreSource).toContain('candidate-service.ts');
  });

  it('删除边界：core.js 的活导出（工具/API/加载入口）原样健在', () => {
    expect(typeof NS.T).toBe('function');
    expect(typeof NS.esc).toBe('function');
    expect(typeof NS.truncateText).toBe('function');
    expect(typeof NS.fmtDate).toBe('function');
    expect(NS.api && typeof (NS.api as { call?: unknown }).call).toBe('function');
    expect(NS.store).toBeTruthy();
    expect(typeof (NS as unknown as { loadKstarEpisode?: unknown }).loadKstarEpisode).toBe('function');
    expect(typeof (NS as unknown as { loadExperiences?: unknown }).loadExperiences).toBe('function');
  });
});
