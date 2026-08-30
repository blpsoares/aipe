import { expect, test } from "bun:test";
import {
  CONTAINMENT_STATES,
  HARNESS_CONTAINMENT,
  INVESTIGATED_HARNESS_IDS,
  containmentFor,
  harnessesInState,
} from "../compat";
import { getAdapter, hasAdapter } from "../registry";
import { isContainable } from "../types";
import { PROBED_HARNESSES } from "../../capabilities/probe";

// The ten harnesses agentop can host, per the coordinator's assignment. The
// ledger's whole reason to exist is that "no adapter" and "cannot be contained"
// were being collapsed into one label; a missing id here would let the defect
// back in silently.
const AGENTOP_TEN = [
  "claude-code",
  "codex",
  "cursor",
  "copilot",
  "gemini",
  "antigravity",
  "factory-droid",
  "kimi-code",
  "opencode",
  "pi",
];

test("all ten agentop-hostable harnesses are classified, with no duplicates", () => {
  const ids = HARNESS_CONTAINMENT.map((h) => h.id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(new Set(ids)).toEqual(new Set(AGENTOP_TEN));
  expect(INVESTIGATED_HARNESS_IDS).toEqual(ids);
});

test("every entry is one of exactly three states — not two", () => {
  expect(CONTAINMENT_STATES).toEqual([
    "containable-proven",
    "non-containable-proven",
    "unestablished",
  ]);
  for (const h of HARNESS_CONTAINMENT) {
    expect(CONTAINMENT_STATES).toContain(h.state);
  }
  // The third state is the point of the task: it must actually be used, or the
  // ledger is just the old two-state world with a longer type.
  expect(harnessesInState("unestablished").length).toBeGreaterThan(0);
});

test("a proven claim carries a primary source; an unestablished one carries a reason", () => {
  for (const h of HARNESS_CONTAINMENT) {
    if (h.state === "unestablished") {
      // Not required to cite (the doc may not answer), but MUST say why.
      expect(h.headline.length).toBeGreaterThan(0);
    } else {
      // "A table of ten confident lines would be the repetition of the defect":
      // no confident line without a cited primary source.
      expect(h.sources.length).toBeGreaterThan(0);
    }
    for (const s of h.sources) {
      expect(s.url.startsWith("https://")).toBe(true);
      expect(s.accessed).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(s.quote.trim().length).toBeGreaterThan(0);
    }
  }
});

// The load that makes this ledger honest rather than decorative: the four
// harnesses that HAVE an adapter must classify to whatever the code actually
// does. Flip an adapter's containmentHook and this test forces the ledger to
// follow — and vice versa. It is the anti-drift lock between prose and behavior.
test("adapter-backed harnesses classify to what isContainable() really returns", () => {
  for (const h of HARNESS_CONTAINMENT) {
    if (h.adapterId === null) continue;
    expect(hasAdapter(h.adapterId)).toBe(true);
    const contained = isContainable(getAdapter(h.adapterId));
    expect(h.state).toBe(contained ? "containable-proven" : "non-containable-proven");
  }
});

test("the four adapter-backed harnesses are exactly the ones with an adapterId", () => {
  const withAdapter = HARNESS_CONTAINMENT.filter((h) => h.adapterId !== null).map((h) => h.id);
  expect(new Set(withAdapter)).toEqual(new Set(["claude-code", "gemini", "codex", "copilot"]));
});

// The union the dispatch law and the pricer depend on. The assignment forbids
// changing it; this guards it from the same file that adds the ten-way ledger,
// so a future edit here cannot quietly widen it.
test("the four-id probed union is unchanged", () => {
  expect(PROBED_HARNESSES.map((h) => h.id)).toEqual(["claude-code", "gemini", "codex", "copilot"]);
});

// The PE's actual flag: the current number treats antigravity like any other
// unimplemented harness, but the investigation found a config-file deny hook
// with no documented trust gate — so it is NOT proven non-containable. It is a
// candidate the docs do not fully resolve. Encoding that as a test keeps a
// future "just mark it coming-soon like the rest" edit from erasing the finding.
test("antigravity is a candidate the docs leave open — not proven non-containable", () => {
  const anti = containmentFor("antigravity");
  expect(anti).toBeDefined();
  expect(anti!.state).toBe("unestablished");
  expect(anti!.state).not.toBe("non-containable-proven");
  expect(anti!.sources.length).toBeGreaterThan(0); // the finding is sourced even though the state is open
});

test("containmentFor and harnessesInState are consistent with the ledger", () => {
  expect(containmentFor("nope")).toBeUndefined();
  expect(containmentFor("gemini")!.id).toBe("gemini");
  const proven = harnessesInState("containable-proven").map((h) => h.id);
  expect(proven).toContain("claude-code");
  expect(proven).toContain("gemini");
  expect(proven).not.toContain("codex");
  const total =
    harnessesInState("containable-proven").length +
    harnessesInState("non-containable-proven").length +
    harnessesInState("unestablished").length;
  expect(total).toBe(HARNESS_CONTAINMENT.length);
});
