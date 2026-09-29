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

  it('records the connector detail proposal', () => {
    expect(registry).toContain('`CONN-PV-001`');
    expect(registry).toContain('**Status**: `Proposed`');
  });
});
