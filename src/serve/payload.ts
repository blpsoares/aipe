// The payload the web console actually receives: the dashboard Snapshot plus
// live `agentop` session activity folded in. Kept separate from buildSnapshot
// (which the TUI shares and whose tests must not change) so the agentop read
// lives only on the serve path. Both the initial GET /api/snapshot and the SSE
// /api/stream go through here, so first paint and live updates agree.
import { buildSnapshot, type Snapshot } from "../dashboard/snapshot";
import { readSessions, type SessionInfo } from "./sessions";
import type { JourneyView } from "../dashboard/snapshot";

export type ServePayload = Snapshot & { sessions: SessionInfo[] };

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

export async function buildServePayload(
  workspace: string,
  read: () => Promise<SessionInfo[]> = readSessions,
): Promise<ServePayload> {
  const snapshot = await buildSnapshot(workspace);
  const sessions = hasSessionDispatch(snapshot.journeys) ? relevantSessions(await read(), snapshot.journeys) : [];
  return { ...snapshot, sessions };
}
