// The payload the web console actually receives: the dashboard Snapshot plus
// live `agentop` session activity folded in. Kept separate from buildSnapshot
// (which the TUI shares and whose tests must not change) so the agentop read
// lives only on the serve path. Both the initial GET /api/snapshot and the SSE
// /api/stream go through here, so first paint and live updates agree.
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { buildSnapshot, type Snapshot } from "../dashboard/snapshot";
import { ghPrState, type PrState, type PrStateFetcher } from "../journey/reconcile";
import { listJourneys } from "../journey/ledger";
import { readLive, type SessionInfo } from "./sessions";
import { dispatchPhase, type Liveness } from "../session/poll";
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

/** A dispatch carrying the server-computed merge truth (defect 2). `integrationPending`
 *  marks a unit whose squash tell is not yet known (cold cache) — shown as
 *  "verifying", never asserted as confirmed-pending. */
export type IntegratedDispatch = JourneyDispatch & { integrated?: boolean; integrationPending?: boolean };

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

// ── PR-merge cache (re-gate B2): the network is OUT of the render ─────────────
// The build path (buildServePayload, run per SSE client on a 3s reconcile + every
// fs event) must NEVER call the network — putting `gh pr view` there hammered the
// API (~1 call/s/client) and, when rate-limited, returned null → merged units
// flipped BACK to "ready", the very lie item 2 kills, now worst exactly under load.
// So the build reads this in-memory cache SYNCHRONOUSLY; a single server-owned
// refresher (startPrMergeRefresher) is the only thing that touches `gh`.
//
// `merged` is STICKY: once true it is never re-polled and never downgraded, so a
// later rate-limited/failed poll can't turn an integrated unit back into "ready".
// Open/unknown entries carry a timestamp and refresh past a TTL. Any failure
// (timeout, gh error → null) leaves the prior entry untouched — never a downgrade,
// never a false positive.
interface PrCacheEntry {
  merged: boolean;
  at: number;
}
const prCache = new Map<string, PrCacheEntry>();
export const PR_TTL_MS = 90_000;

/** Synchronous cache read used by the build — no network, ever. Unknown ⇒ false. */
export function prMergedFromCache(prUrl: string): boolean {
  return prCache.get(prUrl)?.merged ?? false;
}

// Tri-state so the build can tell "confirmed not merged" (open) from "not checked
// yet" (unknown) — the distinction that keeps a COLD cache from asserting a merge
// status it hasn't established (re-gate B2 follow-up). `unknown` is honestly shown
// as "verifying", never as "confirmed pending".
export type PrMergeState = "merged" | "open" | "unknown";
export function prStateFromCache(prUrl: string): PrMergeState {
  const e = prCache.get(prUrl);
  return e === undefined ? "unknown" : e.merged ? "merged" : "open";
}

/** Test seam: seed/clear the cache deterministically. */
export function _seedPrCache(prUrl: string, merged: boolean, at = Date.now()): void {
  prCache.set(prUrl, { merged, at });
}
export function _clearPrCache(): void {
  prCache.clear();
}

/** `ghPrState` with a hard timeout, so a hung `gh` can never wedge the refresher. */
async function ghPrStateTimed(prUrl: string, ms = 4000): Promise<PrState> {
  return await Promise.race([ghPrState(prUrl), new Promise<PrState>((r) => setTimeout(() => r(null), ms))]);
}

/**
 * Refresh the cache for the given PR URLs — the ONLY place `gh` runs. Skips
 * sticky-merged and still-fresh entries (so at most one poll per open PR per TTL,
 * regardless of client/tab count); bounded concurrency; a null (rate-limit/
 * timeout/error) is a no-op that keeps the prior entry (never a downgrade).
 */
