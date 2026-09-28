#!/usr/bin/env node
/**
 * One-time public Git ref cutover. Plan first, then explicitly apply the exact
 * reviewed plan digest. Only heads and tags are in scope: GitHub Release
 * objects/assets and read-only refs/pull/* are neither edited nor deleted.
 * Every ref update is covered by an exact old-OID lease in one atomic push.
 * No branch-protection or ruleset changes are performed here.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkedRepository, validateCandidate } from './sync.mjs';

const TARGET = 'bonc-ai/cogseed';
const SOURCE = 'bonc-ai/cogseed-internal';
const ORIGIN = [
  `https://github.com/${TARGET}`, `https://github.com/${TARGET}.git`,
  `git@github.com:${TARGET}`, `git@github.com:${TARGET}.git`,
  `ssh://git@github.com/${TARGET}`, `ssh://git@github.com/${TARGET}.git`,
];
const SHA = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const gitOid = (bytes) => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const within = (root, name) => name === root || name.startsWith(`${root}${path.sep}`);
const fail = (message) => { throw new Error(message); };

function help() {
  return `Usage:
  node scripts/opensource/cutover.mjs --private-repo <private checkout> --public-repo <bootstrap checkout> --candidate <export dir> --mapping <bootstrap mapping.json> --policy <reviewed policy.json> --approval <private approval.json> --scan-report <private scan.json> --expected-main <old public main SHA> --expected-heads <count> --expected-tags <count> --plan-out <new private JSON>
  node scripts/opensource/cutover.mjs --private-repo <private checkout> --public-repo <bootstrap checkout> --candidate <export dir> --mapping <bootstrap mapping.json> --policy <reviewed policy.json> --approval <private approval.json> --scan-report <private scan.json> --expected-main <old public main SHA> --expected-heads <count> --expected-tags <count> --apply --plan <reviewed plan.json> --plan-sha256 <64-hex digest>

Planning is the default and probes the exact atomic push with --dry-run. It retains the plan and exits 2 if the server rejects the probe. Apply revalidates the plan, every remote head and tag, then probes and performs the same lease-bound atomic push. A protected-ref rejection stops; this tool never changes protection settings.\n`;
}

export function parseArgs(argv) {
  if (argv.length === 1 && argv[0] === '--help') return { help: true };
  const values = new Set(['private-repo', 'public-repo', 'candidate', 'mapping', 'policy', 'approval', 'scan-report', 'expected-main', 'expected-heads', 'expected-tags', 'plan-out', 'plan', 'plan-sha256']);
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i].startsWith('--') ? argv[i].slice(2) : '';
    if (!name || out[name] !== undefined) fail('Invalid or repeated option; use --help');
    if (name === 'apply') out.apply = true;
    else if (values.has(name) && argv[i + 1] && !argv[i + 1].startsWith('--')) out[name] = argv[++i];
    else fail('Invalid option or missing value; use --help');
  }
  for (const name of ['private-repo', 'public-repo', 'candidate', 'mapping', 'policy', 'approval', 'scan-report', 'expected-main', 'expected-heads', 'expected-tags']) {
    if (!out[name]) fail(`Missing --${name}; use --help`);
  }
  if (!SHA.test(out['expected-main'])) fail('Expected public main must be a full 40-hex SHA');
  for (const name of ['expected-heads', 'expected-tags']) {
    if (!/^(?:0|[1-9][0-9]*)$/u.test(out[name]) || !Number.isSafeInteger(Number(out[name]))) {
      fail(`Invalid --${name}`);
    }
  }
  if (Number(out['expected-heads']) < 1) fail('At least public main must exist');
  if (out.apply) {
    if (!out.plan || !SHA256.test(out['plan-sha256'] || '') || out['plan-out']) fail('Apply requires --plan and --plan-sha256, without --plan-out');
  } else if (!out['plan-out'] || out.plan || out['plan-sha256']) {
    fail('Planning requires a new --plan-out, without apply-only options');
  }
  return out;
}

function cleanGitEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
  return env;
}

function git(repo, command, input) {
  return execFileSync('git', ['--no-replace-objects', '-C', repo, ...command], {
    input, env: cleanGitEnv(), maxBuffer: 128 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function realDirectory(name) {
  const absolute = path.resolve(name);
  if (fs.lstatSync(absolute).isSymbolicLink() || !fs.statSync(absolute).isDirectory()) fail('Expected a real directory');
  return fs.realpathSync(absolute);
}

function regularJson(name) {
  const actual = path.resolve(name);
  const stat = fs.lstatSync(actual);
  if (stat.isSymbolicLink() || !stat.isFile()) fail('Expected a regular private JSON file');
  const real = fs.realpathSync(actual);
  const bytes = fs.readFileSync(real);
  return { value: JSON.parse(bytes.toString('utf8')), bytes, path: real };
}

function outsideCheckout(filename, roots, gitRunner) {
  const requested = path.resolve(filename);
  const parent = realDirectory(path.dirname(requested));
  const actual = path.join(parent, path.basename(requested));
  if (roots.some((root) => within(root, actual))) fail('Private plan must be outside checkout and candidate trees');
  let enclosing = false;
  try { gitRunner(parent, ['rev-parse', '--show-toplevel']); enclosing = true; } catch { /* No enclosing repository. */ }
  if (enclosing) fail('Private plan must be outside every Git checkout');
  return actual;
}

