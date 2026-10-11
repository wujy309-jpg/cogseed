import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { CONTRIBUTIONS_PATH, verifyContributions } from './contributions.mjs';

function fixture(t, registered = true) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'contribution-history-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const privateRepo = path.join(root, 'private');
  const publicRepo = path.join(root, 'public');
  const git = (repo, ...args) => execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
  for (const repo of [privateRepo, publicRepo]) {
    fs.mkdirSync(repo);
    git(repo, 'init', '-q');
    git(repo, 'config', 'user.name', 'Maintainer');
    git(repo, 'config', 'user.email', '123+maintainer@users.noreply.github.com');
    git(repo, 'config', 'commit.gpgsign', 'false');
    fs.writeFileSync(path.join(repo, 'app.txt'), 'base\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '-qm', 'base');
  }
  const base = git(publicRepo, 'rev-parse', 'HEAD');
  git(publicRepo, 'checkout', '-qb', 'external');
  fs.writeFileSync(path.join(publicRepo, 'app.txt'), 'contribution\n');
  git(publicRepo, 'add', '.');
  git(publicRepo, 'commit', '--author=Contributor <456+contributor@users.noreply.github.com>',
    '-qm', 'Contribution\n\nSigned-off-by: Contributor <456+contributor@users.noreply.github.com>');
  const headSha = git(publicRepo, 'rev-parse', 'HEAD');
  git(publicRepo, 'checkout', '--detach', base);
  // Reproduce the lost attribution: identical content, unrelated sync commit.
  fs.writeFileSync(path.join(publicRepo, 'app.txt'), 'contribution\n');
  git(publicRepo, 'add', '.');
  git(publicRepo, 'commit', '-qm', 'snapshot');
  const publicBase = git(publicRepo, 'rev-parse', 'HEAD');
  const ledgerPath = path.join(privateRepo, CONTRIBUTIONS_PATH);
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  const record = { pr: 406, headSha };
  function source(contributions = [record], message = 'source') {
    fs.writeFileSync(ledgerPath, JSON.stringify({ schemaVersion: 1, repository: 'bonc-ai/cogseed', contributions }));
    git(privateRepo, 'add', '.');
    git(privateRepo, 'commit', '--allow-empty', '-qm', message);
    return git(privateRepo, 'rev-parse', 'HEAD');
  }
  const options = { privateRepo, publicRepo, publicBase, sourceSha: source(registered ? [record] : []) };
  return { git, source, options, headSha, ledgerPath, record };
}

test('identical snapshot bytes do not substitute for public author ancestry', (t) => {
  const f = fixture(t);
  const { publicRepo, publicBase } = f.options;
  assert.equal(f.git(publicRepo, 'rev-parse', `${publicBase}^{tree}`),
    f.git(publicRepo, 'rev-parse', `${f.headSha}^{tree}`));
  assert.throws(() => verifyContributions(f.options), /#406.*public main history/);
  // Even checking out the author's branch cannot substitute for the fixed base.
  f.git(publicRepo, 'checkout', '--detach', f.headSha);
  assert.throws(() => verifyContributions(f.options), /#406.*public main history/);
});

test('ordinary history repair preserves the whole tree and original author, then passes', (t) => {
  const f = fixture(t);
  const { publicRepo, publicBase } = f.options;
  const author = f.git(publicRepo, 'show', '-s', '--format=%an%n%ae%n%B', f.headSha);
  f.git(publicRepo, 'merge', '--no-ff', f.headSha, '-m', 'Restore public contribution ancestry');
  const repaired = f.git(publicRepo, 'rev-parse', 'HEAD');
  assert.equal(f.git(publicRepo, 'rev-parse', `${repaired}^{tree}`),
    f.git(publicRepo, 'rev-parse', `${publicBase}^{tree}`));
  assert.equal(f.git(publicRepo, 'show', '-s', '--format=%an%n%ae%n%B', f.headSha), author);
  const result = verifyContributions({ ...f.options, publicBase: repaired });
  assert.equal(result.count, 1);
  assert.deepEqual(result.pullRequests, [406]);
  assert.match(result.ledgerSha256, /^[0-9a-f]{64}$/);
});

test('the fixed source ledger cannot be bypassed by editing the working tree', (t) => {
  const f = fixture(t);
  fs.writeFileSync(f.ledgerPath, JSON.stringify({ schemaVersion: 1, repository: 'bonc-ai/cogseed', contributions: [] }));
  assert.throws(() => verifyContributions(f.options), /#406.*public main history/);
});

test('missing or malformed source ledgers fail closed', (t) => {
  const f = fixture(t);
  fs.unlinkSync(f.ledgerPath);
  f.git(f.options.privateRepo, 'add', '.');
  f.git(f.options.privateRepo, 'commit', '-qm', 'missing ledger');
  assert.throws(() => verifyContributions({ ...f.options,
    sourceSha: f.git(f.options.privateRepo, 'rev-parse', 'HEAD') }), /missing.*ledger/);
  fs.writeFileSync(f.ledgerPath, '{');
  f.git(f.options.privateRepo, 'add', '.');
  f.git(f.options.privateRepo, 'commit', '-qm', 'invalid ledger');
  assert.throws(() => verifyContributions({ ...f.options,
    sourceSha: f.git(f.options.privateRepo, 'rev-parse', 'HEAD') }), /Invalid.*JSON/);
});

test('duplicate entries and invalid identities cannot authorize a snapshot', (t) => {
  const f = fixture(t);
  for (const entries of [[{ pr: -1, headSha: f.headSha }], [{ pr: 406, headSha: 'main' }],
    [{ pr: 406, headSha: f.options.publicBase }, { pr: 406, headSha: f.options.publicBase }]]) {
    assert.throws(() => verifyContributions({ ...f.options, sourceSha: f.source(entries) }), /Invalid or duplicate/);
  }
});

test('an imported Source-PR without a ledger entry blocks publication', (t) => {
  const f = fixture(t, false);
  const sourceSha = f.source([], 'Import\n\nSource-PR: https://github.com/bonc-ai/cogseed/pull/406');
  assert.throws(() => verifyContributions({ ...f.options, sourceSha }), /Source-PR import.*missing/);
});

test('tree-copy release promotion retains the contribution gate without import ancestry', (t) => {
  const f = fixture(t);
  const tree = f.git(f.options.privateRepo, 'rev-parse', `${f.options.sourceSha}^{tree}`);
  const sourceSha = f.git(f.options.privateRepo, 'commit-tree', tree, '-m', 'Promoted tree');
  assert.throws(() => verifyContributions({ ...f.options, sourceSha }), /#406.*public main history/);
});

test('bootstrap cannot discard registered contributions', (t) => {
  const f = fixture(t);
  assert.throws(() => verifyContributions({ ...f.options, publicBase: null }), /Bootstrap would discard/);
  const empty = fixture(t, false);
  assert.equal(verifyContributions({ ...empty.options, publicBase: null }).count, 0);
});

test('a tree-copy promotion cannot remove a previously registered contribution', (t) => {
  const f = fixture(t);
  const sourceSha = f.source([]);
  assert.throws(() => verifyContributions({ ...f.options, sourceSha }), /removed or changed/);
});
