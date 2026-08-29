// The payload the web console actually receives: the dashboard Snapshot plus
// live `agentop` session activity folded in. Kept separate from buildSnapshot
// (which the TUI shares and whose tests must not change) so the agentop read
// lives only on the serve path. Both the initial GET /api/snapshot and the SSE
// /api/stream go through here, so first paint and live updates agree.
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { buildSnapshot, type Snapshot } from "../dashboard/snapshot";
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
  const journeys = annotateLiveness(snapshot.journeys, liveIds, reliable, worktreeExists);
  const sessions = relevantSessions(all, snapshot.journeys);
  const coordinatorSessions = coordinatorSessionsOf(all, workspace);
  return { ...snapshot, journeys, sessions, coordinatorSessions };
}
