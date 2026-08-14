import { expect, mock, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dispatchCommand } from "../cli";
import * as ledgerModule from "../../journey/ledger";
import { readLedger, recordDispatch, startJourney } from "../../journey/ledger";
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
    mock.module("../../journey/ledger", () => ledgerModule);
  }
});
