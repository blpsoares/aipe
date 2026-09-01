// THE QA CLOSURE — the four rules that together make this true by refusal:
// every finished task is tested by the QA, against the criteria in its approved
// Task Spec, and re-tested after a fix.
//
// What it replaces, measured: three features, six approved gates, three PE
// rejections of work that had already "passed". The QA was never the problem —
// they were different people, in different repos. The problem was that nothing
// obliged a verdict to exist, to be independent, to answer the spec's criteria
// one by one, or to be repeated after the code changed underneath it.
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readLedger, recordDispatchGuarded, startJourney } from "../ledger";
import type { DispatchEvidence, JourneyDispatch } from "../types";

async function ws(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "aipe-qa-closure-"));
  await startJourney(dir, "j1");
  return dir;
}

const DEV: JourneyDispatch = { repo: "aipe", specialist: "Jesse", branch: "b", worktree: "/wt", status: "dispatched" };
const QA: JourneyDispatch = { repo: "aipe", specialist: "Mike", task: "gate", branch: "bq", worktree: "/wq", status: "dispatched" };

const devEv: DispatchEvidence = { by: "dev", commands: ["bun test"], summary: "42 pass" };
const qaEv = (items?: DispatchEvidence["items"]): DispatchEvidence => ({
  by: "qa",
  commands: ["bun test"],
  summary: "checked",
  ...(items ? { items } : {}),
});

// The two criteria of an approved Task Spec for this unit.
const acceptance = async () => ["A1", "A2"];