export async function refreshPrMergeCache(
  urls: string[],
  fetchState: PrStateFetcher = ghPrStateTimed,
  now: number = Date.now(),
): Promise<void> {
  const due = [...new Set(urls)].filter((u) => {
    const e = prCache.get(u);
    if (e?.merged) return false; // sticky merged — never re-poll
    return !e || now - e.at >= PR_TTL_MS; // unknown or stale
  });
  const LIMIT = 4;
  for (let i = 0; i < due.length; i += LIMIT) {
    const batch = due.slice(i, i + LIMIT);
    const states = await Promise.all(batch.map((u) => fetchState(u)));
    batch.forEach((u, k) => {
      const st = states[k];
      if (st === null || st === undefined) return; // couldn't tell → keep prior, never downgrade
      prCache.set(u, { merged: st === "MERGED", at: now });
    });
  }
}

/**
 * Start the single, server-owned PR-merge refresher: on a slow timer it reads the
 * workspace ledgers (fs, cheap) for the verified/delivered PRs and refreshes the
 * cache off the render path. Returns a stop fn. Decoupled from the build entirely,
 * so gh usage is bounded by (open PRs / interval), NOT by clients × builds.
 */
export function startPrMergeRefresher(
  workspace: string,
  intervalMs = 60_000,
  fetchState: PrStateFetcher = ghPrStateTimed,
): () => void {
  const tick = async (): Promise<void> => {
    try {
      const ledgers = await listJourneys(workspace);
      const urls: string[] = [];
      for (const l of ledgers) {
        for (const d of l.dispatches) {
          if ((d.status === "verified" || d.status === "delivered") && typeof d.pr === "string" && d.pr) urls.push(d.pr);
        }
      }
      await refreshPrMergeCache(urls, fetchState);
    } catch {
      // best-effort: on any failure the build degrades to ancestor-only (never lies)
    }
  };
  void tick(); // warm immediately
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref?.(); // never keep the process/event loop alive for the poller
  return () => clearInterval(timer);
}

/**
 * The merge TRUTH per dispatch (defect 2, SDD §4): `integrated` is `true` when the
 * work is already in main, INDEPENDENT of the ledger status — so a `verified`
 * whose branch already merged stops sitting in "ready to merge" lying about work
 * that no longer needs the PE. Two signals, both needed, BOTH non-blocking:
 *   • `--is-ancestor` — catches a fast-forward / merge-commit landing (local, cheap).
 *   • the PR's cached MERGED state — catches a SQUASH merge, which `--is-ancestor`
 *     can NEVER see (re-gate B). Read from the in-memory cache (populated off the
 *     render path by startPrMergeRefresher), so the build does NO network (re-gate B2).
 * Checked ONLY for `merged` (declared truth) and `verified`/`delivered` (the
 * "done, awaiting merge" states); an in-progress unit is NEVER integrated, even if
 * its branch happens to be an ancestor of main. Conservative: any uncertainty ⇒
 * `false`, never a false positive.
 */
export function annotateIntegrated(
  journeys: JourneyView[],
  isAncestor: (repoDir: string, branch: string) => boolean = gitIsAncestor,
  prState: (prUrl: string) => PrMergeState = prStateFromCache,
): JourneyView[] {
  const ancMemo = new Map<string, boolean>();
  const ancestor = (repoDir: string, branch: string): boolean => {
    const key = [repoDir, branch].join("|");
    const hit = ancMemo.get(key);
    if (hit !== undefined) return hit;
    const val = isAncestor(repoDir, branch);
    ancMemo.set(key, val);
    return val;
  };
  // `integrated` is only ever set on a POSITIVE, established signal. `pending` says
  // the squash tell is not yet known (cold cache) — so the card can say "verifying"
  // instead of asserting "confirmed pending", which would be the --is-ancestor lie
  // in new clothes (re-gate B2 follow-up).
  const truthOf = (d: JourneyDispatch): { integrated: boolean; pending: boolean } => {
    if (d.status === "merged") return { integrated: true, pending: false };
    if (d.status !== "verified" && d.status !== "delivered") return { integrated: false, pending: false };
    const repoDir = repoDirOf(d);
    if (repoDir && d.branch && ancestor(repoDir, d.branch)) return { integrated: true, pending: false }; // ff / merge-commit
    if (typeof d.pr === "string" && d.pr) {
      const st = prState(d.pr); // cached, no network
      if (st === "merged") return { integrated: true, pending: false }; // squash
      if (st === "open") return { integrated: false, pending: false }; // CONFIRMED not merged
      return { integrated: false, pending: true }; // unknown — not yet verified
    }
    return { integrated: false, pending: false }; // no PR + not ancestor → nothing to establish
  };
  return journeys.map((j) => ({
    ...j,
    dispatches: j.dispatches.map((d): IntegratedDispatch => {
      const { integrated, pending } = truthOf(d);
      return pending ? { ...d, integrated, integrationPending: true } : { ...d, integrated };
    }),
  }));
}

