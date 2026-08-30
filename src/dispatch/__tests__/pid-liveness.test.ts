// Item 5 (j-20260829-5q): a lock must know if its owner is alive — for real.
//
// The defect: every coordinator/specialist lock is born with `pid: 0`, and the
// old isLockActive treated a pid-0 lock past the freshness grace with no
// `dispatched` entry as a DEAD orphan — so a real claim silently stomped the
// LIVE lock of another active task (it happened twice in one day, PR #37's
// pacote-oss among them). The fix: an owner we cannot verify (pid 0) is treated
// as ALIVE, never silently reconciled. On doubt, collide (warn, route), don't
// overwrite. Reconciliation stays for a PROVABLY dead owner (a real pid, gone).
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claimLock, isLockActive, lockPath, readLock, STALE_ORPHAN_GRACE_MS } from "../lock";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "aipe-pidlive-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const past = () => new Date(Date.now() - STALE_ORPHAN_GRACE_MS - 60_000).toISOString();

test("an UNVERIFIABLE owner (pid 0), aged past the grace with no dispatched entry, is treated ALIVE — not a silent orphan", async () => {
  const lock = {
    repo: "aipe",
    journey: "j-oss",
    specialist: "Jesse",
    task: "pacote-oss",
    pid: 0,
    timestamp: past(),
    writes: true,
    paths: ["src/oss/**"],
  };
  // This is exactly the lock that got stomped: pid 0, old, no live dispatch.
  expect(await isLockActive(dir, lock)).toBe(true);
});

test("a PROVABLY dead owner (a real pid that is gone) is STILL reconcilable — orphan cleanup is kept", async () => {
  const lock = {
    repo: "aipe",
    journey: "j-dead",
    specialist: "Gone",
    pid: 2 ** 30, // a pid that does not exist → signal-0 says dead
    timestamp: past(),
  };
  expect(await isLockActive(dir, lock)).toBe(false);
});

test("REPRO: two claims of the same specialist, distinct tasks, DISJOINT paths, coexist — the second does not erase the first", async () => {
  // The first claim ages (pid 0). Before the fix the second claim's unit scan
  // read it as an orphan and unlinked it. Now it is alive, and disjoint paths
  // never overlap, so both locks survive side by side.
  const first = await claimLock(dir, {
    repo: "aipe",
    journey: "j-oss",
    specialist: "Jesse",
    task: "pacote-oss",
    pid: 0,
    paths: ["src/oss/**"],
    now: () => past(),
  });
  expect(first.ok).toBe(true);
  const second = await claimLock(dir, {
    repo: "aipe",
    journey: "j-ident",
    specialist: "Jesse",
    task: "identidade-coordenador",
    pid: 0,
    paths: ["src/runtime/**"],
  });
  expect(second.ok).toBe(true);
  // BOTH locks still on disk — the first was not stomped.
  expect((await readLock(lockPath(dir, "aipe", undefined, "pacote-oss")))?.journey).toBe("j-oss");
  expect((await readLock(lockPath(dir, "aipe", undefined, "identidade-coordenador")))?.journey).toBe("j-ident");
});

test("REPRO: an active pid-0 lock whose paths OVERLAP a new claim now COLLIDES instead of being silently removed", async () => {
  await claimLock(dir, {
    repo: "aipe",
    journey: "j-oss",
    specialist: "Jesse",
    task: "pacote-oss",
    pid: 0,
    paths: ["src/dispatch/**"],
    now: () => past(),
  });
  const overlapping = await claimLock(dir, {
    repo: "aipe",
    journey: "j-other",
    specialist: "Mike",
    task: "other",
    pid: 0,
    paths: ["src/dispatch/lock.ts"],
  });
  expect(overlapping.ok).toBe(false);
  if (!overlapping.ok) expect(overlapping.reason).toBe("collision");
});

test("reconciling a PROVABLY dead writer is reported so the removal is never silent", async () => {
  // A real-pid holder that has died leaves a genuine orphan; taking it over must
  // surface WHICH lock was removed (loud reconciliation).
  await claimLock(dir, {
    repo: "aipe",
    journey: "j-dead",
    specialist: "Gone",
    task: "t",
    pid: 2 ** 30,
    paths: ["src/x/**"],
    now: () => past(),
  });
  const takeover = await claimLock(dir, {
    repo: "aipe",
    journey: "j-new",
    specialist: "New",
    task: "t2",
    pid: 0,
    paths: ["src/x/**"],
  });
  expect(takeover.ok).toBe(true);
  if (takeover.ok) {
    expect(takeover.reconciled).toBe(true);
    expect(takeover.reconciledLocks?.map((l) => l.journey)).toContain("j-dead");
  }
});
