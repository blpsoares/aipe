// Reconciling a ledger dispatch to the REAL agentop session that is its own —
// even when the recorded `sessionId` is stale. This is the fix for item 3 of
// the orphan-session brief: a close that finds no session under the recorded id
// must not give up (leaving the residue behind), nor kill by guessing. It finds
// the live session by the one fact that is unambiguous per unit — the worktree
// (agentop reports it as the session's `cwd`) — or reports that it could not
// establish one. `task` is deliberately NOT used as a key: it is journey-wide
// (every session of a wave shares `aipe/<journey>`), so it cannot single out
// one unit's session; the worktree is unique per unit and is what we stand on.
import { resolve } from "node:path";
import type { RosterEntry } from "./poll";

// The outcome of resolving a dispatch to its live session.
//   • recorded   — the recorded id is present in the live roster; use it.
//   • reconciled — the recorded id was absent/stale, but a live session sits at
//                  this unit's worktree; that is the real one (`staleId` records
//                  what the ledger wrongly held, or null if it held nothing).
//   • none       — no live session under the id AND none at the worktree: the
//                  close must SAY it could not establish one, never guess.
export type IdResolution =
  | { kind: "recorded"; id: string }
  | { kind: "reconciled"; id: string; staleId: string | null }
  | { kind: "none"; staleId: string | null };

// `roster` must be a RELIABLE read of `agentop session list` (the caller checks
// that before calling — an unreadable list is "cannot establish", handled by
// the caller, not by pretending the roster is empty here).
export function resolveLiveSessionId(
  d: { sessionId?: string; worktree: string },
  workspace: string,
  roster: RosterEntry[],
): IdResolution {
  const recordedId = d.sessionId ?? null;
  // 1 — the recorded id is genuinely live: nothing to reconcile.
  if (recordedId && roster.some((e) => e.id === recordedId)) {
    return { kind: "recorded", id: recordedId };
  }
  // 2 — reconcile by worktree. Resolve BOTH sides to absolute so a relative
  // ledger path (a hand-typed --worktree) still matches agentop's absolute cwd.
  const wt = resolve(workspace, d.worktree);
  const match = roster.find((e) => e.cwd !== null && resolve(e.cwd) === wt);
  if (match) return { kind: "reconciled", id: match.id, staleId: recordedId };
  // 3 — could not establish. The caller reports this honestly and closes nothing.
  return { kind: "none", staleId: recordedId };
}

// The live session ids that belong to ACTIVE work — the sessions of the given
// rows (pass the unit's keep-alive rows: dispatched / blocked / redirected). A
// row claims a live session two ways, and BOTH count: its recorded sessionId if
// that id is live, AND any live session sitting at its worktree (cwd). The
// worktree arm is the one that matters for the fix-loop hole: a fresh fix round
// is recorded `dispatched` with its worktree BEFORE its sessionId is known (the
// dispatch flow writes the row, then starts the session), so the live session at
// that worktree is protected even in the window before its id lands on the
// ledger. A landed/merged row that reconciles by worktree to one of these ids
// must NEVER close it — that is killing live work, and leaving residue is always
// the safer error (uncommitted work is lost otherwise).
export function activeLiveSessionIds(
  rows: { sessionId?: string; worktree: string }[],
  workspace: string,
  roster: RosterEntry[],
): Set<string> {
  const ids = new Set<string>();
  for (const d of rows) {
    if (d.sessionId && roster.some((e) => e.id === d.sessionId)) ids.add(d.sessionId);
    const wt = resolve(workspace, d.worktree);
    for (const e of roster) if (e.cwd !== null && resolve(e.cwd) === wt) ids.add(e.id);
  }
  return ids;
}
