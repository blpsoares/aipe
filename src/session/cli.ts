#!/usr/bin/env bun
// `aipe session <dispatch|collect|guard|doctor>`.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { packageFqid } from "../context-brain/packages";
import { readLedger, recordDispatch } from "../journey/ledger";
import type { JourneyDispatch } from "../journey/types";
import { getAdapter, resolveAdapter } from "../harness/registry";
import { personaSlug } from "../hire-specialists/render";
import { startBatch, type BatchUnit } from "./batch";
import { composePrompt } from "./prompt";
import { classify, pollOnce } from "./poll";
import { probe, realRunner } from "./runner";
import type { AgentopRunner, UnitState } from "./types";
import { decide } from "./guard";
import { consumeGrant, issueGrant } from "./grants";

function getFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const value = args[i + 1];
  if (value === undefined || value.startsWith("--")) return undefined;
  return value;
}

function denyJson(reason: string): string {
  return JSON.stringify({
    // Claude Code AND Codex both read hookSpecificOutput.permissionDecision,
    // and both document its accepted deny value as exactly "deny" (Claude
    // Code: docs.claude.com/en/docs/claude-code/hooks; Codex, matching it
    // verbatim: learn.chatgpt.com/docs/hooks — "hookSpecificOutput": {
    // "hookEventName": "PreToolUse", "permissionDecision": "deny"|"allow",
    // "permissionDecisionReason": "…" }", see src/harness/codex.ts's header).
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
    // The top-level `decision`/`reason` pair is read by TWO harnesses, each
    // for a different reason, and both document "block" (not "deny") as an
    // accepted value for it — confirmed 2026-08-14, live:
    //  - Gemini CLI's BeforeTool hook reads this pair and NEVER
    //    hookSpecificOutput.permissionDecision — that key appears zero times
    //    in Gemini's hooks docs (geminicli.com/docs/hooks/reference/), whose
    //    own text is: `"decision": Set to "deny" (or "block") to prevent the
    //    tool from executing.` — "deny" and "block" are documented as
    //    equivalent, so "block" satisfies Gemini exactly as "deny" would.
    //    `aipe session guard` always exits 0 (see below), and Gemini's docs
    //    say exit-code-0 + JSON `decision` is "preferred for all logic" — so
    //    without this field a Gemini BeforeTool hook pointed at this command
    //    would parse the JSON fine (satisfying "stdout must be JSON-only")
    //    but find no recognized decision and fail OPEN: a hook that looks
    //    installed and denies nothing. See src/harness/gemini.ts's header
    //    comment for the full citation.
    //  - Codex's hooks docs (learn.chatgpt.com/docs/hooks) separately
    //    document a LEGACY top-level shape it also still accepts, verbatim:
    //    `{ "decision": "block", "reason": "Destructive command blocked by
    //    hook." }` — value "block", not "deny". Codex is inert today
    //    (codexAdapter.containmentHook() returns null — see
    //    src/harness/codex.ts — nothing dispatches to it yet), but this
    //    field must not ship a value ("deny") that Codex's own docs never
    //    list for its legacy shape, on the chance Codex containment is
    //    revisited later. Using "block" satisfies both readers of this key
    //    with one literal value, each per its own docs, rather than a value
    //    chosen for one and merely hoped to be harmless for the other.
    // Precedence between hookSpecificOutput and this top-level pair, when
    // both are present in one payload, is NOT documented by either harness —
    // untested here because nothing containable currently reads both keys
    // from the same payload (Claude Code/Codex read only
    // hookSpecificOutput; Gemini reads only the top-level pair).
    decision: "block",
    reason,
  });
}

// Reads the command out of any of the four harnesses' hook payload shapes.
function readCommand(payload: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const r = parsed as Record<string, any>;
  const input = r.tool_input ?? r.toolInput ?? r.input;
  const command = input?.command;
  return typeof command === "string" ? command : null;
}

