#!/usr/bin/env node
/**
 * Build a local public snapshot commit from a verified private export. This
 * never fetches, pushes, opens a PR, or changes the public checkout's HEAD.
 * Its only public ref is the fixed snapshot branch. The source-to-public
 * mapping remains outside every Git repo.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_REPOSITORY = 'bonc-ai/cogseed-internal';
const TARGET_REPOSITORY = 'bonc-ai/cogseed';
const SHA = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const ZERO = '0'.repeat(40);
const EMERGENCY_EXPIRY = '2026-10-01T00:00:00+08:00';
const EMERGENCY_EXPIRY_SECONDS = Date.parse(EMERGENCY_EXPIRY) / 1000;
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const gitOid = (bytes) => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const within = (root, candidate) => candidate === root || candidate.startsWith(`${root}${path.sep}`);
const fail = (message) => { throw new Error(message); };

function help() {
  return `Usage:
  node scripts/opensource/sync.mjs --candidate <export-dir> --private-repo <checkout> --public-repo <checkout> --target-origin <GitHub URL> --expected-base <40-hex public SHA> --mapping-out <new private JSON file> --approval <JSON> --scan-report <JSON>
  node scripts/opensource/sync.mjs --candidate <export-dir> --private-repo <checkout> --public-repo <new absent directory> --target-origin <GitHub URL> --bootstrap --mapping-out <new private JSON file> --approval <JSON> --scan-report <JSON>

  --commit-time <Unix seconds>  Optional fixed run time for reproducible retries across fresh checkouts; defaults to the current time. The commit is always at least one second newer than its public parent.
  --allow-review-required-local  Local rehearsal only: bypass reviewed, scan, and approval gates. Never authorizes publishing.

The approval JSON binds sourceSha, exportSha256, policySha256 and referenceHintsSha256. Recurring sync requires authorizationMethod "workflow_dispatch", authorizedBy, and positive workflowRunId/workflowRunAttempt. The one-time emergency path accepts authorizationMethod "explicit_user_emergency", authorizedBy, scope "single_snapshot_pr", a private authorizationReference file, and expiresAt no later than ${EMERGENCY_EXPIRY}; it rejects workflowRunId/workflowRunAttempt and is refused at or after the expiry. Bootstrap accepts authorizationMethod "explicit_user_cutover" with a real private authorizationReference file, scope "public_heads_and_tags_only", preserveReleaseAssets:true, and acceptRetainedPullRefs:true. These local JSON files record authorization; they are not cryptographic identity credentials. No remote operations are performed.\n`;
}

function args(argv) {
  if (argv.length === 1 && argv[0] === '--help') return { help: true };
  const values = new Set(['candidate', 'private-repo', 'public-repo', 'target-origin', 'expected-base', 'mapping-out', 'approval', 'scan-report', 'policy', 'exporter', 'commit-time']);
  const flags = new Set(['bootstrap', 'allow-review-required-local']);
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i].startsWith('--') ? argv[i].slice(2) : '';
    if (!name || out[name] !== undefined) fail('Invalid or repeated option; use --help');
    if (flags.has(name)) out[name] = true;
    else if (values.has(name) && argv[i + 1] && !argv[i + 1].startsWith('--')) out[name] = argv[++i];
    else fail('Invalid option or missing value; use --help');
  }
  for (const name of ['candidate', 'private-repo', 'public-repo', 'target-origin', 'mapping-out']) {
    if (!out[name]) fail(`Missing --${name}; use --help`);
  }
  if (!validOrigin(out['target-origin'], TARGET_REPOSITORY)) fail('Target origin must identify the public repository');
  if (out.bootstrap ? out['expected-base'] : !SHA.test(out['expected-base'] || '')) {
    fail('Use --bootstrap for a new repository or supply --expected-base with a full public commit SHA');
  }
  if (out['commit-time'] !== undefined
    && (!/^(?:0|[1-9][0-9]*)$/u.test(out['commit-time'])
      || !Number.isSafeInteger(Number(out['commit-time'])))) {
    fail('Commit time must be nonnegative Unix seconds');
  }
  if (!out['allow-review-required-local'] && (!out.approval || !out['scan-report'])) {
    fail('Reviewed synchronization requires --approval and --scan-report');
  }
  return out;
}

function cleanGitEnv(extra = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
  return { ...env, ...extra };
}

function git(repo, command, input, env = {}) {
  return execFileSync('git', ['--no-replace-objects', '-C', repo, ...command], {
    input, env: cleanGitEnv(env), maxBuffer: 128 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function validOrigin(url, repository) {
  return [
    `https://github.com/${repository}`, `https://github.com/${repository}.git`,
    `git@github.com:${repository}`, `git@github.com:${repository}.git`,
    `ssh://git@github.com/${repository}`, `ssh://git@github.com/${repository}.git`,
  ].includes(url);
}

function realDirectory(name) {
  const absolute = path.resolve(name);
  if (fs.lstatSync(absolute).isSymbolicLink()) fail('A root directory may not be a symlink');
  if (!fs.statSync(absolute).isDirectory()) fail('Expected a directory');
  return fs.realpathSync(absolute);
}

function safePath(name) {
  if (typeof name !== 'string' || !name || name !== name.normalize('NFC')) return false;
  return name.split('/').every((part) => part && part !== '.' && part !== '..'
    && !/[\x00-\x1f\x7f\\:*?"<>|]/u.test(part) && !/[. ]$/u.test(part)
    && !/^\.git$/iu.test(part)
    && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part));
}

function exactJsonFile(filename) {
  if (fs.lstatSync(filename).isSymbolicLink() || !fs.statSync(filename).isFile()) fail('Evidence must be a regular file');
  return JSON.parse(fs.readFileSync(filename, 'utf8'));
}

function authorizationReference(filename, roots, label = 'Authorization') {
  if (typeof filename !== 'string' || !path.isAbsolute(filename)) fail(`${label} authorizationReference must be an absolute private file path`);
  const actual = path.resolve(filename);
  const stat = fs.lstatSync(actual);
  const real = fs.realpathSync(actual);
  if (stat.isSymbolicLink() || !stat.isFile() || roots.some((root) => within(root, real))) {
    fail(`${label} authorizationReference must be a private regular file outside the repositories and candidate`);
  }
  return { path: real, sha256: hash(fs.readFileSync(real)) };
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function referenceHints(files, content, omitted) {
  // Keep the exporter's deliberately conservative literal checks in sync. A
  // report edited after export cannot turn a flagged candidate into "clean".
  const targets = omitted.filter((name) => name.endsWith('.md'));
  const targetSet = new Set(targets);
  return files.flatMap((file) => {
    if (!/\.(?:md|txt|json|[cm]?js|ts|html|ya?ml)$/u.test(file.path)) return [];
    const text = content.get(file.path).toString('utf8');
    const references = new Set(targets.filter((target) => text.includes(target)));
    if (file.path.endsWith('.md')) {
      for (const match of text.matchAll(/\]\(<?([^\s)>]+)>?(?:\s+"[^"]*")?\)/gu)) {
        if (/^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/iu.test(match[1])) continue;
        let link;
        try { link = decodeURIComponent(match[1].split(/[?#]/u)[0]); } catch { continue; }
        const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file.path), link));
        if (targetSet.has(resolved)) references.add(resolved);
      }
    }
    return references.size ? [{ path: file.path, references: [...references].sort() }] : [];
  });
}

export function validateCandidate(options, privateRoot) {
  const candidate = realDirectory(options.candidate);
  if (within(privateRoot, candidate) || within(candidate, privateRoot)) fail('Candidate must be outside the private checkout');
  if (fs.existsSync(path.join(candidate, 'INCOMPLETE'))) fail('Incomplete export candidate');
  const manifest = exactJsonFile(path.join(candidate, 'manifest.json'));
  const review = exactJsonFile(path.join(candidate, 'review.json'));
  const source = realDirectory(path.join(candidate, 'source'));
  if (manifest.schemaVersion !== 1 || manifest.sourceRepository !== SOURCE_REPOSITORY
    || manifest.targetRepository !== TARGET_REPOSITORY || !SHA.test(manifest.sourceSha || '')
    || manifest.publicSha !== null || manifest.releaseTag !== null
    || !SHA256.test(manifest.policySha256 || '') || !SHA256.test(manifest.exporterSha256 || '')
    || !SHA256.test(manifest.exportSha256 || '') || !Array.isArray(manifest.files)
    || !manifest.files.length) fail('Invalid export manifest');
  const policyPath = options.policy || path.join(HERE, 'policy.json');
  const exporterPath = options.exporter || path.join(HERE, 'export.mjs');
  if (hash(fs.readFileSync(policyPath)) !== manifest.policySha256
    || hash(fs.readFileSync(exporterPath)) !== manifest.exporterSha256) {
    fail('Policy or exporter bytes differ from the candidate manifest');
  }
  const policy = exactJsonFile(policyPath);
  const policyPathIsSafe = (name, directory) => typeof name === 'string'
    && safePath(directory && name.endsWith('/') ? name.slice(0, -1) : name);
  if (policy.schemaVersion !== 1 || policy.sourceRepository !== SOURCE_REPOSITORY
    || policy.targetRepository !== TARGET_REPOSITORY || !['draft', 'reviewed'].includes(policy.status)
    || !Array.isArray(policy.publicFiles) || new Set(policy.publicFiles).size !== policy.publicFiles.length
    || policy.publicFiles.some((name) => !safePath(name))
    || !Array.isArray(policy.neverPublic) || !Array.isArray(policy.privatePaths)
    || [...policy.neverPublic, ...policy.privatePaths].some((name) => !policyPathIsSafe(name, true))
    || new Set(policy.neverPublic).size !== policy.neverPublic.length
    || new Set(policy.privatePaths).size !== policy.privatePaths.length) fail('Invalid policy');
  const files = manifest.files;
  let previous = '';
  let totalSize = 0;
  const expectedDirs = new Set();
  const names = new Map();
  for (const file of files) {
    if (!file || !safePath(file.path) || file.path <= previous
      || !['100644', '100755'].includes(file.mode) || !Number.isSafeInteger(file.size)
      || file.size < 0 || file.size > 32 * 1024 * 1024 || !SHA256.test(file.sha256 || '')
      || Object.keys(file).sort().join(',') !== 'mode,path,sha256,size') fail('Invalid or unsorted manifest file');
    previous = file.path;
    totalSize += file.size;
    if (totalSize > 512 * 1024 * 1024) fail('Candidate exceeds export size limit');
    const parts = file.path.split('/');
    for (let i = 1; i <= parts.length; i++) {
      const segment = parts.slice(0, i).join('/');
      const folded = segment.toLowerCase();
      if (names.has(folded) && names.get(folded) !== segment) fail('Case-colliding manifest path');
      names.set(folded, segment);
      if (i < parts.length) expectedDirs.add(segment);
    }
  }
  if (hash(JSON.stringify(files)) !== manifest.exportSha256) fail('Manifest export digest mismatch');
  const expectedPaths = new Set(files.map((f) => f.path));
  const collected = [];
  function walk(directory, prefix = '') {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (!safePath(name)) fail('Unsafe candidate path');
      const full = path.join(directory, entry.name);
      const stat = fs.lstatSync(full);
      if (stat.isSymbolicLink()) fail('Candidate contains a symlink');
      if (stat.isDirectory()) {
        if (!expectedDirs.has(name)) fail('Candidate contains an extra directory');
        walk(full, name);
      } else if (stat.isFile()) {
        if (!expectedPaths.has(name)) fail('Candidate contains an extra file');
        collected.push(name);
      } else fail('Candidate contains a special file');
    }
  }
  walk(source);
  if (collected.length !== files.length) fail('Candidate is missing a manifest file');
  if (git(privateRoot, ['cat-file', '-t', manifest.sourceSha]).toString().trim() !== 'commit') {
    fail('Manifest source SHA is not a private commit');
  }
  const treeRows = git(privateRoot, ['ls-tree', '-r', '-z', manifest.sourceSha]).toString('utf8').split('\0').filter(Boolean);
  const sourceTree = new Map(treeRows.map((row) => {
    const tab = row.indexOf('\t');
    const [mode, type, oid] = row.slice(0, tab).split(' ');
    return [row.slice(tab + 1), { mode, type, oid }];
  }));
  const matches = (name, rule) => rule.endsWith('/') ? name.startsWith(rule) : name === rule;
  const selected = policy.publicFiles.filter((name) => sourceTree.has(name)).sort();
  if (!same(selected, files.map((f) => f.path))) fail('Manifest does not match the policy inventory at source commit');
  if (files.some((file) => policy.neverPublic.some((rule) => matches(file.path, rule)))) {
    fail('Public inventory conflicts with neverPublic policy');
  }
  const missing = policy.publicFiles.filter((name) => !sourceTree.has(name));
  if (!same(missing, review.missingPublicFiles)) fail('Review missing-file report does not match source');
  const unclassified = [...sourceTree.keys()].filter((name) => !policy.publicFiles.includes(name)
    && ![...policy.neverPublic, ...policy.privatePaths].some((rule) => matches(name, rule)));
  if (!same(unclassified, review.unclassifiedFiles)) fail('Review unclassified-file report does not match source');
  const omitted = [...sourceTree.keys()].filter((name) => !expectedPaths.has(name));
  if (!same(omitted, review.omittedFiles) || review.omittedCount !== omitted.length) {
    fail('Review omitted-file report does not match source');
  }
  const content = new Map();
  for (const file of files) {
    const entry = sourceTree.get(file.path);
    if (!entry || entry.type !== 'blob' || entry.mode !== file.mode) fail('Manifest mode differs from private source tree');
    const full = path.join(source, file.path);
    const stat = fs.lstatSync(full);
    const actualMode = stat.mode & 0o111 ? '100755' : '100644';
    if (!stat.isFile() || stat.isSymbolicLink() || (process.platform !== 'win32' && actualMode !== file.mode)) {
      fail('Candidate file mode or type differs from manifest');
    }
    const bytes = fs.readFileSync(full);
    if (bytes.length !== file.size || hash(bytes) !== file.sha256 || gitOid(bytes) !== entry.oid) {
      fail('Candidate bytes differ from manifest or private source commit');
    }
    content.set(file.path, bytes);
  }
  if (review.schemaVersion !== 1 || review.status !== 'review-required'
    || review.readyForPublication !== false || review.sourceSha !== manifest.sourceSha
    || review.exportSha256 !== manifest.exportSha256 || review.policyStatus !== policy.status
    || !Array.isArray(review.unclassifiedFiles) || !Array.isArray(review.privateReferenceHints)
    || !Array.isArray(review.missingPublicFiles) || review.selectedCount !== files.length) {
    fail('Review report does not match export candidate');
  }
  if (!same(referenceHints(files, content, omitted), review.privateReferenceHints)) {
    fail('Review private-reference hints do not match source');
  }
  const referenceHintsSha256 = hash(JSON.stringify(review.privateReferenceHints));
  const requiresReview = policy.status !== 'reviewed' || missing.length || review.unclassifiedFiles.length;
  if (requiresReview && !options['allow-review-required-local']) {
    fail('Draft or incomplete classification requires local rehearsal override');
  }
  let authorization = null;
  if (!options['allow-review-required-local']) {
    if (policy.reviewedReferenceHintsSha256 !== referenceHintsSha256) {
      fail('Policy does not record review of this exact reference-hint set');
    }
    const approval = exactJsonFile(options.approval);
    const scan = exactJsonFile(options['scan-report']);
    if (approval.sourceSha !== manifest.sourceSha || approval.exportSha256 !== manifest.exportSha256
      || approval.policySha256 !== manifest.policySha256
      || approval.referenceHintsSha256 !== referenceHintsSha256
      || typeof approval.authorizedBy !== 'string' || !/^[A-Za-z0-9-]{1,39}$/u.test(approval.authorizedBy)
      || (options.bootstrap
        ? approval.authorizationMethod !== 'explicit_user_cutover'
          || approval.scope !== 'public_heads_and_tags_only'
          || approval.preserveReleaseAssets !== true || approval.acceptRetainedPullRefs !== true
          || approval.workflowRunId !== undefined || approval.workflowRunAttempt !== undefined
        : approval.authorizationMethod === 'workflow_dispatch'
          ? !Number.isSafeInteger(approval.workflowRunId) || approval.workflowRunId <= 0
            || !Number.isSafeInteger(approval.workflowRunAttempt) || approval.workflowRunAttempt <= 0
          : approval.authorizationMethod === 'explicit_user_emergency'
            ? approval.scope !== 'single_snapshot_pr'
              || typeof approval.expiresAt !== 'string'
              || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/u.test(approval.expiresAt)
              || !Number.isFinite(Date.parse(approval.expiresAt))
              || Date.parse(approval.expiresAt) / 1000 > EMERGENCY_EXPIRY_SECONDS
              || (options['commit-time'] === undefined
                ? Math.floor(Date.now() / 1000)
                : Number(options['commit-time'])) >= Date.parse(approval.expiresAt) / 1000
              || hasOwn(approval, 'workflowRunId') || hasOwn(approval, 'workflowRunAttempt')
            : true)) {
      fail('Approval evidence is invalid or not bound to this export');
    }
    if (scan.sourceSha !== manifest.sourceSha || scan.exportSha256 !== manifest.exportSha256
      || scan.tool !== 'gitleaks' || scan.status !== 'passed') fail('Scan evidence is invalid or not bound to this export');
    if (approval.authorizationMethod === 'explicit_user_emergency' && options.bootstrap) {
      fail('Emergency authorization cannot be used with --bootstrap');
    }
    const reference = ['explicit_user_cutover', 'explicit_user_emergency'].includes(approval.authorizationMethod)
      ? authorizationReference(approval.authorizationReference, [privateRoot, candidate],
        approval.authorizationMethod === 'explicit_user_emergency' ? 'Emergency' : 'Bootstrap')
      : null;
    authorization = options.bootstrap
      ? { method: approval.authorizationMethod, authorizedBy: approval.authorizedBy, reference }
      : approval.authorizationMethod === 'explicit_user_emergency'
        ? { method: approval.authorizationMethod, authorizedBy: approval.authorizedBy, reference,
          scope: approval.scope, expiresAt: approval.expiresAt }
        : { method: approval.authorizationMethod, authorizedBy: approval.authorizedBy,
          workflowRunId: approval.workflowRunId, workflowRunAttempt: approval.workflowRunAttempt };
  }
  return { candidate, manifest, content, policyStatus: policy.status,
    referenceHintsCount: review.privateReferenceHints.length, requiresReview, authorization };
}

export function checkedRepository(name, repository) {
  const root = realDirectory(name);
  if (fs.realpathSync(git(root, ['rev-parse', '--show-toplevel']).toString().trim()) !== root) {
    fail('Repository path must be the checkout root');
  }
  if (!validOrigin(git(root, ['remote', 'get-url', 'origin']).toString().trim(), repository)) {
    fail('Repository origin identity mismatch');
  }
  return root;
}

function mappingPath(name, roots) {
  const requested = path.resolve(name);
  const parent = realDirectory(path.dirname(requested));
  const result = path.join(parent, path.basename(requested));
  if (roots.some((root) => within(root, result))) fail('Private mapping must be outside all checkout and candidate trees');
  try { git(parent, ['rev-parse', '--show-toplevel']); fail('Private mapping must be outside every Git checkout'); }
  catch (error) { if (error.message === 'Private mapping must be outside every Git checkout') throw error; }
  if (fs.existsSync(result)) fail('Mapping output must be a new file');
  return result;
}

function preparePublic(options, candidate) {
  let root;
  if (options.bootstrap) {
    const requested = path.resolve(options['public-repo']);
    const parent = realDirectory(path.dirname(requested));
    root = path.join(parent, path.basename(requested));
    if (fs.existsSync(root) || within(candidate, root)) fail('Bootstrap requires a new directory outside the candidate');
    try { git(parent, ['rev-parse', '--show-toplevel']); fail('Bootstrap directory must be outside any Git checkout'); }
    catch (error) { if (error.message === 'Bootstrap directory must be outside any Git checkout') throw error; }
  } else {
    root = checkedRepository(options['public-repo'], TARGET_REPOSITORY);
    if (within(candidate, root) || within(root, candidate)) fail('Public checkout and candidate must be separate');
    const current = git(root, ['rev-parse', 'HEAD']).toString().trim();
    if (current !== options['expected-base'] || git(root, ['cat-file', '-t', current]).toString().trim() !== 'commit') {
      fail('Public checkout HEAD differs from expected base commit');
    }
    if (git(root, ['status', '--porcelain', '--untracked-files=all']).length) fail('Public checkout must be clean');
  }
  return root;
}

function writeSnapshot(options, root, manifest, content) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'cogseed-public-index-'));
  const index = path.join(temporary, 'index');
  const env = { GIT_INDEX_FILE: index };
  try {
    git(root, ['read-tree', '--empty'], undefined, env);
    const rows = [];
    for (const file of manifest.files) {
      const oid = git(root, ['hash-object', '-w', '--stdin'], content.get(file.path)).toString().trim();
      if (!SHA.test(oid)) fail('Invalid public Git blob ID');
      rows.push(`${file.mode} ${oid}\t${file.path}\0`);
    }
    git(root, ['update-index', '-z', '--index-info'], rows.join(''), env);
    const tree = git(root, ['write-tree'], undefined, env).toString().trim();
    if (!SHA.test(tree)) fail('Invalid public Git tree ID');
    const base = options.bootstrap ? null : options['expected-base'];
    if (base && tree === git(root, ['rev-parse', `${base}^{tree}`]).toString().trim()) {
      return { status: 'unchanged', publicSha: base, branch: null, tree };
    }
    const baseTime = base ? Number(git(root, ['show', '-s', '--format=%ct', base]).toString().trim()) : -1;
    if (!Number.isSafeInteger(baseTime) || (base && baseTime < 0)) fail('Invalid public base timestamp');
    const branch = 'refs/heads/public-source-sync';
    let existing;
    try { existing = git(root, ['rev-parse', '--verify', branch]).toString().trim(); }
    catch { existing = null; }
    // Reuse an existing snapshot's date on retry. Recreating the complete
    // commit below must yield the same OID, so a different branch tip cannot
    // be mistaken for this candidate even if its date is valid.
    let commitTime = options['commit-time'] === undefined
      ? Math.floor(Date.now() / 1000) : Number(options['commit-time']);
    if (existing) {
      const dates = git(root, ['show', '-s', '--format=%at%n%ct', existing]).toString().trim().split('\n').map(Number);
      if (dates.length !== 2 || dates.some((value) => !Number.isSafeInteger(value) || value < 0)
        || dates[0] !== dates[1]) fail('Existing public snapshot branch has invalid dates');
      commitTime = dates[0];
    }
    if (!Number.isSafeInteger(commitTime) || commitTime < 0) fail('Invalid public snapshot timestamp');
    const date = `${Math.max(commitTime, baseTime + 1)} +0000`;
    const commitEnv = {
      GIT_AUTHOR_NAME: 'CogSeed Public Sync', GIT_AUTHOR_EMAIL: 'public-sync@users.noreply.github.com',
      GIT_COMMITTER_NAME: 'CogSeed Public Sync', GIT_COMMITTER_EMAIL: 'public-sync@users.noreply.github.com',
      GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date,
    };
    const message = `chore: sync public source ${manifest.exportSha256.slice(0, 16)}\n`;
    const command = ['-c', 'commit.gpgsign=false', 'commit-tree', tree];
    if (base) command.push('-p', base);
    const publicSha = git(root, command, message, commitEnv).toString().trim();
    if (!SHA.test(publicSha)) fail('Invalid public commit ID');
    if (existing && existing !== publicSha) fail('Existing snapshot branch already points to a different commit');
    if (!existing) git(root, ['update-ref', branch, publicSha, ZERO]);
    const parents = git(root, ['rev-list', '--parents', '-n', '1', publicSha]).toString().trim().split(' ').slice(1);
    if (!same(parents, base ? [base] : [])) fail('Public commit has unexpected ancestry');
    if (git(root, ['rev-parse', `${publicSha}^{tree}`]).toString().trim() !== tree) fail('Public tree mismatch');
    return { status: options.bootstrap ? 'bootstrap' : 'changed', publicSha, branch, tree };
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

function run(options) {
  if (options.help) { process.stdout.write(help()); return; }
  const privateRoot = checkedRepository(options['private-repo'], SOURCE_REPOSITORY);
  const { candidate, manifest, content, policyStatus, referenceHintsCount, requiresReview, authorization } = validateCandidate(options, privateRoot);
  const root = preparePublic(options, candidate);
  // URL spelling (.git or no suffix, SSH or HTTPS) may differ in CI. Both
  // inputs must independently identify the exact configured public repo.
  if (!options.bootstrap && !validOrigin(git(root, ['remote', 'get-url', 'origin']).toString().trim(), TARGET_REPOSITORY)) {
    fail('Public checkout origin identity changed');
  }
  if (within(privateRoot, root) || within(root, privateRoot)) fail('Private and public checkouts must be separate');
  if (authorization?.reference && within(root, authorization.reference.path)) {
    fail('Bootstrap authorizationReference must stay outside the public checkout');
  }
  const mapping = mappingPath(options['mapping-out'], [privateRoot, candidate, root]);
  // Reserve a private output before any Git object/ref mutation. A failed run
  // removes the reservation, leaving only unreachable local objects if needed.
  const handle = fs.openSync(mapping, 'wx', 0o600);
  try {
    if (options.bootstrap) {
      fs.mkdirSync(root, { mode: 0o700 });
      git(root, ['init', '-q']);
      git(root, ['remote', 'add', 'origin', options['target-origin']]);
    }
    const result = writeSnapshot(options, root, manifest, content);
    const record = {
      schemaVersion: 1, sourceRepository: SOURCE_REPOSITORY, targetRepository: TARGET_REPOSITORY,
      sourceSha: manifest.sourceSha, exportSha256: manifest.exportSha256,
      publicBaseSha: options.bootstrap ? null : options['expected-base'], publicSha: result.publicSha,
      publicBranch: result.branch, publicTreeSha: result.tree, status: result.status,
      policyStatus, referenceHintsCount, reviewRequired: Boolean(requiresReview), publicationApproved: false,
      localReviewOverride: Boolean(options['allow-review-required-local']),
      authorizationMethod: authorization?.method || null, authorizedBy: authorization?.authorizedBy || null,
      authorizationScope: authorization?.scope || null, authorizationExpiresAt: authorization?.expiresAt || null,
      authorizationReference: authorization?.reference?.path || null,
      authorizationReferenceSha256: authorization?.reference?.sha256 || null,
    };
    fs.writeFileSync(handle, `${JSON.stringify(record, null, 2)}\n`);
    fs.closeSync(handle);
    process.stdout.write(`${JSON.stringify({ status: result.status, changed: result.status !== 'unchanged',
      commitSha: result.publicSha, branch: result.branch ? 'public-source-sync' : null,
      publicSha: result.publicSha, publicBranch: result.branch,
      exportSha256: manifest.exportSha256, mapping,
      publicationApproved: false })}\n`);
  } catch (error) {
    fs.closeSync(handle);
    fs.rmSync(mapping, { force: true });
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { run(args(process.argv.slice(2))); }
  catch (error) {
    process.stderr.write(`[source-sync] ${error.status !== undefined ? 'Git operation failed; check local repositories and refs' : error.message}\n`);
    process.exitCode = 1;
  }
}
