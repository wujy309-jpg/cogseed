import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { parse } from 'yaml';
import { PUBLIC_CI_JOBS } from '../verify-release-gates.mjs';

const load = (name) => parse(fs.readFileSync(new URL(`../../.github/workflows/${name}`, import.meta.url), 'utf8'));
const commands = (job) => job.steps.map((step) => step.run || '').join('\n');

test('billable private candidate CI never executes full tests, native downloads or packaging', () => {
  for (const name of ['ci.yml', 'compliance.yml']) {
    const wf = load(name);
    assert.deepEqual(wf.on, { pull_request: { branches: ['cicd'] }, push: { branches: ['cicd'] } });
    for (const job of Object.values(wf.jobs)) {
      assert.equal(job.if, "github.repository == 'bonc-ai/cogseed-internal'");
      assert.equal(job['runs-on'], 'ubuntu-24.04');
      assert.ok(job['timeout-minutes'] <= 10);
      assert.match(commands(job), /npm ci --ignore-scripts/);
      assert.doesNotMatch(commands(job), /run-tests|test:js|test:resources|package:|build:win/);
    }
  }
  const develop = load('develop-gate.yml');
  assert.deepEqual(Object.keys(develop.jobs), ['static-gates']);
  assert.match(commands(develop.jobs['static-gates']), /npm ci --ignore-scripts/);
  assert.doesNotMatch(commands(develop.jobs['static-gates']), /test:js|test:resources|run-tests/);
  assert.deepEqual(load('develop-nightly.yml').jobs['full-suite']['runs-on'], ['self-hosted', 'Linux', 'cogseed-internal']);
});

test('public CI graph exactly matches release prerequisites including every platform shard', () => {
  const wf = load('public-ci.yml');
  assert.deepEqual(wf.on, { pull_request: { branches: ['main'] }, push: { branches: ['main'] } });
  assert.deepEqual(wf.permissions, { contents: 'read' });
  const names = [];
  for (const [id, job] of Object.entries(wf.jobs)) {
    assert.equal(job.if, "github.repository == 'bonc-ai/cogseed'");
    assert.equal(job.environment, undefined);
    assert.equal(job['continue-on-error'], undefined);
    assert.doesNotMatch(JSON.stringify(job), /secrets\.|pull_request_target|cogseed-internal\.git/);
    if (job.strategy) {
      assert.deepEqual(job.strategy.matrix.shard, [1, 2, 3, 4]);
      assert.equal(job.strategy['fail-fast'], false);
      assert.equal(job.name, id + ' (${{ matrix.shard }})');
      assert.match(commands(job), /npm run test:js -- --maxWorkers=1 --shard=\$\{\{ matrix.shard \}\}\/4/);
      names.push(...job.strategy.matrix.shard.map((n) => `${id} (${n})`));
    } else names.push(id);
  }
  assert.deepEqual(names.sort(), [...PUBLIC_CI_JOBS].sort());
  assert.match(commands(wf.jobs['verify-macos']), /verify:package:dev:mac/);
  assert.match(commands(wf.jobs['verify-windows-package']), /verify:package:launch/);
  assert.match(commands(wf.jobs['verify-windows-package']), /verify:package:stt:win/);
  assert.match(commands(wf.jobs['verify-windows-package']), /verify:package:build-info -- --channel=ci/);
  const policy = JSON.parse(fs.readFileSync(new URL('./policy.json', import.meta.url), 'utf8'));
  for (const file of ['scripts/check-fuses.cjs', 'scripts/verify-packaged-build-info.cjs']) {
    assert.ok(policy.publicFiles.includes(file), `${file} must reach the public checkout`);
    assert.ok(fs.existsSync(new URL(`../../${file}`, import.meta.url)), `${file} must exist in source`);
  }
});

test('release is public-only, tag-only and signing is approval-bound', () => {
  assert.equal(fs.existsSync(new URL('../../.github/workflows/release.yml', import.meta.url)), false);
  const wf = load('public-release.yml');
  assert.deepEqual(wf.on, { push: { tags: ['v*'] } });
  for (const job of Object.values(wf.jobs)) assert.equal(job.if, "github.repository == 'bonc-ai/cogseed'");
  assert.equal(wf.jobs['build-macos'].environment, 'release-signing');
  for (const id of ['build-macos', 'build-windows']) {
    assert.match(commands(wf.jobs[id]), /verify:package:build-info/);
    assert.match(commands(wf.jobs[id]), /check-fuses\.cjs/);
  }
  assert.match(commands(wf.jobs.gate), /verify-release-gates\.mjs/);
  assert.match(commands(wf.jobs.publish), /verify-release-gates\.mjs\n/);
  assert.match(commands(wf.jobs.publish), /--publish-target/);
  assert.match(commands(wf.jobs.publish), /SHA256SUMS\.txt/);
  assert.match(commands(wf.jobs.publish), /sha256sum/);
  assert.equal(wf.jobs.publish.permissions.contents, 'write');
});
