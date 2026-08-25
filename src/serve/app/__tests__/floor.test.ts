import { expect, test } from "bun:test";
import {
  derivePhase,
  phaseTone,
  isGreenPhase,
  costIndexOf,
  hasEvidence,
  openJourneyOf,
  deriveJourneyPhase,
  openWaveOf,
  countsByStatus,
  serializedBehind,
  isGateClass,
  buildDecisionInbox,
  unitTimeline,
  type Phase,
} from "../runtime/floor";
import type { Dispatch } from "../runtime/store";

function d(over: Partial<Dispatch> = {}): Dispatch {
  return { repo: "aipe", specialist: "Jesse", branch: "b", worktree: "/ws/aipe/.worktrees/na-jesse", status: "dispatched", journey: "j-1", ...over } as Dispatch;
}
const DEV_EV = { by: "dev", commands: ["bun test"], summary: "green" };

test("derivePhase is exhaustive over DispatchStatus and never invents progress", () => {
  expect(derivePhase(d({ status: "merged" }))).toBe("closed");
  expect(derivePhase(d({ status: "removed" }))).toBe("closed");
  expect(derivePhase(d({ status: "verified" }))).toBe("verified");
  expect(derivePhase(d({ status: "escalated" }))).toBe("escalated");
  expect(derivePhase(d({ status: "redirected" }))).toBe("redirected");
  expect(derivePhase(d({ status: "failed" }))).toBe("qa-gate");
  // delivered WITH dev evidence → delivered; WITHOUT → verifying (honest pre-proof)
  expect(derivePhase(d({ status: "delivered", evidence: DEV_EV } as Partial<Dispatch>))).toBe("delivered");
  expect(derivePhase(d({ status: "delivered" }))).toBe("verifying");
});

test("derivePhase for a live dispatch reads session activity (session mode)", () => {
  const working = derivePhase(d({ mode: "session" } as Partial<Dispatch>), { session: { id: "s", status: "running", activity: "working" } });
  expect(working).toBe("implementing");
  const waiting = derivePhase(d({ mode: "session" } as Partial<Dispatch>), { session: { id: "s", status: "running", activity: "waiting" } });
  expect(waiting).toBe("dispatched");
  // an exited session on a still-dispatched record ⇒ dead-silent (ended without recording)
  const dead = derivePhase(d({ mode: "session" } as Partial<Dispatch>), { session: { id: "s", status: "exited" } });
  expect(dead).toBe("dead-silent");
});

test("derivePhase never claims dead-silent while the monitor is offline or within the boot grace", () => {
  const base = d();
  expect(derivePhase(base, { laneActive: false, monConnDown: true, elapsedMs: 60 * 60_000 })).toBe("dispatched");
  expect(derivePhase(base, { laneActive: false, monConnDown: false, elapsedMs: 1_000, bootGraceMs: 90_000 })).toBe("dispatched");
  expect(derivePhase(base, { laneActive: false, monConnDown: false, elapsedMs: 20 * 60_000, silenceMs: 15 * 60_000 })).toBe("dead-silent");
  // a live subagent lane ⇒ implementing (verifying once dev evidence lands)
  expect(derivePhase(base, { laneActive: true })).toBe("implementing");
  expect(derivePhase(d({ evidence: DEV_EV } as Partial<Dispatch>), { laneActive: true })).toBe("verifying");
});

test("phaseTone maps every phase to a tone and greens are identifiable", () => {
  const phases: Phase[] = ["dispatched", "implementing", "verifying", "delivered", "verified", "qa-gate", "escalated", "redirected", "dead-silent", "closed"];
  for (const p of phases) expect(typeof phaseTone(p)).toBe("string");
  expect(isGreenPhase("verified")).toBe(true);
  expect(isGreenPhase("closed")).toBe(true);
  expect(isGreenPhase("escalated")).toBe(false);
  expect(isGreenPhase("dispatched")).toBe(false);
});

test("costIndexOf multiplies the envelope and flags defaulted fields", () => {
  const full = costIndexOf(d({ mode: "session", tier: "reasoning", intensity: "ultracode", harness: "claude" } as Partial<Dispatch>));
  expect(full.value).toBe(64); // 2 * 4 * 8
  expect(full.defaulted).toBe(false);
  const partial = costIndexOf(d({ mode: "subagent" } as Partial<Dispatch>));
  expect(partial.defaulted).toBe(true); // tier/intensity absent
  // an unknown tier is not silently multiplied to NaN
  const bad = costIndexOf(d({ mode: "session", tier: "weird", intensity: "normal" } as Partial<Dispatch>));
  expect(bad.value === null || bad.defaulted).toBeTruthy();
});

test("hasEvidence matches the ledger gate (a command AND a summary)", () => {
  expect(hasEvidence(d({ evidence: DEV_EV } as Partial<Dispatch>))).toBe(true);
  expect(hasEvidence(d({ evidence: { by: "dev", commands: [], summary: "x" } } as Partial<Dispatch>))).toBe(false);
  expect(hasEvidence(d())).toBe(false);
});

