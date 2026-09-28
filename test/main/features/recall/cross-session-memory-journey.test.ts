import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

vi.mock('../../../../src/main/features/kb_embed', () => ({
  closeEmbedder: vi.fn(),
  embedQuery: async (text: string) => {
    const digest = createHash('sha256').update(text).digest();
    return Array.from({ length: 512 }, (_, i) => (digest[i % 32] / 255 - 0.5) * 0.2);
  },
}));

const USER_ID = 'cross-memory-journey';
let workspaceRoot: string;
let previousWorkspaceRoot: string | undefined;
let previousAnthropicKey: string | undefined;

beforeEach(() => {
  vi.resetModules();
  workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cogseed-memory-journey-'));
  previousWorkspaceRoot = process.env.COGSEED_WORKSPACE_ROOT;
  previousAnthropicKey = process.env.ANTHROPIC_API_KEY;
  process.env.COGSEED_WORKSPACE_ROOT = workspaceRoot;
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test-placeholder';
});

afterEach(() => {
  if (previousWorkspaceRoot === undefined) delete process.env.COGSEED_WORKSPACE_ROOT;
  else process.env.COGSEED_WORKSPACE_ROOT = previousWorkspaceRoot;
  if (previousAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = previousAnthropicKey;
  fs.rmSync(workspaceRoot, { recursive: true, force: true });
});

async function buildRunner(userMessage: string, sessionId: string) {
  const users = await import('../../../../src/main/features/users');
  users.activateUser(USER_ID);
  const runnerModule = await import('../../../../src/main/model/core-agent/runner');
  return runnerModule.buildRunner({
    sessionId,
    userId: USER_ID,
    cid: 'conversation-memory-journey',
    sourceMessageFromUser: true,
    userMessage,
    skillList: [],
  });
}

async function invokeMemoryTool(
  userMessage: string,
  sessionId: string,
  input: Record<string, string>,
) {
  const built = await buildRunner(userMessage, sessionId);
  const memoryTool = (built.runner as any).tools.get('cross_session_memory');
  expect(memoryTool).toBeTruthy();
  const result = await memoryTool.execute(input, { state: {} });
  return { prompt: built.resolvedSystemPrompt, result: JSON.parse(result.content) };
}

describe('cross-session memory end-to-end journey', () => {
  it.each([
    ['Japanese', '覚えておいて：簡潔な回答を好みます。', '簡潔な回答を好みます。'],
    ['Portuguese', 'Por favor, lembre-se: Prefiro respostas concisas.', 'Prefiro respostas concisas.'],
  ])('creates a formal personal asset from an exact %s save request', async (_language, userMessage, content) => {
    const saved = await invokeMemoryTool(
      userMessage,
      `gconv-memory-journey-localized-${String(_language).toLowerCase()}`,
      { action: 'add', target: 'user', content },
    );
    expect(saved.result).toMatchObject({ ok: true });
    expect(saved.result.entries[0]).toContain('Saved as active cognition asset');

    const assets = await import('../../../../src/main/features/recall/asset-service');
    expect(await assets.listAbilityAssets(USER_ID)).toEqual(expect.arrayContaining([
      expect.objectContaining({ statement: content, type: 'personal', status: 'active' }),
    ]));
  });

  it('saves only on request, injects on the next task, carries corrections forward, and stops when paused', async () => {
    const original = '我偏好简洁回答。';
    const corrected = '我偏好先给结论，再用一段话解释原因。';

    const saved = await invokeMemoryTool(
      '请记住：我偏好简洁回答。',
      'gconv-memory-journey-save',
      { action: 'add', target: 'user', content: original },
    );
    expect(saved.result).toMatchObject({ ok: true });
    expect(saved.result.entries[0]).toContain('Saved as active cognition asset');

    const assets = await import('../../../../src/main/features/recall/asset-service');
    const asset = (await assets.listAbilityAssets(USER_ID)).find((item) => item.type === 'personal');
    expect(asset).toMatchObject({ statement: original, status: 'active' });

    const nextTask = await buildRunner('帮我整理一份说明。', 'gconv-memory-journey-next');
    expect(nextTask.resolvedSystemPrompt).toContain(original);

    const deniedCorrection = await invokeMemoryTool(
      'This preference seems wrong now.',
      'gconv-memory-journey-denied-correction',
      { action: 'replace', target: 'user', old_text: original, content: corrected },
    );
    expect(deniedCorrection.result).toMatchObject({ ok: false });
    const deniedRemoval = await invokeMemoryTool(
      'Do not forget this preference.',
      'gconv-memory-journey-denied-removal',
      { action: 'remove', target: 'user', old_text: original },
    );
    expect(deniedRemoval.result).toMatchObject({ ok: false });
    expect(await assets.readAbilityAsset(USER_ID, asset!.id)).toMatchObject({ statement: original, status: 'active' });

    const correctedResult = await invokeMemoryTool(
      `请把这条改成：${corrected}`,
      'gconv-memory-journey-correct',
      { action: 'replace', target: 'user', old_text: original, content: corrected },
    );
    expect(correctedResult.result).toMatchObject({ ok: true });
    const revised = await assets.readAbilityAsset(USER_ID, asset!.id);
    expect(revised).toMatchObject({ statement: corrected, status: 'active' });
    expect(revised.version).not.toBe(asset!.version);

    const correctedTask = await buildRunner('继续帮我整理。', 'gconv-memory-journey-corrected-task');
    expect(correctedTask.resolvedSystemPrompt).toContain(corrected);
    expect(correctedTask.resolvedSystemPrompt).not.toContain(original);

    await assets.pauseAbilityAsset(USER_ID, asset!.id, {
      actor: 'user',
      reason: 'The user temporarily disabled this memory.',
      expectedVersion: revised.version,
    });
    const pausedTask = await buildRunner('再继续整理。', 'gconv-memory-journey-paused-task');
    expect(pausedTask.resolvedSystemPrompt).not.toContain(corrected);
    expect((await assets.readAbilityAsset(USER_ID, asset!.id)).status).toBe('paused');

    await assets.resumeAbilityAsset(USER_ID, asset!.id, { actor: 'user', reason: 'Resume before explicit removal.' });
    const removed = await invokeMemoryTool(
      'Please forget this preference.',
      'gconv-memory-journey-remove',
      { action: 'remove', target: 'user', old_text: corrected },
    );
    expect(removed.result).toMatchObject({ ok: true });
    expect((await assets.readAbilityAsset(USER_ID, asset!.id)).status).toBe('deleted');
  });
});
