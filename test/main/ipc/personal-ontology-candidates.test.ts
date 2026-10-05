import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { trustedIpcSender } from '../../helpers/trusted-ipc-sender';

type InvokeFn = (event: unknown, req: { channel: string; payload?: unknown }) => Promise<any>;
let invokeHandler: InvokeFn | null = null;
const TEST_UID = 'uOntologyIpc';

const templateFiles = {
  installTemplateFile: vi.fn(async (uid: string, templateId: string, restoreData: boolean) => ({ ok: true, uid, templateId, restoreData })),
  templateHasArchive: vi.fn(() => true),
  templateHasMemoryArchive: vi.fn(() => false),
  uninstallTemplateFile: vi.fn(async (uid: string, templateId: string, archiveMemory: boolean) => ({ ok: true, uid, templateId, archiveMemory })),
};

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: InvokeFn) => { if (channel === 'cogseed.invoke') invokeHandler = fn; }, on: vi.fn() },
  shell: { openExternal: vi.fn(async () => undefined), showItemInFolder: vi.fn() },
  BrowserWindow: { getFocusedWindow: vi.fn(() => null), getAllWindows: vi.fn(() => []) },
  dialog: { showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })) },
  app: { getPath: vi.fn(() => os.tmpdir()), isPackaged: false },
}));
vi.mock('../../../src/main/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  logFromRenderer: vi.fn(),
}));
vi.mock('../../../src/main/features/personal_ontology_template_files', () => templateFiles);

beforeEach(async () => {
  // Keep the isolated workspace assigned by test/setup-env.ts.
  invokeHandler = null;
  vi.resetModules();
  vi.clearAllMocks();
  vi.doMock('../../../src/main/ipc/local_agents', () => ({ invokeHandlers: {} }));
  const users = await import('../../../src/main/features/users');
  users.activateUser(TEST_UID);
  const ipc = await import('../../../src/main/ipc/index');
  ipc.register();
});
afterEach(() => {
  vi.resetModules();
});

function call(channel: string, payload: unknown = {}) {
  if (!invokeHandler) throw new Error('invoke handler not registered');
  return invokeHandler({ sender: trustedIpcSender() }, { channel, payload });
}

describe('ipc › personal ontology templates', () => {
  it('re-exposes single-item candidate channels for backflow confirmation while keeping batch channels retired', async () => {
    // 旧本体候选由个人本体工作台生成；现由过渡入口送入 Recall 共同审核，
    // 不再直接确认写入旧全局记忆。list 用于兼容旧候选队列展示。
    const liveChannels = [
      'personalOntology.candidates.list',
      'personalOntology.candidates.transferToRecall',
    ];
    for (const channel of liveChannels) {
      const res = await call(channel);
      expect(res).not.toEqual({ ok: false, error: `unknown channel: ${channel}` });
    }

    const retiredChannels = [
      'personalOntology.candidates.confirm',
      'personalOntology.candidates.reject',
      'personalOntology.candidates.confirmBatch',
      'personalOntology.candidates.rejectBatch',
      'personalOntology.candidates.addFromOnboarding',
    ];
    for (const channel of retiredChannels) {
      await expect(call(channel)).resolves.toEqual({
        ok: false,
        error: `unknown channel: ${channel}`,
      });
    }
  });

  it('transfers a legacy candidate into common Recall review before removing the old row', async () => {
    const po = await import('../../../src/main/features/personal_ontology_candidates');
    const old = await po.addCandidate(TEST_UID, { candidate_id: 'legacy-po-ipc', kind: 'relation', confidence: 'high',
      summary: '项目负责人', memory_scope: 'shared', memory_text: 'CogSeed 项目的负责人是林青。', source_memory_refs: ['legacy-memory-1'] });
    expect(old.ok).toBe(true);
    const first = await call('personalOntology.candidates.transferToRecall', { candidateId: 'legacy-po-ipc' });
    expect(first).toMatchObject({ ok: true, candidate: { suggestedType: 'fact' }, sourceRemoved: true });
    expect((await po.listCandidates(TEST_UID)).candidate_updates).toEqual([]);
    const candidateId = first.candidate.id;
    await expect(call('recall.candidates.read', { candidateId })).resolves.toMatchObject({ ok: true, candidate: { status: 'pending_review' } });

    const retry = await call('personalOntology.candidates.transferToRecall', { candidateId: 'legacy-po-ipc' });
    expect(retry.candidate.id).toBe(candidateId);
    expect(retry.sourceRemoved).toBe(false);
    expect((await po.listCandidates(TEST_UID)).candidate_updates).toEqual([]);
  });

  it('preserves template restore and archive options across IPC', async () => {
    await call('personalOntology.templates.install', { templateId: 'student', restoreData: true, uid: 'attacker' });
    await call('personalOntology.templates.hasArchive', { templateId: 'student', uid: 'attacker' });
    await call('personalOntology.templates.uninstall', { templateId: 'student', archiveMemory: true, uid: 'attacker' });

    expect(templateFiles.installTemplateFile).toHaveBeenCalledWith(TEST_UID, 'student', true);
    expect(templateFiles.templateHasArchive).toHaveBeenCalledWith(TEST_UID, 'student');
    expect(templateFiles.templateHasMemoryArchive).toHaveBeenCalledWith(TEST_UID, 'student');
    expect(templateFiles.uninstallTemplateFile).toHaveBeenCalledWith(TEST_UID, 'student', true);
  });

  it('rejects template actions without a valid template id', async () => {
    expect((await call('personalOntology.templates.install', { restoreData: true })).ok).toBe(false);
    expect((await call('personalOntology.templates.hasArchive', { templateId: 7 })).ok).toBe(false);
    expect((await call('personalOntology.templates.uninstall', {})).ok).toBe(false);
    expect(templateFiles.installTemplateFile).not.toHaveBeenCalled();
    expect(templateFiles.templateHasArchive).not.toHaveBeenCalled();
    expect(templateFiles.uninstallTemplateFile).not.toHaveBeenCalled();
  });
});
