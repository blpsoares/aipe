// #72 — the reviewer and the builder are different people, in BOTH directions.
//
// The ledger already refused a specialist verifying a delivery it made. This is
// the mirror: a specialist delivering on a task where it already sat as the QA.
// Shipping one half and not the other is the defect this repo keeps paying for —
// fix one member of a family, leave the siblings — and it is why the rule, which
// existed in prose in the review-delivery skill, was violated THREE TIMES IN ONE
// DAY (Donald #252, Chuck #4, Viola #25).
//
// From the issue, in one line: if the QA fixes what it reviewed, nobody reviewed
// the fix, and the gate stops being a gate.
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readLedger, recordDispatchGuarded, startJourney } from "../ledger";
import type { DispatchEvidence, JourneyDispatch } from "../types";

async function ws(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "aipe-72-"));
  await startJourney(dir, "j1");
  return dir;
}

const DEV: JourneyDispatch = { repo: "aipe", specialist: "Jesse", branch: "b", worktree: "/wt", status: "dispatched" };
const QA: JourneyDispatch = { repo: "aipe", specialist: "Getz", branch: "bq", worktree: "/wq", status: "dispatched" };
const devEv: DispatchEvidence = { by: "dev", commands: ["bun test"], summary: "green" };
const qaEv: DispatchEvidence = { by: "qa", commands: ["drove it"], summary: "checked" };

test("the QA that REJECTED a task cannot then deliver the fix", async () => {
  const dir = await ws();
  try {
    await recordDispatchGuarded(dir, "j1", { ...DEV, status: "delivered", evidence: devEv });
    const failed = await recordDispatchGuarded(dir, "j1", { ...QA, status: "failed", evidence: qaEv });
    expect(failed.ok).toBe(true);

    // Getz reviewed it, Getz now tries to build the fix — the exact three
    // real violations this gate exists for.
    const r = await recordDispatchGuarded(dir, "j1", { ...QA, status: "delivered", evidence: devEv });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("reviewer-cannot-build");
    expect(r.message).toContain("nobody reviewed the fix");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("the QA that APPROVED a task cannot then deliver on it either", async () => {
  const dir = await ws();
  try {
    await recordDispatchGuarded(dir, "j1", { ...DEV, status: "delivered", evidence: devEv });
    await recordDispatchGuarded(dir, "j1", { ...QA, status: "verified", evidence: qaEv });
    const r = await recordDispatchGuarded(dir, "j1", { ...QA, status: "delivered", evidence: devEv });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("reviewer-cannot-build");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("case-only difference in the name does not slip past it", async () => {
  const dir = await ws();
  try {
    await recordDispatchGuarded(dir, "j1", { ...DEV, status: "delivered", evidence: devEv });
    await recordDispatchGuarded(dir, "j1", { ...QA, status: "failed", evidence: qaEv });
    const r = await recordDispatchGuarded(dir, "j1", { ...QA, specialist: "getz", status: "delivered", evidence: devEv });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("reviewer-cannot-build");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("a BUILDER who delivered and was rejected may deliver the fix — that is the fix loop", async () => {
  const dir = await ws();
  try {
    await recordDispatchGuarded(dir, "j1", { ...DEV, status: "delivered", evidence: devEv });
    await recordDispatchGuarded(dir, "j1", { ...QA, status: "failed", evidence: qaEv });
    await recordDispatchGuarded(dir, "j1", { ...DEV, status: "dispatched" }, { reason: "QA rejected it" });
    const r = await recordDispatchGuarded(dir, "j1", { ...DEV, status: "delivered", evidence: devEv });
    expect(r.ok).toBe(true); // the gate must not break the loop it exists to protect
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("the same person may review one task and BUILD a different one on the same unit", async () => {
  const dir = await ws();
  try {
    // reviewed task "a"…
    await recordDispatchGuarded(dir, "j1", { ...DEV, task: "a", status: "delivered", evidence: devEv });
    await recordDispatchGuarded(dir, "j1", { ...QA, task: "a", status: "failed", evidence: qaEv });
    // …builds task "b". Different work, nothing reviewed by its own author.
    const r = await recordDispatchGuarded(dir, "j1", { ...QA, task: "b", status: "delivered", evidence: devEv });
    expect(r.ok).toBe(true);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("a verdict filed as the DEV's own word does not brand that person a reviewer", async () => {
  const dir = await ws();
  try {
    // `failed` recorded with dev-authored evidence is a builder reporting its own
    // failure, not a review. Judged on the evidence's authorship — the ledger's
    // record of who filed it — never on a name or a roster role.
    await recordDispatchGuarded(dir, "j1", { ...DEV, status: "delivered", evidence: devEv });
    await recordDispatchGuarded(dir, "j1", { ...DEV, status: "failed", evidence: devEv });
    await recordDispatchGuarded(dir, "j1", { ...DEV, status: "dispatched" }, { reason: "retry" });
    const r = await recordDispatchGuarded(dir, "j1", { ...DEV, status: "delivered", evidence: devEv });
    expect(r.ok).toBe(true);
    expect((await readLedger(dir, "j1"))!.dispatches.length).toBeGreaterThan(0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
