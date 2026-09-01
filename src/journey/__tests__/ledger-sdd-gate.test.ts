// The SDD delivery gate (#118). A unit routed to the FULL spec-kit flow cannot
// be claimed `delivered` without its spec AND plan committed in the worktree —
// mirroring the evidence gate. Prose in the brief did not hold (7/7 deliveries
// carried neither); the ledger physically refuses the claim. Inert without an
// injected resolver, exactly like the CI gate — never fabricates a pass. Proved
// by mutation: strip an artifact → the refusal bites; provide both → it passes.
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readLedger, recordDispatch, recordDispatchGuarded, startJourney } from "../ledger";
import type { DispatchEvidence, JourneyDispatch } from "../types";

async function ws(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "aipe-sdd-gate-"));
  await startJourney(dir, "j1");
  return dir;
}

const evidence: DispatchEvidence = { by: "dev", commands: ["bun test"], summary: "42 pass" };
const base: JourneyDispatch = { repo: "aipe", specialist: "Jesse", branch: "b", worktree: "/wt", status: "dispatched" };
// A resolver that reports whatever the test dictates for the artifacts.
const artifacts = (spec: boolean, plan: boolean) => async () => ({ spec, plan });

test("spec-kit-routed delivery WITHOUT a spec is REJECTED, naming the spec", async () => {
  const dir = await ws();
  try {
    const r = await recordDispatchGuarded(
      dir, "j1",
      { ...base, status: "delivered", sddKit: "spec-kit", evidence },
      { resolveSddArtifacts: artifacts(false, true) },
    );
    expect(r.ok).toBe(false);
    expect(r.code).toBe("sdd-artifacts-required");
    expect(r.message).toContain("spec");
    expect((await readLedger(dir, "j1"))!.dispatches).toHaveLength(0); // nothing written
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("spec-kit-routed delivery WITHOUT a plan is REJECTED, naming the plan", async () => {
  const dir = await ws();
  try {
    const r = await recordDispatchGuarded(
      dir, "j1",
      { ...base, status: "delivered", sddKit: "spec-kit", evidence },
      { resolveSddArtifacts: artifacts(true, false) },
    );
    expect(r.ok).toBe(false);
    expect(r.code).toBe("sdd-artifacts-required");
    expect(r.message).toContain("plan");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("spec-kit-routed delivery WITH both spec and plan is accepted", async () => {
  const dir = await ws();
  try {
    const r = await recordDispatchGuarded(
      dir, "j1",
      { ...base, status: "delivered", sddKit: "spec-kit", evidence },
      { resolveSddArtifacts: artifacts(true, true) },
    );
    expect(r.ok).toBe(true);
    expect((await readLedger(dir, "j1"))!.dispatches[0]!.status).toBe("delivered");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("a sdd-lite (floor) unit is NOT held to the spec-kit artifact gate", async () => {
  const dir = await ws();
  try {
    const r = await recordDispatchGuarded(
      dir, "j1",
      { ...base, status: "delivered", sddKit: "sdd-lite", evidence },
      { resolveSddArtifacts: artifacts(false, false) },
    );
    expect(r.ok).toBe(true);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("a unit with no SDD route is untouched by the gate", async () => {
  const dir = await ws();
  try {
    const r = await recordDispatchGuarded(
      dir, "j1",
      { ...base, status: "delivered", evidence },
      { resolveSddArtifacts: artifacts(false, false) },
    );
    expect(r.ok).toBe(true);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("sticky: sddKit recorded at dispatch is enforced at delivered even when the delivered write omits --sdd", async () => {
  const dir = await ws();
  try {
    // dispatch records the route…
    await recordDispatch(dir, "j1", { ...base, status: "dispatched", sddKit: "spec-kit" });
    // …the plain delivered write does NOT repeat --sdd, yet the gate still bites.
    const r = await recordDispatchGuarded(
      dir, "j1",
      { ...base, status: "delivered", evidence },
      { resolveSddArtifacts: artifacts(false, true) },
    );
    expect(r.ok).toBe(false);
    expect(r.code).toBe("sdd-artifacts-required");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("the fix loop is not broken: a dispatched/blocked/failed spec-kit unit is not held to the artifact gate", async () => {
  const dir = await ws();
  try {
    // re-dispatch (fix loop) of a spec-kit unit, no artifacts yet — must pass.
    const r = await recordDispatchGuarded(
      dir, "j1",
      { ...base, status: "dispatched", sddKit: "spec-kit" },
      { resolveSddArtifacts: artifacts(false, false) },
    );
    expect(r.ok).toBe(true);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("no resolver injected → the gate is inert (a resolver-less caller never fabricates a pass or a fail)", async () => {
  const dir = await ws();
  try {
    const r = await recordDispatchGuarded(
      dir, "j1",
      { ...base, status: "delivered", sddKit: "spec-kit", evidence },
      {}, // no resolveSddArtifacts
    );
    expect(r.ok).toBe(true);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
