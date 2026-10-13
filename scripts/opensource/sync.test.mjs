import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const sync = fileURLToPath(new URL('./sync.mjs', import.meta.url));
const exporter = fileURLToPath(new URL('./export.mjs', import.meta.url));
const targetOrigin = 'https://github.com/bonc-ai/cogseed.git';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function command(program, argv, options = {}) {
  return execFileSync(program, argv, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...options }).trim();
}

function fixture(t, { status = 'reviewed', reference = false, badHintReview = false } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cogseed-sync-test-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const privateRepo = path.join(base, 'private');
  const publicRepo = path.join(base, 'public');
  fs.mkdirSync(privateRepo);
  fs.mkdirSync(publicRepo);
  const git = (repo, ...argv) => command('git', ['-C', repo, ...argv]);
  for (const [repo, remote] of [[privateRepo, 'https://github.com/bonc-ai/cogseed-internal.git'], [publicRepo, targetOrigin]]) {
    git(repo, 'init', '-q');
    git(repo, 'config', 'user.name', 'Sync fixture');
    git(repo, 'config', 'user.email', 'fixture@example.invalid');
    git(repo, 'config', 'commit.gpgsign', 'false');
    git(repo, 'config', 'core.autocrlf', 'false');
    git(repo, 'remote', 'add', 'origin', remote);
  }
  const put = (repo, name, bytes, executable = false) => {
    const filename = path.join(repo, name);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, bytes);
    if (executable) fs.chmodSync(filename, 0o755);
  };
  const commit = (repo) => { git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'fixture'); return git(repo, 'rev-parse', 'HEAD'); };
  put(privateRepo, 'src/app.js', 'public v1\n');
  put(privateRepo, 'bin/run.sh', '#!/bin/sh\necho ok\n', true);
  put(privateRepo, 'secret.txt', 'do not publish\n');
  if (reference) {
    put(privateRepo, 'docs/public.md', '[Internal](internal.md)\n');
    put(privateRepo, 'docs/internal.md', 'private document\n');
  }
  put(privateRepo, 'scripts/opensource/contributions.json', JSON.stringify({
    schemaVersion: 1, repository: 'bonc-ai/cogseed', contributions: [],
  }));
  const sourceSha = commit(privateRepo);
  put(publicRepo, 'obsolete.txt', 'delete me\n');
  put(publicRepo, 'src/app.js', 'old public\n');
  const publicBase = commit(publicRepo);
  const policy = {
    schemaVersion: 1, status, sourceRepository: 'bonc-ai/cogseed-internal', targetRepository: 'bonc-ai/cogseed',
    publicFiles: reference ? ['src/app.js', 'bin/run.sh', 'docs/public.md'] : ['src/app.js', 'bin/run.sh'],
    neverPublic: ['secret.txt'], privatePaths: reference ? ['docs/internal.md', 'scripts/opensource/'] : ['scripts/opensource/'],
    reviewedReferenceHintsSha256: badHintReview ? '0'.repeat(64) : sha256(JSON.stringify(reference
      ? [{ path: 'docs/public.md', references: ['docs/internal.md'] }] : [])),
  };
  const policyFile = path.join(base, 'policy.json');
  fs.writeFileSync(policyFile, JSON.stringify(policy));
  const candidate = path.join(base, 'candidate');
  const exported = spawnSync(process.execPath, [exporter, '--repo', privateRepo, '--source', sourceSha,
    '--out', candidate, '--policy', policyFile], { encoding: 'utf8' });
  assert.equal(exported.status, status === 'reviewed' && !reference ? 0 : 2, exported.stderr);
  const manifest = JSON.parse(fs.readFileSync(path.join(candidate, 'manifest.json')));
  const review = JSON.parse(fs.readFileSync(path.join(candidate, 'review.json')));
  const approval = path.join(base, 'approval.json');
  const scan = path.join(base, 'scan.json');
  fs.writeFileSync(approval, JSON.stringify({ sourceSha, exportSha256: manifest.exportSha256,
    policySha256: manifest.policySha256, referenceHintsSha256: sha256(JSON.stringify(review.privateReferenceHints)),
    authorizedBy: 'fixture-actor', workflowRunId: 123, workflowRunAttempt: 1,
    authorizationMethod: 'workflow_dispatch' }));
  fs.writeFileSync(scan, JSON.stringify({ sourceSha, exportSha256: manifest.exportSha256, tool: 'gitleaks', status: 'passed' }));
  let count = 0;
  function invoke(extra = [], overrides = {}) {
    const mapping = path.join(base, `mapping-${count++}.json`);
    const argv = [sync, '--candidate', candidate, '--private-repo', privateRepo,
      '--public-repo', overrides.publicRepo || publicRepo, '--target-origin', targetOrigin,
      '--mapping-out', mapping, '--policy', policyFile, '--expected-base', overrides.expectedBase || publicBase,
      ...extra];
    const result = spawnSync(process.execPath, argv, { encoding: 'utf8' });
    return { ...result, mapping, output: result.status === 0 ? JSON.parse(result.stdout) : null };
  }
  return { base, privateRepo, publicRepo, git, put, commit, sourceSha, publicBase, policy,
    policyFile, candidate, manifest, review, approval, scan, invoke };
}

