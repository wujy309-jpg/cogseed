import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

// Governance evidence stays private; public adoption tests verify real page code.
const registry = fs.readFileSync('docs/renderer-structural-registry.md', 'utf8');

describe('Hub contribution private structural review', () => {
  it('registers each page-local structure as a proposal in the structural registry', () => {
    for (const id of ['HUBC-PV-001', 'HUBC-PV-002', 'HUBC-PV-003']) {
      expect(registry).toMatch(new RegExp(`\`${id}\`[^\\n]*\\| Proposed \\|`));
    }
    // A proposal must not be mistaken for an approved exception.
    expect(registry).not.toMatch(/`HUBC-PV-00\d`[^\n]*Approved Provisional/);
  });

});
