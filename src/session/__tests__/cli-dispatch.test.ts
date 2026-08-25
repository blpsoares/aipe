import { expect, mock, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dispatchCommand } from "../cli";
import * as ledgerModule from "../../journey/ledger";
import { readLedger, recordDispatch, startJourney } from "../../journey/ledger";
import { run as journeyRun } from "../../journey/cli";
import * as registryModule from "../../harness/registry";
import { claudeCodeAdapter } from "../../harness/claude-code";
import type { HarnessAdapter } from "../../harness/types";
import type { AgentopRunner } from "../types";

async function fixture(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "aipe-sess-dispatch-"));
  await mkdir(join(dir, "embark", ".claude", "skills", "joaquim"), { recursive: true });
  await writeFile(
    join(dir, "embark", ".claude", "skills", "joaquim", "SKILL.md"),
    "---\nname: joaquim\n---\n\nYou are Joaquim.\n",
    "utf8",
  );
  await mkdir(join(dir, ".aipe", "journeys", "j1"), { recursive: true });
  await writeFile(join(dir, ".aipe", "journeys", "j1", "orientation.md"), "## embark\nFix it.\n", "utf8");
  await startJourney(dir, "j1");
  await recordDispatch(dir, "j1", {
    repo: "embark", specialist: "Joaquim", branch: "aipe/j1/joaquim",
    worktree: join(dir, ".worktrees", "j1-joaquim"), status: "dispatched",
    mode: "session", intensity: "ultracode", harness: "claude-code",
  });
  return dir;
}

// A real `agentop session batch --json` echoes back the cwd each session was
// actually started in — that echo is what dispatchCommand pairs against (by
// cwd, never by position; see cli.ts). A mock that returns an unrelated fixed
// cwd would silently defeat that pairing and this fixture would still "pass"
// with a broken implementation, so it parses the real `--session` flags sent
// and answers with the matching cwd, one synthetic session id per flag.
const okRunner: AgentopRunner = async (args) => {
  if (args[0] === "--version") return { code: 0, stdout: "agentop v1.9.0", stderr: "" };
  const sessions = args
    .filter((_, i) => args[i - 1] === "--session")
    .map((flag, i) => {
      const m = /^[^@]+@(.+): @.+$/.exec(flag);
      if (!m) throw new Error(`okRunner: could not parse --session flag: ${flag}`);
      return { id: `s-${i + 1}`, harness: "claude", cwd: m[1] };
    });
  return { code: 0, stdout: JSON.stringify({ sessions }), stderr: "" };
};

test("it writes a prompt file per unit and records the session id", async () => {
  const dir = await fixture();
  const r = await dispatchCommand({ workspace: dir, journeyId: "j1", runner: okRunner });
  expect(r.code).toBe(0);

  const prompt = await readFile(join(dir, ".aipe", "journeys", "j1", "prompts", "embark.md"), "utf8");
  expect(prompt).toContain("You are Joaquim.");
  expect(prompt).toContain("ultracode");

  const ledger = await readLedger(dir, "j1");
  expect(ledger!.dispatches[0]!.sessionId).toBe("s-1");
});

// D1 end-to-end (not just at the parseBatchOutput boundary): agentop 1.22.4
// returns `{task, started, failed}` from `session batch --json`, and its
// sessions are ALREADY RUNNING when dispatchCommand parses. Before the fix
// this threw an "unrecognised shape" error, leaving the live session with no
// sessionId in the ledger — invisible to `aipe session collect`. This proves
// the whole dispatch path records the id from the real 1.22.4 shape.
test("a dispatch whose agentop returns the 1.22.4 {started} shape records the running session id in the ledger", async () => {
  const dir = await fixture();
  const startedShapeRunner: AgentopRunner = async (args) => {
    if (args[0] === "--version") return { code: 0, stdout: "agentop v1.22.4", stderr: "" };
    const started = args
      .filter((_, i) => args[i - 1] === "--session")
      .map((flag, i) => {
        const m = /^[^@]+@(.+): @.+$/.exec(flag);
        if (!m) throw new Error(`startedShapeRunner: could not parse --session flag: ${flag}`);
        return { id: `s-${i + 1}`, harness: "claude", cwd: m[1] };
      });
    // The exact 1.22.4 envelope: task + started + failed (not `sessions`).
    return { code: 0, stdout: JSON.stringify({ task: "aipe/j1", started, failed: [] }), stderr: "" };
  };

  const r = await dispatchCommand({ workspace: dir, journeyId: "j1", runner: startedShapeRunner });
  expect(r.code).toBe(0);
  expect(r.lines).toContain("OK embark → s-1");

  const ledger = await readLedger(dir, "j1");
  expect(ledger!.dispatches[0]!.sessionId).toBe("s-1");
});

