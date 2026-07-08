import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordDispatch, startJourney } from "../../journey/ledger";
import { claimLock, isPidAlive, lockKey, lockPath, readLock, releaseLock } from "../lock";

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

test("collision against an ACTIVE lock, then --force overrides", async () => {
  const dir = await ws();
  try {
    await dispatched(dir, "j1", "embark");
    await dispatched(dir, "j2", "embark");
    const first = await claimLock(dir, { repo: "embark", journey: "j1", specialist: "A" });
    expect(first.ok).toBe(true);

    const collide = await claimLock(dir, { repo: "embark", journey: "j2", specialist: "B" });
    expect(collide.ok).toBe(false);
    if (!collide.ok) expect(collide.holder.journey).toBe("j1");

    const forced = await claimLock(dir, { repo: "embark", journey: "j2", specialist: "B", force: true });
    expect(forced.ok).toBe(true);
    expect((await readLock(lockPath(dir, "embark")))?.journey).toBe("j2");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("orphan lock (no 'dispatched' dispatch) is reconciled/overwritten", async () => {
  const dir = await ws();
  try {
    // j1 claims but nothing is 'dispatched' for embark → lock is stale/orphan.
    const first = await claimLock(dir, { repo: "embark", journey: "j1", specialist: "A" });
    expect(first.ok).toBe(true);
    // j2 comes along; since the incumbent isn't backed by a dispatched dispatch,
    // it is overwritable → reconciled takeover, not a collision.
    const second = await claimLock(dir, { repo: "embark", journey: "j2", specialist: "B" });
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.reconciled).toBe(true);
    expect((await readLock(lockPath(dir, "embark")))?.journey).toBe("j2");
  } finally {
    await rm(dir, { recursive: true, force: true });
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
