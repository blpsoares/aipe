// harvestDeadSessions: the automatic-harvest orchestration behind `aipe status`
// (#73). It reads agentop's live roster once, plans the dead-process close (no
// forge, no human decision), executes it, and reports what it collected. It
// NEVER throws — a harvest failure must never break the status report. The
// coordinator's `journey reap --close` still owns the OTHER close (a live
// session whose PR merged): that is a judgement call, not automated here.
import { expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { harvestDeadSessions } from "../harvest";
import type { AgentopRunner } from "../../session/types";
import type { RosterEntry } from "../../session/poll";

async function ws(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "aipe-harvest-"));
  await mkdir(join(dir, ".aipe", "journeys"), { recursive: true });
  return dir;
}

async function writeLedger(dir: string, id: string, body: string): Promise<void> {
  await writeFile(join(dir, ".aipe", "journeys", `${id}.yaml`), body, "utf8");
}

// A ledger with one session-mode dispatch at the given worktree/sessionId.
function ledgerYaml(id: string, sessionId: string, worktree: string, status = "dispatched"): string {
  return `id: ${id}\ndispatches:\n  - repo: aipe\n    specialist: Jesse\n    branch: aipe/${id}/jesse\n    worktree: ${worktree}\n    status: ${status}\n    mode: session\n    sessionId: ${sessionId}\n`;
}

// A stateful fake agentop: `session list --json` returns the current roster;
// `session kill <id>` removes that id from the roster and exits 0 (agentop's
// real behaviour on a session it can act on). Records every kill.
function fakeAgentop(initial: RosterEntry[]): { runner: AgentopRunner; kills: string[]; roster: RosterEntry[] } {
  const roster = [...initial];
  const kills: string[] = [];
  const runner: AgentopRunner = async (args) => {
    if (args[0] === "session" && args[1] === "list") {
      return { code: 0, stdout: JSON.stringify(roster.map((e) => ({ id: e.id, status: e.liveness === "gone" ? "exited" : e.liveness === "lost" ? "lost" : "running", cwd: e.cwd, task: e.task, label: e.label }))), stderr: "" };
    }
    if (args[0] === "session" && args[1] === "kill") {
      const id = args[2]!;
      kills.push(id);
      const i = roster.findIndex((e) => e.id === id);
      if (i >= 0) roster.splice(i, 1);
      return { code: 0, stdout: "", stderr: "" };
    }
    return { code: 1, stdout: "", stderr: "unexpected" };
  };
  return { runner, kills, roster };
}

const entry = (id: string, cwd: string, liveness: RosterEntry["liveness"]): RosterEntry => ({ id, liveness, cwd, task: "aipe/j", label: id });

test("an EXITED session is collected — killed exactly once, and reported CLOSED", async () => {
  const dir = await ws();
  await writeLedger(dir, "j-1", ledgerYaml("j-1", "s-dead", "/wt/dead"));
  const fake = fakeAgentop([entry("s-dead", "/wt/dead", "gone")]);
  const res = await harvestDeadSessions(dir, fake.runner);
  expect(fake.kills).toEqual(["s-dead"]);
  expect(res.closed.some((l) => l.closed && l.line.includes("s-dead"))).toBe(true);
  expect(res.planned).toBe(1);
});

test("a WAITING (alive) session survives the same trigger — never killed", async () => {
  const dir = await ws();
  await writeLedger(dir, "j-1", ledgerYaml("j-1", "s-waiting", "/wt/wait"));
  const fake = fakeAgentop([entry("s-waiting", "/wt/wait", "alive")]);
  const res = await harvestDeadSessions(dir, fake.runner);
  expect(fake.kills).toEqual([]);
  expect(res.planned).toBe(0);
});

test("BOTH at once: the exited one is collected, the waiting one is left intact — the two halves of the acceptance", async () => {
  const dir = await ws();
  await writeLedger(dir, "j-1", ledgerYaml("j-1", "s-dead", "/wt/dead"));
  await writeLedger(dir, "j-2", ledgerYaml("j-2", "s-waiting", "/wt/wait"));
  const fake = fakeAgentop([entry("s-dead", "/wt/dead", "gone"), entry("s-waiting", "/wt/wait", "alive")]);
  const res = await harvestDeadSessions(dir, fake.runner);
  expect(fake.kills).toEqual(["s-dead"]);
  expect(fake.roster.map((e) => e.id)).toEqual(["s-waiting"]); // waiting still on the roster
  expect(res.planned).toBe(1);
});

test("an unreadable roster harvests NOTHING and does not throw", async () => {
  const dir = await ws();
  await writeLedger(dir, "j-1", ledgerYaml("j-1", "s-dead", "/wt/dead"));
  const runner: AgentopRunner = async () => ({ code: 1, stdout: "", stderr: "agentop down" });
  const res = await harvestDeadSessions(dir, runner);
  expect(res.planned).toBe(0);
  expect(res.closed).toEqual([]);
});

test("an agentop that throws does not break the harvest", async () => {
  const dir = await ws();
  await writeLedger(dir, "j-1", ledgerYaml("j-1", "s-dead", "/wt/dead"));
  const runner: AgentopRunner = async () => { throw new Error("boom"); };
  const res = await harvestDeadSessions(dir, runner);
  expect(res.planned).toBe(0);
  expect(res.closed).toEqual([]);
});

test("no dead sessions anywhere — a clean roster is a no-op", async () => {
  const dir = await ws();
  await writeLedger(dir, "j-1", ledgerYaml("j-1", "s-live", "/wt/live"));
  const fake = fakeAgentop([entry("s-live", "/wt/live", "alive")]);
  const res = await harvestDeadSessions(dir, fake.runner);
  expect(fake.kills).toEqual([]);
  expect(res.planned).toBe(0);
  expect(res.closed).toEqual([]);
});