// Finding D (whole-branch review): dispatchCommand's post-batch write used to
// replay the WHOLE dispatch entry read at the top of the function, before
// `startBatch` — but every session in the wave is already running by the
// time that write happens, so a fast specialist can race ahead and record
// its own status change first. `recordDispatch` merges, but only
// tier/model/mode/intensity/harness/sessionId are sticky; `status` and the
// reason fields are a plain replace — so replaying the stale snapshot would
// stomp a real "redirected" (with its reason) back to "dispatched" with no
// evidence of either the redirect or its reason ever having happened. This
// proves the fix: the runner records a redirect DURING the batch call
// (simulating the specialist racing ahead of dispatchCommand's own
// bookkeeping), and only `sessionId` must land on top of it.
test("a unit that races ahead and records itself redirected before dispatchCommand's own write is not clobbered back to dispatched", async () => {
  const dir = await fixture();
  const racingRunner: AgentopRunner = async (args) => {
    if (args[0] === "--version") return { code: 0, stdout: "agentop v1.9.0", stderr: "" };
    // The session is already running by the time agentop's batch call
    // returns. Simulate it racing ahead of dispatchCommand's own post-batch
    // recording loop by writing a redirect to the SAME unit right here.
    await recordDispatch(dir, "j1", {
      repo: "embark", specialist: "Joaquim", branch: "aipe/j1/joaquim",
      worktree: join(dir, ".worktrees", "j1-joaquim"), status: "redirected",
      redirectReason: "PE asked for a different approach mid-flight",
    });
    const sessions = args
      .filter((_, i) => args[i - 1] === "--session")
      .map((flag, i) => {
        const m = /^[^@]+@(.+): @.+$/.exec(flag);
        if (!m) throw new Error(`racingRunner: could not parse --session flag: ${flag}`);
        return { id: `s-${i + 1}`, harness: "claude", cwd: m[1] };
      });
    return { code: 0, stdout: JSON.stringify({ sessions }), stderr: "" };
  };

  const r = await dispatchCommand({ workspace: dir, journeyId: "j1", runner: racingRunner });
  expect(r.code).toBe(0);

  const ledger = await readLedger(dir, "j1");
  expect(ledger!.dispatches).toHaveLength(1);
  expect(ledger!.dispatches[0]!.status).toBe("redirected");
  expect(ledger!.dispatches[0]!.redirectReason).toBe("PE asked for a different approach mid-flight");
  // The only thing this call was actually meant to add.
  expect(ledger!.dispatches[0]!.sessionId).toBe("s-1");
});

test("it refuses when agentop is unavailable, and records nothing", async () => {
  const dir = await fixture();
  const missing: AgentopRunner = async () => { throw new Error("ENOENT"); };
  const r = await dispatchCommand({ workspace: dir, journeyId: "j1", runner: missing });
  expect(r.code).toBe(1);
  expect(r.lines).toEqual([
    "ERROR agentop: not-installed — install or upgrade agentop, or dispatch in subagent mode",
  ]);
  expect((await readLedger(dir, "j1"))!.dispatches[0]!.sessionId).toBeUndefined();
  // Nothing recorded means nothing written either: a probe failure must abort
  // before a single prompt file — the audit trail of what a specialist was
  // told — is ever produced.
  await expect(readdir(join(dir, ".aipe", "journeys", "j1", "prompts"))).rejects.toThrow();
});

test("a unit already carrying a session id is not dispatched twice", async () => {
  const dir = await fixture();
  const first = await dispatchCommand({ workspace: dir, journeyId: "j1", runner: okRunner });
  expect(first.code).toBe(0);
  const second = await dispatchCommand({ workspace: dir, journeyId: "j1", runner: okRunner });
  expect(second.code).toBe(0);
  expect(second.lines).toEqual(["OK nothing to dispatch"]);
  // The guard must be silent about the already-dispatched unit, not merely
  // avoid re-recording it: a second "OK embark → s-1" line here would mean
  // agentop was asked to start a second real session for the same unit.
  const files = await readdir(join(dir, ".aipe", "journeys", "j1", "prompts"));
  expect(files).toEqual(["embark.md"]);
});

test("an orientation.md that exists but is blank is treated as missing, and nothing is recorded or written", async () => {
  const dir = await fixture();
  await writeFile(join(dir, ".aipe", "journeys", "j1", "orientation.md"), "   \n\n", "utf8");
  const r = await dispatchCommand({ workspace: dir, journeyId: "j1", runner: okRunner });
  expect(r.code).toBe(1);
  expect(r.lines).toEqual([
    "ERROR spec: orientation.md is empty — write and approve the Orientation Spec first",
  ]);
  expect((await readLedger(dir, "j1"))!.dispatches[0]!.sessionId).toBeUndefined();
  await expect(readdir(join(dir, ".aipe", "journeys", "j1", "prompts"))).rejects.toThrow();
});