// consumeGrant() throws on an unsafe journey/session id (empty, ".", "..", or
// containing a path separator) and rethrows any non-ENOENT filesystem error.
// Both env vars come straight from the hook payload's environment, so a throw
// here must never escape guardCommand: an environment variable can hold
// anything, and letting the throw propagate would crash the hook and, per
// harness, either block every command or fail open — neither acceptable. A
// grant that cannot be verified has not been granted, so this becomes a deny.
async function tryConsumeGrant(
  workspace: string,
  journey: string,
  sessionId: string,
): Promise<boolean> {
  try {
    return await consumeGrant(workspace, journey, sessionId);
  } catch {
    return false;
  }
}

export async function guardCommand(
  payload: string,
  env: Record<string, string | undefined>,
): Promise<{ code: number; stdout: string }> {
  const command = readCommand(payload);
  // Fail open: a guard that cannot read the payload must not block real work.
  // Containment is a guardrail against drift, and a guardrail that breaks the
  // agent is worse than the drift it prevents.
  if (command === null) return { code: 0, stdout: "" };

  const decision = decide({ command, role: env.AIPE_ROLE });
  if (decision.action === "allow") return { code: 0, stdout: "" };
  if (decision.action === "deny") return { code: 0, stdout: denyJson(decision.reason) };

  const workspace = env.AIPE_WORKSPACE;
  const journey = env.AIPE_JOURNEY;
  const sessionId = env.AGENTOP_SESSION_ID;
  if (
    workspace &&
    journey &&
    sessionId &&
    (await tryConsumeGrant(workspace, journey, sessionId))
  ) {
    return { code: 0, stdout: "" };
  }
  return {
    code: 0,
    stdout: denyJson(
      "Opening agentop sessions is not permitted for a specialist. Ask the coordinator for a grant if a sub-session is genuinely required.",
    ),
  };
}

async function guard(): Promise<number> {
  const payload = await new Response(Bun.stdin.stream()).text();
  const { code, stdout } = await guardCommand(payload, process.env);
  if (stdout) console.log(stdout);
  return code;
}

export interface DispatchOptions {
  workspace: string;
  journeyId: string;
  runner: AgentopRunner;
}

