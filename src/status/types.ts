// The shape of `aipe status` — the ONE derivation (item 3) that also feeds the
// post-change delta (item 9) and the SessionStart state block (item 8). Nothing
// downstream re-derives: the table renderer, the JSON, the delta and the
// session-context summary all read a `StatusReport`.
import type { DispatchStatus } from "../journey/types";
import type { RepoReleaseState, PublishState } from "../release/types";
import type { UnitPhase } from "../session/types";

export type StatusFormat = "detailed" | "compact";

// The (10) follow-preference, resolved from `brain.context.statusUpdates`.
// Absence of the field IS `auto:false` (backward compatibility — every brain
// written before this feature has no such field), so a default here is a real
// decision, not a placeholder.
export interface StatusUpdatesPref {
  auto: boolean;
  format: StatusFormat;
}

export const DEFAULT_STATUS_PREF: StatusUpdatesPref = { auto: false, format: "detailed" };

// One unit of work — one ledger dispatch — projected for display.
export interface UnitRow {
  journey: string;
  fqid: string; // repo or repo/package
  repo: string;
  package: string | null;
  task: string | null;
  specialist: string;
  role: string | null; // resolved from personas.yaml; null when the roster doesn't name it
  branch: string;
  pr: string | null;
  status: DispatchStatus;
  mode: "subagent" | "session" | null;
  sessionId: string | null;
  // Liveness for session-mode units, by the same honest rules as `session
  // collect` (poll.dispatchPhase). null for subagent units — there is no session
  // to describe, and reporting one would be a lie of a different kind.
  liveness: UnitPhase | null;
  hasEvidence: boolean;
  // For a `merged` unit: whether it is actually published, derived from its
  // repo's release state (j-20260830-zd). null on every non-merged unit — the
  // publication question only exists once a unit has merged. Lets `journey show`
  // and `status` tell a merged-in-dev unit from a published one without GitHub.
  publishState: PublishState | null;
  // The dispatch envelope (j-20260829-dp v4). `aipe status --json` used to drop
  // these, forcing a hand-read of the YAMLs; they are audit + card fields now.
  // null on legacy/subagent records that predate the envelope — absence is not an
  // error, and MUST NOT be invented.
  harness: string | null;
  model: string | null;
  tier: string | null;
  intensity: "normal" | "ultracode" | null;
  // Swept in with the envelope (the same "held-back field" class): the worktree
  // (a copyable `cd` target for the read-only console) and the honest CI-waiver
  // flag on a delivered/verified record.
  worktree: string;
  ciBypass: "no-checks" | "verified-pre-merge" | null;
}

export interface JourneyRow {
  id: string;
  specApproved: boolean;
  specVersion: number | null; // null when the journey has no Orientation Spec yet
  open: number; // dispatches still needing attention (see OPEN_STATUSES)
  done: number; // verified or merged
  total: number;
}

// Why a unit is waiting on the PE — the part the PE could not see today (item 2).
// `finished-unprocessed` (j-20260829-5q): a session-mode unit still `dispatched`
// in the ledger whose session has RELIABLY exited — "it finished and nobody
// recorded it". Derived from session-state × ledger-status, so a coordinator
// picking up a workspace sees the queue a session switch would otherwise lose.
export type WaitingKind =
  | "gated"
  | "escalated"
  | "redirected"
  | "blocked"
  | "abandoned"
  | "no-evidence"
  | "finished-unprocessed";

export interface WaitingItem {
  kind: WaitingKind;
  journey: string;
  fqid: string;
  specialist: string;
  detail: string; // the reason / tier / "" when the ledger records none
}

// Whether we could stand behind any liveness claim at all (item 5).
export type LivenessSource = "agentop" | "none";

export interface LivenessInfo {
  source: LivenessSource; // could we ask agentop at all
  reliable: boolean; // was the returned live list trustworthy (exit 0 + parseable)
  note: string; // a plain sentence naming the confidence, shown in the report
}

// When the default scope hides journeys, we say how many and why — never a
// silent truncation (item 4).
export interface Elision {
  shownJourneys: number;
  totalJourneys: number;
  hiddenJourneys: number;
  reason: string;
}

export type StatusScope = "default" | "all" | "journey";

export interface StatusReport {
  workspace: string;
  contextName: string;
  scope: StatusScope;
  journeys: JourneyRow[];
  units: UnitRow[];
  waiting: WaitingItem[];
  // Per-repo release position for the repos in scope (item 2 — the represado
  // signal). Empty when release resolution was skipped (the SessionStart hot
  // path). A repo whose state is not `published` is dammed-up work the coordinator
  // must see without hunting for it — same visibility class as WAITING ON YOU.
  releases: RepoReleaseState[];
  liveness: LivenessInfo;
  pref: StatusUpdatesPref;
  elision: Elision | null;
}
