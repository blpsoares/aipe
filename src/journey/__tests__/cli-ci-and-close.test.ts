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
  const { runner, kills } = agentop({ live: ["sess-abc"] });
  const { code, output } = await capture(() =>
    run(dispatchArgs(dir, ["--status", "verified", "--pr", "http://pr/1", "--evidence-by", "qa", ...evArgs]), {
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
  const { runner, kills } = agentop({ live: ["sess-xyz"] });
  const { code, output } = await capture(() =>
    run(dispatchArgs(dir, ["--status", "merged"]), { sessionRunner: runner }),
  );
  expect(code).toBe(0);
  expect(kills).toEqual(["sess-xyz"]);
  expect(output).toContain("CLOSED session sess-xyz");
});

test("failed closes the unit's session too — the fix loop opens a NEW session", async () => {
  const dir = await ws();
  await run(dispatchArgs(dir, ["--status", "dispatched", "--mode", "session", "--session-id", "sess-fail"]));
  const { runner, kills } = agentop({ live: ["sess-fail"] });
  const { code, output } = await capture(() =>
    run(dispatchArgs(dir, ["--status", "failed"]), { sessionRunner: runner }),
  );
  expect(code).toBe(0);
  expect(kills).toEqual(["sess-fail"]);
  expect(output).toContain("CLOSED session sess-fail");
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

test("a close against a non-existent id does NOT claim it was closed — even though agentop's kill exits 0 with 'No session matches'", async () => {
  const dir = await ws();
  await run(dispatchArgs(dir, ["--status", "dispatched", "--mode", "session", "--session-id", "sess-ghost"]));
  // The exact condition that produced today's false success: the live list has
  // no such session, yet `session kill` exits 0 with agentop's real message.
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
  expect(kills).toEqual(["sess-ghost"]); // the kill WAS attempted, its exit 0 just isn't trusted
  expect(output).not.toContain("CLOSED session sess-ghost");
  expect(output).toContain("was not running");
});

test("when agentop's live list is unreadable, a code-0 kill is reported as could-not-confirm, never CLOSED", async () => {
  const dir = await ws();
  await run(dispatchArgs(dir, ["--status", "dispatched", "--mode", "session", "--session-id", "sess-u"]));
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
  const { runner, kills } = agentop({});
  const { code, output } = await capture(() =>
    run(dispatchArgs(dir, ["--status", "verified", "--pr", "http://pr/1", "--evidence-by", "qa", ...evArgs]), {
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
  const { runner, kills } = agentop({});
  const { code, output } = await capture(() =>
    run(dispatchArgs(dir, ["--status", "verified", "--pr", "http://pr/1", "--evidence-by", "qa", ...evArgs]), {
      resolveChecks: async () => "green" as CheckVerdict,
      sessionRunner: runner,
    }),
  );
  expect(code).toBe(0);
  expect(kills).toEqual([]);
  expect(output).not.toContain("CLOSED");
  expect(output).not.toContain("no sessionId");
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