test("openJourneyOf picks the most-recently-updated journey that still has open work", () => {
  const journeys = [
    { id: "old", updatedAt: "2020-01-01T00:00:00Z", dispatches: [d({ journey: "old", status: "merged" })] },
    { id: "live", updatedAt: "2026-08-25T00:00:00Z", dispatches: [d({ journey: "live", status: "dispatched" })] },
  ] as any;
  expect(openJourneyOf(journeys)?.id).toBe("live");
  expect(openJourneyOf([])).toBeNull();
});

test("deriveJourneyPhase reflects the gate and the wave", () => {
  expect(deriveJourneyPhase({ id: "j", dispatches: [] } as any)).toBe("framing");
  expect(deriveJourneyPhase({ id: "j", spec: { path: "p", version: 1, approved: false }, dispatches: [] } as any)).toBe("awaiting-spec-approval");
  const approved = { id: "j", spec: { path: "p", version: 1, approved: true } };
  expect(deriveJourneyPhase({ ...approved, dispatches: [] } as any)).toBe("planning");
  expect(deriveJourneyPhase({ ...approved, dispatches: [d({ status: "dispatched" })] } as any)).toBe("wave-running");
  expect(deriveJourneyPhase({ ...approved, dispatches: [d({ status: "escalated" })] } as any)).toBe("needs-decision");
  expect(deriveJourneyPhase({ ...approved, dispatches: [d({ status: "delivered" })] } as any)).toBe("qa");
});

test("openWaveOf sums the committed cost-index of the live dispatches", () => {
  const j = { id: "j", dispatches: [
    d({ status: "dispatched", mode: "session", tier: "reasoning", intensity: "ultracode" } as Partial<Dispatch>),
    d({ status: "merged" }),
  ] } as any;
  const wave = openWaveOf(j);
  expect(wave.units.length).toBe(1);
  expect(wave.committedIndex).toBe(64);
});

test("countsByStatus tallies each status", () => {
  const c = countsByStatus([d({ status: "dispatched" }), d({ status: "delivered" }), d({ status: "delivered" })]);
  expect(c.dispatched).toBe(1);
  expect(c.delivered).toBe(2);
});

test("serializedBehind renders the same-package law: a second live dispatch waits behind the first", () => {
  const first = d({ specialist: "Jesse", package: "core", status: "dispatched" } as Partial<Dispatch>);
  const second = d({ specialist: "Mike", package: "core", status: "dispatched" } as Partial<Dispatch>);
  const other = d({ specialist: "Sky", package: "web", status: "dispatched" } as Partial<Dispatch>);
  const all = [first, second, other];
  expect(serializedBehind(second, all)).toBe("Jesse");
  expect(serializedBehind(first, all)).toBeNull();
  expect(serializedBehind(other, all)).toBeNull();
});

test("isGateClass flags an envelope that needs the PE's authorization and no grant covers it", () => {
  const ultra = d({ intensity: "ultracode", tier: "reasoning" } as Partial<Dispatch>);
  expect(isGateClass(ultra, { id: "j", dispatches: [] } as any)).toBe(true);
  // a matching authorization clears the gate
  expect(isGateClass(ultra, { id: "j", authorizations: [{ tier: "reasoning", grantedBy: "PE" }], dispatches: [] } as any)).toBe(false);
  // a plain normal/fast envelope is never gate-class
  expect(isGateClass(d({ intensity: "normal", tier: "fast", mode: "subagent" } as Partial<Dispatch>), { id: "j", dispatches: [] } as any)).toBe(false);
});

test("buildDecisionInbox surfaces a gated envelope AND an escalation, critical first, deduped", () => {
  const journeys = [
    {
      id: "j-1",
      authorizations: [],
      dispatches: [
        d({ journey: "j-1", specialist: "Jesse", status: "dispatched", intensity: "ultracode", tier: "reasoning", mode: "session" } as Partial<Dispatch>),
        d({ journey: "j-1", specialist: "Mike", status: "escalated" }),
      ],
    },
  ] as any;
  const attention = [
    { kind: "escalated-open", severity: "warning", unit: "aipe", specialist: "Mike", journey: "j-1", detail: "waiting on the PE" },
    { kind: "no-evidence", severity: "critical", unit: "aipe", specialist: "Jesse", journey: "j-1", detail: "delivered with no evidence" },
  ] as any;
  const inbox = buildDecisionInbox({ attention, journeys, sessions: [], now: Date.now() });
  const kinds = inbox.map((i) => i.kind);
  expect(kinds).toContain("gated");
  expect(kinds).toContain("escalation");
  expect(kinds).toContain("no-evidence");
  // critical outranks warning
  expect(inbox[0]!.severity).toBe("critical");
  // no duplicate (unit,journey,kind)
  const keys = inbox.map((i) => `${i.kind}|${i.unit}|${i.journey}`);
  expect(new Set(keys).size).toBe(keys.length);
});

test("unitTimeline orders a journey's dispatch history for reconstruction", () => {
  const j = { id: "j", dispatches: [d({ specialist: "Jesse", status: "delivered", pr: "http://pr" })] } as any;
  const tl = unitTimeline(j);
  expect(tl.length).toBeGreaterThan(0);
  expect(tl[0]).toHaveProperty("label");
});
