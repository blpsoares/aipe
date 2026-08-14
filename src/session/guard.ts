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
//
// The verb is captured via a lookahead rather than consumed directly, so its
// characters remain in the string after the match. That alone is not enough:
// a regex-driven scan (`matchAll`, or manual `exec` that jumps `lastIndex` to
// the end of each match) still CONSUMES the rest of the matched text — the
// literal `agentop\s+session\s+` prefix — before looking for the next match.
// Any token that is itself part of that consumed prefix can then hide a real
// match starting inside it, because the scan already skipped past it. This
// has broken under a different hiding token each time it was patched
// narrowly, because a hiding token can be a repeat of EITHER prefix word.
// The general fix treats both halves of that risk the same way, not one
// token at a time:
//   1. `(?:session\s+)+` folds any number of repeated `session` tokens into
//      a single match, so a run like `session session session kill` is
//      consumed as one unit and the lookahead lands on the real next word
//      (`kill`) — a repeated LITERAL word inside the pattern can never hide
//      anything, because the pattern itself absorbs all of it.
//   2. That doesn't cover a token the pattern does NOT expect to repeat —
//      `agentop` itself, since one `agentop\s+...` match only ever consumes
//      one leading `agentop`. So after each match we also rewind `lastIndex`
//      to exactly one character past where the match STARTED (not where it
//      ended), making every scan step overlap the previous one. Nothing is
//      ever truly consumed from the scan's perspective; no arrangement of
//      `agentop`/`session`/verb tokens can put a real invocation in a
//      stretch of text the scan skips over.
const INVOCATION = /agentop\s+(?:session\s+)+(?=([\w-]+))/i;

export function decide(input: GuardInput): GuardDecision {
  const normalizedRole = input.role?.trim().toLowerCase();
  if (normalizedRole !== "specialist") return { action: "allow" };

  let sawSpawn = false;
  // Fresh RegExp per call (built from the shared pattern's source): `exec`
  // with the `g` flag mutates `lastIndex` on the instance it's called on, so
  // reusing a module-level global regex across calls would make `decide`
  // stateful and non-re-entrant. Constructing it here keeps `decide` pure.
  const re = new RegExp(INVOCATION.source, "gi");
  // Scan every occurrence: `kill` outranks a spawn appearing in the same
  // command, so a compound that does both is denied outright, not granted.
  let m: RegExpExecArray | null;
  while ((m = re.exec(input.command)) !== null) {
    const verb = m[1]!.toLowerCase();
    if (verb === "kill") {
      return { action: "deny", reason: "a specialist must not kill sessions" };
    }
    if (!READ_ONLY.has(verb)) {
      // Anything else under `session` creates one: a harness name, or `batch`.
      sawSpawn = true;
    }
    // Overlap, never consume: resume the scan just one character past where
    // THIS match started. Since `m.index` strictly increases with the input
    // length (there are finitely many start positions), this always makes
    // progress and the loop always terminates — including for a
    // theoretically zero-width match, which would otherwise loop forever if
    // `lastIndex` were left unchanged.
    re.lastIndex = m.index + 1;
  }
  return sawSpawn
    ? { action: "needs-grant", reason: "specialist-session-spawn" }
    : { action: "allow" };
}