test("a missing persona for one of three units leaves no orphaned prompt file for the others", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-sess-dispatch-"));
  for (const repo of ["a", "b", "c"]) {
    if (repo === "b") continue; // persona deliberately absent for "b"
    await mkdir(join(dir, repo, ".claude", "skills", repo), { recursive: true });
    await writeFile(join(dir, repo, ".claude", "skills", repo, "SKILL.md"), `---\nname: ${repo}\n---\n\nYou are ${repo}.\n`, "utf8");
  }
  await mkdir(join(dir, ".aipe", "journeys", "j1"), { recursive: true });
  await writeFile(
    join(dir, ".aipe", "journeys", "j1", "orientation.md"),
    "## a\nDo A.\n## b\nDo B.\n## c\nDo C.\n",
    "utf8",
  );
  await startJourney(dir, "j1");
  for (const repo of ["a", "b", "c"]) {
    await recordDispatch(dir, "j1", {
      repo, specialist: repo, branch: `aipe/j1/${repo}`,
      worktree: join(dir, ".worktrees", `j1-${repo}`), status: "dispatched",
      mode: "session", intensity: "normal", harness: "claude-code",
    });
  }

  const r = await dispatchCommand({ workspace: dir, journeyId: "j1", runner: okRunner });
  expect(r.code).toBe(1);
  expect(r.lines).toEqual(["ERROR persona: could not read the persona for b@b"]);

  // "a" was resolved before the failure on "b" was hit — a naive implementation
  // that writes each prompt file as it walks the loop would leave a.md behind,
  // an orphaned file implying a dispatch that never happened.
  await expect(readdir(join(dir, ".aipe", "journeys", "j1", "prompts"))).rejects.toThrow();
  const ledger = await readLedger(dir, "j1");
  expect(ledger!.dispatches.every((d) => d.sessionId === undefined)).toBe(true);
});

// Two namespaces: AIPe identifies a harness by its adapter id ("claude-code",
// "codex", …) — what the ledger's `harness` field stores; agentop identifies
// one by its own harness name ("claude", "codex", …). "claude-code" is NOT
// "claude". dispatchCommand must resolve the argv's harness name from the
// UNIT's recorded adapter id (via HarnessAdapter#agentopHarness), never from
// a literal — a unit approved for one harness must not silently start a
// session tagged for another. This test stands in for a second real adapter
// (Task 16 adds Codex) by registering a fake one whose agentopHarness differs
// from "claude", so it fails against a hardcoded literal regardless of which
// real adapters exist yet.
test("a unit whose harness is not claude-code produces its own agentop harness name in the argv, not a hardcoded literal", async () => {
  const dir = await fixture();
  const acmeAdapter: HarnessAdapter = { ...claudeCodeAdapter, id: "acme", agentopHarness: "acme-agentop" };
  await recordDispatch(dir, "j1", {
    repo: "embark", specialist: "Joaquim", branch: "aipe/j1/joaquim",
    worktree: join(dir, ".worktrees", "j1-joaquim"), status: "dispatched",
    mode: "session", intensity: "ultracode", harness: "acme",
  });

  // Snapshot the REAL getAdapter as a plain function reference before
  // mocking, not via `registryModule.getAdapter` inside the override itself:
  // `registryModule` is a live binding onto the module record mock.module()
  // patches in place, so once mocked, `registryModule.getAdapter` IS the
  // override below — falling back to it from inside itself would recurse
  // forever instead of reaching the original implementation (see the
  // identical note on `realRecordDispatch` elsewhere in this file).
  const realGetAdapter = registryModule.getAdapter;
  mock.module("../../harness/registry", () => ({
    ...registryModule,
    getAdapter: (id: string | null | undefined) => (id === "acme" ? acmeAdapter : realGetAdapter(id)),
  }));
  try {
    let capturedArgs: string[] = [];
    const capturingRunner: AgentopRunner = async (args) => {
      if (args[0] === "--version") return { code: 0, stdout: "agentop v1.9.0", stderr: "" };
      // dispatchCommand also issues a `session rename` call per started
      // session after the batch call returns (see the rename step in
      // dispatchCommand) — that call has no `--session` flag in its argv, so
      // it must not overwrite what this test actually wants to inspect: the
      // batch call's own argv.
      if (args.includes("--session")) capturedArgs = args;
      return okRunner(args);
    };
    const r = await dispatchCommand({ workspace: dir, journeyId: "j1", runner: capturingRunner });
    expect(r.code).toBe(0);
    const sessionFlag = capturedArgs[capturedArgs.indexOf("--session") + 1]!;
    expect(sessionFlag.startsWith("acme-agentop@")).toBe(true);
    expect(sessionFlag.startsWith("claude@")).toBe(false);
  } finally {
    // Restore to the real implementation explicitly — `() => registryModule`
    // would be a no-op (same live-binding trap) and leave the mock wired in
    // for every later test in this file.
    mock.module("../../harness/registry", () => ({ ...registryModule, getAdapter: realGetAdapter }));
  }
});

