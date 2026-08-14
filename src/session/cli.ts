#!/usr/bin/env bun
// `aipe session <dispatch|collect|guard|doctor>`.
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
    default:
      console.log(HELP);
      return sub === undefined || sub === "--help" ? 0 : 1;
  }
}

if (import.meta.main) {
  run(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      console.log(`ERROR ${err}`);
      process.exit(1);
    });
}