function emergencyApproval(f, overrides = {}) {
  const reference = path.join(f.base, 'emergency-AUTHORIZATION.md');
  fs.writeFileSync(reference, 'One-time authorization for a single public snapshot PR.\n');
  const approval = JSON.parse(fs.readFileSync(f.approval));
  delete approval.workflowRunId;
  delete approval.workflowRunAttempt;
  Object.assign(approval, {
    authorizationMethod: 'explicit_user_emergency',
    authorizedBy: 'windsgone',
    authorizationReference: reference,
    scope: 'single_snapshot_pr',
    expiresAt: '2026-10-01T00:00:00+08:00',
    ...overrides,
  });
  fs.writeFileSync(f.approval, JSON.stringify(approval));
  return reference;
}

test('reviewed sync replaces the exact public tree, deletes old files, and keeps private ancestry out', (t) => {
  const f = fixture(t);
  const beforeHead = f.git(f.publicRepo, 'rev-parse', 'HEAD');
  const beforeSeconds = Math.floor(Date.now() / 1000);
  const result = f.invoke(['--approval', f.approval, '--scan-report', f.scan]);
  const afterSeconds = Math.floor(Date.now() / 1000);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.output.changed, true);
  assert.equal(result.output.branch, 'public-source-sync');
  assert.equal(f.git(f.publicRepo, 'rev-parse', 'HEAD'), beforeHead);
  assert.equal(f.git(f.publicRepo, 'rev-parse', 'public-source-sync'), result.output.commitSha);
  assert.equal(f.git(f.publicRepo, 'rev-list', '--parents', '-n', '1', result.output.commitSha),
    `${result.output.commitSha} ${f.publicBase}`);
  assert.deepEqual(f.git(f.publicRepo, 'ls-tree', '-r', '--name-only', result.output.commitSha).split('\n'),
    ['bin/run.sh', 'src/app.js']);
  assert.equal(f.git(f.publicRepo, 'ls-tree', result.output.commitSha, 'bin/run.sh').slice(0, 6), '100755');
  assert.equal(f.git(f.publicRepo, 'show', `${result.output.commitSha}:src/app.js`), 'public v1');
  assert.doesNotMatch(f.git(f.publicRepo, 'log', '-1', '--format=%B', result.output.commitSha), new RegExp(f.sourceSha, 'u'));
  const [authorTime, committerTime] = f.git(f.publicRepo, 'show', '-s', '--format=%at%n%ct', result.output.commitSha)
    .split('\n').map(Number);
  const parentTime = Number(f.git(f.publicRepo, 'show', '-s', '--format=%ct', f.publicBase));
  assert.equal(authorTime, committerTime);
  assert.ok(authorTime >= beforeSeconds && authorTime >= parentTime + 1);
  assert.ok(authorTime <= Math.max(afterSeconds, parentTime + 1));
  const mapping = JSON.parse(fs.readFileSync(result.mapping));
  assert.equal(mapping.sourceSha, f.sourceSha);
  assert.equal(mapping.publicSha, result.output.commitSha);
  assert.equal(mapping.publicationApproved, false);
  assert.equal(fs.existsSync(path.join(f.publicRepo, 'manifest.json')), false);
  assert.equal(fs.existsSync(path.join(f.publicRepo, 'secret.txt')), false);
});

