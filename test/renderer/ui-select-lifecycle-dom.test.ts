import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);

describe('shared select public lifecycle in Chromium', () => {
  // Same hosted Windows Chromium limitation as composer-multiselect-dom.
  it.skipIf(process.platform === 'win32')('releases portals, delayed listeners and old page instances', () => {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const result = spawnSync(require('electron'), [resolve(__dirname, 'fixtures/ui-select-lifecycle-dom.cjs')], { env, encoding: 'utf8', timeout: 60000 });
    expect(result.status, `${result.error || result.signal || ''}\n${result.stderr || ''}\n${result.stdout || ''}`).toBe(0);
    const parsed = JSON.parse(String(result.stdout || '').trim().split('\n').filter(Boolean).pop() || '{}');
    expect(parsed.failed).toEqual([]);
    expect(parsed.passed).toBe(parsed.total);
    expect(parsed.total).toBeGreaterThanOrEqual(13);
  }, 70000);
});
