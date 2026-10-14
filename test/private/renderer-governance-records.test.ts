// Internal records are required in private CI; no exists/skip fallback.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '../..');
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8');

describe('Private engineering records', () => {
  const registry = read('docs/renderer-structural-registry.md');

  it('keeps the injected rules and CLAUDE pointer consistent', () => {
    const agents = read('AGENTS.md');
    expect(agents).toContain('window.cogseed.{invoke, stream}');
    const claude = read('CLAUDE.md');
    expect(claude).toContain('AGENTS.md');
  });

  it('keeps every KB-M migration durably recorded as migrated', () => {
    for (let index = 1; index <= 11; index += 1) {
      const id = `KB-M-${String(index).padStart(3, '0')}`;
      const row = registry.split('\n').find((line) => line.includes(`\`${id}\``));
      expect(row).toContain('| Migrated |');
    }
    expect(registry).toContain('Related PR is `TBD`');
  });

  it('keeps business-owned KB decisions recorded', () => {
    expect(registry).toContain('attachment items remain business-owned under `KB-B-002`');
    expect(registry).toContain('`kb-eco` switches product modules');
  });

  it('retains connector detail history and records its popup replacement', () => {
    const detail = registry.slice(registry.indexOf('### `CONN-PV-001`'), registry.indexOf('### `SEC-PV-001`'));
    expect(detail).toContain('**Status**: `Superseded`');
    expect(detail).toContain('`CONN-PV-003`');
    const popup = registry.slice(registry.indexOf('### `CONN-PV-003`'));
    expect(popup).toContain('**Status**: `Proposed`');
    expect(popup).toContain('`uiModal`');
  });
});
