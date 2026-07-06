// A journey is one work session between the PE and the coordinator on a demand.
// Its ledger is the durable, human-inspectable record of what was dispatched —
// bookkeeping and audit, NOT the hiring brief (the brief is never persisted).
export type DispatchStatus = "dispatched" | "delivered" | "escalated" | "merged" | "removed";

export const DISPATCH_STATUSES: DispatchStatus[] = [
  "dispatched",
  "delivered",
  "escalated",
  "merged",
  "removed",
];

export interface JourneyDispatch {
  repo: string;
  specialist: string;
  branch: string;
  worktree: string;
  pr?: string;
  status: DispatchStatus;
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

export interface JourneyLedger {
  id: string;
  dispatches: JourneyDispatch[];
  authorizations?: JourneyAuthorization[];
}
