import { expect, test } from "bun:test";
import { renderStateBlock, STATE_BLOCK_MAX } from "../context-block";
import type { JourneyRow, StatusReport, UnitRow } from "../types";

function report(units: UnitRow[], journeys: JourneyRow[], waiting: StatusReport["waiting"] = []): StatusReport {
  return {
    workspace: "/ws",
    contextName: "blpsoares",
    scope: "all",
    journeys,
    units,
    waiting,
    releases: [],
    liveness: { source: "none", reliable: false, note: "" },
    pref: { auto: false, format: "detailed" },
    elision: null,
  };
}

const unit = (over: Partial<UnitRow>): UnitRow => ({
  journey: "j-1",
  fqid: "aipe",
  repo: "aipe",
  package: null,
  task: null,
  specialist: "Jesse",
  branch: "b",
  pr: null,
  status: "dispatched",
  mode: "session",
  sessionId: null,
  role: "dev-fullstack",
  liveness: null,
  hasEvidence: false,
  publishState: null,
  harness: null,
  model: null,
  tier: null,
  intensity: null,
  worktree: "w",
  ciBypass: null,
  ...over,
});

test("names open journeys, in-flight units, waiting-on-you and queued (item 8)", () => {
  const r = report(
    [unit({ specialist: "Jesse", fqid: "aipe", status: "dispatched" }), unit({ specialist: "Mike", fqid: "embark", status: "delivered" })],
    [
      { id: "j-1", specApproved: true, specVersion: 1, open: 2, done: 0, total: 2 },
      { id: "j-2", specApproved: true, specVersion: 1, open: 0, done: 0, total: 0 }, // queued
    ],
    [{ kind: "escalated", journey: "j-1", fqid: "aipe", specialist: "Jesse", detail: "open escalation" }],
  );
  const block = renderStateBlock(r);
  expect(block).toContain("1 open journey(s)");
  expect(block).toContain("2 unit(s) in flight");
  expect(block).toContain("1 waiting on you (1 escalated)");
  expect(block).toContain("1 queued");
  expect(block).toContain("Jesse·aipe");
  expect(block).toContain("aipe status");
});

test("the block is bounded to STATE_BLOCK_MAX even with very many in-flight units (budget)", () => {
  const many = Array.from({ length: 200 }, (_, i) => unit({ specialist: `Dev${i}`, fqid: `repo-${i}`, status: "dispatched" }));
  const r = report(many, [{ id: "j-1", specApproved: true, specVersion: 1, open: 200, done: 0, total: 200 }]);
  const block = renderStateBlock(r);
  expect(block.length).toBeLessThanOrEqual(STATE_BLOCK_MAX);
  // the counts and the pointer survive even when the names are trimmed
  expect(block).toContain("200 unit(s) in flight");
  expect(block).toContain("aipe status");
});

test("an empty workspace summarizes to zeros, never throws (item 6/8)", () => {
  const block = renderStateBlock(report([], []));
  expect(block).toContain("0 open journey(s)");
  expect(block).toContain("0 waiting on you");
  expect(block.length).toBeLessThanOrEqual(STATE_BLOCK_MAX);
});