// Pulls this unit's section out of the approved Orientation Spec. Falls back to
// the whole document rather than to nothing: a brief that is too broad is
// recoverable, an empty one silently produces a drifting specialist.
function specSlice(orientation: string, fqid: string): string {
  const lines = orientation.split("\n");
  const start = lines.findIndex((l) => /^#{1,3}\s/.test(l) && l.includes(fqid));
  if (start < 0) return orientation;
  const end = lines.findIndex((l, i) => i > start && /^#{1,3}\s/.test(l));
  return lines.slice(start, end < 0 ? undefined : end).join("\n");
}

// Wraps a value in POSIX single quotes so it survives shell re-parsing intact
// — spaces, double quotes, `$`, backticks, everything except the single quote
// itself, which single quotes cannot represent and must therefore end the
// quoted segment, escape one literal `'`, and reopen it: `'\''`. This is the
// standard POSIX-safe quoting idiom, not a partial hand-rolled escaper.
function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

// Builds the `aipe journey record` command printed as the operator's recovery
// path when a ledger write fails for a session that is already running (see
// the ERROR ledger: branch below). `recordDispatch` does a full REPLACE of the
// matching entry, not a merge, so this command must forward every field that
// is actually present on the record being recovered — a flag silently
// omitted here means that field gets wiped the moment the printed command is
// run verbatim. Flag names are taken from `recordCommand` in
// src/journey/cli.ts, not guessed.
//
// FIELD_FLAGS is typed via `satisfies Record<..., string>` over
// `keyof JourneyDispatch` minus the four fields handled outside this table
// (`evidence`, `sessionId`, `redispatchReason`, `redirectReason` — see
// below), rather than as an array of `{ field, flag }` pairs. An array only
// constrains listed fields to be valid keys; it does not require every key to
// be listed, so a field added to JourneyDispatch later would compile cleanly
// while silently being dropped here — the original bug. The `Record` shape
// makes every key mandatory: a new JourneyDispatch field fails
// `bunx tsc --noEmit` until someone adds it here (mapped to a flag) or to the
// `Exclude` list (deliberately excluded).
//
// `redispatchReason` cannot currently be forwarded through `recordCommand` at
// all, even via `--reason`. `recordDispatchGuarded` (src/journey/ledger.ts)
// only turns `--reason` into a written `redispatchReason` when it detects a
// reopening transition: the ledger's CURRENT status for the unit is
// delivered/verified and the incoming write's status is `dispatched`. Here
// the record being recovered is already sitting at `dispatched` in the ledger
// — only its `sessionId` write failed, its status never changed — so from the
// guard's point of view this is a no-op transition, not a reopening, and
// `--reason` would be silently ignored. So the field is excluded here too,
// but a unit still `dispatched` CAN legitimately carry a non-empty
// `redispatchReason` from an earlier genuine reopening (the lifecycle in
// src/journey/types.ts is delivered → failed → (re)dispatched, landing back
// on `dispatched` with `redispatchReason` set) — so when that is the case, an
// explicit WARN line is printed alongside the recovery command (see
// dispatchCommand below) rather than silently letting it be lost.
//
// `redirectReason` is excluded for the identical reason: the guard only turns
// `--reason` into a written `redirectReason` when the incoming write's status
// is `redirected` (src/journey/ledger.ts), and the record being recovered
// here is always sitting at `dispatched` — its session write failed, its
// status never changed. A unit sitting at `dispatched` could still carry a
// leftover `redirectReason` from an earlier genuine redirect that was later
// reconciled and re-dispatched, so the same explicit WARN line covers it too.
const FIELD_FLAGS = {
  repo: "--repo",
  package: "--package",
  specialist: "--specialist",
  branch: "--branch",
  worktree: "--worktree",
  pr: "--pr",
  status: "--status",
  tier: "--tier",
  model: "--model",
  mode: "--mode",
  intensity: "--intensity",
  harness: "--harness",
} satisfies Record<Exclude<keyof JourneyDispatch, "evidence" | "sessionId" | "redispatchReason" | "redirectReason">, string>;

function recoveryRecordCommand(journeyId: string, workspace: string, dispatch: JourneyDispatch, sessionId: string): string {
  const parts = ["aipe journey record", `--journey ${shQuote(journeyId)}`, `--workspace ${shQuote(workspace)}`];
  for (const field of Object.keys(FIELD_FLAGS) as (keyof typeof FIELD_FLAGS)[]) {
    const value = dispatch[field];
    if (value !== undefined) parts.push(`${FIELD_FLAGS[field]} ${shQuote(value)}`);
  }
  parts.push(`--session-id ${shQuote(sessionId)}`);
  if (dispatch.evidence) {
    const ev = dispatch.evidence;
    parts.push(`--evidence-by ${shQuote(ev.by)}`);
    parts.push(`--evidence-summary ${shQuote(ev.summary)}`);
    for (const cmd of ev.commands) parts.push(`--evidence-cmd ${shQuote(cmd)}`);
    if (ev.artifact !== undefined) parts.push(`--evidence-artifact ${shQuote(ev.artifact)}`);
  }
  return parts.join(" ");
}

export async function dispatchCommand(
  opts: DispatchOptions,
): Promise<{ code: number; lines: string[] }> {
  const lines: string[] = [];
  const probed = await probe(opts.runner);
  if (!probed.ok) {
    lines.push(`ERROR agentop: ${probed.reason ?? "unavailable"} — install or upgrade agentop, or dispatch in subagent mode`);
    return { code: 1, lines };
  }

  const ledger = await readLedger(opts.workspace, opts.journeyId);
  if (!ledger) {
    lines.push(`ERROR journey: no ledger for ${opts.journeyId}`);
    return { code: 1, lines };
  }

  const pending = ledger.dispatches.filter(
    (d) => d.mode === "session" && d.status === "dispatched" && !d.sessionId,
  );
  if (pending.length === 0) {
    lines.push("OK nothing to dispatch");
    return { code: 0, lines };
  }

  const journeyDir = join(opts.workspace, ".aipe", "journeys", opts.journeyId);
  const promptsDir = join(journeyDir, "prompts");

  let orientation = "";
  try {
    orientation = await readFile(join(journeyDir, "orientation.md"), "utf8");
  } catch {
    lines.push("ERROR spec: orientation.md not found — write and approve the Orientation Spec first");
    return { code: 1, lines };
  }
  // An orientation.md that exists but is blank is the same class of problem as
  // a missing one: specSlice's whole-document fallback only recovers a brief
  // that is too broad, not one that is empty. Catch it here, before any prompt
  // file is written, rather than silently handing every specialist "".
  if (orientation.trim() === "") {
    lines.push("ERROR spec: orientation.md is empty — write and approve the Orientation Spec first");
    return { code: 1, lines };
  }

  const adapter = await resolveAdapter(opts.workspace);

  // Pass 1: resolve every unit's persona body before writing anything. A
  // prompt file is the audit trail of what a specialist was told, so a
  // dispatch that fails partway (persona missing for unit 2 of 3, say) must
  // not leave unit 1's prompt file behind, orphaned, implying a dispatch that
  // never happened. Validate everything first; write only once all reads land.
  const resolved: { d: (typeof pending)[number]; fqid: string; personaBody: string; agentopHarness: string }[] = [];
  for (const d of pending) {
    const fqid = packageFqid(d.repo, d.package);

    // Two namespaces: `d.harness` is the AIPe adapter id the PE approved for
    // this unit ("claude-code", "codex", …) — NOT the name agentop itself
    // uses for that harness ("claude", "codex", …). Resolving it from the
    // UNIT's own recorded harness (never a literal, never the workspace's
    // default adapter) is exactly what keeps a unit approved for one harness
    // from silently starting a session on another. `getAdapter` falls back
    // to the default (claude-code) for an absent/legacy `d.harness`, same as
    // every other reader of this field.
    const unitAdapter = getAdapter(d.harness);
    const agentopHarness = unitAdapter.agentopHarness;
    // null means agentop has no equivalent for this harness — not
    // session-dispatchable, for the same reason a non-containable harness
    // isn't (see isContainable). This should already have been caught by
    // `aipe dispatch validate` before the unit ever reached the ledger, but
    // dispatchCommand does not re-run that law here — so it must refuse
    // explicitly rather than let a `null` reach the argv as a literal
    // "null" harness (or worse, silently coerce to something else).
    if (agentopHarness === null) {
      lines.push(`ERROR harness: ${unitAdapter.id} has no agentop equivalent — not session-dispatchable`);
      return { code: 1, lines };
    }

    const target = adapter.personaTarget(personaSlug(d.specialist));
    try {
      const personaBody = await readFile(join(opts.workspace, d.repo, target.relDir, target.filename), "utf8");
      resolved.push({ d, fqid, personaBody, agentopHarness });
    } catch {
      lines.push(`ERROR persona: could not read the persona for ${d.specialist}@${d.repo}`);
      return { code: 1, lines };
    }
  }

  await mkdir(promptsDir, { recursive: true });
  const units: BatchUnit[] = [];
  for (const { d, fqid, personaBody, agentopHarness } of resolved) {
    const prompt = composePrompt({
      personaBody,
      specSlice: specSlice(orientation, fqid),
      worktree: d.worktree,
      packagePath: d.package ?? null,
      branch: d.branch,
      repo: d.repo,
      journeyId: opts.journeyId,
      workspace: opts.workspace,
      fqid,
      intensity: d.intensity === "ultracode" ? "ultracode" : "normal",
    });

    const promptFile = join(promptsDir, `${fqid.replace(/\//g, "--")}.md`);
    await writeFile(promptFile, prompt, "utf8");
    units.push({
      harness: agentopHarness,
      cwd: d.worktree,
      promptFile,
      name: `${fqid}/${personaSlug(d.specialist)}`,
      ...(d.model ? { model: d.model } : {}),
    });
  }

  let result;
  try {
    result = await startBatch(`aipe/${opts.journeyId}`, units, opts.runner);
  } catch (err) {
    lines.push(`ERROR agentop: ${err instanceof Error ? err.message : String(err)}`);
    return { code: 1, lines };
  }
  const started = result.sessions;
  // `malformed` counts entries agentop returned that could not be used. It is
  // NOT an error to abort on — the sessions it did start are already running,
  // and throwing here would orphan them. Report it so the shortfall is visible.
  if (result.malformed > 0) {
    lines.push(`ERROR session: agentop returned ${result.malformed} unusable session record(s)`);
  }

  // Pair by cwd, NOT by position. `parseBatchOutput` returns agentop's list
  // as-is: nothing guarantees it comes back in the order the --session flags
  // went out, or that it is the same length. Zipping by index would write a
  // session id onto the wrong unit, and `collect` would then report the wrong
  // unit dead. Each unit's worktree is unique within a wave, so cwd is a key.
  const byCwd = new Map(started.map((s) => [s.cwd, s]));
  for (const d of pending) {
    const fqid = packageFqid(d.repo, d.package);
    const session = byCwd.get(d.worktree);
    if (!session) {
      lines.push(`ERROR session: agentop reported no session for ${fqid} (${d.worktree})`);
      continue;
    }
    // The session is already running (agentop started it as part of the
    // batch) by the time we try to record it. If the ledger write throws
    // here — disk full, a concurrent writer, whatever — that must not abort
    // the loop: the remaining units' sessions are ALSO already running and
    // still need their ids recorded, or they become invisible to `collect`
    // (a dead-silent false report) despite being alive. Report and continue.
    try {
      await recordDispatch(opts.workspace, opts.journeyId, { ...d, sessionId: session.id });
      lines.push(`OK ${fqid} → ${session.id}`);
    } catch (err) {
      const recordCmd = recoveryRecordCommand(opts.journeyId, opts.workspace, d, session.id);
      lines.push(
        `ERROR ledger: session ${session.id} for ${fqid} is running but could not be recorded (${err instanceof Error ? err.message : String(err)}) — record it manually: ${recordCmd}`,
      );
      // recoveryRecordCommand cannot represent redispatchReason or
      // redirectReason (see the comment on FIELD_FLAGS) — if this unit
      // actually carries either, running the command above verbatim would
      // silently lose it. Say so.
      if (d.redispatchReason) {
        lines.push(
          `WARN ledger: ${fqid}'s redispatchReason (${JSON.stringify(d.redispatchReason)}) cannot be represented by the recovery command above and will be lost if it is run verbatim — restore it manually`,
        );
      }
      if (d.redirectReason) {
        lines.push(
          `WARN ledger: ${fqid}'s redirectReason (${JSON.stringify(d.redirectReason)}) cannot be represented by the recovery command above and will be lost if it is run verbatim — restore it manually`,
        );
      }
    }
  }
  if (started.length !== pending.length) {
    lines.push(`ERROR session: asked agentop for ${pending.length} sessions, it started ${started.length}`);
  }

  const code = lines.some((l) => l.startsWith("ERROR")) ? 1 : 0;
  return { code, lines };
}

export interface CollectOptions {
  workspace: string;
  journeyId: string;
  runner: AgentopRunner;
  timeoutMs: number;
  intervalMs: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

// The coordinator's active wait on a dispatched session-mode wave: poll the
// ledger cross-referenced against `agentop session list` (pollOnce, poll.ts)
// until every unit has landed or the deadline passes, then report what was
// seen. Never kills anything and never re-dispatches on its own — a
// dead-silent or still-running unit is reported for the PE to look at.
//
// pollOnce fails OPEN by design: when `agentop session list` cannot be read
// or trusted, it presumes every sessionId the ledger is still waiting on is
// alive rather than declaring the wave dead. This loop inherits that, and
// extends it one layer further: pollOnce can also THROW outright (the
// runner itself rejecting — agentop missing entirely, a spawn failure — not
// just returning untrustworthy stdout, which pollOnce already absorbs
// internally). A bare catch that fell back to an empty state list would be
// "vacuously landed" (`[].every(...)` is `true` for any predicate on an
// empty array), turning an infrastructure hiccup into a false all-clear. So
// a thrown pollOnce falls back to the same fail-open classification pollOnce
// itself uses on a failed/untrustworthy `session list` call: every
// session-mode unit that has a recorded sessionId is presumed still
// running; only a unit with no sessionId at all — genuinely never
// dispatched — is dead-silent. That fallback is recomputed from the same
// ledger snapshot read once at the top, not re-read per throw: good enough
// for a path that only exists to avoid mislabeling live work as dead.
export async function collectCommand(
  opts: CollectOptions,
): Promise<{ code: number; lines: string[]; states: UnitState[] }> {
  if (!Number.isFinite(opts.timeoutMs) || opts.timeoutMs <= 0) {
    return {
      code: 1,
      lines: [`ERROR timeout: --timeout must be a positive number, got ${opts.timeoutMs}`],
      states: [],
    };
  }

  const ledger = await readLedger(opts.workspace, opts.journeyId);
  if (!ledger) {
    return { code: 1, lines: [`ERROR journey: no ledger for ${opts.journeyId}`], states: [] };
  }
  const sessionUnits = ledger.dispatches.filter((d) => d.mode === "session");
  if (sessionUnits.length === 0) {
    return {
      code: 1,
      lines: [`ERROR journey: ${opts.journeyId} has no session-mode units to collect`],
      states: [],
    };
  }

  const now = opts.now ?? (() => Date.now());
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const deadline = now() + opts.timeoutMs;

  const outstanding = new Set<string>();
  for (const d of sessionUnits) if (d.sessionId) outstanding.add(d.sessionId);
  const fallback = () => classify(ledger, outstanding);

  let states: UnitState[] = fallback();
  for (;;) {
    try {
      states = await pollOnce(opts.workspace, opts.journeyId, opts.runner);
    } catch {
      states = fallback();
    }
    const settled = states.every((s) => s.phase !== "running");
    if (settled || now() >= deadline) break;
    await sleep(opts.intervalMs);
  }

  const lines: string[] = [];
  for (const s of states) {
    // Exhaustive switch, not if/else-if/else: `UnitPhase` has four members
    // (`redirected` added alongside session naming, for a unit whose
    // direction the human changed mid-flight). An if/else chain would let an
    // unhandled phase fall silently into the DEAD-SILENT branch, and the
    // coordinator would re-dispatch work that was deliberately redirected.
    // The `default` branch below assigns to a `never`-typed variable so an
    // unhandled UnitPhase member fails `bunx tsc --noEmit` instead of
    // compiling clean.
    switch (s.phase) {
      case "redirected":
        // The reason is what the coordinator actually needs to act on next —
        // reconcile the Orientation Spec against it — so it is surfaced right
        // here instead of sending the coordinator to open the ledger file.
        // JSON-quoted so an awkward reason (quotes, apostrophes, embedded
        // newlines) stays on this one line instead of corrupting it; `null`
        // (never a blank string) marks a legacy record written before the
        // reason was required.
        lines.push(
          `REDIRECTED ${s.fqid} session ${s.sessionId} reason=${JSON.stringify(s.reason)} — the PE changed this unit's direction live. Fold the change into the Orientation Spec (bump its version) or escalate. A redirected unit MUST NOT pass the QA gate against an unreconciled spec`,
        );
        break;
      case "landed":
        lines.push(`LANDED ${s.fqid}`);
        break;
      case "running":
        lines.push(
          `RUNNING ${s.fqid} session ${s.sessionId} — still working past the timeout; the PE decides whether to wait or kill it`,
        );
        break;
      case "dead-silent":
        lines.push(
          `DEAD-SILENT ${s.fqid} branch ${s.branch} worktree ${s.worktree} — the session ended without recording. Inspect the branch read-only (git log) and re-dispatch it to CONTINUE from what is there, or escalate: never re-dispatch blind`,
        );
        break;
      default: {
        const unhandled: never = s.phase;
        throw new Error(`collectCommand: unhandled UnitPhase ${unhandled}`);
      }
    }
  }
  const clean = states.every((s) => s.phase === "landed");
  return { code: clean ? 0 : 2, lines, states };
}

export interface GrantOptions {
  workspace: string;
  journeyId: string;
  sessionId: string;
  count: number;
}

// Issues a quota of session spawns for one (journey, session) pair — the
// production call site `issueGrant` never had before this command existed.
// `count` must already be a parsed number by the time it reaches here (`run`
// hands it `Number(getFlag(...))`, so a missing or non-numeric `--count`
// arrives as `NaN`). NaN, 0 and negative values are all rejected right here
// rather than forwarded to `issueGrant`: a grant of 0 would create the grant
// directory with zero tokens, which prints exactly like a successful grant
// (`OK`, exit 0) while authorizing nothing — the "looks granted, isn't"
// mistake this whole feature exists to prevent, just on the write side
// instead of the read side.
export async function grantCommand(
  opts: GrantOptions,
): Promise<{ code: number; lines: string[] }> {
  if (!Number.isFinite(opts.count) || opts.count <= 0) {
    return {
      code: 1,
      lines: [`ERROR count: --count must be a positive number, got ${opts.count}`],
    };
  }
  // issueGrant() throws when a grant already exists for this (journey,
  // session) pair — deliberately (see grants.ts): silently widening an
  // existing quota is the exact bug class this feature exists to prevent
  // (a specialist's already-spent tokens would appear restored), and
  // replacing the grant instead would hand back units already spent. Surface
  // the throw as an ERROR line and a non-zero exit; never swallow it into a
  // silent OK.
  try {
    await issueGrant(opts.workspace, opts.journeyId, opts.sessionId, opts.count);
  } catch (err) {
    return {
      code: 1,
      lines: [`ERROR grant: ${err instanceof Error ? err.message : String(err)}`],
    };
  }
  return {
    code: 0,
    lines: [`OK grant journey=${opts.journeyId} session=${opts.sessionId} count=${opts.count}`],
  };
}

const HELP = [
  "aipe session — dispatch specialists as real agentop sessions",
  "",
  "  dispatch --journey <id> [--workspace <dir>]   Start the wave's session-mode units",
  "  collect  --journey <id> [--timeout <s>] [--workspace <dir>]",
  "  grant    --journey <id> --session-id <id> --count <n> [--workspace <dir>]",
  "                                                 Issue a quota of session spawns to a specialist",
  "  doctor                                        Report agentop availability",
  "  guard                                         (internal) containment hook decision",
].join("\n");

export async function run(args: string[]): Promise<number> {
  const [sub, ...rest] = args;
  switch (sub) {
    case "guard":
      return guard();
    case "dispatch": {
      const workspace = getFlag(rest, "--workspace") ?? process.cwd();
      const journeyId = getFlag(rest, "--journey");
      if (!journeyId) {
        console.log("ERROR journey: --journey <id> is required");
        return 1;
      }
      const { code, lines } = await dispatchCommand({ workspace, journeyId, runner: realRunner });
      for (const line of lines) console.log(line);
      return code;
    }
    case "collect": {
      const workspace = getFlag(rest, "--workspace") ?? process.cwd();
      const journeyId = getFlag(rest, "--journey");
      if (!journeyId) {
        console.log("ERROR journey: --journey <id> is required");
        return 1;
      }
      const timeoutS = Number(getFlag(rest, "--timeout") ?? "1800");
      const { code, lines } = await collectCommand({
        workspace, journeyId, runner: realRunner,
        timeoutMs: timeoutS * 1000, intervalMs: 15_000,
      });
      for (const line of lines) console.log(line);
      return code;
    }
    case "grant": {
      const workspace = getFlag(rest, "--workspace") ?? process.cwd();
      const journeyId = getFlag(rest, "--journey");
      if (!journeyId) {
        console.log("ERROR journey: --journey <id> is required");
        return 1;
      }
      const sessionId = getFlag(rest, "--session-id");
      if (!sessionId) {
        console.log("ERROR session-id: --session-id <id> is required");
        return 1;
      }
      const countFlag = getFlag(rest, "--count");
      if (!countFlag) {
        console.log("ERROR count: --count <n> is required");
        return 1;
      }
      const { code, lines } = await grantCommand({
        workspace, journeyId, sessionId, count: Number(countFlag),
      });
      for (const line of lines) console.log(line);
      return code;
    }
    case "doctor": {
      const probed = await probe(realRunner);
      if (probed.ok) {
        console.log(`OK agentop ${probed.version}`);
        return 0;
      }
      console.log(`ERROR agentop: ${probed.reason ?? "unavailable"}`);
      console.log("Session-mode dispatch needs agentop >= 1.9.0 (agentistics).");
      console.log("It is NOT the npm package named `agentop` — that is an unrelated project.");
      console.log("Install it, then re-run `aipe session doctor`. Subagent-mode dispatch works without it.");
      return 1;
    }
    default:
      console.log(HELP);
      return sub === undefined || sub === "--help" ? 0 : 1;
  }
}

if (import.meta.main) {
  run(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(`ERROR ${err}`);
      process.exit(1);
    });
}