// Parses a shell command line into argv the way a POSIX shell actually would:
// single-quoted segments are literal (the only escape recognized inside them
// is the classic `'\''` close-escape-reopen idiom), double-quoted segments
// honor backslash-escaping of `"`, `\`, `$` and backtick, and a backslash
// outside any quotes escapes the next character. Adjacent quoted/unquoted
// runs with no separating whitespace concatenate into one word, exactly as a
// real shell does. This replaces a naive `.split(" ")`, which would treat
// every space inside a quoted value as a new argv element and silently
// truncate any multi-word value — the exact bug Finding 3 is about, so the
// test's own argv construction must not reintroduce it.
function shellSplit(cmd: string): string[] {
  const args: string[] = [];
  let cur = "";
  let inWord = false;
  let i = 0;
  while (i < cmd.length) {
    const c = cmd[i];
    if (c === " " || c === "\t") {
      if (inWord) { args.push(cur); cur = ""; inWord = false; }
      i++;
      continue;
    }
    inWord = true;
    if (c === "'") {
      i++;
      while (i < cmd.length && cmd[i] !== "'") { cur += cmd[i]; i++; }
      i++; // skip closing quote
      continue;
    }
    if (c === '"') {
      i++;
      while (i < cmd.length && cmd[i] !== '"') {
        if (cmd[i] === "\\" && i + 1 < cmd.length && ['"', "\\", "$", "`"].includes(cmd[i + 1]!)) {
          cur += cmd[i + 1];
          i += 2;
        } else {
          cur += cmd[i];
          i++;
        }
      }
      i++; // skip closing quote
      continue;
    }
    if (c === "\\" && i + 1 < cmd.length) {
      cur += cmd[i + 1];
      i += 2;
      continue;
    }
    cur += c;
    i++;
  }
  if (inWord) args.push(cur);
  return args;
}

