import { Mutex } from 'async-mutex';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { userLocalRoot } from '../../paths';
import { nowIso, readJson, writeJson } from '../../storage';
import type { WakeState } from './types';

const locks = new Map<string, Mutex>();

function lockFor(userId: string): Mutex {
  const existing = locks.get(userId);
  if (existing) return existing;
  const created = new Mutex();
  locks.set(userId, created);
  return created;
}

export function wakeStateFile(userId: string): string {
  return path.join(userLocalRoot(userId), 'p3394', 'wake-state.json');
}

export async function readWakeState(userId: string): Promise<WakeState> {
  const raw = await readJson<Partial<WakeState>>(wakeStateFile(userId));
  return {
    version: 1,
    requests: Array.isArray(raw.requests) ? raw.requests : [],
    approvals: Array.isArray(raw.approvals) ? raw.approvals : [],
    updated_at: typeof raw.updated_at === 'string' ? raw.updated_at : nowIso(),
  };
}

/** 「等用户批准」索引：只读、按用户 TTL 缓存。
 *
 *  两个消费方都要它，而且都在热路径上：
 *   - `conversations.list` 要给侧栏每一行打标（含**从不轮询的陈旧会话**，它们
 *     的 run/actor/wake 会互等几天）；
 *   - `/runtime` 投影要判断"这个 run 是不是在等批准"（据此不再伪装成运行中）。
 *  唤醒状态文件可能很大（本机已 150KB），所以整文件只解析一次、按 TTL 复用；
 *  需要即时生效的写路径（批准/拒绝/过期）会走 mutateWakeState，它们不依赖本缓存。
 */
/** 缓存失效用文件戳（mtime+size）而不是 TTL：批准/拒绝后必须立刻反映，同时
 *  热点轮询只需一次 stat，不必反复解析整份状态。 */
function wakeStateStamp(file: string): string {
  try {
    const stat = fs.statSync(file);
    return `${stat.mtimeMs}:${stat.size}`;
  } catch {
    return 'missing';
  }
}

const pendingApprovalCache = new Map<string, { stamp: string; index: { conversations: Set<string>; runs: Set<string> } }>();

export async function pendingApprovalIndex(
  userId: string,
): Promise<{ conversations: Set<string>; runs: Set<string> }> {
  const file = wakeStateFile(userId);
  const stamp = wakeStateStamp(file);
  const cached = pendingApprovalCache.get(userId);
  if (cached && cached.stamp === stamp) return cached.index;
  const state = await readWakeState(userId);
  const conversations = new Set<string>();
  const runs = new Set<string>();
  for (const request of state.requests) {
    // 只认 pending：approved 表示用户**已经决定**（派发可能正在进行或已中止），
    // 再显示"等待你批准"就是错的（真机反馈：唤醒后停止，标签还挂着）。
    if (request.status !== 'pending') continue;
    if (request.conversation_id) conversations.add(request.conversation_id);
    const runId = String(request.dispatch_payload?.run_id || '');
    if (runId) runs.add(runId);
  }
  const index = { conversations, runs };
  pendingApprovalCache.set(userId, { stamp, index });
  return index;
}

/** 测试缝隙：清掉索引缓存（生产路径靠文件戳自动失效，不需要）。 */
export function _resetPendingApprovalCacheForTest(): void {
  pendingApprovalCache.clear();
}

export async function mutateWakeState<T>(
  userId: string,
  mutate: (state: WakeState) => T | Promise<T>,
): Promise<T> {
  return lockFor(userId).runExclusive(async () => {
    const state = await readWakeState(userId);
    const result = await mutate(state);
    state.updated_at = nowIso();
    await writeJson(wakeStateFile(userId), state);
    return result;
  });
}
