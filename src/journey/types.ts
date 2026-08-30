// A journey is one work session between the PE and the coordinator on a demand.
// Its ledger is the durable, human-inspectable record of what was dispatched —
// bookkeeping and audit, NOT the hiring brief (the brief is never persisted).
//
// Status lifecycle of a unit within a journey:
//   dispatched → delivered → verified → merged      (happy path)
//   delivered  → failed → (re)dispatched → …        (QA rejected the delivery)
//   dispatched → escalated                          (cross-repo need, PE decides)
//   dispatched → blocked                             (stuck, waiting on the coordinator)
//   * → redirected                                 (PE redirected it live via attach)
//   * → removed                                     (worktree torn down)
// `verified` = a dev delivery that PASSED its QA gate (the only "cleared for PE"
// non-merged state). `failed` = QA rejected it; the unit is NOT done.
// `blocked` = the specialist declared itself stuck and is waiting on the
// coordinator — distinct from `escalated` (a cross-repo scope decision the PE
// owns) and from `delivered` (work done). It is the first-class "I cannot
// proceed, I need an answer" signal the coordinator can discover without reading
// a terminal (surfaced by `session collect` and `journey verify`).
export type DispatchStatus =
  | "dispatched"
  | "delivered"
  | "verified"
  | "failed"
  | "escalated"
  | "blocked"
  | "merged"
  | "removed"
  | "redirected";

export const DISPATCH_STATUSES: DispatchStatus[] = [
  "dispatched",
  "delivered",
  "verified",
  "failed",
  "escalated",
  "blocked",
  "merged",
  "removed",
  "redirected",
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

// The single definition of "which of these evidence commands was actually run".
// A command that is empty or whitespace is not a command run, so it is not proof.
// Both gates that judge evidence — the ledger WRITE gate (recordDispatchGuarded)
// and the verify READ gate (hasEvidence) — MUST derive proof from this one helper.
// Keeping the test in two places is exactly what let the write gate be fixed while
// the read gate kept clearing empty evidence.
export function realEvidenceCommands(ev: DispatchEvidence | undefined): string[] {
  return Array.isArray(ev?.commands) ? ev.commands.filter((c) => !!c?.trim()) : [];
}

// Evidence is proof only with at least one NON-EMPTY command (not merely a
// non-empty array) plus a non-blank summary; otherwise `--evidence-cmd ""` dresses
// a bare self-report as evidence and clears the gate.
export function hasRealEvidence(ev: DispatchEvidence | undefined): ev is DispatchEvidence {
  return !!ev && realEvidenceCommands(ev).length > 0 && !!ev.summary?.trim();
}

export interface JourneyDispatch {
  repo: string;
  package?: string; // the unit within the repo (absent ⇒ implicit whole-repo package)
  // The specific task this persona is doing on the unit — the axis that makes a
  // dispatch addressable as `Persona · task` (j-20260826-uv). Two concurrent
  // dispatches of one persona on distinct tasks are SEPARATE ledger rows with
  // independent QA gates; the fix-loop protection (re-dispatch needs a reason, a
  // merged task is immutable) is keyed on this task, not the bare unit. Absent ⇒
  // the implicit single task (legacy rows and subagent dispatches round-trip
  // untouched, identical to pre-task behavior).
  task?: string;
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
  // What the PE asked for, live, when they redirected this unit's direction
  // via `agentop session attach` (status `redirected`). Deliberately a
  // separate field from `redispatchReason` above, not a reuse of it: that
  // field means "why finished work was reopened" (a fix loop / redo on a
  // delivered|verified→dispatched transition) — a reader who saw it non-empty
  // on a `redirected` record would misread this as a reopened redo instead of
  // a live scope change the approved spec no longer describes. Required by
  // the ledger gate whenever `status: "redirected"` is recorded (see
  // recordDispatchGuarded in ledger.ts); absent on legacy ledgers written
  // before this field existed.
  redirectReason?: string;
  // Why a specialist declared itself `blocked` — what it is stuck on and what it
  // needs from the coordinator. Required by the ledger gate whenever
  // `status: "blocked"` is recorded (recordDispatchGuarded), so a blocked record
  // always says what would unblock it; absent on every other status. A
  // per-transition annotation, NOT sticky — it never leaks onto a later write.
  blockedReason?: string;
  // Model-policy audit (optional; absent on legacy ledgers): the tier the
  // coordinator assigned and the concrete model the specialist ran on.
  tier?: string;
  model?: string;
  // Session-mode dispatch (absent on subagent dispatches and legacy ledgers).
  // `sessionId` is what `aipe session collect` cross-references against
  // `agentop session list --json` to tell "still working" from "died silently".
  mode?: "subagent" | "session";
  intensity?: "normal" | "ultracode";
  harness?: string;
  sessionId?: string;
  // Recorded when a delivered/verified record was accepted via the explicit
  // `--ci-none` bypass — the PR's forge reported no CI checks configured and the
  // specialist deliberately claimed that. Present ⇒ the CI gate was consciously
  // waived for this record (an audit can see the claim was made on purpose);
  // absent ⇒ the record either passed a green CI gate or predates it. The only
  // value today is "no-checks"; kept as a string union so a future bypass reason
  // is additive.
  ciBypass?: "no-checks";
}

// An explicit PE grant, recorded only after the PE says yes in the live session.
// Scope is per journey (PE-confirmed). Two kinds of grant share this shape:
//   • a gated-tier grant — `tier` set (the original use);
//   • a force-claim override — `forceClaim` set to the unit key (`repo` or
//     `repo/package`) whose ACTIVE dispatch lock this journey may override with
//     `dispatch claim --force`. Overriding a live lock is a human decision on the
//     record, never an agent's shortcut (orientation, 2026-07-08 PE decision).
export interface JourneyAuthorization {
  tier?: string;
  grantedBy: string;
  forceClaim?: string;
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
