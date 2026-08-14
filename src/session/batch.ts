// Assembles and runs the single `agentop session batch` that starts a wave.
import type { AgentopRunner, StartedSession } from "./types";

export interface BatchUnit {
  harness: string;
  cwd: string;
  promptFile: string;
  model?: string;
  // "<repo>/<persona-slug>" — how this session shows up in the agentop cockpit
  // (`session list`, `attach`) instead of an opaque generated id. Optional so
  // a caller with no fqid/specialist context can still start a batch.
  name?: string;
}

// The prompt is handed over as `@<file>`. Inlining a 40-line brief into an argv
// string is a quoting bug waiting to happen, and it would leak the whole brief
// into every process listing.
export function buildBatchArgs(task: string, units: BatchUnit[]): string[] {
  const args = ["session", "batch", "--task", task, "--json"];
  for (const unit of units) {
    if (unit.model) args.push("--model", unit.model);
    if (unit.name) args.push("--name", unit.name);
    args.push("--session", `${unit.harness}@${unit.cwd}: @${unit.promptFile}`);
  }
  return args;
}

// Result of parsing `session batch --json` output: the sessions we could
// make sense of, plus how many entries we had to throw away. `malformed` is
// not optional — a caller has to name it (even to ignore it) to get at
// `sessions`, so a shortfall can't vanish through plain destructuring.
export interface BatchParseResult {
  sessions: StartedSession[];
  malformed: number;
}

// How much of unparseable stdout to echo back in the thrown error. Long
// enough to recognise the shape of the problem, short enough not to dump a
// giant blob into logs.
const STDOUT_PREVIEW_LIMIT = 500;

function previewStdout(stdout: string): string {
  return stdout.length > STDOUT_PREVIEW_LIMIT
    ? `${stdout.slice(0, STDOUT_PREVIEW_LIMIT)}… (truncated, ${stdout.length} chars total)`
    : stdout;
}

// NOTE (risk for the task that consumes this): agentop's own ordering/count
// guarantees for `session batch --json` are not documented here. This parses
// exactly what agentop reports, in the order it reports it — it does not pad
// short lists or restore request order. If a later task zips this result
// positionally against the requested `units`, that pairing silently breaks
// whenever agentop returns fewer sessions than requested or reorders them.
export function parseBatchOutput(stdout: string): BatchParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    // Exit code 0 but the body doesn't parse: this is NOT the same thing as
    // "agentop started nothing". A legitimately empty result is well-formed
    // JSON ([] or {"sessions":[]}); garbage stdout is a contract break and
    // must not silently resolve as if zero sessions were requested.
    throw new Error(
      `agentop session batch printed unparseable JSON on a successful exit: ${previewStdout(stdout)}`,
    );
  }
  const parsedIsArray = Array.isArray(parsed);
  const parsedHasSessionsArray =
    !parsedIsArray && parsed !== null && typeof parsed === "object" && Array.isArray((parsed as any).sessions);
  if (!parsedIsArray && !parsedHasSessionsArray) {
    // Valid JSON, but a top-level shape we don't recognise (null, {}, an
    // error object, a bare number/string, ...) is the same ambiguity the
    // unparseable-JSON throw above exists to eliminate, one boundary later:
    // silently falling through to `list = []` would make it indistinguishable
    // from a genuinely empty, well-formed result ([] or {"sessions":[]}). A
    // caller can't act on "malformed: N" here — there's no list to have
    // partially started sessions in, unlike the per-entry case below — so
    // this throws exactly like the unparseable-JSON path.
    throw new Error(
      `agentop session batch printed valid JSON with an unexpected shape (not an array, and no "sessions" array) on a successful exit: ${previewStdout(stdout)}`,
    );
  }
  const list = parsedIsArray ? parsed : (parsed as any).sessions;
  const sessions: StartedSession[] = [];
  let malformed = 0;
  for (const entry of list) {
    if (!entry || typeof entry !== "object") {
      malformed++;
      continue;
    }
    const r = entry as Record<string, unknown>;
    // `cwd` is the pairing key a later task uses to match a session back to
    // the unit that requested it. A missing/non-string/empty-string `cwd` is
    // exactly as unusable as a missing/empty `id`: defaulting or letting an
    // empty string through would make two bad entries collide on the same
    // key (or write a useless "" into the ledger) and silently mispair or
    // overwrite one another, which is worse than dropping the entry outright.
    if (typeof r.id !== "string" || r.id === "" || typeof r.cwd !== "string" || r.cwd === "") {
      malformed++;
      continue;
    }
    sessions.push({
      id: r.id,
      // `harness` is not a pairing key, only a label — defaulting it to
      // "claude" (the same default the rest of AIPe assumes) keeps an
      // otherwise-usable entry usable instead of discarding real session
      // data over a cosmetic field.
      harness: typeof r.harness === "string" ? r.harness : "claude",
      cwd: r.cwd,
    });
  }
  return { sessions, malformed };
}

export async function startBatch(
  task: string,
  units: BatchUnit[],
  runner: AgentopRunner,
): Promise<BatchParseResult> {
  const result = await runner(buildBatchArgs(task, units));
  if (result.code !== 0) {
    throw new Error(result.stderr || `agentop session batch failed (code ${result.code})`);
  }
  // Returned, not thrown: a non-zero `malformed` count sits next to sessions
  // that DID start and DID parse. Throwing here would discard those real,
  // already-running session ids along with the bad entries — orphaning
  // sessions agentop actually launched, with nothing in the ledger to show
  // for them. Returning both keeps the usable data reachable while making
  // the shortfall part of the type the caller must engage with, so the
  // decision of how loud to be (log, retry, hard-fail the wave) belongs to
  // the caller that also owns the ledger, not to this function.
  return parseBatchOutput(result.stdout);
}
