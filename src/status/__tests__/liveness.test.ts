import { expect, test } from "bun:test";
import { resolveLiveSessions } from "../liveness";
import type { AgentopRunner } from "../../session/types";

// A runner that answers --version and session list from a script.
function runnerOf(opts: { version?: string; listCode?: number; listOut?: string; throwOnList?: boolean }): AgentopRunner {
  return async (args) => {
    if (args[0] === "--version") {
      return opts.version === undefined
        ? { code: 1, stdout: "", stderr: "not found" }
        : { code: 0, stdout: opts.version, stderr: "" };
    }
    if (opts.throwOnList) throw new Error("spawn failed");
    return { code: opts.listCode ?? 0, stdout: opts.listOut ?? "[]", stderr: "" };
  };
}

test("agentop absent → source none, not reliable, empty (item 6)", async () => {
  const live = await resolveLiveSessions(runnerOf({}));
  expect(live).toEqual({ source: "none", reliable: false, sessions: new Map() });
});

test("agentop present + parseable list → reliable map of id→liveness", async () => {
  const live = await resolveLiveSessions(runnerOf({ version: "1.10.0", listOut: JSON.stringify({ sessions: [{ id: "s-1", status: "running" }, { id: "s-2", status: "running" }] }) }));
  expect(live.source).toBe("agentop");
  expect(live.reliable).toBe(true);
  expect(live.sessions).toEqual(new Map([["s-1", "alive"], ["s-2", "alive"]]));
});

test("a listed-but-lost session is carried as lost, so aipe status draws the same distinction collect does", async () => {
  const live = await resolveLiveSessions(runnerOf({ version: "1.10.0", listOut: JSON.stringify({ sessions: [{ id: "s-1", status: "lost", activity: null }] }) }));
  expect(live.reliable).toBe(true);
  expect(live.sessions).toEqual(new Map([["s-1", "lost"]]));
});

test("exit 0 with UNPARSEABLE json is 'cannot tell', not an empty live list (item 5)", async () => {
  const live = await resolveLiveSessions(runnerOf({ version: "1.10.0", listCode: 0, listOut: "not json" }));
  expect(live.reliable).toBe(false);
  expect(live.sessions.size).toBe(0);
});

test("a non-zero list exit degrades to not-reliable", async () => {
  const live = await resolveLiveSessions(runnerOf({ version: "1.10.0", listCode: 1, listOut: "" }));
  expect(live.reliable).toBe(false);
});

test("a thrown spawn on list degrades to not-reliable (never throws out)", async () => {
  const live = await resolveLiveSessions(runnerOf({ version: "1.10.0", throwOnList: true }));
  expect(live).toEqual({ source: "agentop", reliable: false, sessions: new Map() });
});
