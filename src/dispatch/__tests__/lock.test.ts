import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordAuthorization, recordDispatch, startJourney } from "../../journey/ledger";
import {
  claimLock,
  isLockActive,
  isPidAlive,
  lockKey,
  lockPath,
  readLock,
  releaseLock,
  STALE_ORPHAN_GRACE_MS,
} from "../lock";

async function ws(): Promise<string> {
  return mkdtemp(join(tmpdir(), "aipe-lock-"));
}

// Records a live 'dispatched' dispatch (current pid) so a lock over that repo
// counts as ACTIVE under stale reconciliation.
async function dispatched(dir: string, journey: string, repo: string): Promise<void> {
  await startJourney(dir, journey);
  await recordDispatch(dir, journey, { repo, specialist: "X", branch: "b", worktree: "w", status: "dispatched" });
}

test("lockKey sanitizes and package-keys", () => {
  expect(lockKey("embark")).toBe("embark");
  expect(lockKey("platform", "core")).toBe("platform__core");
  expect(lockKey("weird/name")).toBe("weird-name");
});

test("claim writes the lock file atomically with the metadata", async () => {
  const dir = await ws();
  try {
    await dispatched(dir, "j1", "embark");
    const r = await claimLock(dir, { repo: "embark", journey: "j1", specialist: "Joaquim", branch: "br" });
    expect(r.ok).toBe(true);
    const lock = await readLock(lockPath(dir, "embark"));
    expect(lock?.repo).toBe("embark");
    expect(lock?.journey).toBe("j1");
    expect(lock?.specialist).toBe("Joaquim");
    expect(lock?.branch).toBe("br");
    expect(lock?.pid).toBe(process.pid);
    expect(typeof lock?.timestamp).toBe("string");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("two concurrent claims over one ACTIVE repo: exactly one wins", async () => {
  const dir = await ws();
  try {
    await dispatched(dir, "j1", "embark");
    // Both racers reference journeys whose dispatch is live → the winner's lock
    // is ACTIVE, so the loser must collide rather than take over.
    await dispatched(dir, "j2", "embark");
    const [a, b] = await Promise.all([
      claimLock(dir, { repo: "embark", journey: "j1", specialist: "A" }),
      claimLock(dir, { repo: "embark", journey: "j2", specialist: "B" }),
    ]);
    const wins = [a, b].filter((r) => r.ok).length;
    const losses = [a, b].filter((r) => !r.ok).length;
    expect(wins).toBe(1);
    expect(losses).toBe(1);
    const loser = [a, b].find((r) => !r.ok);
    expect(loser && loser.ok === false && loser.reason).toBe("collision");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ledger-governed lock (pid 0) collides across sessions while dispatched", async () => {
  const dir = await ws();
  try {
    // Real CLI usage: no pid recorded (0) → liveness governed purely by the
    // ledger. Session A claims embark while its dispatch is 'dispatched'.
    await dispatched(dir, "j1", "embark");
    const a = await claimLock(dir, { repo: "embark", journey: "j1", specialist: "A", pid: 0 });
    expect(a.ok).toBe(true);
    // Session B (a fresh process, A's CLI long gone) must still COLLIDE because
    // A's journey keeps embark 'dispatched' — the pid being "dead" is irrelevant.
    await dispatched(dir, "j2", "embark");
    const b = await claimLock(dir, { repo: "embark", journey: "j2", specialist: "B", pid: 0 });
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.reason).toBe("collision");
    // Once A releases (work delivered), B can claim.
    await releaseLock(dir, "embark", { journey: "j1" });
    const b2 = await claimLock(dir, { repo: "embark", journey: "j2", specialist: "B", pid: 0 });
    expect(b2.ok).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// Finding A (whole-branch review, same class as the dashboard/journey
// visibility bugs): `hasDispatchedDispatch` only matched status "dispatched"
// — but `recordDispatch` upserts a redirect IN PLACE of the specialist's
// "dispatched" record (same repo+package+specialist key), so the instant a
// live redirect lands, the lock would look orphaned even though the
// specialist is still actively working, just on a changed brief. A second
// coordinator session must still collide, not be handed the same worktree.
test("a redirected dispatch keeps the lock ACTIVE — a redirect is not a release", async () => {
  const dir = await ws();
  try {
    await startJourney(dir, "j1");
    await recordDispatch(dir, "j1", {
      repo: "embark", specialist: "A", branch: "b", worktree: "w",
      status: "redirected", redirectReason: "PE changed direction mid-flight",
    });
    const a = await claimLock(dir, { repo: "embark", journey: "j1", specialist: "A", pid: 0 });
    expect(a.ok).toBe(true);

    await startJourney(dir, "j2");
    await recordDispatch(dir, "j2", { repo: "embark", specialist: "B", branch: "b2", worktree: "w2", status: "dispatched" });
    const b = await claimLock(dir, { repo: "embark", journey: "j2", specialist: "B", pid: 0 });
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.reason).toBe("collision");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("--force over an ACTIVE lock WITHOUT a recorded authorization is REFUSED (unauthorized-force)", async () => {
  const dir = await ws();
  try {
    await dispatched(dir, "j1", "embark");
    await dispatched(dir, "j2", "embark");
    const first = await claimLock(dir, { repo: "embark", journey: "j1", specialist: "A" });
    expect(first.ok).toBe(true);

    const collide = await claimLock(dir, { repo: "embark", journey: "j2", specialist: "B" });
    expect(collide.ok).toBe(false);
    if (!collide.ok) expect(collide.reason).toBe("collision");

    // --force alone is NOT enough: without the PE's grant recorded in the
    // claiming journey's ledger, the override is refused and the lock is untouched.
    const forced = await claimLock(dir, { repo: "embark", journey: "j2", specialist: "B", force: true });
    expect(forced.ok).toBe(false);
    if (!forced.ok) {
      expect(forced.reason).toBe("unauthorized-force");
      if (forced.reason === "unauthorized-force") expect(forced.unit).toBe("embark");
    }
    // holder unchanged — j1 still owns it
    expect((await readLock(lockPath(dir, "embark")))?.journey).toBe("j1");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("--force over an ACTIVE lock WITH a recorded PE authorization overrides it", async () => {
  const dir = await ws();
  try {
    await dispatched(dir, "j1", "embark");
    await dispatched(dir, "j2", "embark");
    const first = await claimLock(dir, { repo: "embark", journey: "j1", specialist: "A" });
    expect(first.ok).toBe(true);

    // PE grants j2 the override for this unit, recorded on the ledger.
    await recordAuthorization(dir, "j2", { grantedBy: "PE", forceClaim: "embark" });

    const forced = await claimLock(dir, { repo: "embark", journey: "j2", specialist: "B", force: true });
    expect(forced.ok).toBe(true);
    if (forced.ok) expect(forced.forced).toBe(true);
    expect((await readLock(lockPath(dir, "embark")))?.journey).toBe("j2");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a force authorization for a DIFFERENT unit does not authorize this override", async () => {
  const dir = await ws();
  try {
    await dispatched(dir, "j1", "embark");
    await dispatched(dir, "j2", "embark");
    await claimLock(dir, { repo: "embark", journey: "j1", specialist: "A" });
    // grant names the wrong unit — must not unlock 'embark'
    await recordAuthorization(dir, "j2", { grantedBy: "PE", forceClaim: "other-repo" });
    const forced = await claimLock(dir, { repo: "embark", journey: "j2", specialist: "B", force: true });
    expect(forced.ok).toBe(false);
    if (!forced.ok) expect(forced.reason).toBe("unauthorized-force");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("an AGED orphan (no 'dispatched' dispatch, past the grace) is reconciled/overwritten", async () => {
  const dir = await ws();
  try {
    // j1 claimed embark and never recorded a 'dispatched' entry — a holder that
    // crashed between claim and record. Stamp its lock BEYOND the freshness grace
    // (pid 0 = no crash tracking), so it is now a genuine orphan, not a claim
    // still in flight.
    const old = new Date(Date.now() - STALE_ORPHAN_GRACE_MS - 60_000).toISOString();
    const first = await claimLock(dir, { repo: "embark", journey: "j1", specialist: "A", pid: 0, now: () => old });
    expect(first.ok).toBe(true);
    // j2 comes along; the incumbent is dispatchless AND aged out → overwritable,
    // a reconciled takeover rather than a collision, so a crash never wedges a repo.
    const second = await claimLock(dir, { repo: "embark", journey: "j2", specialist: "B", pid: 0 });
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.reconciled).toBe(true);
    expect((await readLock(lockPath(dir, "embark")))?.journey).toBe("j2");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ── The claim→record window (the bug Mike's review caught) ───────────────────
// The REAL dispatch order is: claim the lock FIRST, then — a worktree-create
// later — record the `dispatched` entry. Between the two the ledger has NO entry
// for the unit. The prior tests all recorded `dispatched` BEFORE claiming, so
// they proved serialization of an already-live dispatch, never that the claim
// itself closes the race. These pin the window directly.

test("window: a freshly-claimed lock with NO dispatched entry yet is ACTIVE (not an orphan)", async () => {
  const dir = await ws();
  try {
    // Real order: claim, and DO NOT record `dispatched`. The lock stands alone.
    const first = await claimLock(dir, { repo: "embark", journey: "j1", specialist: "A", pid: 0 });
    expect(first.ok).toBe(true);
    const lock = await readLock(lockPath(dir, "embark"));
    // Within the grace it reads as live off its own timestamp — so a rival collides.
    expect(await isLockActive(dir, lock)).toBe(true);
    // Age it past the grace with still no dispatched entry → now a genuine orphan.
    const aged = Date.parse(lock!.timestamp) + STALE_ORPHAN_GRACE_MS + 1;
    expect(await isLockActive(dir, lock, aged)).toBe(false);
    // Record `dispatched` (the step the coordinator runs next): durably live again,
    // grace irrelevant.
    await dispatched(dir, "j1", "embark");
    expect(await isLockActive(dir, lock, aged)).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("window closed in the REAL order: two claims race the lock with NO prior dispatch — exactly one wins", async () => {
  // This is the case that produced two winners before the fix (20/20 rounds).
  // No `dispatched` is recorded up front; the claim alone must serialize.
  const ROUNDS = 40;
  for (let round = 0; round < ROUNDS; round++) {
    const dir = await ws();
    try {
      const [a, b] = await Promise.all([
        claimLock(dir, { repo: "embark", journey: "j1", specialist: "A", pid: 0 }),
        claimLock(dir, { repo: "embark", journey: "j2", specialist: "B", pid: 0 }),
      ]);
      const wins = [a, b].filter((r) => r.ok).length;
      const collisions = [a, b].filter((r) => !r.ok && r.reason === "collision").length;
      expect(wins).toBe(1);
      expect(collisions).toBe(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

test("dead-pid lock is reconciled even with a live dispatched dispatch", async () => {
  const dir = await ws();
  try {
    await dispatched(dir, "j1", "embark");
    // Simulate a crashed holder: a claim whose pid is not alive.
    const deadPid = 2 ** 31 - 1; // effectively never a running pid
    expect(isPidAlive(deadPid)).toBe(false);
    const stale = await claimLock(dir, { repo: "embark", journey: "j1", specialist: "A", pid: deadPid });
    expect(stale.ok).toBe(true);

    const takeover = await claimLock(dir, { repo: "embark", journey: "j1", specialist: "A2" });
    expect(takeover.ok).toBe(true);
    if (takeover.ok) expect(takeover.reconciled).toBe(true);
    expect((await readLock(lockPath(dir, "embark")))?.pid).toBe(process.pid);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("release removes the lock; idempotent; refuses foreign without --force", async () => {
  const dir = await ws();
  try {
    await dispatched(dir, "j1", "embark");
    await claimLock(dir, { repo: "embark", journey: "j1", specialist: "A" });

    // foreign journey cannot release
    const foreign = await releaseLock(dir, "embark", { journey: "other" });
    expect(foreign.ok).toBe(false);
    expect(await readLock(lockPath(dir, "embark"))).not.toBeNull();

    const owned = await releaseLock(dir, "embark", { journey: "j1" });
    expect(owned.ok).toBe(true);
    if (owned.ok) expect(owned.released).toBe(true);
    expect(await readLock(lockPath(dir, "embark"))).toBeNull();

    // releasing an absent lock is a NOOP, not an error
    const again = await releaseLock(dir, "embark", { journey: "j1" });
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.released).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("distinct packages of one repo get distinct locks", async () => {
  const dir = await ws();
  try {
    await startJourney(dir, "j1");
    await recordDispatch(dir, "j1", { repo: "platform", package: "core", specialist: "A", branch: "b", worktree: "w", status: "dispatched" });
    await recordDispatch(dir, "j1", { repo: "platform", package: "web", specialist: "B", branch: "b", worktree: "w", status: "dispatched" });
    const a = await claimLock(dir, { repo: "platform", package: "core", journey: "j1", specialist: "A" });
    const b = await claimLock(dir, { repo: "platform", package: "web", journey: "j1", specialist: "B" });
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(lockPath(dir, "platform", "core")).not.toBe(lockPath(dir, "platform", "web"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ── Atomicity under real concurrency, in the REAL claim→record order ─────────
// A single "claim twice" pass proves nothing about atomicity — a lucky
// interleaving passes it. These two tests make luck an implausible explanation:
// the in-process one repeats the many-way race dozens of times; the multi-process
// one drives the real CLI in separate OS processes contending for one lock file.
// Both claim with NO `dispatched` entry recorded first — the real order, where
// the lock must serialize on its own. (Recording `dispatched` up front, as these
// tests used to, only proved serialization of an already-live dispatch and let
// the window bug through.)

test("in-process race: 5 concurrent claimants over one repo, no prior dispatch, exactly one wins — repeated", async () => {
  const ROUNDS = 60;
  const CLAIMANTS = 5;
  for (let round = 0; round < ROUNDS; round++) {
    const dir = await ws();
    try {
      const journeys = Array.from({ length: CLAIMANTS }, (_, i) => `j${i}`);
      // No dispatched entries: real order, claim first. pid 0 = no crash tracking,
      // so the winner's lock is live purely off its own freshness.
      const results = await Promise.all(
        journeys.map((j) => claimLock(dir, { repo: "embark", journey: j, specialist: j, pid: 0 })),
      );
      const wins = results.filter((r) => r.ok).length;
      const collisions = results.filter((r) => !r.ok && r.reason === "collision").length;
      expect(wins).toBe(1);
      expect(collisions).toBe(CLAIMANTS - 1);
      // the persisted lock belongs to exactly the winner
      const winner = journeys[results.findIndex((r) => r.ok)];
      expect((await readLock(lockPath(dir, "embark")))?.journey).toBe(winner);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

test("multi-process race: N separate CLI processes contend for one lock (pid default, no prior dispatch), exactly one CLAIMED", async () => {
  const cli = join(import.meta.dir, "..", "cli.ts");
  const N = 6;
  const ROUNDS = 5;
  for (let round = 0; round < ROUNDS; round++) {
    const dir = await ws();
    try {
      const journeys = Array.from({ length: N }, (_, i) => `j${i}`);
      // The REAL order: NO `dispatched` recorded before the claim. --pid 0 is the
      // documented flow's default (the ephemeral CLI pid is meaningless), so the
      // winner's lock is live only by its own freshness — exactly the window that
      // produced two winners before the fix. Spawn all claimants at once.
      const procs = journeys.map((j) =>
        Bun.spawn(["bun", cli, "claim", "embark", "--journey", j, "--specialist", j, "--pid", "0", "--workspace", dir], {
          stdout: "pipe",
          stderr: "pipe",
        }),
      );
      const outs = await Promise.all(procs.map((p) => new Response(p.stdout).text()));
      const codes = await Promise.all(procs.map((p) => p.exited));
      const claimed = outs.filter((o) => o.includes("CLAIMED")).length;
      const collided = outs.filter((o) => o.includes("COLLISION")).length;
      const zero = codes.filter((c) => c === 0).length;
      const two = codes.filter((c) => c === 2).length;
      // Exactly one winner across every round — zero double-claims.
      expect(claimed).toBe(1);
      expect(zero).toBe(1);
      expect(collided).toBe(N - 1);
      expect(two).toBe(N - 1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}, 60000);
