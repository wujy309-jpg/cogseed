import { describe, expect, it } from 'vitest';
import { parseEffectivenessComparison } from '../../../../src/main/features/recall/effectiveness-comparison';
const assets = [{ assetId: 'aa-check', version: '2', statement: 'Include the owner and acceptance condition.' }];
const baseline = 'Prepare the meeting.';
const result = 'Owner: test role. Acceptance: confirmed room.';
const row = { outcome: 'better', reason: 'The result supplies an owner and acceptance condition absent in the baseline.',
  evidence: [{ assetId: 'aa-check', version: '2', assetQuote: assets[0].statement, baselineQuote: baseline, resultQuote: result }] };
describe('six-node closure: contribution evidence', () => {
  it('retains precise evidence for a comparison, including an explicit no-improvement conclusion', () => {
    expect(parseEffectivenessComparison(JSON.stringify(row), assets, baseline, result)).toMatchObject({ outcome: 'better', evidence: row.evidence });
    expect(() => parseEffectivenessComparison(JSON.stringify({ ...row, outcome: 'no_improvement' }), assets, result, result)).toThrow();
    const equal = { ...row, outcome: 'no_improvement', evidence: [{ ...row.evidence[0], baselineQuote: result }] };
    expect(parseEffectivenessComparison(JSON.stringify(equal), assets, result, result).outcome).toBe('no_improvement');
  });
  it.each([
    { ...row, evidence: [] },
    { ...row, evidence: [{ ...row.evidence[0], version: '1' }] },
    { ...row, evidence: [{ ...row.evidence[0], baselineQuote: 'invented baseline' }] },
    { ...row, evidence: [{ ...row.evidence[0], resultQuote: 'I used the asset' }] },
    { ...row, evidence: [row.evidence[0], row.evidence[0]] },
  ])('rejects unsupported success and identity/quote look-alikes', value => {
    expect(() => parseEffectivenessComparison(JSON.stringify(value), assets, baseline, result)).toThrow();
  });
  it('preserves insufficient evidence without inventing a contribution', () => {
    expect(parseEffectivenessComparison(JSON.stringify({ outcome: 'insufficient_evidence', reason: 'The tasks differ.', evidence: [] }), assets, baseline, result).outcome).toBe('insufficient_evidence');
  });
});
