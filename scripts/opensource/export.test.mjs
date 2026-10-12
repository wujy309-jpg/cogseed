import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const exporter = fileURLToPath(new URL('./export.mjs', import.meta.url));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function fixture(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cogseed-export-test-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const repo = path.join(base, 'repo');
  fs.mkdirSync(repo);
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-q');
  git('config', 'user.name', 'Export fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'core.autocrlf', 'false');
  git('remote', 'add', 'origin', 'https://github.com/bonc-ai/cogseed-internal.git');
  const put = (name, value) => {
    const target = path.join(repo, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, value);
  };
  const commit = () => { git('add', '.'); git('commit', '-qm', 'fixture'); return git('rev-parse', 'HEAD'); };
  put('src/app.js', 'export const version = 1;\r\n');
  put('docs/public.md', '# Public\n');
  put('docs/internal.md', '# Internal\n');
  put('.agents/rules.md', '# Private authoring tools\n');
  put('AGENTS.md', '# Private\n');
  put('.gitattributes', 'src/app.js export-ignore\n');
  const sha = commit();
  const policy = {
    schemaVersion: 1, status: 'reviewed', sourceRepository: 'bonc-ai/cogseed-internal', targetRepository: 'bonc-ai/cogseed',
    publicFiles: ['src/app.js', 'docs/public.md'], neverPublic: ['.agents/', 'AGENTS.md'], privatePaths: ['docs/', '.gitattributes'],
  };
  const policyPath = path.join(base, 'policy.json');
  let count = 0;
  function run(extra = [], source = sha) {
    fs.writeFileSync(policyPath, JSON.stringify(policy));
    const out = path.join(base, `out-${count++}`);
    const processResult = spawnSync(process.execPath, [exporter, '--repo', repo, '--source', source, '--policy', policyPath, '--out', out, ...extra], { encoding: 'utf8' });
    return { ...processResult, out,
      read: (name) => fs.readFileSync(path.join(out, name)),
      report: () => JSON.parse(fs.readFileSync(path.join(out, 'review.json'))),
      manifest: () => JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'))),
    };
  }
  return { base, repo, git, put, commit, sha, policy, policyPath, run };
}

test('exports only pinned Git bytes; never checkout edits, private data, filters or untracked files', (t) => {
  const f = fixture(t);
  f.put('src/app.js', 'uncommitted content');
  f.put('src/untracked.txt', 'untracked content');
  f.put('.gitattributes', 'src/app.js export-ignore\n');
  const before = f.git('status', '--porcelain');
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.read('source/src/app.js').toString(), 'export const version = 1;\r\n');
  for (const name of ['.git', '.agents', 'AGENTS.md', 'docs/internal.md', 'src/untracked.txt', 'review.json', 'manifest.json']) {
    assert.equal(fs.existsSync(path.join(result.out, 'source', name)), false, name);
  }
  assert.equal(f.git('status', '--porcelain'), before);
  assert.equal(f.git('rev-parse', 'HEAD'), f.sha);
  assert.equal(result.report().readyForPublication, false);
  assert.equal(result.report().checks.contentSecurityScan, 'not-run');
  const manifest = result.manifest();
  assert.equal(manifest.exportSha256, sha256(JSON.stringify(manifest.files)));
  assert.equal(manifest.sourceSha, f.sha);
  assert.equal(manifest.publicSha, null);
});

test('new files are withheld even in a previously public directory; renamed files require review', (t) => {
  const f = fixture(t);
  f.put('src/new.js', 'new code');
  f.git('mv', 'src/app.js', 'src/renamed.js');
  const result = f.run([], f.commit());
  assert.equal(result.status, 2, result.stderr);
  assert.deepEqual(result.report().unclassifiedFiles, ['src/new.js', 'src/renamed.js']);
  assert.deepEqual(result.report().missingPublicFiles, ['src/app.js']);
  assert.equal(fs.existsSync(path.join(result.out, 'source/src')), false);
});

test('neverPublic wins over an erroneous public inventory entry', (t) => {
  const f = fixture(t);
  f.policy.publicFiles.push('.agents/rules.md');
  const result = f.run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /conflicts with neverPublic/u);
  assert.equal(fs.existsSync(result.out), false);
});

test('draft policy stays review-required even without classification errors', (t) => {
  const f = fixture(t);
  f.policy.status = 'draft';
  const result = f.run();
  assert.equal(result.status, 2);
  assert.equal(result.report().policyStatus, 'draft');
});

test('reproducible inventory digest and exact added/changed/removed differences', (t) => {
  const f = fixture(t);
  const first = f.run();
  const repeat = f.run();
  assert.equal(first.manifest().exportSha256, repeat.manifest().exportSha256);
  f.put('src/app.js', 'export const version = 2;\n');
  f.put('src/new.js', 'new');
  f.git('rm', 'docs/public.md');
  f.policy.publicFiles = ['src/app.js', 'src/new.js'];
  const result = f.run(['--previous', path.join(first.out, 'manifest.json')], f.commit());
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.report().difference, { added: ['src/new.js'], removed: ['docs/public.md'], changed: ['src/app.js'] });
  const tampered = first.manifest();
  tampered.files[0].sha256 = 'invalid';
  fs.writeFileSync(path.join(first.out, 'manifest.json'), JSON.stringify(tampered));
  assert.equal(f.run(['--previous', path.join(first.out, 'manifest.json')]).status, 1);
});

