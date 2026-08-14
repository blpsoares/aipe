// Cross-references the journey ledger against agentop's live session list. The
// ledger is the source of truth for "did the work land"; agentop is the source
// of truth for "is anyone still working". Only together do they distinguish a
// slow specialist from one that died without a word.
import { packageFqid } from "../context-brain/packages";
import { readLedger } from "../journey/ledger";
import type { JourneyLedger } from "../journey/types";
import type { AgentopRunner, UnitState } from "./types";

const LANDED_STATUSES = new Set(["delivered", "verified", "merged"]);

// How much of unparseable stdout to echo back in a thrown error. Mirrors
// `previewStdout` in batch.ts: long enough to recognise the shape of the
// problem, short enough not to dump a giant blob into logs.
const STDOUT_PREVIEW_LIMIT = 500;

function previewStdout(stdout: string): string {
  return stdout.length > STDOUT_PREVIEW_LIMIT
    ? `${stdout.slice(0, STDOUT_PREVIEW_LIMIT)}… (truncated, ${stdout.length} chars total)`
    : stdout;
}

export function parseSessionList(stdout: string): Set<string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    // Exit code 0 with unparseable stdout is a contract break, NOT "nobody is
    // running" — the same distinction `parseBatchOutput` draws in batch.ts.
    // An empty Set here would be indistinguishable from a genuinely empty
    // live list and would push every un-recorded unit straight to
    // dead-silent, which is the dangerous direction for a module whose whole
    // job is not to lose live work. Surface the break instead of guessing.
    throw new Error(
      `agentop session list printed unparseable JSON on a successful exit: ${previewStdout(stdout)}`,
    );
  }
  const list = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as any).sessions)
      ? (parsed as any).sessions
      : [];
  const ids = new Set<string>();
  for (const entry of list) {
    const id = entry && typeof entry === "object" ? (entry as Record<string, unknown>).id : null;
    // An entry with no usable id is dropped, not defaulted — the same rule
    // batch.ts applies to its own malformed entries. There is no companion
    // "malformed" count to return here (the interface is a bare
    // Set<string>), but dropping one unreadable entry is a narrow, per-entry
    // loss — unlike the unparseable-payload case above, it does not turn the
    // whole live list into an indistinguishable "everyone is dead".
    if (typeof id === "string") ids.add(id);
  }
  return ids;
}

export function classify(ledger: JourneyLedger, live: Set<string>): UnitState[] {
  const states: UnitState[] = [];
  for (const d of ledger.dispatches) {
    if (d.mode !== "session") continue;
    const phase = LANDED_STATUSES.has(d.status)
      ? "landed"
      : d.sessionId && live.has(d.sessionId)
        ? "running"
        : "dead-silent";
    states.push({
      fqid: packageFqid(d.repo, d.package),
      sessionId: d.sessionId ?? null,
      phase,
      branch: d.branch,
      worktree: d.worktree,
    });
  }
  return states;
}

// Every sessionId the ledger is still waiting on (i.e. every session-mode
// dispatch, landed or not — `classify` only consults `live` for units it
// hasn't already resolved from ledger status, so including landed ones here
// is harmless). Used as the fail-open live set when we cannot ask agentop.
function outstandingSessionIds(ledger: JourneyLedger): Set<string> {
  const ids = new Set<string>();
  for (const d of ledger.dispatches) {
    if (d.mode === "session" && d.sessionId) ids.add(d.sessionId);
  }
  return ids;
}

// A failed (or unparseable) `session list` call means we genuinely do not
// know who is still working — that is NOT the same fact as "nobody is
// working". Treating it as an empty live set would flip every in-flight,
// not-yet-recorded unit to dead-silent on a single hiccup (binary missing,
// daemon momentarily down between polls), and the coordinator's documented
// response to dead-silent is to inspect the branch and re-dispatch — exactly
// the wrong move against a specialist that is still running. So a failed
// check fails OPEN: fall back to "every session the ledger is still waiting
// on is presumed alive" rather than "none of them are". A poll loop (Task 12)
// keeps calling `pollOnce` until its own timeout, so a transient failure gets
// retried on the next tick instead of being taken as proof of death; a
// failure that never clears eventually surfaces as "still running past the
// timeout", which asks the PE to look rather than silently declaring
// everyone dead and inviting an automatic re-dispatch over live work.
function liveSessionIds(
  ledger: JourneyLedger,
  result: { code: number; stdout: string; stderr: string },
): Set<string> {
  if (result.code === 0) {
    try {
      return parseSessionList(result.stdout);
    } catch {
      // fall through to the fail-open fallback below
    }
  }
  return outstandingSessionIds(ledger);
}

export async function pollOnce(
  workspaceDir: string,
  journeyId: string,
  runner: AgentopRunner,
): Promise<UnitState[]> {
  const ledger = await readLedger(workspaceDir, journeyId);
  if (!ledger) return [];
  const result = await runner(["session", "list", "--json"]);
  return classify(ledger, liveSessionIds(ledger, result));
}