test("shellSplit reconstructs a value with spaces, an apostrophe and a double quote", () => {
  // Sanity-checks the test helper itself against the exact quoting style
  // shQuote (src/session/cli.ts) produces: single-quoted, with an embedded
  // single quote escaped via close-escape-reopen.
  const awkward = `Ana Paula "the closer" O'Brien`;
  const quoted = `'${awkward.replace(/'/g, `'\\''`)}'`;
  expect(shellSplit(`--specialist ${quoted} --status dispatched`)).toEqual([
    "--specialist",
    awkward,
    "--status",
    "dispatched",
  ]);
});

// Two units, "a" and "b", each with a real persona and a dispatched
// session-mode unit on the ledger. Used by the cwd-pairing tests below, which
// need at least two units to be able to tell "paired correctly" apart from
// "paired positionally but happened to line up".
async function twoUnitFixture(): Promise<{ dir: string; worktreeA: string; worktreeB: string }> {
  const dir = await mkdtemp(join(tmpdir(), "aipe-sess-dispatch-"));
  for (const repo of ["a", "b"]) {
    await mkdir(join(dir, repo, ".claude", "skills", repo), { recursive: true });
    await writeFile(join(dir, repo, ".claude", "skills", repo, "SKILL.md"), `---\nname: ${repo}\n---\n\nYou are ${repo}.\n`, "utf8");
  }
  await mkdir(join(dir, ".aipe", "journeys", "j1"), { recursive: true });
  await writeFile(join(dir, ".aipe", "journeys", "j1", "orientation.md"), "## a\nDo A.\n## b\nDo B.\n", "utf8");
  await startJourney(dir, "j1");
  const worktreeA = join(dir, ".worktrees", "j1-a");
  const worktreeB = join(dir, ".worktrees", "j1-b");
  for (const [repo, worktree] of [["a", worktreeA] as const, ["b", worktreeB] as const]) {
    await recordDispatch(dir, "j1", {
      repo, specialist: repo, branch: `aipe/j1/${repo}`,
      worktree, status: "dispatched",
      mode: "session", intensity: "normal", harness: "claude-code",
    });
  }
  return { dir, worktreeA, worktreeB };
}

// Parses the --session flags out of a batch invocation the same way okRunner
// does, returning one { id, cwd } per flag, id derived from which unit's cwd
// it is (not from position), so a wrong pairing downstream is visible in the
// asserted session id rather than only in an opaque "s-N".
function parseSessionFlags(args: string[]): { cwd: string }[] {
  return args
    .filter((_, i) => args[i - 1] === "--session")
    .map((flag) => {
      const m = /^[^@]+@(.+): @.+$/.exec(flag);
      const cwd = m?.[1];
      if (cwd === undefined) throw new Error(`could not parse --session flag: ${flag}`);
      return { cwd };
    });
}

test("sessions returned in reverse order are still paired to the correct unit by cwd", async () => {
  const { dir, worktreeA, worktreeB } = await twoUnitFixture();
  const reverseRunner: AgentopRunner = async (args) => {
    if (args[0] === "--version") return { code: 0, stdout: "agentop v1.9.0", stderr: "" };
    const flags = parseSessionFlags(args);
    const sessions = flags
      .map(({ cwd }) => ({ id: cwd === worktreeA ? "s-a" : cwd === worktreeB ? "s-b" : "s-unknown", harness: "claude", cwd }))
      .reverse(); // agentop answers out of request order — the pairing must not assume order
    return { code: 0, stdout: JSON.stringify({ sessions }), stderr: "" };
  };

  const r = await dispatchCommand({ workspace: dir, journeyId: "j1", runner: reverseRunner });
  expect(r.code).toBe(0);
  expect(r.lines).toEqual(["OK a → s-a", "OK b → s-b"]);

  const ledger = await readLedger(dir, "j1");
  const a = ledger!.dispatches.find((d) => d.repo === "a");
  const b = ledger!.dispatches.find((d) => d.repo === "b");
  expect(a!.sessionId).toBe("s-a");
  expect(b!.sessionId).toBe("s-b");
});

test("fewer sessions returned than requested: the unmatched unit gets an ERROR line, the matched one is still recorded, and the length mismatch is reported", async () => {
  const { dir, worktreeA } = await twoUnitFixture();
  const shortRunner: AgentopRunner = async (args) => {
    if (args[0] === "--version") return { code: 0, stdout: "agentop v1.9.0", stderr: "" };
    const flags = parseSessionFlags(args);
    // Only answer for "a" — agentop started fewer sessions than requested.
    const sessions = flags.filter(({ cwd }) => cwd === worktreeA).map(({ cwd }) => ({ id: "s-a", harness: "claude", cwd }));
    return { code: 0, stdout: JSON.stringify({ sessions }), stderr: "" };
  };

  const r = await dispatchCommand({ workspace: dir, journeyId: "j1", runner: shortRunner });
  expect(r.code).toBe(1);
  expect(r.lines).toEqual([
    "OK a → s-a",
    `ERROR session: agentop reported no session for b (${join(dir, ".worktrees", "j1-b")})`,
    "ERROR session: asked agentop for 2 sessions, it started 1",
  ]);

  const ledger = await readLedger(dir, "j1");
  const a = ledger!.dispatches.find((d) => d.repo === "a");
  const b = ledger!.dispatches.find((d) => d.repo === "b");
  expect(a!.sessionId).toBe("s-a");
  expect(b!.sessionId).toBeUndefined();
});

test("a returned session whose cwd matches no requesting unit leaves that unit with an ERROR line, even when the count matches", async () => {
  const { dir, worktreeA } = await twoUnitFixture();
  const wrongCwdRunner: AgentopRunner = async (args) => {
    if (args[0] === "--version") return { code: 0, stdout: "agentop v1.9.0", stderr: "" };
    const flags = parseSessionFlags(args);
    // Same count as requested (2), but "b"'s entry is answered with a cwd that
    // belongs to no unit in this wave — isolates the no-match branch from the
    // length-mismatch branch, which must NOT fire here.
    const sessions = flags.map(({ cwd }) =>
      cwd === worktreeA ? { id: "s-a", harness: "claude", cwd } : { id: "s-nowhere", harness: "claude", cwd: "/nowhere/nobody-requested-this" },
    );
    return { code: 0, stdout: JSON.stringify({ sessions }), stderr: "" };
  };

  const r = await dispatchCommand({ workspace: dir, journeyId: "j1", runner: wrongCwdRunner });
  expect(r.code).toBe(1);
  expect(r.lines).toEqual([
    "OK a → s-a",
    `ERROR session: agentop reported no session for b (${join(dir, ".worktrees", "j1-b")})`,
  ]);

  const ledger = await readLedger(dir, "j1");
  const a = ledger!.dispatches.find((d) => d.repo === "a");
  const b = ledger!.dispatches.find((d) => d.repo === "b");
  expect(a!.sessionId).toBe("s-a");
  expect(b!.sessionId).toBeUndefined();
});

test("a ledger write failure for one unit does not lose already-recorded sessions or stop the rest", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-sess-dispatch-"));
  for (const repo of ["a", "b", "c"]) {
    await mkdir(join(dir, repo, ".claude", "skills", repo), { recursive: true });
    await writeFile(join(dir, repo, ".claude", "skills", repo, "SKILL.md"), `---\nname: ${repo}\n---\n\nYou are ${repo}.\n`, "utf8");
  }
  await mkdir(join(dir, ".aipe", "journeys", "j1"), { recursive: true });
  await writeFile(
    join(dir, ".aipe", "journeys", "j1", "orientation.md"),
    "## a\nDo A.\n## b\nDo B.\n## c\nDo C.\n",
    "utf8",
  );
  await startJourney(dir, "j1");
  for (const repo of ["a", "b", "c"]) {
    await recordDispatch(dir, "j1", {
      repo, specialist: repo, branch: `aipe/j1/${repo}`,
      worktree: join(dir, ".worktrees", `j1-${repo}`), status: "dispatched",
      mode: "session", intensity: "normal", harness: "claude-code",
    });
  }

  const realRecordDispatch = ledgerModule.recordDispatch;
  let calls = 0;
  mock.module("../../journey/ledger", () => ({
    ...ledgerModule,
    recordDispatch: async (...args: Parameters<typeof realRecordDispatch>) => {
      calls += 1;
      // Fail exactly the second write — after one unit's session id has
      // already been committed to the ledger, and before the third is tried.
      if (calls === 2) throw new Error("simulated disk full");
      return realRecordDispatch(...args);
    },
  }));

  try {
    const r = await dispatchCommand({ workspace: dir, journeyId: "j1", runner: okRunner });
    expect(r.code).toBe(1);
    expect(r.lines.filter((l) => l.startsWith("OK ")).length).toBe(2);
    expect(r.lines.filter((l) => l.startsWith("ERROR ledger: ")).length).toBe(1);

    // Exactly two of the three sessions landed in the ledger (unit 2's write
    // failed) — the failure must not have aborted the loop before the third
    // unit, whose session agentop had already started, was even attempted.
    const ledger = await ledgerModule.readLedger(dir, "j1");
    const recorded = ledger!.dispatches.filter((d) => d.sessionId !== undefined);
    expect(recorded.length).toBe(2);
  } finally {
    // Restoring with `() => ledgerModule` (rather than a snapshot taken
    // before mocking) would be a no-op: `ledgerModule` is a live binding onto
    // the same module record mock.module() just patched in place, so by this
    // point `ledgerModule.recordDispatch` already IS the wrapper above, and
    // "restoring" to it would leave the throwing wrapper permanently wired
    // in for every later test in this file that imports `recordDispatch`.
    mock.module("../../journey/ledger", () => ({ ...ledgerModule, recordDispatch: realRecordDispatch }));
  }
});

// Finding 1: `recordDispatch` REPLACES the matching entry wholesale, not a
// merge. The recovery command printed on an ERROR ledger: line is meant to be
// run verbatim by an operator to repair a record for a session that is
// ALREADY running — so if it omits a field the record actually carries (e.g.
// `intensity`, `harness`), running it exactly as printed silently wipes that
// field. This is checked two ways: the exact text of the printed command, and
// — the part a text-only assertion cannot catch — actually executing that
// command through `aipe journey record`'s real `run()` and re-reading the
// ledger to prove the fields survived the round trip.
test("the ledger-write recovery command forwards intensity and harness, and running it verbatim restores them", async () => {
  const dir = await fixture(); // repo "embark", intensity "ultracode", harness "claude-code"
  const worktree = join(dir, ".worktrees", "j1-joaquim");

  // Snapshot the real implementation BEFORE mocking: `ledgerModule` is a live
  // binding onto the module record mock.module() patches in place, so once
  // mocked, `ledgerModule.recordDispatch` reflects the mock too. Only a
  // reference captured beforehand lets the round-trip call below reach the
  // genuine `aipe journey record` write path.
  const realRecordDispatch = ledgerModule.recordDispatch;
  mock.module("../../journey/ledger", () => ({
    ...ledgerModule,
    recordDispatch: async () => {
      throw new Error("simulated disk full");
    },
  }));

  let r: { code: number; lines: string[] };
  try {
    r = await dispatchCommand({ workspace: dir, journeyId: "j1", runner: okRunner });
  } finally {
    mock.module("../../journey/ledger", () => ({ ...ledgerModule, recordDispatch: realRecordDispatch }));
  }

  expect(r.code).toBe(1);
  const expectedRecordCmd = [
    "aipe journey record",
    "--journey 'j1'",
    `--workspace '${dir}'`,
    "--repo 'embark'",
    "--specialist 'Joaquim'",
    "--branch 'aipe/j1/joaquim'",
    `--worktree '${worktree}'`,
    "--status 'dispatched'",
    "--mode 'session'",
    "--intensity 'ultracode'",
    "--harness 'claude-code'",
    "--session-id 's-1'",
  ].join(" ");
  expect(r.lines).toEqual([
    `ERROR ledger: session s-1 for embark is running but could not be recorded (simulated disk full) — record it manually: ${expectedRecordCmd}`,
  ]);

  // The ledger write never landed (recordDispatch was made to throw above),
  // so the fixture's original entry — no sessionId — is still on disk.
  const before = await readLedger(dir, "j1");
  expect(before!.dispatches[0]!.sessionId).toBeUndefined();

  // Actually run the printed command through the real `aipe journey record`
  // (unmocked at this point), parsed the way a real shell would parse it —
  // not merely re-parsed by splitting on spaces — rather than only
  // re-checking its text.
  const args = shellSplit(expectedRecordCmd).slice(2); // drop "aipe", "journey" → ["record", ...]
  const recoveryCode = await journeyRun(args);
  expect(recoveryCode).toBe(0);

  const after = await readLedger(dir, "j1");
  const recovered = after!.dispatches.find((d) => d.repo === "embark");
  expect(recovered!.sessionId).toBe("s-1");
  expect(recovered!.intensity).toBe("ultracode");
  expect(recovered!.harness).toBe("claude-code");
  expect(recovered!.mode).toBe("session");
  expect(recovered!.status).toBe("dispatched");
  expect(recovered!.branch).toBe("aipe/j1/joaquim");
  expect(recovered!.worktree).toBe(worktree);
});

// Finding 3: values are concatenated into the recovery command with no
// escaping, and `getFlag` (both here and in src/journey/cli.ts) reads only
// the single token immediately after a flag — so a multi-word specialist, an
// evidence summary containing spaces and an apostrophe, or a value holding a
// double quote would each silently truncate at the first space if left
// unquoted. Truncation is worse than omission: it lands a plausible-looking
// but wrong value in the ledger. Checked the same way as the test above: the
// exact printed text, AND a real round trip through `aipe journey record`
// parsed with shell semantics — proving the awkward values survive intact,
// not merely that the printed string looks quoted.
test("the recovery command quotes a multi-word specialist, an evidence summary with an apostrophe, and a value containing a double quote — and they round-trip intact", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-sess-dispatch-"));
  await mkdir(join(dir, "embark", ".claude", "skills", "ana-paula"), { recursive: true });
  await writeFile(
    join(dir, "embark", ".claude", "skills", "ana-paula", "SKILL.md"),
    "---\nname: ana-paula\n---\n\nYou are Ana Paula.\n",
    "utf8",
  );
  await mkdir(join(dir, ".aipe", "journeys", "j1"), { recursive: true });
  await writeFile(join(dir, ".aipe", "journeys", "j1", "orientation.md"), "## embark\nFix it.\n", "utf8");
  await startJourney(dir, "j1");

  const worktree = join(dir, ".worktrees", "j1-ana-paula");
  const specialist = "Ana Paula";
  const summary = "all tests pass, and it's holding up";
  const evidenceCmd = 'bun test && echo "done"';
  const artifact = 'see "notes.md"';
  await recordDispatch(dir, "j1", {
    repo: "embark", specialist, branch: "aipe/j1/ana-paula",
    worktree, status: "dispatched",
    mode: "session", intensity: "normal", harness: "claude-code",
    evidence: { by: "dev", commands: [evidenceCmd], summary, artifact },
  });

  const realRecordDispatch = ledgerModule.recordDispatch;
  mock.module("../../journey/ledger", () => ({
    ...ledgerModule,
    recordDispatch: async () => {
      throw new Error("simulated disk full");
    },
  }));

  let r: { code: number; lines: string[] };
  try {
    r = await dispatchCommand({ workspace: dir, journeyId: "j1", runner: okRunner });
  } finally {
    mock.module("../../journey/ledger", () => ({ ...ledgerModule, recordDispatch: realRecordDispatch }));
  }

  expect(r.code).toBe(1);
  const expectedRecordCmd = [
    "aipe journey record",
    "--journey 'j1'",
    `--workspace '${dir}'`,
    "--repo 'embark'",
    "--specialist 'Ana Paula'",
    "--branch 'aipe/j1/ana-paula'",
    `--worktree '${worktree}'`,
    "--status 'dispatched'",
    "--mode 'session'",
    "--intensity 'normal'",
    "--harness 'claude-code'",
    "--session-id 's-1'",
    "--evidence-by 'dev'",
    `--evidence-summary 'all tests pass, and it'\\''s holding up'`,
    `--evidence-cmd 'bun test && echo "done"'`,
    `--evidence-artifact 'see "notes.md"'`,
  ].join(" ");
  expect(r.lines).toEqual([
    `ERROR ledger: session s-1 for embark is running but could not be recorded (simulated disk full) — record it manually: ${expectedRecordCmd}`,
  ]);

  // Actually run the printed command, shell-parsed, through the real
  // `aipe journey record`, and confirm every awkward value survived intact —
  // not merely that the printed text looked correctly quoted.
  const args = shellSplit(expectedRecordCmd).slice(2);
  const recoveryCode = await journeyRun(args);
  expect(recoveryCode).toBe(0);

  const after = await readLedger(dir, "j1");
  const recovered = after!.dispatches.find((d) => d.repo === "embark");
  expect(recovered!.sessionId).toBe("s-1");
  expect(recovered!.specialist).toBe("Ana Paula");
  expect(recovered!.evidence?.by).toBe("dev");
  expect(recovered!.evidence?.summary).toBe(summary);
  expect(recovered!.evidence?.commands).toEqual([evidenceCmd]);
  expect(recovered!.evidence?.artifact).toBe(artifact);
});

