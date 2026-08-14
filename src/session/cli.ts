#!/usr/bin/env bun
// `aipe session <dispatch|collect|guard|doctor>`.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { packageFqid } from "../context-brain/packages";
import { readLedger, recordDispatch } from "../journey/ledger";
import { resolveAdapter } from "../harness/registry";
import { personaSlug } from "../hire-specialists/render";
import { startBatch, type BatchUnit } from "./batch";
import { composePrompt } from "./prompt";
import { probe, realRunner } from "./runner";
import type { AgentopRunner } from "./types";
import { decide } from "./guard";
import { consumeGrant } from "./grants";

function getFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const value = args[i + 1];
  if (value === undefined || value.startsWith("--")) return undefined;
  return value;
}

function denyJson(reason: string): string {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
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
  const resolved: { d: (typeof pending)[number]; fqid: string; personaBody: string }[] = [];
  for (const d of pending) {
    const fqid = packageFqid(d.repo, d.package);
    const target = adapter.personaTarget(personaSlug(d.specialist));
    try {
      const personaBody = await readFile(join(opts.workspace, d.repo, target.relDir, target.filename), "utf8");
      resolved.push({ d, fqid, personaBody });
    } catch {
      lines.push(`ERROR persona: could not read the persona for ${d.specialist}@${d.repo}`);
      return { code: 1, lines };
    }
  }

  await mkdir(promptsDir, { recursive: true });
  const units: BatchUnit[] = [];
  for (const { d, fqid, personaBody } of resolved) {
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
    units.push({ harness: "claude", cwd: d.worktree, promptFile, ...(d.model ? { model: d.model } : {}) });
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
      const recordCmd = [
        "aipe journey record",
        `--journey ${opts.journeyId}`,
        `--workspace ${opts.workspace}`,
        `--repo ${d.repo}`,
        ...(d.package ? [`--package ${d.package}`] : []),
        `--specialist ${d.specialist}`,
        `--branch ${d.branch}`,
        `--worktree ${d.worktree}`,
        "--mode session",
        `--session-id ${session.id}`,
      ].join(" ");
      lines.push(
        `ERROR ledger: session ${session.id} for ${fqid} is running but could not be recorded (${err instanceof Error ? err.message : String(err)}) — record it manually: ${recordCmd}`,
      );
    }
  }
  if (started.length !== pending.length) {
    lines.push(`ERROR session: asked agentop for ${pending.length} sessions, it started ${started.length}`);
  }

  const code = lines.some((l) => l.startsWith("ERROR")) ? 1 : 0;
  return { code, lines };
}

const HELP = [
  "aipe session — dispatch specialists as real agentop sessions",
  "",
  "  dispatch --journey <id> [--workspace <dir>]   Start the wave's session-mode units",
  "  collect  --journey <id> [--timeout <s>] [--workspace <dir>]",
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
