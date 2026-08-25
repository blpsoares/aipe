import { expect, test } from "bun:test";
import { parseSessions, matchSession, readSessions, type SessionInfo } from "../sessions";

const RAW = JSON.stringify({
  sessions: [
    { id: "8b7f0edc17", status: "running", activity: "working", harness: "claude", cwd: "/ws/aipe/.worktrees/na-jesse", label: "aipe@Jesse", task: "aipe/j-20260825-na" },
    { id: "96933ea7b5", status: "running", activity: "waiting", harness: "claude", cwd: "/ws/site/.worktrees/s2-viola", label: "site@Viola", task: "aipe/j-20260825-s2" },
    { id: "cad5d17c64", status: "exited", harness: "claude", cwd: "/ws", label: "", task: null },
  ],
});

test("parseSessions reads the agentop schema and tolerates junk", () => {
  const got = parseSessions(RAW);
  expect(got.length).toBe(3);
  expect(got[0]).toMatchObject({ id: "8b7f0edc17", status: "running", activity: "working", cwd: "/ws/aipe/.worktrees/na-jesse", label: "aipe@Jesse", task: "aipe/j-20260825-na" });
  // tolerant: non-JSON / wrong shape → []
  expect(parseSessions("not json")).toEqual([]);
  expect(parseSessions("{}")).toEqual([]);
  expect(parseSessions(JSON.stringify({ sessions: "nope" }))).toEqual([]);
});

test("matchSession joins a dispatch to its session by worktree==cwd (strongest), then task+specialist", () => {
  const sessions = parseSessions(RAW);
  const byWorktree = matchSession(sessions, { worktree: "/ws/aipe/.worktrees/na-jesse", journey: "j-20260825-na", specialist: "Jesse" });
  expect(byWorktree?.id).toBe("8b7f0edc17");
  // task+specialist fallback when the worktree path doesn't line up
  const byTask = matchSession(sessions, { worktree: "/elsewhere", journey: "j-20260825-s2", specialist: "Viola" });
  expect(byTask?.id).toBe("96933ea7b5");
  // an exited session is not a live match
  expect(matchSession(sessions, { worktree: "/ws", journey: "x", specialist: "y" })).toBeUndefined();
  // no match ⇒ undefined
  expect(matchSession(sessions, { worktree: "/nowhere", journey: "z", specialist: "Nobody" })).toBeUndefined();
});

test("readSessions degrades to [] when agentop is absent or errors", async () => {
  const ok = await readSessions(async () => RAW);
  expect(ok.length).toBe(3);
  const absent = await readSessions(async () => {
    throw new Error("agentop: command not found");
  });
  expect(absent).toEqual([]);
  const garbage = await readSessions(async () => "<<not json>>");
  expect(garbage).toEqual([]);
});