// Finding 2: `recordDispatchGuarded` (src/journey/ledger.ts) only writes
// `redispatchReason` when it detects a reopening transition — current ledger
// status delivered/verified moving back to `dispatched`. A unit already
// sitting at `dispatched` when its session-id write fails (this recovery
// path) is a no-op transition from the guard's point of view, so `--reason`
// cannot restore a `redispatchReason` the unit already carries (e.g. from an
// earlier genuine QA-rejection redispatch). Since it cannot be represented,
// dispatchCommand must say so explicitly rather than let it be silently lost.
test("a dispatch being recovered that carries a redispatchReason gets an explicit WARN line, since the recovery command cannot restore it", async () => {
  const dir = await fixture(); // repo "embark", specialist "Joaquim"
  const worktree = join(dir, ".worktrees", "j1-joaquim");
  // Simulate: this unit was delivered, QA rejected it, and it was
  // re-dispatched with a reason — landing back on "dispatched" with
  // `redispatchReason` set, exactly per the lifecycle in journey/types.ts.
  await recordDispatch(dir, "j1", {
    repo: "embark", specialist: "Joaquim", branch: "aipe/j1/joaquim",
    worktree, status: "dispatched",
    mode: "session", intensity: "ultracode", harness: "claude-code",
    redispatchReason: "QA found a regression in the retry path",
  });

  const realRecordDispatch = ledgerModule.recordDispatch;
  mock.module("../../journey/ledger", () => ({
    ...ledgerModule,
    recordDispatch: async () => {
      throw new Error("simulated disk full");
    },
  }));

  let r: { code: number; lines: string[] };
  try {
    r = await dispatchCommand({ workspace: dir, journeyId: "j1", runner: okRunner });
  } finally {
    mock.module("../../journey/ledger", () => ({ ...ledgerModule, recordDispatch: realRecordDispatch }));
  }

  expect(r.code).toBe(1);
  expect(r.lines.length).toBe(2);
  expect(r.lines[0]).toBe(
    "ERROR ledger: session s-1 for embark is running but could not be recorded (simulated disk full) — record it manually: aipe journey record --journey 'j1' --workspace '" +
      dir +
      "' --repo 'embark' --specialist 'Joaquim' --branch 'aipe/j1/joaquim' --worktree '" +
      worktree +
      "' --status 'dispatched' --mode 'session' --intensity 'ultracode' --harness 'claude-code' --session-id 's-1'",
  );
  expect(r.lines[1]).toBe(
    'WARN ledger: embark\'s redispatchReason ("QA found a regression in the retry path") cannot be represented by the recovery command above and will be lost if it is run verbatim — restore it manually',
  );
});

