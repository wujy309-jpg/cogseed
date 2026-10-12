import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { drainMainRuntimeForTest } from '../../../helpers/drain-main-runtime';
const mocks = vi.hoisted(() => ({ run: vi.fn(), getMessages: vi.fn(), getConversation: vi.fn() }));
vi.mock('../../../../src/main/features/auth', () => ({ hasConfiguredModel: () => ({ configured: true }), getConfiguredModelOAuthExpiredMessage: () => null }));
vi.mock('../../../../src/main/features/chats', () => ({ getMessages: mocks.getMessages, getConversation: mocks.getConversation, listConversations: async () => [] }));
vi.mock('../../../../src/main/model/core-agent/runner', () => ({ buildRunner: async () => ({ runner: { run: mocks.run } }) }));
vi.mock('../../../../src/main/features/recall/asset-title-suggestion', () => ({ suggestAbilityAssetTitle: async () => ({ title: '项目会议议程' }) }));
vi.mock('../../../../src/main/features/kb_embed', () => ({ closeEmbedder: vi.fn(), embedQuery: async (text: string) => { const digest = createHash('sha256').update(text).digest(); return Array.from({ length: 512 }, (_, i) => (digest[i % 32] / 255 - 0.5) * 0.2); } }));
vi.mock('../../../../src/main/util/boot_init', () => ({ registerDeferred: () => {}, scheduleBootBackground: () => ({ cancel: vi.fn(), promise: new Promise(() => {}) }) }));
let root: string, previousRoot: string | undefined;
beforeEach(() => {
  vi.resetModules();
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cogseed-auto-night-integration-'));
  previousRoot = process.env.COGSEED_WORKSPACE_ROOT; process.env.COGSEED_WORKSPACE_ROOT = root;
  mocks.getConversation.mockResolvedValue({ conversation_id: 'conv-night', title: '项目会议准备', space_id: 'space-night' });
  mocks.getMessages.mockResolvedValue([
    { id: 'message-user', ts: '2026-10-11T00:01:00.000Z', from: 'user', to: ['commander'], text: '请在后续项目会议反复复用以下会议准备模板：会议目标、背景事实、三个待决策问题、负责人和下一步行动。' },
    { id: 'message-assistant', ts: '2026-10-11T00:02:00.000Z', from: 'commander', to: ['user'], text: '这是一份适用于后续项目会议的可复用模板：会议目标、背景事实、三个待决策问题、负责人和下一步行动。' },
  ]);
  mocks.run.mockResolvedValue({ text: JSON.stringify({ candidates: [{ judgment: '会议准备模板：会议目标、背景事实、三个待决策问题、负责人和下一步行动。', value: '供后续项目会议复用，减少重复准备并使决策责任清晰。', summary: '项目会议议程', suggestedType: 'template', suggestedScope: 'general', suggestedAction: 'create', risk: 'low', evidence: ['m1'] }] }), meta: { aborted: false } });
});
afterEach(async () => { await drainMainRuntimeForTest('capture-user'); if (previousRoot === undefined) delete process.env.COGSEED_WORKSPACE_ROOT; else process.env.COGSEED_WORKSPACE_ROOT = previousRoot; fs.rmSync(root, { recursive: true, force: true }); });
it('extracts a new real nightly capture and automatically saves within its source workspace boundary', async () => {
  const settings = await import('../../../../src/main/features/recall/capture-settings');
  const store = await import('../../../../src/main/features/recall/store');
  const capture = await import('../../../../src/main/features/recall/capture-service');
  const candidates = await import('../../../../src/main/features/recall/candidate-service');
  const assets = await import('../../../../src/main/features/recall/asset-service');
  await settings.updateRecallCaptureSettings('capture-user', { executionPolicy: 'nightly', autoApproval: true });
  await store.updateRecallJsonRecord('capture-user', 'capture-settings', 'settings', current => ({ ...current!, autoApprovalEnabledAt: new Date(Date.now() - 5_000).toISOString() }));
  const queued = await capture.queueRecallCaptureFromTerminal({ run_id: 'run-night', user_id: 'capture-user', conversation_id: 'conv-night', status: 'completed', started_at_ms: Date.parse('2026-10-11T00:00:00.000Z'), finished_at_ms: Date.parse('2026-10-11T00:03:00.000Z') });
  expect(queued).toBeTruthy();
  // Advance the persisted scheduler state; extraction and all candidate/asset writes below are real.
  await store.updateRecallJsonRecord('capture-user', 'captures', queued!.id, current => ({ ...current!, status: 'queued' }));
  const result = await capture.runRecallCapture('capture-user', queued!.id);
  const saved = await candidates.listRecallCandidates('capture-user');
  expect(saved).toHaveLength(1);
  expect(saved[0].autoReview?.reasons).toEqual([]);
  expect(result.status).toBe('completed');
  expect(saved[0]).toMatchObject({ status: 'confirmed', autoReview: { eligible: true }, scopePolicy: { workspaceIds: ['space-night'] } });
  const formal = await assets.readAbilityAsset('capture-user', saved[0].promotedAssetId!);
  expect(formal.scopePolicy).toEqual({ workspaceIds: ['space-night'] });
  expect(formal.scope).toBe('general');
});
