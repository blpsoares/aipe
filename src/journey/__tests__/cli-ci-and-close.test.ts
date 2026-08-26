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

const okRunner: AgentopRunner = async () => ({ code: 0, stdout: "", stderr: "" });
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

test("verified on a session-mode unit closes the recorded session and says so", async () => {
  const dir = await ws();
  // seed a session-mode dispatched record carrying a sessionId
  await run(dispatchArgs(dir, ["--status", "dispatched", "--mode", "session", "--session-id", "sess-abc"]));
  const killCalls: string[][] = [];
  const runner: AgentopRunner = async (args) => {
    killCalls.push(args);
    return { code: 0, stdout: "", stderr: "" };
  };
  const { code, output } = await capture(() =>
    run(dispatchArgs(dir, ["--status", "verified", "--pr", "http://pr/1", "--evidence-by", "qa", ...evArgs]), {
      resolveChecks: async () => "green" as CheckVerdict,
      sessionRunner: runner,
    }),
  );
  expect(code).toBe(0);
  expect(killCalls).toEqual([["session", "kill", "sess-abc"]]);
  expect(output).toContain("CLOSED session sess-abc");
});

test("merged on a session-mode unit also closes the session", async () => {
  const dir = await ws();
  await run(dispatchArgs(dir, ["--status", "dispatched", "--mode", "session", "--session-id", "sess-xyz"]));
  const killCalls: string[][] = [];
  const runner: AgentopRunner = async (args) => (killCalls.push(args), { code: 0, stdout: "", stderr: "" });
  const { code, output } = await capture(() =>
    run(dispatchArgs(dir, ["--status", "merged"]), { sessionRunner: runner }),
  );
  expect(code).toBe(0);
  expect(killCalls).toEqual([["session", "kill", "sess-xyz"]]);
  expect(output).toContain("CLOSED session sess-xyz");
});

test("closing an already-dead session is a NOTE, not an error — the ledger record still stands", async () => {
  const dir = await ws();
  await run(dispatchArgs(dir, ["--status", "dispatched", "--mode", "session", "--session-id", "sess-dead"]));
  const runner: AgentopRunner = async () => ({ code: 1, stdout: "", stderr: `No session matches "sess-dead".` });
  const { code, output } = await capture(() =>
    run(dispatchArgs(dir, ["--status", "merged"]), { sessionRunner: runner }),
  );
  expect(code).toBe(0); // record still succeeds
  expect(output).toContain("NOTE session sess-dead");
  expect(output).not.toContain("CLOSED session sess-dead");
});

test("an agentop that throws (binary gone) does not break the record", async () => {
  const dir = await ws();
  await run(dispatchArgs(dir, ["--status", "dispatched", "--mode", "session", "--session-id", "sess-1"]));
  const runner: AgentopRunner = async () => {
    throw new Error("ENOENT: agentop not found");
  };
  const { code, output } = await capture(() =>
    run(dispatchArgs(dir, ["--status", "merged"]), { sessionRunner: runner }),
  );
  expect(code).toBe(0);
  expect(output).toContain("NOTE session sess-1");
  expect(output).toContain("agentop");
});

test("a subagent-mode unit (or one with no sessionId) closes nothing on verified", async () => {
  const dir = await ws();
  await run(dispatchArgs(dir, ["--status", "dispatched", "--mode", "subagent"]));
  let called = false;
  const runner: AgentopRunner = async () => (void (called = true), { code: 0, stdout: "", stderr: "" });
  const { code, output } = await capture(() =>
    run(dispatchArgs(dir, ["--status", "verified", "--pr", "http://pr/1", "--evidence-by", "qa", ...evArgs]), {
      resolveChecks: async () => "green" as CheckVerdict,
      sessionRunner: runner,
    }),
  );
  expect(code).toBe(0);
  expect(called).toBe(false);
  expect(output).not.toContain("CLOSED");
});

test("delivered does NOT close the session — only verified/merged do", async () => {
  const dir = await ws();
  await run(dispatchArgs(dir, ["--status", "dispatched", "--mode", "session", "--session-id", "sess-live"]));
  let called = false;
  const runner: AgentopRunner = async () => (void (called = true), { code: 0, stdout: "", stderr: "" });
  const { code } = await capture(() =>
    run(dispatchArgs(dir, ["--status", "delivered", "--pr", "http://pr/1", ...evArgs]), {
      resolveChecks: async () => "green" as CheckVerdict,
      sessionRunner: runner,
    }),
  );
  expect(code).toBe(0);
  expect(called).toBe(false);
});
