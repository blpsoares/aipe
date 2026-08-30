// Closing a unit's session(s) when its work reaches a TERMINAL status — Rule 2.
// A session outlived its work until this transition; when `aipe journey record`
// accepts one of those transitions, the CLI (as the coordinator's instrument)
// ends the session and says so — HONESTLY, never claiming a close it did not
// establish. A fix loop opens a NEW session; sessions are never reused.
//
// Everything here is idempotent and NON-FATAL by construction: the caller has
// already written the ledger before calling this. A dead session, an absent
// agentop, or a unit that never ran in session mode all produce an ordinary
// NOTE line — never an error, never a lost record.
import { buildKillArgs } from "../session/batch";
import { parseSessionList } from "../session/poll";
import type { AgentopRunner } from "../session/types";
import type { DispatchStatus, JourneyDispatch } from "./types";

// The statuses that end a unit's work IN ITS SESSION, so the session must be
// closed. Chosen from the project's own status rule (types.ts), NOT widened to
// statuses where the specialist is still expected to act in the SAME session:
//   • verified — the QA gate cleared the delivery; the unit is done.
//   • merged   — the PR landed; the unit is immutable.
//   • failed   — the QA gate rejected the delivery. The unit is NOT done, but a
//                fix loop opens a NEW session by the project's rule (the
//                `delivered → failed → (re)dispatched` lifecycle), so THIS
//                session has finished its work and must close — leaving it up is
//                exactly the "two sessions run for hours" leak.
//   • escalated — a cross-repo wall the PE must decide; the specialist cannot
//                proceed within scope, and any continuation is a new session /
//                journey, so this one has finished too.
// Deliberately EXCLUDED (the specialist still acts in this same session, or the
// close belongs elsewhere):
//   • dispatched / blocked — still working, or waiting to resume here (blocked
//     is "I need an answer", not "my work ended"). Closing would kill live work.
//   • delivered — a dev self-report, NOT terminal: the QA gate (verified/failed)
//     is the terminal event that closes. Killing on the self-report would end
//     the session before its gate runs.
//   • redirected — the PE changed the unit's direction LIVE via attach; the
//     session is still alive and expected to keep going on the new direction.
//   • removed — a worktree teardown recorded by the `worktree` command, not a
//     work-terminal gate on `journey record`; that teardown path owns reaping.
export const SESSION_CLOSING_STATUSES: ReadonlySet<DispatchStatus> = new Set<DispatchStatus>([
  "verified",
  "merged",
  "failed",
  "escalated",
]);

// The live agentop session ids, or a signal that we could not read them.
// `reliable: false` means we genuinely do not know who is alive (agentop absent,
// non-zero exit, or an unparseable list) — the same fail-open distinction poll.ts
// draws — and a close cannot be honestly confirmed against it.
async function liveSessionIds(
  runner: AgentopRunner,
): Promise<{ reliable: boolean; live: ReadonlySet<string> }> {
  let result: { code: number; stdout: string; stderr: string };
  try {
    result = await runner(["session", "list", "--json"]);
  } catch {
    return { reliable: false, live: new Set() };
  }
  if (result.code !== 0) return { reliable: false, live: new Set() };
  try {
    return { reliable: true, live: parseSessionList(result.stdout) };
  } catch {
    return { reliable: false, live: new Set() };
  }
}

// Close every session tied to a unit that just reached a terminal status, and
// surface anything that cannot be closed — returning the human-facing lines.
// `runner` is the agentop runner the CLI already owns (the same one dispatch
// uses to rename), so this is the CLI acting as the coordinator's instrument,
// not a specialist. Never throws.
//
// The honesty rule (item 2): `agentop session kill` exits 0 even for an id that
// matches NO session, so a bare exit-0 is NOT evidence of a close. We establish
// the closure by checking the live session list BEFORE killing:
//   • the id was live      → a code-0 kill genuinely ended it   ⇒ CLOSED
//   • the id was NOT live   → nothing to close; the exit code proves nothing ⇒ was not running
//   • we could not read the list, or the kill did not exit 0 while live
//                          → we cannot stand behind a close     ⇒ could not be confirmed
export async function closeUnitSessions(
  records: JourneyDispatch[],
  unit: string,
  runner: AgentopRunner,
): Promise<string[]> {
  const sessionRecords = records.filter((d) => d.mode === "session");
  if (sessionRecords.length === 0) return [];

  const lines: string[] = [];

  // Item 3 — a `mode: session` record with no sessionId is silence today
  // (sessionsToClose simply skipped it), and silence is what let two sessions
  // run for hours. Make it visible, naming the unit and the specialist, so the
  // coordinator can inspect a session that was never recorded. Deduped per
  // specialist so a repeated row does not double the NOTE.
  const seenMissing = new Set<string>();
  for (const d of sessionRecords) {
    if (d.sessionId) continue;
    if (seenMissing.has(d.specialist)) continue;
    seenMissing.add(d.specialist);
    lines.push(
      `NOTE ${unit} · ${d.specialist}: mode:session record has no sessionId — cannot close a session that was never recorded; it may still be running untracked. Inspect the unit.`,
    );
  }

  // Distinct ids to close (a dev+QA pair that shares nothing still closes each
  // once; a repeat is a no-op).
  const ids = [...new Set(sessionRecords.filter((d) => d.sessionId).map((d) => d.sessionId!))];
  if (ids.length === 0) return lines;

  const { reliable, live } = await liveSessionIds(runner);

  for (const id of ids) {
    // Establish existence BEFORE trusting the kill: `null` = we could not read
    // the live list, so even a code-0 kill cannot be believed.
    const wasLive = reliable ? live.has(id) : null;
    let killed: { code: number; stdout: string; stderr: string };
    try {
      killed = await runner(buildKillArgs(id));
    } catch (err) {
      lines.push(
        `NOTE session ${id} (${unit}) close could not be confirmed (${err instanceof Error ? err.message : String(err)}) — agentop unavailable; the ledger record stands`,
      );
      continue;
    }
    if (wasLive === false) {
      // The live list is reliable and carried no such session: the kill's exit
      // code — 0 or not, "No session matches" or not — establishes nothing.
      lines.push(
        `NOTE session ${id} (${unit}) was not running — no live session carried this id; it had already ended. the ledger record stands`,
      );
    } else if (wasLive === true) {
      if (killed.code === 0) {
        lines.push(`CLOSED session ${id} (${unit}) — its unit reached a terminal status; a fix loop opens a new session`);
      } else {
        lines.push(
          `NOTE session ${id} (${unit}) close could not be confirmed (kill exited ${killed.code}${killed.stderr ? `: ${killed.stderr}` : ""}) — it was live a moment ago; the ledger record stands`,
        );
      }
    } else {
      // wasLive === null: the live list was unreadable, so we cannot verify the
      // id ever existed and cannot stand behind a close.
      lines.push(
        `NOTE session ${id} (${unit}) close could not be confirmed — agentop's session list was unreadable, so the kill cannot be verified; the ledger record stands`,
      );
    }
  }
  return lines;
}
