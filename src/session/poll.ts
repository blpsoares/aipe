// Cross-references the journey ledger against agentop's live session list. The
// ledger is the source of truth for "did the work land"; agentop is the source
// of truth for "is anyone still working". Only together do they distinguish a
// slow specialist from one that died without a word.
import { packageFqid } from "../context-brain/packages";
import { readLedger } from "../journey/ledger";
import type { JourneyDispatch, JourneyLedger } from "../journey/types";
import type { AgentopRunner, UnitPhase, UnitState } from "./types";

const LANDED_STATUSES = new Set(["delivered", "verified", "merged"]);

// AIPe's judgment over agentop's raw session `status`, so that presence in the
// live list is never mistaken for proof of life (the whole point of this unit).
//   • alive — the session is up and someone is working: it can land or be
//     redirected. Reported `running`.
//   • lost  — agentop had the session and LOST it: it did not exit cleanly and
//     may be an orphaned process still holding work, or it crashed. A third
//     state, distinct from a clean end AND from working — reported `lost`.
//   • gone  — the session ended cleanly (agentop's own terminal states minus
//     `lost`): nothing to wait for. Treated the same as absent-from-the-list —
//     reported `dead-silent` when no delivery was recorded.
export type Liveness = "alive" | "lost" | "gone";

// Maps ONE agentop `status` to a liveness. Every value agentop v2.0.0 produces
// is handled explicitly, and each mapping is justified against agentop's OWN
// categorisation in that binary:
//   • `running`, `unregistered` → alive. agentop itself groups exactly these
//     two as the live pair: `hasLive = v.status === "running" || v.status ===
//     "unregistered"`. `unregistered` is a session agentop sees as active but
//     has not (yet) folded into its managed set — live, not dead.
//   • `lost` → lost. In agentop's terminal group (`history: ["closed",
//     "exited", "lost"]`) it is the one that is NOT a clean end — it is where a
//     session goes when agentop can no longer account for it. It earns its own
//     liveness so the report can say so, per this unit's brief.
//   • `exited`, `closed` → gone. The other two of agentop's `history` group:
//     clean, deliberate ends. No session remains to be alive.
// An UNRECOGNISED status (a value a future agentop invents, or a missing/
// non-string field) fails OPEN to `alive`: the id is present in the list, and a
// present session we cannot classify must NOT be declared dead — killing or
// re-dispatching by mistake is worse than waiting on something that may have
// ended (the same honesty the whole-list-unreadable path keeps, one entry
// deeper). This also preserves the pre-`status` contract: an older agentop that
// listed sessions with no `status` at all degrades to presence==alive, exactly
// as before, never to a false dead-silent.
export function sessionLiveness(status: unknown): Liveness {
  switch (status) {
    case "running":
    case "unregistered":
      return "alive";
    case "lost":
      return "lost";
    case "exited":
    case "closed":
      return "gone";
    default:
      return "alive";
  }
}

// How much of unparseable stdout to echo back in a thrown error. Mirrors
// `previewStdout` in batch.ts: long enough to recognise the shape of the
// problem, short enough not to dump a giant blob into logs.
const STDOUT_PREVIEW_LIMIT = 500;

function previewStdout(stdout: string): string {
  return stdout.length > STDOUT_PREVIEW_LIMIT
    ? `${stdout.slice(0, STDOUT_PREVIEW_LIMIT)}… (truncated, ${stdout.length} chars total)`
    : stdout;
}

