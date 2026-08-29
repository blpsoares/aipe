// The payload the web console actually receives: the dashboard Snapshot plus
// live `agentop` session activity folded in. Kept separate from buildSnapshot
// (which the TUI shares and whose tests must not change) so the agentop read
// lives only on the serve path. Both the initial GET /api/snapshot and the SSE
// /api/stream go through here, so first paint and live updates agree.
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { buildSnapshot, type Snapshot } from "../dashboard/snapshot";
import { ghPrState } from "../journey/reconcile";
import { readLive, type SessionInfo } from "./sessions";
import { dispatchPhase } from "../session/poll";
import type { UnitPhase } from "../session/types";
import type { JourneyDispatch } from "../journey/types";
import type { JourneyView } from "../dashboard/snapshot";

export type ServePayload = Snapshot & {
  sessions: SessionInfo[];
  /**
   * Running agentop sessions rooted at the workspace itself — i.e. the
   * coordinator's own sessions. There is conceptually ONE coordinator; this is a
   * count of how many sessions it has open, surfaced as a fact about sessions,
   * never as multiple coordinators (5.5). Presentation only.
   */
  coordinatorSessions: SessionInfo[];
};

/**
 * True when any dispatch runs (or ran) as a real agentop session — the only
 * case where reading agentop can add anything. A pure-subagent workspace never
 * pays for the subprocess.
 */
export function hasSessionDispatch(journeys: JourneyView[]): boolean {
  return journeys.some((j) => j.dispatches.some((d) => d.mode === "session" || !!d.sessionId));
}

/**
 * Only the sessions the console can actually place: those whose cwd IS a
 * dispatch's worktree. This drops the machine's dozens of unrelated/historical
 * agentop sessions (keeping the SSE payload small) while preserving both live
 * activity and the dead-silent signal (a matched session that has exited).
 */
export function relevantSessions(sessions: SessionInfo[], journeys: JourneyView[]): SessionInfo[] {
  const worktrees = new Set<string>();
  for (const j of journeys) for (const d of j.dispatches) if (d.worktree) worktrees.add(d.worktree);
  return sessions.filter((s) => !!s.cwd && worktrees.has(s.cwd));
}

/** Running sessions rooted at the workspace itself — the coordinator's own sessions (5.5). */
export function coordinatorSessionsOf(sessions: SessionInfo[], workspace: string): SessionInfo[] {
  const root = resolve(workspace);
  return sessions.filter((s) => s.status === "running" && !!s.cwd && resolve(s.cwd) === root);
}

/** A session-mode dispatch carrying its canonical liveness phase. */
export type LiveDispatch = JourneyDispatch & { liveness?: UnitPhase };

/** A dispatch carrying the server-computed merge truth (defect 2). */
export type IntegratedDispatch = JourneyDispatch & { integrated?: boolean };

// The git clone that owns a dispatch's branch. Derived from the worktree path —
// `<clone>/.worktrees/<slug>` — which is the actual clone dir regardless of how
// the repo is spelled in the ledger (org-prefixed or not). Without a worktree we
// cannot reliably locate the clone, so we decline (conservative → not integrated).
function repoDirOf(d: JourneyDispatch): string | null {
  if (d.worktree && d.worktree.includes("/.worktrees/")) return d.worktree.split("/.worktrees/")[0] ?? null;
  return null;
}

/** Real merge check: is `branch` already an ancestor of `origin/main` in the clone? */
function gitIsAncestor(repoDir: string, branch: string): boolean {
  if (!existsSync(join(repoDir, ".git"))) return false;
  try {
    const r = spawnSync("git", ["-C", repoDir, "merge-base", "--is-ancestor", branch, "origin/main"], { stdio: "ignore" });
    return r.status === 0; // exit 0 ⇒ branch's commits are all in main
  } catch {
    return false; // git missing / unreadable → we cannot tell → not integrated
  }
}

// Whether a PR has MERGED, the way GitHub records it. This is the ONLY reliable
// tell for a SQUASH merge — `--is-ancestor` is structurally ALWAYS false there,
// because a squash lands a brand-new commit and the branch's own commits never
// become ancestors of main (aipe merges by squash, so this was a systematic false
// negative, not an edge case). Monotonic cache: once MERGED a PR stays merged, so
// it is queried at most once; still-open PRs re-query (a bounded, small set), and
// a gh failure returns false (conservative — never a false "integrated").
const mergedPrCache = new Map<string, boolean>();
async function ghPrMerged(prUrl: string): Promise<boolean> {
  if (mergedPrCache.get(prUrl)) return true;
  const merged = (await ghPrState(prUrl)) === "MERGED";
  if (merged) mergedPrCache.set(prUrl, true);
  return merged;
}

