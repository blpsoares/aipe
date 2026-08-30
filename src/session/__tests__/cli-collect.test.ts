import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectCommand } from "../cli";
import { recordDispatch, startJourney } from "../../journey/ledger";
import type { AgentopRunner } from "../types";

async function ledgerWith(status: "dispatched" | "delivered" | "blocked"): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "aipe-sess-collect-"));
  await startJourney(dir, "j1");
  await recordDispatch(dir, "j1", {
    repo: "embark", specialist: "Joaquim", branch: "b", worktree: "w",
    status, mode: "session", sessionId: "s-1",
    ...(status === "delivered"
      ? { evidence: { by: "dev" as const, commands: ["bun test"], summary: "green" } }
      : {}),
    ...(status === "blocked" ? { blockedReason: "need the staging DB url" } : {}),
  });
  return dir;
}

const live: AgentopRunner = async () => ({ code: 0, stdout: JSON.stringify({ sessions: [{ id: "s-1" }] }), stderr: "" });
const gone: AgentopRunner = async () => ({ code: 0, stdout: JSON.stringify({ sessions: [] }), stderr: "" });
// agentop STILL LISTS s-1 but marks it lost with a null activity — the exact
// real case this unit exists to catch. Presence must not be read as life.
const lost: AgentopRunner = async () => ({
  code: 0,
  stdout: JSON.stringify({ sessions: [{ id: "s-1", status: "lost", activity: null }] }),
  stderr: "",
});
// Listed, but agentop marks it exited (a clean end). Present, but not alive.
const exited: AgentopRunner = async () => ({
  code: 0,
  stdout: JSON.stringify({ sessions: [{ id: "s-1", status: "exited", activity: null }] }),
  stderr: "",
});
const explodes: AgentopRunner = async () => {
  throw new Error("spawn agentop ENOENT");
};

test("a landed wave exits 0", async () => {
  const dir = await ledgerWith("delivered");
  const r = await collectCommand({ workspace: dir, journeyId: "j1", runner: gone, timeoutMs: 1000, intervalMs: 10, sleep: async () => {} });
  expect(r.code).toBe(0);
  expect(r.lines).toEqual(["LANDED embark"]);
});

test("a dead-silent unit exits 5 (worst finding) and names its branch", async () => {
  const dir = await ledgerWith("dispatched");
  const r = await collectCommand({ workspace: dir, journeyId: "j1", runner: gone, timeoutMs: 1000, intervalMs: 10, sleep: async () => {} });
  expect(r.code).toBe(5);
  expect(r.lines).toEqual([
    "DEAD-SILENT embark branch b worktree w — the session ended without recording. Inspect the branch read-only (git log) and re-dispatch it to CONTINUE from what is there, or escalate: never re-dispatch blind",
  ]);
});

test("a session PRESENT in the list but marked lost is LOST, exits 5, and is NOT reported alive", async () => {
  const dir = await ledgerWith("dispatched");
  const r = await collectCommand({ workspace: dir, journeyId: "j1", runner: lost, timeoutMs: 1000, intervalMs: 10, sleep: async () => {} });
  // The bug was: presence in the list → "the session is alive". A lost session
  // is present but not alive; it must never carry the RUNNING "session is alive"
  // line, and it must lead the coordinator to inspect rather than trust it.
  expect(r.code).toBe(5);
  expect(r.lines).toEqual([
    'LOST embark session s-1 branch b worktree w — agentop lost this session (status "lost"): it did NOT exit cleanly and may be an orphaned process still holding the worktree. NOT alive, NOT a clean end. Inspect the branch read-only (git log), confirm no process is still writing, then re-dispatch to CONTINUE or escalate: never re-dispatch blind',
  ]);
  expect(r.lines[0]).not.toContain("the session is alive");
});

test("a session PRESENT in the list but marked exited is DEAD-SILENT, not RUNNING", async () => {
  const dir = await ledgerWith("dispatched");
  const r = await collectCommand({ workspace: dir, journeyId: "j1", runner: exited, timeoutMs: 1000, intervalMs: 10, sleep: async () => {} });
  // A clean end that never recorded a delivery is dead-silent, same as absence
  // — presence in the list is not proof of life.
  expect(r.code).toBe(5);
  expect(r.lines).toEqual([
    "DEAD-SILENT embark branch b worktree w — the session ended without recording. Inspect the branch read-only (git log) and re-dispatch it to CONTINUE from what is there, or escalate: never re-dispatch blind",
  ]);
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
  expect(r.lines).toEqual([
    "RUNNING embark session s-1 — the session is alive (progress not independently verified); still working past the timeout, the PE decides whether to wait or kill it",
  ]);
});

test("a blocked unit is WAITING-ON-COORDINATOR, exits 6 (the worst finding), and carries its reason", async () => {
  const dir = await ledgerWith("blocked");
  const r = await collectCommand({ workspace: dir, journeyId: "j1", runner: live, timeoutMs: 1000, intervalMs: 10, sleep: async () => {} });
  expect(r.code).toBe(6);
  expect(r.lines).toEqual([
    'WAITING-ON-COORDINATOR embark session s-1 reason="need the staging DB url" — the specialist recorded itself blocked and is waiting on you. Answer what it needs, then it continues',
  ]);
});

