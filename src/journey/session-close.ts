// Closing a UNIT's session(s) when its work reaches a TERMINAL status — Rule 2.
// A session outlived its work until this transition; when `aipe journey record`
// accepts one of those transitions, the CLI (as the coordinator's instrument)
// ends the session and says so — HONESTLY, never claiming a close it did not
// establish. A fix loop opens a NEW session; sessions are never reused.
//
// Scoped by UNIT (repo + package), NOT by the exact task (item 1): a QA gate
// that records `verified` under its OWN task/persona still ends the DEV's
// session on the same unit — the defect where "the gate approved in another
// task" left the dev's session running for hours. What keeps that from closing
// live work is a STATUS guard, not a task guard: a row still expected to be
// working in its session (dispatched / blocked / redirected) is NEVER closed,
// so an open fix loop's fresh `dispatched` session and a `blocked` session that
// is waiting on the coordinator both survive, while a `delivered` dev whose gate
// just passed does not.
//
// Everything here is idempotent and NON-FATAL by construction: the caller has
// already written the ledger before calling this. A dead session, an absent
// agentop, or a unit that never ran in session mode all produce an ordinary
// NOTE line — never an error, never a lost record.
import { resolve } from "node:path";
import { buildKillArgs } from "../session/batch";
import { parseSessionRoster, type RosterEntry } from "../session/poll";
import { activeLiveSessionIds, resolveLiveSessionId } from "../session/reconcile-id";
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
// Deliberately EXCLUDED — see KEEP_ALIVE_STATUSES below and the delivered note.
export const SESSION_CLOSING_STATUSES: ReadonlySet<DispatchStatus> = new Set<DispatchStatus>([
  "verified",
  "merged",
  "failed",
  "escalated",
]);

// Statuses whose session is NEVER closed by a unit-scoped close, because the
// specialist is still expected to be working in it (or waiting to resume there).
// This is the guard that makes "close by unit" safe: closing spans the unit's
// tasks, but a row in one of these states is protected from it.
//   • dispatched — live, still working. This is ALSO how "no open fix loop" is
//     honoured: a fix loop opens a NEW `dispatched` session (the project rule),
//     which is protected here — so a gate landing on the unit never kills the
//     fresh fix-loop worker. When there is no fix loop, the dev sits at
//     `delivered` (closable), not `dispatched`.
//   • blocked — waiting on the coordinator for an answer; its work is NOT over.
//     The PE-required guarantee: a blocked session is closed on NO path, ever.
//   • redirected — the PE steered it live via attach; still alive on the new
//     direction, expected to keep going.
// `delivered` is deliberately CLOSABLE (not here): a dev whose gate just passed
// sits at `delivered`, and closing it is the whole point. `delivered` staying
// out of SESSION_CLOSING_STATUSES only means the delivered TRANSITION itself
// triggers no close — a later gate on the unit still closes the delivered dev.
export const KEEP_ALIVE_STATUSES: ReadonlySet<DispatchStatus> = new Set<DispatchStatus>([
  "dispatched",
  "blocked",
  "redirected",
]);

// A RELIABLE read of the live roster, or a signal that we could not get one.
// `reliable: false` means we genuinely do not know who is alive (agentop absent,
// non-zero exit, or an unparseable list) — the same fail-open distinction poll.ts
// draws — and a close cannot be honestly confirmed against it.
async function liveRoster(
  runner: AgentopRunner,
): Promise<{ reliable: boolean; roster: RosterEntry[] }> {
  let result: { code: number; stdout: string; stderr: string };
  try {
    result = await runner(["session", "list", "--json"]);
  } catch {
    return { reliable: false, roster: [] };
  }
  if (result.code !== 0) return { reliable: false, roster: [] };
  try {
    return { reliable: true, roster: parseSessionRoster(result.stdout) };
  } catch {
    return { reliable: false, roster: [] };
  }
}

