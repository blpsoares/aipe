// closeUnitSessions: the UNIT-scoped, status-guarded, stale-id-reconciling close
// that ends a landed unit's sessions honestly (items 1 + 2 + 3 of the
// orphan-session brief). Driven directly so the roster (with cwd) and the exact
// record set are under the test's control.
import { expect, test } from "bun:test";
import { closeUnitSessions } from "../session-close";
import type { JourneyDispatch } from "../types";
import type { AgentopRunner } from "../../session/types";

// A runner modeling real agentop: `session list --json` returns a roster
// (each entry carries id + cwd, as v2.0.0 does); `session kill <id>` records the
// id and exits 0 even for an id that matches nothing (the false success the
// honest close must not be fooled by).
function agentop(
  roster: { id: string; cwd?: string; status?: string }[],
  opts: { listCode?: number; throws?: boolean; killCode?: (id: string) => number } = {},
): { runner: AgentopRunner; kills: string[] } {
  const kills: string[] = [];
  const runner: AgentopRunner = async (args) => {
    if (opts.throws) throw new Error("ENOENT: agentop not found");
    if (args[0] === "session" && args[1] === "list") {
      return {
        code: opts.listCode ?? 0,
        stdout: JSON.stringify({ sessions: roster.map((e) => ({ id: e.id, status: e.status ?? "running", cwd: e.cwd })) }),
        stderr: "",
      };
    }
    if (args[0] === "session" && args[1] === "kill") {
      kills.push(args[2]!);
      const code = opts.killCode ? opts.killCode(args[2]!) : 0;
      return { code, stdout: "", stderr: code === 0 ? "" : `No session matches "${args[2]}".` };
    }
    return { code: 0, stdout: "", stderr: "" };
  };
  return { runner, kills };
}

const sess = (over: Partial<JourneyDispatch>): JourneyDispatch => ({
  repo: "aipe", specialist: "Jesse", branch: "b", worktree: "/ws/aipe/.worktrees/j1-jesse",
  status: "dispatched", mode: "session", ...over,
});

// ── item 1: close by UNIT, across tasks ──────────────────────────────────────

test("a QA gate that verified under ANOTHER task still closes the DEV's delivered session on the unit", async () => {
  // The real leak: dev delivered under task "impl"; QA verified under task
  // "gate". A per-task close would miss the dev. Unit-scoped closes both.
  const records: JourneyDispatch[] = [
    sess({ specialist: "Jesse", task: "impl", status: "delivered", sessionId: "sess-dev", worktree: "/ws/aipe/.worktrees/impl" }),
    sess({ specialist: "Mike", task: "gate", status: "verified", sessionId: "sess-qa", worktree: "/ws/aipe/.worktrees/gate" }),
  ];
  const { runner, kills } = agentop([
    { id: "sess-dev", cwd: "/ws/aipe/.worktrees/impl" },
    { id: "sess-qa", cwd: "/ws/aipe/.worktrees/gate" },
  ]);
  const lines = await closeUnitSessions(records, "aipe", "/ws", runner);
  expect(kills.sort()).toEqual(["sess-dev", "sess-qa"]);
  expect(lines.join("\n")).toContain("CLOSED session sess-dev");
  expect(lines.join("\n")).toContain("CLOSED session sess-qa");
});

// ── the PE-required guarantee: a blocked session is closed on NO path ────────

test("a blocked session on the unit is NEVER closed, even when a sibling task merges", async () => {
  const records: JourneyDispatch[] = [
    sess({ specialist: "Jesse", task: "impl", status: "merged", sessionId: "sess-dev", worktree: "/ws/aipe/.worktrees/impl" }),
    sess({ specialist: "Jesse", task: "spike", status: "blocked", sessionId: "sess-blk", worktree: "/ws/aipe/.worktrees/spike", blockedReason: "need the API key" }),
  ];
  const { runner, kills } = agentop([
    { id: "sess-dev", cwd: "/ws/aipe/.worktrees/impl" },
    { id: "sess-blk", cwd: "/ws/aipe/.worktrees/spike" },
  ]);
  const lines = await closeUnitSessions(records, "aipe", "/ws", runner);
  expect(kills).toEqual(["sess-dev"]); // only the merged dev; the blocked one survives
  expect(kills).not.toContain("sess-blk");
  expect(lines.join("\n")).not.toContain("sess-blk");
});

