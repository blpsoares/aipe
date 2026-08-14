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

export type UnitPhase = "landed" | "running" | "dead-silent";

export interface UnitState {
  fqid: string; // repo or repo/package
  sessionId: string | null;
  phase: UnitPhase;
  branch: string;
  worktree: string;
}