function parseTree(rows) {
  return rows.toString('utf8').split('\0').filter(Boolean).map((row) => {
    const tab = row.indexOf('\t');
    if (tab < 0) fail('Malformed local root tree');
    const [mode, type, oid] = row.slice(0, tab).split(' ');
    return { path: row.slice(tab + 1), mode, type, oid };
  });
}

function checkSnapshot(options, gitRunner) {
  const repo = realDirectory(options['public-repo']);
  if (fs.realpathSync(gitRunner(repo, ['rev-parse', '--show-toplevel']).toString().trim()) !== repo) {
    fail('Public repository path must be the checkout root');
  }
  const rawOrigin = gitRunner(repo, ['config', '--get', 'remote.origin.url']).toString().trim();
  const effectiveOrigin = gitRunner(repo, ['remote', 'get-url', 'origin']).toString().trim();
  const pushUrls = gitRunner(repo, ['remote', 'get-url', '--push', '--all', 'origin']).toString().trim().split('\n');
  let mirror = 'false';
  try { mirror = gitRunner(repo, ['config', '--bool', '--get', 'remote.origin.mirror']).toString().trim(); }
  catch { /* Unset defaults to false. */ }
  if (!ORIGIN.includes(rawOrigin) || !ORIGIN.includes(effectiveOrigin)
    || pushUrls.length !== 1 || !ORIGIN.includes(pushUrls[0]) || mirror === 'true') {
    fail('Public origin and push destination must be the confirmed target without URL rewrites or mirror mode');
  }
  const privateRoot = checkedRepository(options['private-repo'], SOURCE);
  if (within(privateRoot, repo) || within(repo, privateRoot)) fail('Private and public checkouts must be separate');
  // Reuse the same source-commit, policy, file, mode, report, scan and approval
  // validator as the sync engine. Importing sync.mjs has no CLI side effects.
  const verified = validateCandidate({ ...options, bootstrap: true }, privateRoot);
  const { candidate, manifest, content, authorization } = verified;
  if (!authorization?.reference || within(repo, authorization.reference.path)) {
    fail('Explicit authorization reference must stay outside the public checkout');
  }
  if (within(repo, candidate) || within(candidate, repo)) fail('Candidate and public checkout must be separate');
  const manifestFile = regularJson(path.join(candidate, 'manifest.json'));
  const reviewFile = regularJson(path.join(candidate, 'review.json'));
  const policyFile = regularJson(options.policy);
  const approvalFile = regularJson(options.approval);
  const scanFile = regularJson(options['scan-report']);
  const mappingFile = regularJson(options.mapping);
  for (const evidence of [approvalFile, scanFile, mappingFile]) {
    if (within(repo, evidence.path) || within(candidate, evidence.path)) {
      fail('Private evidence must stay outside public/candidate trees');
    }
  }
  let enclosingMapping = false;
  try { gitRunner(path.dirname(mappingFile.path), ['rev-parse', '--show-toplevel']); enclosingMapping = true; }
  catch { /* The mapping must remain in standalone private storage. */ }
  if (enclosingMapping) fail('Mapping must be outside every Git checkout');
  const mapping = mappingFile.value;
  if (mapping.schemaVersion !== 1 || mapping.sourceRepository !== SOURCE || mapping.targetRepository !== TARGET
    || mapping.status !== 'bootstrap' || mapping.publicBaseSha !== null
    || mapping.sourceSha !== manifest.sourceSha || mapping.exportSha256 !== manifest.exportSha256
    || !SHA.test(mapping.publicSha || '') || !SHA.test(mapping.publicTreeSha || '')
    || mapping.publicationApproved !== false || mapping.localReviewOverride !== false
    || mapping.policyStatus !== 'reviewed' || mapping.reviewRequired !== false
    || mapping.referenceHintsCount !== verified.referenceHintsCount
    || mapping.authorizationMethod !== 'explicit_user_cutover'
    || mapping.authorizedBy !== authorization.authorizedBy
    || mapping.authorizationReference !== authorization.reference.path
    || mapping.authorizationReferenceSha256 !== authorization.reference.sha256
    || mapping.publicBranch !== 'refs/heads/public-source-sync') {
    fail('Bootstrap mapping is invalid or was made with a local review override');
  }
  if (gitRunner(repo, ['cat-file', '-t', mapping.publicSha]).toString().trim() !== 'commit') fail('Mapped root is not a commit');
  const commitBytes = gitRunner(repo, ['cat-file', '-p', mapping.publicSha]).toString('utf8');
  const headers = commitBytes.split('\n\n', 1)[0].split('\n');
  if (headers.some((line) => line.startsWith('parent '))) fail('Mapped public root has private or other ancestry');
  const rootTree = gitRunner(repo, ['rev-parse', `${mapping.publicSha}^{tree}`]).toString().trim();
  if (rootTree !== mapping.publicTreeSha || gitRunner(repo, ['rev-parse', mapping.publicBranch]).toString().trim() !== mapping.publicSha) {
    fail('Mapped orphan root or local branch differs from Git');
  }
  const identity = gitRunner(repo, ['show', '-s', '--format=%an%n%ae%n%cn%n%ce%n%s', mapping.publicSha]).toString().trim().split('\n');
  if (!equal(identity, ['CogSeed Public Sync', 'public-sync@users.noreply.github.com',
    'CogSeed Public Sync', 'public-sync@users.noreply.github.com',
    `chore: sync public source ${manifest.exportSha256.slice(0, 16)}`])) {
    fail('Mapped root was not made by the public snapshot sync tool');
  }
  const tree = parseTree(gitRunner(repo, ['ls-tree', '-r', '-z', mapping.publicSha]));
  if (tree.length !== manifest.files.length) fail('Orphan tree contains extra or missing paths');
  const treeMap = new Map(tree.map((entry) => [entry.path, entry]));
  if (treeMap.size !== tree.length) fail('Orphan tree contains duplicate paths');
  for (const file of manifest.files) {
    const entry = treeMap.get(file.path);
    const bytes = content.get(file.path);
    if (!entry || entry.type !== 'blob' || entry.mode !== file.mode || gitOid(bytes) !== entry.oid) {
      fail('Orphan tree differs from exact verified export bytes, modes or paths');
    }
  }
  return { repo, candidate, mappingFile, manifestFile, reviewFile, policyFile,
    approvalFile, scanFile, authReference: authorization.reference, mapping, manifest };
}

