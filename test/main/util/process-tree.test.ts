import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

/**
 * `util/process-tree.ts` 是 `managed-stdio-process` 等路径使用的终止实现
 * （`local_agents/backends/base.ts` 另有一份更完整的实现，返回
 * `termination-unverified` 结局）。
 *
 * 这里锁住审查（对照 Orkas）后补上的两点：
 *   1. taskkill 是有界工具 → spawn 必须带 timeout（超时即失败，不再无限等）
 *   2. 树终止失败必须**留痕**：降级为直接 kill 的同时打一条脱敏 warn
 *      （只带平台与原因，不带 PID / 命令 / 路径），否则只剩静默降级
 */

const { warn } = vi.hoisted(() => ({ warn: vi.fn() }));
vi.mock('../../../src/main/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() }),
}));

const { killProcessTree } = await import('../../../src/main/util/process-tree');

function killerStub() {
  const killer: any = new EventEmitter();
  killer.unref = vi.fn();
  return killer;
}

function childStub(pid = 2468) {
  return { pid, kill: vi.fn() } as any;
}

beforeEach(() => {
  warn.mockClear();
});

describe('killProcessTree (util)', () => {
  it('passes a bounded timeout to taskkill and no-ops on a clean exit', async () => {
    const killer = killerStub();
    const spawnFn = vi.fn(() => killer) as any;
    const child = childStub();

    killProcessTree(child, 'SIGKILL', { platform: 'win32', spawnFn });
    expect(spawnFn).toHaveBeenCalledWith(
      expect.stringMatching(/taskkill\.exe$/i),
      ['/pid', '2468', '/t', '/f'],
      { stdio: 'ignore', windowsHide: true, timeout: 10_000 },
    );
    expect(killer.unref).toHaveBeenCalledOnce();

    killer.emit('exit', 0);
    expect(child.kill).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns with sanitized fields and falls back to a direct kill on a nonzero exit', () => {
    const killer = killerStub();
    const child = childStub(4321);

    killProcessTree(child, 'SIGTERM', { platform: 'win32', spawnFn: (() => killer) as any });
    killer.emit('exit', 1);

    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(warn).toHaveBeenCalledWith('CLI process tree termination failed', {
      platform: 'win32',
      reason: 'tree_command_nonzero_exit',
      fallback: 'direct_child_only',
    });
    // 脱敏：不得带 PID / 命令 / 路径
    const payload = JSON.stringify(warn.mock.calls[0][1]);
    expect(payload).not.toContain('4321');
    expect(payload).not.toContain('taskkill');
    expect(payload).not.toContain('\\');
  });

  it('warns and falls back when taskkill cannot even start', () => {
    const killer: any = new EventEmitter();
    killer.unref = vi.fn();
    const child = childStub();

    killProcessTree(child, 'SIGKILL', { platform: 'win32', spawnFn: (() => killer) as any });
    killer.emit('error', new Error('spawn taskkill ENOENT'));

    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    expect(warn).toHaveBeenCalledWith('CLI process tree termination failed', {
      platform: 'win32',
      reason: 'tree_command_failed',
      fallback: 'direct_child_only',
    });
  });

  it('signals the whole POSIX process group instead of the lone child', () => {
    const killSpy = vi.spyOn(process, 'kill').mockImplementation((() => true) as any);
    try {
      const child = childStub(777);
      killProcessTree(child, 'SIGTERM', { platform: 'linux', spawnFn: (() => killerStub()) as any });
      expect(killSpy).toHaveBeenCalledWith(-777, 'SIGTERM');
      expect(child.kill).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      killSpy.mockRestore();
    }
  });
});
