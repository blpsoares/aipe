// Atomic per-repo claim for the parallel-dispatch law. With N coordinator
// sessions racing over the same repo on disk, the same-repo law adjudicated by
// `dispatch validate` is only a per-batch convention — it can't stop two
// sessions from provisioning worktrees for one repo at once. This module adds
// *physical* mutual exclusion: a lock file created atomically, plus stale
// reconciliation so a dead process never wedges a repo forever.
import { link, mkdir, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { listJourneys, readLedger } from "../journey/ledger";

export interface Lock {
  repo: string;
  package?: string;
  journey: string;
  specialist: string;
  branch?: string;
  pid: number;
  timestamp: string;
}

// The lock key is the unit of serialization: the repo, or `repo__package` when a
// package is given (the same-repo law is already package-keyed). Sanitized so it
// is always a safe single-segment filename.
export function lockKey(repo: string, pkg?: string): string {
  const raw = pkg && pkg !== repo ? `${repo}__${pkg}` : repo;
  return raw.replace(/[^A-Za-z0-9._-]/g, "-");
}

export function locksDir(workspaceDir: string): string {
  return join(workspaceDir, ".aipe", "locks");
}

export function lockPath(workspaceDir: string, repo: string, pkg?: string): string {
  return join(locksDir(workspaceDir), `${lockKey(repo, pkg)}.lock`);
}

export async function readLock(path: string): Promise<Lock | null> {
  try {
    const parsed = parse(await readFile(path, "utf8"));
    if (parsed && typeof parsed === "object" && typeof parsed.repo === "string" && typeof parsed.pid === "number") {
      return parsed as Lock;
    }
  } catch {
    // missing or malformed → absent
  }
  return null;
}

// A pid is "alive" if signal 0 doesn't throw ESRCH. EPERM means the process
// exists but we can't signal it — still alive. Any other error → treat as dead.
export function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

// Does some journey still consider this lock's unit LIVE — "dispatched" or
// "redirected"? A redirect is a specialist's `dispatched` record replaced
// in-place (recordDispatch upserts by repo+package+specialist) by a status
// meaning "still working, direction just changed live" — it is not a release
// of the unit. Treating it as anything other than dispatched here would make
// the lock look orphaned the instant a redirect lands, letting a second
// coordinator session claim and re-provision a worktree that a specialist is
// actively (if newly-redirected) still working in.
async function hasDispatchedDispatch(workspaceDir: string, lock: Lock): Promise<boolean> {
  const journeys = await listJourneys(workspaceDir);
  const pkg = lock.package ?? null;
  for (const j of journeys) {
    if (lock.journey && j.id !== lock.journey) continue;
    for (const d of j.dispatches) {
      if (d.repo === lock.repo && (d.package ?? null) === pkg && (d.status === "dispatched" || d.status === "redirected")) return true;
    }
  }
  return false;
}

// How long a freshly-claimed lock is trusted as live WITHOUT a ledger
// "dispatched" entry backing it yet. The claim writes the lock file atomically,
// but the coordinator records the `dispatched` entry a step LATER (it provisions
// the worktree, then runs `aipe journey record`). In that gap the ledger has no
// entry for the unit — yet the lock is not an orphan, the claim is in flight.
// This grace covers that gap generously (a worktree checkout + one ledger write
// is seconds, not minutes); past it, a still-dispatchless lock is a genuine
// orphan (the holder crashed before recording) and becomes reconcilable, so the
// bound is what keeps a crash from wedging a repo forever.
export const STALE_ORPHAN_GRACE_MS = 10 * 60_000; // 10 minutes

// A lock is ACTIVE unless we can positively show its holder is gone. Three
// signals decide it, in order of authority:
//
//   1. A recorded, DEAD pid → overwritable at once. The pid is the coordinator's
//      long-lived session pid (passed via --pid); a tracked pid that no longer
//      exists is a crashed holder, reconcilable even if it just claimed. (pid<=0
//      means "no pid tracking" — the ephemeral CLI pid is meaningless — so the
//      ledger/freshness govern instead.)
//   2. A matching "dispatched"/"redirected" dispatch in some journey → the
//      PRIMARY, durable liveness signal. A finished session calls `dispatch
//      release` at delivered/escalated/merged, flipping the status away.
//   3. FRESHNESS — the fix for the claim→record window. A lock claimed within
//      STALE_ORPHAN_GRACE_MS is live even with no dispatched entry yet, because
//      the atomic claim legitimately precedes the ledger write. Without this a
//      rival reads the not-yet-recorded lock as an orphan and overwrites it, and
//      two sessions both "win" the same repo — the very race this module exists
//      to close. Past the grace with still no dispatched entry, it is an orphan.
//
// `now` is injectable purely so the grace boundary is testable; production passes
// the real clock.
export async function isLockActive(
  workspaceDir: string,
  lock: Lock | null,
  now: number = Date.now(),
): Promise<boolean> {
  if (!lock) return false;
  if (lock.pid > 0 && !isPidAlive(lock.pid)) return false; // (1) crashed holder
  if (await hasDispatchedDispatch(workspaceDir, lock)) return true; // (2) ledger-backed
  const created = Date.parse(lock.timestamp); // (3) freshly-claimed, record imminent
  return Number.isFinite(created) && now - created < STALE_ORPHAN_GRACE_MS;
}

// The human unit key a force-claim override is authorized against — the same
// string the CLI prints and the PE names when granting the override.
export function claimUnit(repo: string, pkg?: string): string {
  return pkg && pkg !== repo ? `${repo}/${pkg}` : repo;
}

// A force-override of an ACTIVE lock is legitimate only when the CLAIMING
// journey carries a recorded PE authorization for exactly this unit (or a `*`
// blanket grant). Overriding the law is a human decision on the record, never an
// agent's shortcut. Reconciling a STALE lock (orphan / dead pid) needs no grant
// — that is ordinary recovery, not an override.
async function hasForceAuthorization(workspaceDir: string, journey: string, unit: string): Promise<boolean> {
  const ledger = await readLedger(workspaceDir, journey);
  return (ledger?.authorizations ?? []).some((a) => a.forceClaim === unit || a.forceClaim === "*");
}

export type ClaimResult =
  | { ok: true; claimed: true; reconciled: boolean; forced?: boolean; previous?: Lock }
  | { ok: false; reason: "collision"; holder: Lock }
  | { ok: false; reason: "unauthorized-force"; holder: Lock; unit: string };

interface ClaimInput {
  repo: string;
  package?: string;
  journey: string;
  specialist: string;
  branch?: string;
  force?: boolean;
  pid?: number;
  now?: () => string;
}

// Atomically claim the repo's lock. Uses link(tmp, lock): link is atomic and
// fails EEXIST if the lock exists, so the winner's lock is always fully written
// (no empty-file window). On EEXIST we evaluate the incumbent: an ACTIVE lock of
// another owner is a collision (unless --force); a stale/orphan lock is taken
// over atomically (unlink + link), re-checking if a rival recreated it.
export async function claimLock(workspaceDir: string, input: ClaimInput): Promise<ClaimResult> {
  const pid = input.pid ?? process.pid;
  const now = input.now ?? (() => new Date().toISOString());
  const path = lockPath(workspaceDir, input.repo, input.package);
  const dir = locksDir(workspaceDir);
  await mkdir(dir, { recursive: true });

  const lock: Lock = {
    repo: input.repo,
    ...(input.package ? { package: input.package } : {}),
    journey: input.journey,
    specialist: input.specialist,
    ...(input.branch ? { branch: input.branch } : {}),
    pid,
    timestamp: now(),
  };
  const content = stringify(lock);

  const tmp = join(dir, `.${lockKey(input.repo, input.package)}.${pid}.${Math.random().toString(36).slice(2)}.tmp`);
  await writeFile(tmp, content, "utf8");

  try {
    // Bounded retry: create atomically; on EEXIST, reconcile or collide.
    // `removed` is the stale lock we tore down to take over (drives reconciled).
    let removed: Lock | undefined;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await link(tmp, path);
        await unlink(tmp);
        return { ok: true, claimed: true, reconciled: removed !== undefined, ...(removed ? { previous: removed } : {}) };
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      }
      const incumbent = await readLock(path);
      if (await isLockActive(workspaceDir, incumbent)) {
        if (!input.force) {
          await unlink(tmp).catch(() => {});
          return { ok: false, reason: "collision", holder: incumbent as Lock };
        }
        // --force over an ACTIVE lock is a law override: it needs a recorded PE
        // authorization for this unit in the claiming journey. Without it, refuse
        // — --force alone is not enough.
        const unit = claimUnit(input.repo, input.package);
        if (!(await hasForceAuthorization(workspaceDir, input.journey, unit))) {
          await unlink(tmp).catch(() => {});
          return { ok: false, reason: "unauthorized-force", holder: incumbent as Lock, unit };
        }
        // authorized --force: overwrite atomically via rename.
        await rename(tmp, path);
        return { ok: true, claimed: true, reconciled: true, forced: true, ...(incumbent ? { previous: incumbent } : {}) };
      }
      // stale / orphan → remove and retry the atomic create so a rival that
      // recreates an ACTIVE lock in the gap makes us loop back to the check.
      if (incumbent) removed = incumbent;
      await unlink(path).catch(() => {});
    }
    // Exhausted retries under contention: last-resort atomic overwrite.
    const incumbent = (await readLock(path)) ?? removed;
    await rename(tmp, path);
    return { ok: true, claimed: true, reconciled: true, ...(incumbent ? { previous: incumbent } : {}) };
  } finally {
    await rm(tmp, { force: true }).catch(() => {});
  }
}

export type ReleaseResult =
  | { ok: true; released: boolean }
  | { ok: false; reason: "foreign"; holder: Lock };

// Release the repo's lock (called at delivered/escalated/merged). Idempotent:
// releasing an absent lock is OK. Without --force only releases a lock owned by
// the given journey; a foreign lock is left alone and reported non-fatally.
export async function releaseLock(
  workspaceDir: string,
  repo: string,
  opts: { journey?: string; package?: string; force?: boolean } = {},
): Promise<ReleaseResult> {
  const path = lockPath(workspaceDir, repo, opts.package);
  const existing = await readLock(path);
  if (!existing) return { ok: true, released: false };
  if (!opts.force && opts.journey && existing.journey !== opts.journey) {
    return { ok: false, reason: "foreign", holder: existing };
  }
  await unlink(path).catch(() => {});
  return { ok: true, released: true };
}
