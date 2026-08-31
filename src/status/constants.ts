// Dispatch-status partitions shared by the assembler and the scoper, so "what
// counts as open work" has exactly one definition. verified/merged are done;
// delivered is still open (it has not cleared its QA gate); removed is neither
// open nor a completion (the unit was withdrawn).
export const OPEN_STATUSES = new Set(["dispatched", "delivered", "failed", "escalated", "blocked", "abandoned", "redirected"]);
export const DONE_STATUSES = new Set(["verified", "merged"]);
