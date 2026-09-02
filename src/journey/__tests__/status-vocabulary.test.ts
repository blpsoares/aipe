// A new DispatchStatus must reach EVERY place that enumerates statuses.
//
// When `closed` was added to a hand-written union, the two `Record<DispatchStatus,…>`
// maps broke and told the author; every array, `Set` and if-chain stayed silently
// wrong — eight sites, found by an independent QA. One of them was a drift test
// written to catch exactly this, which passed because both sides of its
// comparison omitted the new value.
//
// The union is now DERIVED from `DISPATCH_STATUSES`, so every exhaustive Record
// breaks at compile time. This covers what the compiler cannot: the Sets that
// are deliberately typed loosely.
import { expect, test } from "bun:test";
import { DISPATCH_STATUSES } from "../types";
import { DONE_STATUSES, OPEN_STATUSES } from "../../status/constants";

// A status in NEITHER set is counted in neither column of the JOURNEYS table,
// so `OPEN + DONE` stops equalling `TOTAL` and those rows are counted nowhere —
// measured as `OPEN 0 · DONE 1 · TOTAL 4`. That is allowed only on purpose, and
// only with the reason written down here.
const DELIBERATELY_NEITHER: Record<string, string> = {
  removed: "the worktree was reclaimed; the record is archival, and calling it either open work or finished work would overstate it. It is excluded from both columns knowingly.",
};

test("every status is open, done, or listed as deliberately neither", () => {
  const neither = DISPATCH_STATUSES.filter((s) => !OPEN_STATUSES.has(s) && !DONE_STATUSES.has(s));
  expect(neither.filter((s) => !(s in DELIBERATELY_NEITHER))).toEqual([]);
});

test("no status is claimed by BOTH — open and done must be exclusive", () => {
  expect(DISPATCH_STATUSES.filter((s) => OPEN_STATUSES.has(s) && DONE_STATUSES.has(s))).toEqual([]);
});

test("the exception list has no stale entries, and each carries a real reason", () => {
  for (const [status, why] of Object.entries(DELIBERATELY_NEITHER)) {
    expect(DISPATCH_STATUSES).toContain(status as (typeof DISPATCH_STATUSES)[number]);
    expect(OPEN_STATUSES.has(status) || DONE_STATUSES.has(status)).toBe(false);
    expect(why.length).toBeGreaterThan(30);
  }
});

test("`closed` is finished — not open, and not an unclassified hole", () => {
  expect(OPEN_STATUSES.has("closed")).toBe(false);
  expect(DONE_STATUSES.has("closed")).toBe(true);
});
