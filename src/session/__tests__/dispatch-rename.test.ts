// Session naming for `aipe session dispatch`. Every session `startBatch`
// actually started gets renamed, one `agentop session rename <id> "label"`
// call per session, through the SAME injectable AgentopRunner the rest of
// dispatchCommand uses — real command verified live against agentop v1.18.2
// (see buildRenameArgs's header comment in ../batch.ts).
//
// The failure direction is the point of this file: a rename is cosmetic (it
// only changes what a human sees in `agentop session ls`), the session
// underneath it is already a real, running detached process by the time
// dispatchCommand tries to rename it — so a rename that throws or exits
// non-zero must NEVER fail the dispatch, never stop the remaining units from
// being recorded, and never be reported as an ERROR line (which is what
// flips the exit code).
import { expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dispatchCommand } from "../cli";
import { readLedger, recordDispatch, startJourney } from "../../journey/ledger";
import type { AgentopRunner } from "../types";

// Two units, "a" and "b", each with a real persona and a dispatched
// session-mode unit on the ledger — mirrors twoUnitFixture in
// cli-dispatch.test.ts (kept local rather than imported/exported: every other
// test file in this suite duplicates its own small fixture rather than
// sharing one across files, e.g. dispatch-containment.test.ts's own
// `fixture()`).
async function twoUnitFixture(): Promise<{ dir: string; worktreeA: string; worktreeB: string }> {
  const dir = await mkdtemp(join(tmpdir(), "aipe-sess-rename-"));
  // The persona file lives under the SPECIALIST's slug (personaSlug in
  // ../../hire-specialists/render.ts), not the repo name — "Ana" -> "ana".
  for (const [repo, specialist] of [["a", "Ana"] as const, ["b", "Bento"] as const]) {
    const slug = specialist.toLowerCase();
    await mkdir(join(dir, repo, ".claude", "skills", slug), { recursive: true });
    await writeFile(join(dir, repo, ".claude", "skills", slug, "SKILL.md"), `---\nname: ${slug}\n---\n\nYou are ${specialist}.\n`, "utf8");
  }
  await mkdir(join(dir, ".aipe", "journeys", "j1"), { recursive: true });
  await writeFile(join(dir, ".aipe", "journeys", "j1", "orientation.md"), "## a\nDo A.\n## b\nDo B.\n", "utf8");
  await startJourney(dir, "j1");
  const worktreeA = join(dir, ".worktrees", "j1-a");
  const worktreeB = join(dir, ".worktrees", "j1-b");
  for (const [repo, specialist, worktree] of [
    ["a", "Ana", worktreeA] as const,
    ["b", "Bento", worktreeB] as const,
  ]) {
    await recordDispatch(dir, "j1", {
      repo, specialist, branch: `aipe/j1/${repo}`,
      worktree, status: "dispatched",
      mode: "session", intensity: "normal", harness: "claude-code",
    });
  }
  return { dir, worktreeA, worktreeB };
}

// Single-unit fixture, matching cli-dispatch.test.ts's own `fixture()`
// (repo "embark", specialist "Joaquim") — used by the tests that only need
// one session.
async function oneUnitFixture(): Promise<{ dir: string; worktree: string }> {
  const dir = await mkdtemp(join(tmpdir(), "aipe-sess-rename-"));
  await mkdir(join(dir, "embark", ".claude", "skills", "joaquim"), { recursive: true });
  await writeFile(
    join(dir, "embark", ".claude", "skills", "joaquim", "SKILL.md"),
    "---\nname: joaquim\n---\n\nYou are Joaquim.\n",
    "utf8",
  );
  await mkdir(join(dir, ".aipe", "journeys", "j1"), { recursive: true });
  await writeFile(join(dir, ".aipe", "journeys", "j1", "orientation.md"), "## embark\nFix it.\n", "utf8");
  await startJourney(dir, "j1");
  const worktree = join(dir, ".worktrees", "j1-joaquim");
  await recordDispatch(dir, "j1", {
    repo: "embark", specialist: "Joaquim", branch: "aipe/j1/joaquim",
    worktree, status: "dispatched",
    mode: "session", intensity: "ultracode", harness: "claude-code",
  });
  return { dir, worktree };
}

