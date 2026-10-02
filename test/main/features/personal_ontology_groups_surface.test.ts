import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * 回归（round-1 F-r1-9）：resolveGroupContentAbsPathForUser 与
 * ontologyDocPathForUser 是全仓零引用的死导出，注释声称的 IPC 层 / chat-use
 * 消费方不存在，已删除。本测试锁住模块导出面：这两个名字不得回流；同时
 * 盯住同区块的兼容导出未被误删。
 *
 * 回归（P-r2-8，2026-10-02）：notifyGroupUpserted / notifyGroupDeleted 同为
 * 生产零消费的死导出（2026-09-29 重构后写路径在 po/store.ts 内部驱动渲染，
 * 外部 notify 无调用方），连同 store 侧唯一消费链 syncRenderForRelPath /
 * dropRenderForRelPath 一并删除；本测试原先把这两个死导出钉进「不得误删」
 * 契约（契约钉住待清理对象），现反转钉住「不得回流」。
 *
 * Mocks 同 personal_ontology_groups.test.ts：模块加载不拉 fastembed/sqlite-vec。
 */

let tmpDir: string;
let prevWs: string | undefined;

vi.mock('../../../src/main/features/kb_indexer', () => ({
  enqueue: () => {},
  kbEvents: { on: () => {}, off: () => {}, emit: () => {} },
}));

vi.mock('../../../src/main/features/search', () => ({
  upsertContext: () => {},
  dropContext: () => {},
}));

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cogseed-onto-surface-'));
  prevWs = process.env.COGSEED_WORKSPACE_ROOT;
  process.env.COGSEED_WORKSPACE_ROOT = tmpDir;
  vi.resetModules();
});

afterEach(() => {
  process.env.COGSEED_WORKSPACE_ROOT = prevWs;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('personal_ontology_groups › 导出面', () => {
  it('死导出 resolveGroupContentAbsPathForUser / ontologyDocPathForUser 不得回流（F-r1-9）', async () => {
    const groups = await import('../../../src/main/features/personal_ontology_groups');
    const surface = Object.keys(groups) as string[];
    expect(surface).not.toContain('resolveGroupContentAbsPathForUser');
    expect(surface).not.toContain('ontologyDocPathForUser');
  });

  it('相邻兼容导出仍在（未被连带误删）', async () => {
    const groups = await import('../../../src/main/features/personal_ontology_groups');
    expect(surfaceHas(groups, 'appendOntologyAudit')).toBe(true);
    expect(surfaceHas(groups, 'readGroupAudit')).toBe(true);
    expect(groups.ENTRY_SEPARATOR).toBeTypeOf('string');
  });

  it('死导出 notifyGroupUpserted / notifyGroupDeleted 不得回流（P-r2-8）', async () => {
    const groups = await import('../../../src/main/features/personal_ontology_groups');
    const surface = Object.keys(groups) as string[];
    expect(surface).not.toContain('notifyGroupUpserted');
    expect(surface).not.toContain('notifyGroupDeleted');
    // store 侧唯一消费链（po/store.ts）一并删除，防回流：需要外部重刷渲染
    // 副本时走写路径 touch / markRemoved，不要再按 relPath 加回导出口。
    const store = await import('../../../src/main/features/po/store');
    const storeSurface = Object.keys(store) as string[];
    expect(storeSurface).not.toContain('syncRenderForRelPath');
    expect(storeSurface).not.toContain('dropRenderForRelPath');
  });
});

function surfaceHas(mod: Record<string, unknown>, name: string): boolean {
  return Object.prototype.hasOwnProperty.call(mod, name);
}
