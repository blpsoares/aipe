import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classify, parseSessionList, pollOnce } from "../poll";
import { recordDispatch, startJourney } from "../../journey/ledger";
import type { JourneyLedger } from "../../journey/types";
import type { AgentopRunner } from "../types";

const ledger: JourneyLedger = {
  id: "j1",
  dispatches: [
    { repo: "embark", specialist: "Joaquim", branch: "b1", worktree: "w1", status: "delivered", mode: "session", sessionId: "s-1",
      evidence: { by: "dev", commands: ["bun test"], summary: "green" } },
    { repo: "prontuario", specialist: "Pedro", branch: "b2", worktree: "w2", status: "dispatched", mode: "session", sessionId: "s-2" },
    { repo: "outro", specialist: "Ana", branch: "b3", worktree: "w3", status: "dispatched", mode: "session", sessionId: "s-3" },
  ],
};

test("live session ids are read out of agentop's json", () => {
  const out = JSON.stringify({ sessions: [{ id: "s-2" }, { id: "s-9" }] });
  expect(parseSessionList(out)).toEqual(new Set(["s-2", "s-9"]));
});

test("a recorded delivery is landed regardless of the session being gone", () => {
  const states = classify(ledger, new Set(["s-2"]));
  expect(states.find((s) => s.fqid === "embark")!.phase).toBe("landed");
});

test("a live session with no record is running", () => {
  const states = classify(ledger, new Set(["s-2"]));
  expect(states.find((s) => s.fqid === "prontuario")!.phase).toBe("running");
});

test("a vanished session with no record is dead-silent, and carries its branch", () => {
  const states = classify(ledger, new Set(["s-2"]));
  const dead = states.find((s) => s.fqid === "outro")!;
  expect(dead.phase).toBe("dead-silent");
  expect(dead.branch).toBe("b3");
  expect(dead.worktree).toBe("w3");
});

test("subagent-mode units are not the poller's business", () => {
  const mixed: JourneyLedger = {
    id: "j2",
    dispatches: [{ repo: "embark", specialist: "J", branch: "b", worktree: "w", status: "dispatched" }],
  };
  expect(classify(mixed, new Set())).toEqual([]);
});

test("a monorepo package is keyed by its fqid", () => {
  const mono: JourneyLedger = {
    id: "j3",
    dispatches: [{ repo: "embark", package: "api", specialist: "J", branch: "b", worktree: "w", status: "dispatched", mode: "session", sessionId: "s-7" }],
  };
  expect(classify(mono, new Set(["s-7"]))[0]!.fqid).toBe("embark/api");
});

// ── parseSessionList hardening ────────────────────────────────────────────

test("garbage stdout on a successful exit throws instead of reading as an empty live list", () => {
  expect(() => parseSessionList("not json")).toThrow();
});

test("an entry with no usable id is dropped, not defaulted, while its siblings survive", () => {
  const out = JSON.stringify({ sessions: [{ id: "s-1" }, { notId: "x" }, { id: 42 }, { id: "s-2" }] });
  expect(parseSessionList(out)).toEqual(new Set(["s-1", "s-2"]));
});

// ── pollOnce: a failed/unparseable `session list` call must fail OPEN ─────
// (never downgrade an in-flight unit to dead-silent just because we could
// not ask agentop) but a confirmed-empty list must still call it correctly.

async function ledgerDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "aipe-sess-poll-"));
  await startJourney(dir, "j1");
  await recordDispatch(dir, "j1", {
    repo: "embark", specialist: "Joaquim", branch: "b1", worktree: "w1",
    status: "dispatched", mode: "session", sessionId: "s-1",
  });
  return dir;
}

test("a nonzero exit from the list call reports the outstanding unit as running, not dead-silent", async () => {
  const dir = await ledgerDir();
  const failing: AgentopRunner = async () => ({ code: 1, stdout: "", stderr: "daemon down" });
  const states = await pollOnce(dir, "j1", failing);
  expect(states).toHaveLength(1);
  expect(states[0]!.phase).toBe("running");
});

test("unparseable stdout on a successful exit also fails open to running", async () => {
  const dir = await ledgerDir();
  const garbled: AgentopRunner = async () => ({ code: 0, stdout: "{not json", stderr: "" });
  const states = await pollOnce(dir, "j1", garbled);
  expect(states).toHaveLength(1);
  expect(states[0]!.phase).toBe("running");
});

test("a genuinely empty, well-formed list from a successful exit still yields dead-silent", async () => {
  const dir = await ledgerDir();
  const confirmedEmpty: AgentopRunner = async () => ({ code: 0, stdout: JSON.stringify({ sessions: [] }), stderr: "" });
  const states = await pollOnce(dir, "j1", confirmedEmpty);
  expect(states).toHaveLength(1);
  expect(states[0]!.phase).toBe("dead-silent");
});

test("pollOnce with no ledger for the journey returns no units", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-sess-poll-empty-"));
  const runner: AgentopRunner = async () => ({ code: 0, stdout: JSON.stringify({ sessions: [] }), stderr: "" });
  expect(await pollOnce(dir, "nope", runner)).toEqual([]);
});
