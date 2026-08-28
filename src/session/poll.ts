// Cross-references the journey ledger against agentop's live session list. The
// ledger is the source of truth for "did the work land"; agentop is the source
// of truth for "is anyone still working". Only together do they distinguish a
// slow specialist from one that died without a word.
import { packageFqid } from "../context-brain/packages";
import { readLedger } from "../journey/ledger";
import type { JourneyDispatch, JourneyLedger } from "../journey/types";
import type { AgentopRunner, UnitPhase, UnitState } from "./types";

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

// The single honest liveness decision for ONE session-mode dispatch, shared by
// `classify` (the poll loop) and `aipe status` so both report a session's state
// by exactly the same rules — item (5): the report must never claim a liveness it
// cannot stand behind. Ledger-recorded states are decided from the ledger alone,
// ahead of any liveness check, and take precedence over it:
//   • `redirected` — the session may still be alive (the PE redirected it via
//     attach, it did not stop); reading it as `running` would hide that the
//     approved spec no longer describes what is being built.
//   • `blocked` — the specialist declared itself stuck; it is waiting on the
//     coordinator whether or not its session is still up.
// A session-mode dispatch with no sessionId at all is `dead-silent` regardless of
// `reliable`: there is no session for liveness to describe — it never launched
// (or its launch was never recorded) and nothing landed, so inspect-and-re-
// dispatch is the response either way. When `reliable` is false (the live list
// was unreadable, or agentop is absent) an in-flight unit degrades to `unknown`
// rather than being guessed `running` (a liveness we cannot verify) or flipped to
// `dead-silent` (the dangerous direction). agentop's `activity` field is
// deliberately NOT consulted: it reported `waiting` for a session mid-tool-call,
// so it is not a trustworthy ground truth for working-vs-idle.
export function dispatchPhase(d: JourneyDispatch, live: Set<string>, reliable: boolean): UnitPhase {
  if (d.status === "redirected") return "redirected";
  if (d.status === "blocked") return "waiting";
  if (LANDED_STATUSES.has(d.status)) return "landed";
  if (!d.sessionId) return "dead-silent";
  if (!reliable) return "unknown";
  return live.has(d.sessionId) ? "running" : "dead-silent";
}

// `reliable` defaults to `true` so the pure callers/tests that hand a known set
// need not thread the flag.
export function classify(ledger: JourneyLedger, live: Set<string>, reliable = true): UnitState[] {
  const states: UnitState[] = [];
  for (const d of ledger.dispatches) {
    if (d.mode !== "session") continue;
    const phase = dispatchPhase(d, live, reliable);

    states.push({
      fqid: packageFqid(d.repo, d.package),
      sessionId: d.sessionId ?? null,
      phase,
      branch: d.branch,
      worktree: d.worktree,
      reason:
        phase === "redirected"
          ? d.redirectReason ?? null
          : phase === "waiting"
            ? d.blockedReason ?? null
            : null,
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

// A failed (or unparseable) `session list` call means we genuinely do not know
// who is still working — that is NOT the same fact as "nobody is working", and
// it is NOT the same fact as "everyone is working" either. Treating it as an
// empty live set would flip every in-flight unit to dead-silent on a single
// hiccup (the dangerous direction); the old code instead presumed every
// outstanding session alive and labelled it `running` — a liveness it could not
// verify (D6). Both guess. This returns `reliable: false` so `classify`
// degrades such units to `unknown` — neither running nor dead. A poll loop
// keeps calling `pollOnce` until its timeout, so a TRANSIENT failure is retried
// (next tick recovers to `running`); a PERSISTENT one surfaces as `unknown` at
// the deadline, asking the coordinator to look rather than declaring anyone
// dead. `ids` still carries the outstanding set so a legacy caller ignoring the
// flag degrades no worse than before.
function liveSessionIds(
  ledger: JourneyLedger,
  result: { code: number; stdout: string; stderr: string },
): { reliable: boolean; ids: Set<string> } {
  if (result.code === 0) {
    try {
      return { reliable: true, ids: parseSessionList(result.stdout) };
    } catch {
      // fall through to the not-reliable fallback below
    }
  }
  return { reliable: false, ids: outstandingSessionIds(ledger) };
}

export async function pollOnce(
  workspaceDir: string,
  journeyId: string,
  runner: AgentopRunner,
): Promise<UnitState[]> {
  const ledger = await readLedger(workspaceDir, journeyId);
  if (!ledger) return [];
  const result = await runner(["session", "list", "--json"]);
  const { reliable, ids } = liveSessionIds(ledger, result);
  return classify(ledger, ids, reliable);
}
