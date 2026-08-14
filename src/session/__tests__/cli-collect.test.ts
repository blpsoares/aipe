import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectCommand } from "../cli";
import { recordDispatch, startJourney } from "../../journey/ledger";
import type { AgentopRunner } from "../types";

async function ledgerWith(status: "dispatched" | "delivered"): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "aipe-sess-collect-"));
  await startJourney(dir, "j1");
  await recordDispatch(dir, "j1", {
    repo: "embark", specialist: "Joaquim", branch: "b", worktree: "w",
    status, mode: "session", sessionId: "s-1",
    ...(status === "delivered"
      ? { evidence: { by: "dev" as const, commands: ["bun test"], summary: "green" } }
      : {}),
  });
  return dir;
}

const live: AgentopRunner = async () => ({ code: 0, stdout: JSON.stringify({ sessions: [{ id: "s-1" }] }), stderr: "" });
const gone: AgentopRunner = async () => ({ code: 0, stdout: JSON.stringify({ sessions: [] }), stderr: "" });
const explodes: AgentopRunner = async () => {
  throw new Error("spawn agentop ENOENT");
};

test("a landed wave exits 0", async () => {
  const dir = await ledgerWith("delivered");
  const r = await collectCommand({ workspace: dir, journeyId: "j1", runner: gone, timeoutMs: 1000, intervalMs: 10, sleep: async () => {} });
  expect(r.code).toBe(0);
  expect(r.lines.join("\n")).toContain("LANDED embark");
});

test("a dead-silent unit exits 2 and names its branch", async () => {
  const dir = await ledgerWith("dispatched");
  const r = await collectCommand({ workspace: dir, journeyId: "j1", runner: gone, timeoutMs: 1000, intervalMs: 10, sleep: async () => {} });
  expect(r.code).toBe(2);
  const out = r.lines.join("\n");
  expect(out).toContain("DEAD-SILENT embark");
  expect(out).toContain("branch b");
  expect(out).toContain("never re-dispatch blind");
});

test("a still-running unit at timeout exits 2 without killing anything", async () => {
  const dir = await ledgerWith("dispatched");
  let ticks = 0;
  const r = await collectCommand({
    workspace: dir, journeyId: "j1", runner: live,
    timeoutMs: 30, intervalMs: 10,
    now: () => (ticks += 20),
    sleep: async () => {},
  });
  expect(r.code).toBe(2);
  expect(r.lines.join("\n")).toContain("RUNNING embark");
  expect(r.lines.join("\n")).toContain("s-1");
});

test("exit code is exactly 0 with two units only when BOTH landed", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-sess-collect-"));
  await startJourney(dir, "j1");
  await recordDispatch(dir, "j1", {
    repo: "embark", specialist: "Joaquim", branch: "b1", worktree: "w1",
    status: "delivered", mode: "session", sessionId: "s-1",
    evidence: { by: "dev", commands: ["bun test"], summary: "green" },
  });
  await recordDispatch(dir, "j1", {
    repo: "kart", specialist: "Ana", branch: "b2", worktree: "w2",
    status: "dispatched", mode: "session", sessionId: "s-2",
  });
  const r = await collectCommand({ workspace: dir, journeyId: "j1", runner: gone, timeoutMs: 1000, intervalMs: 10, sleep: async () => {} });
  // One unit landed, the other is dead-silent: the wave as a whole is NOT
  // clean, so the exit code must be exactly 2, not 0.
  expect(r.code).toBe(2);
  const out = r.lines.join("\n");
  expect(out).toContain("LANDED embark");
  expect(out).toContain("DEAD-SILENT kart");
});

test("--timeout of NaN (a non-numeric flag) is rejected before any poll", async () => {
  const dir = await ledgerWith("dispatched");
  const r = await collectCommand({
    workspace: dir, journeyId: "j1", runner: gone,
    timeoutMs: Number("not-a-number"), intervalMs: 10, sleep: async () => {},
  });
  expect(r.code).toBe(1);
  expect(r.states).toEqual([]);
  expect(r.lines).toEqual(["ERROR timeout: --timeout must be a positive number, got NaN"]);
});

test("a negative --timeout is rejected", async () => {
  const dir = await ledgerWith("dispatched");
  const r = await collectCommand({
    workspace: dir, journeyId: "j1", runner: gone,
    timeoutMs: -1000, intervalMs: 10, sleep: async () => {},
  });
  expect(r.code).toBe(1);
  expect(r.lines).toEqual(["ERROR timeout: --timeout must be a positive number, got -1000"]);
});

