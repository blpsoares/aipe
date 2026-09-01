// CLI-level wiring for the CI gate (--ci-none, injected resolver) and the
// session-close side effect on verified/merged. Both are injected through the
// optional deps bag on `run` so this stays offline and agentop-free.
import { expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { run } from "../cli";
import type { CheckVerdict } from "../checks";
import type { AgentopRunner } from "../../session/types";

async function ws(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "aipe-cli-ci-"));
  await run(["start", "--workspace", dir, "--id", "j1"]);
  return dir;
}

async function capture(fn: () => Promise<number>): Promise<{ code: number; output: string }> {
  const original = console.log;
  const lines: string[] = [];
  console.log = (...args: unknown[]) => void lines.push(args.map(String).join(" "));
  try {
    return { code: await fn(), output: lines.join("\n") };
  } finally {
    console.log = original;
  }
}

// A runner modeling the REAL agentop: `session list --json` returns the live
// ids as `[{id}, ...]`; `session kill <id>` exits 0 even for an id that matches
// no session (the exact false success this module must not be fooled by). Every
// facet is overridable so a test can drive the down/empty/throwing paths.
function agentop(opts: {
  live?: string[];
  listCode?: number;
  listStdout?: string;
  killResult?: (id: string) => { code: number; stdout: string; stderr: string };
  throws?: boolean;
} = {}): { runner: AgentopRunner; kills: string[] } {
  const kills: string[] = [];
  const runner: AgentopRunner = async (args) => {
    if (opts.throws) throw new Error("ENOENT: agentop not found");
    if (args[0] === "session" && args[1] === "list") {
      return {
        code: opts.listCode ?? 0,
        stdout: opts.listStdout ?? JSON.stringify((opts.live ?? []).map((id) => ({ id }))),
        stderr: "",
      };
    }
    if (args[0] === "session" && args[1] === "kill") {
      kills.push(args[2]!);
      return opts.killResult ? opts.killResult(args[2]!) : { code: 0, stdout: "", stderr: "" };
    }
    return { code: 0, stdout: "", stderr: "" };
  };
  return { runner, kills };
}

const evArgs = ["--evidence-cmd", "bun test", "--evidence-summary", "all green"];

const dispatchArgs = (dir: string, extra: string[]) => [
  "record", "--workspace", dir, "--journey", "j1",
  "--repo", "aipe", "--specialist", "Jesse", "--branch", "aipe/j1/jesse", "--worktree", "/wt",
  ...extra,
];

// A QA verdict judges a DELIVERY, and a merge carries a QA pass for the current
// round — the ledger refuses both when that history is missing, because a
// `verified` recorded over nothing delivered, and a `merged` nobody tested, are
// exactly the holes those gates close. These fixtures used to jump straight from
// `dispatched`; seeding the real lifecycle leaves every assertion below
// untouched. The seeds run against an INERT agentop (an empty live list, so
// nothing is ever killed) — they are setup, and must not spend or pollute the
// kill log the assertions read.
// The QA records its verdict on its OWN row (its persona, its task) — the
// ledger refuses a verification signed by whoever made the delivery. Closing the
// DEV's session from the QA's record is the intended close-BY-UNIT behaviour,
// which is what these tests assert.
const qaArgs = (dir: string, extra: string[]) => [
  "record", "--workspace", dir, "--journey", "j1",
  "--repo", "aipe", "--specialist", "Mike", "--branch", "aipe/j1/mike", "--worktree", "/wt-gate",
  ...extra,
];

const inertRunner: AgentopRunner = async () => ({ code: 0, stdout: "[]", stderr: "" });

async function seedDelivered(dir: string): Promise<void> {
  await run(dispatchArgs(dir, ["--status", "delivered", ...evArgs]), { sessionRunner: inertRunner });
}

// The QA is a DIFFERENT person from the builder — the ledger refuses a
// verification signed by whoever made the delivery — so the seed records the
// pass as the unit's QA persona, on its own row, exactly as a real gate does.
async function seedVerified(dir: string): Promise<void> {
  await seedDelivered(dir);
  await run(qaArgs(dir, ["--status", "verified", "--evidence-by", "qa", ...evArgs]), {
    sessionRunner: inertRunner,
  });
}


