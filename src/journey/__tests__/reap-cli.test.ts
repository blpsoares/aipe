// `aipe journey reap` end to end: it lists before closing (dry-run closes
// NOTHING), --close acts on the would-close set, blocked is never touched, and a
// stale sessionId is reconciled by worktree. Wired through the injected deps
// (prState + sessionRunner) so it stays offline.
import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../cli";
import { recordDispatch, startJourney } from "../ledger";
import type { JourneyDispatch } from "../types";
import type { AgentopRunner } from "../../session/types";
import type { PrState } from "../reconcile";

async function ws(...dispatches: JourneyDispatch[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "aipe-reap-"));
  await startJourney(dir, "j1");
  for (const d of dispatches) await recordDispatch(dir, "j1", d);
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

function agentop(roster: { id: string; cwd: string; status?: string }[]): { runner: AgentopRunner; kills: string[] } {
  const kills: string[] = [];
  const runner: AgentopRunner = async (args) => {
    if (args[0] === "session" && args[1] === "list") {
      return { code: 0, stdout: JSON.stringify({ sessions: roster.map((e) => ({ id: e.id, status: e.status ?? "running", cwd: e.cwd })) }), stderr: "" };
    }
    if (args[0] === "session" && args[1] === "kill") {
      kills.push(args[2]!);
      return { code: 0, stdout: "", stderr: "" };
    }
    return { code: 0, stdout: "", stderr: "" };
  };
  return { runner, kills };
}

const mergedFor = (...urls: string[]) => async (pr: string): Promise<PrState> => (urls.includes(pr) ? "MERGED" : "OPEN");

const sess = (over: Partial<JourneyDispatch>): JourneyDispatch => ({
  repo: "aipe", specialist: "Jesse", branch: "b", worktree: "/ws/aipe/wt", status: "dispatched", mode: "session", ...over,
});

test("dry-run LISTS the merged unit's session as would-close but closes nothing", async () => {
  const dir = await ws(sess({ status: "merged", pr: "http://pr/1", sessionId: "s1", worktree: "/ws/aipe/wt1" }));
  const { runner, kills } = agentop([{ id: "s1", cwd: "/ws/aipe/wt1" }]);
  const { code, output } = await capture(() =>
    run(["reap", "--workspace", dir, "--journey", "j1"], { sessionRunner: runner, prState: mergedFor("http://pr/1") }),
  );
  expect(code).toBe(0);
  expect(output).toContain("WOULD-CLOSE session s1");
  expect(output).toContain("mode=dry-run");
  expect(output).toContain("would-close=1");
  expect(kills).toEqual([]); // nothing closes on a dry run
});

test("--close acts on the would-close set and reports CLOSED", async () => {
  const dir = await ws(sess({ status: "merged", pr: "http://pr/1", sessionId: "s1", worktree: "/ws/aipe/wt1" }));
  const { runner, kills } = agentop([{ id: "s1", cwd: "/ws/aipe/wt1" }]);
  const { code, output } = await capture(() =>
    run(["reap", "--workspace", dir, "--journey", "j1", "--close"], { sessionRunner: runner, prState: mergedFor("http://pr/1") }),
  );
  expect(code).toBe(0);
  expect(output).toContain("WOULD-CLOSE session s1"); // still lists the plan first
  expect(output).toContain("CLOSED session s1");
  expect(output).toContain("closed=1");
  expect(kills).toEqual(["s1"]);
});

// The three real cases the brief demands as tests.

test("REAL CASE 1 — a merged unit with a STALE sessionId is reconciled by worktree and closed", async () => {
  const dir = await ws(sess({ status: "merged", pr: "http://pr/1", sessionId: "s-OLD", worktree: "/ws/aipe/wt1" }));
  const { runner, kills } = agentop([{ id: "s-NEW", cwd: "/ws/aipe/wt1" }]); // live id differs from the stale ledger id
  const { output } = await capture(() =>
    run(["reap", "--workspace", dir, "--journey", "j1", "--close"], { sessionRunner: runner, prState: mergedFor("http://pr/1") }),
  );
  expect(output).toContain("recorded id s-OLD was stale");
  expect(output).toContain("CLOSED session s-NEW");
  expect(kills).toEqual(["s-NEW"]);
});

test("REAL CASE 3 — a blocked unit is never listed to close, and --close leaves it alone", async () => {
  const dir = await ws(
    sess({ task: "impl", status: "merged", pr: "http://pr/1", sessionId: "s-dev", worktree: "/ws/aipe/impl" }),
    sess({ task: "spike", status: "blocked", pr: "http://pr/2", sessionId: "s-blk", worktree: "/ws/aipe/spike", blockedReason: "need the DB url" }),
  );
  const { runner, kills } = agentop([{ id: "s-dev", cwd: "/ws/aipe/impl" }, { id: "s-blk", cwd: "/ws/aipe/spike" }]);
  const { output } = await capture(() =>
    run(["reap", "--workspace", dir, "--journey", "j1", "--close"], { sessionRunner: runner, prState: mergedFor("http://pr/1", "http://pr/2") }),
  );
  expect(output).toContain("PROTECTED aipe · Jesse session s-blk");
  expect(output).not.toContain("CLOSED session s-blk");
  expect(kills).toEqual(["s-dev"]); // only the merged dev; the blocked one is untouched
});

test("a merged unit whose live session cannot be established is COULD-NOT-ESTABLISH, never guessed closed", async () => {
  const dir = await ws(sess({ status: "merged", pr: "http://pr/1", sessionId: "s-gone", worktree: "/ws/aipe/wt1" }));
  const { runner, kills } = agentop([{ id: "unrelated", cwd: "/ws/other" }]);
  const { output } = await capture(() =>
    run(["reap", "--workspace", dir, "--journey", "j1", "--close"], { sessionRunner: runner, prState: mergedFor("http://pr/1") }),
  );
  expect(output).toContain("COULD-NOT-ESTABLISH aipe · Jesse");
  expect(output).toContain("unresolvable=1");
  expect(kills).toEqual([]);
});
