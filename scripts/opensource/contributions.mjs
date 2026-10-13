/** Keep public author commits reachable before a private snapshot is published.
 * Read the ledger from the selected source tree (including tree-copy releases),
 * never from an uncommitted file. No remote operations or Git mutations.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const CONTRIBUTIONS_PATH = 'scripts/opensource/contributions.json';
const SHA = /^[0-9a-f]{40}$/u;

function git(repo, args) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
  return execFileSync('git', ['--no-replace-objects', '-C', repo, ...args], {
    encoding: 'utf8', env, maxBuffer: 64 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'],
  });
}

export function verifyContributions({ privateRepo, sourceSha, publicRepo, publicBase }) {
  if (!SHA.test(sourceSha) || (publicBase !== null && !SHA.test(publicBase))) {
    throw new Error('Contribution verification requires exact source and public SHAs');
  }
  let bytes;
  try { bytes = git(privateRepo, ['show', `${sourceSha}:${CONTRIBUTIONS_PATH}`]); }
  catch { throw new Error('Selected source is missing the public contribution ledger'); }
  let ledger;
  try { ledger = JSON.parse(bytes); }
  catch { throw new Error('Invalid public contribution ledger JSON'); }
  if (ledger?.schemaVersion !== 1 || ledger.repository !== 'bonc-ai/cogseed'
    || !Array.isArray(ledger.contributions)) throw new Error('Invalid public contribution ledger');
  const prs = new Set();
  for (const entry of ledger.contributions) {
    if (!entry || !Number.isSafeInteger(entry.pr) || entry.pr <= 0
      || !SHA.test(entry.headSha) || prs.has(entry.pr)) {
      throw new Error('Invalid or duplicate public contribution record');
    }
    prs.add(entry.pr);
    // A clean bootstrap cannot preserve any registered author history.
    if (publicBase === null) throw new Error('Bootstrap would discard public contribution history');
    try {
      if (git(publicRepo, ['cat-file', '-t', entry.headSha]).trim() !== 'commit') throw new Error('not a commit');
      git(publicRepo, ['merge-base', '--is-ancestor', entry.headSha, publicBase]);
    } catch {
      throw new Error(`PR #${entry.pr} is missing from public main history; merge its reviewed public commits before syncing`);
    }
  }
  // Release promotion may copy trees instead of import ancestry. Its ledger
  // remains cumulative across that release branch; dropping rows cannot erase
  // an earlier attribution obligation.
  const revisions = git(privateRepo, ['rev-list', '--full-history', sourceSha, '--', CONTRIBUTIONS_PATH]).trim().split('\n').filter(Boolean);
  const current = new Map(ledger.contributions.map((entry) => [entry.pr, entry.headSha]));
  for (const revision of revisions) {
    let previous;
    try { previous = JSON.parse(git(privateRepo, ['show', `${revision}:${CONTRIBUTIONS_PATH}`])); }
    catch { throw new Error('Invalid historical public contribution ledger'); }
    if (!Array.isArray(previous?.contributions)) throw new Error('Invalid historical public contribution ledger');
    for (const entry of previous.contributions) {
      if (current.get(entry.pr) !== entry.headSha) {
        throw new Error(`PR #${entry.pr} was removed or changed in the public contribution ledger`);
      }
    }
  }
  // Catch omitted registrations when import commits are in the selected source
  // ancestry. Tree-copy promotions must carry the same reviewed ledger bytes.
  const messages = git(privateRepo, ['log', '--format=%B', '--grep=Source-PR:', sourceSha]);
  for (const line of messages.split('\n').filter((line) => line.startsWith('Source-PR:'))) {
    const match = /^Source-PR: https:\/\/github\.com\/bonc-ai\/cogseed\/pull\/([1-9][0-9]*)\s*$/u.exec(line);
    if (!match || !prs.has(Number(match[1]))) {
      throw new Error('Source-PR import is missing from the public contribution ledger');
    }
  }
  return { count: prs.size, ledgerSha256: createHash('sha256').update(bytes).digest('hex'),
    pullRequests: [...prs] };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 6) throw new Error('Usage: contributions.mjs <private-repo> <source-sha> <public-repo> <public-base>');
    const [privateRepo, sourceSha, publicRepo, publicBase] = process.argv.slice(2);
    process.stdout.write(JSON.stringify(verifyContributions({ privateRepo, sourceSha, publicRepo, publicBase })) + '\n');
  } catch (error) {
    process.stderr.write(`[contributions] ${error.status !== undefined ? 'Git verification failed' : error.message}\n`);
    process.exitCode = 1;
  }
}
