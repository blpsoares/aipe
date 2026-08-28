// The one place `aipe status` asks agentop who is alive. Mirrors the honesty of
// `session/poll.ts`: a failed or unparseable `session list` is NOT "nobody is
// running" — it is "we cannot tell", surfaced as `reliable:false` so every
// in-flight unit degrades to `unknown` rather than being flipped to dead (the
// dangerous direction) or asserted running (a liveness we cannot verify). When
// agentop is not installed at all, `source:"none"` — the report still works and
// says so plainly (item 6).
import { parseSessionList } from "../session/poll";
import { probe } from "../session/runner";
import type { AgentopRunner } from "../session/types";

export interface LiveSessions {
  source: "agentop" | "none";
  reliable: boolean;
  ids: Set<string>;
}

export async function resolveLiveSessions(runner: AgentopRunner): Promise<LiveSessions> {
  const probed = await probe(runner);
  if (!probed.ok) return { source: "none", reliable: false, ids: new Set() };
  let result: { code: number; stdout: string; stderr: string };
  try {
    result = await runner(["session", "list", "--json"]);
  } catch {
    return { source: "agentop", reliable: false, ids: new Set() };
  }
  if (result.code === 0) {
    try {
      return { source: "agentop", reliable: true, ids: parseSessionList(result.stdout) };
    } catch {
      // exit 0 with unparseable/unexpected JSON is a contract break, not an
      // empty live list — treat it as "cannot tell", same as a non-zero exit.
      return { source: "agentop", reliable: false, ids: new Set() };
    }
  }
  return { source: "agentop", reliable: false, ids: new Set() };
}
