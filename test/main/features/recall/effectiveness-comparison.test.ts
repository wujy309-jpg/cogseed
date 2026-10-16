import { describe, expect, it } from 'vitest';
import { parseEffectivenessComparison } from '../../../../src/main/features/recall/effectiveness-comparison';
const assets = [{ assetId: 'aa-check', version: '2', statement: 'Include the owner and acceptance condition.' }];
const baseline = 'Prepare the meeting.';
const result = 'Owner: test role. Acceptance: confirmed room.';
const row = { outcome: 'better', reason: 'The result supplies an owner and acceptance condition absent in the baseline.',
  evidence: [{ assetId: 'aa-check', version: '2', assetQuote: assets[0].statement, baselineQuote: baseline, resultQuote: result }] };
describe('six-node closure: contribution evidence', () => {
  it('resolves host evidence IDs without repairing model quotes or crossing result identities', () => {
    const located = { ...row, evidence: [{ assetId: 'aa-check', version: '2',
      assetEvidenceId: 'a1:1', baselineEvidenceId: 'b:1', resultEvidenceId: 'r:1' }] };
    expect(parseEffectivenessComparison(JSON.stringify(located), assets, baseline, result)).toMatchObject({ evidence: row.evidence });
    for (const changed of [ { resultEvidenceId: 'b:1' }, { assetEvidenceId: 'a2:1' },
      { resultEvidenceId: 'r:99' }, { resultQuote: 'made up' } ])
      expect(() => parseEffectivenessComparison(JSON.stringify({ ...located, evidence: [{ ...located.evidence[0], ...changed }] }), assets, baseline, result)).toThrow();
  });
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
  it('rejects double-escaped newlines rather than repairing a nonliteral quote', () => {
    const multilineAssets = [{ ...assets[0], statement: 'Include the owner.\nInclude acceptance.' }];
    const multilineResult = 'Owner: test role.\nAcceptance: confirmed room.';
    const grounded = { ...row, evidence: [{ ...row.evidence[0], assetQuote: multilineAssets[0].statement, resultQuote: multilineResult }] };
    expect(parseEffectivenessComparison(JSON.stringify(grounded), multilineAssets, baseline, multilineResult).outcome).toBe('better');
    for (const field of ['assetQuote', 'resultQuote'] as const) {
      const evidence = { ...grounded.evidence[0], [field]: grounded.evidence[0][field].replace(/\n/g, '\\n') };
      expect(() => parseEffectivenessComparison(JSON.stringify({ ...grounded, evidence: [evidence] }), multilineAssets, baseline, multilineResult)).toThrow();
    }
  });
});

it('requires real file-body quotes when produced files exist, never a success claim or generated wrapper', () => {
  const file = { text: 'All done.\n[Persisted file file-a]\nOwner: test role.\n[End persisted file file-a]',
    refs: [{ kind: 'message' as const, id: 'reply', contentRange: { start: 0, end: 9 }, status: 'readable' as const },
      { kind: 'file' as const, id: 'file-a', contentRange: { start: 32, end: 49 }, status: 'readable' as const }],
    coverage: { complete: true, totalFiles: 1, readableFiles: 1 } };
  // Coordinates are host-produced, not selected by the judging model.
  const start = file.text.indexOf('Owner: test role.'); file.refs[1].contentRange = { start, end: start + 'Owner: test role.'.length };
  const compared = { ...row, evidence: [{ ...row.evidence[0], resultQuote: 'Owner: test role.' }] };
  const contents = { baseline: { text: baseline, refs: [], coverage: { complete: true, totalFiles: 0, readableFiles: 0 } }, result: file };
  expect(parseEffectivenessComparison(JSON.stringify(compared), assets, baseline, file.text, contents).evidence[0].resultRef?.kind).toBe('file');
  const located = { ...row, evidence: [{ assetId: 'aa-check', version: '2',
    assetEvidenceId: 'a1:1', baselineEvidenceId: 'b:1', resultEvidenceId: 'r:1' }] };
  const resolved = parseEffectivenessComparison(JSON.stringify(located), assets, baseline, file.text, contents);
  expect(resolved.evidence[0]).toMatchObject({ resultQuote: 'Owner: test role.', resultRef: { kind: 'file', contentRange: file.refs[1].contentRange } });
  expect(() => parseEffectivenessComparison(JSON.stringify({ ...located, evidence: [{ ...located.evidence[0], resultEvidenceId: 'r:2' }] }), assets, baseline, file.text, contents)).toThrow();
  for (const quote of ['All done.', '[Persisted file file-a]']) expect(() => parseEffectivenessComparison(JSON.stringify({ ...compared,
    evidence: [{ ...compared.evidence[0], resultQuote: quote }] }), assets, baseline, file.text, contents)).toThrow('actual result');
});
