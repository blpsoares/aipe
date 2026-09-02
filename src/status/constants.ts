// Dispatch-status partitions shared by the assembler and the scoper, so "what
// counts as open work" has exactly one definition. verified/merged are done;
// delivered is still open (it has not cleared its QA gate); removed is neither
// open nor a completion (the unit was withdrawn).
export const OPEN_STATUSES = new Set(["dispatched", "delivered", "failed", "escalated", "blocked", "abandoned", "redirected"]);
// Finished. `closed` belongs here, and its absence had two measurable effects:
// the JOURNEYS table counted it in neither OPEN nor DONE, so `OPEN + DONE` no
// longer equalled TOTAL and three rows were counted nowhere; and the
// gated-tier check in assemble.ts reads this set to decide "still open", so
// closing a `verified` row made it NEWLY ELIGIBLE for the queue — the landing
// that was supposed to shrink the queue GREW it, from 1 entry to 2.
export const DONE_STATUSES = new Set(["verified", "merged", "closed"]);
