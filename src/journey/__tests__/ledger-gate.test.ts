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

// ── redirected: --reason is required and persisted as redirectReason ──────
// (the gap this branch closes: the status existed and `collect` reported it,
// but the reason a PE gave live was accepted and silently dropped.)

test("redirected WITHOUT --reason is rejected — a redirect that records nothing useful is close to no record at all", async () => {
  const dir = await ws();
  try {
    const r = await recordDispatchGuarded(dir, "j1", { ...base, status: "redirected" });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("redirect-needs-reason");
    expect((await readLedger(dir, "j1"))!.dispatches).toHaveLength(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("redirected with a whitespace-only --reason is also rejected", async () => {
  const dir = await ws();
  try {
    const r = await recordDispatchGuarded(dir, "j1", { ...base, status: "redirected" }, { reason: "   " });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("redirect-needs-reason");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("redirected WITH --reason is recorded, needs no evidence, and is not immutable", async () => {
  const dir = await ws();
  try {
    const r = await recordDispatchGuarded(dir, "j1", { ...base, status: "redirected" }, { reason: "  use Stripe instead  " });
    expect(r.ok).toBe(true);
    const d = (await readLedger(dir, "j1"))!.dispatches[0]!;
    expect(d.status).toBe("redirected");
    // trimmed, exactly — not merely "contains"
    expect(d.redirectReason).toBe("use Stripe instead");
    expect(d.evidence).toBeUndefined();

    // a second write to the SAME unit (e.g. moving it back to dispatched to
    // continue the new direction) must not be blocked by immutability —
    // `redirected` is not in IMMUTABLE_STATUSES.
    const again = await recordDispatchGuarded(dir, "j1", { ...base, status: "dispatched" });
    expect(again.ok).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("redirected does not collide with redispatchReason — writing one never populates the other", async () => {
  const dir = await ws();
  try {
    // a redirected write sets redirectReason, and ONLY redirectReason.
    const redirected = await recordDispatchGuarded(dir, "j1", { ...base, status: "redirected" }, { reason: "PE wants Stripe now" });
    expect(redirected.ok).toBe(true);
    const afterRedirect = (await readLedger(dir, "j1"))!.dispatches[0]!;
    expect(afterRedirect.redirectReason).toBe("PE wants Stripe now");
    expect(afterRedirect.redispatchReason).toBeUndefined();

    // a genuine reopening (delivered/verified → dispatched) write sets
    // redispatchReason, and ONLY redispatchReason — the earlier redirectReason
    // is not carried forward by this unrelated write (recordDispatch replaces
    // the unit's record wholesale) nor does the reopening path ever write it.
    await recordDispatchGuarded(dir, "j1", { ...base, status: "delivered", pr: "http://pr/1", evidence });
    const reopened = await recordDispatchGuarded(dir, "j1", { ...base, status: "dispatched" }, { reason: "fix loop after QA rejection" });
    expect(reopened.ok).toBe(true);
    const afterReopen = (await readLedger(dir, "j1"))!.dispatches.find((x) => x.status === "dispatched")!;
    expect(afterReopen.redispatchReason).toBe("fix loop after QA rejection");
    expect(afterReopen.redirectReason).toBeUndefined();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("blocked WITHOUT a reason is rejected — the signal is worthless without what it needs", async () => {
  const dir = await ws();
  try {
    const r = await recordDispatchGuarded(dir, "j1", { ...base, status: "blocked" });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("blocked-needs-reason");
    expect((await readLedger(dir, "j1"))!.dispatches).toHaveLength(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("blocked WITH a reason is recorded and stores blockedReason (distinct from escalated/redirected)", async () => {
  const dir = await ws();
  try {
    const r = await recordDispatchGuarded(dir, "j1", { ...base, status: "blocked", mode: "session", sessionId: "s-1" }, { reason: "need the staging DB url" });
    expect(r.ok).toBe(true);
    const rec = (await readLedger(dir, "j1"))!.dispatches[0]!;
    expect(rec.status).toBe("blocked");
    expect(rec.blockedReason).toBe("need the staging DB url");
    // blockedReason is a per-transition annotation, not a redirect/redispatch reason
    expect(rec.redirectReason).toBeUndefined();
    expect(rec.redispatchReason).toBeUndefined();
    // …and it does not leak onto a later write that omits it
    await recordDispatchGuarded(dir, "j1", { ...base, status: "delivered", pr: "http://pr/1", evidence });
    const later = (await readLedger(dir, "j1"))!.dispatches[0]!;
    expect(later.status).toBe("delivered");
    expect(later.blockedReason).toBeUndefined();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
