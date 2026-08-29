import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordDispatch, startJourney } from "../../journey/ledger";
import { detectTouchedPaths, type GitRunner } from "../detect";
import { claimLock, readLock, lockPath, reconcileLockPaths } from "../lock";
import { planOverlapResolution } from "../resolution";

async function ws(): Promise<string> {
  return mkdtemp(join(tmpdir(), "aipe-reconcile-"));
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

// ── detection (git, injectable runner) ───────────────────────────────────────

test("detectTouchedPaths unions committed diff and uncommitted status, dedupes, sorts", async () => {
  const git: GitRunner = async (args) => {
    if (args[0] === "diff") return { stdout: "src/dispatch/lock.ts\nsrc/dispatch/law.ts\n", code: 0 };
    if (args[0] === "status") return { stdout: " M src/dispatch/law.ts\n?? src/dispatch/new.ts\n", code: 0 };
    return { stdout: "", code: 1 };
  };
  const paths = await detectTouchedPaths("/wt", { git });
  expect(paths).toEqual(["src/dispatch/law.ts", "src/dispatch/lock.ts", "src/dispatch/new.ts"]);
});

test("detectTouchedPaths records both endpoints of a rename", async () => {
  const git: GitRunner = async (args) => {
    if (args[0] === "diff") return { stdout: "", code: 0 };
    if (args[0] === "status") return { stdout: "R  src/old.ts -> src/new.ts\n", code: 0 };
    return { stdout: "", code: 1 };
  };
  const paths = await detectTouchedPaths("/wt", { git });
  expect(paths).toEqual(["src/new.ts", "src/old.ts"]);
});

// ── reconciliation ───────────────────────────────────────────────────────────

test("reconcile rewrites the lock's paths to what the branch actually touched, and reports drift", async () => {
  const dir = await ws();
  try {
    // declared 2 files, but the branch grew to touch a third (the field case)
    await claimLock(dir, {
      repo: "aipe", journey: "j1", specialist: "Jesse", task: "feat",
      paths: ["src/a.ts", "src/b.ts"], pid: 0,
    });
    const r = await reconcileLockPaths(dir, {
      repo: "aipe", journey: "j1", task: "feat",
      actual: ["src/a.ts", "src/b.ts", "src/c.ts"],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.paths).toContain("src/c.ts");
      expect(r.drift).toEqual(["src/c.ts"]); // c was not in the original declaration
      expect(r.overlaps.length).toBe(0);
    }
    const lock = await readLock(lockPath(dir, "aipe", undefined, "feat"));
    expect(lock?.paths).toContain("src/c.ts");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("reconcile surfaces a DRIFT overlap: a claim that grew into another live claim's path", async () => {
  const dir = await ws();
  try {
    await dispatched(dir, "j1", "aipe", "hold");
    await dispatched(dir, "j2", "aipe", "grow");
    // holder owns src/serve
    await claimLock(dir, { repo: "aipe", journey: "j1", specialist: "Ann", task: "hold", paths: ["src/serve"], pid: 0 });
    // grower declared src/dispatch (disjoint) — coexists fine at claim time
    const grow = await claimLock(dir, { repo: "aipe", journey: "j2", specialist: "Bob", task: "grow", paths: ["src/dispatch"], pid: 0 });
    expect(grow.ok).toBe(true);
    // but the branch actually touched a file under src/serve → drift into the holder
    const r = await reconcileLockPaths(dir, {
      repo: "aipe", journey: "j2", task: "grow",
      actual: ["src/dispatch/law.ts", "src/serve/server.ts"],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.overlaps.length).toBe(1);
      expect(r.overlaps[0]!.holder.journey).toBe("j1");
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("reconcile refuses a foreign lock and no-ops a missing one", async () => {
  const dir = await ws();
  try {
    await claimLock(dir, { repo: "aipe", journey: "j1", specialist: "Jesse", task: "feat", paths: ["src/a"], pid: 0 });
    const foreign = await reconcileLockPaths(dir, { repo: "aipe", journey: "other", task: "feat", actual: ["src/a"] });
    expect(foreign.ok).toBe(false);
    if (!foreign.ok) expect(foreign.reason).toBe("foreign");
    const missing = await reconcileLockPaths(dir, { repo: "aipe", journey: "j1", task: "nope", actual: ["src/a"] });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.reason).toBe("no-lock");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ── managed exception plan ───────────────────────────────────────────────────

test("planOverlapResolution yields the ordered recovery: wait → rebase → resolve → review-over-merge", () => {
  const plan = planOverlapResolution({
    waiterBranch: "aipe/j2/bob",
    holderBranch: "aipe/j1/ann",
    paths: ["src/serve"],
  });
  expect(plan.waiter).toBe("aipe/j2/bob");
  expect(plan.onto).toBe("aipe/j1/ann");
  expect(plan.steps.map((s) => s.action)).toEqual(["wait", "rebase", "resolve", "review-over-merge"]);
  // the rebase step names the actual holder branch to rebase onto
  expect(plan.steps[1]!.detail).toContain("aipe/j1/ann");
  // the review step insists the review runs over the merged result
  expect(plan.steps[3]!.detail.toLowerCase()).toContain("rebased result");
});
