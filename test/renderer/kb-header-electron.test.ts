import { it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const requireCjs = createRequire(import.meta.url);

it('keeps KB navigation clear of window controls and the sidebar recovery entry', () => {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(requireCjs('electron'), [resolve(__dirname, 'fixtures/kb-header.cjs')], {
    env, encoding: 'utf8', timeout: 45_000,
  });
  expect(result.status, `${result.stdout}\n${result.stderr}\n${result.error || result.signal || ''}`).toBe(0);
  const outcome = JSON.parse(result.stdout.trim().split('\n').filter(Boolean).pop()!);
  expect(outcome.failed).toEqual([]);
  expect(outcome.passed).toBeGreaterThanOrEqual(60);
}, 55_000);
