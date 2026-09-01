// The automatic harvest (#73). `aipe status` already asks agentop who is alive
// (liveness.ts); at that same edge — one aipe ALREADY runs, no new daemon and no
// harness cron — it collects the sessions whose PROCESS has EXITED. It only ever
// closes a provably dead process: a `waiting` / `NEEDS APPROVAL` / running
// session reports `alive` and is never touched, which is the PE's hard
// constraint ("não quero que ... alguma sessão ativa que está esperando ... seja
// fechada"). It never consults the forge, so it adds no network to the status
// path, and it NEVER throws — a harvest failure must degrade to "collected
// nothing this time", never to a broken status report. The coordinator's
// `journey reap --close` still owns the OTHER close (a LIVE session whose PR
// merged) — a judgement call, deliberately not automated here.
import { listJourneys } from "../journey/ledger";
import { executeReap, planDeadReap, type ReapCloseLine } from "../journey/reap";
import { parseSessionRoster, type RosterEntry } from "../session/poll";
import type { AgentopRunner } from "../session/types";

export interface HarvestResult {
  planned: number; // dead sessions found across all journeys
  closed: ReapCloseLine[]; // one line per session actually acted on
}

const NOTHING: HarvestResult = { planned: 0, closed: [] };

// Collect every dead-process session across ALL journeys in the workspace. Dead
// cleanup is scope-independent and unconditionally safe, so it is not narrowed
// to the status scope — a ghost in any journey is garbage. Reads the roster
// once; an unreadable list (agentop absent/failed/unparseable) is "cannot tell",
// which collects nothing rather than guessing a close.
export async function harvestDeadSessions(workspace: string, runner: AgentopRunner): Promise<HarvestResult> {
  try {
    let roster: RosterEntry[] = [];
    let reliable = false;
    try {
      const r = await runner(["session", "list", "--json"]);
      if (r.code === 0) {
        roster = parseSessionRoster(r.stdout);
        reliable = true;
      }
    } catch {
      reliable = false;
    }
    if (!reliable) return NOTHING;

    const ledgers = await listJourneys(workspace);
    const plan = ledgers.flatMap((l) => planDeadReap(l, workspace, roster, reliable));
    if (plan.length === 0) return { planned: 0, closed: [] };

    const closed = await executeReap(plan, runner);
    return { planned: plan.length, closed };
  } catch {
    // Any unexpected failure (a bad ledger read, an agentop that misbehaves in a
    // way the inner guards missed) must not break `aipe status`.
    return NOTHING;
  }
}