test("record --status delivered with red CI is REJECTed at the CLI", async () => {
  const dir = await ws();
  const { code, output } = await capture(() =>
    run(dispatchArgs(dir, ["--status", "delivered", "--pr", "http://pr/1", ...evArgs]), {
      resolveChecks: async () => "red" as CheckVerdict,
    }),
  );
  expect(code).toBe(1);
  expect(output).toContain("REJECT ci-red");
});

test("record --status delivered with pending CI says still-running, not failure", async () => {
  const dir = await ws();
  const { code, output } = await capture(() =>
    run(dispatchArgs(dir, ["--status", "delivered", "--pr", "http://pr/1", ...evArgs]), {
      resolveChecks: async () => "pending" as CheckVerdict,
    }),
  );
  expect(code).toBe(1);
  expect(output).toContain("REJECT ci-pending");
});

test("record --status delivered with green CI is accepted", async () => {
  const dir = await ws();
  const { code, output } = await capture(() =>
    run(dispatchArgs(dir, ["--status", "delivered", "--pr", "http://pr/1", ...evArgs]), {
      resolveChecks: async () => "green" as CheckVerdict,
    }),
  );
  expect(code).toBe(0);
  expect(output).toContain("OK aipe Jesse delivered");
});

test("no-checks repo is rejected without --ci-none, accepted with it (and the bypass lands on the ledger)", async () => {
  const dir = await ws();
  const rejected = await capture(() =>
    run(dispatchArgs(dir, ["--status", "delivered", "--pr", "http://pr/1", ...evArgs]), {
      resolveChecks: async () => "none" as CheckVerdict,
    }),
  );
  expect(rejected.code).toBe(1);
  expect(rejected.output).toContain("REJECT ci-none");

  const accepted = await capture(() =>
    run(dispatchArgs(dir, ["--status", "delivered", "--pr", "http://pr/1", "--ci-none", ...evArgs]), {
      resolveChecks: async () => "none" as CheckVerdict,
    }),
  );
  expect(accepted.code).toBe(0);
  const ledger = parse(await readFile(join(dir, ".aipe", "journeys", "j1.yaml"), "utf8"));
  expect(ledger.dispatches[0].ciBypass).toBe("no-checks");
});

test("verified on a session-mode unit whose session IS live closes it and says so", async () => {
  const dir = await ws();
  // seed a session-mode dispatched record carrying a sessionId
  await run(dispatchArgs(dir, ["--status", "dispatched", "--mode", "session", "--session-id", "sess-abc"]));
  await seedDelivered(dir);
  const { runner, kills } = agentop({ live: ["sess-abc"] });
  const { code, output } = await capture(() =>
    run(qaArgs(dir, ["--status", "verified", "--pr", "http://pr/1", "--evidence-by", "qa", ...evArgs]), {
      resolveChecks: async () => "green" as CheckVerdict,
      sessionRunner: runner,
    }),
  );
  expect(code).toBe(0);
  expect(kills).toEqual(["sess-abc"]);
  expect(output).toContain("CLOSED session sess-abc");
});

test("merged on a session-mode unit whose session IS live also closes it", async () => {
  const dir = await ws();
  await run(dispatchArgs(dir, ["--status", "dispatched", "--mode", "session", "--session-id", "sess-xyz"]));
  await seedVerified(dir);
  const { runner, kills } = agentop({ live: ["sess-xyz"] });
  const { code, output } = await capture(() =>
    run(dispatchArgs(dir, ["--status", "merged"]), { sessionRunner: runner }),
  );
  expect(code).toBe(0);
  expect(kills).toEqual(["sess-xyz"]);
  expect(output).toContain("CLOSED session sess-xyz");
});

// D4 (j-20260830-w0) — `failed` now requires evidence exactly like
// delivered/verified (a real QA verdict names what it checked), so this test
// supplies it; the session-close behavior itself is unchanged.
test("failed (WITH evidence) closes the unit's session too — the fix loop opens a NEW session", async () => {
  const dir = await ws();
  await run(dispatchArgs(dir, ["--status", "dispatched", "--mode", "session", "--session-id", "sess-fail"]));
  const { runner, kills } = agentop({ live: ["sess-fail"] });
  const { code, output } = await capture(() =>
    run(dispatchArgs(dir, ["--status", "failed", ...evArgs]), { sessionRunner: runner }),
  );
  expect(code).toBe(0);
  expect(kills).toEqual(["sess-fail"]);
  expect(output).toContain("CLOSED session sess-fail");
});

