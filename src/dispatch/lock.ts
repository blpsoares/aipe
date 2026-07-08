// Atomic per-repo claim for the parallel-dispatch law. With N coordinator
// sessions racing over the same repo on disk, the same-repo law adjudicated by
// `dispatch validate` is only a per-batch convention — it can't stop two
// sessions from provisioning worktrees for one repo at once. This module adds
// *physical* mutual exclusion: a lock file created atomically, plus stale
// reconciliation so a dead process never wedges a repo forever.
import { link, mkdir, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { listJourneys } from "../journey/ledger";

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

// Does some journey still consider this lock's unit dispatched? Matches on repo
// (+ package, + journey when the lock names one) with status "dispatched".
async function hasDispatchedDispatch(workspaceDir: string, lock: Lock): Promise<boolean> {
  const journeys = await listJourneys(workspaceDir);
  const pkg = lock.package ?? null;
  for (const j of journeys) {
    if (lock.journey && j.id !== lock.journey) continue;
    for (const d of j.dispatches) {
      if (d.repo === lock.repo && (d.package ?? null) === pkg && d.status === "dispatched") return true;
    }
  }
  return false;
}

// A lock is ACTIVE when a matching "dispatched" dispatch still exists AND (if a
// real pid was recorded) that pid is alive. Two independent staleness signals,
// per spec: orphan (no dispatched dispatch) OR a dead holder pid → overwritable.
//
// The ledger's "dispatched" status is the PRIMARY, durable liveness signal — a
// session that finished calls `dispatch release` (at delivered/escalated/merged),
// flipping the status away from "dispatched". The pid is a SECONDARY crash
// detector and only meaningful when it's the coordinator's long-lived session pid
// (passed via --pid); the ephemeral `aipe` CLI process would be dead instantly and
// is meaningless, so pid<=0 means "no pid tracking — the ledger governs".
export async function isLockActive(workspaceDir: string, lock: Lock | null): Promise<boolean> {
  if (!lock) return false;
  if (!(await hasDispatchedDispatch(workspaceDir, lock))) return false; // orphan
  if (lock.pid > 0 && !isPidAlive(lock.pid)) return false; // crashed holder
  return true;
}

export type ClaimResult =
  | { ok: true; claimed: true; reconciled: boolean; previous?: Lock }
  | { ok: false; reason: "collision"; holder: Lock };

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
        // --force over an active lock: overwrite atomically via rename.
        await rename(tmp, path);
        return { ok: true, claimed: true, reconciled: true, ...(incumbent ? { previous: incumbent } : {}) };
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
