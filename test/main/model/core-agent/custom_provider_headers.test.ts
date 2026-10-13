import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * Regression for the 2026-10-13 worker failures: both runs died on their first
 * attempt with
 *   400 {"type":"error","error":{"type":"MissingSessionID",
 *        "message":"Request is missing x-opencode-session …"}}
 * because the opencode.ai branch required a trailing slash, so a baseUrl of
 * `https://opencode.ai` never received the routing header.
 */
let tmpDir: string;
let previousWorkspaceRoot: string | undefined;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cogseed-provider-headers-'));
  previousWorkspaceRoot = process.env.COGSEED_WORKSPACE_ROOT;
  process.env.COGSEED_WORKSPACE_ROOT = tmpDir;
  vi.resetModules();
});

afterEach(() => {
  if (previousWorkspaceRoot === undefined) delete process.env.COGSEED_WORKSPACE_ROOT;
  else process.env.COGSEED_WORKSPACE_ROOT = previousWorkspaceRoot;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function headers() {
  const mod = await import('../../../../src/main/model/core-agent/custom_provider_runtime');
  return mod.customProviderHeaders;
}

describe('custom provider headers · opencode session routing', () => {
  it('sends x-opencode-session for every opencode.ai baseUrl shape', async () => {
    const customProviderHeaders = await headers();
    for (const baseUrl of [
      'https://opencode.ai',
      'https://opencode.ai/',
      'https://opencode.ai/zen/v1',
      'https://zen.opencode.ai/v1',
      'https://opencode.ai:8443/v1',
      '  https://opencode.ai  ',
    ]) {
      expect(customProviderHeaders(baseUrl, 'cp-1'), baseUrl).toEqual({ 'x-opencode-session': 'cogseed-cp-1' });
    }
  });

  it('leaves unrelated endpoints alone', async () => {
    const customProviderHeaders = await headers();
    for (const baseUrl of [
      'https://api.example.com/v1',
      'https://opencode.ai.evil.example/v1',
      'https://notopencode.ai/v1',
      '',
    ]) {
      expect(customProviderHeaders(baseUrl, 'cp-1'), baseUrl).toBeUndefined();
    }
  });

  it('keys the session on the provider id so routing stays stable per provider', async () => {
    const customProviderHeaders = await headers();
    expect(customProviderHeaders('https://opencode.ai', 'cp-abc')?.['x-opencode-session']).toBe('cogseed-cp-abc');
  });
});
