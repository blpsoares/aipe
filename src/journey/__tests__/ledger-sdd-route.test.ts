// The SDD gate's ROUTE DERIVATION (#118) — the link that was missing while the
// gate itself was already correct code.
//
// Measured before this suite existed: `journey record --status delivered`, typed
// exactly as the dispatch prompt tells a specialist to type it, was ACCEPTED on
// a worktree with no spec and no plan. The gate only fired when someone added
// `--sdd spec-kit` by hand, and nothing in the dispatch path ever did — so a
// gate made of real code never once ran. That is the same shape as `--size`
// being accepted and ignored: a capability you can point at that does nothing.
//
// The fix is the ORDER the route is decided in, so these tests are about order:
// an explicit `--sdd` wins; otherwise the route is DERIVED from the unit's
// recorded size; and silence defaults to rigor, not to the floor.
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readLedger, recordDispatchGuarded, startJourney, type SddRouter } from "../ledger";
import type { DispatchEvidence, JourneyDispatch } from "../types";
import { routeSddForGate } from "../../toolbox/routing";
import type { Toolbox } from "../../toolbox/types";

async function ws(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "aipe-sdd-route-"));
  await startJourney(dir, "j1");
  return dir;
}

const evidence: DispatchEvidence = { by: "dev", commands: ["bun test"], summary: "42 pass" };
const base: JourneyDispatch = { repo: "aipe", specialist: "Jesse", branch: "b", worktree: "/wt", status: "dispatched" };
const noArtifacts = async () => ({ spec: false, plan: false });

// The REAL router, bound to a catalog that has the full kit installed — the
// binding `journey record` builds from the workspace. Using the real one (not a
// stub) is deliberate: the gate and `aipe skill match` must never be able to
// disagree about what a size routes to.
const installed: Toolbox = {
  skills: [
    { name: "spec-kit", description: "", objective: "", whenToUse: "", repos: ["aipe"] },
    { name: "sdd-lite", description: "", objective: "", whenToUse: "", repos: ["aipe"] },
  ],
  mcps: [],
};
const router: SddRouter = (task) => routeSddForGate(installed, task).kit;

test("the DISPATCH PROMPT's own delivered command — no --sdd, no --size — is REFUSED", async () => {
  const dir = await ws();
  try {
    const r = await recordDispatchGuarded(
      dir, "j1",
      { ...base, status: "delivered", evidence },
      { resolveSddArtifacts: noArtifacts, routeSdd: router },
    );
    expect(r.ok).toBe(false);
    expect(r.code).toBe("sdd-artifacts-required");
    // and it must say WHY it is being demanded of a unit that declared nothing
    expect(r.message).toContain("undeclared is not established as trivial");
    expect((await readLedger(dir, "j1"))!.dispatches).toHaveLength(0); // nothing written
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("silence is escapable only by DECLARING trivial: --size small is accepted", async () => {
  const dir = await ws();
  try {
    const r = await recordDispatchGuarded(
      dir, "j1",
      { ...base, status: "delivered", size: "small", evidence },
      { resolveSddArtifacts: noArtifacts, routeSdd: router },
    );
    expect(r.ok).toBe(true);
    // the claim is KEPT on the ledger — "it was trivial" becomes auditable, which
    // is the whole difference from the silence it replaces
    const unit = (await readLedger(dir, "j1"))!.dispatches[0]!;
    expect(unit.size).toBe("small");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("a declared size at/above the threshold is REFUSED without artifacts", async () => {
  const dir = await ws();
  try {
    const r = await recordDispatchGuarded(
      dir, "j1",
      { ...base, status: "delivered", size: "large", evidence },
      { resolveSddArtifacts: noArtifacts, routeSdd: router },
    );
    expect(r.ok).toBe(false);
    // the refusal names the route's real ORIGIN — a size WAS declared here, so
    // claiming "nothing was declared" would be the gate affirming what it had
    // not established (the defect class this repo keeps paying for)
    expect(r.message).toContain("is size large");
    expect(r.message).not.toContain("no size and no route were ever declared");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("THE REAL FLOW: size declared at dispatch, plain `delivered` later still bites", async () => {
  const dir = await ws();
  try {
    // 1. the coordinator dispatches, declaring the difficulty once
    const d = await recordDispatchGuarded(dir, "j1", { ...base, size: "large" }, { routeSdd: router });
    expect(d.ok).toBe(true);

    // 2. the specialist reports done with the CLEAN command — no --size, no --sdd.
    //    This is the exact write that used to sail through: the whole point is
    //    that the obligation lives on the ledger, not in a flag someone recalls.
    const r = await recordDispatchGuarded(
      dir, "j1",
      { ...base, status: "delivered", evidence },
      { resolveSddArtifacts: noArtifacts, routeSdd: router },
    );
    expect(r.ok).toBe(false);
    expect(r.code).toBe("sdd-artifacts-required");
    expect(r.message).toContain("is size large");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("an explicit --sdd sdd-lite outranks a derived route — a signed decision wins", async () => {
  const dir = await ws();
  try {
    const r = await recordDispatchGuarded(
      dir, "j1",
      { ...base, status: "delivered", size: "large", sddKit: "sdd-lite", evidence },
      { resolveSddArtifacts: noArtifacts, routeSdd: router },
    );
    expect(r.ok).toBe(true);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("a workspace WITHOUT spec-kit is never gated — no demanding an unreachable flow", async () => {
  const dir = await ws();
  const floorOnly: Toolbox = { skills: [{ name: "sdd-lite", description: "", objective: "", whenToUse: "", repos: ["aipe"] }], mcps: [] };
  try {
    const r = await recordDispatchGuarded(
      dir, "j1",
      { ...base, status: "delivered", size: "large", evidence },
      { resolveSddArtifacts: noArtifacts, routeSdd: (t) => routeSddForGate(floorOnly, t).kit },
    );
    expect(r.ok).toBe(true);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("only `delivered` is gated — the fix loop and the QA verdict are never blocked", async () => {
  const dir = await ws();
  try {
    for (const status of ["dispatched", "blocked", "failed", "escalated"] as const) {
      const r = await recordDispatchGuarded(
        dir, "j1",
        { ...base, status, size: "large", ...(status === "failed" ? { evidence } : {}) },
        { resolveSddArtifacts: noArtifacts, routeSdd: router, reason: "r" },
      );
      expect(`${status}:${r.ok}`).toBe(`${status}:true`);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