test("failed WITHOUT evidence is REJECTED at the CLI — indistinguishable from a session that died with no verdict", async () => {
  const dir = await ws();
  await run(dispatchArgs(dir, ["--status", "dispatched", "--mode", "session", "--session-id", "sess-fail"]));
  const { code, output } = await capture(() => run(dispatchArgs(dir, ["--status", "failed"])));
  expect(code).toBe(1);
  expect(output).toContain("REJECT evidence-required");
});

test("escalated closes the unit's session too — the PE decides, any continuation is a new session", async () => {
  const dir = await ws();
  await run(dispatchArgs(dir, ["--status", "dispatched", "--mode", "session", "--session-id", "sess-esc"]));
  const { runner, kills } = agentop({ live: ["sess-esc"] });
  const { code, output } = await capture(() =>
    run(dispatchArgs(dir, ["--status", "escalated", "--reason", "needs agentistics contract change"]), {
      sessionRunner: runner,
    }),
  );
  expect(code).toBe(0);
  expect(kills).toEqual(["sess-esc"]);
  expect(output).toContain("CLOSED session sess-esc");
});

test("a close against a stale id that reconciles to nothing does NOT claim it was closed, and does not even attempt a guessing kill", async () => {
  const dir = await ws();
  await run(dispatchArgs(dir, ["--status", "dispatched", "--mode", "session", "--session-id", "sess-ghost"]));
  await seedVerified(dir);
  // The exact condition that produced today's false success: the live list has
  // no such session (and none at the unit's worktree), yet `session kill` would
  // exit 0 with agentop's real message. Establish-first means we never call it.
  const { runner, kills } = agentop({
    live: [],
    killResult: (id) => ({
      code: 0,
      stdout: "",
      stderr: `No session matches "${id}". Run \`agentop session list\` to see them.`,
    }),
  });
  const { code, output } = await capture(() =>
    run(dispatchArgs(dir, ["--status", "merged"]), { sessionRunner: runner }),
  );
  expect(code).toBe(0); // the record still succeeds
  expect(kills).toEqual([]); // no live session was established, so nothing is killed by guess
  expect(output).not.toContain("CLOSED session sess-ghost");
  expect(output).toContain("was not running");
});

test("when agentop's live list is unreadable, a code-0 kill is reported as could-not-confirm, never CLOSED", async () => {
  const dir = await ws();
  await run(dispatchArgs(dir, ["--status", "dispatched", "--mode", "session", "--session-id", "sess-u"]));
  await seedVerified(dir);
  const { runner } = agentop({ listCode: 1 }); // `session list` fails ⇒ liveness unknown
  const { code, output } = await capture(() =>
    run(dispatchArgs(dir, ["--status", "merged"]), { sessionRunner: runner }),
  );
  expect(code).toBe(0);
  expect(output).toContain("could not be confirmed");
  expect(output).not.toContain("CLOSED session sess-u");
});

test("an agentop that throws (binary gone) does not break the record", async () => {
  const dir = await ws();
  await run(dispatchArgs(dir, ["--status", "dispatched", "--mode", "session", "--session-id", "sess-1"]));
  await seedVerified(dir);
  const { runner } = agentop({ throws: true });
  const { code, output } = await capture(() =>
    run(dispatchArgs(dir, ["--status", "merged"]), { sessionRunner: runner }),
  );
  expect(code).toBe(0);
  expect(output).toContain("NOTE session sess-1");
  expect(output).toContain("could not be confirmed");
  expect(output).toContain("agentop");
});

test("a mode:session record with NO sessionId is surfaced as a visible NOTE naming the unit — not silence", async () => {
  const dir = await ws();
  // session mode but the sessionId was never recorded — the silence that let two
  // sessions run for hours.
  await run(dispatchArgs(dir, ["--status", "dispatched", "--mode", "session"]));
  await seedDelivered(dir);
  const { runner, kills } = agentop({});
  const { code, output } = await capture(() =>
    run(qaArgs(dir, ["--status", "verified", "--pr", "http://pr/1", "--evidence-by", "qa", ...evArgs]), {
      resolveChecks: async () => "green" as CheckVerdict,
      sessionRunner: runner,
    }),
  );
  expect(code).toBe(0);
  expect(kills).toEqual([]); // no id to kill
  expect(output).toContain("no sessionId");
  expect(output).toContain("aipe"); // the unit is named
  expect(output).toContain("Jesse"); // and the specialist
});

