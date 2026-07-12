import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readLedger, recordDispatch, recordDispatchGuarded, startJourney } from "../ledger";
import type { DispatchEvidence, JourneyDispatch } from "../types";

async function ws(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "aipe-gate-"));
  await startJourney(dir, "j1");
  return dir;
}

const base: JourneyDispatch = { repo: "embark", specialist: "Joaquim", branch: "b", worktree: "w", status: "dispatched" };
const evidence: DispatchEvidence = { by: "dev", commands: ["bun test"], summary: "42 pass, 0 fail" };

test("dispatched needs no evidence and is recorded", async () => {
  const dir = await ws();
  try {
    const r = await recordDispatchGuarded(dir, "j1", base);
    expect(r.ok).toBe(true);
    expect((await readLedger(dir, "j1"))!.dispatches[0]!.status).toBe("dispatched");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("delivered WITHOUT evidence is rejected (verify-before-done)", async () => {
  const dir = await ws();
  try {
    const r = await recordDispatchGuarded(dir, "j1", { ...base, status: "delivered", pr: "http://pr/1" });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("evidence-required");
    // nothing written
    expect((await readLedger(dir, "j1"))!.dispatches).toHaveLength(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("delivered WITH evidence is recorded", async () => {
  const dir = await ws();
  try {
    const r = await recordDispatchGuarded(dir, "j1", { ...base, status: "delivered", pr: "http://pr/1", evidence });
    expect(r.ok).toBe(true);
    const d = (await readLedger(dir, "j1"))!.dispatches[0]!;
    expect(d.status).toBe("delivered");
    expect(d.evidence?.summary).toBe("42 pass, 0 fail");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("verified requires QA evidence; empty summary is not proof", async () => {
  const dir = await ws();
  try {
    const bad = await recordDispatchGuarded(dir, "j1", { ...base, status: "verified", evidence: { by: "qa", commands: ["bun test"], summary: "  " } });
    expect(bad.ok).toBe(false);
    expect(bad.code).toBe("evidence-required");
    const good = await recordDispatchGuarded(dir, "j1", { ...base, status: "verified", evidence: { by: "qa", commands: ["bun test", "drove the app"], summary: "checkout works end to end" } });
    expect(good.ok).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a merged unit is immutable — never re-recorded", async () => {
  const dir = await ws();
  try {
    // reconcile-style raw write to reach merged
    await recordDispatch(dir, "j1", { ...base, status: "merged", pr: "http://pr/1" });
    const r = await recordDispatchGuarded(dir, "j1", { ...base, status: "dispatched" });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("unit-immutable");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("re-dispatching a delivered unit needs a reason; with one it records the reason", async () => {
  const dir = await ws();
  try {
    await recordDispatchGuarded(dir, "j1", { ...base, status: "delivered", pr: "http://pr/1", evidence });
    const noReason = await recordDispatchGuarded(dir, "j1", { ...base, status: "dispatched" });
    expect(noReason.ok).toBe(false);
    expect(noReason.code).toBe("redispatch-needs-reason");

    const withReason = await recordDispatchGuarded(dir, "j1", { ...base, status: "dispatched" }, { reason: "QA found a regression in totals" });
    expect(withReason.ok).toBe(true);
    const d = (await readLedger(dir, "j1"))!.dispatches.find((x) => x.status === "dispatched")!;
    expect(d.redispatchReason).toBe("QA found a regression in totals");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a failed QA verdict needs no evidence gate (it is not a done-claim)", async () => {
  const dir = await ws();
  try {
    await recordDispatchGuarded(dir, "j1", { ...base, status: "delivered", pr: "http://pr/1", evidence });
    const r = await recordDispatchGuarded(dir, "j1", { ...base, status: "failed" });
    expect(r.ok).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
