// The fact-based reaper (item 2). The record-time close in session-close.ts
// fires on a ledger transition and depends on the coordinator having recorded it
// in the right place with the right sessionId — the trigger that is documented
// to err. This reaper does NOT depend on that registration: for every
// session-mode unit it establishes the landing by VERIFIABLE FACT — the unit has
// a PR and the forge reports that PR MERGED — finds the real live session
// (reconciling a stale id by worktree, item 3), and closes only what it can
// stand behind. It NEVER touches a blocked/dispatched/redirected session.
//
// It is an EXPLICIT coordinator step, never background: it plans first, and the
// CLI lists the plan before any close. Killing a session is a decision, not an
// automation.
//
// NOTE on "derive from what exists": src/release derives a repo's PUBLICATION
// state from local git, but at REPO granularity (is this repo's release branch
// ahead of its last tag) — it cannot say which UNIT's PR merged. A per-session
// reaper needs the per-PR merge fact, so it uses the same forge resolver
// `journey reconcile` already trusts (PrStateFetcher) — a verifiable fact, not a
// coordinator registration. A squash-merged PR is also why local `is-ancestor`
// is not enough here: the branch head is not an ancestor of dev after a squash,
// yet the forge reports MERGED reliably.
import { buildKillArgs } from "../session/batch";
import { activeLiveSessionIds, resolveLiveSessionId } from "../session/reconcile-id";
import type { RosterEntry } from "../session/poll";
import type { AgentopRunner } from "../session/types";
import type { PrStateFetcher } from "./reconcile";
import type { DispatchStatus, JourneyDispatch, JourneyLedger } from "./types";
import { packageFqid } from "../context-brain/packages";

// A session still expected to be working (or waiting to resume) — reaped on NO
// path. Identical set to KEEP_ALIVE_STATUSES in session-close.ts (the guarantee
// is the same one), kept local so the reaper's rule is legible on its own.
const KEEP_ALIVE: ReadonlySet<DispatchStatus> = new Set<DispatchStatus>(["dispatched", "blocked", "redirected"]);

export type ReapDisposition =
  | "would-close" // landed by fact + a live session established → the reaper would close it
  | "protected" // dispatched/blocked/redirected → still working or waiting; never closed
  | "not-landed" // no PR, or the PR is not merged → work has not landed; left alone
  | "unresolvable"; // landed, but no live session could be established → said, not guessed

export interface ReapItem {
  unit: string; // repo or repo/package
  specialist: string;
  disposition: ReapDisposition;
  sessionId: string | null; // the RESOLVED live id for would-close; else the recorded id (or null)
  recordedId: string | null;
  reconciled: boolean; // the live id was reconciled from a stale/absent recorded id by worktree
  reason: string; // a plain sentence, for the coordinator to read
}

