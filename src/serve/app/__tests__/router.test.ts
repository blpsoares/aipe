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
});

test("hashTarget rejects an unknown path (guards against a bogus manual hash)", () => {
  expect(hashTarget("#/does-not-exist")).toBeNull();
  expect(hashTarget("#/../etc")).toBeNull();
});

// j-20260830-r5, aceite #3: the reorg (#44) removed "/activity" as its own
// screen — that content now lives inside Agora. Anyone who still has that URL
// (bookmark, old link) must not hit an error or a blank page.
afterEach(() => {
  navigate("/");
});

test("the removed '/activity' path is not a known route (its content now lives inside Agora, not on its own screen)", () => {
  expect(hashTarget("#/activity")).toBeNull();
});

test("navigating to the old '/activity' path lands on Agora, not an error or blank page", () => {
  navigate("/activity");
  expect(currentPath.value).toBe("/");
});