test("a verified over NOTHING delivered is refused — a verdict judges a delivery", async () => {
  const dir = await ws();
  try {
    const r = await recordDispatchGuarded(dir, "j1", { ...QA, status: "verified", evidence: qaEv() });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("verify-needs-delivery");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("the BUILDER cannot verify its own delivery — the label `by: qa` is not independence", async () => {
  const dir = await ws();
  try {
    await recordDispatchGuarded(dir, "j1", { ...DEV, status: "delivered", evidence: devEv });
    // filed as "qa" — and still refused, because it is the same person
    const r = await recordDispatchGuarded(dir, "j1", { ...DEV, status: "verified", evidence: qaEv() });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("verify-needs-qa");
    expect(r.message).toContain("INDEPENDENT");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("a verified that skips a criterion is refused, naming it !NO-EVIDENCE", async () => {
  const dir = await ws();
  try {
    await recordDispatchGuarded(dir, "j1", { ...DEV, status: "delivered", evidence: devEv });
    const r = await recordDispatchGuarded(
      dir, "j1",
      { ...QA, status: "verified", evidence: qaEv([{ label: "A1", commands: ["drove the browser"], summary: "typed and saw output" }]) },
      { resolveAcceptance: acceptance },
    );
    expect(r.ok).toBe(false);
    expect(r.code).toBe("verification-incomplete");
    expect(r.message).toContain("!NO-EVIDENCE A2");
    expect(r.message).not.toContain("!NO-EVIDENCE A1");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("a blanket summary does NOT cover the criteria — that is the proxy this refuses", async () => {
  const dir = await ws();
  try {
    await recordDispatchGuarded(dir, "j1", { ...DEV, status: "delivered", evidence: devEv });
    // exactly the shape that passed before: one command, one confident summary,
    // no criterion answered
    const r = await recordDispatchGuarded(
      dir, "j1",
      { ...QA, status: "verified", evidence: { by: "qa", commands: ["bun test"], summary: "everything works" } },
      { resolveAcceptance: acceptance },
    );
    expect(r.ok).toBe(false);
    expect(r.code).toBe("verification-incomplete");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("an item with an empty command is not coverage — a named criterion with no test is untested", async () => {
  const dir = await ws();
  try {
    await recordDispatchGuarded(dir, "j1", { ...DEV, status: "delivered", evidence: devEv });
    const r = await recordDispatchGuarded(
      dir, "j1",
      { ...QA, status: "verified", evidence: qaEv([
        { label: "A1", commands: ["  "], summary: "looks right" },
        { label: "A2", commands: ["ran it"], summary: "ok" },
      ]) },
      { resolveAcceptance: acceptance },
    );
    expect(r.ok).toBe(false);
    expect(r.message).toContain("!NO-EVIDENCE A1");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("covering every criterion is accepted", async () => {
  const dir = await ws();
  try {
    await recordDispatchGuarded(dir, "j1", { ...DEV, status: "delivered", evidence: devEv });
    const r = await recordDispatchGuarded(
      dir, "j1",
      { ...QA, status: "verified", evidence: qaEv([
        { label: "A1", commands: ["drove the browser"], summary: "typed, output appeared" },
        { label: "A2", commands: ["opened a closed session"], summary: "final frame stayed populated" },
      ]) },
      { resolveAcceptance: acceptance },
    );
    expect(r.ok).toBe(true);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("a unit with NO approved Task Spec demands no item coverage — no demanding a list nobody signed", async () => {
  const dir = await ws();
  try {
    await recordDispatchGuarded(dir, "j1", { ...DEV, status: "delivered", evidence: devEv });
    const r = await recordDispatchGuarded(
      dir, "j1",
      { ...QA, status: "verified", evidence: qaEv() },
      { resolveAcceptance: async () => null },
    );
    expect(r.ok).toBe(true);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("merged with NO QA verdict is refused — every finished task is tested before it lands", async () => {
  const dir = await ws();
  try {
    await recordDispatchGuarded(dir, "j1", { ...DEV, status: "delivered", evidence: devEv });
    const r = await recordDispatchGuarded(dir, "j1", { ...DEV, status: "merged" });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("merge-needs-qa");
    expect(r.message).toContain("no QA has verified it");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("THE FIX LOOP: fail → specialist adjusts → the OLD pass no longer counts → QA must re-test", async () => {
  const dir = await ws();
  try {
    // round 1: delivered, QA REJECTS it
    await recordDispatchGuarded(dir, "j1", { ...DEV, status: "delivered", evidence: devEv });
    const failed = await recordDispatchGuarded(dir, "j1", { ...QA, status: "failed", evidence: qaEv() });
    expect(failed.ok).toBe(true);

    // the dev is re-dispatched to fix it — the ledger opens round 2
    const redo = await recordDispatchGuarded(dir, "j1", { ...DEV, status: "dispatched" }, { reason: "QA rejected: typing still blocked" });
    expect(redo.ok).toBe(true);
    const rows = (await readLedger(dir, "j1"))!.dispatches;
    expect(rows.find((d) => d.specialist === "Jesse")!.round).toBe(2);

    // the fix is delivered, and someone tries to land it on round 1's history
    await recordDispatchGuarded(dir, "j1", { ...DEV, status: "delivered", evidence: devEv });
    const premature = await recordDispatchGuarded(dir, "j1", { ...DEV, status: "merged" });
    expect(premature.ok).toBe(false);
    expect(premature.code).toBe("merge-needs-qa");
    // this unit was REJECTED, never passed — so the honest refusal is that no QA
    // has verified it at all, not that a pass went stale. (The stale-pass wording
    // belongs to the round-1-passed-then-reworked case, covered below.)
    expect(premature.message).toContain("no QA has verified it");

    // the QA re-tests round 2 — and only now may it land
    const retest = await recordDispatchGuarded(dir, "j1", { ...QA, status: "verified", evidence: qaEv() });
    expect(retest.ok).toBe(true);
    const merged = await recordDispatchGuarded(dir, "j1", { ...DEV, status: "merged" });
    expect(merged.ok).toBe(true);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("a QA pass from round 1 does not survive a round-2 rework — proved by the round it stamped", async () => {
  const dir = await ws();
  try {
    await recordDispatchGuarded(dir, "j1", { ...DEV, status: "delivered", evidence: devEv });
    await recordDispatchGuarded(dir, "j1", { ...QA, status: "verified", evidence: qaEv() });
    const afterPass = (await readLedger(dir, "j1"))!.dispatches;
    expect(afterPass.find((d) => d.specialist === "Mike")!.verifiedRound).toBe(1);

    await recordDispatchGuarded(dir, "j1", { ...DEV, status: "dispatched" }, { reason: "PE asked for a change" });
    await recordDispatchGuarded(dir, "j1", { ...DEV, status: "delivered", evidence: devEv });
    const r = await recordDispatchGuarded(dir, "j1", { ...DEV, status: "merged" });
    expect(r.ok).toBe(false);
    expect(r.message).toContain("round 1");
    expect(r.message).toContain("round 2");
  } finally { await rm(dir, { recursive: true, force: true }); }
});