// Parses `agentop session list --json` into id → liveness. NOT id → present:
// an entry's `status` is consulted (via sessionLiveness) so a session agentop
// still LISTS but has marked terminal/lost is not mistaken for one that is
// working. A hard parse failure (unparseable, wrong shape, unusable id) still
// throws — the caller's fail-open path takes over — rather than reading as an
// empty, confidently-nobody-alive result.
export function parseSessionLiveness(stdout: string): Map<string, Liveness> {
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
  const live = new Map<string, Liveness>();
  for (const entry of list) {
    const record = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : undefined;
    const id = record?.id;
    // Unlike batch.ts, this parser has no "malformed" counter to report a
    // per-entry loss through. Dropping an entry with no usable id here would
    // silently vanish a live session from the returned map, and the caller has
    // no signal that anything was lost: the same "everyone is dead" ambiguity
    // as the wrong-shape case above, just one level deeper. So an unusable id
    // throws instead of being dropped, letting pollOnce's fail-open fallback
    // take over.
    if (typeof id !== "string" || id === "") {
      throw new Error(
        `agentop session list entry has no usable id: ${previewStdout(JSON.stringify(entry))}`,
      );
    }
    // The `status` is judged, never trusted-as-present: this is the fix. A
    // missing/unknown `status` fails open to alive inside sessionLiveness, so an
    // older agentop with no status field degrades to the prior presence==alive
    // behaviour rather than to a false dead-silent.
    live.set(id, sessionLiveness(record?.status));
  }
  return live;
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
// `dead-silent` (the dangerous direction).
//
// When `reliable` is true, `live` maps each id agentop LISTED to the liveness we
// derived from its `status` (parseSessionLiveness). Presence is NOT proof of
// life: an id present but marked terminal is treated by its status, not by the
// mere fact it was listed. The three live-side outcomes:
//   • alive           → `running` (someone is working).
//   • lost            → `lost` (agentop lost the session — not a clean end, not
//                        alive; the reader must look, not re-dispatch blind).
//   • gone OR absent  → `dead-silent` (a clean end, or never in the list at all;
//                        indistinguishable and handled the same).
// agentop's `activity` field is deliberately NOT consulted: it reported
// `waiting` for a session mid-tool-call, so it is not a trustworthy ground truth
// for working-vs-idle. `status` (used here) is a different, reliable field.
export function dispatchPhase(d: JourneyDispatch, live: Map<string, Liveness>, reliable: boolean): UnitPhase {
  if (d.status === "redirected") return "redirected";
  if (d.status === "blocked") return "waiting";
  if (LANDED_STATUSES.has(d.status)) return "landed";
  if (!d.sessionId) return "dead-silent";
  if (!reliable) return "unknown";
  const liveness = live.get(d.sessionId);
  if (liveness === "alive") return "running";
  if (liveness === "lost") return "lost";
  // "gone" (a listed clean end) or undefined (never in the list) both mean no
  // session remains to wait on.
  return "dead-silent";
}

// `reliable` defaults to `true` so the pure callers/tests that hand a known map
// need not thread the flag.
export function classify(ledger: JourneyLedger, live: Map<string, Liveness>, reliable = true): UnitState[] {
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
// is harmless), each presumed `alive`. This is the fail-open live map for when
// we cannot ask agentop: it is only ever paired with `reliable: false`, under
// which `dispatchPhase` ignores `live` entirely and returns `unknown` for every
// in-flight unit — so the `alive` here is a type-correct placeholder, never a
// liveness this asserts.
function outstandingLive(ledger: JourneyLedger): Map<string, Liveness> {
  const live = new Map<string, Liveness>();
  for (const d of ledger.dispatches) {
    if (d.mode === "session" && d.sessionId) live.set(d.sessionId, "alive");
  }
  return live;
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
function liveSessions(
  ledger: JourneyLedger,
  result: { code: number; stdout: string; stderr: string },
): { reliable: boolean; live: Map<string, Liveness> } {
  if (result.code === 0) {
    try {
      return { reliable: true, live: parseSessionLiveness(result.stdout) };
    } catch {
      // fall through to the not-reliable fallback below
    }
  }
  return { reliable: false, live: outstandingLive(ledger) };
}

export async function pollOnce(
  workspaceDir: string,
  journeyId: string,
  runner: AgentopRunner,
): Promise<UnitState[]> {
  const ledger = await readLedger(workspaceDir, journeyId);
  if (!ledger) return [];
  const result = await runner(["session", "list", "--json"]);
  const { reliable, live } = liveSessions(ledger, result);
  return classify(ledger, live, reliable);
}
