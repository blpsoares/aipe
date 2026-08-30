import { expect, test } from "bun:test";
import type { RepoReleaseState } from "../../release/types";
import type { JourneyDispatch, JourneyLedger } from "../types";
import { auditReleaseState } from "../verify";

const d = (over: Partial<JourneyDispatch>): JourneyDispatch => ({
  repo: "aipe",
  specialist: "Jesse",
  branch: "b",
  worktree: "w",
  status: "dispatched",
  ...over,
});

const rel = (repo: string, over: Partial<RepoReleaseState>): RepoReleaseState => ({
  repo,
  flow: "dev-then-main",
  state: "published",
  latestReleaseTag: "v1.0.0",
  unreleasedOnMain: 0,
  unpromotedOnDev: 0,
  reason: "",
  ...over,
});

test("a merged unit in a repo with unpublished backlog → a WARNING (never a critical)", () => {
  const ledger: JourneyLedger = { id: "j1", dispatches: [d({ status: "merged", evidence: { by: "qa", commands: ["x"], summary: "ok" } })] };
  const states = new Map([["aipe", rel("aipe", { state: "merged-unpublished", reason: "3 commit(s) merged into dev not yet in main" })]]);
  const f = auditReleaseState(ledger, states);
  expect(f).toHaveLength(1);
  expect(f[0]!.severity).toBe("warning");
  expect(f[0]!.code).toBe("merged-unpublished");
  expect(f[0]!.detail).toContain("3 commit(s) merged into dev");
});

test("a merged unit in a PUBLISHED repo → no finding", () => {
  const ledger: JourneyLedger = { id: "j1", dispatches: [d({ status: "merged" })] };
  const states = new Map([["aipe", rel("aipe", { state: "published" })]]);
  expect(auditReleaseState(ledger, states)).toHaveLength(0);
});

test("a main-direct repo whose merge IS published → no finding (both flows covered)", () => {
  const ledger: JourneyLedger = { id: "j1", dispatches: [d({ repo: "embark", status: "merged" })] };
  const states = new Map([["embark", rel("embark", { flow: "main-direct", state: "published", latestReleaseTag: null, reason: "no release tags — main head is the published state" })]]);
  expect(auditReleaseState(ledger, states)).toHaveLength(0);
});

test("publication state that could not be established → a WARNING that says so", () => {
  const ledger: JourneyLedger = { id: "j1", dispatches: [d({ status: "merged" })] };
  const states = new Map([["aipe", rel("aipe", { state: "unknown", reason: "could not be established — main was unreadable" })]]);
  const f = auditReleaseState(ledger, states);
  expect(f).toHaveLength(1);
  expect(f[0]!.severity).toBe("warning");
  expect(f[0]!.code).toBe("release-unverifiable");
  expect(f[0]!.detail).toContain("could not be established");
});

test("no merged unit → the release audit is silent even if the repo has backlog", () => {
  // The backlog is real, but this journey did not contribute merged work to it —
  // not this journey's finding to raise.
  const ledger: JourneyLedger = { id: "j1", dispatches: [d({ status: "delivered", evidence: { by: "dev", commands: ["x"], summary: "ok" } })] };
  const states = new Map([["aipe", rel("aipe", { state: "merged-unpublished", reason: "x" })]]);
  expect(auditReleaseState(ledger, states)).toHaveLength(0);
});

test("resolution unavailable for the repo → abstain, never a guessed finding", () => {
  const ledger: JourneyLedger = { id: "j1", dispatches: [d({ status: "merged" })] };
  expect(auditReleaseState(ledger, new Map())).toHaveLength(0);
});
