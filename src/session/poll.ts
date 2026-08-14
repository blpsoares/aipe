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
  const parsedIsArray = Array.isArray(parsed);
  const parsedHasSessionsArray =
    !parsedIsArray && parsed !== null && typeof parsed === "object" && Array.isArray((parsed as any).sessions);
  if (!parsedIsArray && !parsedHasSessionsArray) {
    // Valid JSON, but a top-level shape we don't recognise (null, {}, an
    // error object, a bare number/string, a renamed field, ...) is the same
    // ambiguity the unparseable-JSON throw above exists to eliminate, one
    // boundary later: silently falling through to `list = []` would make it
    // indistinguishable from a genuinely empty, well-formed result ([] or
    // {"sessions":[]}), and pollOnce would trust that empty Set instead of
    // failing open — pushing every live, un-recorded unit straight to
    // dead-silent. Mirrors the same guard in parseBatchOutput (batch.ts).
    throw new Error(
      `agentop session list printed valid JSON with an unexpected shape (not an array, and no "sessions" array) on a successful exit: ${previewStdout(stdout)}`,
    );
  }
  const list = parsedIsArray ? parsed : (parsed as any).sessions;
  const ids = new Set<string>();
  for (const entry of list) {
    const id = entry && typeof entry === "object" ? (entry as Record<string, unknown>).id : undefined;
    // Unlike batch.ts, this parser has no "malformed" counter to report a
    // per-entry loss through — the interface is a bare Set<string>. Dropping
    // an entry with no usable id here would silently vanish a live session
    // from the returned set, and the caller has no signal that anything was
    // lost: the same "everyone is dead" ambiguity as the wrong-shape case
    // above, just one level deeper. So an unusable id throws instead of
    // being dropped, letting pollOnce's fail-open fallback take over.
    if (typeof id !== "string" || id === "") {
      throw new Error(
        `agentop session list entry has no usable id: ${previewStdout(JSON.stringify(entry))}`,
      );
    }
    ids.add(id);
  }
  return ids;
}

export function classify(ledger: JourneyLedger, live: Set<string>): UnitState[] {
  const states: UnitState[] = [];
  for (const d of ledger.dispatches) {
    if (d.mode !== "session") continue;
    // A session-mode dispatch recorded with no sessionId at all always falls
    // through to dead-silent here (the `d.sessionId &&` short-circuits
    // before `live` is even consulted). That is intentional, not an
    // oversight: nothing is running and nothing was recorded, so
    // inspect-and-re-dispatch is the right response either way.
    //
    // `redirected` is checked FIRST, ahead of both the landed and live-session
    // checks. A redirected unit's session can still be alive (the PE redirected
    // it via `agentop session attach`, it did not stop) — if the live check ran
    // first, that would read as ordinary `running` progress and hide the fact
    // that the approved spec no longer describes what is being built. Checking
    // `redirected` first makes that divergence loud regardless of whether the
    // session is still up or has since ended.
    const phase = d.status === "redirected"
      ? "redirected"
      : LANDED_STATUSES.has(d.status)
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
