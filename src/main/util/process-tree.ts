import {
  spawn,
  type ChildProcessWithoutNullStreams,
} from 'node:child_process';
import * as path from 'node:path';

import { createLogger } from '../logger';

const log = createLogger('process-tree');

/** `taskkill` is a bounded utility, not a daemon: if it has not exited by then it never will. */
const TASKKILL_TIMEOUT_MS = 10_000;

type KillableChild = Pick<ChildProcessWithoutNullStreams, 'kill' | 'pid'>;
type SpawnFn = typeof spawn;

function windowsSystem32Tool(name: string): string {
  const root = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows';
  return path.win32.join(root, 'System32', name);
}

/** Terminate the complete child process tree without invoking a shell. */
export function killProcessTree(
  child: KillableChild,
  signal: NodeJS.Signals,
  opts: { platform?: NodeJS.Platform; spawnFn?: SpawnFn } = {},
): void {
  const pid = child.pid;
  const platform = opts.platform ?? process.platform;
  if (pid && platform === 'win32') {
    try {
      const killer = (opts.spawnFn ?? spawn)(
        windowsSystem32Tool('taskkill.exe'),
        ['/pid', String(pid), '/t', '/f'],
        { stdio: 'ignore', windowsHide: true, timeout: TASKKILL_TIMEOUT_MS },
      );
      // 直接 kill 子进程 ≠ 证明整棵树已停：孙进程可能仍然活着并持有继承来的管道，
      // 于是 close 永不触发、abort/timeout 看起来「挂死」。失败必须留下痕迹，
      // 否则只剩静默降级。告警只带平台与原因——不带 PID、命令、路径与原始 stderr。
      const fallback = (reason: string) => {
        log.warn('CLI process tree termination failed', {
          platform: 'win32',
          reason,
          fallback: 'direct_child_only',
        });
        try { child.kill(signal); } catch { /* already gone */ }
      };
      killer.once('error', () => fallback('tree_command_failed'));
      killer.once('exit', (code) => {
        if (code !== 0) fallback('tree_command_nonzero_exit');
      });
      if (typeof killer.unref === 'function') killer.unref();
      return;
    } catch {
      // Fall through to a best-effort direct child kill.
    }
  }
  if (pid && platform !== 'win32') {
    try {
      process.kill(-pid, signal);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') return;
    }
  }
  try { child.kill(signal); } catch { /* already gone */ }
}
