// #97 — landing a unit closes ALL of its records, not just the one that merged.
//
// The merge is a fact about the UNIT: that code is in the base branch now. The
// dev's row got `merged` and every other row of the same unit — the QA gate, its
// re-gates (`gate-pr51`, `-r2`, `-r3`) — stayed `dispatched` or `failed` forever,
// because nothing said they were over.
//
// Measured cost: the "precisa de você" queue reached **25 entries, 20 of them
// junk** — QA records stuck open for PRs that had already merged. The PE saw the
// screenshot and said *"tem 25 needs you wtf, ta completamente bizarro isso"*.
// It then filled up again. And a queue that re-presents finished work stops
// being read, which is when it stops protecting the case that matters.
//
// Two things this deliberately does NOT do:
//   • It does not write `merged` onto the QA's row. That row merged nothing;
//     saying it did would be a convenient falsehood in a ledger whose only job
//     is being true. It writes `closed`, with the reason.
//   • It does not touch a row that is still LIVE work (`dispatched`, `blocked`,
//     `redirected`). A fresh dispatch on a unit that just landed is somebody
//     working right now — closing it would delete a live assignment, which is a
//     worse failure than the noise this fixes.
import type { JourneyDispatch } from "./types";

/** Rows that are finished — landing has nothing to close in them. */
const ALREADY_DONE = new Set<string>(["merged", "closed", "removed"]);

/**
 * Rows landing closes: a QA verdict, or a delivery, that is now moot because the
 * unit is in. `dispatched`/`blocked`/`redirected`/`escalated` are LIVE — someone
 * is working or someone is owed an answer — and are left alone on purpose.
 */
const CLOSED_BY_LANDING = new Set<string>(["verified", "failed", "delivered"]);

export interface LandingClose {
  /** Index into the dispatch list, so a caller can write back in place. */
  index: number;
  unit: string;
  specialist: string;
  task: string | null;
  from: string;
}

/**
 * Given a unit that just landed, returns the sibling records to close. Pure: it
 * decides, the caller writes — so the same decision serves the guarded CLI path
 * and `journey reconcile`, which learns the merge from the forge and never goes
 * through the gate. One rule, two callers, no chance of them drifting.
 *
 * `landedIndex` is the row that merged; it is never in the result.
 */
export function closesOnLanding(
  dispatches: JourneyDispatch[],
  landedIndex: number,
): LandingClose[] {
  const landed = dispatches[landedIndex];
  if (!landed) return [];
  const out: LandingClose[] = [];
  for (let i = 0; i < dispatches.length; i++) {
    if (i === landedIndex) continue;
    const d = dispatches[i]!;
    if (d.repo !== landed.repo || (d.package ?? null) !== (landed.package ?? null)) continue;
    if (ALREADY_DONE.has(d.status) || !CLOSED_BY_LANDING.has(d.status)) continue;
    out.push({
      index: i,
      unit: `${d.repo}${d.package ? `/${d.package}` : ""}`,
      specialist: d.specialist,
      task: d.task ?? null,
      from: d.status,
    });
  }
  return out;
}

/** The reason stamped on each closed row — says WHICH landing closed it. */
export function landingReason(landed: JourneyDispatch): string {
  const unit = `${landed.repo}${landed.package ? `/${landed.package}` : ""}`;
  return landed.pr
    ? `unit ${unit} landed (${landed.pr}) — this record's work is finished with it`
    : `unit ${unit} landed — this record's work is finished with it`;
}

/**
 * Applies the closes, returning a NEW list. Never mutates the input: the caller
 * is usually holding the same array it is about to write, and an in-place edit
 * would make a failed write leave a half-changed ledger in memory.
 */
export function applyLandingCloses(
  dispatches: JourneyDispatch[],
  landedIndex: number,
): { dispatches: JourneyDispatch[]; closed: LandingClose[] } {
  const closed = closesOnLanding(dispatches, landedIndex);
  if (closed.length === 0) return { dispatches, closed };
  const reason = landingReason(dispatches[landedIndex]!);
  const next = dispatches.map((d, i) =>
    closed.some((c) => c.index === i) ? { ...d, status: "closed" as const, closedReason: reason } : d,
  );
  return { dispatches: next, closed };
}
