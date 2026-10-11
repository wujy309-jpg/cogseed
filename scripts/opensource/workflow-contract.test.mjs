import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/public-source-sync.yml'), 'utf8');
const triggers = workflow.split('\nconcurrency:\n')[0];
const prepare = workflow.split('\n  prepare:\n')[1]?.split('\n  publish_pr:\n')[0];
const publish = workflow.split('\n  publish_pr:\n')[1];

function step(job, name) {
  const start = job.indexOf(`      - name: ${name}\n`);
  assert.notEqual(start, -1, `missing step: ${name}`);
  const end = job.indexOf('\n      - ', start + 1);
  return job.slice(start, end === -1 ? undefined : end);
}

test('only explicit private default-branch dispatch can start source publication', () => {
  assert.ok(prepare && publish);
  assert.match(triggers, /workflow_dispatch:\n\s+inputs:\n\s+source_sha:/);
  assert.doesNotMatch(triggers, /\n  (?:push|pull_request|release|schedule):/);
  assert.match(prepare, /GITHUB_REPOSITORY.*bonc-ai\/cogseed-internal/);
  assert.match(prepare, /GITHUB_REF.*refs\/heads\/develop/);
  assert.match(prepare, /GITHUB_EVENT_NAME.*workflow_dispatch/);
  assert.match(prepare, /GITHUB_RUN_ATTEMPT.*== 1/);
  assert.match(prepare, /PUBLIC_SOURCE_BASELINE_SHA/);
  assert.match(prepare, /PUBLIC_SOURCE_BASELINE_READY/);
  assert.match(prepare, /SOURCE_SHA: \$\{\{ inputs\.source_sha \}\}/);
  assert.match(prepare, /\^\[0-9a-f\]\{40\}\$/);
  assert.match(prepare, /ref: \$\{\{ github\.sha \}\}[\s\S]*path: tooling/);
  assert.match(prepare, /ref: \$\{\{ inputs\.source_sha \}\}[\s\S]*path: source/);
  assert.match(prepare, /COMPARE_BASE.*compare\/\$SOURCE_SHA\.\.\.cicd/);
  assert.match(prepare, /\[\[ "\$COMPARE_BASE" == "\$SOURCE_SHA" \]\]/);
  assert.match(prepare, /actions\/workflows\/\$WORKFLOW\/runs/);
  assert.match(prepare, /run\.head_sha === process\.env\.SOURCE_SHA/);
  assert.match(prepare, /run\.head_branch === 'cicd' && run\.event === 'push'/);
  assert.match(prepare, /runs\[0\]\.conclusion !== 'success'/);
  assert.match(prepare, /compare\/\$BASELINE_SHA\.\.\.\$PUBLIC_BASE/);
  assert.match(prepare, /\[\[ "\$BASELINE_MERGE_BASE" == "\$BASELINE_SHA" \]\]/);
  assert.doesNotMatch(prepare, /source .*github\.sha|--source.*github\.sha/);
});

test('reviewed inventory and same-version secret scan precede any public token', () => {
  assert.match(workflow, /permissions:\n  contents: read/);
  assert.match(workflow, /  actions: read/);
  assert.match(publish, /permissions:\n      contents: read\n      actions: read/);
  assert.doesNotMatch(workflow, /continue-on-error:\s*true/);
  for (const [, action] of workflow.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)) {
    assert.match(action, /^[a-z0-9-]+\/[a-z0-9-]+@[0-9a-f]{40}$/u, `unpinned action: ${action}`);
  }
  const contracts = step(prepare, 'Test private export and sync contracts');
  assert.match(contracts, /npm ci --ignore-scripts/);
  const exported = step(prepare, 'Export and require a reviewed, complete candidate');
  assert.match(exported, /report\.policyStatus !== 'reviewed'/);
  assert.match(exported, /report\.missingPublicFiles\.length !== 0/);
  assert.match(exported, /report\.unclassifiedFiles\.length !== 0/);
  assert.match(exported, /policy\.reviewedReferenceHintsSha256 !== hintsHash/);
  const install = step(prepare, 'Install verified Gitleaks 8.30.1');
  assert.match(install, /gitleaks_8\.30\.1_linux_x64\.tar\.gz/);
  assert.match(install, /551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb/);
  assert.match(install, /sha256sum --check --status/);
  const scan = step(prepare, 'Prove scanner detects secrets, then scan exact candidate');
  assert.match(scan, /scripts\/opensource\/gitleaks\.toml/);
  assert.match(scan, /GITLEAKS_CONFIG -u GITLEAKS_CONFIG_TOML/);
  assert.match(scan, /--exit-code 23/);
  assert.match(scan, /CANARY_STATUS.*23/);
  assert.match(scan, /scan-canary-allowlist\/src\/core-agent\/test\/tools\.test\.ts/);
  assert.match(scan, /randomBytes\(32\)\.toString\('hex'\)/);
  assert.match(scan, /RULE=generic-api-key/);
  assert.match(scan, /finding\.RuleID === process\.env\.EXPECTED_RULE/);
  assert.match(scan, /public-source-export\/source/);
  assert.match(scan, /status: 'passed'/);
  assert.ok(prepare.indexOf('Install verified Gitleaks') < prepare.indexOf('Prove scanner'));
  assert.doesNotMatch(prepare, /create-github-app-token|permission-contents: write/);
});

