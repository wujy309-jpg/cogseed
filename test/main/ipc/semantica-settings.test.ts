import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  readSettings: vi.fn(),
  status: vi.fn(),
  seed: vi.fn(),
  clear: vi.fn(),
}));

vi.mock('../../../src/main/features/recall/semantica-settings', () => ({
  readSemanticaSettings: mocks.readSettings,
  settingsView: vi.fn(() => ({ semanticaEnabled: true })),
  updateSemanticaSettings: vi.fn(() => ({})),
}));

vi.mock('../../../src/main/features/recall/semantica-demo-assets', () => ({
  getSemanticaDemoStatus: mocks.status,
  seedSemanticaDemoAssets: mocks.seed,
  clearSemanticaDemoAssets: mocks.clear,
}));

import { invokeHandlers } from '../../../src/main/ipc/semantica-settings';

describe('Semantica settings IPC demo assets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readSettings.mockReturnValue({ semanticaEnabled: true });
    mocks.status.mockResolvedValue({ ready: false, assetCount: 0, expectedAssetCount: 8, assets: [] });
    mocks.seed.mockResolvedValue({ createdCount: 8, updatedCount: 0, status: { ready: true } });
    mocks.clear.mockResolvedValue({ clearedCount: 8, status: { ready: false } });
  });

  it('includes demo status with the settings view', async () => {
    const result = await invokeHandlers['semantica.settings.get']({}, { userId: 'user-a' });
    expect(result).toMatchObject({ demo: { expectedAssetCount: 8 } });
    expect(mocks.status).toHaveBeenCalledWith('user-a');
  });

  it('seeds and clears through explicit channels when Semantica is enabled', async () => {
    await expect(invokeHandlers['semantica.demo.seed']({}, { userId: 'user-a' }))
      .resolves.toMatchObject({ createdCount: 8 });
    await expect(invokeHandlers['semantica.demo.clear']({}, { userId: 'user-a' }))
      .resolves.toMatchObject({ clearedCount: 8 });
  });

  it('rejects demo writes while Semantica is disabled', async () => {
    mocks.readSettings.mockReturnValue({ semanticaEnabled: false });
    await expect(invokeHandlers['semantica.demo.seed']({}, { userId: 'user-a' }))
      .rejects.toThrow(/must be enabled/);
    expect(mocks.seed).not.toHaveBeenCalled();
  });
});
