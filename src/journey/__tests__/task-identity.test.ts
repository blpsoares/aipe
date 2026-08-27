// Identity-per-task at the ledger layer (j-20260826-uv): the addressable thing
// is `Persona · task`, so two concurrent tasks sharing a unit are distinct
// records with independent gates — while the fix-loop protection (re-dispatch of
// the SAME task needs a reason; a merged task stays immutable) holds per task.
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readLedger, recordDispatch, recordDispatchGuarded, startJourney } from "../ledger";
import type { DispatchEvidence, JourneyDispatch } from "../types";

async function ws(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "aipe-task-"));
  await startJourney(dir, "j1");
  return dir;
}

const qaEv: DispatchEvidence = { by: "qa", commands: ["bun test", "drove the PR"], summary: "gate passed" };
const base: JourneyDispatch = { repo: "aipe", specialist: "Mike", branch: "b", worktree: "w", status: "dispatched" };

test("recordDispatch keys on task: two tasks of one persona on one unit are SEPARATE rows", async () => {
  const dir = await ws();
  try {
    await recordDispatch(dir, "j1", { ...base, task: "gate-pr24", status: "verified", evidence: qaEv });
    await recordDispatch(dir, "j1", { ...base, task: "gate-pr23", status: "delivered", evidence: qaEv });
    const rows = (await readLedger(dir, "j1"))!.dispatches;
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.task === "gate-pr24")?.status).toBe("verified");
    expect(rows.find((r) => r.task === "gate-pr23")?.status).toBe("delivered");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a verified on one task does NOT overwrite another task's in-flight record", async () => {
  const dir = await ws();
  try {
    await recordDispatch(dir, "j1", { ...base, task: "gate-pr23", status: "dispatched" });
    // A verified lands for a DIFFERENT task on the same unit.
    await recordDispatch(dir, "j1", { ...base, task: "gate-pr24", status: "verified", evidence: qaEv });
    const rows = (await readLedger(dir, "j1"))!.dispatches;
    // The pr23 task is still dispatched — not cleared by pr24's verified.
    expect(rows.find((r) => r.task === "gate-pr23")?.status).toBe("dispatched");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// CASE 2 (coordinator field evidence, j-20260825-s2): a merged DEV task blocked
// reconciling a distinct QA task on the same unit, because immutability was keyed
// on the UNIT. It must be keyed on the TASK: the merged task stays immutable, a
// DIFFERENT task on the same unit is free.
test("CASE 2: a merged task does not make a DIFFERENT task on the same unit immutable", async () => {
  const dir = await ws();
  try {
    // Lawson merged the dev task of the unit.
    await recordDispatch(dir, "j1", { repo: "openvibes-embark", package: "aipe-site", specialist: "Lawson", task: "impl", branch: "b", worktree: "w", status: "merged", pr: "http://pr/15" });
    // Reconciling Viola's orphan QA task (a DIFFERENT task) must be ADMITTED.
    const r = await recordDispatchGuarded(dir, "j1", { repo: "openvibes-embark", package: "aipe-site", specialist: "Viola", task: "gate", branch: "b2", worktree: "w2", status: "removed" });
    expect(r.ok).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the SAME merged task stays immutable (fix-loop protection preserved)", async () => {
  const dir = await ws();
  try {
    await recordDispatch(dir, "j1", { repo: "openvibes-embark", package: "aipe-site", specialist: "Lawson", task: "impl", branch: "b", worktree: "w", status: "merged", pr: "http://pr/15" });
    const r = await recordDispatchGuarded(dir, "j1", { repo: "openvibes-embark", package: "aipe-site", specialist: "Lawson", task: "impl", branch: "b", worktree: "w", status: "delivered", evidence: qaEv, pr: "http://pr/15" });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("unit-immutable");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("re-dispatch of the SAME task still requires --reason; a DIFFERENT task does not", async () => {
  const dir = await ws();
  try {
    // Task "impl" delivered, then re-dispatched WITHOUT reason → rejected.
    await recordDispatch(dir, "j1", { ...base, specialist: "Jesse", task: "impl", status: "delivered", evidence: { by: "dev", commands: ["bun test"], summary: "ok" } });
    const noReason = await recordDispatchGuarded(dir, "j1", { ...base, specialist: "Jesse", task: "impl", status: "dispatched" });
    expect(noReason.ok).toBe(false);
    expect(noReason.code).toBe("redispatch-needs-reason");
    // A DIFFERENT task on the same unit dispatches freely (concurrency, no reason).
    const other = await recordDispatchGuarded(dir, "j1", { ...base, specialist: "Jesse", task: "impl-2", status: "dispatched" });
    expect(other.ok).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
