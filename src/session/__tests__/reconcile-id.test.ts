// resolveLiveSessionId: turn a ledger dispatch (whose recorded sessionId may be
// STALE) into the REAL live session to act on, by fact — never by guessing.
//   • the recorded id is present in the live roster        → use it (recorded)
//   • else the roster entry whose cwd IS this unit's worktree → reconciled
//   • else nothing can be established                        → none
// The worktree (agentop's `cwd`) is the unambiguous per-unit key: `task` is
// journey-wide (shared by every session of a wave), so cwd — unique per unit —
// is what a stale-id reconciliation stands on.
import { expect, test } from "bun:test";
import { resolveLiveSessionId } from "../reconcile-id";
import type { RosterEntry } from "../poll";

const entry = (id: string, cwd: string, liveness: RosterEntry["liveness"] = "alive"): RosterEntry => ({
  id, liveness, cwd, task: "aipe/j1", label: `${id}-label`,
});

test("a recorded id that is live in the roster is used as-is (recorded)", () => {
  const roster = [entry("sess-abc", "/ws/aipe/.worktrees/j1-jesse")];
  const r = resolveLiveSessionId({ sessionId: "sess-abc", worktree: "/ws/aipe/.worktrees/j1-jesse" }, "/ws", roster);
  expect(r).toEqual({ kind: "recorded", id: "sess-abc" });
});

test("a STALE recorded id is reconciled to the live session at the same worktree", () => {
  // The ledger says sess-OLD, but agentop's live session at that worktree is
  // sess-NEW. The reconciliation finds sess-NEW by cwd and reports the stale id.
  const roster = [entry("sess-new", "/ws/aipe/.worktrees/j1-jesse")];
  const r = resolveLiveSessionId({ sessionId: "sess-old", worktree: "/ws/aipe/.worktrees/j1-jesse" }, "/ws", roster);
  expect(r).toEqual({ kind: "reconciled", id: "sess-new", staleId: "sess-old" });
});

test("a record with NO recorded id at all is still reconciled by its worktree", () => {
  const roster = [entry("sess-new", "/ws/aipe/.worktrees/j1-jesse")];
  const r = resolveLiveSessionId({ worktree: "/ws/aipe/.worktrees/j1-jesse" }, "/ws", roster);
  expect(r).toEqual({ kind: "reconciled", id: "sess-new", staleId: null });
});

test("a relative worktree is resolved against the workspace before matching cwd", () => {
  const roster = [entry("sess-new", "/ws/aipe/.worktrees/j1-jesse")];
  const r = resolveLiveSessionId({ sessionId: "stale", worktree: "aipe/.worktrees/j1-jesse" }, "/ws", roster);
  expect(r).toEqual({ kind: "reconciled", id: "sess-new", staleId: "stale" });
});

test("no live session AND no worktree match yields none — never a guess", () => {
  const roster = [entry("someone-else", "/ws/other/.worktrees/x")];
  const r = resolveLiveSessionId({ sessionId: "sess-gone", worktree: "/ws/aipe/.worktrees/j1-jesse" }, "/ws", roster);
  expect(r).toEqual({ kind: "none", staleId: "sess-gone" });
});

test("an entry with a null cwd never matches (it cannot anchor a worktree)", () => {
  const roster: RosterEntry[] = [{ id: "coord", liveness: "alive", cwd: null, task: null, label: "COORDENADOR" }];
  const r = resolveLiveSessionId({ sessionId: "sess-gone", worktree: "/ws/aipe/.worktrees/j1-jesse" }, "/ws", roster);
  expect(r).toEqual({ kind: "none", staleId: "sess-gone" });
});