/**
 * The merge TRUTH per dispatch (defect 2, SDD §4): `integrated` is `true` when the
 * work is already in main, INDEPENDENT of the ledger status — so a `verified`
 * whose branch already merged stops sitting in "ready to merge" lying about work
 * that no longer needs the PE. Two signals, both needed:
 *   • `--is-ancestor` — catches a fast-forward / merge-commit landing (local, cheap).
 *   • the PR's MERGED state — catches a SQUASH merge, which `--is-ancestor` can
 *     NEVER see (re-gate B). aipe squash-merges, so without this every verified
 *     squash-merged unit falsely stayed in "ready".
 * Checked ONLY for `merged` (declared truth) and `verified`/`delivered` (the
 * "done, awaiting merge" states); an in-progress unit is NEVER integrated, even if
 * its branch happens to be an ancestor of main (a fresh branch with no commits
 * yet). Conservative throughout: any uncertainty ⇒ `false`, never a false positive.
 */
export async function annotateIntegrated(
  journeys: JourneyView[],
  isAncestor: (repoDir: string, branch: string) => boolean = gitIsAncestor,
  prMerged: (prUrl: string) => Promise<boolean> = ghPrMerged,
): Promise<JourneyView[]> {
  const ancMemo = new Map<string, boolean>();
  const ancestor = (repoDir: string, branch: string): boolean => {
    const key = [repoDir, branch].join("|");
    const hit = ancMemo.get(key);
    if (hit !== undefined) return hit;
    const val = isAncestor(repoDir, branch);
    ancMemo.set(key, val);
    return val;
  };
  const integratedOf = async (d: JourneyDispatch): Promise<boolean> => {
    if (d.status === "merged") return true;
    if (d.status !== "verified" && d.status !== "delivered") return false;
    const repoDir = repoDirOf(d);
    if (repoDir && d.branch && ancestor(repoDir, d.branch)) return true; // ff / merge-commit
    if (typeof d.pr === "string" && d.pr && (await prMerged(d.pr))) return true; // squash
    return false;
  };
  const out: JourneyView[] = [];
  for (const j of journeys) {
    const dispatches: IntegratedDispatch[] = [];
    for (const d of j.dispatches) dispatches.push({ ...d, integrated: await integratedOf(d) });
    out.push({ ...j, dispatches });
  }
  return out;
}

/**
 * Annotate every SESSION-mode dispatch with its canonical liveness `UnitPhase` —
 * the SAME `dispatchPhase` derivation `aipe status` runs, so the web console
 * never invents an optimistic reading of its own (the whole point of "consume the
 * calculation, don't re-derive"). Subagent dispatches are left untouched (no
 * session to describe).
 *
 * `liveIds` is the live-session id set; `reliable` says whether it can be trusted
 * (a failed/unreadable `session list` is "we cannot tell", NOT "everyone is
 * dead"). `worktreeExists` is positive death evidence INDEPENDENT of agentop: a
 * still-`dispatched` record whose worktree is gone from disk is dead-silent even
 * when the live list is unreadable — the "`dispatched` no ledger ≠ vivo"
 * cross-check (trap 2). It never overrides a phase we could positively establish
 * (`running`) or a terminal ledger state (`landed`/`redirected`/`waiting`).
 */
export function annotateLiveness(
  journeys: JourneyView[],
  liveIds: Set<string>,
  reliable: boolean,
  worktreeExists: (path: string) => boolean,
): JourneyView[] {
  const settled = new Set<UnitPhase>(["running", "landed", "redirected", "waiting"]);
  return journeys.map((j) => ({
    ...j,
    dispatches: j.dispatches.map((d): LiveDispatch => {
      if (d.mode !== "session") return d;
      let phase = dispatchPhase(d, liveIds, reliable);
      if (!settled.has(phase) && d.worktree && !worktreeExists(d.worktree)) phase = "dead-silent";
      return { ...d, liveness: phase };
    }),
  }));
}

export async function buildServePayload(
  workspace: string,
  read: () => Promise<{ sessions: SessionInfo[]; liveIds: Set<string>; reliable: boolean }> = readLive,
  worktreeExists: (path: string) => boolean = existsSync,
  isAncestor: (repoDir: string, branch: string) => boolean = gitIsAncestor,
  prMerged: (prUrl: string) => Promise<boolean> = ghPrMerged,
): Promise<ServePayload> {
  const snapshot = await buildSnapshot(workspace);
  // One agentop read covers the per-dispatch activity, the coordinator's own
  // sessions AND the canonical liveness. Skip it only when no session could exist
  // (a pure-subagent workspace) — then the live set is empty but RELIABLE (there
  // is genuinely nothing to be alive), so no session-mode unit exists to mislabel.
  const hasSession = hasSessionDispatch(snapshot.journeys);
  const { sessions: all, liveIds, reliable } = hasSession
    ? await read()
    : { sessions: [] as SessionInfo[], liveIds: new Set<string>(), reliable: true };
  // Liveness first, then the merge truth (defect 2): both annotate dispatches and
  // compose cleanly (each spreads the whole dispatch, preserving the other's field).
  const journeys = await annotateIntegrated(annotateLiveness(snapshot.journeys, liveIds, reliable, worktreeExists), isAncestor, prMerged);
  const sessions = relevantSessions(all, snapshot.journeys);
  const coordinatorSessions = coordinatorSessionsOf(all, workspace);
  return { ...snapshot, journeys, sessions, coordinatorSessions };
}
