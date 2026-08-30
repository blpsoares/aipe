// The data behind the status-explainer view (5.3). Sourced from the aipe repo's
// REAL types so it can never drift from the ledger: the canonical statuses come
// straight from DISPATCH_STATUSES, the reject conditions from the evidence gate
// and the journey-verify finding codes. A test asserts every canonical status
// has an entry, so adding a status to the type forces a doc entry here.
import { DISPATCH_STATUSES, EVIDENCE_REQUIRED_STATUSES } from "../../../journey/types";
import type { DispatchStatus } from "../../../journey/types";

export interface StatusEntry {
  key: string; // status id (or a synthetic id for transient/reject rows)
  tone: string; // statusMeta tone, for the chip
  meaning: string; // i18n key — what it means
  cause: string; // i18n key — what puts a unit here
  unblock: string; // i18n key — what moves it forward
  who: string; // i18n key — who acts next
  laws: string[]; // i18n keys of the laws it touches
}

// The eight canonical DispatchStatus values, in lifecycle order. Ordered here for
// reading; membership is validated against DISPATCH_STATUSES by the test.
const CANONICAL_ORDER: DispatchStatus[] = [
  "dispatched",
  "delivered",
  "verified",
  "merged",
  "removed",
  "failed",
  "escalated",
  "blocked",
  "abandoned",
  "redirected",
];

const CANONICAL: Record<DispatchStatus, Omit<StatusEntry, "key">> = {
  dispatched: { tone: "sky", meaning: "sg_dispatched_m", cause: "sg_dispatched_c", unblock: "sg_dispatched_u", who: "sg_who_dev", laws: ["sg_law_serial"] },
  delivered: { tone: "accent", meaning: "sg_delivered_m", cause: "sg_delivered_c", unblock: "sg_delivered_u", who: "sg_who_qa", laws: ["sg_law_evidence", "sg_law_qa"] },
  verified: { tone: "accent", meaning: "sg_verified_m", cause: "sg_verified_c", unblock: "sg_verified_u", who: "sg_who_coord", laws: ["sg_law_qa"] },
  merged: { tone: "accent", meaning: "sg_merged_m", cause: "sg_merged_c", unblock: "sg_merged_u", who: "sg_who_none", laws: ["sg_law_landing"] },
  removed: { tone: "slate", meaning: "sg_removed_m", cause: "sg_removed_c", unblock: "sg_removed_u", who: "sg_who_none", laws: [] },
  failed: { tone: "rose", meaning: "sg_failed_m", cause: "sg_failed_c", unblock: "sg_failed_u", who: "sg_who_dev", laws: ["sg_law_qa"] },
  escalated: { tone: "amber", meaning: "sg_escalated_m", cause: "sg_escalated_c", unblock: "sg_escalated_u", who: "sg_who_pe", laws: ["sg_law_landing"] },
  blocked: { tone: "amber", meaning: "sg_blocked_m", cause: "sg_blocked_c", unblock: "sg_blocked_u", who: "sg_who_coord", laws: [] },
  // D4 (j-20260830-w0) — deliberately its OWN tone (slate, like `removed`),
  // never rose/amber: those read as "something went wrong with the work",
  // which is exactly the false reading this status exists to correct. This is
  // "no verdict was ever formed", not a rejection.
  abandoned: { tone: "slate", meaning: "sg_abandoned_m", cause: "sg_abandoned_c", unblock: "sg_abandoned_u", who: "sg_who_coord", laws: [] },
  redirected: { tone: "amber", meaning: "sg_redirected_m", cause: "sg_redirected_c", unblock: "sg_redirected_u", who: "sg_who_coord", laws: [] },
};

// The session-mode transient — not a ledger status, an agentop activity that the
// console folds in so the board is live between ledger writes.
const TRANSIENT: StatusEntry[] = [
  { key: "running", tone: "sky", meaning: "sg_running_m", cause: "sg_running_c", unblock: "sg_running_u", who: "sg_who_dev", laws: [] },
];

// The states the ledger REJECTS or that `journey verify` flags — the reason a
// delivery can be recorded yet still be wrong. Keyed by the verify finding code.
const REJECTED: StatusEntry[] = [
  { key: "no-evidence", tone: "rose", meaning: "sg_noevidence_m", cause: "sg_noevidence_c", unblock: "sg_noevidence_u", who: "sg_who_dev", laws: ["sg_law_evidence"] },
  { key: "delivered-not-verified", tone: "amber", meaning: "sg_notverified_m", cause: "sg_notverified_c", unblock: "sg_notverified_u", who: "sg_who_qa", laws: ["sg_law_qa"] },
  { key: "failed-open", tone: "rose", meaning: "sg_failedopen_m", cause: "sg_failedopen_c", unblock: "sg_failedopen_u", who: "sg_who_coord", laws: ["sg_law_qa"] },
  { key: "merged-skipped-qa", tone: "amber", meaning: "sg_mergedqa_m", cause: "sg_mergedqa_c", unblock: "sg_mergedqa_u", who: "sg_who_coord", laws: ["sg_law_qa"] },
  { key: "dependency-not-landed", tone: "rose", meaning: "sg_dep_m", cause: "sg_dep_c", unblock: "sg_dep_u", who: "sg_who_coord", laws: ["sg_law_landing"] },
];

export function canonicalGuide(): StatusEntry[] {
  return CANONICAL_ORDER.map((k) => ({ key: k, ...CANONICAL[k] }));
}
export function transientGuide(): StatusEntry[] {
  return TRANSIENT;
}
export function rejectedGuide(): StatusEntry[] {
  return REJECTED;
}

// Exposed for the coverage test: the set the ledger considers "done-claims" that
// require evidence, so the reject page can name them precisely.
export const EVIDENCE_STATUSES: readonly DispatchStatus[] = EVIDENCE_REQUIRED_STATUSES;
export const ALL_DISPATCH_STATUSES: readonly DispatchStatus[] = DISPATCH_STATUSES;
