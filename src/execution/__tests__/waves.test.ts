import { expect, test } from "bun:test";
import { groupIntoWaves } from "../waves";
import { defaultExecutionPolicy } from "../policy";
import type { Envelope } from "../types";

const session = (harness = "claude-code"): Envelope => ({ mode: "session", harness, tier: "standard", intensity: "normal" });
const subagent: Envelope = { mode: "subagent", harness: "claude-code", tier: "standard", intensity: "normal" };
const ultra: Envelope = { mode: "session", harness: "claude-code", tier: "frontier", intensity: "ultracode" };

test("session units sharing a model form one wave", () => {
  const r = groupIntoWaves(
    [
      { fqid: "a", envelope: session(), model: "m1" },
      { fqid: "b", envelope: session(), model: "m1" },
    ],
    defaultExecutionPolicy(),
  );
  expect(r.waves).toHaveLength(1);
  expect(r.waves[0]!.model).toBe("m1");
  expect(r.waves[0]!.units).toEqual(["a", "b"]);
  expect(r.notes).toEqual([]);
});

test("session units wanting different models split, and the extra wave is stated", () => {
  const r = groupIntoWaves(
    [
      { fqid: "a", envelope: session(), model: "m1" },
      { fqid: "b", envelope: session(), model: "m2" },
    ],
    defaultExecutionPolicy(),
  );
  expect(r.waves.map((w) => [w.model, w.units])).toEqual([
    ["m1", ["a"]],
    ["m2", ["b"]],
  ]);
  expect(r.notes).toEqual([
    "2 waves instead of 1: agentop binds --model per batch, so units wanting different models cannot share a wave. Subagent mode binds the model per unit if one wave matters more than the finer choice.",
  ]);
});

test("subagent units never force a split — the model binds per unit there", () => {
  const r = groupIntoWaves(
    [
      { fqid: "a", envelope: subagent, model: "m1" },
      { fqid: "b", envelope: subagent, model: "m2" },
    ],
    defaultExecutionPolicy(),
  );
  expect(r.waves.map((w) => [w.model, w.units])).toEqual([[null, ["a", "b"]]]);
  expect(r.notes).toEqual([]);
});

test("a session wave above the policy ceiling is split and the split is stated", () => {
  const units = ["a", "b", "c", "d", "e"].map((fqid) => ({ fqid, envelope: session(), model: "m1" }));
  const r = groupIntoWaves(units, { ...defaultExecutionPolicy(), maxSessionsPerWave: 2 });
  expect(r.waves.map((w) => w.units)).toEqual([["a", "b"], ["c", "d"], ["e"]]);
  expect(r.notes).toContain("3 waves instead of 1: the policy caps a wave at 2 concurrent sessions.");
});

test("mixed modes keep session and subagent units in separate waves", () => {
  const r = groupIntoWaves(
    [
      { fqid: "a", envelope: session(), model: "m1" },
      { fqid: "b", envelope: subagent, model: "m2" },
    ],
    defaultExecutionPolicy(),
  );
  expect(r.waves.map((w) => [w.model, w.units])).toEqual([
    ["m1", ["a"]],
    [null, ["b"]],
  ]);
});

// --- the two wave-level policy fields, which nothing consulted before this ---

test("a wave carries its own cost index", () => {
  const r = groupIntoWaves(
    [
      { fqid: "a", envelope: session(), model: "m1" },
      { fqid: "b", envelope: session(), model: "m1" },
    ],
    defaultExecutionPolicy(),
  );
  expect(r.waves[0]!.costIndex).toBe(8); // two session/standard/normal units at 4 each
});

test("a wave above gateAboveSessions is gated, naming the count", () => {
  const units = ["a", "b", "c"].map((fqid) => ({ fqid, envelope: session(), model: "m1" }));
  const r = groupIntoWaves(units, defaultExecutionPolicy());
  expect(r.waves[0]!.gated).toBe(true);
  expect(r.waves[0]!.gateReasons).toContain("3 concurrent sessions exceeds the policy's gate of 2 — needs your authorization");
});

test("a wave at or below gateAboveSessions is not gated on session count", () => {
  const units = ["a", "b"].map((fqid) => ({ fqid, envelope: session(), model: "m1" }));
  const r = groupIntoWaves(units, defaultExecutionPolicy());
  expect(r.waves[0]!.gateReasons.some((g) => g.includes("concurrent sessions"))).toBe(false);
});

test("a wave over the cost ceiling is gated, naming the index and the ceiling", () => {
  const r = groupIntoWaves([{ fqid: "a", envelope: ultra, model: "m1" }], {
    ...defaultExecutionPolicy(),
    maxCostIndexPerWave: 10,
  });
  expect(r.waves[0]!.gated).toBe(true);
  expect(r.waves[0]!.gateReasons).toContain("cost-index 96 exceeds the policy ceiling of 10 — needs your authorization");
});

test("a subagent wave is not gated on session count, however many units it has", () => {
  const units = ["a", "b", "c", "d", "e"].map((fqid) => ({ fqid, envelope: subagent, model: null }));
  const r = groupIntoWaves(units, defaultExecutionPolicy());
  expect(r.waves[0]!.gateReasons.some((g) => g.includes("concurrent sessions"))).toBe(false);
});

// --- error classes named up front ---

test("an empty chosen list yields no waves and no notes", () => {
  const r = groupIntoWaves([], defaultExecutionPolicy());
  expect(r.waves).toEqual([]);
  expect(r.notes).toEqual([]);
});

test("all-subagent input produces no session waves at all", () => {
  const units = ["a", "b"].map((fqid) => ({ fqid, envelope: subagent, model: null }));
  const r = groupIntoWaves(units, defaultExecutionPolicy());
  expect(r.waves).toHaveLength(1);
  expect(r.waves.every((w) => w.model === null)).toBe(true);
  expect(r.waves[0]!.gateReasons).toEqual([]);
});

test("a null model on a session unit forms its own wave instead of crashing", () => {
  const r = groupIntoWaves(
    [
      { fqid: "a", envelope: session(), model: null },
      { fqid: "b", envelope: session(), model: "m1" },
    ],
    defaultExecutionPolicy(),
  );
  expect(r.waves.map((w) => [w.model, w.units])).toEqual([
    [null, ["a"]],
    ["m1", ["b"]],
  ]);
  expect(r.notes).toEqual([
    "2 waves instead of 1: agentop binds --model per batch, so units wanting different models cannot share a wave. Subagent mode binds the model per unit if one wave matters more than the finer choice.",
  ]);
});

test("model split and the session cap firing together state both without contradicting or double-counting", () => {
  const units = [
    ["a", "m1"], ["b", "m1"], ["c", "m1"],
    ["d", "m2"], ["e", "m2"], ["f", "m2"],
  ].map(([fqid, model]) => ({ fqid: fqid!, envelope: session(), model: model! }));
  const r = groupIntoWaves(units, { ...defaultExecutionPolicy(), maxSessionsPerWave: 2 });
  expect(r.waves.map((w) => [w.model, w.units])).toEqual([
    ["m1", ["a", "b"]],
    ["m1", ["c"]],
    ["m2", ["d", "e"]],
    ["m2", ["f"]],
  ]);
  expect(r.notes).toEqual([
    "2 waves instead of 1: agentop binds --model per batch, so units wanting different models cannot share a wave. Subagent mode binds the model per unit if one wave matters more than the finer choice.",
    "4 waves instead of 2: the policy caps a wave at 2 concurrent sessions.",
  ]);
});
