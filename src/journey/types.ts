// A journey is one work session between the PE and the coordinator on a demand.
// Its ledger is the durable, human-inspectable record of what was dispatched —
// bookkeeping and audit, NOT the hiring brief (the brief is never persisted).
//
// Status lifecycle of a unit within a journey:
//   dispatched → delivered → verified → merged      (happy path)
//   delivered  → failed → (re)dispatched → …        (QA rejected the delivery)
//   dispatched → escalated                          (cross-repo need, PE decides)
//   * → removed                                     (worktree torn down)
// `verified` = a dev delivery that PASSED its QA gate (the only "cleared for PE"
// non-merged state). `failed` = QA rejected it; the unit is NOT done.
export type DispatchStatus =
  | "dispatched"
  | "delivered"
  | "verified"
  | "failed"
  | "escalated"
  | "merged"
  | "removed";

export const DISPATCH_STATUSES: DispatchStatus[] = [
  "dispatched",
  "delivered",
  "verified",
  "failed",
  "escalated",
  "merged",
  "removed",
];

// Statuses that assert a unit of work is DONE and therefore MUST carry evidence
// (Pilar 1 — verify-before-done): a dev delivery and a passed QA verdict. The
// ledger CLI refuses to record these without attached evidence.
export const EVIDENCE_REQUIRED_STATUSES: DispatchStatus[] = ["delivered", "verified"];

// A unit whose PR has merged is immutable within the journey — never re-dispatched.
export const IMMUTABLE_STATUSES: DispatchStatus[] = ["merged"];

// Proof that a claimed "done" actually holds — attached to the ledger, never a
// bare assertion. `by` is which side produced it (the dev's own checks, or the
// QA gate exercising the change). Commands + a summary of what the output showed.
export interface DispatchEvidence {
  by: "dev" | "qa";
  commands: string[];
  summary: string;
  artifact?: string; // optional: a PR url, a log path, a screenshot ref
}

export interface JourneyDispatch {
  repo: string;
  package?: string; // the unit within the repo (absent ⇒ implicit whole-repo package)
  specialist: string;
  branch: string;
  worktree: string;
  pr?: string;
  status: DispatchStatus;
  // Proof attached when the unit is claimed done (delivered/verified). Required
  // by the ledger gate for those statuses; absent on in-flight/legacy records.
  evidence?: DispatchEvidence;
  // Why a unit that was already delivered/verified was re-dispatched (a fix loop
  // or an intentional redo). Recorded so a re-dispatch is never silent.
  redispatchReason?: string;
  // Model-policy audit (optional; absent on legacy ledgers): the tier the
  // coordinator assigned and the concrete model the specialist ran on.
  tier?: string;
  model?: string;
}

// An explicit PE grant for a gated tier, recorded only after the PE says yes in
// the live session. Scope is per journey (PE-confirmed).
export interface JourneyAuthorization {
  tier: string;
  grantedBy: string;
}

// The coordinator's Orientation Spec for this journey (path relative to the
// workspace), its version, and whether the PE has approved it (the dispatch gate).
export interface JourneySpec {
  path: string;
  version: number;
  approved: boolean;
}

export interface JourneyLedger {
  id: string;
  dispatches: JourneyDispatch[];
  spec?: JourneySpec;
  authorizations?: JourneyAuthorization[];
}