// Same gap, for `redirectReason`: a unit currently sitting at `dispatched`
// can still carry a leftover `redirectReason` from an earlier genuine
// redirect that was reconciled and re-dispatched. The recovery command's
// `--status` comes back as `dispatched` too (see FIELD_FLAGS comment), so
// `recordDispatchGuarded`'s redirect gate never fires on the recovery write
// and `--reason` cannot restore it either — the same WARN treatment applies.
test("a dispatch being recovered that carries a redirectReason gets an explicit WARN line, since the recovery command cannot restore it", async () => {
  const dir = await fixture(); // repo "embark", specialist "Joaquim"
  const worktree = join(dir, ".worktrees", "j1-joaquim");
  await recordDispatch(dir, "j1", {
    repo: "embark", specialist: "Joaquim", branch: "aipe/j1/joaquim",
    worktree, status: "dispatched",
    mode: "session", intensity: "ultracode", harness: "claude-code",
    redirectReason: "use Stripe instead of the in-house gateway",
  });

  const realRecordDispatch = ledgerModule.recordDispatch;
  mock.module("../../journey/ledger", () => ({
    ...ledgerModule,
    recordDispatch: async () => {
      throw new Error("simulated disk full");
    },
  }));

  let r: { code: number; lines: string[] };
  try {
    r = await dispatchCommand({ workspace: dir, journeyId: "j1", runner: okRunner });
  } finally {
    mock.module("../../journey/ledger", () => ({ ...ledgerModule, recordDispatch: realRecordDispatch }));
  }

  expect(r.code).toBe(1);
  expect(r.lines.length).toBe(2);
  expect(r.lines[1]).toBe(
    'WARN ledger: embark\'s redirectReason ("use Stripe instead of the in-house gateway") cannot be represented by the recovery command above and will be lost if it is run verbatim — restore it manually',
  );
});

