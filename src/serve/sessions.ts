// Reads live specialist activity from `agentop session list --json` so the web
// console's activity line is real (waiting/working/exited), not just the polled
// ledger state. READ-ONLY: aipe never mutates agentop sessions here. Session
// mode is OPTIONAL — when agentop is absent, unreadable, or prints junk, this
// degrades to [] and the console still works from the ledger alone.
//
// The exec is injected so the parse/match logic stays pure and testable; only
// the CLI wires the real subprocess.
import { parseSessionLiveness, type Liveness } from "../session/poll";

export interface SessionInfo {
  id: string;
  /** Process-level: "running" | "exited" | … (agentop's own vocabulary). */
  status: string;
  /** Live activity of a running session: "working" | "waiting" | … (may be absent). */
  activity?: string;
  harness?: string;
  cwd?: string;
  label?: string;
  /** The journey task the session was filed under, e.g. "aipe/j-20260825-na". */
  task?: string | null;
}

/** Pure: parse `agentop session list --json`. Any deviation from the schema → []. */
export function parseSessions(raw: string): SessionInfo[] {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return [];
  }
  const list = (obj as { sessions?: unknown })?.sessions;
  if (!Array.isArray(list)) return [];
  const out: SessionInfo[] = [];
  for (const s of list) {
    if (typeof s !== "object" || s === null) continue;
    const r = s as Record<string, unknown>;
    if (typeof r.id !== "string") continue;
    out.push({
      id: r.id,
      status: typeof r.status === "string" ? r.status : "",
      ...(typeof r.activity === "string" ? { activity: r.activity } : {}),
      ...(typeof r.harness === "string" ? { harness: r.harness } : {}),
      ...(typeof r.cwd === "string" ? { cwd: r.cwd } : {}),
      ...(typeof r.label === "string" ? { label: r.label } : {}),
      ...(typeof r.task === "string" || r.task === null ? { task: r.task as string | null } : {}),
    });
  }
  return out;
}

export interface DispatchRef {
  worktree?: string;
  journey?: string;
  specialist?: string;
}

/**
 * The live session for a dispatch, or undefined. A session must be running
 * (an exited one is history, not activity). Strongest signal first: the
 * worktree IS the session's cwd. Fallback: the task ends with the journey id
 * AND the label names the specialist (the `<ws>@<Persona>` convention).
 */
export function matchSession(sessions: SessionInfo[], d: DispatchRef): SessionInfo | undefined {
  const live = sessions.filter((s) => s.status === "running");
  if (d.worktree) {
    const byCwd = live.find((s) => s.cwd === d.worktree);
    if (byCwd) return byCwd;
  }
  if (d.journey && d.specialist) {
    const spec = d.specialist.toLowerCase();
    return live.find(
      (s) => !!s.task && s.task.endsWith(d.journey!) && (s.label ?? "").toLowerCase().includes(spec),
    );
  }
  return undefined;
}

/**
 * Run agentop and parse. `exec` returns the raw stdout; the default shells the
 * real binary. Any throw (agentop absent / non-zero / timeout) → [], so the
 * console degrades cleanly. Note the READ-ONLY verb `session list` — the
 * specialist containment guard allows it (unlike `session ls`).
 */
export async function readSessions(exec: () => Promise<string> = defaultExec): Promise<SessionInfo[]> {
  try {
    return parseSessions(await exec());
  } catch {
    return [];
  }
}

async function defaultExec(): Promise<string> {
  const proc = Bun.spawn(["agentop", "session", "list", "--json"], { stdout: "pipe", stderr: "ignore" });
  const text = await new Response(proc.stdout).text();
  await proc.exited;
  if (proc.exitCode !== 0) throw new Error(`agentop exited ${proc.exitCode}`);
  return text;
}

/**
 * One agentop read, three views of it: the lenient `SessionInfo[]` (cwd/activity,
 * for matching a dispatch to its session), the strict id → liveness map, and a
 * `reliable` flag. The map is id → the liveness derived from each entry's
 * `status` (via the same strict `parseSessionLiveness` the poll loop uses), NOT a
 * bare set of "present" ids: the console draws the SAME running/lost/dead
 * distinctions `aipe status` does, from the same source — presence is not proof
 * of life. `reliable` is the honesty pivot the console's liveness depends on: it
 * is TRUE only when agentop resolved AND its JSON parsed as the expected shape. A
 * throw (agentop absent/non-zero) or unparseable/wrong-shape JSON → `reliable:false`
 * with an empty map, so a session-mode unit degrades to `unknown` rather than
 * being flipped to dead-silent (the dangerous direction) — see poll.ts. The
 * lenient `parseSessions` still runs so any usable rows are surfaced for display.
 */
export async function readLive(
  exec: () => Promise<string> = defaultExec,
): Promise<{ sessions: SessionInfo[]; live: Map<string, Liveness>; reliable: boolean }> {
  let raw: string;
  try {
    raw = await exec();
  } catch {
    return { sessions: [], live: new Map(), reliable: false };
  }
  const sessions = parseSessions(raw);
  try {
    return { sessions, live: parseSessionLiveness(raw), reliable: true };
  } catch {
    return { sessions, live: new Map(), reliable: false };
  }
}
