// The fact-based reaper (item 2). The record-time close in session-close.ts
// fires on a ledger transition and depends on the coordinator having recorded it
// in the right place with the right sessionId — the trigger that is documented
// to err. This reaper does NOT depend on that registration: for every
// session-mode unit it establishes the landing by VERIFIABLE FACT — either the
// unit has a PR and the forge reports that PR MERGED, OR (round 2 of item 3)
// agentop's own roster proves the session's PROCESS has exited — finds the real
// live session where one exists (reconciling a stale id by worktree), and
// closes only what it can stand behind. A LIVE blocked/dispatched/redirected
// session (agentop status running/unregistered, or lost — ambiguous, may still
// hold work) is NEVER touched; only a session agentop reports as provably dead
// (exited/closed) is reaped regardless of its ledger status, because a dead
// process is not "still working" no matter what the ledger last recorded.
//
// The FULL plan (planReap) is an EXPLICIT coordinator step, never background: it
// plans first, and the CLI lists the plan before any close. Killing a LIVE
// session — even one whose PR merged — is a decision, not an automation.
//
// The one carve-out is the AUTOMATIC half (planDeadReap, #73): collecting a
// session whose PROCESS has provably EXITED is not that decision. A dead process
// is not "still working" and is not "waiting on a person" — it is a corpse, and
// clearing a corpse is cleanup, not judgement. That subset needs no forge and no
// human, so an edge aipe already runs (`aipe status`) may collect it on its own
// (see src/status/harvest.ts). The PE's hard constraint holds by construction:
// only agentop's `gone` reaches planDeadReap, and a `waiting`/`NEEDS APPROVAL`/
// running session reports `alive`, never `gone`.
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

// Item 3, round 2: a session's PROCESS STATE is a fact independent of the
// ledger's status and of the PR. agentop's own roster proves a process has
// cleanly ended (`exited`/`closed` → Liveness "gone", see sessionLiveness in
// poll.ts) — that fact overrides both KEEP_ALIVE ("still working") and
// not-landed ("no PR to check yet"): a dead process cannot be either. This is
// what closes the c5 case (a session that died BEFORE ever opening a PR,
// invisible to a PR-only reaper) and the ghost-registration case (a
// dispatched/blocked/redirected row whose session quietly died). `lost` is
// deliberately excluded — agentop uses it when it could not account for the
// process cleanly, which may still be an orphan holding work, not the proven
// death this checks for. `alive` (running/unregistered) is obviously excluded:
// a session idle waiting for a person (agentop's `activity`: waiting / needs
// approval) still reports `status: running`, so it never reaches here — the
// hard PE guarantee ("never close a session waiting on a person") holds
// because that guarantee is about status, and this only acts on "gone".
function findDeadProcess(
  d: { sessionId?: string; worktree: string },
  workspace: string,
  roster: RosterEntry[],
): { id: string; reconciled: boolean; staleId: string | null } | null {
  const idRes = resolveLiveSessionId(d, workspace, roster);
  if (idRes.kind === "none") return null;
  const found = roster.find((e) => e.id === idRes.id);
  if (found?.liveness !== "gone") return null;
  return {
    id: found.id,
    reconciled: idRes.kind === "reconciled",
    staleId: idRes.kind === "reconciled" ? idRes.staleId : null,
  };
}

// The AUTOMATIC harvest (#73): the subset of the reap plan that needs NO forge
// and NO human decision — every session whose PROCESS agentop reports as `gone`
// (exited/closed). Pure and synchronous: unlike planReap it never calls the
// forge, so it is safe on the `aipe status` path where a network round-trip per
// unit would be a regression. It reuses findDeadProcess, so all of that
// function's safety carries over unchanged: a `lost` session is ambiguous and
// left alone; a worktree now hosting a LIVE fix session resolves to that live id
// (not `gone`) and is never collected. An unreliable roster collects nothing —
// death cannot be established, so nothing is guessed closed.
export function planDeadReap(
  ledger: JourneyLedger,
  workspace: string,
  roster: RosterEntry[],
  rosterReliable: boolean,
): ReapItem[] {
  if (!rosterReliable) return [];
  const items: ReapItem[] = [];
  for (const d of ledger.dispatches) {
    if (d.mode !== "session") continue;
    const dead = findDeadProcess(d, workspace, roster);
    if (!dead) continue;
    const unit = packageFqid(d.repo, d.package);
    items.push({
      unit,
      specialist: d.specialist,
      disposition: "would-close",
      sessionId: dead.id,
      recordedId: d.sessionId ?? null,
      reconciled: dead.reconciled,
      reason: `agentop reports the process behind session ${dead.id} has exited${dead.reconciled ? ` (found at its worktree${dead.staleId ? `; recorded id ${dead.staleId} was stale` : ""})` : ""} — collected automatically: a dead process is neither still working nor waiting on a person`,
    });
  }
  return items;
}

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

    // 0 — a provably DEAD process wins over everything, including KEEP_ALIVE and
    // not-landed: neither "still working" nor "not yet landed" can be true of a
    // process that has actually exited. Checked before the ledger-status
    // protection so a stale dispatched/blocked/redirected registration for a
    // session that quietly died gets reaped instead of protected forever.
    if (rosterReliable) {
      const dead = findDeadProcess(d, workspace, roster);
      if (dead) {
        items.push({
          ...base,
          disposition: "would-close",
          sessionId: dead.id,
          reconciled: dead.reconciled,
          reason: `agentop reports the process behind session ${dead.id} has exited${dead.reconciled ? ` (found at its worktree${dead.staleId ? `; recorded id ${dead.staleId} was stale` : ""})` : ""} — a dead process is neither "still working" nor "not yet landed"; closing only removes a stale registration${d.pr ? ` (unit's PR: ${d.pr})` : " (no PR was ever opened for this unit)"}`,
        });
        continue;
      }
    }

    // 1 — protection wins over everything else. A blocked session is closed on
    // NO path, even with a merged PR; a dispatched (fix loop) / redirected
    // session is live work. Checked before any later fact can override it.
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
      // The close line states the SAME fact the plan established (a merged PR, or
      // a dead process), never a fixed "PR is merged" — that was wrong whenever
      // the item closed via the dead-process path.
      out.push({ closed: true, line: `CLOSED session ${it.sessionId} (${it.unit} · ${it.specialist})${via} — ${it.reason}` });
    } else {
      out.push({ closed: false, line: `NOTE session ${it.sessionId} (${it.unit})${via} close could not be confirmed (kill exited ${killed.code}${killed.stderr ? `: ${killed.stderr}` : ""}) — the ledger record stands` });
    }
  }
  return out;
}
