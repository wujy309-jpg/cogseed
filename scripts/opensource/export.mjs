#!/usr/bin/env node
/**
 * Private, local-only export rehearsal. Reads immutable Git blobs, never the
 * checkout or archive filters; never fetches, pushes, creates refs or publishes.
 * policy.json contains exact candidate paths, not recursive public globs.
 * Reports stay outside source/. A completed export is NOT release approval.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const matches = (name, rule) => rule.endsWith('/') ? name.startsWith(rule) : name === rule;
const within = (root, candidate) => candidate === root || candidate.startsWith(`${root}${path.sep}`);

function safePath(name, directory = false) {
  if (typeof name !== 'string' || !name || name !== name.normalize('NFC')) return false;
  const clean = directory && name.endsWith('/') ? name.slice(0, -1) : name;
  return clean.split('/').every((part) => part && part !== '.' && part !== '..'
    && !/[\x00-\x1f\x7f\\:*?"<>|]/u.test(part) && !/[. ]$/u.test(part)
    && !/^\.git$/iu.test(part)
    && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part));
}

function parseArgs(args) {
  const options = {};
  const names = new Set(['repo', 'source', 'out', 'policy', 'previous']);
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i].slice(2);
    if (!args[i].startsWith('--') || !names.has(key) || options[key] || !args[i + 1]
      || args[i + 1].startsWith('--')) throw new Error('Invalid or repeated option');
    options[key] = args[i + 1];
  }
  if (!/^[0-9a-f]{40}$/u.test(options.source || '') || !options.out) {
    throw new Error('Usage: node scripts/opensource/export.mjs --source <full commit SHA> --out <new directory> [--repo <checkout>] [--policy <json>] [--previous <manifest.json>]');
  }
  return options;
}

function git(repo, args, input) {
  return execFileSync('git', ['--no-replace-objects', '-C', repo, ...args], {
    input, maxBuffer: 128 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function loadPolicy(filename) {
  const bytes = fs.readFileSync(filename);
  const policy = JSON.parse(bytes);
  if (policy.schemaVersion !== 1 || !['draft', 'reviewed'].includes(policy.status)
    || policy.sourceRepository !== 'bonc-ai/cogseed-internal'
    || policy.targetRepository !== 'bonc-ai/cogseed') throw new Error('Invalid policy identity or version');
  for (const key of ['publicFiles', 'neverPublic', 'privatePaths']) {
    if (!Array.isArray(policy[key]) || new Set(policy[key]).size !== policy[key].length
      || policy[key].some((p) => !safePath(p, key !== 'publicFiles'))) throw new Error(`Invalid ${key}`);
  }
  if (!policy.publicFiles.length) throw new Error('Empty public inventory');
  for (const name of policy.publicFiles) {
    if (policy.neverPublic.some((rule) => matches(name, rule))) {
      throw new Error(`Public inventory conflicts with neverPublic: ${name}`);
    }
  }
  return { policy, policySha256: hash(bytes) };
}

function tree(repo, sha) {
  if (git(repo, ['cat-file', '-t', sha]).toString().trim() !== 'commit') throw new Error('Source must be a commit');
  return git(repo, ['ls-tree', '-r', '-l', '-z', sha]).toString('utf8').split('\0').filter(Boolean).map((row) => {
    const tab = row.indexOf('\t');
    const [mode, type, oid, size] = row.slice(0, tab).trim().split(/\s+/u);
    return { path: row.slice(tab + 1), mode, type, oid, size: size === '-' ? null : Number(size) };
  });
}

function readBlobs(repo, entries) {
  const result = new Map();
  for (let start = 0; start < entries.length; start += 64) {
    const chunk = entries.slice(start, start + 64);
    const bytes = git(repo, ['cat-file', '--batch'], `${chunk.map((x) => x.oid).join('\n')}\n`);
    let offset = 0;
    for (const entry of chunk) {
      const end = bytes.indexOf(10, offset);
      const [oid, type, length] = bytes.subarray(offset, end).toString().split(' ');
      if (end < 0 || oid !== entry.oid || type !== 'blob' || Number(length) !== entry.size) {
        throw new Error('Unexpected Git blob response');
      }
      offset = end + 1;
      const content = bytes.subarray(offset, offset + entry.size);
      if (content.length !== entry.size || bytes[offset + entry.size] !== 10) throw new Error('Truncated Git blob');
      if (content.subarray(0, 100).toString().startsWith('version https://git-lfs.github.com/spec/v1')) {
        throw new Error(`LFS pointer requires an explicit materialization policy: ${entry.path}`);
      }
      result.set(entry.path, content);
      offset += entry.size + 1;
    }
    if (offset !== bytes.length) throw new Error('Unexpected trailing Git blob data');
  }
  return result;
}

function diff(previousPath, manifest) {
  if (!previousPath) return null;
  const previous = JSON.parse(fs.readFileSync(previousPath, 'utf8'));
  if (previous.schemaVersion !== 1 || previous.sourceRepository !== manifest.sourceRepository
    || previous.targetRepository !== manifest.targetRepository || !Array.isArray(previous.files)
    || hash(JSON.stringify(previous.files)) !== previous.exportSha256) throw new Error('Invalid previous manifest');
  const before = new Map(previous.files.map((f) => [f.path, f]));
  const after = new Map(manifest.files.map((f) => [f.path, f]));
  return {
    added: [...after.keys()].filter((p) => !before.has(p)),
    removed: [...before.keys()].filter((p) => !after.has(p)),
    changed: [...after.keys()].filter((p) => before.has(p)
      && (before.get(p).sha256 !== after.get(p).sha256 || before.get(p).mode !== after.get(p).mode)),
  };
}

function referenceReview(selected, contents, omitted) {
  // Conservative literal-reference hints, not a parser or a security scan.
  // Do not include matched excerpts: reports may describe private files.
  const targets = omitted.filter((p) => p.endsWith('.md'));
  const targetSet = new Set(targets);
  return selected.flatMap((entry) => {
    if (!/\.(?:md|txt|json|[cm]?js|ts|html|ya?ml)$/u.test(entry.path)) return [];
    const text = contents.get(entry.path).toString('utf8');
    const references = new Set(targets.filter((target) => text.includes(target)));
    if (entry.path.endsWith('.md')) {
      for (const match of text.matchAll(/\]\(<?([^\s)>]+)>?(?:\s+"[^"]*")?\)/gu)) {
        if (/^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/iu.test(match[1])) continue;
        let link;
        try { link = decodeURIComponent(match[1].split(/[?#]/u)[0]); } catch { continue; }
        const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(entry.path), link));
        if (targetSet.has(resolved)) references.add(resolved);
      }
    }
    return references.size ? [{ path: entry.path, references: [...references].sort() }] : [];
  });
}

function run(options) {
  const repo = fs.realpathSync(options.repo || path.resolve(HERE, '../..'));
  const root = fs.realpathSync(git(repo, ['rev-parse', '--show-toplevel']).toString().trim());
  const { policy, policySha256 } = loadPolicy(options.policy || path.join(HERE, 'policy.json'));
  const remote = git(root, ['remote', 'get-url', 'origin']).toString().trim();
  if (!/^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)bonc-ai\/cogseed-internal(?:\.git)?$/u.test(remote)) {
    throw new Error('origin must identify the confirmed private source repository');
  }
  // Require a new sibling of an existing real directory, never a reused output.
  const requested = path.resolve(options.out);
  const out = path.join(fs.realpathSync(path.dirname(requested)), path.basename(requested));
  if (within(root, out) || fs.existsSync(out) || fs.lstatSync(path.dirname(out)).isSymbolicLink()) {
    throw new Error('Output must be a new directory outside the source checkout');
  }
  let enclosingRepository = false;
  try { git(path.dirname(out), ['rev-parse', '--show-toplevel']); enclosingRepository = true; }
  catch { /* A standalone private output directory is expected. */ }
  if (enclosingRepository) throw new Error('Output must not be inside any Git checkout');
  const entries = tree(root, options.source);
  const allowed = new Set(policy.publicFiles);
  const selected = entries.filter((entry) => allowed.has(entry.path));
  const present = new Set(entries.map((entry) => entry.path));
  const missing = policy.publicFiles.filter((p) => !present.has(p));
  const unclassified = entries.filter((entry) => !allowed.has(entry.path)
    && ![...policy.neverPublic, ...policy.privatePaths].some((rule) => matches(entry.path, rule))).map((e) => e.path);
  const omitted = entries.filter((entry) => !allowed.has(entry.path)).map((e) => e.path);
  const portableNames = new Map();
  let total = 0;
  for (const entry of selected) {
    if (!safePath(entry.path) || !['100644', '100755'].includes(entry.mode) || entry.type !== 'blob') {
      throw new Error(`Non-portable path, symlink or submodule is not exportable: ${entry.path}`);
    }
    // Check every directory segment too (Foo/a + foo/b conflicts on macOS/Windows).
    const parts = entry.path.split('/');
    for (let i = 1; i <= parts.length; i++) {
      const name = parts.slice(0, i).join('/');
      const folded = name.toLowerCase();
      if (portableNames.has(folded) && portableNames.get(folded) !== name) throw new Error(`Case collision: ${name}`);
      portableNames.set(folded, name);
    }
    total += entry.size;
    if (entry.size > 32 * 1024 * 1024 || total > 512 * 1024 * 1024) throw new Error('Export size exceeds review limit');
  }
  selected.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const contents = readBlobs(root, selected);
  const files = selected.map((entry) => ({ path: entry.path, mode: entry.mode, size: entry.size, sha256: hash(contents.get(entry.path)) }));
  const manifest = {
    schemaVersion: 1, sourceRepository: policy.sourceRepository, targetRepository: policy.targetRepository,
    sourceSha: options.source, publicSha: null, releaseTag: null, policySha256,
    exporterSha256: hash(fs.readFileSync(fileURLToPath(import.meta.url))),
    exportSha256: hash(JSON.stringify(files)), files,
  };
  const references = referenceReview(selected, contents, omitted);
  const report = {
    schemaVersion: 1, status: 'review-required', readyForPublication: false,
    sourceSha: options.source, exportSha256: manifest.exportSha256, policyStatus: policy.status,
    selectedCount: files.length, omittedCount: omitted.length, omittedFiles: omitted,
    missingPublicFiles: missing, unclassifiedFiles: unclassified,
    privateReferenceHints: references, difference: diff(options.previous, manifest),
    checks: { contentSecurityScan: 'not-run', independentReview: 'pending', build: 'not-run', platformPackages: 'not-run' },
    note: 'Local candidate only. Classification and reference hints do not prove security, dependency closure or release readiness. Reports must remain private.',
  };
  // Validate and read everything before creating output; never touch the input.
  fs.mkdirSync(out, { mode: 0o700 });
  try {
    const destination = path.join(out, 'source');
    fs.mkdirSync(destination, { mode: 0o700 });
    for (const entry of selected) {
      const target = path.join(destination, entry.path);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, contents.get(entry.path), { flag: 'wx', mode: entry.mode === '100755' ? 0o755 : 0o644 });
    }
    fs.writeFileSync(path.join(out, 'manifest.json'), json(manifest), { flag: 'wx', mode: 0o600 });
    fs.writeFileSync(path.join(out, 'review.json'), json(report), { flag: 'wx', mode: 0o600 });
  } catch (error) {
    // Leave a clearly marked partial local candidate for diagnosis; no retry merges.
    fs.writeFileSync(path.join(out, 'INCOMPLETE'), 'Export failed. Do not publish or reuse this directory.\n');
    throw error;
  }
  process.stdout.write(json({ output: out, files: files.length, exportSha256: manifest.exportSha256,
    unclassified: unclassified.length, missing: missing.length, referenceHints: references.length,
    readyForPublication: false }));
  // 2 is a review-needed result with artifacts; 1 is a tool/input failure.
  return policy.status === 'draft' || missing.length || unclassified.length || references.length ? 2 : 0;
}

try {
  process.exitCode = run(parseArgs(process.argv.slice(2)));
} catch (error) {
  // Child stderr may contain paths/config; do not print arbitrary process output.
  process.stderr.write(`[source-export] ${error.status !== undefined ? 'Git read failed; verify the repository and source SHA' : error.message}\n`);
  process.exitCode = 1;
}
