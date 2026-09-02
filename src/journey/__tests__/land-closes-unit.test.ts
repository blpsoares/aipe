// #97 — landing a unit closes ALL of its records.
//
// The merge is a fact about the UNIT: that code is in the base branch. The dev's
// row got `merged`; every other row of the same unit — the QA gate and each of
// its re-gates (`gate-pr51`, `-r2`, `-r3`) — stayed `dispatched` or `failed`
// forever, because nothing ever said they were over.
//
// Measured: the "precisa de você" queue reached 25 entries, 20 of them junk —
// QA records stuck open for PRs that had already merged. The PE saw it and said
// "tem 25 needs you wtf, ta completamente bizarro isso". It refilled afterwards.
// A queue that re-presents finished work stops being read, and then it stops
// protecting the case that matters.
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readLedger, recordDispatch, recordDispatchGuarded, startJourney } from "../ledger";
import { assemble } from "../../status/assemble";
import type { DispatchEvidence, JourneyDispatch } from "../types";

async function ws(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "aipe-97-"));
  await startJourney(dir, "j1");
  return dir;
}

const devEv: DispatchEvidence = { by: "dev", commands: ["bun test"], summary: "green" };
const qaEv: DispatchEvidence = { by: "qa", commands: ["drove it"], summary: "checked" };
const DEV: JourneyDispatch = { repo: "aipe", specialist: "Jesse", branch: "b", worktree: "/wt", status: "dispatched" };

