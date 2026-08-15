import { expect, test } from "bun:test";
import { proposeForUnit } from "../propose";
import { defaultExecutionPolicy } from "../policy";
import type { Capabilities } from "../../capabilities/types";

const NOW = "2026-08-15T00:00:00.000Z";
const caps = (present: string[]): Capabilities => ({
  confirmed: true,
  harnesses: [
    { id: "claude-code", bin: "claude", present: present.includes("claude-code"), version: "1", source: "pe-confirmed", checkedAt: NOW },
    { id: "gemini", bin: "gemini", present: present.includes("gemini"), version: "1", source: "pe-confirmed", checkedAt: NOW },
    { id: "codex", bin: "codex", present: present.includes("codex"), version: "1", source: "pe-confirmed", checkedAt: NOW },
  ],
});

test("an absent harness never appears as an option", () => {
  const p = proposeForUnit("embark", caps(["claude-code"]), defaultExecutionPolicy(), {});
  expect(p.options.some((o) => o.envelope.harness === "gemini")).toBe(false);
});

test("an absent harness is excluded with the reason stated", () => {
  const p = proposeForUnit("embark", caps(["claude-code"]), defaultExecutionPolicy(), {});
  expect(p.excluded).toContainEqual({ harness: "gemini", reason: "not present on this machine" });
  expect(p.excluded).toContainEqual({ harness: "codex", reason: "not present on this machine" });
});

test("a present but non-containable harness is excluded from SESSION mode, with the reason stated", () => {
  const p = proposeForUnit("embark", caps(["claude-code", "codex"]), defaultExecutionPolicy(), {});
  expect(p.options.some((o) => o.envelope.harness === "codex" && o.envelope.mode === "session")).toBe(false);
  expect(p.excluded).toContainEqual({
    harness: "codex",
    reason: "not containable — AIPe never starts a session it cannot govern",
  });
});

test("a present but non-containable harness still offers subagent mode", () => {
  const p = proposeForUnit("embark", caps(["claude-code", "codex"]), defaultExecutionPolicy(), {});
  expect(p.options.some((o) => o.envelope.harness === "codex" && o.envelope.mode === "subagent")).toBe(true);
});

test("ultracode and frontier are marked gated, with their reasons", () => {
  const p = proposeForUnit("embark", caps(["claude-code"]), defaultExecutionPolicy(), {});
  const ultra = p.options.find((o) => o.envelope.intensity === "ultracode")!;
  expect(ultra.gated).toBe(true);
  expect(ultra.gateReasons).toContain("intensity ultracode requires your authorization");
  const frontier = p.options.find((o) => o.envelope.tier === "frontier" && o.envelope.intensity === "normal")!;
  expect(frontier.gateReasons).toEqual(["tier frontier requires your authorization"]);
});

test("an ordinary envelope is not gated", () => {
  const p = proposeForUnit("embark", caps(["claude-code"]), defaultExecutionPolicy(), {});
  const plain = p.options.find(
    (o) => o.envelope.mode === "subagent" && o.envelope.tier === "standard" && o.envelope.intensity === "normal",
  )!;
  expect(plain.gated).toBe(false);
  expect(plain.gateReasons).toEqual([]);
});

test("options are ordered cheapest first, so the default reading is the cheap one", () => {
  const p = proposeForUnit("embark", caps(["claude-code"]), defaultExecutionPolicy(), {});
  const costs = p.options.map((o) => o.costIndex);
  expect([...costs].sort((a, b) => a - b)).toEqual(costs);
});

test("every option carries a cost index", () => {
  const p = proposeForUnit("embark", caps(["claude-code"]), defaultExecutionPolicy(), {});
  expect(p.options.every((o) => Number.isInteger(o.costIndex) && o.costIndex > 0)).toBe(true);
});

test("with no harness present at all, there are no options and the reason says so", () => {
  const p = proposeForUnit("embark", caps([]), defaultExecutionPolicy(), {});
  expect(p.options).toEqual([]);
  expect(p.excluded.length).toBeGreaterThan(0);
});

test("with no harness present at all, every excluded entry says why", () => {
  const p = proposeForUnit("embark", caps([]), defaultExecutionPolicy(), {});
  expect(p.excluded).toEqual([
    { harness: "claude-code", reason: "not present on this machine" },
    { harness: "gemini", reason: "not present on this machine" },
    { harness: "codex", reason: "not present on this machine" },
  ]);
});

test("a genuinely empty harnesses array (zero entries, not all present:false) is excluded with a reason distinct from 'not present', pointing at re-probing rather than installing", () => {
  const emptyCaps: Capabilities = { confirmed: true, harnesses: [] };
  const p = proposeForUnit("embark", emptyCaps, defaultExecutionPolicy(), {});
  expect(p.options).toEqual([]);
  expect(p.excluded).toEqual([
    {
      harness: "(none)",
      reason:
        "no harnesses recorded for this machine — capabilities were never probed, or every recorded entry was dropped as invalid; re-probe before proposing",
    },
  ]);
});

test("an unrecognized harness id yields no options at all, not even subagent", () => {
  const unknownCaps: Capabilities = {
    confirmed: true,
    harnesses: [
      { id: "nonsense", bin: "nonsense", present: true, version: "1", source: "pe-confirmed", checkedAt: NOW },
    ],
  };
  const p = proposeForUnit("embark", unknownCaps, defaultExecutionPolicy(), {});
  expect(p.options).toEqual([]);
  expect(p.excluded).toEqual([
    { harness: "nonsense", reason: "unknown harness — no adapter registered for this id" },
  ]);
});

test("an unrecognized harness id never rides getAdapter's claude-code fallback into session mode", () => {
  const unknownCaps: Capabilities = {
    confirmed: true,
    harnesses: [
      { id: "nonsense", bin: "nonsense", present: true, version: "1", source: "pe-confirmed", checkedAt: NOW },
    ],
  };
  const p = proposeForUnit("embark", unknownCaps, defaultExecutionPolicy(), {});
  expect(p.options.some((o) => o.envelope.harness === "nonsense" && o.envelope.mode === "session")).toBe(false);
});

test("opts.harnesses restricts the proposal to the given ids", () => {
  const p = proposeForUnit("embark", caps(["claude-code", "codex"]), defaultExecutionPolicy(), {
    harnesses: ["claude-code"],
  });
  expect(p.options.every((o) => o.envelope.harness === "claude-code")).toBe(true);
  expect(p.excluded.every((e) => e.harness === "claude-code")).toBe(true);
});
