import { expect, test } from "bun:test";
import { buildBatchArgs, parseBatchOutput, startBatch } from "../batch";
import type { AgentopRunner } from "../types";

const units = [
  { harness: "claude", cwd: "/w/.worktrees/j1-joaquim", promptFile: "/w/.aipe/journeys/j1/prompts/embark.md" },
  { harness: "claude", cwd: "/w/.worktrees/j1-pedro", promptFile: "/w/.aipe/journeys/j1/prompts/prontuario.md" },
];

test("the argv files every session under one task and asks for json", () => {
  const args = buildBatchArgs("aipe/j1", units);
  expect(args.slice(0, 4)).toEqual(["session", "batch", "--task", "aipe/j1"]);
  expect(args).toContain("--json");
  expect(args.filter((a) => a === "--session")).toHaveLength(2);
});

test("each session is addressed as harness@cwd with a prompt FILE", () => {
  const args = buildBatchArgs("aipe/j1", units);
  expect(args).toContain("claude@/w/.worktrees/j1-joaquim: @/w/.aipe/journeys/j1/prompts/embark.md");
});

test("no brief content ever reaches argv", () => {
  const args = buildBatchArgs("aipe/j1", [
    { harness: "claude", cwd: "/w/wt", promptFile: "/w/.aipe/journeys/j1/prompts/embark.md" },
  ]);
  for (const arg of args) {
    expect(arg).not.toContain("You are");
    expect(arg).not.toContain("\n");
  }
});

// The weaker assertions above (not.toContain("You are")/("\n")) only catch a
// brief that happens to contain those substrings — they'd pass even if a full
// multi-line brief leaked in, as long as it avoided those two strings. Pin the
// actual property instead: every --session value is exactly `harness@cwd:
// @promptFile` (bounded by the inputs' own lengths), and no argv element is
// implausibly long for a path/flag — the shape a 40-line inlined brief could
// never fit.
test("every --session value is exactly harness@cwd with an @-prefixed path, nothing more", () => {
  const args = buildBatchArgs("aipe/j1", units);
  const sessionValues = args.filter((_, i) => args[i - 1] === "--session");
  expect(sessionValues).toEqual([
    "claude@/w/.worktrees/j1-joaquim: @/w/.aipe/journeys/j1/prompts/embark.md",
    "claude@/w/.worktrees/j1-pedro: @/w/.aipe/journeys/j1/prompts/prontuario.md",
  ]);
  for (let i = 0; i < sessionValues.length; i++) {
    const value = sessionValues[i]!;
    const unit = units[i]!;
    expect(value).toBe(`${unit.harness}@${unit.cwd}: @${unit.promptFile}`);
    expect(value.endsWith(`@${unit.promptFile}`)).toBe(true);
    // A path plausibly runs a couple hundred characters at most; a 40-line
    // brief inlined here would run into the thousands.
    expect(value.length).toBeLessThan(300);
  }
});

test("no argv element anywhere is long enough to be inlined prompt content", () => {
  const args = buildBatchArgs("aipe/j1", units);
  for (const arg of args) {
    expect(arg.length).toBeLessThan(300);
  }
});

test("a per-unit model is passed through", () => {
  const args = buildBatchArgs("aipe/j1", [
    { harness: "claude", cwd: "/w/wt", promptFile: "/p.md", model: "claude-opus-4-8" },
  ]);
  expect(args).toContain("--model");
  expect(args).toContain("claude-opus-4-8");
});

test("json output is parsed into started sessions", () => {
  const out = JSON.stringify({
    sessions: [
      { id: "s-1", harness: "claude", cwd: "/w/.worktrees/j1-joaquim" },
      { id: "s-2", harness: "claude", cwd: "/w/.worktrees/j1-pedro" },
    ],
  });
  expect(parseBatchOutput(out)).toEqual([
    { id: "s-1", harness: "claude", cwd: "/w/.worktrees/j1-joaquim" },
    { id: "s-2", harness: "claude", cwd: "/w/.worktrees/j1-pedro" },
  ]);
});

test("a bare json array is accepted too", () => {
  const out = JSON.stringify([{ id: "s-1", harness: "claude", cwd: "/x" }]);
  expect(parseBatchOutput(out)).toHaveLength(1);
});

// RISK (see task report): startBatch's caller pairs the returned list
// positionally with the requested units. parseBatchOutput does not restore
// order or pad missing entries — it returns exactly what agentop reports, in
// the order agentop reports it. These two tests pin that behaviour so a
// change here is visible, not silent.
test("fewer sessions than requested are returned as-is, not padded", () => {
  const out = JSON.stringify({ sessions: [{ id: "s-1", harness: "claude", cwd: "/w/.worktrees/j1-joaquim" }] });
  expect(parseBatchOutput(out)).toEqual([{ id: "s-1", harness: "claude", cwd: "/w/.worktrees/j1-joaquim" }]);
});

test("sessions out of request order are returned in agentop's order, not re-sorted", () => {
  const out = JSON.stringify({
    sessions: [
      { id: "s-2", harness: "claude", cwd: "/w/.worktrees/j1-pedro" },
      { id: "s-1", harness: "claude", cwd: "/w/.worktrees/j1-joaquim" },
    ],
  });
  expect(parseBatchOutput(out).map((s) => s.id)).toEqual(["s-2", "s-1"]);
});

test("startBatch surfaces a non-zero exit as an error", async () => {
  const failing: AgentopRunner = async () => ({ code: 1, stdout: "", stderr: "boom" });
  await expect(startBatch("aipe/j1", units, failing)).rejects.toThrow("boom");
});
