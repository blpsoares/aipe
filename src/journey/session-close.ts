// Closing a unit's session(s) when it lands (verified/merged) — Rule 2. A
// session outlived its work until now; when `aipe journey record` accepts a
// landing transition, the CLI (as the coordinator's instrument) ends the
// session and says so. A fix loop opens a NEW session; sessions are never reused.
//
// Everything here is idempotent and NON-FATAL by construction: the caller has
// already written the ledger before calling this. A dead session, an absent
// agentop, or a unit that never ran in session mode all produce an ordinary
// NOTE line — never an error, never a lost record.
import { buildKillArgs } from "../session/batch";
import type { AgentopRunner } from "../session/types";
import type { JourneyDispatch } from "./types";

// The distinct session ids to close for a unit that just landed: every
// session-mode record for the unit that carries a sessionId. Deduped, so a
// dev+QA pair that shares nothing still closes each once and a repeat is a no-op.
export function sessionsToClose(records: JourneyDispatch[]): string[] {
  const ids = new Set<string>();
  for (const d of records) {
    if (d.mode === "session" && d.sessionId) ids.add(d.sessionId);
  }
  return [...ids];
}

// Attempt to close each id; return the human-facing lines. `runner` is the
// agentop runner the CLI already owns — the same one dispatch uses to rename —
// so this is the CLI acting, not a specialist. Never throws.
export async function closeSessions(
  ids: string[],
  unit: string,
  runner: AgentopRunner,
): Promise<string[]> {
  const lines: string[] = [];
  for (const id of ids) {
    try {
      const r = await runner(buildKillArgs(id));
      if (r.code === 0) {
        lines.push(`CLOSED session ${id} (${unit}) — its unit landed; a fix loop opens a new session`);
      } else {
        lines.push(
          `NOTE session ${id} (${unit}) not closed (${r.stderr || `exit ${r.code}`}) — already ended or agentop unavailable; the ledger record stands`,
        );
      }
    } catch (err) {
      lines.push(
        `NOTE session ${id} (${unit}) not closed (${err instanceof Error ? err.message : String(err)}) — agentop unavailable; the ledger record stands`,
      );
    }
  }
  return lines;
}