function remoteRefs(repo, gitRunner) {
  // --refs reports annotated tag object IDs, never peeled target commit IDs.
  const rows = gitRunner(repo, ['ls-remote', '--refs', 'origin', 'refs/heads/*', 'refs/tags/*'])
    .toString('utf8').split('\n').filter(Boolean);
  const refs = rows.map((row) => {
    const match = /^([0-9a-f]{40})\t(refs\/(?:heads|tags)\/[^\n\r\t]+)$/u.exec(row);
    if (!match) fail('Unexpected remote ref response');
    const [, oid, ref] = match;
    if (ref.includes('^{}')) fail('Peeled tag ref must not be used as a lease');
    gitRunner(repo, ['check-ref-format', ref]);
    return { ref, oid };
  }).sort((a, b) => a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0);
  if (new Set(refs.map((item) => item.ref)).size !== refs.length) fail('Duplicate remote ref');
  return refs;
}

function expectedCounts(options, refs) {
  const heads = refs.filter(({ ref }) => ref.startsWith('refs/heads/'));
  const tags = refs.filter(({ ref }) => ref.startsWith('refs/tags/'));
  const main = refs.find(({ ref }) => ref === 'refs/heads/main');
  if (heads.length !== Number(options['expected-heads']) || tags.length !== Number(options['expected-tags'])
    || !main || main.oid !== options['expected-main']) fail('Remote heads, tags or main differ from explicit expected baseline');
  return { heads: heads.length, tags: tags.length };
}

function planCore(options, snapshot, refs) {
  const counts = expectedCounts(options, refs);
  if (snapshot.mapping.publicSha === options['expected-main']) fail('Orphan root is already public main');
  return {
    schemaVersion: 1, kind: 'public-git-ref-cutover', targetRepository: TARGET,
    remote: 'origin', oldMainSha: options['expected-main'], newRootSha: snapshot.mapping.publicSha,
    newRootTreeSha: snapshot.mapping.publicTreeSha, sourceSha: snapshot.manifest.sourceSha,
    exportSha256: snapshot.manifest.exportSha256,
    manifestSha256: hash(snapshot.manifestFile.bytes), mappingSha256: hash(snapshot.mappingFile.bytes),
    reviewSha256: hash(snapshot.reviewFile.bytes), policySha256: hash(snapshot.policyFile.bytes),
    approvalSha256: hash(snapshot.approvalFile.bytes), scanReportSha256: hash(snapshot.scanFile.bytes),
    authorizationReferenceSha256: snapshot.authReference.sha256,
    expectedRefs: refs, expectedHeads: counts.heads, expectedTags: counts.tags,
    retainedNamespaces: ['refs/pull/*', 'GitHub Releases and assets'],
  };
}