test("a dispatched fix-loop session and a redirected session are never closed", async () => {
  const records: JourneyDispatch[] = [
    sess({ task: "impl", status: "failed", sessionId: "sess-old", worktree: "/ws/aipe/.worktrees/old" }),
    sess({ task: "impl-fix", status: "dispatched", sessionId: "sess-fix", worktree: "/ws/aipe/.worktrees/fix" }),
    sess({ task: "other", status: "redirected", sessionId: "sess-redir", worktree: "/ws/aipe/.worktrees/redir", redirectReason: "PE changed scope" }),
  ];
  const { runner, kills } = agentop([
    { id: "sess-old", cwd: "/ws/aipe/.worktrees/old" },
    { id: "sess-fix", cwd: "/ws/aipe/.worktrees/fix" },
    { id: "sess-redir", cwd: "/ws/aipe/.worktrees/redir" },
  ]);
  await closeUnitSessions(records, "aipe", "/ws", runner);
  expect(kills).toEqual(["sess-old"]); // the failed one closes; the fresh fix loop and the redirect survive
});

// ── the PE's dangerous case: a merged round + a live fix loop on the same unit ──

test("a merged row does NOT close a live fix session that reused the same worktree", async () => {
  // Round 1 merged (its session dead), round 2 fix dispatched and live, reusing
  // the dev's worktree. Recording round-2's status must not let the merged row's
  // stale id reconcile-by-worktree to the live fix session and kill it.
  const records: JourneyDispatch[] = [
    sess({ task: "r1", status: "merged", sessionId: "s-DEAD", worktree: "/ws/aipe/jesse" }),
    sess({ task: "r2-fix", status: "dispatched", sessionId: "s-FIX", worktree: "/ws/aipe/jesse" }),
  ];
  const { runner, kills } = agentop([{ id: "s-FIX", cwd: "/ws/aipe/jesse" }]); // only the fix is live
  const lines = await closeUnitSessions(records, "aipe", "/ws", runner);
  expect(kills).toEqual([]); // s-FIX is active work — never killed
  expect(lines.join("\n")).toContain("active work on the unit");
});

// ── item 3: reconcile a stale sessionId by worktree ──────────────────────────

test("a stale recorded sessionId is reconciled to the real live session by worktree and closed", async () => {
  const records: JourneyDispatch[] = [
    sess({ task: "impl", status: "merged", sessionId: "sess-OLD", worktree: "/ws/aipe/.worktrees/impl" }),
  ];
  // agentop's live session at that worktree is sess-NEW, not the stale sess-OLD.
  const { runner, kills } = agentop([{ id: "sess-NEW", cwd: "/ws/aipe/.worktrees/impl" }]);
  const lines = await closeUnitSessions(records, "aipe", "/ws", runner);
  expect(kills).toEqual(["sess-NEW"]);
  expect(lines.join("\n")).toContain("CLOSED session sess-NEW");
  expect(lines.join("\n")).toContain("reconciled via its worktree from stale id sess-OLD");
});

test("a stale id that reconciles to nothing at its worktree is reported was-not-running, never killed by guess", async () => {
  const records: JourneyDispatch[] = [
    sess({ task: "impl", status: "merged", sessionId: "sess-gone", worktree: "/ws/aipe/.worktrees/impl" }),
  ];
  const { runner, kills } = agentop([{ id: "someone-else", cwd: "/ws/other/x" }]);
  const lines = await closeUnitSessions(records, "aipe", "/ws", runner);
  expect(kills).toEqual([]);
  expect(lines.join("\n")).toContain("was not running");
});

test("an unreadable live list yields could-not-confirm, never a CLOSED and never a kill", async () => {
  const records: JourneyDispatch[] = [sess({ task: "impl", status: "merged", sessionId: "sess-x", worktree: "/ws/aipe/.worktrees/impl" })];
  const { runner, kills } = agentop([], { listCode: 1 });
  const lines = await closeUnitSessions(records, "aipe", "/ws", runner);
  expect(kills).toEqual([]);
  expect(lines.join("\n")).toContain("could not be confirmed");
  expect(lines.join("\n")).not.toContain("CLOSED");
});

test("only keep-alive rows on the unit ⇒ nothing is closed and agentop is not even consulted", async () => {
  const records: JourneyDispatch[] = [
    sess({ task: "a", status: "dispatched", sessionId: "s1", worktree: "/ws/a" }),
    sess({ task: "b", status: "blocked", sessionId: "s2", worktree: "/ws/b", blockedReason: "x" }),
  ];
  const { runner, kills } = agentop([{ id: "s1", cwd: "/ws/a" }, { id: "s2", cwd: "/ws/b" }]);
  const lines = await closeUnitSessions(records, "aipe", "/ws", runner);
  expect(kills).toEqual([]);
  expect(lines).toEqual([]);
});
