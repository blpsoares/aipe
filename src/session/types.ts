// The one place that names the agentop contract AIPe depends on. 1.9.0 is the
// version verified to carry `session batch`/`list` with `--json`.
export const MIN_AGENTOP_VERSION = "1.9.0";

export type SessionMode = "subagent" | "session";
export type Intensity = "normal" | "ultracode";

// agentop is always reached through this, so tests never execute the binary.
export type AgentopRunner = (
  args: string[],
) => Promise<{ code: number; stdout: string; stderr: string }>;

export interface ProbeResult {
  present: boolean;
  version: string | null;
  ok: boolean;
  reason?: string;
}

// One session agentop started, as returned by `session batch --json`.
export interface StartedSession {
  id: string;
  harness: string;
  cwd: string;
}

// The five states collect must keep distinct (D6), plus `redirected`:
//   landed       — the unit recorded its delivery.
//   running      — the session is verifiably alive (present in a RELIABLE live
//                  list). We assert aliveness only, never independently-verified
//                  "progress".
//   waiting       — the specialist declared itself `blocked` (ledger-backed):
//                  alive-or-not, it is waiting on the coordinator.
//   unknown       — liveness could not be established (the live list was
//                  unreadable). Never falls through to dead.
//   dead-silent   — a reliable live list was obtained and the session is absent,
//                  or the unit never got a session id at all: ended/never-was
//                  without recording.
//   redirected    — the PE changed the unit's direction live.
export type UnitPhase = "landed" | "running" | "waiting" | "unknown" | "dead-silent" | "redirected";

export interface UnitState {
  fqid: string; // repo or repo/package
  sessionId: string | null;
  phase: UnitPhase;
  branch: string;
  worktree: string;
  // The reason attached to the unit's current state — the PE's redirect reason
  // for `redirected`, or the specialist's blocked reason for `waiting`. Null for
  // every other phase, and also null for a record written before the reason was
  // required/persisted, so a legacy ledger still reads without throwing.
  reason: string | null;
}