function pushArgs(plan, dryRun) {
  const args = ['-c', 'push.followTags=false', 'push', '--atomic', '--porcelain'];
  if (dryRun) args.push('--dry-run');
  for (const { ref, oid } of plan.expectedRefs) args.push(`--force-with-lease=${ref}:${oid}`);
  args.push('origin', `+${plan.newRootSha}:refs/heads/main`);
  for (const { ref } of plan.expectedRefs) if (ref !== 'refs/heads/main') args.push(`:${ref}`);
  return args;
}

function probe(repo, plan, gitRunner) {
  try { gitRunner(repo, pushArgs(plan, true)); return true; }
  catch { return false; }
}

export function runCutover(options, gitRunner = git) {
  if (options.help) { process.stdout.write(help()); return { status: 0 }; }
  const snapshot = checkSnapshot(options, gitRunner);
  if (options.apply) {
    const planFile = regularJson(options.plan);
    if (within(snapshot.repo, planFile.path) || within(snapshot.candidate, planFile.path)) {
      fail('Reviewed plan must stay outside public checkout and candidate');
    }
    let enclosingPlan = false;
    try { gitRunner(path.dirname(planFile.path), ['rev-parse', '--show-toplevel']); enclosingPlan = true; }
    catch { /* Standalone private plan storage. */ }
    if (enclosingPlan) fail('Reviewed plan must be outside every Git checkout');
    const plan = planFile.value;
    const { planSha256, ...core } = plan;
    if (!SHA256.test(planSha256 || '') || planSha256 !== options['plan-sha256']
      || hash(JSON.stringify(core)) !== planSha256) fail('Reviewed plan digest mismatch');
    if (!equal(core, planCore(options, snapshot, core.expectedRefs))) fail('Plan does not match current candidate, mapping or expected baseline');
    const current = remoteRefs(snapshot.repo, gitRunner);
    if (!equal(current, plan.expectedRefs)) fail('Remote refs changed since the reviewed plan');
    if (!probe(snapshot.repo, plan, gitRunner)) fail('Atomic dry-run was rejected; no refs were changed');
    // Close the gap after the probe; per-ref leases are the final race guard.
    if (!equal(remoteRefs(snapshot.repo, gitRunner), plan.expectedRefs)) fail('Remote refs changed after dry-run');
    gitRunner(snapshot.repo, pushArgs(plan, false));
    const after = remoteRefs(snapshot.repo, gitRunner);
    if (!equal(after, [{ ref: 'refs/heads/main', oid: plan.newRootSha }])) {
      fail('Atomic push returned but public heads/tags do not match the cutover target');
    }
    process.stdout.write(`${JSON.stringify({ applied: true, newMainSha: plan.newRootSha,
      deletedHeads: plan.expectedHeads - 1, deletedTags: plan.expectedTags,
      releaseAssetsChanged: false, pullRefsChanged: false })}\n`);
    return { status: 0 };
  }
  const refs = remoteRefs(snapshot.repo, gitRunner);
  const core = planCore(options, snapshot, refs);
  const plan = { ...core, planSha256: hash(JSON.stringify(core)) };
  const filename = outsideCheckout(options['plan-out'], [snapshot.repo, snapshot.candidate], gitRunner);
  fs.writeFileSync(filename, `${JSON.stringify(plan, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  const accepted = probe(snapshot.repo, plan, gitRunner);
  process.stdout.write(`${JSON.stringify({ applied: false, plan: filename, planSha256: plan.planSha256,
    oldMainSha: plan.oldMainSha, newMainSha: plan.newRootSha,
    deleteHeads: plan.expectedHeads - 1, deleteTags: plan.expectedTags,
    atomicDryRun: accepted ? 'passed' : 'rejected', releaseAssetsChanged: false,
    pullRefsChanged: false })}\n`);
  return { status: accepted ? 0 : 2 };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = runCutover(parseArgs(process.argv.slice(2))).status; }
  catch (error) {
    process.stderr.write(`[public-cutover] ${error.status !== undefined
      ? 'Git operation failed; no protection settings were changed'
      : error.message}\n`);
    process.exitCode = 1;
  }
}