test('one-time emergency authorization creates a reviewed snapshot before its deadline', (t) => {
  const f = fixture(t);
  const reference = emergencyApproval(f);
  const beforeExpiry = Math.floor(Date.parse('2026-09-29T12:00:00+08:00') / 1000);
  const result = f.invoke(['--approval', f.approval, '--scan-report', f.scan, '--commit-time', String(beforeExpiry)]);
  assert.equal(result.status, 0, result.stderr);
  const mapping = JSON.parse(fs.readFileSync(result.mapping));
  assert.equal(mapping.authorizationMethod, 'explicit_user_emergency');
  assert.equal(mapping.authorizedBy, 'windsgone');
  assert.equal(mapping.authorizationScope, 'single_snapshot_pr');
  assert.equal(mapping.authorizationExpiresAt, '2026-10-01T00:00:00+08:00');
  assert.equal(mapping.authorizationReference, fs.realpathSync(reference));
  assert.equal(mapping.authorizationReferenceSha256, sha256(fs.readFileSync(reference)));
});

test('refuses snapshots whose imported public PR history is missing even when bytes match', (t) => {
  const f = fixture(t);
  f.git(f.publicRepo, 'checkout', '-qb', 'external');
  f.put(f.publicRepo, 'src/app.js', 'public v1\n');
  f.git(f.publicRepo, 'add', '.');
  f.git(f.publicRepo, 'commit', '-qm', 'external contribution', '--author=External <external@example.invalid>');
  const headSha = f.git(f.publicRepo, 'rev-parse', 'HEAD');
  f.git(f.publicRepo, 'checkout', '--detach', f.publicBase);
  f.put(f.privateRepo, 'scripts/opensource/contributions.json', JSON.stringify({
    schemaVersion: 1, repository: 'bonc-ai/cogseed', contributions: [{ pr: 406, headSha }],
  }));
  fs.writeFileSync(f.policyFile, JSON.stringify(f.policy));
  const sourceSha = f.commit(f.privateRepo);
  fs.rmSync(f.candidate, { recursive: true });
  command(process.execPath, [exporter, '--repo', f.privateRepo, '--source', sourceSha,
    '--out', f.candidate, '--policy', f.policyFile]);
  const rejected = f.invoke(['--allow-review-required-local']);
  assert.equal(rejected.status, 1, 'snapshot must refuse to absorb an external contribution without its history');
  assert.match(rejected.stderr, /#406.*public.*history/i);
  assert.equal(fs.existsSync(rejected.mapping), false);
});

test('emergency authorization rejects malformed, expired, or workflow-backed approvals', (t) => {
  const cases = [
    ['missing scope', { scope: undefined }],
    ['wrong scope', { scope: 'public_heads_and_tags_only' }],
    ['missing expiry', { expiresAt: undefined }],
    ['expiry after deadline', { expiresAt: '2026-10-01T00:00:01+08:00' }],
    ['already expired', { expiresAt: '2026-09-29T00:00:00+08:00' }],
    ['workflow run id present', { workflowRunId: 123 }],
    ['workflow run attempt present', { workflowRunAttempt: 1 }],
    ['missing authorization file', { authorizationReference: undefined }],
  ];
  for (const [label, overrides] of cases) {
    const f = fixture(t);
    emergencyApproval(f, overrides);
    const commitTime = label === 'already expired'
      ? Math.floor(Date.parse('2026-09-29T12:00:00+08:00') / 1000)
      : Math.floor(Date.parse('2026-09-29T12:00:00+08:00') / 1000);
    const result = f.invoke(['--approval', f.approval, '--scan-report', f.scan, '--commit-time', String(commitTime)]);
    assert.equal(result.status, 1, label);
    assert.equal(fs.existsSync(result.mapping), false, label);
  }
});

test('emergency authorization cannot authorize bootstrap', (t) => {
  const f = fixture(t);
  emergencyApproval(f);
  const fresh = path.join(f.base, 'fresh-public');
  const mapping = path.join(f.base, 'bootstrap-emergency-map.json');
  const result = spawnSync(process.execPath, [sync, '--candidate', f.candidate,
    '--private-repo', f.privateRepo, '--public-repo', fresh, '--target-origin', targetOrigin,
    '--bootstrap', '--mapping-out', mapping, '--policy', f.policyFile,
    '--approval', f.approval, '--scan-report', f.scan], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.equal(fs.existsSync(mapping), false);
});

test('fixed run time reproduces a commit across checkouts; retries reuse it and matching base tree is a no-op', (t) => {
  const f = fixture(t);
  const fixedTime = Math.floor(Date.now() / 1000) + 5;
  const gate = ['--approval', f.approval, '--scan-report', f.scan, '--commit-time', String(fixedTime)];
  const first = f.invoke(gate);
  const again = f.invoke(['--approval', f.approval, '--scan-report', f.scan,
    '--commit-time', String(fixedTime + 60)]);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(again.status, 0, again.stderr);
  assert.equal(again.output.commitSha, first.output.commitSha);
  assert.equal(Number(f.git(f.publicRepo, 'show', '-s', '--format=%ct', first.output.commitSha)), fixedTime);
  const secondCheckout = path.join(f.base, 'second-public');
  command('git', ['clone', '-q', f.publicRepo, secondCheckout]);
  f.git(secondCheckout, 'remote', 'set-url', 'origin', targetOrigin);
  const replica = f.invoke(gate, { publicRepo: secondCheckout });
  assert.equal(replica.status, 0, replica.stderr);
  assert.equal(replica.output.commitSha, first.output.commitSha);
  f.git(f.publicRepo, 'checkout', '-q', 'public-source-sync');
  const noChange = f.invoke(gate, { expectedBase: first.output.commitSha });
  assert.equal(noChange.status, 0, noChange.stderr);
  assert.equal(noChange.output.changed, false);
  assert.equal(noChange.output.branch, null);
  assert.equal(noChange.output.commitSha, first.output.commitSha);
});

test('public parent timestamp is the lower bound even when fixed run time is earlier', (t) => {
  const f = fixture(t);
  const futureTime = Math.floor(Date.now() / 1000) + 3600;
  f.put(f.publicRepo, 'obsolete.txt', 'future base\n');
  f.git(f.publicRepo, 'add', 'obsolete.txt');
  command('git', ['-C', f.publicRepo, 'commit', '-qm', 'future public base'], {
    env: { ...process.env, GIT_AUTHOR_DATE: `${futureTime} +0000`, GIT_COMMITTER_DATE: `${futureTime} +0000` },
  });
  const futureBase = f.git(f.publicRepo, 'rev-parse', 'HEAD');
  const result = f.invoke(['--approval', f.approval, '--scan-report', f.scan,
    '--commit-time', String(futureTime - 100)], { expectedBase: futureBase });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(f.git(f.publicRepo, 'show', '-s', '--format=%at%n%ct', result.output.commitSha)
    .split('\n').map(Number), [futureTime + 1, futureTime + 1]);
});

test('a different snapshot branch tip is never overwritten during retry', (t) => {
  const f = fixture(t);
  const gate = ['--approval', f.approval, '--scan-report', f.scan];
  assert.equal(f.invoke(gate).status, 0);
  f.git(f.publicRepo, 'update-ref', 'refs/heads/public-source-sync', f.publicBase);
  const blocked = f.invoke(gate);
  assert.equal(blocked.status, 1);
  assert.match(blocked.stderr, /already points to a different commit/u);
  assert.equal(f.git(f.publicRepo, 'rev-parse', 'public-source-sync'), f.publicBase);
});

test('draft or flagged export requires an explicit local-only override', (t) => {
  const f = fixture(t, { status: 'draft' });
  const blocked = f.invoke(['--approval', f.approval, '--scan-report', f.scan]);
  assert.equal(blocked.status, 1);
  assert.match(blocked.stderr, /local rehearsal override/u);
  assert.equal(f.git(f.publicRepo, 'rev-parse', 'HEAD'), f.publicBase);
  const rehearsal = f.invoke(['--allow-review-required-local']);
  assert.equal(rehearsal.status, 0, rehearsal.stderr);
  assert.equal(JSON.parse(fs.readFileSync(rehearsal.mapping)).localReviewOverride, true);
  assert.equal(rehearsal.output.publicationApproved, false);
});

test('approval and scan evidence must bind the same immutable source and export', (t) => {
  const f = fixture(t);
  assert.equal(f.invoke().status, 1);
  for (const [file, altered] of [
    [f.approval, { sourceSha: '0'.repeat(40) }],
    [f.scan, { exportSha256: '0'.repeat(64) }],
  ]) {
    const original = JSON.parse(fs.readFileSync(file));
    fs.writeFileSync(file, JSON.stringify({ ...original, ...altered }));
    const result = f.invoke(['--approval', f.approval, '--scan-report', f.scan]);
    assert.equal(result.status, 1);
    assert.equal(fs.existsSync(result.mapping), false);
    fs.writeFileSync(file, JSON.stringify(original));
  }
});

test('reviewed reference hints require bound approval evidence and cannot be erased from the report', (t) => {
  const f = fixture(t, { reference: true });
  assert.equal(f.review.privateReferenceHints.length, 1);
  const gate = ['--approval', f.approval, '--scan-report', f.scan];
  const accepted = f.invoke(gate);
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.equal(JSON.parse(fs.readFileSync(accepted.mapping)).referenceHintsCount, 1);
  const reportPath = path.join(f.candidate, 'review.json');
  fs.writeFileSync(reportPath, JSON.stringify({ ...f.review, privateReferenceHints: [] }));
  const rejected = f.invoke(gate);
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /reference hints/u);
});

test('policy must record review of the exact reference-hint set for standard sync', (t) => {
  const f = fixture(t, { reference: true, badHintReview: true });
  const blocked = f.invoke(['--approval', f.approval, '--scan-report', f.scan]);
  assert.equal(blocked.status, 1);
  assert.match(blocked.stderr, /Policy does not record review/u);
  const rehearsal = f.invoke(['--allow-review-required-local']);
  assert.equal(rehearsal.status, 0, rehearsal.stderr);
  assert.equal(rehearsal.output.publicationApproved, false);
});

test('tampered bytes, extra files, symlinks, and changed mode fail before branch creation', (t) => {
  const f = fixture(t);
  const gate = ['--approval', f.approval, '--scan-report', f.scan];
  const filename = path.join(f.candidate, 'source/src/app.js');
  const original = fs.readFileSync(filename);
  fs.writeFileSync(filename, 'tampered\n');
  assert.equal(f.invoke(gate).status, 1);
  fs.writeFileSync(filename, original);
  fs.writeFileSync(path.join(f.candidate, 'source/extra.txt'), 'extra');
  assert.equal(f.invoke(gate).status, 1);
  fs.rmSync(path.join(f.candidate, 'source/extra.txt'));
  fs.symlinkSync(filename, path.join(f.candidate, 'source/link'));
  assert.equal(f.invoke(gate).status, 1);
  fs.rmSync(path.join(f.candidate, 'source/link'));
  if (process.platform !== 'win32') {
    fs.chmodSync(filename, 0o755);
    assert.equal(f.invoke(gate).status, 1);
  }
  assert.throws(() => f.git(f.publicRepo, 'rev-parse', '--verify', 'public-source-sync'));
});

test('wrong public base, target origin, and mapping inside a checkout are rejected', (t) => {
  const f = fixture(t);
  const gate = ['--approval', f.approval, '--scan-report', f.scan];
  assert.equal(f.invoke(gate, { expectedBase: '0'.repeat(40) }).status, 1);
  f.git(f.publicRepo, 'remote', 'set-url', 'origin', 'https://github.com/example/wrong.git');
  assert.equal(f.invoke(gate).status, 1);
  f.git(f.publicRepo, 'remote', 'set-url', 'origin', targetOrigin);
  const result = spawnSync(process.execPath, [sync, '--candidate', f.candidate, '--private-repo', f.privateRepo,
    '--public-repo', f.publicRepo, '--target-origin', targetOrigin, '--expected-base', f.publicBase,
    '--mapping-out', path.join(f.publicRepo, 'mapping.json'), '--policy', f.policyFile,
    '--approval', f.approval, '--scan-report', f.scan], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.equal(fs.existsSync(path.join(f.publicRepo, 'mapping.json')), false);
});

test('bootstrap creates an orphan public root only in a new local repository', (t) => {
  const f = fixture(t);
  const fresh = path.join(f.base, 'fresh-public');
  const mapping = path.join(f.base, 'bootstrap-map.json');
  const reference = path.join(f.base, 'user-authorization.txt');
  fs.writeFileSync(reference, 'User authorized public heads and tags cutover; keep Releases and PR refs.\n');
  const bootstrap = () => spawnSync(process.execPath, [sync, '--candidate', f.candidate,
    '--private-repo', f.privateRepo, '--public-repo', fresh, '--target-origin', targetOrigin,
    '--bootstrap', '--mapping-out', mapping, '--policy', f.policyFile,
    '--approval', f.approval, '--scan-report', f.scan], { encoding: 'utf8' });
  assert.equal(bootstrap().status, 1, 'ordinary workflow approval cannot authorize bootstrap');
  const ordinary = JSON.parse(fs.readFileSync(f.approval));
  fs.writeFileSync(f.approval, JSON.stringify({
    sourceSha: ordinary.sourceSha, exportSha256: ordinary.exportSha256,
    policySha256: ordinary.policySha256, referenceHintsSha256: ordinary.referenceHintsSha256,
    authorizationMethod: 'explicit_user_cutover', authorizedBy: 'windsgone',
    authorizationReference: reference, scope: 'public_heads_and_tags_only',
    preserveReleaseAssets: true, acceptRetainedPullRefs: true,
  }));
  const beforeSeconds = Math.floor(Date.now() / 1000);
  const result = bootstrap();
  const afterSeconds = Math.floor(Date.now() / 1000);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.changed, true);
  assert.equal(f.git(fresh, 'rev-list', '--parents', '-n', '1', output.commitSha), output.commitSha);
  const [authorTime, committerTime] = f.git(fresh, 'show', '-s', '--format=%at%n%ct', output.commitSha)
    .split('\n').map(Number);
  assert.equal(authorTime, committerTime);
  assert.ok(authorTime >= beforeSeconds && authorTime <= afterSeconds);
  assert.equal(f.git(fresh, 'remote', 'get-url', 'origin'), targetOrigin);
  assert.equal(JSON.parse(fs.readFileSync(mapping)).publicBaseSha, null);
  assert.equal(JSON.parse(fs.readFileSync(mapping)).authorizationMethod, 'explicit_user_cutover');
  assert.equal(JSON.parse(fs.readFileSync(mapping)).authorizationReferenceSha256,
    sha256(fs.readFileSync(reference)));
  assert.equal(bootstrap().status, 1);
});
