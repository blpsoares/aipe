import { expect, test } from "bun:test";
import { clip, grid, renderJson, renderTable, shortPr, supportsColor } from "../render";
import type { StatusReport, UnitRow } from "../types";

const unit = (over: Partial<UnitRow> = {}): UnitRow => ({
  journey: "j-1",
  fqid: "aipe",
  repo: "aipe",
  package: null,
  task: "status-cli",
  specialist: "Jesse",
  role: "dev-fullstack",
  branch: "aipe/j-1/jesse__status-cli",
  pr: "https://github.com/blpsoares/aipe/pull/29",
  status: "dispatched",
  mode: "session",
  sessionId: "s-1",
  liveness: "running",
  hasEvidence: false,
  harness: "claude-code",
  model: "claude-opus-4-8",
  tier: "reasoning",
  intensity: "normal",
  worktree: "/ws/aipe/.worktrees/j-1-jesse",
  ciBypass: null,
  ...over,
});

const report = (over: Partial<StatusReport> = {}): StatusReport => ({
  workspace: "/ws",
  contextName: "blpsoares",
  scope: "default",
  journeys: [{ id: "j-1", specApproved: true, specVersion: 3, open: 1, done: 0, total: 1 }],
  units: [unit()],
  waiting: [],
  liveness: { source: "agentop", reliable: true, note: "liveness from agentop's live session list" },
  pref: { auto: false, format: "detailed" },
  elision: null,
  ...over,
});

test("grid aligns columns to the widest visible cell", () => {
  const lines = grid(["A", "BB"], [["xxxx", "y"], ["z", "wwww"]], false);
  // first column padded to its widest cell (4); last column never padded, so no
  // trailing whitespace on any line
  expect(lines[0]).toBe("  A     BB");
  expect(lines[1]).toBe("  xxxx  y");
  expect(lines.every((l) => l === l.replace(/\s+$/, ""))).toBe(true);
});

test("alignment counts glyphs, not ANSI bytes (colorized cells still line up)", () => {
  const colored = grid(["K"], [["\x1b[92malive\x1b[0m"], ["x"]], false);
  // padding is based on visible width 5 ("alive"), not the escape-laden string
  expect(colored[1]!.replace(/\x1b\[[0-9;]*m/g, "")).toContain("alive");
});

test("an empty rows set renders (none), never a bare header", () => {
  expect(grid(["A"], [], false)[1]).toContain("(none)");
});

test("shortPr reduces a forge url to #NN, leaves anything else alone", () => {
  expect(shortPr("https://github.com/blpsoares/aipe/pull/29")).toBe("#29");
  expect(shortPr(null)).toBe("-");
  expect(shortPr("some-ref")).toBe("some-ref");
});

test("clip flattens whitespace and caps a long reason so the table stays pasteable", () => {
  const long = "a".repeat(200);
  expect(clip(long).length).toBeLessThanOrEqual(60);
  expect(clip(long).endsWith("…")).toBe(true);
  expect(clip("multi\n  line  reason")).toBe("multi line reason");
});

test("detailed table carries branch + PR columns; compact drops them", () => {
  const det = renderTable(report(), "detailed", false).join("\n");
  expect(det).toContain("BRANCH");
  expect(det).toContain("#29");
  const comp = renderTable(report(), "compact", false).join("\n");
  expect(comp).not.toContain("BRANCH");
  expect(comp).toContain("WHO");
});

test("detailed table shows a compact ENV column: model short, effort only when it deviates", () => {
  // Envelope is near-constant (claude-code+opus+reasoning); the table shows the
  // model short and highlights only the exception (ultracode / non-default harness).
  const normal = renderTable(report({ units: [unit()] }), "detailed", false).join("\n");
  expect(normal).toContain("ENV");
  expect(normal).toContain("opus-4-8"); // "claude-" prefix stripped
  expect(normal).not.toContain("ultra");
  const ultra = renderTable(report({ units: [unit({ intensity: "ultracode" })] }), "detailed", false).join("\n");
  expect(ultra).toContain("ultra");
  const compact = renderTable(report(), "compact", false).join("\n");
  expect(compact).not.toContain("ENV");
});

test("a legacy unit with no envelope renders '-' in ENV, never an invented value", () => {
  const legacy = renderTable(report({ units: [unit({ harness: null, model: null, tier: null, intensity: null })] }), "detailed", false).join("\n");
  expect(legacy).toContain("ENV");
  expect(legacy).not.toContain("opus");
});

test("the elision line is printed when journeys were hidden (item 4)", () => {
  const r = report({ elision: { shownJourneys: 3, totalJourneys: 10, hiddenJourneys: 7, reason: "run `aipe status --all`" } });
  const text = renderTable(r, "detailed", false).join("\n");
  expect(text).toContain("7 journey(s) hidden");
});

test("the waiting section clips a paragraph-long reason (pasteable width)", () => {
  const r = report({
    waiting: [{ kind: "redirected", journey: "j-1", fqid: "aipe", specialist: "Jesse", detail: "x".repeat(300) }],
  });
  const text = renderTable(r, "detailed", false);
  expect(text.every((l) => l.length < 200)).toBe(true);
});

test("renderJson round-trips the report shape exactly (item 3 contract)", () => {
  const r = report();
  expect(JSON.parse(renderJson(r))).toEqual(r as unknown as Record<string, unknown>);
});

test("supportsColor is off without a TTY and under NO_COLOR", () => {
  expect(supportsColor({ isTTY: true }, {})).toBe(true);
  expect(supportsColor({ isTTY: false }, {})).toBe(false);
  expect(supportsColor({ isTTY: true }, { NO_COLOR: "1" })).toBe(false);
});
