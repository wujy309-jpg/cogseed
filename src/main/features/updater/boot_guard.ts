/**
 * Post-upgrade boot self-check.
 *
 * The new build writes a marker on its first launch after an install. If the
 * marker survives two consecutive starts, the upgrade is treated as unstable and
 * the guard records that verdict (`getBootGuardVerdict`) plus its logs.
 *
 * Nothing consumes the verdict to disable auto-update or offer a rollback yet:
 * this module only computes and retains it. The updater IPC layer is a later
 * task, and it must treat a missing verdict as "unknown" rather than "healthy" —
 * `null` means the guard never ran for that uid, not that the boot was clean.
 *
 * The record is retained in memory per uid so reporting does not re-read (and
 * re-count) the marker; it stays readable for the rest of the session even after
 * a window turns out healthy. It is keyed by the uid passed at call time — never
 * by a path captured at module load.
 *
 * The module deliberately owns no timers, no electron import and no I/O beyond
 * `./state`: the caller supplies `currentVersion` and `now`, which keeps the
 * state machine testable without an Electron app.
 */

import { createLogger } from '../../logger';
import { clearInstall, clearPendingBoot, readUpdaterState, recordBootAttempt, writeUpdaterState } from './state';

const log = createLogger('updater:boot-guard');
const UNSTABLE_ATTEMPT_THRESHOLD = 2;
/**
 * An install record this old can no longer be a hand-off in flight (the detached
 * helper gives up after 60 s), so it is dead evidence: dropping it lets a later,
 * unrelated boot be judged on its own instead of mismatching forever.
 */
const INSTALL_STALE_MS = 7 * 24 * 60 * 60 * 1000;

export interface BootGuardVerdict {
  unstable: boolean;
  /** A pending install record exists but the running version is not its target. */
  installMissed?: boolean;
  /** Why this verdict was reached; undefined for a clean boot. */
  reason?: 'install-missed' | 'install-stale' | 'unknown-from-version' | 'unstable';
  fromVersion?: string;
  toVersion?: string;
}

/** Last verdict per uid for this process's lifetime; read by the updates IPC layer. */
const _verdicts = new Map<string, BootGuardVerdict>();

export function evaluateBootGuard(
  userId: string,
  input: { currentVersion: string; now?: number },
): BootGuardVerdict {
  const now = input.now ?? Date.now();
  const state = readUpdaterState(userId);
  // A pending install whose target is not what we are running usually means the
  // hand-off never took effect (helper died, UAC declined, installer aborted) —
  // but it also happens on a legitimate premature relaunch: the detached helper
  // waits up to 60 s for the old pid, and a user who reopens the app inside that
  // window runs the OLD version while the record names the NEW one. That is NOT
  // an upgrade boot: do not start an instability streak against a version that
  // never installed. Neither is it a reason to delete the record — it is the only
  // durable hand-off evidence, and once the install does apply the next boot
  // seeds `from_version` from it, which is the only way the streak can be
  // attributed to the upgrade at all.
  const install = state.install;
  if (install && install.version !== input.currentVersion) {
    const age = now - install.requested_at;
    if (Number.isFinite(age) && age > INSTALL_STALE_MS) {
      log.warn('pending install record is stale; dropping it', {
        expected: install.version,
        running: input.currentVersion,
        ageMs: age,
      });
      writeUpdaterState(userId, clearInstall(state));
      return _remember(userId, {
        unstable: false,
        installMissed: true,
        reason: 'install-stale',
        fromVersion: install.from_version || undefined,
      });
    }
    log.warn('pending install has not taken effect; keeping the record for the hand-off', {
      expected: install.version,
      running: input.currentVersion,
      ageMs: age,
    });
    return _remember(userId, {
      unstable: false,
      installMissed: true,
      reason: 'install-missed',
      fromVersion: install.from_version || undefined,
    });
  }
  // First boot after an install: seed from the approved install record. Later boots reuse it.
  const fromVersion = state.pending_boot?.from_version ?? state.install?.from_version ?? '';
  const next = recordBootAttempt(state, {
    from_version: fromVersion,
    to_version: input.currentVersion,
    now,
  });
  writeUpdaterState(userId, next);
  const attempts = next.pending_boot?.attempts ?? 0;
  // An empty `from_version` means the upgrade partner is unknown: counting
  // attempts against it could never attribute an install regression, so it must
  // not flag. It must not be silent either — a repeating boot at the threshold is
  // exactly the signal a human needs to see.
  if (!fromVersion && attempts >= UNSTABLE_ATTEMPT_THRESHOLD) {
    log.warn('boot attempts reached the threshold with an unknown previous version', {
      to: input.currentVersion,
      attempts,
    });
    return _remember(userId, {
      unstable: false,
      installMissed: false,
      reason: 'unknown-from-version',
      toVersion: input.currentVersion,
    });
  }
  if (fromVersion && attempts >= UNSTABLE_ATTEMPT_THRESHOLD) {
    log.warn('upgrade considered unstable', { from: fromVersion, to: input.currentVersion, attempts });
    return _remember(userId, {
      unstable: true,
      installMissed: false,
      reason: 'unstable',
      fromVersion,
      toVersion: input.currentVersion,
    });
  }
  return _remember(userId, {
    unstable: false,
    installMissed: false,
    fromVersion: fromVersion || undefined,
    toVersion: input.currentVersion,
  });
}

export function markBootHealthy(userId: string): void {
  // A healthy window closes both the boot guard and the pending install. The
  // retained verdict deliberately survives: it is this session's evidence that
  // the upgrade already failed to boot twice, and the updater IPC layer reads it
  // later to disable auto-update and offer a rollback. The next app start judges
  // the (now cleared) marker from scratch.
  writeUpdaterState(userId, clearInstall(clearPendingBoot(readUpdaterState(userId))));
}

/**
 * The verdict computed for `userId` during this app start, or `null` if the
 * guard has not run for that uid. Consumers (updater IPC) must pass the uid they
 * are serving, not a cached one.
 */
export function getBootGuardVerdict(userId: string): BootGuardVerdict | null {
  return _verdicts.get(userId) ?? null;
}

function _remember(userId: string, verdict: BootGuardVerdict): BootGuardVerdict {
  _verdicts.set(userId, verdict);
  return verdict;
}