test("a persistently-unreadable session list surfaces UNKNOWN at the deadline, exits 4 — never a false dead-silent", async () => {
  const dir = await ledgerWith("dispatched");
  let ticks = 0;
  const r = await collectCommand({
    workspace: dir, journeyId: "j1", runner: explodes,
    timeoutMs: 30, intervalMs: 10,
    now: () => (ticks += 20),
    sleep: async () => {},
  });
  expect(r.code).toBe(4);
  expect(r.lines).toEqual([
    "UNKNOWN embark session s-1 branch b — liveness could not be established (agentop session list was unreadable past the timeout). NOT running, NOT dead: look before you re-dispatch",
  ]);
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
  // clean, and the exit code matches the WORST finding (dead-silent = 5), not 0.
  expect(r.code).toBe(5);
  expect(r.lines).toEqual([
    "LANDED embark",
    "DEAD-SILENT kart branch b2 worktree w2 — the session ended without recording. Inspect the branch read-only (git log) and re-dispatch it to CONTINUE from what is there, or escalate: never re-dispatch blind",
  ]);
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

test("pollOnce throwing (runner rejects outright) degrades to UNKNOWN, never a false landed/dead-silent/running", async () => {
  const dir = await ledgerWith("dispatched");
  let ticks = 0;
  const r = await collectCommand({
    workspace: dir, journeyId: "j1", runner: explodes,
    timeoutMs: 30, intervalMs: 10,
    now: () => (ticks += 20),
    sleep: async () => {},
  });
  // A thrown pollOnce must never be read as "nobody is out there" (code 0), nor
  // as "everyone died" (dead-silent), nor as a guessed "running" (a liveness we
  // cannot verify). The unit carries a sessionId but liveness is unestablished
  // → UNKNOWN, exit 4 — asking the coordinator to look, never re-dispatching
  // over possibly-live work.
  expect(r.code).toBe(4);
  expect(r.lines).toEqual([
    "UNKNOWN embark session s-1 branch b — liveness could not be established (agentop session list was unreadable past the timeout). NOT running, NOT dead: look before you re-dispatch",
  ]);
});

test("a unit that never even got a sessionId is dead-silent regardless of liveness reliability", async () => {
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
  // No sessionId → there is no session for liveness to describe: it never
  // launched. That is dead-silent (worst finding = 5) whether or not agentop
  // was reachable — NOT unknown.
  expect(r.code).toBe(5);
  expect(r.lines).toEqual([
    "DEAD-SILENT embark branch b worktree w — the session ended without recording. Inspect the branch read-only (git log) and re-dispatch it to CONTINUE from what is there, or escalate: never re-dispatch blind",
  ]);
});

test("the wave never settling terminates the loop at the deadline instead of spinning forever", async () => {
  const dir = await ledgerWith("dispatched");
  let pollCalls = 0;
  const stillLive: AgentopRunner = async () => {
    pollCalls += 1;
    return { code: 0, stdout: JSON.stringify({ sessions: [{ id: "s-1" }] }), stderr: "" };
  };
  let ticks = 0;
  const timeoutMs = 100;
  const intervalMs = 10;
  const now = () => (ticks += 10); // advances by intervalMs each call
  // A correctly-terminating loop sleeps at most ceil(timeoutMs / intervalMs)
  // times before `now() >= deadline` breaks it. Double that as headroom so a
  // real pass never trips this, but a loop that never terminates (e.g.
  // `settled || now() >= deadline` mutated to `settled && now() >= deadline`,
  // which can never become true here since `settled` is always false) fails
  // fast with a named error instead of spinning silently until Bun's 5s
  // per-test timeout kills it. `await sleep(...)` inside collectCommand is
  // NOT wrapped in pollOnce's try/catch, so this rejection propagates
  // straight out of collectCommand.
  const maxSleeps = Math.ceil(timeoutMs / intervalMs) * 2;
  let sleepCalls = 0;
  const sleep = async () => {
    sleepCalls += 1;
    if (sleepCalls > maxSleeps) {
      throw new Error(`collect loop exceeded ${maxSleeps} sleeps without terminating`);
    }
  };
  const r = await collectCommand({
    workspace: dir, journeyId: "j1", runner: stillLive,
    timeoutMs, intervalMs,
    now, sleep,
  });
  expect(r.code).toBe(2);
  expect(r.lines).toEqual([
    "RUNNING embark session s-1 — the session is alive (progress not independently verified); still working past the timeout, the PE decides whether to wait or kill it",
  ]);
  // deadline = now()@call1 (10) + 100 = 110. now() is also called once per
  // iteration for the deadline check, so ticks climbs by 20 per loop pass.
  // The loop must stop at a bounded number of polls, not run indefinitely.
  expect(pollCalls).toBeLessThan(20);
  expect(pollCalls).toBeGreaterThan(0);
});
