import "./setup";
import { expect, test, afterEach } from "bun:test";
import { hashTarget, navigate, currentPath } from "../runtime/router";

// The interface-sweep finding: browser back/forward to the Floor desynced the
// topbar + active nav. Root cause — navigate("/") writes the hash "#/", and the
// old pathFromHash() stripped that to "" and returned null, so the hashchange
// handler ignored the event: currentPath stayed on the previous view while the
// URL sat at the Floor. hashTarget maps an empty/"#/" hash to the Floor.

test("hashTarget resolves an empty or bare hash to the Floor (back-to-Floor no longer desyncs)", () => {
  expect(hashTarget("")).toBe("/");
  expect(hashTarget("#")).toBe("/");
  expect(hashTarget("#/")).toBe("/");
});

test("hashTarget resolves a known view hash to its path", () => {
  expect(hashTarget("#/team")).toBe("/team");
  expect(hashTarget("#/settings")).toBe("/settings");
  expect(hashTarget("#/guide")).toBe("/guide");
  expect(hashTarget("#/board")).toBe("/board"); // the board's own page (j-20260830-sk)
});

test("hashTarget rejects an unknown path (guards against a bogus manual hash)", () => {
  expect(hashTarget("#/does-not-exist")).toBeNull();
  expect(hashTarget("#/../etc")).toBeNull();
});

// j-20260830-sk, brief item 3: the board now has its own page at "/board", and
// the old "/activity" URL (the board's original home before it was folded into
// Agora) redirects there. Anyone still holding that URL (bookmark, old link)
// lands on the board's page — never an error, a blank page, or the wrong screen.
afterEach(() => {
  navigate("/");
});

test("the old '/activity' hash redirects to the board's own page (not null, not blank)", () => {
  expect(hashTarget("#/activity")).toBe("/board");
});

test("navigating to the old '/activity' path lands on the board page (/board)", () => {
  navigate("/activity");
  expect(currentPath.value).toBe("/board");
});
