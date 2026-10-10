// Compact cross-job evidence. The second job reconstructs the full immutable
// export and verifies its bytes before obtaining any public write credential.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sha = /^[0-9a-f]{40}$/u;
const digest = /^[0-9a-f]{64}$/u;

export function captureEvidence(candidate, scanReportJson) {
  const manifestBytes = fs.readFileSync(path.join(candidate, 'manifest.json'));
  const reviewBytes = fs.readFileSync(path.join(candidate, 'review.json'));
  const manifest = JSON.parse(manifestBytes);
  const review = JSON.parse(reviewBytes);
  if (typeof scanReportJson !== 'string' || scanReportJson.length > 1024) throw new Error('Invalid scan evidence');
  const scan = JSON.parse(scanReportJson);
  if (!sha.test(manifest.sourceSha) || !digest.test(manifest.exportSha256)
      || !digest.test(manifest.policySha256)
      || review.sourceSha !== manifest.sourceSha || review.exportSha256 !== manifest.exportSha256
      || review.policyStatus !== 'reviewed'
      || !Array.isArray(review.missingPublicFiles) || review.missingPublicFiles.length
      || !Array.isArray(review.unclassifiedFiles) || review.unclassifiedFiles.length
      || fs.existsSync(path.join(candidate, 'INCOMPLETE'))
      || scan.sourceSha !== manifest.sourceSha || scan.exportSha256 !== manifest.exportSha256
      || scan.status !== 'passed' || scan.tool !== 'gitleaks' || scan.version !== '8.30.1') {
    throw new Error('Export or scan evidence is incomplete or inconsistent');
  }
  return {
    sourceSha: manifest.sourceSha,
    exportSha256: manifest.exportSha256,
    policySha256: manifest.policySha256,
    manifestSha256: hash(manifestBytes),
    reviewSha256: hash(reviewBytes),
    scanSha256: hash(scanReportJson),
    scanReportJson,
  };
}

export function verifyEvidence(candidate, evidence, expected) {
  if (!evidence || evidence.sourceSha !== expected.sourceSha || evidence.exportSha256 !== expected.exportSha256) {
    throw new Error('Evidence does not match the authorized source/export');
  }
  const actual = captureEvidence(candidate, evidence.scanReportJson);
  if (Object.keys(evidence).length !== Object.keys(actual).length
      || Object.entries(actual).some(([key, value]) => evidence[key] !== value)) {
    throw new Error('Re-export differs from scanned evidence');
  }
  return actual;
}