// Parses the --session flags out of a batch invocation the same way
// cli-dispatch.test.ts's helpers do, answering one session per flag with a
// synthetic, cwd-derived id (never positional) so a pairing bug would surface
// as a wrong id rather than an accidental pass.
function sessionsFromBatchArgs(args: string[]): { id: string; harness: string; cwd: string }[] {
  return args
    .filter((_, i) => args[i - 1] === "--session")
    .map((flag) => {
      const m = /^[^@]+@(.+): @.+$/.exec(flag);
      if (!m) throw new Error(`could not parse --session flag: ${flag}`);
      const cwd = m[1]!;
      // Deterministic id from the LAST path segment of the worktree, e.g.
      // ".../.worktrees/j1-a" -> "s-j1-a", so assertions can spell out the
      // expected rename argv without threading synthetic counters through.
      const id = `s-${cwd.split("/").pop()}`;
      return { id, harness: "claude", cwd };
    });
}

test("every started session gets a rename call, with the expected <Specialist>-<journey>-<project> label, through the fake runner — exact argv", async () => {
  const { dir, worktreeA, worktreeB } = await twoUnitFixture();
  const renameCalls: string[][] = [];
  const runner: AgentopRunner = async (args) => {
    if (args[0] === "--version") return { code: 0, stdout: "agentop v1.9.0", stderr: "" };
    if (args[0] === "session" && args[1] === "batch") {
      const sessions = sessionsFromBatchArgs(args);
      return { code: 0, stdout: JSON.stringify({ sessions }), stderr: "" };
    }
    if (args[0] === "session" && args[1] === "rename") {
      renameCalls.push(args);
      return { code: 0, stdout: "", stderr: "" };
    }
    throw new Error(`unexpected call: ${args.join(" ")}`);
  };

  const r = await dispatchCommand({ workspace: dir, journeyId: "j1", runner });
  expect(r.code).toBe(0);
  expect(r.lines).toEqual(["OK a → s-j1-a", "OK b → s-j1-b"]);

  // Exact argv, order matches the order units were paired/recorded in
  // (`pending`'s own order — see dispatchCommand's per-unit loop).
  expect(renameCalls).toEqual([
    ["session", "rename", "s-j1-a", "Ana-j1-a"],
    ["session", "rename", "s-j1-b", "Bento-j1-b"],
  ]);

  const ledger = await readLedger(dir, "j1");
  const a = ledger!.dispatches.find((d) => d.repo === "a");
  const b = ledger!.dispatches.find((d) => d.repo === "b");
  expect(a!.sessionId).toBe("s-j1-a");
  expect(b!.sessionId).toBe("s-j1-b");
  void worktreeA;
  void worktreeB;
});

test("a rename that returns a non-zero exit is reported as a non-fatal WARN line and does not change the dispatch's exit code", async () => {
  const { dir } = await twoUnitFixture();
  const runner: AgentopRunner = async (args) => {
    if (args[0] === "--version") return { code: 0, stdout: "agentop v1.9.0", stderr: "" };
    if (args[0] === "session" && args[1] === "batch") {
      const sessions = sessionsFromBatchArgs(args);
      return { code: 0, stdout: JSON.stringify({ sessions }), stderr: "" };
    }
    if (args[0] === "session" && args[1] === "rename") {
      const id = args[2];
      return { code: 1, stdout: "", stderr: `No session matches "${id}". Run \`agentop session list\` to see them.` };
    }
    throw new Error(`unexpected call: ${args.join(" ")}`);
  };

  const r = await dispatchCommand({ workspace: dir, journeyId: "j1", runner });
  expect(r.code).toBe(0);
  expect(r.lines).toEqual([
    "OK a → s-j1-a",
    `WARN rename: session s-j1-a for a could not be renamed to "Ana-j1-a" (No session matches "s-j1-a". Run \`agentop session list\` to see them.) — rename it manually: agentop session rename s-j1-a 'Ana-j1-a'`,
    "OK b → s-j1-b",
    `WARN rename: session s-j1-b for b could not be renamed to "Bento-j1-b" (No session matches "s-j1-b". Run \`agentop session list\` to see them.) — rename it manually: agentop session rename s-j1-b 'Bento-j1-b'`,
  ]);

  // Both sessions are still recorded — a failed cosmetic rename must not
  // stop the ledger writes that make the sessions visible to `collect`.
  const ledger = await readLedger(dir, "j1");
  const a = ledger!.dispatches.find((d) => d.repo === "a");
  const b = ledger!.dispatches.find((d) => d.repo === "b");
  expect(a!.sessionId).toBe("s-j1-a");
  expect(b!.sessionId).toBe("s-j1-b");
});