test("landing closes the QA's gate row — and every RE-gate of the same unit", async () => {
  const dir = await ws();
  try {
    await recordDispatch(dir, "j1", { ...DEV, task: "impl", status: "delivered", pr: "http://pr/51", evidence: devEv });
    // the shape the issue names: one gate per round, none of them ever closed
    for (const t of ["gate-pr51", "gate-pr51-r2", "gate-pr51-r3"]) {
      await recordDispatch(dir, "j1", { ...DEV, specialist: "Getz", task: t, branch: "bq", worktree: "/wq", status: "failed", evidence: qaEv });
    }
    await recordDispatch(dir, "j1", { ...DEV, task: "impl", status: "merged", pr: "http://pr/51" });

    const rows = (await readLedger(dir, "j1"))!.dispatches;
    expect(rows.filter((d) => d.status === "closed")).toHaveLength(3);
    expect(rows.find((d) => d.task === "impl")!.status).toBe("merged");
    // each closure says WHICH landing closed it — a terminal record that does
    // not say why is the silence this replaces
    for (const d of rows.filter((r) => r.status === "closed")) {
      expect(d.closedReason).toContain("http://pr/51");
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("the merged row is never written onto the QA's line — that row merged nothing", async () => {
  const dir = await ws();
  try {
    await recordDispatch(dir, "j1", { ...DEV, status: "delivered", pr: "http://pr/9", evidence: devEv });
    await recordDispatch(dir, "j1", { ...DEV, specialist: "Getz", branch: "bq", worktree: "/wq", status: "verified", evidence: qaEv });
    await recordDispatch(dir, "j1", { ...DEV, status: "merged", pr: "http://pr/9" });

    const getz = (await readLedger(dir, "j1"))!.dispatches.find((d) => d.specialist === "Getz")!;
    expect(getz.status).toBe("closed");
    expect(getz.status).not.toBe("merged"); // a convenient falsehood in a ledger whose job is being true
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("LIVE work on the same unit is never closed — that would delete an assignment", async () => {
  const dir = await ws();
  try {
    await recordDispatch(dir, "j1", { ...DEV, task: "a", status: "delivered", pr: "http://pr/1", evidence: devEv });
    // someone is working right now, and someone else is owed an answer
    await recordDispatch(dir, "j1", { ...DEV, specialist: "Walter", task: "b", branch: "bw", worktree: "/ww", status: "dispatched" });
    await recordDispatch(dir, "j1", { ...DEV, specialist: "Omar", task: "c", branch: "bo", worktree: "/wo", status: "blocked", blockedReason: "preciso de uma decisão" });
    await recordDispatch(dir, "j1", { ...DEV, task: "a", status: "merged", pr: "http://pr/1" });

    const rows = (await readLedger(dir, "j1"))!.dispatches;
    expect(rows.find((d) => d.specialist === "Walter")!.status).toBe("dispatched");
    expect(rows.find((d) => d.specialist === "Omar")!.status).toBe("blocked");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("a DIFFERENT unit is untouched — the merge is a fact about one unit", async () => {
  const dir = await ws();
  try {
    await recordDispatch(dir, "j1", { ...DEV, package: "serve", status: "delivered", pr: "http://pr/2", evidence: devEv });
    await recordDispatch(dir, "j1", { ...DEV, package: "architecture", specialist: "Omar", branch: "bo", worktree: "/wo", status: "failed", evidence: qaEv });
    await recordDispatch(dir, "j1", { ...DEV, package: "serve", status: "merged", pr: "http://pr/2" });

    const other = (await readLedger(dir, "j1"))!.dispatches.find((d) => d.package === "architecture")!;
    expect(other.status).toBe("failed");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("THE MEASURED SYMPTOM: the queue empties when the unit lands", async () => {
  const dir = await ws();
  try {
    await recordDispatch(dir, "j1", { ...DEV, task: "impl", status: "delivered", pr: "http://pr/7", evidence: devEv });
    // three stale QA rows with no evidence — exactly what filled the queue
    for (const t of ["gate", "gate-r2", "gate-r3"]) {
      await recordDispatch(dir, "j1", { ...DEV, specialist: "Getz", task: t, branch: "bq", worktree: "/wq", status: "verified" });
    }
    const base = {
      workspace: dir, contextName: "c", scope: "all" as const,
      pref: { auto: false, format: "detailed" as const }, roster: [],
      policy: { authorizationTiers: [] },
      live: { sessions: [], reliable: false, source: "none" as const },
      releaseStates: new Map(),
    };
    const before = assemble({ ...base, ledgers: [(await readLedger(dir, "j1"))!] } as never).waiting;
    expect(before.length).toBeGreaterThan(0);

    await recordDispatch(dir, "j1", { ...DEV, task: "impl", status: "merged", pr: "http://pr/7" });
    const after = assemble({ ...base, ledgers: [(await readLedger(dir, "j1"))!] } as never).waiting;
    expect(after).toHaveLength(0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("a hand-written `closed` needs its reason — a terminal record always says why", async () => {
  const dir = await ws();
  try {
    const r = await recordDispatchGuarded(dir, "j1", { ...DEV, status: "closed" });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("closed-needs-reason");
    const ok = await recordDispatchGuarded(dir, "j1", { ...DEV, status: "closed" }, { reason: "j-2026 assumiu o trabalho" });
    expect(ok.ok).toBe(true);
    expect((await readLedger(dir, "j1"))!.dispatches[0]!.closedReason).toBe("j-2026 assumiu o trabalho");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

// THE PATH THAT ACTUALLY RUNS. The cascade first went into `recordDispatch`
// only — and `journey reconcile`, which learns the merge from the forge, writes
// with `writeLedger` directly and skipped it entirely. Driving the real command
// caught it; the unit tests above all passed while the forge path did nothing.
// It is the same "the rule holds only where a human types it" shape this file
// exists to close, reproduced inside its own fix.
test("the FORGE path closes the unit too — reconcile, not just the guarded write", async () => {
  const { reconcileJourney } = await import("../reconcile");
  const dir = await ws();
  try {
    await recordDispatch(dir, "j1", { ...DEV, status: "delivered", pr: "http://pr/51", evidence: devEv });
    await recordDispatch(dir, "j1", { ...DEV, specialist: "Getz", branch: "bq", worktree: "/wq", status: "verified", evidence: qaEv });
    await recordDispatch(dir, "j1", { ...DEV, specialist: "Oakley", task: "gate-r2", branch: "bo", worktree: "/wo", status: "failed", evidence: qaEv });
    // live work on the same unit — must survive
    await recordDispatch(dir, "j1", { ...DEV, specialist: "Mike", task: "outra", branch: "bm", worktree: "/wm", status: "dispatched" });

    await reconcileJourney(dir, "j1", async () => "MERGED", []);

    const rows = (await readLedger(dir, "j1"))!.dispatches;
    expect(rows.find((d) => d.specialist === "Jesse")!.status).toBe("merged");
    expect(rows.find((d) => d.specialist === "Getz")!.status).toBe("closed");
    expect(rows.find((d) => d.specialist === "Oakley")!.status).toBe("closed");
    expect(rows.find((d) => d.specialist === "Mike")!.status).toBe("dispatched");
  } finally { await rm(dir, { recursive: true, force: true }); }
});