test("a subagent-mode unit closes nothing on a terminal status", async () => {
  const dir = await ws();
  await run(dispatchArgs(dir, ["--status", "dispatched", "--mode", "subagent"]));
  await seedDelivered(dir);
  const { runner, kills } = agentop({});
  const { code, output } = await capture(() =>
    run(qaArgs(dir, ["--status", "verified", "--pr", "http://pr/1", "--evidence-by", "qa", ...evArgs]), {
      resolveChecks: async () => "green" as CheckVerdict,
      sessionRunner: runner,
    }),
  );
  expect(code).toBe(0);
  expect(kills).toEqual([]);
  expect(output).not.toContain("CLOSED");
  expect(output).not.toContain("no sessionId");
});

// Session CLOSING is by unit; the QA GATE is by task. The two are different
// questions and this test is about the first: a verdict recorded by a different
// specialist, in a different worktree, with its own live session, closes the
// DEV's session too. The QA's row names the DEV'S TASK, because a verdict has to
// be addressable to the delivery it judges — recording it under a task of its
// own left it attached to nothing, which is the mis-paired gate this repo's own
// comments warn about (and which an independent QA showed lets a merge through
// on a task nobody verified).
test("a QA verified from a DIFFERENT specialist closes the DEV's delivered session on the same unit (close by unit)", async () => {
  const dir = await ws();
  // Dev is at DELIVERED (self-report, gate pending) under task "impl", session live.
  await run([
    "record", "--workspace", dir, "--journey", "j1", "--repo", "aipe", "--specialist", "Jesse",
    "--branch", "aipe/j1/jesse", "--worktree", "/wt-impl", "--task", "impl",
    "--status", "dispatched", "--mode", "session", "--session-id", "sess-dev",
  ]);
  await run([
    "record", "--workspace", dir, "--journey", "j1", "--repo", "aipe", "--specialist", "Jesse",
    "--branch", "aipe/j1/jesse", "--worktree", "/wt-impl", "--task", "impl",
    "--status", "delivered", "--pr", "http://pr/impl", ...evArgs,
  ], { resolveChecks: async () => "green" as CheckVerdict });
  // QA is dispatched on the SAME task, as its own specialist — its own session live too.
  await run([
    "record", "--workspace", dir, "--journey", "j1", "--repo", "aipe", "--specialist", "Mike",
    "--branch", "aipe/j1/mike", "--worktree", "/wt-gate", "--task", "impl",
    "--status", "dispatched", "--mode", "session", "--session-id", "sess-qa",
  ]);
  const { runner, kills } = agentop({ live: ["sess-dev", "sess-qa"] });
  const { code, output } = await capture(() =>
    run([
      "record", "--workspace", dir, "--journey", "j1", "--repo", "aipe", "--specialist", "Mike",
      "--branch", "aipe/j1/mike", "--worktree", "/wt-gate", "--task", "impl",
      "--status", "verified", "--pr", "http://pr/1", "--evidence-by", "qa", ...evArgs,
    ], { resolveChecks: async () => "green" as CheckVerdict, sessionRunner: runner }),
  );
  expect(code).toBe(0);
  // The dev's session is closed by the QA's write even though they are separate
  // rows with separate worktrees — closing is by UNIT.
  expect(kills.sort()).toEqual(["sess-dev", "sess-qa"]);
  expect(output).toContain("CLOSED session sess-dev");
});

test("delivered does NOT close the session — it is not terminal (the QA gate is)", async () => {
  const dir = await ws();
  await run(dispatchArgs(dir, ["--status", "dispatched", "--mode", "session", "--session-id", "sess-live"]));
  const { runner, kills } = agentop({ live: ["sess-live"] });
  const { code } = await capture(() =>
    run(dispatchArgs(dir, ["--status", "delivered", "--pr", "http://pr/1", ...evArgs]), {
      resolveChecks: async () => "green" as CheckVerdict,
      sessionRunner: runner,
    }),
  );
  expect(code).toBe(0);
  expect(kills).toEqual([]);
});
