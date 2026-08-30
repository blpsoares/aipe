// The one place `aipe status` asks agentop who is alive. Mirrors the honesty of
// `session/poll.ts`: a failed or unparseable `session list` is NOT "nobody is
// running" — it is "we cannot tell", surfaced as `reliable:false` so every
// in-flight unit degrades to `unknown` rather than being flipped to dead (the
// dangerous direction) or asserted running (a liveness we cannot verify). When
// agentop is not installed at all, `source:"none"` — the report still works and
// says so plainly (item 6).
import { parseSessionLiveness, type Liveness } from "../session/poll";
import { probe } from "../session/runner";
import type { AgentopRunner } from "../session/types";

export interface LiveSessions {
  source: "agentop" | "none";
  reliable: boolean;
  // id → the liveness derived from that agentop entry's `status`, NOT a bare
  // set of "present" ids: `aipe status` must draw the same running/lost/dead
  // distinctions `collect` does, from the same source (parseSessionLiveness).
  sessions: Map<string, Liveness>;
}

export async function resolveLiveSessions(runner: AgentopRunner): Promise<LiveSessions> {
  const probed = await probe(runner);
  if (!probed.ok) return { source: "none", reliable: false, sessions: new Map() };
  let result: { code: number; stdout: string; stderr: string };
  try {
    result = await runner(["session", "list", "--json"]);
  } catch {
    return { source: "agentop", reliable: false, sessions: new Map() };
  }
  if (result.code === 0) {
    try {
      return { source: "agentop", reliable: true, sessions: parseSessionLiveness(result.stdout) };
    } catch {
      // exit 0 with unparseable/unexpected JSON is a contract break, not an
      // empty live list — treat it as "cannot tell", same as a non-zero exit.
      return { source: "agentop", reliable: false, sessions: new Map() };
    }
  }
  return { source: "agentop", reliable: false, sessions: new Map() };
}
