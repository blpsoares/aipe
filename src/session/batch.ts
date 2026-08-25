// Assembles and runs the single `agentop session batch` that starts a wave.
import type { AgentopRunner, StartedSession } from "./types";

export interface BatchUnit {
  harness: string;
  cwd: string;
  promptFile: string;
  model?: string;
}

// Verified against the real agentop v1.13.7 binary (`agentop session batch`
// with no arguments, and `agentop session --help`, since `batch` has no
// `--help` of its own — see the CLI's own usage block, reproduced below):
//
//   agentop session batch --task "<name>" [--cwd <path>] [--model <id>] [--effort <lvl>] \
//                        --session "<harness>[@<cwd>]: <prompt>" [--session "..."] [--json]
//
//   "--cwd/--model/--effort given before the sessions apply to all of them;
//    a @<cwd> on a session overrides it."
//
// Two things this rules out, both confirmed live:
//
// 1. `--name` is REJECTED outright: `agentop session batch --task probe-x
//    --name foo --json --session "claude@/tmp: hi"` printed exactly
//    `--name is not accepted by batch — use --session for each one.` and
//    exited 1. `--name` only exists on the SINGLE-session form
//    (`agentop session <harness> ... --name "label"`), never on `batch`, and
//    the `--session "<harness>[@<cwd>]: <prompt>"` string has no field for it
//    either. So `batch` cannot name a session, in ANY form, at dispatch time
//    — the actual equivalent is the separate `agentop session rename <id>
//    "label"` command (see buildRenameArgs below), run once per session AFTER
//    its id comes back from `batch` — which is exactly what dispatchCommand
//    (../cli.ts) does.
//
// 2. `--model` is a BATCH-level flag, not a per-session one: given once,
//    before the `--session` flags, it applies to every session in that one
//    `batch` call. There is no per-session override for it (only `@<cwd>`
//    overrides cwd) — so the old code's `--model <id>` interleaved before
//    EACH `--session` flag did not bind per unit; agentop would apply the
//    last `--model` it saw before the first `--session` (or something
//    similarly order-dependent) to the WHOLE call, silently misapplying one
//    unit's approved model to a different unit's session. `buildBatchArgs`
//    now takes a single, whole-call `model` instead of a per-unit one; a wave
//    whose session-mode units genuinely disagree on model cannot be
//    represented by one `batch` call at all, so `startBatch` below REFUSES
//    (throws, before invoking the runner — nothing is ever started) rather
//    than pick one model and silently apply it to every unit. That matches
//    the documented workflow anyway: a QA unit is dispatched as its own,
//    later `aipe session dispatch` call after the dev's delivery exists
//    (skills/operate/SKILL.md), never in the same wave-call as the dev it
//    reviews, so a genuinely mixed-model `startBatch` call should not arise
//    in practice — and if it ever does, refusing loudly beats starting real
//    sessions under the wrong model.
//
// The prompt is handed over as `@<file>`. Inlining a 40-line brief into an
// argv string is a quoting bug waiting to happen, and it would leak the whole
// brief into every process listing.
export function buildBatchArgs(task: string, model: string | undefined, units: BatchUnit[]): string[] {
  const args = ["session", "batch", "--task", task];
  if (model) args.push("--model", model);
  args.push("--json");
  for (const unit of units) {
    args.push("--session", `${unit.harness}@${unit.cwd}: @${unit.promptFile}`);
  }
  return args;
}

// The one `model` value shared by every unit, or undefined when none of them
// asked for one. Throws when units disagree — see the `--model` note above:
// there is no way to send a single `batch` call that honors two different
// models for two different units in it.
function sharedModel(units: BatchUnit[]): string | undefined {
  const models = new Set(units.map((u) => u.model).filter((m): m is string => !!m));
  if (models.size > 1) {
    throw new Error(
      `agentop session batch cannot start a single wave whose units disagree on model (${[...models].join(", ")}) — ` +
        `--model applies to the whole batch call, not per session. Dispatch these units in separate waves.`,
    );
  }
  return models.size === 1 ? [...models][0] : undefined;
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
  const asObject = !parsedIsArray && parsed !== null && typeof parsed === "object" ? (parsed as any) : null;
  const parsedHasSessionsArray = asObject !== null && Array.isArray(asObject.sessions);
  // agentop 1.22.4 changed `session batch --json` from `[...]` /
  // `{"sessions":[...]}` to `{task, started, failed}` — `started` is the list
  // of sessions it launched, `failed` the units it could not start. The
  // sessions in `started` are ALREADY RUNNING when this parses; the old code's
  // "unrecognised shape" throw here stranded them outside the ledger (worse
  // than a parse error). `started` is treated exactly like the historical
  // `sessions` list — same per-entry validation below. `failed` needs no
  // handling here: a failed unit is simply absent from the session list, so
  // the caller's existing per-unit "no session for <fqid>" path reports it
  // (batch.ts never zips positionally — it pairs by cwd). A failed entry is a
  // legitimate outcome, NOT a malformed record, so it never touches the
  // `malformed` counter.
  const parsedHasStartedArray = asObject !== null && Array.isArray(asObject.started);
  if (!parsedIsArray && !parsedHasSessionsArray && !parsedHasStartedArray) {
    // Valid JSON, but a top-level shape we don't recognise (null, {}, an
    // error object, a bare number/string, ...) is the same ambiguity the
    // unparseable-JSON throw above exists to eliminate, one boundary later:
    // silently falling through to `list = []` would make it indistinguishable
    // from a genuinely empty, well-formed result ([], {"sessions":[]} or
    // {"started":[]}). A caller can't act on "malformed: N" here — there's no
    // list to have partially started sessions in, unlike the per-entry case
    // below — so this throws exactly like the unparseable-JSON path.
    throw new Error(
      `agentop session batch printed valid JSON with an unexpected shape (not an array, and no "sessions"/"started" array) on a successful exit: ${previewStdout(stdout)}`,
    );
  }
  const list = parsedIsArray ? parsed : parsedHasSessionsArray ? asObject.sessions : asObject.started;
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

// Builds the argv for `agentop session rename <id|name> "label"` — the ONLY
// route agentop offers to name a session started via `batch` (see the
// `--name` note above). Verified against the real agentop v1.18.2 binary:
// `agentop session rename` with no arguments prints
// `Usage: agentop session rename <id|name> "label"` on STDERR and exits 1;
// `agentop session rename <bogus-id> "x"` prints
// `No session matches "<bogus-id>". Run \`agentop session list\` to see
// them.`, also on stderr, also exit 1. Two bare positional arguments, no
// flags — `id` and `label` are each a single argv element handed straight to
// `Bun.spawn` (never through a shell), so a label containing spaces (e.g. a
// multi-word specialist name) needs no quoting here.
export function buildRenameArgs(id: string, label: string): string[] {
  return ["session", "rename", id, label];
}

export async function startBatch(
  task: string,
  units: BatchUnit[],
  runner: AgentopRunner,
): Promise<BatchParseResult> {
  // sharedModel throws BEFORE the runner is ever invoked when units disagree
  // — deliberately: unlike every other throw in this file (which happens
  // after agentop has already started real sessions, so the caller must
  // still recover whatever DID start), a model conflict is detectable from
  // the request alone. Refusing here means nothing is ever started under the
  // wrong model, so there is nothing to orphan.
  const model = sharedModel(units);
  const result = await runner(buildBatchArgs(task, model, units));
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
