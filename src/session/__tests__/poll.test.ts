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

test("an entry with a missing id throws instead of being silently dropped", () => {
  const out = JSON.stringify({ sessions: [{ id: "s-1" }, { notId: "x" }] });
  expect(() => parseSessionList(out)).toThrow();
});

test("an entry with a non-string id throws instead of being silently dropped", () => {
  const out = JSON.stringify({ sessions: [{ id: "s-1" }, { id: 42 }] });
  expect(() => parseSessionList(out)).toThrow();
});

test("an entry with an empty-string id throws instead of being silently dropped", () => {
  const out = JSON.stringify({ sessions: [{ id: "s-1" }, { id: "" }] });
  expect(() => parseSessionList(out)).toThrow();
});

// ── parseSessionList: top-level shape hardening ────────────────────────────

test("a bare array is read directly, without needing a sessions wrapper", () => {
  const out = JSON.stringify([{ id: "s-1" }, { id: "s-2" }]);
  expect(parseSessionList(out)).toEqual(new Set(["s-1", "s-2"]));
});

test("a genuinely empty array is a confident, well-formed empty result", () => {
  expect(parseSessionList(JSON.stringify([]))).toEqual(new Set());
});

test("a genuinely empty sessions object is a confident, well-formed empty result", () => {
  expect(parseSessionList(JSON.stringify({ sessions: [] }))).toEqual(new Set());
});

test.each([
  ["null", "null"],
  ["an empty object", "{}"],
  ["a bare number", "42"],
  ["a bare string", JSON.stringify("a string")],
  ["an error object", JSON.stringify({ error: "boom" })],
  ["a differently-shaped wrapper", JSON.stringify({ result: { sessions: [] } })],
  ["a renamed sessions field", JSON.stringify({ status: "ok" })],
])("valid JSON with an unrecognised top-level shape (%s) throws rather than reading as empty", (_label, out) => {
  expect(() => parseSessionList(out)).toThrow();
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

test("a nonzero exit from the list call reports the outstanding unit as unknown, not dead-silent and not a guessed running", async () => {
  const dir = await ledgerDir();
  const failing: AgentopRunner = async () => ({ code: 1, stdout: "", stderr: "daemon down" });
  const states = await pollOnce(dir, "j1", failing);
  expect(states).toHaveLength(1);
  // D6: liveness could not be established. We must not flip a live unit to dead
  // (the dangerous direction), and we must not assert a `running` we cannot
  // verify. `unknown` is the honest state.
  expect(states[0]!.phase).toBe("unknown");
});

test("unparseable stdout on a successful exit also degrades to unknown, not a guessed running", async () => {
  const dir = await ledgerDir();
  const garbled: AgentopRunner = async () => ({ code: 0, stdout: "{not json", stderr: "" });
  const states = await pollOnce(dir, "j1", garbled);
  expect(states).toHaveLength(1);
  expect(states[0]!.phase).toBe("unknown");
});

test("classify defaults to a reliable list, but an unreliable one degrades an in-flight unit to unknown", () => {
  const reliable = classify(ledger, new Set(["s-2"])); // default reliable=true
  expect(reliable.find((s) => s.fqid === "prontuario")!.phase).toBe("running");
  const unreliable = classify(ledger, new Set(["s-2"]), false);
  expect(unreliable.find((s) => s.fqid === "prontuario")!.phase).toBe("unknown");
  // a landed unit stays landed regardless of liveness reliability
  expect(unreliable.find((s) => s.fqid === "embark")!.phase).toBe("landed");
});

test("a blocked unit is classified waiting and carries its reason, regardless of liveness", () => {
  const blocked: JourneyLedger = {
    id: "jb",
    dispatches: [
      { repo: "aipe", specialist: "Jesse", branch: "b", worktree: "w", status: "blocked", mode: "session", sessionId: "s-1", blockedReason: "need the API key" },
    ],
  };
  // even with the session gone from a reliable list, blocked → waiting
  const states = classify(blocked, new Set(), true);
  expect(states[0]!.phase).toBe("waiting");
  expect(states[0]!.reason).toBe("need the API key");
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
