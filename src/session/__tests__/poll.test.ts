import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classify, parseSessionLiveness, pollOnce, sessionLiveness, type Liveness } from "../poll";
import { recordDispatch, startJourney } from "../../journey/ledger";
import type { JourneyLedger } from "../../journey/types";
import type { AgentopRunner } from "../types";

// A live map keyed the way agentop's `session list --json` gives it: id → the
// liveness we derive from that entry's `status`. Helper so the fixtures below
// read as "these ids are alive" without spelling the Map out each time.
function alive(...ids: string[]): Map<string, Liveness> {
  return new Map(ids.map((id) => [id, "alive"] as const));
}

const ledger: JourneyLedger = {
  id: "j1",
  dispatches: [
    { repo: "embark", specialist: "Joaquim", branch: "b1", worktree: "w1", status: "delivered", mode: "session", sessionId: "s-1",
      evidence: { by: "dev", commands: ["bun test"], summary: "green" } },
    { repo: "prontuario", specialist: "Pedro", branch: "b2", worktree: "w2", status: "dispatched", mode: "session", sessionId: "s-2" },
    { repo: "outro", specialist: "Ana", branch: "b3", worktree: "w3", status: "dispatched", mode: "session", sessionId: "s-3" },
  ],
};

// ── sessionLiveness: the per-status judgment, justified against agentop's own
// grouping (v2.0.0: `hasLive = status==="running" || status==="unregistered"`,
// and `history: ["closed","exited","lost"]`). Every status agentop produces is
// mapped explicitly; an unrecognised one fails OPEN to "alive" (a present id we
// cannot classify must never be declared dead — killing by mistake is worse).

test("running is alive", () => {
  expect(sessionLiveness("running")).toBe("alive");
});

test("unregistered is alive (agentop groups it with running as an active session)", () => {
  expect(sessionLiveness("unregistered")).toBe("alive");
});

test("exited is gone — a clean end, not alive", () => {
  expect(sessionLiveness("exited")).toBe("gone");
});

test("closed is gone — a clean end, not alive", () => {
  expect(sessionLiveness("closed")).toBe("gone");
});

test("lost is its own state — neither alive nor a clean end", () => {
  expect(sessionLiveness("lost")).toBe("lost");
});

test("an unrecognised status fails OPEN to alive, never to dead", () => {
  // A status agentop invents later that we do not yet know must not flip a
  // present session to dead-silent — that is the dangerous direction.
  expect(sessionLiveness("paused-by-someone-new")).toBe("alive");
  // A missing/non-string status is the same class of unknown → still alive.
  expect(sessionLiveness(undefined)).toBe("alive");
  expect(sessionLiveness(42)).toBe("alive");
});

// ── parseSessionLiveness: id → liveness, read out of agentop's json ─────────

test("live session ids are read out of agentop's json with their liveness", () => {
  const out = JSON.stringify({
    sessions: [
      { id: "s-2", status: "running" },
      { id: "s-9", status: "running" },
    ],
  });
  expect(parseSessionLiveness(out)).toEqual(alive("s-2", "s-9"));
});

test("an entry with no status field is treated as alive (fail open), not dropped", () => {
  // The pre-status contract had no `status` at all; a list from an older
  // agentop must degrade to the old presence==alive behaviour, never to dead.
  const out = JSON.stringify({ sessions: [{ id: "s-1" }] });
  expect(parseSessionLiveness(out)).toEqual(alive("s-1"));
});

test("a lost entry is carried with liveness 'lost', not dropped and not alive", () => {
  const out = JSON.stringify({ sessions: [{ id: "s-2", status: "lost", activity: null }] });
  expect(parseSessionLiveness(out)).toEqual(new Map([["s-2", "lost"]]));
});

test("exited and closed entries are carried as 'gone'", () => {
  const out = JSON.stringify({
    sessions: [
      { id: "s-2", status: "exited" },
      { id: "s-3", status: "closed" },
    ],
  });
  expect(parseSessionLiveness(out)).toEqual(
    new Map([
      ["s-2", "gone"],
      ["s-3", "gone"],
    ]),
  );
});

test("a recorded delivery is landed regardless of the session being gone", () => {
  const states = classify(ledger, alive("s-2"));
  expect(states.find((s) => s.fqid === "embark")!.phase).toBe("landed");
});

test("a live (running) session with no record is running", () => {
  const states = classify(ledger, alive("s-2"));
  expect(states.find((s) => s.fqid === "prontuario")!.phase).toBe("running");
});

test("a vanished session with no record is dead-silent, and carries its branch", () => {
  const states = classify(ledger, alive("s-2"));
  const dead = states.find((s) => s.fqid === "outro")!;
  expect(dead.phase).toBe("dead-silent");
  expect(dead.branch).toBe("b3");
  expect(dead.worktree).toBe("w3");
});

