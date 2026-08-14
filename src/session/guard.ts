// The single decision every harness's containment hook consults. Pure: no I/O,
// no env reads — the caller supplies the role, so this stays trivially testable.
//
// DELIBERATELY CONSERVATIVE. An earlier design tried to decide whether
// `agentop` sat in *command position*, so that `echo agentop session claude`
// could be waved through. Shell syntax defeated it repeatedly — brace groups,
// subshells, quoted env assignments, `$(...)`, `then`/`do` after `;` — and each
// hole silently disabled containment, one of them defeating the unconditional
// kill-deny. For a guard, a false positive is an annoyance and a false negative
// is the whole feature not existing. So: match the token sequence WHEREVER it
// appears, and accept that writing the string into an `echo` gets denied too.
// No shell parsing, no denylist of keywords, no arms race.

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

// Case-insensitive: `AGENTOP SESSION KILL` is exactly as dangerous as the
// lowercase form, and a case-sensitive match would silently defeat the
// kill-deny. The verb capture allows leading hyphens too, so a flag-shaped
// token (`--foo`) after `session` is captured rather than matching nothing —
// an unrecognised token must fall through to needs-grant, never allow.
//
// Known boundary (accepted, not fixed here): this can't see an invocation
// assembled from shell variables (`A=agentop; B=session; $A $B claude`), nor
// a renamed/copied binary (`/tmp/ao session claude`). Both require
// deliberately evading a known guard rather than drifting into it.
const INVOCATION = /agentop\s+session\s+([\w-]+)/gi;

export function decide(input: GuardInput): GuardDecision {
  if (input.role !== "specialist") return { action: "allow" };

  let sawSpawn = false;
  // Scan every occurrence: `kill` outranks a spawn appearing in the same
  // command, so a compound that does both is denied outright, not granted.
  for (const m of input.command.matchAll(INVOCATION)) {
    const verb = m[1]!.toLowerCase();
    if (verb === "kill") {
      return { action: "deny", reason: "a specialist must not kill sessions" };
    }
    if (READ_ONLY.has(verb)) continue;
    // Anything else under `session` creates one: a harness name, or `batch`.
    sawSpawn = true;
  }
  return sawSpawn
    ? { action: "needs-grant", reason: "specialist-session-spawn" }
    : { action: "allow" };
}