/**
 * Annotate every SESSION-mode dispatch with its canonical liveness `UnitPhase` —
 * the SAME `dispatchPhase` derivation `aipe status` runs, so the web console
 * never invents an optimistic reading of its own (the whole point of "consume the
 * calculation, don't re-derive"). Subagent dispatches are left untouched (no
 * session to describe).
 *
 * `live` maps each id agentop LISTED to the liveness derived from its `status`
 * (parseSessionLiveness) — NOT a bare set of "present" ids. That is what makes
 * this claim honest: a session agentop still lists but has marked `lost` becomes
 * the `lost` phase, and one it has marked terminal becomes `dead-silent`, exactly
 * as `aipe status` and the poll loop report them — presence is not proof of life.
 * `reliable` says whether the map can be trusted (a failed/unreadable
 * `session list` is "we cannot tell", NOT "everyone is dead"). `worktreeExists`
 * is positive death evidence INDEPENDENT of agentop: a still-`dispatched` record
 * whose worktree is gone from disk is dead-silent even when the live list is
 * unreadable — the "`dispatched` no ledger ≠ vivo" cross-check (trap 2). It never
 * overrides a phase we could positively establish (`running`) or a terminal
 * ledger state (`landed`/`redirected`/`waiting`) — nor a `lost` we established.
 */
export function annotateLiveness(
  journeys: JourneyView[],
  live: Map<string, Liveness>,
  reliable: boolean,
  worktreeExists: (path: string) => boolean,
): JourneyView[] {
  const settled = new Set<UnitPhase>(["running", "landed", "redirected", "waiting", "lost"]);
  return journeys.map((j) => ({
    ...j,
    dispatches: j.dispatches.map((d): LiveDispatch => {
      if (d.mode !== "session") return d;
      let phase = dispatchPhase(d, live, reliable);
      if (!settled.has(phase) && d.worktree && !worktreeExists(d.worktree)) phase = "dead-silent";
      return { ...d, liveness: phase };
    }),
  }));
}

export async function buildServePayload(
  workspace: string,
  read: () => Promise<{ sessions: SessionInfo[]; live: Map<string, Liveness>; reliable: boolean }> = readLive,
  worktreeExists: (path: string) => boolean = existsSync,
  isAncestor: (repoDir: string, branch: string) => boolean = gitIsAncestor,
  prState: (prUrl: string) => PrMergeState = prStateFromCache,
): Promise<ServePayload> {
  const snapshot = await buildSnapshot(workspace);
  // One agentop read covers the per-dispatch activity, the coordinator's own
  // sessions AND the canonical liveness. Skip it only when no session could exist
  // (a pure-subagent workspace) — then the live set is empty but RELIABLE (there
  // is genuinely nothing to be alive), so no session-mode unit exists to mislabel.
  const hasSession = hasSessionDispatch(snapshot.journeys);
  const { sessions: all, live, reliable } = hasSession
    ? await read()
    : { sessions: [] as SessionInfo[], live: new Map<string, Liveness>(), reliable: true };
  // Liveness first, then the merge truth (defect 2): both annotate dispatches and
  // compose cleanly (each spreads the whole dispatch, preserving the other's field).
  const journeys = annotateIntegrated(annotateLiveness(snapshot.journeys, live, reliable, worktreeExists), isAncestor, prState);
  const sessions = relevantSessions(all, snapshot.journeys);
  const coordinatorSessions = coordinatorSessionsOf(all, workspace);
  return { ...snapshot, journeys, sessions, coordinatorSessions };
}