test("a rename call that throws (binary gone mid-run) is reported as a non-fatal WARN line and does not change the dispatch's exit code", async () => {
  const { dir, worktree } = await oneUnitFixture();
  const runner: AgentopRunner = async (args) => {
    if (args[0] === "--version") return { code: 0, stdout: "agentop v1.9.0", stderr: "" };
    if (args[0] === "session" && args[1] === "batch") {
      const sessions = sessionsFromBatchArgs(args);
      return { code: 0, stdout: JSON.stringify({ sessions }), stderr: "" };
    }
    if (args[0] === "session" && args[1] === "rename") {
      throw new Error("ENOENT: agentop not found");
    }
    throw new Error(`unexpected call: ${args.join(" ")}`);
  };

  const r = await dispatchCommand({ workspace: dir, journeyId: "j1", runner });
  expect(r.code).toBe(0);
  expect(r.lines).toEqual([
    "OK embark → s-j1-joaquim",
    `WARN rename: session s-j1-joaquim for embark could not be renamed to "Joaquim-j1-embark" (ENOENT: agentop not found) — rename it manually: agentop session rename s-j1-joaquim 'Joaquim-j1-embark'`,
  ]);

  const ledger = await readLedger(dir, "j1");
  expect(ledger!.dispatches[0]!.sessionId).toBe("s-j1-joaquim");
  void worktree;
});

test("a mixed wave — one rename fails, one succeeds — records both sessions and reports only the failed one", async () => {
  const { dir, worktreeA } = await twoUnitFixture();
  const runner: AgentopRunner = async (args) => {
    if (args[0] === "--version") return { code: 0, stdout: "agentop v1.9.0", stderr: "" };
    if (args[0] === "session" && args[1] === "batch") {
      const sessions = sessionsFromBatchArgs(args);
      return { code: 0, stdout: JSON.stringify({ sessions }), stderr: "" };
    }
    if (args[0] === "session" && args[1] === "rename") {
      const id = args[2];
      if (id === "s-j1-a") {
        return { code: 1, stdout: "", stderr: "simulated rename failure for a" };
      }
      return { code: 0, stdout: "", stderr: "" };
    }
    throw new Error(`unexpected call: ${args.join(" ")}`);
  };

  const r = await dispatchCommand({ workspace: dir, journeyId: "j1", runner });
  expect(r.code).toBe(0);
  expect(r.lines).toEqual([
    "OK a → s-j1-a",
    `WARN rename: session s-j1-a for a could not be renamed to "Ana-j1-a" (simulated rename failure for a) — rename it manually: agentop session rename s-j1-a 'Ana-j1-a'`,
    "OK b → s-j1-b",
  ]);

  const ledger = await readLedger(dir, "j1");
  const a = ledger!.dispatches.find((d) => d.repo === "a");
  const b = ledger!.dispatches.find((d) => d.repo === "b");
  expect(a!.sessionId).toBe("s-j1-a");
  expect(b!.sessionId).toBe("s-j1-b");
  void worktreeA;
});

test("zero session-mode units pending: no rename call is attempted and nothing blows up", async () => {
  const { dir } = await oneUnitFixture();
  let renameCalls = 0;
  let batchCalls = 0;
  const runner: AgentopRunner = async (args) => {
    if (args[0] === "--version") return { code: 0, stdout: "agentop v1.9.0", stderr: "" };
    if (args[0] === "session" && args[1] === "batch") {
      batchCalls++;
      const sessions = sessionsFromBatchArgs(args);
      return { code: 0, stdout: JSON.stringify({ sessions }), stderr: "" };
    }
    if (args[0] === "session" && args[1] === "rename") {
      renameCalls++;
      return { code: 0, stdout: "", stderr: "" };
    }
    throw new Error(`unexpected call: ${args.join(" ")}`);
  };

  // First call: the one pending unit gets dispatched and renamed once.
  const first = await dispatchCommand({ workspace: dir, journeyId: "j1", runner });
  expect(first.code).toBe(0);
  expect(batchCalls).toBe(1);
  expect(renameCalls).toBe(1);

  // Second call: the unit already carries a sessionId, so `pending` is empty
  // — dispatchCommand must return "OK nothing to dispatch" WITHOUT calling
  // the runner again for either a batch or a rename, and without throwing.
  const second = await dispatchCommand({ workspace: dir, journeyId: "j1", runner });
  expect(second.code).toBe(0);
  expect(second.lines).toEqual(["OK nothing to dispatch"]);
  expect(batchCalls).toBe(1);
  expect(renameCalls).toBe(1);
});
