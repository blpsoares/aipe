import { expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deltaSilenced, logStatusDelta } from "../delta";
import type { AgentopRunner } from "../../session/types";

const noAgentop: AgentopRunner = async () => ({ code: 1, stdout: "", stderr: "" });
const tty = { isTTY: true };

async function ws(pref: string, ledger: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "aipe-delta-"));
  await mkdir(join(dir, ".aipe", "journeys"), { recursive: true });
  await writeFile(
    join(dir, ".aipe", "brain.yaml"),
    `context:\n  name: blpsoares\n  coordinator: Heisenberg\n${pref}repos:\n  - name: aipe\n    url: https://x/y.git\n    path: ./aipe\n`,
    "utf8",
  );
  await writeFile(join(dir, ".aipe", "journeys", "j-1.yaml"), ledger, "utf8");
  return dir;
}

const AUTO_ON = "  statusUpdates:\n    auto: true\n    format: compact\n";
const AUTO_OFF = "  statusUpdates:\n    auto: false\n    format: compact\n";
const LEDGER =
  "id: j-1\ndispatches:\n  - repo: aipe\n    specialist: Jesse\n    branch: aipe/j-1/jesse\n    worktree: w\n    status: dispatched\n    mode: session\n    sessionId: s-1\n";

function collect(): { log: (s: string) => void; lines: string[] } {
  const lines: string[] = [];
  return { log: (s) => lines.push(s), lines };
}

test("with auto:true and a TTY, the delta prints a CHANGED table (item 9)", async () => {
  const dir = await ws(AUTO_ON, LEDGER);
  const c = collect();
  const lines = await logStatusDelta({
    workspace: dir,
    journeyId: "j-1",
    changed: (u) => u.journey === "j-1",
    argv: [],
    runner: noAgentop,
    stdout: tty,
    env: {},
    log: c.log,
  });
  const text = lines.join("\n");
  expect(text).toContain("status update");
  expect(text).toContain("CHANGED");
  expect(text).toContain("Jesse");
});

test("with auto:false the push is silent — (10) is the switch for (9)", async () => {
  const dir = await ws(AUTO_OFF, LEDGER);
  const c = collect();
  const lines = await logStatusDelta({
    workspace: dir, journeyId: "j-1", changed: () => true, argv: [], runner: noAgentop, stdout: tty, env: {}, log: c.log,
  });
  expect(lines).toEqual([]);
  expect(c.lines).toEqual([]);
});

test("off a TTY it is automatically silent, even with auto:true (item 9)", async () => {
  const dir = await ws(AUTO_ON, LEDGER);
  const lines = await logStatusDelta({
    workspace: dir, journeyId: "j-1", changed: () => true, argv: [], runner: noAgentop, stdout: { isTTY: false }, env: {},
  });
  expect(lines).toEqual([]);
});

test("--no-status silences it even on a TTY with auto:true", async () => {
  const dir = await ws(AUTO_ON, LEDGER);
  const lines = await logStatusDelta({
    workspace: dir, journeyId: "j-1", changed: () => true, argv: ["--no-status"], runner: noAgentop, stdout: tty, env: {},
  });
  expect(lines).toEqual([]);
});

test("deltaSilenced honors --no-status and AIPE_STATUS_DELTA=off", () => {
  expect(deltaSilenced(["--no-status"], {})).toBe(true);
  expect(deltaSilenced([], { AIPE_STATUS_DELTA: "off" })).toBe(true);
  expect(deltaSilenced([], { AIPE_STATUS_DELTA: "0" })).toBe(true);
  expect(deltaSilenced([], {})).toBe(false);
  expect(deltaSilenced([], { AIPE_STATUS_DELTA: "on" })).toBe(false);
});

test("a broken workspace never throws out of the delta (presentation only, item 9)", async () => {
  // point at a dir with a corrupt brain — loadReport degrades, delta stays inert
  const dir = await mkdtemp(join(tmpdir(), "aipe-delta-bad-"));
  await mkdir(join(dir, ".aipe"), { recursive: true });
  await writeFile(join(dir, ".aipe", "brain.yaml"), "::: not yaml :::", "utf8");
  const lines = await logStatusDelta({
    workspace: dir, journeyId: "j-1", changed: () => true, argv: [], runner: noAgentop, stdout: tty, env: {},
  });
  expect(lines).toEqual([]); // brain unreadable → pref default auto:false → silent, no throw
});
