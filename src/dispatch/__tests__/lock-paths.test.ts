import { expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordAuthorization, recordDispatch, startJourney } from "../../journey/ledger";
import { claimLock, lockPath, readLock, releaseLock } from "../lock";

async function ws(): Promise<string> {
  return mkdtemp(join(tmpdir(), "aipe-lockpath-"));
}

async function dispatched(dir: string, journey: string, repo: string, task?: string): Promise<void> {
  await startJourney(dir, journey);
  await recordDispatch(dir, journey, {
    repo,
    ...(task ? { task } : {}),
    specialist: "X",
    branch: "b",
    worktree: "w",
    status: "dispatched",
  });
}

// ── Path-disjoint claims coexist; overlapping claims serialize ────────────────

test("two writing claims on DISJOINT paths in one repo BOTH win", async () => {
  const dir = await ws();
  try {
    const a = await claimLock(dir, {
      repo: "aipe", journey: "j1", specialist: "Jesse", task: "lock", paths: ["src/dispatch"], pid: 0,
    });
    const b = await claimLock(dir, {
      repo: "aipe", journey: "j1", specialist: "Jesse", task: "serve", paths: ["src/serve"], pid: 0,
    });
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    // two distinct lock files on disk, both live
    expect(await readLock(lockPath(dir, "aipe", undefined, "lock"))).not.toBeNull();
    expect(await readLock(lockPath(dir, "aipe", undefined, "serve"))).not.toBeNull();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("two writing claims on OVERLAPPING paths serialize — one wins, one collides", async () => {
  const dir = await ws();
  try {
    await dispatched(dir, "j1", "aipe", "a");
    const a = await claimLock(dir, {
      repo: "aipe", journey: "j1", specialist: "Jesse", task: "a", paths: ["src/dispatch"], pid: 0,
    });
    expect(a.ok).toBe(true);
    // b overlaps a (src/dispatch/lock.ts is under src/dispatch)
    const b = await claimLock(dir, {
      repo: "aipe", journey: "j2", specialist: "Walt", task: "b", paths: ["src/dispatch/lock.ts"], pid: 0,
    });
    expect(b.ok).toBe(false);
    if (!b.ok) {
      expect(b.reason).toBe("collision");
      if (b.reason === "collision") {
        expect(b.holder.journey).toBe("j1");
        expect(b.overlaps).toEqual([["src/dispatch/lock.ts", "src/dispatch"]]);
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a WHOLE writing claim (no paths) collides with an existing path claim — the reverse hole", async () => {
  const dir = await ws();
  try {
    await dispatched(dir, "j1", "aipe", "a");
    const a = await claimLock(dir, {
      repo: "aipe", journey: "j1", specialist: "Jesse", task: "a", paths: ["src/dispatch"], pid: 0,
    });
    expect(a.ok).toBe(true);
    // b declares NO paths (empty array = whole unit) → overlaps everything
    const b = await claimLock(dir, {
      repo: "aipe", journey: "j2", specialist: "Walt", task: "b", paths: [], pid: 0,
    });
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.reason).toBe("collision");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a non-writing (legacy) lock does not collide with a writer on the same path", async () => {
  const dir = await ws();
  try {
    // legacy task-split lock (no paths ⇒ writes:false, a QA reviewing) over the unit
    const qa = await claimLock(dir, { repo: "aipe", journey: "j1", specialist: "Marina", task: "gate", pid: 0 });
    expect(qa.ok).toBe(true);
    // a writer declaring a path in the same repo must NOT be blocked by the QA lock
    const dev = await claimLock(dir, {
      repo: "aipe", journey: "j1", specialist: "Jesse", task: "feat", paths: ["src/dispatch/lock.ts"], pid: 0,
    });
    expect(dev.ok).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("releasing one path claim by (repo,task) leaves a disjoint sibling untouched", async () => {
  const dir = await ws();
  try {
    await claimLock(dir, { repo: "aipe", journey: "j1", specialist: "Jesse", task: "lock", paths: ["src/dispatch"], pid: 0 });
    await claimLock(dir, { repo: "aipe", journey: "j1", specialist: "Jesse", task: "serve", paths: ["src/serve"], pid: 0 });
    const rel = await releaseLock(dir, "aipe", { journey: "j1", task: "lock", paths: ["src/dispatch"] });
    expect(rel.ok).toBe(true);
    if (rel.ok) expect(rel.released).toBe(true);
    expect(await readLock(lockPath(dir, "aipe", undefined, "lock"))).toBeNull();
    expect(await readLock(lockPath(dir, "aipe", undefined, "serve"))).not.toBeNull();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("--force over an overlapping active path claim needs a recorded authorization", async () => {
  const dir = await ws();
  try {
    await dispatched(dir, "j1", "aipe", "a");
    await claimLock(dir, { repo: "aipe", journey: "j1", specialist: "Jesse", task: "a", paths: ["src/dispatch"], pid: 0 });
    // unauthorized force → refused
    const noAuth = await claimLock(dir, {
      repo: "aipe", journey: "j2", specialist: "Walt", task: "b", paths: ["src/dispatch/lock.ts"], force: true, pid: 0,
    });
    expect(noAuth.ok).toBe(false);
    if (!noAuth.ok) expect(noAuth.reason).toBe("unauthorized-force");
    // grant + force → overrides
    await recordAuthorization(dir, "j2", { grantedBy: "PE", forceClaim: "aipe" });
    const forced = await claimLock(dir, {
      repo: "aipe", journey: "j2", specialist: "Walt", task: "b", paths: ["src/dispatch/lock.ts"], force: true, pid: 0,
    });
    expect(forced.ok).toBe(true);
    if (forced.ok) expect(forced.forced).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ── Multi-process race: the acceptance guarantee ─────────────────────────────
// The overlap check + write must be one serialized critical section ACROSS
// processes. If it is not, two overlapping claims can both "win" and two agents
// write the same path at once — the exact silent hole this journey closes.

test("multi-process race on OVERLAPPING paths: exactly one CLAIMED", async () => {
  const cli = join(import.meta.dir, "..", "cli.ts");
  const N = 6;
  const ROUNDS = 4;
  for (let round = 0; round < ROUNDS; round++) {
    const dir = await ws();
    try {
      // Every claimant declares the SAME overlapping path but a distinct task
      // (distinct identity). Only one may hold it at a time.
      const procs = Array.from({ length: N }, (_, i) =>
        Bun.spawn(
          ["bun", cli, "claim", "aipe", "--journey", `j${i}`, "--specialist", `dev${i}`,
            "--task", `t${i}`, "--path", "src/dispatch/lock.ts", "--pid", "0", "--workspace", dir],
          { stdout: "pipe", stderr: "pipe" },
        ),
      );
      const outs = await Promise.all(procs.map((p) => new Response(p.stdout).text()));
      await Promise.all(procs.map((p) => p.exited));
      const claimed = outs.filter((o) => o.includes("CLAIMED")).length;
      const collided = outs.filter((o) => o.includes("COLLISION")).length;
      expect(claimed).toBe(1);
      expect(collided).toBe(N - 1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}, 60000);

test("multi-process race on DISJOINT paths: all CLAIMED (parallelism proven)", async () => {
  const cli = join(import.meta.dir, "..", "cli.ts");
  const N = 6;
  const dir = await ws();
  try {
    const procs = Array.from({ length: N }, (_, i) =>
      Bun.spawn(
        ["bun", cli, "claim", "aipe", "--journey", `j${i}`, "--specialist", `dev${i}`,
          "--task", `t${i}`, "--path", `src/mod${i}`, "--pid", "0", "--workspace", dir],
        { stdout: "pipe", stderr: "pipe" },
      ),
    );
    const outs = await Promise.all(procs.map((p) => new Response(p.stdout).text()));
    await Promise.all(procs.map((p) => p.exited));
    const claimed = outs.filter((o) => o.includes("CLAIMED")).length;
    expect(claimed).toBe(N);
    // N distinct lock files landed
    const files = (await readdir(join(dir, ".aipe", "locks"))).filter((f) => f.endsWith(".lock"));
    expect(files.length).toBe(N);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 60000);
