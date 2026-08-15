import { expect, test } from "bun:test";
import { costIndex, waveCostIndex } from "../cost";
import type { Envelope } from "../types";

const base: Envelope = { mode: "subagent", harness: "claude-code", tier: "fast", intensity: "normal" };

test("the cheapest envelope is the unit of measure", () => {
  expect(costIndex(base)).toBe(1);
});

test("every tier is a distinct integer — none collapse onto another", () => {
  const seen = (["fast", "standard", "reasoning", "frontier"] as const).map((tier) => costIndex({ ...base, tier }));
  expect(new Set(seen).size).toBe(4);
});

test("a session costs more than a subagent, all else equal", () => {
  expect(costIndex({ ...base, mode: "session" })).toBeGreaterThan(costIndex(base));
});

test("tiers are ordered fast < standard < reasoning < frontier", () => {
  const c = (tier: Envelope["tier"]) => costIndex({ ...base, tier });
  expect(c("fast")).toBeLessThan(c("standard"));
  expect(c("standard")).toBeLessThan(c("reasoning"));
  expect(c("reasoning")).toBeLessThan(c("frontier"));
});

test("ultracode is the single largest multiplier — it fans out into many agents", () => {
  const withUltra = costIndex({ ...base, intensity: "ultracode" });
  const withFrontier = costIndex({ ...base, tier: "frontier" });
  const withSession = costIndex({ ...base, mode: "session" });
  expect(withUltra).toBeGreaterThan(withFrontier);
  expect(withUltra).toBeGreaterThan(withSession);
});

test("the index is a whole number — it is coarse by design", () => {
  expect(Number.isInteger(costIndex({ mode: "session", harness: "gemini", tier: "frontier", intensity: "ultracode" }))).toBe(true);
});

test("a wave costs the sum of its units", () => {
  expect(waveCostIndex([base, base, base])).toBe(3);
});

test("the reference values are the documented ones", () => {
  expect(costIndex({ ...base, tier: "standard" })).toBe(2);
  expect(costIndex({ ...base, mode: "session", tier: "standard" })).toBe(4);
  expect(costIndex({ mode: "session", harness: "x", tier: "frontier", intensity: "ultracode" })).toBe(96);
});

test("an empty wave costs nothing", () => {
  expect(waveCostIndex([])).toBe(0);
});