// Close every session tied to a UNIT that just reached a terminal status, and
// surface anything that cannot be closed — returning the human-facing lines.
// `records` is EVERY dispatch of the unit (repo + package, across tasks); this
// function applies the KEEP_ALIVE_STATUSES guard itself so the guarantee lives
// in one tested place. `workspace` is needed to resolve a relative worktree to
// the absolute cwd agentop reports, for stale-id reconciliation. Never throws.
//
// The honesty rule (item 2 + item 3): `agentop session kill` exits 0 even for an
// id that matches NO session, so a bare exit-0 is NOT evidence of a close. We
// ESTABLISH the live session BEFORE killing, reconciling a stale recorded id to
// the real one by worktree (resolveLiveSessionId):
//   • a live session established (recorded or reconciled) → kill it; exit 0 ⇒ CLOSED
//   • the recorded id is stale and none is found at the worktree → was not running
//   • the live list was unreadable → could not be confirmed (we do not guess)
export async function closeUnitSessions(
  records: JourneyDispatch[],
  unit: string,
  workspace: string,
  runner: AgentopRunner,
): Promise<string[]> {
  const sessionRecords = records.filter((d) => d.mode === "session");
  if (sessionRecords.length === 0) return [];
  // The guard: a session still expected to be working is never a close target.
  const closable = sessionRecords.filter((d) => !KEEP_ALIVE_STATUSES.has(d.status));
  if (closable.length === 0) return [];

  const lines: string[] = [];
  const { reliable, roster } = await liveRoster(runner);

  // Cannot read the live list: no close can be honestly confirmed. Say so once
  // per distinct session (or per specialist for a record with no id), never
  // claim a CLOSED, and never guess a kill.
  if (!reliable) {
    const seen = new Set<string>();
    for (const d of closable) {
      const key = d.sessionId ?? `wt:${resolve(workspace, d.worktree)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const who = d.sessionId ? `session ${d.sessionId}` : `${unit} · ${d.specialist} (no recorded sessionId)`;
      lines.push(
        `NOTE ${who} (${unit}) close could not be confirmed — agentop's session list was unreadable, so the kill cannot be verified; the ledger record stands`,
      );
    }
    return lines;
  }

  // The fix-loop guard: a live session that belongs to a still-working row on
  // this unit (dispatched / blocked / redirected) is ACTIVE WORK and must never
  // be closed — not even when a merged/failed row on the same unit reconciles to
  // it by a shared worktree. A fresh fix round reuses the dev's worktree, so
  // closing "the merged unit's session" by worktree would kill the fix in
  // progress. Leaving residue is always the safer error.
  const keepAliveRows = sessionRecords.filter((d) => KEEP_ALIVE_STATUSES.has(d.status));
  const protectedIds = activeLiveSessionIds(keepAliveRows, workspace, roster);

  const closedIds = new Set<string>();
  const notedMissing = new Set<string>();
  for (const d of closable) {
    const res = resolveLiveSessionId(d, workspace, roster);
    if (res.kind === "none") {
      if (res.staleId) {
        // A recorded id that is not live and reconciles to nothing at its
        // worktree: the session had already ended. The kill's exit code — 0 or
        // not — would establish nothing, so we do not attempt it.
        lines.push(
          `NOTE session ${res.staleId} (${unit}) was not running — no live session carried this id and none was found at its worktree (${d.worktree}); it had already ended. the ledger record stands`,
        );
      } else if (!notedMissing.has(d.specialist)) {
        // No recorded id AND nothing at the worktree: silence is what let two
        // sessions run for hours — make it visible, naming the unit and persona.
        notedMissing.add(d.specialist);
        lines.push(
          `NOTE ${unit} · ${d.specialist}: mode:session record has no sessionId and no live session was found at its worktree (${d.worktree}) — cannot establish a session to close; it may be running untracked. Inspect the unit.`,
        );
      }
      continue;
    }
    const id = res.id;
    if (protectedIds.has(id)) {
      // Reconciled/recorded to a session that is active work on the unit — leave
      // it. This is the only path by which a unit-scoped close could reach a live
      // fix loop, and the PE's rule is absolute: residue over killing live work.
      lines.push(
        `NOTE session ${id} (${unit}) NOT closed — it is the live session of active work on the unit (a dispatched fix loop, or a blocked/redirected round); residue left deliberately rather than kill live work`,
      );
      continue;
    }
    if (closedIds.has(id)) continue; // a duplicate row resolving to the same live session: close once.
    closedIds.add(id);
    const via =
      res.kind === "reconciled"
        ? ` (reconciled via its worktree${res.staleId ? ` from stale id ${res.staleId}` : ""})`
        : "";
    let killed: { code: number; stdout: string; stderr: string };
    try {
      killed = await runner(buildKillArgs(id));
    } catch (err) {
      lines.push(
        `NOTE session ${id} (${unit})${via} close could not be confirmed (${err instanceof Error ? err.message : String(err)}) — agentop unavailable; the ledger record stands`,
      );
      continue;
    }
    if (killed.code === 0) {
      lines.push(`CLOSED session ${id} (${unit})${via} — its unit reached a terminal status; a fix loop opens a new session`);
    } else {
      lines.push(
        `NOTE session ${id} (${unit})${via} close could not be confirmed (kill exited ${killed.code}${killed.stderr ? `: ${killed.stderr}` : ""}) — it was live a moment ago; the ledger record stands`,
      );
    }
  }
  return lines;
}