// Finding 2: `started.length !== pending.length` must be reachable on its
// own. `shortRunner` (above) bundles it with a per-unit "no session for X"
// line (fewer sessions than requested ⇒ some unit is unmatched), and
// `wrongCwdRunner` deliberately keeps the counts equal to suppress it. The
// one combination that fires the length-mismatch line ALONE is agentop
// answering with MORE sessions than requested while every pending unit still
// finds its match — e.g. a stale session echoed back from a previous wave.
test("more sessions returned than requested, but every pending unit still matches: only the length-mismatch line fires", async () => {
  const { dir, worktreeA, worktreeB } = await twoUnitFixture();
  const extraRunner: AgentopRunner = async (args) => {
    if (args[0] === "--version") return { code: 0, stdout: "agentop v1.9.0", stderr: "" };
    const flags = parseSessionFlags(args);
    const sessions = flags.map(({ cwd }) => ({ id: cwd === worktreeA ? "s-a" : "s-b", harness: "claude", cwd }));
    sessions.push({ id: "s-stale", harness: "claude", cwd: "/nowhere/stale-from-previous-wave" });
    return { code: 0, stdout: JSON.stringify({ sessions }), stderr: "" };
  };

  const r = await dispatchCommand({ workspace: dir, journeyId: "j1", runner: extraRunner });
  expect(r.code).toBe(1);
  expect(r.lines).toEqual([
    "OK a → s-a",
    "OK b → s-b",
    "ERROR session: asked agentop for 2 sessions, it started 3",
  ]);

  const ledger = await readLedger(dir, "j1");
  const a = ledger!.dispatches.find((d) => d.repo === "a");
  const b = ledger!.dispatches.find((d) => d.repo === "b");
  expect(a!.sessionId).toBe("s-a");
  expect(b!.sessionId).toBe("s-b");
});