test('publication binds scan evidence, authorizer and expected public base', () => {
  assert.match(publish, /PUBLIC_SOURCE_BASELINE_READY/);
  assert.match(publish, /PUBLIC_SOURCE_BASELINE_SHA/);
  assert.match(publish, /GITHUB_RUN_ATTEMPT.*== 1/);
  assert.match(publish, /Source is no longer on private cicd history/);
  assert.match(publish, /runs\[0\]\.conclusion !== 'success'/);
  assert.match(publish, /Public main changed during review/);
  const fresh = step(publish, 'Re-export the same immutable candidate');
  assert.match(fresh, /verifyEvidence/);
  assert.match(fresh, /SCAN_EVIDENCE_JSON: \$\{\{ needs\.prepare\.outputs\.evidence_json \}\}/);
  assert.match(fresh, /sourceSha: process\.env\.SOURCE_SHA/);
  assert.match(fresh, /exportSha256: process\.env\.EXPECTED_EXPORT/);
  assert.doesNotMatch(workflow, /actions\/(?:upload|download)-artifact/);
  assert.match(step(prepare, 'Capture compact scan evidence'), /captureEvidence/);
  assert.match(step(prepare, 'Retain private review and scan evidence'), /GITHUB_STEP_SUMMARY/);
  assert.match(step(publish, 'Retain mapping in the private workflow only'), /GITHUB_STEP_SUMMARY/);
  const approval = step(publish, 'Record manual source authorization privately');
  assert.match(approval, /AUTHORIZED_BY: \$\{\{ github\.actor \}\}/);
  assert.match(approval, /authorizationMethod: 'workflow_dispatch'/);
  assert.match(approval, /policySha256: manifest\.policySha256/);
  assert.match(approval, /referenceHintsSha256/);
  assert.ok(publish.indexOf('Record manual source authorization') < publish.indexOf('Create narrowly scoped public repository token'));
  const token = step(publish, 'Create narrowly scoped public repository token');
  assert.match(token, /repositories: cogseed/);
  assert.match(token, /permission-contents: write/);
  assert.match(token, /permission-pull-requests: write/);
  assert.match(token, /permission-workflows: write/);
  assert.match(token, /secrets\.PUBLIC_SOURCE_APP_PRIVATE_KEY/);
  const staged = step(publish, 'Stage idempotent public snapshot commit locally');
  for (const arg of ['--candidate', '--private-repo', '--public-repo', '--policy', '--exporter', '--expected-base', '--target-origin', '--approval', '--scan-report', '--mapping-out']) {
    assert.ok(staged.includes(arg), `missing sync input ${arg}`);
  }
  assert.match(staged, /result\.branch !== 'public-source-sync'/);
  assert.match(step(publish, 'Require unchanged public main'), /merge-base --is-ancestor "\$BASELINE_SHA" "\$EXPECTED_BASE"/);
  const remote = step(publish, 'Push only the snapshot branch and open or update its PR');
  assert.match(remote, /gh api -X GET repos\/bonc-ai\/cogseed\/pulls/);
  assert.match(remote, /-f head=bonc-ai:public-source-sync -f base=main -f state=open/);
  assert.doesNotMatch(remote, /gh pr list --head bonc-ai:/);
  assert.match(remote, /--force-with-lease=/);
  assert.match(remote, /refs\/heads\/public-source-sync:refs\/heads\/public-source-sync/);
  assert.match(remote, /gh pr create --repo bonc-ai\/cogseed --base main --head public-source-sync/);
  assert.doesNotMatch(remote, /git .*push .*refs\/heads\/main|gh pr merge|--admin|--force origin main/);
  assert.doesNotMatch(remote.slice(remote.indexOf('gh pr create')), /SOURCE_SHA|source_sha|cicd|cogseed-internal/);
});

test('public author history is verified before write credentials and snapshot mutation', () => {
  const checkout = step(prepare, 'Check out public history for contribution attribution');
  assert.match(checkout, /repository: bonc-ai\/cogseed/);
  assert.match(checkout, /ref: \$\{\{ steps\.identity\.outputs\.public_base \}\}/);
  assert.match(checkout, /fetch-depth: 0/);
  assert.match(checkout, /persist-credentials: false/);
  const attribution = step(prepare, 'Require imported contributions in public main history');
  assert.match(attribution, /SOURCE_SHA: \$\{\{ inputs\.source_sha \}\}/);
  assert.match(attribution, /PUBLIC_BASE: \$\{\{ steps\.identity\.outputs\.public_base \}\}/);
  assert.match(attribution, /contributions\.mjs/);
  assert.match(attribution, /"\$GITHUB_WORKSPACE\/source" "\$SOURCE_SHA"/);
  assert.match(attribution, /"\$GITHUB_WORKSPACE\/public-history" "\$PUBLIC_BASE"/);
  assert.ok(prepare.indexOf('Require imported contributions') < prepare.indexOf('Capture compact scan evidence'));
  assert.match(publish, /needs: prepare|Stage idempotent public snapshot commit locally/);
  assert.match(workflow, /publish_pr:\n    needs: prepare/);
});