test("a zero --timeout is rejected", async () => {
  const dir = await ledgerWith("dispatched");
  const r = await collectCommand({
    workspace: dir, journeyId: "j1", runner: gone,
    timeoutMs: 0, intervalMs: 10, sleep: async () => {},
  });
  expect(r.code).toBe(1);
  expect(r.lines).toEqual(["ERROR timeout: --timeout must be a positive number, got 0"]);
});

test("a journey id with no ledger is reported, not silently treated as clean", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-sess-collect-"));
  const r = await collectCommand({
    workspace: dir, journeyId: "ghost", runner: gone,
    timeoutMs: 1000, intervalMs: 10, sleep: async () => {},
  });
  expect(r.code).toBe(1);
  expect(r.states).toEqual([]);
  expect(r.lines).toEqual(["ERROR journey: no ledger for ghost"]);
});

test("a ledger with no session-mode units is reported, not silently treated as clean", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-sess-collect-"));
  await startJourney(dir, "j1");
  await recordDispatch(dir, "j1", {
    repo: "embark", specialist: "Joaquim", branch: "b", worktree: "w",
    status: "dispatched", mode: "subagent",
  });
  const r = await collectCommand({
    workspace: dir, journeyId: "j1", runner: gone,
    timeoutMs: 1000, intervalMs: 10, sleep: async () => {},
  });
  expect(r.code).toBe(1);
  expect(r.states).toEqual([]);
  expect(r.lines).toEqual(["ERROR journey: j1 has no session-mode units to collect"]);
});

test("pollOnce throwing (runner rejects outright) fails open to RUNNING, not a false landed/dead-silent", async () => {
  const dir = await ledgerWith("dispatched");
  let ticks = 0;
  const r = await collectCommand({
    workspace: dir, journeyId: "j1", runner: explodes,
    timeoutMs: 30, intervalMs: 10,
    now: () => (ticks += 20),
    sleep: async () => {},
  });
  // A thrown pollOnce must never be read as "nobody is out there" (code 0)
  // nor as "everyone died" (dead-silent). The unit still carries a recorded
  // sessionId, so the fail-open fallback must report it RUNNING and exit 2
  // — asking the PE to look, never re-dispatching over possibly-live work.
  expect(r.code).toBe(2);
  const out = r.lines.join("\n");
  expect(out).toContain("RUNNING embark");
  expect(out).toContain("s-1");
  expect(out).not.toContain("DEAD-SILENT");
  expect(out).not.toContain("LANDED");
});

test("pollOnce throwing on a unit with no recorded sessionId still reports dead-silent, not a false landed", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-sess-collect-"));
  await startJourney(dir, "j1");
  await recordDispatch(dir, "j1", {
    repo: "embark", specialist: "Joaquim", branch: "b", worktree: "w",
    status: "dispatched", mode: "session",
  });
  let ticks = 0;
  const r = await collectCommand({
    workspace: dir, journeyId: "j1", runner: explodes,
    timeoutMs: 30, intervalMs: 10,
    now: () => (ticks += 20),
    sleep: async () => {},
  });
  expect(r.code).toBe(2);
  const out = r.lines.join("\n");
  expect(out).toContain("DEAD-SILENT embark");
  expect(out).not.toContain("LANDED");
});

test("the wave never settling terminates the loop at the deadline instead of spinning forever", async () => {
  const dir = await ledgerWith("dispatched");
  let pollCalls = 0;
  const stillLive: AgentopRunner = async () => {
    pollCalls += 1;
    return { code: 0, stdout: JSON.stringify({ sessions: [{ id: "s-1" }] }), stderr: "" };
  };
  let ticks = 0;
  const now = () => (ticks += 10); // advances by intervalMs each call
  const r = await collectCommand({
    workspace: dir, journeyId: "j1", runner: stillLive,
    timeoutMs: 100, intervalMs: 10,
    now, sleep: async () => {},
  });
  expect(r.code).toBe(2);
  expect(r.lines.join("\n")).toContain("RUNNING embark");
  // deadline = now()@call1 (10) + 100 = 110. now() is also called once per
  // iteration for the deadline check, so ticks climbs by 20 per loop pass.
  // The loop must stop at a bounded number of polls, not run indefinitely.
  expect(pollCalls).toBeLessThan(20);
  expect(pollCalls).toBeGreaterThan(0);
});
