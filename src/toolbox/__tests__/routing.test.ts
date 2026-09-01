import { expect, test } from "bun:test";
import { matchSkills } from "../routing";
import { emptyToolbox } from "../types";
import type { Toolbox } from "../types";

function tb(): Toolbox {
  const t = emptyToolbox();
  t.skills = [
    {
      name: "sdd",
      description: "d",
      objective: "o",
      whenToUse: "big features only",
      repos: ["embark"],
      routing: { taskTypes: ["feature", "refactor"], skipFor: ["styling", "copy"], minSize: "large" },
    },
    { name: "lint-kit", description: "d", objective: "o", whenToUse: "anytime", repos: ["embark"] }, // no routing → always
  ];
  return t;
}

test("a styling task skips SDD but keeps the un-routed skill", () => {
  const matched = matchSkills(tb(), { taskType: "styling", size: "small" });
  expect(matched.map((s) => s.name)).toEqual(["lint-kit"]);
});

test("a large feature matches SDD", () => {
  const matched = matchSkills(tb(), { taskType: "feature", size: "large" });
  expect(matched.map((s) => s.name).sort()).toEqual(["lint-kit", "sdd"]);
});

test("a small feature is below SDD's minSize", () => {
  const matched = matchSkills(tb(), { taskType: "feature", size: "small" });
  expect(matched.map((s) => s.name)).toEqual(["lint-kit"]);
});

test("a task type outside SDD's taskTypes doesn't match it", () => {
  const matched = matchSkills(tb(), { taskType: "docs", size: "large" });
  expect(matched.map((s) => s.name)).toEqual(["lint-kit"]);
});

test("no task shape → everything matches", () => {
  expect(matchSkills(tb(), {}).map((s) => s.name).sort()).toEqual(["lint-kit", "sdd"]);
});

// ── routeSdd (#118): ONE explicit SDD floor for a task, not an additive list.
// The threshold is spec-kit's own routing.minSize (established, not guessed).
import { routeSdd, skillApplies } from "../routing";

function sddToolbox(installed: string[]): Toolbox {
  const t = emptyToolbox();
  const all: Record<string, Toolbox["skills"][number]> = {
    "sdd-lite": { name: "sdd-lite", description: "d", objective: "o", whenToUse: "floor", repos: ["aipe"] },
    "spec-kit": {
      name: "spec-kit", description: "d", objective: "o", whenToUse: "non-trivial", repos: ["aipe"],
      routing: { skipFor: ["styling", "copy", "one-liner", "chore"], minSize: "medium" },
    },
  };
  t.skills = installed.map((n) => all[n]!).filter(Boolean);
  return t;
}

test("skillApplies: below minSize is false; at/above is true; skipFor overrides", () => {
  const sk = sddToolbox(["spec-kit"]).skills[0]!;
  expect(skillApplies(sk, { size: "small" })).toBe(false);
  expect(skillApplies(sk, { size: "medium" })).toBe(true);
  expect(skillApplies(sk, { size: "large" })).toBe(true);
  expect(skillApplies(sk, { taskType: "chore", size: "large" })).toBe(false);
});

test("routeSdd: a large feature routes to the FULL spec-kit, and the reason names the threshold", () => {
  const r = routeSdd(sddToolbox(["sdd-lite", "spec-kit"]), { taskType: "feature", size: "large" });
  expect(r.kit).toBe("spec-kit");
  expect(r.reason).toContain("medium"); // the established threshold is visible
});

test("routeSdd: a small task falls to the light floor sdd-lite, not spec-kit", () => {
  const r = routeSdd(sddToolbox(["sdd-lite", "spec-kit"]), { taskType: "feature", size: "small" });
  expect(r.kit).toBe("sdd-lite");
});

test("routeSdd: a skipFor task (chore) falls to the floor even at large size", () => {
  const r = routeSdd(sddToolbox(["sdd-lite", "spec-kit"]), { taskType: "chore", size: "large" });
  expect(r.kit).toBe("sdd-lite");
});

test("routeSdd: with spec-kit NOT installed, even a large task only reaches the floor — the decorative-flag bug, made visible", () => {
  const r = routeSdd(sddToolbox(["sdd-lite"]), { taskType: "feature", size: "large" });
  expect(r.kit).toBe("sdd-lite");
});

test("routeSdd: no SDD kit installed at all → null (nothing to route to)", () => {
  const r = routeSdd(sddToolbox([]), { taskType: "feature", size: "large" });
  expect(r.kit).toBeNull();
});

// ── Regression (#118, Heisenberg): the REAL failing config. A pre-#118
// `aipe skill add spec-kit` (v1.16.0) wrote the toolbox entry with NO `routing:`
// block. Reading the threshold off that entry made every size route to spec-kit
// and fabricated "small ≥ medium" in the reason. routeSdd must take the
// threshold from the kit's registry contract, so a SHALLOW entry still routes
// by difficulty and the reason never claims a comparison that did not run.
function shallowSpecKitToolbox(): Toolbox {
  const t = emptyToolbox();
  t.skills = [
    { name: "sdd-lite", description: "d", objective: "o", whenToUse: "floor", repos: ["aipe"] },
    // exactly the shape `skill add spec-kit --all` wrote in the PE's workspace: NO routing
    { name: "spec-kit", description: "d", objective: "o", whenToUse: "w", repos: ["aipe"] },
  ];
  return t;
}

test("a SHALLOW spec-kit entry (no routing block) still routes by size — small≠large", () => {
  const tb = shallowSpecKitToolbox();
  const small = routeSdd(tb, { taskType: "feature", size: "small" });
  const large = routeSdd(tb, { taskType: "feature", size: "large" });
  expect(small.kit).toBe("sdd-lite"); // below the registry threshold
  expect(large.kit).toBe("spec-kit"); // at/above it
  expect(small.kit).not.toBe(large.kit); // the divergence the acceptance demands
});

test("a SHALLOW entry's small route NEVER claims 'small ≥ medium' — the reason states the real comparison", () => {
  const r = routeSdd(shallowSpecKitToolbox(), { taskType: "feature", size: "small" });
  expect(r.reason).toContain("< the medium threshold"); // the comparison that actually happened
  expect(r.reason).not.toContain("small ≥"); // never the lie
});
