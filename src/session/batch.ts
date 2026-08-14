// Assembles and runs the single `agentop session batch` that starts a wave.
import type { AgentopRunner, StartedSession } from "./types";

export interface BatchUnit {
  harness: string;
  cwd: string;
  promptFile: string;
  model?: string;
}

// The prompt is handed over as `@<file>`. Inlining a 40-line brief into an argv
// string is a quoting bug waiting to happen, and it would leak the whole brief
// into every process listing.
export function buildBatchArgs(task: string, units: BatchUnit[]): string[] {
  const args = ["session", "batch", "--task", task, "--json"];
  for (const unit of units) {
    if (unit.model) args.push("--model", unit.model);
    args.push("--session", `${unit.harness}@${unit.cwd}: @${unit.promptFile}`);
  }
  return args;
}

// NOTE (risk for the task that consumes this): agentop's own ordering/count
// guarantees for `session batch --json` are not documented here. This parses
// exactly what agentop reports, in the order it reports it — it does not pad
// short lists or restore request order. If a later task zips this result
// positionally against the requested `units`, that pairing silently breaks
// whenever agentop returns fewer sessions than requested or reorders them.
export function parseBatchOutput(stdout: string): StartedSession[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return [];
  }
  const list = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as any).sessions)
      ? (parsed as any).sessions
      : [];
  const sessions: StartedSession[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const r = entry as Record<string, unknown>;
    if (typeof r.id !== "string") continue;
    sessions.push({
      id: r.id,
      harness: typeof r.harness === "string" ? r.harness : "claude",
      cwd: typeof r.cwd === "string" ? r.cwd : "",
    });
  }
  return sessions;
}

export async function startBatch(
  task: string,
  units: BatchUnit[],
  runner: AgentopRunner,
): Promise<StartedSession[]> {
  const result = await runner(buildBatchArgs(task, units));
  if (result.code !== 0) {
    throw new Error(result.stderr || `agentop session batch failed (code ${result.code})`);
  }
  return parseBatchOutput(result.stdout);
}
