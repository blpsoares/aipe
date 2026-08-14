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
// A bare `&` (backgrounding) splits too, but `&&` is checked first so it is
// never mistaken for two single `&`s.
function segments(command: string): string[] {
  return command.split(/&&|\|\||[;&|\n]/);
}

// Things that can legitimately precede a command without themselves being
// the command: shell keywords that open a new command context (`then`,
// `do`, ...), command-prefix builtins (`sudo`, `env`, `time`, ...), and
// leading env-var assignments (`FOO=1 ...`). Stripped repeatedly so chains
// like `sudo env FOO=1 agentop ...` reduce to the real invocation. Deliberately
// does NOT include `echo` or other ordinary commands — that asymmetry is what
// keeps `echo agentop session claude` from tripping the guard while
// `then agentop session claude` still does.
const LEADING_NOISE = /^(?:(?:then|do|else|elif|time|sudo|nohup|command|exec|env|!)\s+|\w+=\S*\s+)*/;

// Matches an *invocation* of `agentop session <verb>` at the start of what's
// left after stripping leading noise; this keeps `echo agentop session
// claude` from tripping it while still catching `then agentop session claude`.
const INVOCATION = /^(?:\S*\/)?agentop\s+session\s+(\S+)/;

export function decide(input: GuardInput): GuardDecision {
  if (input.role !== "specialist") return { action: "allow" };

  for (const segment of segments(input.command)) {
    const stripped = segment.trim().replace(LEADING_NOISE, "");
    const m = stripped.match(INVOCATION);
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