// ── the defect this unit exists to fix: presence in the list is NOT proof of
// life. A session agentop still LISTS but marks terminal/lost must not read as
// running just because its id is present.

test("a session PRESENT in the list but marked lost is NOT running — it is reported lost", () => {
  // The exact real case from the brief: status "lost", activity null, for the
  // id the ledger recorded. Old code (presence==alive) called this running.
  const states = classify(ledger, new Map([["s-2", "lost"]]));
  const pedro = states.find((s) => s.fqid === "prontuario")!;
  expect(pedro.phase).toBe("lost");
  expect(pedro.phase).not.toBe("running");
});

test("a session PRESENT in the list but marked exited/closed is dead-silent, not running", () => {
  const states = classify(ledger, new Map([["s-2", "gone"]]));
  expect(states.find((s) => s.fqid === "prontuario")!.phase).toBe("dead-silent");
});

test("subagent-mode units are not the poller's business", () => {
  const mixed: JourneyLedger = {
    id: "j2",
    dispatches: [{ repo: "embark", specialist: "J", branch: "b", worktree: "w", status: "dispatched" }],
  };
  expect(classify(mixed, new Map())).toEqual([]);
});

test("a monorepo package is keyed by its fqid", () => {
  const mono: JourneyLedger = {
    id: "j3",
    dispatches: [{ repo: "embark", package: "api", specialist: "J", branch: "b", worktree: "w", status: "dispatched", mode: "session", sessionId: "s-7" }],
  };
  expect(classify(mono, alive("s-7"))[0]!.fqid).toBe("embark/api");
});

// ── parseSessionLiveness hardening ─────────────────────────────────────────

test("garbage stdout on a successful exit throws instead of reading as an empty live list", () => {
  expect(() => parseSessionLiveness("not json")).toThrow();
});

test("an entry with a missing id throws instead of being silently dropped", () => {
  const out = JSON.stringify({ sessions: [{ id: "s-1" }, { notId: "x" }] });
  expect(() => parseSessionLiveness(out)).toThrow();
});

test("an entry with a non-string id throws instead of being silently dropped", () => {
  const out = JSON.stringify({ sessions: [{ id: "s-1" }, { id: 42 }] });
  expect(() => parseSessionLiveness(out)).toThrow();
});

test("an entry with an empty-string id throws instead of being silently dropped", () => {
  const out = JSON.stringify({ sessions: [{ id: "s-1" }, { id: "" }] });
  expect(() => parseSessionLiveness(out)).toThrow();
});

// ── parseSessionLiveness: top-level shape hardening ────────────────────────

test("a bare array is read directly, without needing a sessions wrapper", () => {
  const out = JSON.stringify([{ id: "s-1", status: "running" }, { id: "s-2", status: "running" }]);
  expect(parseSessionLiveness(out)).toEqual(alive("s-1", "s-2"));
});

test("a genuinely empty array is a confident, well-formed empty result", () => {
  expect(parseSessionLiveness(JSON.stringify([]))).toEqual(new Map());
});

test("a genuinely empty sessions object is a confident, well-formed empty result", () => {
  expect(parseSessionLiveness(JSON.stringify({ sessions: [] }))).toEqual(new Map());
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
  expect(() => parseSessionLiveness(out)).toThrow();
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
  const reliable = classify(ledger, alive("s-2")); // default reliable=true
  expect(reliable.find((s) => s.fqid === "prontuario")!.phase).toBe("running");
  const unreliable = classify(ledger, alive("s-2"), false);
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
  const states = classify(blocked, new Map(), true);
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

test("pollOnce reports a listed-but-lost session as lost, not running (the real regression case)", async () => {
  const dir = await ledgerDir();
  // The id the ledger recorded (s-1) is still in agentop's list, but marked
  // lost with a null activity — exactly the brief's stub. Presence must not be
  // read as life.
  const lostRunner: AgentopRunner = async () => ({
    code: 0,
    stdout: JSON.stringify({ sessions: [{ id: "s-1", status: "lost", activity: null }] }),
    stderr: "",
  });
  const states = await pollOnce(dir, "j1", lostRunner);
  expect(states).toHaveLength(1);
  expect(states[0]!.phase).toBe("lost");
});

test("pollOnce with no ledger for the journey returns no units", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-sess-poll-empty-"));
  const runner: AgentopRunner = async () => ({ code: 0, stdout: JSON.stringify({ sessions: [] }), stderr: "" });
  expect(await pollOnce(dir, "nope", runner)).toEqual([]);
});
