// The trigger itself (#73): running `aipe status` — an edge aipe ALREADY
// executes — collects a session whose process has EXITED, with no one running a
// reap by hand, AND leaves a `waiting` session intact. "As duas metades são o
// aceite; provar só a colheita reprova." The report still renders after the
// harvest, and `--no-harvest` turns the trigger off.
import { expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../cli";
import type { AgentopRunner } from "../../session/types";
import type { RosterEntry } from "../../session/poll";

async function ws(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "aipe-trigger-"));
  await mkdir(join(dir, ".aipe", "journeys"), { recursive: true });
  await writeFile(
    join(dir, ".aipe", "brain.yaml"),
    "context:\n  name: blpsoares\n  coordinator: Heisenberg\nrepos:\n  - name: aipe\n    url: https://x/y.git\n    path: ./aipe\n",
    "utf8",
  );
  return dir;
}

async function writeLedger(dir: string, id: string, sessionId: string, worktree: string): Promise<void> {
  await writeFile(
    join(dir, ".aipe", "journeys", `${id}.yaml`),
    `id: ${id}\ndispatches:\n  - repo: aipe\n    specialist: Jesse\n    branch: aipe/${id}/jesse\n    worktree: ${worktree}\n    status: dispatched\n    mode: session\n    sessionId: ${sessionId}\n`,
    "utf8",
  );
}

const entry = (id: string, cwd: string, liveness: RosterEntry["liveness"]): RosterEntry => ({ id, liveness, cwd, task: "aipe/j", label: id });

function fakeAgentop(initial: RosterEntry[]): { runner: AgentopRunner; kills: string[] } {
  const roster = [...initial];
  const kills: string[] = [];
  const runner: AgentopRunner = async (args) => {
    if (args[0] === "session" && args[1] === "list") {
      return { code: 0, stdout: JSON.stringify(roster.map((e) => ({ id: e.id, status: e.liveness === "gone" ? "exited" : "running", cwd: e.cwd, task: e.task, label: e.label }))), stderr: "" };
    }
    if (args[0] === "session" && args[1] === "kill") {
      kills.push(args[2]!);
      const i = roster.findIndex((e) => e.id === args[2]);
      if (i >= 0) roster.splice(i, 1);
      return { code: 0, stdout: "", stderr: "" };
    }
    if (args[0] === "session" && args[1] === "probe") return { code: 0, stdout: "", stderr: "" };
    return { code: 0, stdout: "[]", stderr: "" };
  };
  return { runner, kills };
}

async function withStreams<T>(fn: () => Promise<T>): Promise<{ out: string; err: string; result: T }> {
  const outLines: string[] = [];
  const errLines: string[] = [];
  const ol = console.log;
  const oe = console.error;
  console.log = ((s: string) => outLines.push(s)) as typeof console.log;
  console.error = ((s: string) => errLines.push(s)) as typeof console.error;
  try {
    const result = await fn();
    return { out: outLines.join("\n"), err: errLines.join("\n"), result };
  } finally {
    console.log = ol;
    console.error = oe;
  }
}

test("running `aipe status` collects the EXITED session and leaves the WAITING one intact", async () => {
  const dir = await ws();
  await writeLedger(dir, "j-dead", "s-dead", "/wt/dead");
  await writeLedger(dir, "j-wait", "s-waiting", "/wt/wait");
  const fake = fakeAgentop([entry("s-dead", "/wt/dead", "gone"), entry("s-waiting", "/wt/wait", "alive")]);

  const { result, err } = await withStreams(() =>
    run(["--workspace", dir, "--all"], { runner: fake.runner, stdout: { isTTY: false }, env: {} }),
  );

  expect(result).toBe(0);
  // the exited session was collected — no one ran a reap by hand
  expect(fake.kills).toEqual(["s-dead"]);
  // and it is announced (on stderr, so --json stdout stays clean)
  expect(err).toContain("s-dead");
});

test("the harvest notice goes to stderr, so `--json` stdout stays parseable", async () => {
  const dir = await ws();
  await writeLedger(dir, "j-dead", "s-dead", "/wt/dead");
  const fake = fakeAgentop([entry("s-dead", "/wt/dead", "gone")]);
  const { out } = await withStreams(() => run(["--workspace", dir, "--all", "--json"], { runner: fake.runner }));
  // stdout is exactly the report JSON — the harvest line did not corrupt it
  expect(() => JSON.parse(out)).not.toThrow();
  expect(fake.kills).toEqual(["s-dead"]);
});

test("--no-harvest turns the trigger off — nothing is collected", async () => {
  const dir = await ws();
  await writeLedger(dir, "j-dead", "s-dead", "/wt/dead");
  const fake = fakeAgentop([entry("s-dead", "/wt/dead", "gone")]);
  const { result } = await withStreams(() =>
    run(["--workspace", dir, "--all", "--no-harvest"], { runner: fake.runner, stdout: { isTTY: false }, env: {} }),
  );
  expect(result).toBe(0);
  expect(fake.kills).toEqual([]);
});
