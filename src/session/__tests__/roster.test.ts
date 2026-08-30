// parseSessionRoster: the richer read of `agentop session list --json` that
// carries each entry's cwd/task/label alongside its liveness, so a close can
// reconcile a stale sessionId back to the real session by its worktree. It
// shares the exact contract-break guards parseSessionLiveness leans on (they
// now delegate to the same parser), so a broken/ambiguous list still THROWS
// rather than reading as "nobody is running".
import { expect, test } from "bun:test";
import { parseSessionRoster, parseSessionLiveness } from "../poll";

// The real agentop v2.0.0 shape, trimmed to the fields AIPe reads.
const realish = JSON.stringify({
  sessions: [
    { id: "ddc05d8a67", status: "running", activity: "waiting", harness: "claude", cwd: "/home/u/aipe/.worktrees/c5-jesse", label: "Jesse-c5", task: "aipe/j-20260830-c5" },
    { id: "1647f72dc2", status: "running", activity: "waiting", harness: "claude", cwd: "/home/u/ws", label: "COORDENADOR", task: null },
  ],
});

test("each entry carries id, liveness, cwd, task and label", () => {
  const roster = parseSessionRoster(realish);
  expect(roster).toEqual([
    { id: "ddc05d8a67", liveness: "alive", cwd: "/home/u/aipe/.worktrees/c5-jesse", task: "aipe/j-20260830-c5", label: "Jesse-c5" },
    { id: "1647f72dc2", liveness: "alive", cwd: "/home/u/ws", task: null, label: "COORDENADOR" },
  ]);
});

test("a missing/empty cwd, task or label reads as null, never a mispairing empty string", () => {
  const out = JSON.stringify({ sessions: [{ id: "s-1", status: "running", cwd: "", task: "", label: "" }, { id: "s-2", status: "running" }] });
  const roster = parseSessionRoster(out);
  expect(roster[0]).toEqual({ id: "s-1", liveness: "alive", cwd: null, task: null, label: null });
  expect(roster[1]).toEqual({ id: "s-2", liveness: "alive", cwd: null, task: null, label: null });
});

test("liveness is judged from status just like parseSessionLiveness (lost/gone are carried, not dropped)", () => {
  const out = JSON.stringify({ sessions: [{ id: "s-1", status: "lost" }, { id: "s-2", status: "exited" }, { id: "s-3", status: "running" }] });
  const roster = parseSessionRoster(out);
  expect(roster.map((e) => [e.id, e.liveness])).toEqual([["s-1", "lost"], ["s-2", "gone"], ["s-3", "alive"]]);
});

test("parseSessionLiveness is now derived from the roster and preserves its map exactly", () => {
  expect(parseSessionLiveness(realish)).toEqual(new Map([["ddc05d8a67", "alive"], ["1647f72dc2", "alive"]]));
});

test("a bare array (no sessions wrapper) is read directly", () => {
  const out = JSON.stringify([{ id: "s-1", status: "running", cwd: "/w" }]);
  expect(parseSessionRoster(out)).toEqual([{ id: "s-1", liveness: "alive", cwd: "/w", task: null, label: null }]);
});

test("garbage/unrecognised-shape/bad-id all THROW (the contract-break guard is shared)", () => {
  expect(() => parseSessionRoster("not json")).toThrow();
  expect(() => parseSessionRoster(JSON.stringify({ result: {} }))).toThrow();
  expect(() => parseSessionRoster(JSON.stringify({ sessions: [{ id: "" }] }))).toThrow();
  expect(() => parseSessionRoster(JSON.stringify({ sessions: [{ notId: "x" }] }))).toThrow();
});
