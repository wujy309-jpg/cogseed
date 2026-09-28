import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { parseArgs, runCutover } from './cutover.mjs';

const exporter = fileURLToPath(new URL('./export.mjs', import.meta.url));
const sync = fileURLToPath(new URL('./sync.mjs', import.meta.url));
const official = 'https://github.com/bonc-ai/cogseed.git';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function fixture(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cogseed-cutover-test-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const source = path.join(base, 'private');
  const seed = path.join(base, 'seed');
  const bare = path.join(base, 'remote.git');
  const publicRepo = path.join(base, 'bootstrap');
  fs.mkdirSync(source);
  fs.mkdirSync(seed);
  const git = (repo, ...args) => execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  for (const repo of [source, seed]) {
    git(repo, 'init', '-q');
    git(repo, 'config', 'user.name', 'Cutover fixture');
    git(repo, 'config', 'user.email', 'fixture@example.invalid');
    git(repo, 'config', 'commit.gpgsign', 'false');
  }
  git(source, 'remote', 'add', 'origin', 'https://github.com/bonc-ai/cogseed-internal.git');
  fs.mkdirSync(path.join(source, 'src'));
  fs.writeFileSync(path.join(source, 'src/app.js'), 'export const publicVersion = 1;\n');
  fs.writeFileSync(path.join(source, 'secret.txt'), 'private\n');
  git(source, 'add', '.');
  git(source, 'commit', '-qm', 'private source');
  const sourceSha = git(source, 'rev-parse', 'HEAD');
  const policy = {
    schemaVersion: 1, status: 'reviewed', sourceRepository: 'bonc-ai/cogseed-internal',
    targetRepository: 'bonc-ai/cogseed', publicFiles: ['src/app.js'],
    neverPublic: ['secret.txt'], privatePaths: [],
    reviewedReferenceHintsSha256: sha256(JSON.stringify([])),
  };
  const policyPath = path.join(base, 'policy.json');
  fs.writeFileSync(policyPath, JSON.stringify(policy));
  const candidate = path.join(base, 'candidate');
  const exported = spawnSync(process.execPath, [exporter, '--repo', source, '--source', sourceSha,
    '--policy', policyPath, '--out', candidate], { encoding: 'utf8' });
  assert.equal(exported.status, 0, exported.stderr);
  const manifest = JSON.parse(fs.readFileSync(path.join(candidate, 'manifest.json')));
  const approval = path.join(base, 'approval.json');
  const scan = path.join(base, 'scan.json');
  const authorizationReference = path.join(base, 'user-authorization.json');
  fs.writeFileSync(authorizationReference, JSON.stringify({
    authorizedBy: 'windsgone', scope: 'public_heads_and_tags_only',
    preserveReleaseAssets: true, acceptRetainedPullRefs: true,
  }));
  fs.writeFileSync(approval, JSON.stringify({ sourceSha, exportSha256: manifest.exportSha256,
    policySha256: manifest.policySha256, referenceHintsSha256: sha256(JSON.stringify([])),
    authorizedBy: 'windsgone', authorizationMethod: 'explicit_user_cutover',
    authorizationReference, scope: 'public_heads_and_tags_only',
    preserveReleaseAssets: true, acceptRetainedPullRefs: true }));
  fs.writeFileSync(scan, JSON.stringify({ sourceSha, exportSha256: manifest.exportSha256,
    tool: 'gitleaks', status: 'passed' }));
  const mapping = path.join(base, 'mapping.json');
  const bootstrap = spawnSync(process.execPath, [sync, '--candidate', candidate,
    '--private-repo', source, '--public-repo', publicRepo, '--target-origin', official,
    '--bootstrap', '--mapping-out', mapping, '--policy', policyPath,
    '--approval', approval, '--scan-report', scan], { encoding: 'utf8' });
  assert.equal(bootstrap.status, 0, bootstrap.stderr);
  const root = JSON.parse(bootstrap.stdout).commitSha;

  // The remote deliberately has multiple heads, an annotated tag (whose raw
  // tag-object OID differs from its peeled commit), a lightweight tag, and a
  // read-only PR ref. None of its history may become the new root's parent.
  fs.writeFileSync(path.join(seed, 'old.txt'), 'historical public tree\n');
  git(seed, 'add', '.');
  git(seed, 'commit', '-qm', 'old public history');
  const main = git(seed, 'rev-parse', 'HEAD');
  git(seed, 'branch', '-M', 'main');
  git(seed, 'branch', 'feature-a');
  git(seed, 'branch', 'feature-b');
  git(seed, 'tag', '-a', 'v1.0.0', '-m', 'old annotated release');
  git(seed, 'tag', 'v0.9.0');
  git(seed, 'init', '--bare', '-q', bare);
  git(seed, 'remote', 'add', 'test-remote', bare);
  git(seed, 'push', '-q', 'test-remote', 'main', 'feature-a', 'feature-b', 'v1.0.0', 'v0.9.0');
  git(bare, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  git(bare, 'update-ref', 'refs/pull/1/head', main);
  const transport = (repo, command, input) => {
    const remoteCommand = command.includes('ls-remote') || command.includes('push');
    const redirect = remoteCommand ? ['-c', `url.file://${bare}.insteadOf=${official}`] : [];
    return execFileSync('git', ['--no-replace-objects', '-C', repo, ...redirect, ...command], {
      input, maxBuffer: 128 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'],
    });
  };
  const planPath = path.join(base, 'cutover-plan.json');
  const baseArgs = ['--private-repo', source, '--public-repo', publicRepo, '--candidate', candidate,
    '--mapping', mapping, '--policy', policyPath, '--approval', approval, '--scan-report', scan,
    '--expected-main', main, '--expected-heads', '3', '--expected-tags', '2'];
  const planOptions = () => parseArgs([...baseArgs, '--plan-out', planPath]);
  const applyOptions = () => parseArgs([...baseArgs, '--apply', '--plan', planPath,
    '--plan-sha256', JSON.parse(fs.readFileSync(planPath)).planSha256]);
  const refs = () => git(bare, 'for-each-ref', '--format=%(objectname) %(refname)', 'refs/heads', 'refs/tags').split('\n');
  return { base, source, seed, bare, publicRepo, candidate, mapping, manifest, root, main, git,
    policyPath, approval, scan, authorizationReference, transport, planPath, planOptions, applyOptions, refs };
}

test('plan probes a lease-bound atomic push; apply replaces only heads/tags with the orphan main', (t) => {
  const f = fixture(t);
  const before = f.refs();
  const planned = runCutover(f.planOptions(), f.transport);
  assert.equal(planned.status, 0);
  assert.deepEqual(f.refs(), before, 'dry-run must not change remote refs');
  const plan = JSON.parse(fs.readFileSync(f.planPath));
  assert.equal(plan.expectedHeads, 3);
  assert.equal(plan.expectedTags, 2);
  assert.equal(plan.newRootSha, f.root);
  assert.equal(plan.expectedRefs.find((x) => x.ref === 'refs/tags/v1.0.0').oid,
    f.git(f.bare, 'rev-parse', 'refs/tags/v1.0.0'));
  assert.notEqual(plan.expectedRefs.find((x) => x.ref === 'refs/tags/v1.0.0').oid,
    f.git(f.bare, 'rev-parse', 'refs/tags/v1.0.0^{}'));
  assert.equal(runCutover(f.applyOptions(), f.transport).status, 0);
  assert.deepEqual(f.refs(), [`${f.root} refs/heads/main`]);
  assert.equal(f.git(f.bare, 'rev-parse', 'refs/pull/1/head'), f.main);
  assert.equal(f.git(f.bare, 'rev-list', '--parents', '-n', '1', 'refs/heads/main'), f.root);
});

test('tampered plan, candidate bytes, or orphan mapping blocks apply before remote mutation', (t) => {
  const f = fixture(t);
  assert.equal(runCutover(f.planOptions(), f.transport).status, 0);
  const originalRefs = f.refs();
  const originalPlan = fs.readFileSync(f.planPath);
  const changedPlan = JSON.parse(originalPlan);
  changedPlan.newRootSha = '0'.repeat(40);
  fs.writeFileSync(f.planPath, JSON.stringify(changedPlan));
  assert.throws(() => runCutover(f.applyOptions(), f.transport), /digest mismatch/u);
  fs.writeFileSync(f.planPath, originalPlan);
  const file = path.join(f.candidate, 'source/src/app.js');
  const bytes = fs.readFileSync(file);
  fs.writeFileSync(file, 'tampered\n');
  assert.throws(() => runCutover(f.applyOptions(), f.transport), /Candidate bytes differ/u);
  fs.writeFileSync(file, bytes);
  const mapping = JSON.parse(fs.readFileSync(f.mapping));
  fs.writeFileSync(f.mapping, JSON.stringify({ ...mapping, publicSha: f.main }));
  assert.throws(() => runCutover(f.applyOptions(), f.transport));
  assert.deepEqual(f.refs(), originalRefs);
});

test('apply rechecks approval, scan, policy, authorization file and extra source paths', (t) => {
  const f = fixture(t);
  assert.equal(runCutover(f.planOptions(), f.transport).status, 0);
  const before = f.refs();
  for (const [filename, change] of [
    [f.approval, (value) => ({ ...value, scope: 'all_refs' })],
    [f.scan, (value) => ({ ...value, status: 'failed' })],
    [f.policyPath, (value) => ({ ...value, status: 'draft' })],
  ]) {
    const original = fs.readFileSync(filename);
    fs.writeFileSync(filename, JSON.stringify(change(JSON.parse(original))));
    assert.throws(() => runCutover(f.applyOptions(), f.transport));
    fs.writeFileSync(filename, original);
  }
  const originalReference = fs.readFileSync(f.authorizationReference);
  fs.writeFileSync(f.authorizationReference, 'changed authorization record\n');
  assert.throws(() => runCutover(f.applyOptions(), f.transport), /mapping is invalid/iu);
  fs.writeFileSync(f.authorizationReference, originalReference);
  fs.writeFileSync(path.join(f.candidate, 'source/extra.txt'), 'unexpected');
  assert.throws(() => runCutover(f.applyOptions(), f.transport), /extra file/u);
  assert.deepEqual(f.refs(), before);
});

test('remote head or tag drift invalidates the reviewed plan', (t) => {
  const f = fixture(t);
  assert.equal(runCutover(f.planOptions(), f.transport).status, 0);
  f.git(f.bare, 'update-ref', 'refs/heads/new-branch', f.main);
  assert.throws(() => runCutover(f.applyOptions(), f.transport), /Remote refs changed/u);
  assert.equal(f.git(f.bare, 'rev-parse', 'refs/heads/main'), f.main);
});

test('a stale exact lease during atomic push leaves all intended refs untouched', (t) => {
  const f = fixture(t);
  assert.equal(runCutover(f.planOptions(), f.transport).status, 0);
  let injected = false;
  const racingTransport = (repo, command, input) => {
    if (command.includes('push') && !command.includes('--dry-run') && !injected) {
      injected = true;
      f.git(f.bare, 'update-ref', 'refs/tags/v0.9.0', f.git(f.bare, 'rev-parse', 'refs/tags/v1.0.0'));
    }
    return f.transport(repo, command, input);
  };
  assert.throws(() => runCutover(f.applyOptions(), racingTransport));
  assert.equal(injected, true);
  assert.equal(f.git(f.bare, 'rev-parse', 'refs/heads/main'), f.main);
  assert.equal(f.git(f.bare, 'rev-parse', 'refs/heads/feature-a'), f.main);
  assert.equal(f.git(f.bare, 'rev-parse', 'refs/tags/v1.0.0'),
    JSON.parse(fs.readFileSync(f.planPath)).expectedRefs.find((x) => x.ref === 'refs/tags/v1.0.0').oid);
  assert.equal(f.git(f.bare, 'rev-parse', 'refs/tags/v0.9.0'), f.git(f.bare, 'rev-parse', 'refs/tags/v1.0.0'));
});

test('wrong origin, expected counts, and server rejection cannot mutate remote refs', (t) => {
  const f = fixture(t);
  const before = f.refs();
  f.git(f.publicRepo, 'remote', 'set-url', 'origin', 'https://github.com/example/wrong.git');
  assert.throws(() => runCutover(f.planOptions(), f.transport), /Public origin/u);
  f.git(f.publicRepo, 'remote', 'set-url', 'origin', official);
  f.git(f.publicRepo, 'remote', 'set-url', '--push', 'origin', 'https://github.com/example/wrong.git');
  assert.throws(() => runCutover(f.planOptions(), f.transport), /push destination/u);
  f.git(f.publicRepo, 'config', '--unset', 'remote.origin.pushurl');
  f.git(f.publicRepo, 'config', 'remote.origin.mirror', 'true');
  assert.throws(() => runCutover(f.planOptions(), f.transport), /mirror mode/u);
  f.git(f.publicRepo, 'config', '--unset', 'remote.origin.mirror');
  const wrongCounts = { ...f.planOptions(), 'expected-heads': '2' };
  assert.throws(() => runCutover(wrongCounts, f.transport), /Remote heads/u);
  assert.deepEqual(f.refs(), before);
  const hook = path.join(f.bare, 'hooks/pre-receive');
  fs.writeFileSync(hook, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  const planned = runCutover(f.planOptions(), f.transport);
  assert.ok([0, 2].includes(planned.status));
  assert.throws(() => runCutover(f.applyOptions(), f.transport));
  assert.deepEqual(f.refs(), before);
});