// Compute the reap plan. Pure over its inputs (the forge fetcher is injected):
// `roster`/`rosterReliable` come from `agentop session list --json`, `isMerged`
// from the forge. Never closes anything — that is the CLI's `--close` step,
// which lists this plan first.
export async function planReap(
  ledger: JourneyLedger,
  workspace: string,
  roster: RosterEntry[],
  rosterReliable: boolean,
  isMerged: PrStateFetcher,
): Promise<ReapItem[]> {
  // The fix-loop guard (the dangerous case the PE named): a unit whose PR merged
  // in an earlier round and is being WORKED AGAIN — the fresh fix round is a
  // keep-alive row that reuses the dev's worktree. A merged row on that unit
  // reconciles by worktree to the SAME live session as the fix; closing it would
  // kill the fix in progress. So a live session that belongs to ANY keep-alive
  // session-mode row is ACTIVE WORK and is never reaped, even reconciled by
  // worktree. The worktree arm also covers the window before the fix's sessionId
  // is recorded (the dispatch flow writes the `dispatched` row + its worktree
  // first, the session id second). Leaving residue is always the safer error.
  const activeIds = activeLiveSessionIds(
    ledger.dispatches.filter((d) => d.mode === "session" && KEEP_ALIVE.has(d.status)),
    workspace,
    roster,
  );

  const items: ReapItem[] = [];
  for (const d of ledger.dispatches) {
    if (d.mode !== "session") continue;
    const unit = packageFqid(d.repo, d.package);
    const recordedId = d.sessionId ?? null;
    const base = { unit, specialist: d.specialist, recordedId, sessionId: recordedId, reconciled: false };

    // 1 — protection wins over everything. A blocked session is closed on NO
    // path, even with a merged PR; a dispatched (fix loop) / redirected session
    // is live work. This is checked FIRST so no later fact can override it.
    if (KEEP_ALIVE.has(d.status)) {
      items.push({ ...base, disposition: "protected", reason: `status "${d.status}" — still working or waiting on the coordinator; never reaped` });
      continue;
    }

    // 2 — landing by verifiable fact: the unit has a PR and the forge reports it
    // MERGED. NOT the ledger's `--status merged` (that is the registration this
    // reaper deliberately does not trust).
    if (!d.pr) {
      items.push({ ...base, disposition: "not-landed", reason: "no PR on the ledger — nothing merged to land on" });
      continue;
    }
    const state = await isMerged(d.pr);
    if (state !== "MERGED") {
      items.push({ ...base, disposition: "not-landed", reason: `PR is ${state ?? "unresolvable"}, not merged — work has not landed (${d.pr})` });
      continue;
    }

    // 3 — establish the live session. An unreadable roster is "cannot establish",
    // never a guessed close.
    if (!rosterReliable) {
      items.push({ ...base, disposition: "unresolvable", reason: `PR merged, but agentop's session list was unreadable — cannot establish the live session (${d.pr})` });
      continue;
    }
    const res = resolveLiveSessionId(d, workspace, roster);
    if (res.kind === "none") {
      items.push({
        ...base,
        disposition: "unresolvable",
        reason: res.staleId
          ? `PR merged, but recorded session ${res.staleId} is not live and none was found at its worktree (${d.worktree}) — could not establish`
          : `PR merged, but there is no recorded session and none was found at its worktree (${d.worktree}) — could not establish`,
      });
      continue;
    }
    if (activeIds.has(res.id)) {
      // The resolved live session is active work on the unit (a fix loop reusing
      // the worktree, or a blocked/redirected round). Never reap live work.
      items.push({
        ...base,
        sessionId: res.id,
        reconciled: res.kind === "reconciled",
        disposition: "protected",
        reason: `PR merged, but live session ${res.id} at this worktree belongs to active work on the unit (a fix loop or a blocked/redirected round) — residue left deliberately rather than kill live work`,
      });
      continue;
    }
    items.push({
      ...base,
      disposition: "would-close",
      sessionId: res.id,
      reconciled: res.kind === "reconciled",
      reason:
        res.kind === "reconciled"
          ? `PR merged; live session ${res.id} found at its worktree${res.staleId ? ` (recorded id ${res.staleId} was stale)` : " (no id was recorded)"}`
          : `PR merged; live session ${res.id} is running`,
    });
  }
  return items;
}

// The result of actually closing one would-close item, for the CLI to print.
export interface ReapCloseLine {
  closed: boolean; // the kill exited 0 against a session we had established live
  line: string;
}

// Execute the `--close` step: kill each would-close item's ESTABLISHED live
// session, honestly. The session was proven live in planReap (would-close only),
// so a code-0 kill genuinely ended it. Non-would-close items are ignored — the
// CLI has already listed them. Never throws; an agentop that dies mid-close
// degrades each remaining item to a could-not-confirm NOTE.
export async function executeReap(items: ReapItem[], runner: AgentopRunner): Promise<ReapCloseLine[]> {
  const out: ReapCloseLine[] = [];
  const done = new Set<string>();
  for (const it of items) {
    if (it.disposition !== "would-close" || !it.sessionId) continue;
    if (done.has(it.sessionId)) continue;
    done.add(it.sessionId);
    const via = it.reconciled ? " (reconciled via its worktree)" : "";
    let killed: { code: number; stdout: string; stderr: string };
    try {
      killed = await runner(buildKillArgs(it.sessionId));
    } catch (err) {
      out.push({ closed: false, line: `NOTE session ${it.sessionId} (${it.unit})${via} close could not be confirmed (${err instanceof Error ? err.message : String(err)}) — agentop unavailable; the ledger record stands` });
      continue;
    }
    if (killed.code === 0) {
      out.push({ closed: true, line: `CLOSED session ${it.sessionId} (${it.unit} · ${it.specialist})${via} — its unit's PR is merged; a fix loop opens a new session` });
    } else {
      out.push({ closed: false, line: `NOTE session ${it.sessionId} (${it.unit})${via} close could not be confirmed (kill exited ${killed.code}${killed.stderr ? `: ${killed.stderr}` : ""}) — it was live a moment ago; the ledger record stands` });
    }
  }
  return out;
}
