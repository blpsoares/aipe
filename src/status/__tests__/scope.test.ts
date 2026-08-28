import { expect, test } from "bun:test";
import { selectJourneys } from "../scope";
import type { JourneyLedger } from "../../journey/types";

function j(id: string, statuses: string[]): JourneyLedger {
  return {
    id,
    dispatches: statuses.map((s, i) => ({
      repo: "aipe",
      package: `p${i}`,
      specialist: "Jesse",
      branch: "b",
      worktree: "w",
      status: s as JourneyLedger["dispatches"][number]["status"],
    })),
  };
}

const all: JourneyLedger[] = [
  j("j-20260101-aa", ["merged"]), // closed with work
  j("j-20260102-bb", ["merged"]), // closed with work
  j("j-20260103-cc", ["merged"]), // closed with work
  j("j-20260104-dd", ["merged"]), // closed with work
  j("j-20260105-ee", ["dispatched"]), // open
  j("j-20260106-ff", []), // empty (no dispatches)
];

test("default shows open-work journeys plus the N most recent CLOSED ones", () => {
  const { selected } = selectJourneys(all, { scope: "default", recentClosed: 2 });
  const ids = selected.map((l) => l.id).sort();
  // open: ee; recent closed (2 newest with work): dd, cc; empty ff excluded
  expect(ids).toEqual(["j-20260103-cc", "j-20260104-dd", "j-20260105-ee"]);
});

test("default elision names how many journeys were hidden and why (item 4)", () => {
  const { elision } = selectJourneys(all, { scope: "default", recentClosed: 2 });
  expect(elision).not.toBeNull();
  expect(elision!.hiddenJourneys).toBe(3); // aa, bb, ff hidden
  expect(elision!.totalJourneys).toBe(6);
  expect(elision!.reason).toContain("--all");
});

test("an empty journey never eats a recent-closed slot", () => {
  const { selected } = selectJourneys(all, { scope: "default", recentClosed: 5 });
  expect(selected.map((l) => l.id)).not.toContain("j-20260106-ff");
});

test("--all shows everything with no elision", () => {
  const { selected, elision } = selectJourneys(all, { scope: "all" });
  expect(selected).toHaveLength(6);
  expect(elision).toBeNull();
});

test("--journey selects exactly that one; unknown id → empty (no crash)", () => {
  expect(selectJourneys(all, { scope: "journey", journeyId: "j-20260105-ee" }).selected).toHaveLength(1);
  expect(selectJourneys(all, { scope: "journey", journeyId: "nope" }).selected).toHaveLength(0);
});

test("selection is newest-first (date-prefixed ids sort chronologically)", () => {
  const { selected } = selectJourneys(all, { scope: "all" });
  expect(selected[0]!.id).toBe("j-20260106-ff");
  expect(selected[selected.length - 1]!.id).toBe("j-20260101-aa");
});

test("no elision when nothing is hidden", () => {
  const two: JourneyLedger[] = [j("j-1", ["dispatched"]), j("j-2", ["escalated"])];
  expect(selectJourneys(two, { scope: "default" }).elision).toBeNull();
});
