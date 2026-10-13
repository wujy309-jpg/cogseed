import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * Wake approval → task resume. The sidebar kept showing "等待批准" after the user
 * approved, because the badge counts `counts.attention` (which includes
 * `waiting_user`) and the approval path never converged the task. These cases pin
 * the three rules the resume relies on: only an attention state is ours to clear,
 * a terminal task is never resurrected, and a running/unknown task is a no-op.
 */
const USER = 'cogseed-wake-resume-user';
let tmpDir: string;
let previousWorkspaceRoot: string | undefined;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cogseed-wake-resume-'));
  previousWorkspaceRoot = process.env.COGSEED_WORKSPACE_ROOT;
  process.env.COGSEED_WORKSPACE_ROOT = tmpDir;
  vi.resetModules();
});

afterEach(() => {
  if (previousWorkspaceRoot === undefined) delete process.env.COGSEED_WORKSPACE_ROOT;
  else process.env.COGSEED_WORKSPACE_ROOT = previousWorkspaceRoot;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function store() {
  return import('../../../../src/main/features/cogseed_backend/task-store');
}

async function taskInStatus(requestId: string, status: 'waiting_user' | 'running' | 'completed') {
  const tasks = await store();
  const created = await tasks.createCogSeedTask(USER, {
    requestId,
    task: 'Wake approval resume task.',
    executionKind: 'group-chat',
    groupChatRunId: `run-${requestId}`,
  });
  // Creation leaves the task at `created`, so every case states its own status.
  await tasks.updateCogSeedTaskWithEvent(
    USER,
    created.task.taskId,
    (current) => ({ ...current, status, updatedAt: new Date().toISOString() }),
    status === 'completed'
      ? { type: 'task.completed', payload: { source: 'test-setup' } }
      : { type: 'task.started', payload: { source: 'test-setup' } },
  );
  return created.task.taskId;
}

describe('wake approval resumes its task', () => {
  it('moves a waiting_user task back to running and records the event', async () => {
    const taskId = await taskInStatus('req-wake-resume', 'waiting_user');
    const tasks = await store();

    const resumed = await tasks.resumeCogSeedTaskAfterWakeApproval(USER, 'req-wake-resume');

    expect(resumed).toMatchObject({ taskId, status: 'running' });
    const record = await tasks.readCogSeedTask(USER, taskId);
    expect(record?.status).toBe('running');
  });

  it('never resurrects a terminal task', async () => {
    const taskId = await taskInStatus('req-wake-terminal', 'completed');
    const tasks = await store();

    expect(await tasks.resumeCogSeedTaskAfterWakeApproval(USER, 'req-wake-terminal')).toBeNull();
    expect((await tasks.readCogSeedTask(USER, taskId))?.status).toBe('completed');
  });

  it('is a no-op for a running task and for an unknown request id', async () => {
    const runningId = await taskInStatus('req-wake-running', 'running');
    const tasks = await store();

    expect(await tasks.resumeCogSeedTaskAfterWakeApproval(USER, 'req-wake-running')).toBeNull();
    expect((await tasks.readCogSeedTask(USER, runningId))?.status).toBe('running');
    expect(await tasks.resumeCogSeedTaskAfterWakeApproval(USER, 'req-wake-absent')).toBeNull();
  });

  // 真机 2026-10-14 00:30：p3394 唤醒请求 id（`076f0627f697`）不是 CogSeed 任务
  // 请求 id（`req-…`），旧实现直接 throw `invalid CogSeed request id` → 批准后任务
  // 仍停在 waiting_user，「等待批准」徽标不收敛。
  it("a p3394 wake id is resolved by the wake's own conversation + agent", async () => {
    const tasks = await store();
    const created = await tasks.createCogSeedTask(USER, {
      requestId: 'req-wake-group-chat',
      task: 'Group chat worker waiting for wake approval.',
      executionKind: 'group-chat',
      conversationId: 'conv-wake-1',
      agentId: 'agent-wake-1',
      groupChatRunId: 'run-wake-1',
    });
    await tasks.updateCogSeedTaskWithEvent(
      USER,
      created.task.taskId,
      (current) => ({ ...current, status: 'waiting_user', updatedAt: new Date().toISOString() }),
      { type: 'task.started', payload: { source: 'test-setup' } },
    );

    const resumed = await tasks.resumeCogSeedTaskAfterWakeApproval(USER, {
      requestId: '076f0627f697',
      conversationId: 'conv-wake-1',
      agentId: 'agent-wake-1',
    });

    expect(resumed).toMatchObject({ taskId: created.task.taskId, status: 'running' });
    expect((await tasks.readCogSeedTask(USER, created.task.taskId))?.status).toBe('running');
  });

  it('a foreign id without wake context is a silent no-op, never a throw', async () => {
    const tasks = await store();
    await expect(tasks.resumeCogSeedTaskAfterWakeApproval(USER, '076f0627f697')).resolves.toBeNull();
    await expect(tasks.resumeCogSeedTaskAfterWakeApproval(USER, {
      requestId: '076f0627f697',
      conversationId: 'conv-absent',
      agentId: 'agent-absent',
    })).resolves.toBeNull();
  });
});
