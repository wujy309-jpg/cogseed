import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { captureEvidence, verifyEvidence } from './evidence.mjs';

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'source-evidence-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const identity = { sourceSha: 'a'.repeat(40), exportSha256: 'b'.repeat(64) };
  const manifest = { ...identity, policySha256: 'c'.repeat(64), files: [] };
  const review = { ...identity, policyStatus: 'reviewed', missingPublicFiles: [], unclassifiedFiles: [], privateReferenceHints: [] };
  const scan = { ...identity, status: 'passed', tool: 'gitleaks', version: '8.30.1' };
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest) + '\n');
  fs.writeFileSync(path.join(dir, 'review.json'), JSON.stringify(review) + '\n');
  return { dir, identity, scan, evidence: captureEvidence(dir, JSON.stringify(scan) + '\n') };
}

test('reconstructed export verifies using compact outputs without an artifact service', (t) => {
  const f = fixture(t);
  const transferred = JSON.parse(JSON.stringify(f.evidence));
  assert.deepEqual(verifyEvidence(f.dir, transferred, f.identity), f.evidence);
  assert.ok(Buffer.byteLength(JSON.stringify(transferred)) < 2048);
});

test('rejects a changed source, policy, manifest byte or private review byte', (t) => {
  const f = fixture(t);
  assert.throws(() => verifyEvidence(f.dir, f.evidence, { ...f.identity, sourceSha: 'd'.repeat(40) }));
  assert.throws(() => verifyEvidence(f.dir, { ...f.evidence, policySha256: 'd'.repeat(64) }, f.identity));
  for (const name of ['manifest.json', 'review.json']) {
    const file = path.join(f.dir, name), original = fs.readFileSync(file);
    fs.appendFileSync(file, ' ');
    assert.throws(() => verifyEvidence(f.dir, f.evidence, f.identity), /Re-export differs/);
    fs.writeFileSync(file, original);
  }
});

test('rejects failed, stale, wrong-version and tampered scan evidence', (t) => {
  const f = fixture(t);
  for (const change of [{ status: 'failed' }, { sourceSha: 'd'.repeat(40) }, { version: '8.18.4' }]) {
    assert.throws(() => captureEvidence(f.dir, JSON.stringify({ ...f.scan, ...change })));
  }
  assert.throws(() => verifyEvidence(f.dir, { ...f.evidence, scanReportJson: f.evidence.scanReportJson + ' ' }, f.identity));
  assert.throws(() => verifyEvidence(f.dir, { ...f.evidence, extra: 'unexpected' }, f.identity));
});

test('never captures incomplete inventory as passed scan evidence', (t) => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.dir, 'INCOMPLETE'), 'incomplete');
  assert.throws(() => captureEvidence(f.dir, f.evidence.scanReportJson));
});
