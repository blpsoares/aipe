import { expect, test } from "bun:test";
import { hasSessionDispatch, relevantSessions } from "../payload";
import type { SessionInfo } from "../sessions";
import type { JourneyView } from "../../dashboard/snapshot";

const journeys = [
  { id: "j", dispatches: [
    { repo: "aipe", specialist: "Jesse", branch: "b", worktree: "/ws/aipe/.worktrees/na-jesse", status: "dispatched", mode: "session" },
    { repo: "aipe", specialist: "Ana", branch: "b", worktree: "/ws/aipe/.worktrees/na-ana", status: "delivered" },
  ] },
] as unknown as JourneyView[];

test("hasSessionDispatch triggers only when a dispatch runs as a session", () => {
  expect(hasSessionDispatch(journeys)).toBe(true);
  expect(hasSessionDispatch([{ id: "j", dispatches: [{ repo: "a", specialist: "x", branch: "b", worktree: "w", status: "dispatched" }] }] as any)).toBe(false);
});

test("relevantSessions keeps only sessions whose cwd matches a dispatch worktree (running or exited)", () => {
  const sessions: SessionInfo[] = [
    { id: "mine", status: "running", activity: "working", cwd: "/ws/aipe/.worktrees/na-jesse" },
    { id: "dead", status: "exited", cwd: "/ws/aipe/.worktrees/na-ana" }, // matches Ana → keep (dead-silent signal)
    { id: "unrelated", status: "running", activity: "waiting", cwd: "/home/u/somewhere-else" },
  ];
  const kept = relevantSessions(sessions, journeys).map((s) => s.id).sort();
  expect(kept).toEqual(["dead", "mine"]);
});
