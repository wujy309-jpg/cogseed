import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Public platform verification entrypoints', () => {
  it('pins the Windows P3394 lane to the platform-native regression suites', () => {
    const pkg = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8'));
    expect(pkg.scripts['test:p3394:windows']).toBe('node scripts/run-p3394-windows-tests.mjs');
    const source = fs.readFileSync(path.resolve('scripts/run-p3394-windows-tests.mjs'), 'utf8');
    for (const suite of [
      'test/main/features/local_agents/spawn-command.test.ts',
      'test/main/features/local_agents/version.test.ts',
      'test/main/features/p3394_bridge/gateway-models-probe.test.ts',
      'test/main/features/p3394_bridge/p3394-windows-cli.test.ts',
      'test/main/features/p3394_bridge/external-gateways.test.ts',
      'test/main/features/sscli-shim-cancel.test.ts',
      'test/main/features/cogseed_backend/worktree-manager.test.ts',
    ]) expect(source).toContain(suite);
    expect(source).toContain("process.platform !== 'win32'");
  });

});
