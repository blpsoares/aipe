// The shared derivation (item 3). Pure: it takes already-read ledgers, the
// persona roster, the model policy, an injected live-session snapshot and the
// follow-preference, and returns a `StatusReport`. The CLI (item 3), the delta
// after a change (item 9) and the SessionStart state block (item 8) all consume
// THIS — the derivation is written once and never duplicated.
import { packageFqid } from "../context-brain/packages";
import { grantedTiers } from "../journey/ledger";
import type { JourneyDispatch, JourneyLedger } from "../journey/types";
import type { PersonaRegistryEntry } from "../hire-specialists/types";
import type { ModelPolicy } from "../model/types";
import { dispatchPhase } from "../session/poll";
import { DONE_STATUSES, OPEN_STATUSES } from "./constants";
import type { LiveSessions } from "./liveness";
import type {
  Elision,
  JourneyRow,
  LivenessInfo,
  StatusReport,
  StatusScope,
  StatusUpdatesPref,
  UnitRow,
  WaitingItem,
} from "./types";

export interface AssembleInput {
  workspace: string;
  contextName: string;
  scope: StatusScope;
  ledgers: JourneyLedger[]; // the SELECTED journeys (scoping happened upstream)
  roster: PersonaRegistryEntry[];
  policy: ModelPolicy;
  live: LiveSessions;
  pref: StatusUpdatesPref;
  elision: Elision | null;
}

// The role a persona plays in a repo, from the durable roster. Matched
// case-insensitively on name (the ledger has recorded both "Viola" and "viola"
// for the same persona), preferring an entry in the same repo. null when the
// roster does not name this specialist — reported honestly rather than guessed.
function roleOf(roster: PersonaRegistryEntry[], specialist: string, repo: string): string | null {
  const name = specialist.trim().toLowerCase();
  const sameRepo = roster.find((p) => p.name.trim().toLowerCase() === name && p.repo === repo);
  if (sameRepo) return sameRepo.role;
  const anyRepo = roster.find((p) => p.name.trim().toLowerCase() === name);
  return anyRepo ? anyRepo.role : null;
}

function hasEvidence(d: JourneyDispatch): boolean {
  return !!d.evidence && (d.evidence.commands.length > 0 || (d.evidence.summary ?? "").trim().length > 0);
}

function unitRow(journey: string, d: JourneyDispatch, roster: PersonaRegistryEntry[], live: LiveSessions): UnitRow {
  return {
    journey,
    fqid: packageFqid(d.repo, d.package),
    repo: d.repo,
    package: d.package ?? null,
    task: d.task ?? null,
    specialist: d.specialist,
    role: roleOf(roster, d.specialist, d.repo),
    branch: d.branch,
    pr: d.pr ?? null,
    status: d.status,
    mode: d.mode ?? null,
    sessionId: d.sessionId ?? null,
    liveness: d.mode === "session" ? dispatchPhase(d, live.ids, live.reliable) : null,
    hasEvidence: hasEvidence(d),
  };
}

function journeyRow(l: JourneyLedger): JourneyRow {
  let open = 0;
  let done = 0;
  for (const d of l.dispatches) {
    if (OPEN_STATUSES.has(d.status)) open++;
    else if (DONE_STATUSES.has(d.status)) done++;
  }
  return {
    id: l.id,
    specApproved: l.spec?.approved ?? false,
    specVersion: l.spec?.version ?? null,
    open,
    done,
    total: l.dispatches.length,
  };
}

// The waiting-on-the-PE derivation (item 2). Every distinct way a unit is
// blocking the PE gets one row; a single unit can raise more than one (a gated
// envelope that is also missing evidence, say).
function waitingItems(l: JourneyLedger, policy: ModelPolicy, live: LiveSessions): WaitingItem[] {
  const out: WaitingItem[] = [];
  const granted = grantedTiers(l);
  const gatedTiers = new Set<string>(policy.authorizationTiers);
  for (const d of l.dispatches) {
    const fqid = packageFqid(d.repo, d.package);
    const base = { journey: l.id, fqid, specialist: d.specialist };
    // "Finished but not processed": a session-mode unit still `dispatched` whose
    // session has RELIABLY exited (dead-silent WITH a real sessionId — it
    // launched and is gone; a never-launched unit has no sessionId and is a
    // different problem). dispatchPhase already degrades to `unknown` when the
    // live list is unreadable, so this can never guess "exited" from a blind spot.
    if (
      d.mode === "session" &&
      d.status === "dispatched" &&
      d.sessionId &&
      dispatchPhase(d, live.ids, live.reliable) === "dead-silent"
    ) {
      out.push({ ...base, kind: "finished-unprocessed", detail: "session ended; delivery not yet recorded" });
    }
    // A gated-tier envelope the PE has not authorized, on a unit that is still
    // open (a terminal unit no longer needs the grant).
    if (d.tier && gatedTiers.has(d.tier) && !granted.has(d.tier) && !DONE_STATUSES.has(d.status)) {
      out.push({ ...base, kind: "gated", detail: `tier ${d.tier} not authorized` });
    }
    if (d.status === "escalated") {
      out.push({ ...base, kind: "escalated", detail: "open escalation" });
    }
    if (d.status === "redirected") {
      out.push({ ...base, kind: "redirected", detail: d.redirectReason ?? "redirected — not yet reconciled" });
    }
    if (d.status === "blocked") {
      out.push({ ...base, kind: "blocked", detail: d.blockedReason ?? "blocked — reason not recorded" });
    }
    // A delivery/verification with no evidence to stand on (the ledger gate
    // rejects this for guarded writes, but a legacy or raw record can carry it).
    if ((d.status === "delivered" || d.status === "verified") && !hasEvidence(d)) {
      out.push({ ...base, kind: "no-evidence", detail: `${d.status} without evidence` });
    }
  }
  return out;
}

function livenessInfo(live: LiveSessions, anySession: boolean): LivenessInfo {
  if (!anySession) {
    return { source: live.source, reliable: live.reliable, note: "no session-mode units — liveness not applicable" };
  }
  if (live.source === "none") {
    return { source: "none", reliable: false, note: "agentop not installed — session liveness is unknown" };
  }
  if (!live.reliable) {
    return { source: "agentop", reliable: false, note: "agentop did not return a readable session list — liveness is unknown, not dead" };
  }
  return { source: "agentop", reliable: true, note: "liveness from agentop's live session list (activity field deliberately ignored)" };
}

export function assemble(input: AssembleInput): StatusReport {
  const { ledgers, roster, policy, live, pref } = input;
  const units: UnitRow[] = [];
  const waiting: WaitingItem[] = [];
  let anySession = false;
  for (const l of ledgers) {
    for (const d of l.dispatches) {
      if (d.mode === "session") anySession = true;
      units.push(unitRow(l.id, d, roster, live));
    }
    waiting.push(...waitingItems(l, policy, live));
  }
  return {
    workspace: input.workspace,
    contextName: input.contextName,
    scope: input.scope,
    journeys: ledgers.map(journeyRow),
    units,
    waiting,
    liveness: livenessInfo(live, anySession),
    pref,
    elision: input.elision,
  };
}
