// The single decision every harness's containment hook consults. Pure: no I/O,
// no env reads — the caller supplies the role, so this stays trivially testable.

export interface GuardInput {
  command: string;
  role: string | undefined; // AIPE_ROLE
}

export type GuardDecision =
  | { action: "allow" }
  | { action: "deny"; reason: string }
  | { action: "needs-grant"; reason: string };

// Sub-commands of `agentop session` that a specialist may run freely: they read
// or annotate, they never create or destroy.
const READ_ONLY = new Set(["list", "attach", "note", "rename"]);

// Split on shell separators so `git status && agentop session claude` is seen.
function segments(command: string): string[] {
  return command.split(/&&|\|\||[;|\n]/);
}

// Matches an *invocation* of `agentop session <verb>`; the leading anchor keeps
// `echo agentop session claude` from tripping it.
const INVOCATION = /^(?:\S*\/)?agentop\s+session\s+(\S+)/;

export function decide(input: GuardInput): GuardDecision {
  if (input.role !== "specialist") return { action: "allow" };

  for (const segment of segments(input.command)) {
    const m = segment.trim().match(INVOCATION);
    if (!m) continue;
    const verb = m[1]!;
    if (verb === "kill") {
      return { action: "deny", reason: "a specialist must not kill sessions" };
    }
    if (READ_ONLY.has(verb)) continue;
    // Anything else under `session` creates one: a harness name, or `batch`.
    return { action: "needs-grant", reason: "specialist-session-spawn" };
  }
  return { action: "allow" };
}
