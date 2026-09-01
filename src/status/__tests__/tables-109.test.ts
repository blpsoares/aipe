// The three tables of #109. Each test here is a rule the PE paid for with a
// concrete confusion, so each names the confusion it prevents.
import { expect, test } from "bun:test";
import { askCell, cell, packageCell, taskLines, taskStatusCell, UNRECORDED, whenCell } from "../tables";
import type { UnitRow, WaitingItem } from "../types";

const row = (over: Partial<UnitRow>): UnitRow => ({
  journey: "j1", fqid: "demo", repo: "demo", package: null, task: "terminal",
  specialist: "Jesse", role: "dev-fullstack", branch: "b", pr: null,
  status: "dispatched", mode: null, sessionId: null, liveness: null,
  hasEvidence: false, publishState: null, harness: null, model: null, tier: null,
  intensity: null, worktree: "/wt", ciBypass: null,
  base: null, title: null, description: null, at: null,
  ...over,
});

test("dev and QA of the SAME task are ONE line — a single rejection must not look like two", () => {
  // The measured confusion: the PE asked "why so many rejections?" while looking
  // at exactly one, because the dev's row and the QA's row rendered separately.
  const lines = taskLines([
    row({ specialist: "Jesse", role: "dev-fullstack", status: "delivered", branch: "aipe/j1/jesse" }),
    row({ specialist: "Getz", role: "qa", status: "failed", branch: "aipe/j1/getz" }),
  ]);
  expect(lines).toHaveLength(1);
  // identity comes from the BUILDER — a QA row's branch is its own worktree, not
  // where the code being judged lives
  expect(lines[0]!.specialist).toBe("Jesse");
  expect(lines[0]!.branch).toBe("aipe/j1/jesse");
});

test("two tasks on one unit stay two lines — collapsing is per task, not per unit", () => {
  const lines = taskLines([
    row({ task: "terminal", status: "delivered" }),
    row({ task: "cores", status: "dispatched" }),
  ]);
  expect(lines).toHaveLength(2);
});

test("the status is the FURTHEST any row reached — a QA approval is not the dev's row to report", () => {
  const lines = taskLines([
    row({ specialist: "Jesse", role: "dev-fullstack", status: "delivered" }),
    row({ specialist: "Getz", role: "qa", status: "verified" }),
  ]);
  expect(lines[0]!.status).toBe("verified");
  expect(lines[0]!.specialist).toBe("Jesse"); // …while WHO stays the builder
});

test("a roster that names no role never silently promotes the QA row", () => {
  const lines = taskLines([
    row({ specialist: "Jesse", role: null, status: "delivered" }),
    row({ specialist: "Getz", role: null, status: "verified" }),
  ]);
  // no role information ⇒ fall back to the furthest row rather than guessing a
  // role from a name
  expect(lines[0]!.specialist).toBe("Getz");
});

test("status words are the PE's, not the ledger's", () => {
  expect(taskStatusCell("dispatched", null)).toBe("Designado");
  expect(taskStatusCell("delivered", null)).toBe("Entregue");
  expect(taskStatusCell("verified", null)).toBe("Aprovado");
  expect(taskStatusCell("merged", "published")).toBe("Integrado");
  // failed and abandoned must never collapse into one word
  expect(taskStatusCell("failed", null)).not.toBe(taskStatusCell("abandoned", null));
});

test("Integrado alone never claims it reached the user — that reading produced #94", () => {
  expect(taskStatusCell("merged", "merged-unpublished")).toBe("Integrado·não publicado");
  expect(taskStatusCell("merged", "published")).toBe("Integrado");
});

test("an unrecorded cell SAYS it is unrecorded — it is never blank and never a plausible default", () => {
  expect(cell(null)).toBe(UNRECORDED);
  expect(cell("  ")).toBe(UNRECORDED);
  expect(cell("dev")).toBe("dev");
  // a flat repo has no package; that is different from "not recorded"
  expect(packageCell(null)).toBe("—");
  expect(packageCell("serve")).toBe("serve");
});

test("time is ABSOLUTE and comes from a timestamp — never a duration someone typed", () => {
  // The defect: "~1h" written, then "~1h30" for the same item minutes later,
  // when the real age was 23 minutes. Both were estimates from memory, in the
  // one column whose job is to expose a stale request.
  expect(whenCell(null)).toBe(UNRECORDED);
  expect(whenCell("not a date")).toBe(UNRECORDED);
  const rendered = whenCell("2026-09-01T14:32:00Z");
  expect(rendered).not.toBe(UNRECORDED);
  expect(rendered).toMatch(/^\d{2}\/\d{2} \d{2}:\d{2}$/); // an instant, not a span
  expect(rendered).not.toContain("~");
});

test("the ask is what the PERSON must do, not the machine's word for its state", () => {
  const w = (over: Partial<WaitingItem>): WaitingItem => ({
    kind: "escalated", journey: "j1", fqid: "demo", specialist: "Getz",
    detail: "", sessionId: null, blocks: "demo", since: null, ...over,
  });
  expect(askCell(w({ kind: "escalated" }))).not.toContain("escalated");
  expect(askCell(w({ kind: "no-evidence" }))).not.toContain("no-evidence");
  // the specialist's own recorded words beat any phrasing here — they are why
  // the row exists
  expect(askCell(w({ kind: "blocked", detail: "o histórico entra no escopo?" }))).toContain(
    "o histórico entra no escopo?",
  );
});

// ── #106, the rule #109 inherits ─────────────────────────────────────────────
// A queue that hands the coordinator its own decision back stops being read, and
// then it stops protecting the case that matters. Measured: three journeys in
// one day, all closed BY the coordinator with the reason written by him, all
// still sitting in "waiting on you".
test("the coordinator's own redirect leaves the queue; an unrecorded origin stays", async () => {
  const { assemble } = await import("../assemble");
  const led = (origin?: "pe" | "coordinator") => [{
    id: "j1",
    dispatches: [{
      repo: "demo", specialist: "Jesse", branch: "b", worktree: "/wt",
      status: "redirected" as const, redirectReason: "muda o escopo para X",
      ...(origin ? { redirectOrigin: origin } : {}),
    }],
  }];
  const base = {
    workspace: "/w", contextName: "demo", scope: "all" as const,
    pref: { auto: false, format: "detailed" as const }, roster: [], policy: { authorizationTiers: [] },
    live: { sessions: [], reliable: false, source: "none" as const },
    releaseStates: new Map(),
  };

  // the PE steered → the coordinator must reconcile the spec → it is a pendency
  expect(assemble({ ...base, ledgers: led("pe") } as never).waiting).toHaveLength(1);
  // the coordinator steered → it IS the origin of the change → nothing to ask
  expect(assemble({ ...base, ledgers: led("coordinator") } as never).waiting).toHaveLength(0);
  // origin never recorded → surfaces. Silence does not buy a way out of a queue
  // whose entire job is that something unresolved stays visible.
  expect(assemble({ ...base, ledgers: led() } as never).waiting).toHaveLength(1);
});
