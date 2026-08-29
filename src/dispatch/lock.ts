// Atomic per-repo claim for the parallel-dispatch law. With N coordinator
// sessions racing over the same repo on disk, the same-repo law adjudicated by
// `dispatch validate` is only a per-batch convention — it can't stop two
// sessions from provisioning worktrees for one repo at once. This module adds
// *physical* mutual exclusion: a lock file created atomically, plus stale
// reconciliation so a dead process never wedges a repo forever.
import { link, mkdir, readFile, readdir, rename, rm, unlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { parse, stringify } from "yaml";
import { listJourneys, readLedger } from "../journey/ledger";
import { normalizePath, overlappingPairs, pathSetsOverlap, WHOLE } from "./paths";

export interface Lock {
  repo: string;
  package?: string;
  task?: string;
  journey: string;
  specialist: string;
  branch?: string;
  pid: number;
  timestamp: string;
  // The paths (globs/prefixes) this claim will touch (j-20260826-xj). Absent ⇒
  // the WHOLE unit — the pre-path repo/package lock, which overlaps everything.
  // Only ever set on a path-aware (writing-role) claim; a legacy/non-writing lock
  // omits it.
  paths?: string[];
  // True only for a path-aware (writing-role) claim. The unit-wide overlap scan
  // considers ONLY writing locks: a non-writing lock (a QA reviewing a diff, or a
  // legacy lock) can never collide over a file, so it is invisible to the scan.
  writes?: boolean;
}

// The lock key is the unit of serialization: the repo, or `repo__package` when a
// package is given (the same-repo law is already package-keyed), plus `__task`
// when a task is given. The task splits the lock for non-writing roles so two
// concurrent tasks of one persona do not serialize, while the SAME task still
// resolves to exactly one winner. The CLI passes a task ONLY for a non-writing
// role (a writing role keeps the unit-level lock, so two devs still contend).
// Sanitized so it is always a safe single-segment filename.
export function lockKey(repo: string, pkg?: string, task?: string): string {
  const base = pkg && pkg !== repo ? `${repo}__${pkg}` : repo;
  const raw = task ? `${base}__${task}` : base;
  return raw.replace(/[^A-Za-z0-9._-]/g, "-");
}

export function locksDir(workspaceDir: string): string {
  return join(workspaceDir, ".aipe", "locks");
}

export function lockPath(workspaceDir: string, repo: string, pkg?: string, task?: string): string {
  return join(locksDir(workspaceDir), `${lockKey(repo, pkg, task)}.lock`);
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
  const task = lock.task ?? null;
  for (const j of journeys) {
    if (lock.journey && j.id !== lock.journey) continue;
    for (const d of j.dispatches) {
      // A per-task lock is kept alive only by its OWN task's dispatch — a
      // different task's live record must not vouch for this lock (else two
      // concurrent tasks of one persona would cross-signal liveness).
      if (
        d.repo === lock.repo &&
        (d.package ?? null) === pkg &&
        (d.task ?? null) === task &&
        (d.status === "dispatched" || d.status === "redirected")
      )
        return true;
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
  | { ok: false; reason: "collision"; holder: Lock; overlaps?: [string, string][] }
  | { ok: false; reason: "unauthorized-force"; holder: Lock; unit: string; overlaps?: [string, string][] };

interface ClaimInput {
  repo: string;
  package?: string;
  task?: string;
  journey: string;
  specialist: string;
  branch?: string;
  force?: boolean;
  pid?: number;
  now?: () => string;
  // When PRESENT (even as an empty array), the claim is path-aware: it declares
  // the paths it will touch and is adjudicated by unit-wide path overlap instead
  // of the single-file unit lock. Empty ⇒ the WHOLE unit (overlaps everything).
  // Absent (undefined) ⇒ the legacy single-file behaviour, unchanged — this is
  // what a non-writing task-split claim and every pre-path caller take.
  paths?: string[];
}

// Claim a lock. Two regimes, chosen by whether the claim declares `paths`:
//   • absent ⇒ the LEGACY single-file unit/task lock (claimLegacy) — byte-for-byte
//     the pre-path behaviour, used by non-writing task-split claims and every
//     pre-path caller.
//   • present (incl. empty ⇒ WHOLE) ⇒ the PATH-AWARE claim (claimPathAware) — a
//     unit-wide overlap scan under a per-unit guard, so path-disjoint writers
//     coexist and overlapping ones serialize.
export async function claimLock(workspaceDir: string, input: ClaimInput): Promise<ClaimResult> {
  return input.paths === undefined ? claimLegacy(workspaceDir, input) : claimPathAware(workspaceDir, input);
}

// Atomically claim the repo's lock. Uses link(tmp, lock): link is atomic and
// fails EEXIST if the lock exists, so the winner's lock is always fully written
// (no empty-file window). On EEXIST we evaluate the incumbent: an ACTIVE lock of
// another owner is a collision (unless --force); a stale/orphan lock is taken
// over atomically (unlink + link), re-checking if a rival recreated it.
async function claimLegacy(workspaceDir: string, input: ClaimInput): Promise<ClaimResult> {
  const pid = input.pid ?? process.pid;
  const now = input.now ?? (() => new Date().toISOString());
  const path = lockPath(workspaceDir, input.repo, input.package, input.task);
  const dir = locksDir(workspaceDir);
  await mkdir(dir, { recursive: true });

  const lock: Lock = {
    repo: input.repo,
    ...(input.package ? { package: input.package } : {}),
    ...(input.task ? { task: input.task } : {}),
    journey: input.journey,
    specialist: input.specialist,
    ...(input.branch ? { branch: input.branch } : {}),
    pid,
    timestamp: now(),
  };
  const content = stringify(lock);

  const tmp = join(dir, `.${lockKey(input.repo, input.package, input.task)}.${pid}.${Math.random().toString(36).slice(2)}.tmp`);
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

// ── Path-aware claim (j-20260826-xj) ─────────────────────────────────────────
//
// Two claims in one repo with DISJOINT paths coexist; OVERLAPPING paths collide
// and serialize, reusing the same physical primitive (atomic link) — here to
// build a short-lived per-unit GUARD mutex that serializes the read-scan-decide-
// write critical section across processes. Without that serialization two
// overlapping claims racing in separate processes could both scan an empty unit
// and both write — the silent hole this journey closes. Identity stays per-task:
// the lock FILE is still `lockKey(repo,pkg,task).lock`, so two disjoint sub-tasks
// (distinct tasks) get distinct files, while overlap is judged unit-wide across
// tasks. Only WRITING claims (writes:true) participate — a non-writing lock can
// never collide over a file, so the scan ignores it.

// How long a held guard is trusted before a rival may steal it. The critical
// section is a directory scan + one write (milliseconds); a guard older than this
// belonged to a crashed holder whose pid we could not observe (pid 0). Crash of a
// real-pid holder is caught immediately via isPidAlive, so this TTL is only the
// backstop for the pid-less case.
const GUARD_TTL_MS = 30_000;
const GUARD_ACQUIRE_DEADLINE_MS = 10_000;

function guardPath(workspaceDir: string, repo: string, pkg?: string): string {
  return join(locksDir(workspaceDir), `.${lockKey(repo, pkg)}.guard`);
}

interface Guard {
  pid: number;
  timestamp: string;
}

async function readGuard(path: string): Promise<Guard | null> {
  try {
    const parsed = parse(await readFile(path, "utf8"));
    if (parsed && typeof parsed === "object" && typeof parsed.pid === "number") return parsed as Guard;
  } catch {
    // missing/malformed → absent
  }
  return null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Acquire the per-unit guard via the atomic link primitive; spin with jittered
// backoff while a LIVE guard is held, stealing a stale one (dead pid, or older
// than the TTL). Returns a release fn. Never blocks forever: past the deadline it
// steals whatever is there (last resort, matching claimLegacy's exhausted-retry).
async function acquireGuard(
  dir: string,
  repo: string,
  pkg: string | undefined,
  pid: number,
  now: () => string,
): Promise<() => Promise<void>> {
  const gp = guardPath(dir, repo, pkg);
  const deadline = Date.now() + GUARD_ACQUIRE_DEADLINE_MS;
  for (;;) {
    const tmp = join(locksDir(dir), `.guard.${pid}.${Math.random().toString(36).slice(2)}.tmp`);
    await writeFile(tmp, stringify({ pid, timestamp: now() } satisfies Guard), "utf8");
    try {
      await link(tmp, gp);
      await unlink(tmp).catch(() => {});
      return async () => {
        await unlink(gp).catch(() => {});
      };
    } catch (err) {
      await unlink(tmp).catch(() => {});
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
    const held = await readGuard(gp);
    const stale =
      !held ||
      (held.pid > 0 && !isPidAlive(held.pid)) ||
      Date.now() - Date.parse(held.timestamp) > GUARD_TTL_MS ||
      Date.now() > deadline;
    if (stale) {
      await unlink(gp).catch(() => {});
      continue;
    }
    await sleep(5 + Math.floor(Math.random() * 15));
  }
}

// The unit is repo (or repo/package). Path granularity lives WITHIN a unit, so
// this is the scope the guard and the overlap scan span — task-independent.
function sameUnit(lock: Lock, repo: string, pkg?: string): boolean {
  return lock.repo === repo && (lock.package ?? null) === (pkg ?? null);
}

async function readAllLocks(dir: string): Promise<{ file: string; lock: Lock }[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const out: { file: string; lock: Lock }[] = [];
  for (const file of names) {
    if (!file.endsWith(".lock")) continue;
    const lock = await readLock(join(dir, file));
    if (lock) out.push({ file, lock });
  }
  return out;
}

// Normalize a declared path set: canonicalize each, dedupe, and collapse to the
// WHOLE unit (represented as []) if any member is the whole unit. [] means "the
// whole unit" everywhere downstream (pathSetsOverlap treats it as `**`).
function normalizeDeclared(paths: string[]): string[] {
  const norm = [...new Set(paths.map(normalizePath))];
  return norm.includes(WHOLE) ? [] : norm;
}

function isSameIdentity(lock: Lock, input: ClaimInput): boolean {
  return (
    lock.journey === input.journey &&
    lock.specialist.toLowerCase() === input.specialist.toLowerCase() &&
    (lock.task ?? null) === (input.task ?? null)
  );
}

async function claimPathAware(workspaceDir: string, input: ClaimInput): Promise<ClaimResult> {
  const pid = input.pid ?? process.pid;
  const now = input.now ?? (() => new Date().toISOString());
  const dir = locksDir(workspaceDir);
  await mkdir(dir, { recursive: true });

  const declared = normalizeDeclared(input.paths ?? []);
  const myPath = lockPath(workspaceDir, input.repo, input.package, input.task);
  const myFile = basename(myPath);
  const nowMs = Date.parse(now());

  const lock: Lock = {
    repo: input.repo,
    ...(input.package ? { package: input.package } : {}),
    ...(input.task ? { task: input.task } : {}),
    journey: input.journey,
    specialist: input.specialist,
    ...(input.branch ? { branch: input.branch } : {}),
    pid,
    timestamp: now(),
    writes: true,
    ...(declared.length ? { paths: declared } : {}),
  };
  const content = stringify(lock);

  const release = await acquireGuard(workspaceDir, input.repo, input.package, pid, now);
  try {
    const all = await readAllLocks(dir);
    let reconciled = false;
    let previous: Lock | undefined;
    const overlapping: Lock[] = [];

    for (const { file, lock: other } of all) {
      if (file === myFile) continue; // my own identity slot handled below
      if (!sameUnit(other, input.repo, input.package)) continue;
      if (other.writes !== true) continue; // non-writing / legacy locks can't collide over a file
      if (!(await isLockActive(workspaceDir, other, nowMs))) {
        await unlink(join(dir, file)).catch(() => {}); // stale writer in the unit → reconcile away
        reconciled = true;
        previous = other;
        continue;
      }
      if (pathSetsOverlap(declared, other.paths ?? [])) overlapping.push(other);
    }

    if (overlapping.length > 0) {
      const holder = overlapping[0]!;
      const overlaps = overlappingPairs(declared, holder.paths ?? []);
      if (!input.force) {
        return { ok: false, reason: "collision", holder, ...(overlaps.length ? { overlaps } : {}) };
      }
      const unit = claimUnit(input.repo, input.package);
      if (!(await hasForceAuthorization(workspaceDir, input.journey, unit))) {
        return { ok: false, reason: "unauthorized-force", holder, unit, ...(overlaps.length ? { overlaps } : {}) };
      }
      // authorized force: remove every overlapping active writer, then take over.
      for (const o of overlapping) {
        await unlink(lockPath(workspaceDir, o.repo, o.package, o.task)).catch(() => {});
      }
      previous = holder;
      reconciled = true;
    }

    // My identity slot: a foreign ACTIVE lock sitting on my exact filename (task
    // reuse across journeys) is a collision even when paths are disjoint — I
    // cannot overwrite a live foreign claim. A stale or same-identity slot is
    // overwritten.
    const mineExisting = await readLock(myPath);
    if (mineExisting && !isSameIdentity(mineExisting, input)) {
      if ((await isLockActive(workspaceDir, mineExisting, nowMs)) && overlapping.length === 0) {
        return { ok: false, reason: "collision", holder: mineExisting };
      }
      previous = previous ?? mineExisting;
      reconciled = true;
    }
    await unlink(myPath).catch(() => {});
    await writeFile(myPath, content, "utf8");
    return {
      ok: true,
      claimed: true,
      reconciled,
      ...(overlapping.length > 0 && input.force ? { forced: true } : {}),
      ...(previous ? { previous } : {}),
    };
  } finally {
    await release();
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
  // `paths` is accepted so a path-aware release reads symmetrically with its
  // claim, but identity is the (repo, package, task) key — a path claim's file is
  // `lockKey(repo,pkg,task).lock`, exactly what a disjoint sibling does NOT share
  // — so the lookup does not depend on the declared paths.
  opts: { journey?: string; package?: string; task?: string; paths?: string[]; force?: boolean } = {},
): Promise<ReleaseResult> {
  const path = lockPath(workspaceDir, repo, opts.package, opts.task);
  const existing = await readLock(path);
  if (!existing) return { ok: true, released: false };
  if (!opts.force && opts.journey && existing.journey !== opts.journey) {
    return { ok: false, reason: "foreign", holder: existing };
  }
  await unlink(path).catch(() => {});
  return { ok: true, released: true };
}