test('rejects symlinks, including ones pointing outside the repository', (t) => {
  const f = fixture(t);
  f.put('target.txt', 'private data');
  // Write a symlink entry directly to Git, including on Windows without symlink privileges.
  const oid = execFileSync('git', ['-C', f.repo, 'hash-object', '-w', '--stdin'], { input: '../../outside', encoding: 'utf8' }).trim();
  f.git('update-index', '--add', '--cacheinfo', `120000,${oid},src/link`);
  f.git('commit', '-qm', 'symlink fixture');
  f.policy.publicFiles.push('src/link');
  const result = f.run([], f.git('rev-parse', 'HEAD'));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /symlink or submodule/u);
  assert.equal(fs.existsSync(result.out), false);
});

test('rejects submodule entries instead of silently dropping their contents', (t) => {
  const f = fixture(t);
  f.git('update-index', '--add', '--cacheinfo', `160000,${f.sha},src/dependency`);
  f.git('commit', '-qm', 'gitlink fixture');
  f.policy.publicFiles.push('src/dependency');
  assert.equal(f.run([], f.git('rev-parse', 'HEAD')).status, 1);
});

test('rejects LFS pointers and does not silently export incomplete source', (t) => {
  const f = fixture(t);
  f.put('src/app.js', `version https://git-lfs.github.com/spec/v1\noid sha256:${'0'.repeat(64)}\nsize 100\n`);
  const result = f.run([], f.commit());
  assert.equal(result.status, 1);
  assert.match(result.stderr, /LFS pointer/u);
});

test('rejects traversal, Windows aliases and case-colliding inventories', (t) => {
  const f = fixture(t);
  for (const bad of ['../escape', '/absolute', 'src/CON.txt', 'src/file:stream', 'src/file.', 'src/../escape', 'src/.git/config']) {
    f.policy.publicFiles = [bad];
    assert.equal(f.run().status, 1, bad);
  }
  const oid = f.git('rev-parse', `${f.sha}:src/app.js`);
  f.git('update-index', '--add', '--cacheinfo', `100644,${oid},Src/other.js`);
  f.git('commit', '-qm', 'case collision');
  f.policy.publicFiles = ['src/app.js', 'Src/other.js'];
  const result = f.run([], f.git('rev-parse', 'HEAD'));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Case collision/u);
});

test('preserves executable modes, Unicode paths and binary bytes', (t) => {
  const f = fixture(t);
  f.put('src/示例.bin', Buffer.from([0, 255, 128, 10]));
  f.git('add', '.');
  f.git('update-index', '--chmod=+x', 'src/app.js');
  f.git('commit', '-qm', 'binary and executable fixture');
  f.policy.publicFiles.push('src/示例.bin');
  const result = f.run([], f.git('rev-parse', 'HEAD'));
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.read('source/src/示例.bin'), Buffer.from([0, 255, 128, 10]));
  assert.equal(result.manifest().files.find((file) => file.path === 'src/app.js').mode, '100755');
  if (process.platform !== 'win32') assert.notEqual(fs.statSync(path.join(result.out, 'source/src/app.js')).mode & 0o100, 0);
});

test('reports internal document references without publishing private document content', (t) => {
  const f = fixture(t);
  f.put('docs/public.md', '[Internal](internal.md#section) and [Rules](../AGENTS.md) and [External](https://example.invalid/internal.md)');
  const result = f.run([], f.commit());
  assert.equal(result.status, 2);
  assert.deepEqual(result.report().privateReferenceHints, [{ path: 'docs/public.md', references: ['AGENTS.md', 'docs/internal.md'] }]);
});

test('refuses a wrong source remote, mutable ref, existing output and output inside any repository', (t) => {
  const f = fixture(t);
  assert.equal(f.run([], 'develop').status, 1);
  const first = f.run();
  const invoke = (out) => spawnSync(process.execPath, [exporter, '--repo', f.repo, '--source', f.sha, '--policy', f.policyPath, '--out', out], { encoding: 'utf8' });
  assert.equal(invoke(first.out).status, 1);
  assert.equal(invoke(path.join(f.repo, 'export')).status, 1);
  const other = path.join(f.base, 'public-checkout');
  fs.mkdirSync(other);
  execFileSync('git', ['-C', other, 'init', '-q']);
  assert.equal(invoke(path.join(other, 'export')).status, 1);
  f.git('remote', 'set-url', 'origin', 'https://github.com/bonc-ai/cogseed.git');
  assert.equal(f.run().status, 1);
});
