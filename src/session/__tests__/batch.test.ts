import { expect, test } from "bun:test";
import { buildBatchArgs, buildRenameArgs, parseBatchOutput, startBatch } from "../batch";
import type { AgentopRunner } from "../types";

const units = [
  { harness: "claude", cwd: "/w/.worktrees/j1-joaquim", promptFile: "/w/.aipe/journeys/j1/prompts/embark.md" },
  { harness: "claude", cwd: "/w/.worktrees/j1-pedro", promptFile: "/w/.aipe/journeys/j1/prompts/prontuario.md" },
];

test("the argv files every session under one task and asks for json", () => {
  const args = buildBatchArgs("aipe/j1", undefined, units);
  expect(args.slice(0, 4)).toEqual(["session", "batch", "--task", "aipe/j1"]);
  expect(args).toContain("--json");
  expect(args.filter((a) => a === "--session")).toHaveLength(2);
});

test("each session is addressed as harness@cwd with a prompt FILE", () => {
  const args = buildBatchArgs("aipe/j1", undefined, units);
  expect(args).toContain("claude@/w/.worktrees/j1-joaquim: @/w/.aipe/journeys/j1/prompts/embark.md");
});

test("no brief content ever reaches argv", () => {
  const args = buildBatchArgs("aipe/j1", undefined, [
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
  const args = buildBatchArgs("aipe/j1", undefined, units);
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
  const args = buildBatchArgs("aipe/j1", undefined, units);
  for (const arg of args) {
    expect(arg.length).toBeLessThan(300);
  }
});

// `--model` is a WHOLE-BATCH flag on the real agentop binary (verified
// against v1.13.7's own usage text — see the comment on buildBatchArgs in
// ../batch.ts): given once, before the --session flags, applying to every
// session in that one call. There is no per-session override for it.
test("a whole-batch model is emitted once, before the --session flags", () => {
  const args = buildBatchArgs("aipe/j1", "claude-opus-4-8", [
    { harness: "claude", cwd: "/w/wt", promptFile: "/p.md" },
  ]);
  expect(args).toEqual([
    "session", "batch", "--task", "aipe/j1", "--model", "claude-opus-4-8", "--json",
    "--session", "claude@/w/wt: @/p.md",
  ]);
});

test("no model at all emits no --model flag", () => {
  const args = buildBatchArgs("aipe/j1", undefined, units);
  expect(args).not.toContain("--model");
});

// `--name` does not exist on `batch` in any form — confirmed live against the
// real binary: `agentop session batch --task probe-x --name foo --json
// --session "claude@/tmp: hi"` printed "--name is not accepted by batch —
// use --session for each one." and exited 1. buildBatchArgs must never emit
// it, and BatchUnit carries no field for it any more.
test("the argv never contains --name — batch has no way to name a session", () => {
  const args = buildBatchArgs("aipe/j1", undefined, units);
  expect(args).not.toContain("--name");
});

test("json output is parsed into started sessions", () => {
  const out = JSON.stringify({
    sessions: [
      { id: "s-1", harness: "claude", cwd: "/w/.worktrees/j1-joaquim" },
      { id: "s-2", harness: "claude", cwd: "/w/.worktrees/j1-pedro" },
    ],
  });
  expect(parseBatchOutput(out)).toEqual({
    sessions: [
      { id: "s-1", harness: "claude", cwd: "/w/.worktrees/j1-joaquim" },
      { id: "s-2", harness: "claude", cwd: "/w/.worktrees/j1-pedro" },
    ],
    malformed: 0,
  });
});

test("a bare json array is accepted too", () => {
  const out = JSON.stringify([{ id: "s-1", harness: "claude", cwd: "/x" }]);
  const result = parseBatchOutput(out);
  expect(result.sessions).toHaveLength(1);
  expect(result.malformed).toBe(0);
});

// agentop 1.22.4 no longer returns `[...]` / `{"sessions":[...]}` for
// `session batch --json` — it returns `{task, started, failed}`. The sessions
// in `started` are ALREADY RUNNING by the time this parses, so a throw here
// strands live sessions outside the ledger. Accept `started` as the session
// list. This payload is the real 1.22.4 output, verbatim.
test("the agentop 1.22.4 {task, started, failed} shape is parsed from `started`", () => {
  const out = JSON.stringify({
    task: "aipe/j-20260825-ot",
    started: [
      { id: "ade43e3ca6", harness: "claude", cwd: "/w/.worktrees/j-ot-jesse" },
    ],
    failed: [],
  });
  expect(parseBatchOutput(out)).toEqual({
    sessions: [{ id: "ade43e3ca6", harness: "claude", cwd: "/w/.worktrees/j-ot-jesse" }],
    malformed: 0,
  });
});

// A `started` array with several entries maps them all, in agentop's order.
test("the 1.22.4 shape maps every `started` entry, in order", () => {
  const out = JSON.stringify({
    task: "aipe/j1",
    started: [
      { id: "s-2", harness: "claude", cwd: "/w/.worktrees/j1-pedro" },
      { id: "s-1", harness: "gemini", cwd: "/w/.worktrees/j1-joaquim" },
    ],
    failed: [],
  });
  expect(parseBatchOutput(out).sessions).toEqual([
    { id: "s-2", harness: "claude", cwd: "/w/.worktrees/j1-pedro" },
    { id: "s-1", harness: "gemini", cwd: "/w/.worktrees/j1-joaquim" },
  ]);
});

// A `failed` entry is NOT a `started` session, so it never lands in the parsed
// list — the unit that failed to start simply has no session, and the caller's
// existing per-unit "no session for <fqid>" path reports it. A failed entry is
// a legitimate outcome, not a malformed record: it must not inflate `malformed`.
test("the 1.22.4 shape ignores `failed` entries (they are not started sessions, not malformed)", () => {
  const out = JSON.stringify({
    task: "aipe/j1",
    started: [{ id: "s-1", harness: "claude", cwd: "/w/.worktrees/j1-joaquim" }],
    failed: [{ harness: "claude", cwd: "/w/.worktrees/j1-pedro", error: "boom" }],
  });
  expect(parseBatchOutput(out)).toEqual({
    sessions: [{ id: "s-1", harness: "claude", cwd: "/w/.worktrees/j1-joaquim" }],
    malformed: 0,
  });
});

// A well-formed but empty `started` (everything failed, or nothing requested)
// is a legitimately-empty result, exactly like [] or {"sessions":[]} — it must
// resolve normally, NOT throw as an unrecognised shape.
test("the 1.22.4 shape with an empty `started` resolves as empty, not a throw", () => {
  const out = JSON.stringify({ task: "aipe/j1", started: [], failed: [{ cwd: "/w/x", error: "boom" }] });
  expect(parseBatchOutput(out)).toEqual({ sessions: [], malformed: 0 });
});

// The per-entry malformed rules still apply inside `started`.
test("a malformed entry inside `started` is still counted as malformed", () => {
  const out = JSON.stringify({
    task: "aipe/j1",
    started: [
      { id: "s-1", harness: "claude", cwd: "/w/.worktrees/j1-joaquim" },
      { id: "s-2", harness: "claude" }, // missing cwd
    ],
    failed: [],
  });
  const result = parseBatchOutput(out);
  expect(result.sessions).toEqual([{ id: "s-1", harness: "claude", cwd: "/w/.worktrees/j1-joaquim" }]);
  expect(result.malformed).toBe(1);
});

// An object that has NEITHER `sessions` NOR `started` is still an unrecognised
// shape and must still throw — accepting `started` must not loosen this.
test("an object with neither a sessions nor a started array still throws", () => {
  expect(() => parseBatchOutput(JSON.stringify({ task: "aipe/j1", failed: [] }))).toThrow(/unexpected shape/);
});

// RISK (see task report): startBatch's caller pairs the returned list
// positionally with the requested units. parseBatchOutput does not restore
// order or pad missing entries — it returns exactly what agentop reports, in
// the order agentop reports it. These two tests pin that behaviour so a
// change here is visible, not silent.
test("fewer sessions than requested are returned as-is, not padded", () => {
  const out = JSON.stringify({ sessions: [{ id: "s-1", harness: "claude", cwd: "/w/.worktrees/j1-joaquim" }] });
  expect(parseBatchOutput(out)).toEqual({
    sessions: [{ id: "s-1", harness: "claude", cwd: "/w/.worktrees/j1-joaquim" }],
    malformed: 0,
  });
});

test("sessions out of request order are returned in agentop's order, not re-sorted", () => {
  const out = JSON.stringify({
    sessions: [
      { id: "s-2", harness: "claude", cwd: "/w/.worktrees/j1-pedro" },
      { id: "s-1", harness: "claude", cwd: "/w/.worktrees/j1-joaquim" },
    ],
  });
  expect(parseBatchOutput(out).sessions.map((s) => s.id)).toEqual(["s-2", "s-1"]);
});

test("an entry missing cwd is dropped, not defaulted to an empty string", () => {
  const out = JSON.stringify({ sessions: [{ id: "s-1", harness: "claude" }] });
  const result = parseBatchOutput(out);
  expect(result.sessions).toEqual([]);
  expect(result.malformed).toBe(1);
});

test("an entry with a non-string cwd is dropped", () => {
  const out = JSON.stringify({ sessions: [{ id: "s-1", harness: "claude", cwd: 42 }] });
  const result = parseBatchOutput(out);
  expect(result.sessions).toEqual([]);
  expect(result.malformed).toBe(1);
});

test("an entry with an empty-string cwd is dropped, not pushed through", () => {
  const out = JSON.stringify({ sessions: [{ id: "s-1", harness: "claude", cwd: "" }] });
  const result = parseBatchOutput(out);
  expect(result.sessions).toEqual([]);
  expect(result.malformed).toBe(1);
});

test("an entry with an empty-string id is dropped, not pushed through", () => {
  const out = JSON.stringify({ sessions: [{ id: "", harness: "claude", cwd: "/w/.worktrees/j1-joaquim" }] });
  const result = parseBatchOutput(out);
  expect(result.sessions).toEqual([]);
  expect(result.malformed).toBe(1);
});

test("two entries with cwd: \"\" do not collide into sessions together", () => {
  const out = JSON.stringify({
    sessions: [
      { id: "s-1", harness: "claude", cwd: "" },
      { id: "s-2", harness: "claude", cwd: "" },
    ],
  });
  const result = parseBatchOutput(out);
  expect(result.sessions).toEqual([]);
  expect(result.malformed).toBe(2);
});

test("a mixed response keeps the usable sessions and counts the rest as malformed", () => {
  const out = JSON.stringify({
    sessions: [
      { id: "s-1", harness: "claude", cwd: "/w/.worktrees/j1-joaquim" },
      { id: "s-2", harness: "claude" }, // missing cwd
      { harness: "claude", cwd: "/w/.worktrees/j1-pedro" }, // missing id
      { id: "s-4", harness: "claude", cwd: "/w/.worktrees/j1-x" },
      "not-even-an-object",
    ],
  });
  const result = parseBatchOutput(out);
  expect(result.sessions).toEqual([
    { id: "s-1", harness: "claude", cwd: "/w/.worktrees/j1-joaquim" },
    { id: "s-4", harness: "claude", cwd: "/w/.worktrees/j1-x" },
  ]);
  expect(result.malformed).toBe(3);
});

test("an entry missing harness defaults to claude (not a pairing key)", () => {
  const out = JSON.stringify({ sessions: [{ id: "s-1", cwd: "/w/.worktrees/j1-joaquim" }] });
  const result = parseBatchOutput(out);
  expect(result.sessions).toEqual([{ id: "s-1", harness: "claude", cwd: "/w/.worktrees/j1-joaquim" }]);
  expect(result.malformed).toBe(0);
});

test("unparseable stdout on a successful exit throws instead of resolving as empty", () => {
  expect(() => parseBatchOutput("not json at all")).toThrow(/unparseable/);
});

test("unparseable stdout includes what agentop actually printed, truncated", () => {
  const garbage = "x".repeat(1000);
  try {
    parseBatchOutput(garbage);
    throw new Error("expected parseBatchOutput to throw");
  } catch (err) {
    const message = (err as Error).message;
    expect(message).toContain("x".repeat(50));
    expect(message.length).toBeLessThan(garbage.length);
  }
});

test("a well-formed empty array result still resolves normally", () => {
  expect(parseBatchOutput("[]")).toEqual({ sessions: [], malformed: 0 });
});

test("a well-formed empty sessions object still resolves normally", () => {
  expect(parseBatchOutput(JSON.stringify({ sessions: [] }))).toEqual({ sessions: [], malformed: 0 });
});

// Valid JSON of a top-level shape we don't recognise (no array, no
// `sessions` array) must not silently read as "zero sessions" — that's
// indistinguishable from a genuinely empty, well-formed result. It throws,
// the same way unparseable JSON does.
test("a top-level null throws instead of resolving as empty", () => {
  expect(() => parseBatchOutput("null")).toThrow(/unexpected shape/);
});

test("a top-level empty object throws instead of resolving as empty", () => {
  expect(() => parseBatchOutput("{}")).toThrow(/unexpected shape/);
});

test("a top-level object without a sessions array throws instead of resolving as empty", () => {
  expect(() => parseBatchOutput(JSON.stringify({ error: "boom" }))).toThrow(/unexpected shape/);
});

test("a top-level number throws instead of resolving as empty", () => {
  expect(() => parseBatchOutput("42")).toThrow(/unexpected shape/);
});

test("a top-level string throws instead of resolving as empty", () => {
  expect(() => parseBatchOutput(JSON.stringify("a string"))).toThrow(/unexpected shape/);
});

test("startBatch surfaces a non-zero exit as an error", async () => {
  const failing: AgentopRunner = async () => ({ code: 1, stdout: "", stderr: "boom" });
  await expect(startBatch("aipe/j1", units, failing)).rejects.toThrow("boom");
});

test("startBatch surfaces malformed entries to the caller alongside the usable sessions", async () => {
  const mixed: AgentopRunner = async () => ({
    code: 0,
    stdout: JSON.stringify({
      sessions: [
        { id: "s-1", harness: "claude", cwd: "/w/.worktrees/j1-joaquim" },
        { id: "s-2", harness: "claude" }, // missing cwd
      ],
    }),
    stderr: "",
  });
  const result = await startBatch("aipe/j1", units, mixed);
  expect(result.sessions).toEqual([{ id: "s-1", harness: "claude", cwd: "/w/.worktrees/j1-joaquim" }]);
  expect(result.malformed).toBe(1);
});

test("startBatch throws when agentop exits 0 but prints unparseable stdout", async () => {
  const garbled: AgentopRunner = async () => ({ code: 0, stdout: "{not json", stderr: "" });
  await expect(startBatch("aipe/j1", units, garbled)).rejects.toThrow(/unparseable/);
});

// `--model` cannot bind per unit on the real `batch` command (see the
// comment on buildBatchArgs) — a wave whose session-mode units genuinely
// disagree on model cannot be expressed as one `batch` call. startBatch must
// refuse loudly, and — the part that matters — do it WITHOUT ever invoking
// the runner, so nothing is started under the wrong model and there is
// nothing to orphan.
test("startBatch refuses a mixed-model wave without ever invoking the runner", async () => {
  let called = false;
  const runner: AgentopRunner = async () => {
    called = true;
    return { code: 0, stdout: "[]", stderr: "" };
  };
  const mixed = [
    { harness: "claude", cwd: "/w/a", promptFile: "/a.md", model: "claude-opus-4-8" },
    { harness: "gemini", cwd: "/w/b", promptFile: "/b.md", model: "gemini-2.5-pro" },
  ];
  await expect(startBatch("aipe/j1", mixed, runner)).rejects.toThrow(/disagree on model/);
  expect(called).toBe(false);
});

// buildRenameArgs — verified against the real agentop v1.18.2 binary (see
// its own header comment): `agentop session rename <id|name> "label"` is two
// bare positional arguments after the `session rename` subcommand, no flags.
test("buildRenameArgs produces the exact positional argv agentop expects", () => {
  expect(buildRenameArgs("s-1", "embark@Joaquim")).toEqual(["session", "rename", "s-1", "embark@Joaquim"]);
});

test("buildRenameArgs never contains --name — the batch-only flag that does not exist on rename either", () => {
  expect(buildRenameArgs("s-1", "embark@Joaquim")).not.toContain("--name");
});

// A label built from a specialist with spaces (e.g. "Ana Paula") must survive
// as ONE argv element — `Bun.spawn` never re-parses argv through a shell, so
// unlike the recovery-command strings in cli.ts, no quoting is needed or
// wanted here; quoting it would embed literal quote characters in the label
// agentop actually stores.
test("a label containing spaces stays a single argv element, unquoted", () => {
  const args = buildRenameArgs("s-1", "embark@Ana Paula");
  expect(args).toEqual(["session", "rename", "s-1", "embark@Ana Paula"]);
  expect(args).toHaveLength(4);
});

test("startBatch accepts a wave where every model-bearing unit agrees, mixed with model-less units", async () => {
  const capturing: AgentopRunner = async (args) => ({ code: 0, stdout: "[]", stderr: "" });
  const uniform = [
    { harness: "claude", cwd: "/w/a", promptFile: "/a.md", model: "claude-opus-4-8" },
    { harness: "claude", cwd: "/w/b", promptFile: "/b.md" },
    { harness: "claude", cwd: "/w/c", promptFile: "/c.md", model: "claude-opus-4-8" },
  ];
  const result = await startBatch("aipe/j1", uniform, capturing);
  expect(result).toEqual({ sessions: [], malformed: 0 });
});
