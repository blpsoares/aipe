import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import { run } from "../cli";
import type { DispatchEvidence, JourneyDispatch, JourneyLedger } from "../types";
import { verifyJourney } from "../verify";

const devEv: DispatchEvidence = { by: "dev", commands: ["bun test"], summary: "42 pass, 0 fail" };
const qaEv: DispatchEvidence = { by: "qa", commands: ["bun test", "drove the app"], summary: "checkout works end to end" };

function ledgerOf(...dispatches: JourneyDispatch[]): JourneyLedger {
  return { id: "j1", dispatches };
}

const d = (over: Partial<JourneyDispatch>): JourneyDispatch => ({
  repo: "embark",
  specialist: "Joaquim",
  branch: "b",
  worktree: "w",
  status: "dispatched",
  ...over,
});

// ── the pure function ────────────────────────────────────────────────────────

test("a CLEAN journey (dispatched→delivered→verified→merged, producer landed) yields no findings", () => {
  const ledger = ledgerOf(
    d({ repo: "embark", package: "worker", status: "dispatched" }),
    d({ repo: "embark", package: "worker", status: "delivered", evidence: devEv }),
    d({ repo: "embark", package: "worker", status: "verified", evidence: qaEv }),
    d({ repo: "embark", package: "worker", status: "merged", pr: "http://pr/1" }),
    // the producer this consumer depends on, landed (verified)
    d({ repo: "embark", package: "api", status: "verified", evidence: qaEv }),
  );
  const edges = [{ from: "embark/worker", to: "embark/api", type: "consumes" }];
  expect(verifyJourney(ledger, edges)).toEqual([]);
});

test("no-evidence (critical): a delivered record with no evidence", () => {
  const findings = verifyJourney(ledgerOf(d({ status: "delivered" })), []);
  // most-advanced is delivered → also warns delivered-not-verified; the critical is first
  expect(findings[0]).toMatchObject({ severity: "critical", code: "no-evidence", unit: "embark" });
  expect(findings.map((f) => f.code)).toContain("no-evidence");
});

test("no-evidence (critical): blank summary is not proof", () => {
  const bad = d({ status: "verified", evidence: { by: "qa", commands: ["bun test"], summary: "  " } });
  const findings = verifyJourney(ledgerOf(bad), []);
  expect(findings.map((f) => f.code)).toContain("no-evidence");
});

test("no-evidence (critical): commands that are all empty/whitespace are not proof", () => {
  // The READ gate must mirror the ledger's WRITE gate: a command that is empty or
  // whitespace is not a command run. A ledger carrying `commands: ["", "  "]` with
  // a plausible summary is a bare self-report dressed as evidence — verify must
  // still flag it no-evidence, or a hand-edited/legacy ledger clears the audit.
  const bad = d({ status: "verified", evidence: { by: "qa", commands: ["", "   "], summary: "fiz tudo, confia" } });
  const findings = verifyJourney(ledgerOf(bad), []);
  expect(findings.map((f) => f.code)).toContain("no-evidence");
});

// Finding A (whole-branch review): `RANK` used to omit `redirected` entirely,
// so it tied with `removed` (rank 0) when picking a unit's "most advanced"
// record across specialists — a stale `dispatched` record from another
// specialist on the same unit could shadow a live redirect. `redirected` now
// ranks with `failed`/`escalated` (2), above a plain `dispatched` (1). None of
// verifyJourney's finding codes currently key off "redirected" as `top`
// (see the RANK comment in verify.ts), so this is exercised here as what IS
// observable: a redirected unit is never treated as done/shipped, and by
// itself produces no findings — it is legitimate in-flight work, not a
// broken invariant.
test("redirected: not shipped, not done, produces no findings by itself", () => {
  const findings = verifyJourney(
    ledgerOf(d({ status: "redirected", redirectReason: "PE changed direction mid-flight" })),
    [{ from: "embark", to: "embark", type: "consumes" }],
  );
  expect(findings).toEqual([]);
});

test("redirected does not mask a stale dispatched record from another specialist as more advanced", () => {
  // Two specialists on the same unit: one still plain "dispatched", the other
  // just "redirected" — the redirect must be picked as the unit's current
  // state, not shadowed by the older dispatched record.
  const ledger = ledgerOf(
    d({ specialist: "Ana", status: "dispatched" }),
    d({ specialist: "Bia", status: "redirected", redirectReason: "PE changed direction mid-flight" }),
  );
  // Neither record is a broken invariant, so this must still be clean — the
  // real assertion is that this doesn't throw and stays silent, proving
  // `redirected` participates in rank comparison rather than being coerced
  // to 0 (which used to tie it with `removed`, the lowest possible rank).
  expect(verifyJourney(ledger, [])).toEqual([]);
});

test("failed-open (critical): QA failed and never re-dispatched", () => {
  // the delivered record was upserted to failed (same specialist), so the unit's
  // most-advanced — and only — record is failed: QA rejected it, never redone
  const findings = verifyJourney(ledgerOf(d({ status: "failed" })), []);
  expect(findings).toHaveLength(1);
  expect(findings[0]).toMatchObject({ severity: "critical", code: "failed-open", unit: "embark" });
});

test("delivered-not-verified (warning): most-advanced is exactly delivered", () => {
  const findings = verifyJourney(ledgerOf(d({ status: "delivered", evidence: devEv })), []);
  expect(findings).toHaveLength(1);
  expect(findings[0]).toMatchObject({ severity: "warning", code: "delivered-not-verified" });
});

test("merged-skipped-qa (warning): merged with no verified record anywhere", () => {
  const ledger = ledgerOf(
    d({ status: "dispatched" }),
    d({ status: "delivered", evidence: devEv }),
    d({ status: "merged", pr: "http://pr/1" }),
  );
  const findings = verifyJourney(ledger, []);
  expect(findings.map((f) => f.code)).toContain("merged-skipped-qa");
});

test("merged WITH a verified record is not flagged", () => {
  const ledger = ledgerOf(
    d({ status: "verified", evidence: qaEv }),
    d({ status: "merged", pr: "http://pr/1" }),
  );
  expect(verifyJourney(ledger, [])).toEqual([]);
});

test("a REAL (collapsed) merged unit carrying QA evidence is not flagged merged-skipped-qa", () => {
  // `recordDispatch` upserts by (repo, package, specialist), so a unit that went
  // dispatched→delivered→verified→merged with ONE specialist collapses to a single
  // record: `merged`, carrying the QA evidence that reconcile inherited from the
  // verified record. There is NO surviving `verified` record — the QA signal lives
  // in `evidence.by`, which is what the check must key on.
  const ledger = ledgerOf(d({ status: "merged", evidence: qaEv, pr: "http://pr/1" }));
  expect(verifyJourney(ledger, []).map((f) => f.code)).not.toContain("merged-skipped-qa");
});

test("dependency-not-landed (critical): shipped consumer, in-context producer never landed", () => {
  const ledger = ledgerOf(
    d({ repo: "embark", package: "worker", status: "verified", evidence: qaEv }),
    // producer is only dispatched — never landed
    d({ repo: "embark", package: "api", status: "dispatched" }),
  );
  const edges = [{ from: "embark/worker", to: "embark/api", type: "consumes" }];
  const findings = verifyJourney(ledger, edges);
  const dep = findings.filter((f) => f.code === "dependency-not-landed");
  expect(dep).toHaveLength(1);
  expect(dep[0]).toMatchObject({ severity: "critical", unit: "embark/worker" });
  expect(dep[0]!.detail).toContain("embark/api");
});

test("dependency on an EXTERNAL producer (not in context) is not gated", () => {
  const ledger = ledgerOf(d({ repo: "embark", package: "worker", status: "verified", evidence: qaEv }));
  const edges = [{ from: "embark/worker", to: "third-party/lib", type: "imports" }];
  expect(verifyJourney(ledger, edges)).toEqual([]);
});

// D5-twin — the regression. The graph is context-wide, so a producer can be a
// real graph node the demand merely CONSUMES (e.g. the agentop binary from
// agentistics) without being a unit of THIS journey. Gating on graph-node
// membership fired a permanent false critical for exactly that edge; gating on
// the journey's own units (the ledger's units) must leave it silent — while a
// genuine in-journey producer still fires (previous test).
test("D5-twin: a producer that is a graph node but NOT a unit of this journey is not gated", () => {
  const ledger = ledgerOf(d({ repo: "aipe", status: "verified", evidence: qaEv }));
  // aipe consumes agentistics — a real repo in the workspace graph, but not a
  // unit of this demand, so it can never reach verified/merged here.
  const edges = [{ from: "aipe", to: "agentistics", type: "consumes" }];
  const findings = verifyJourney(ledger, edges);
  expect(findings.filter((f) => f.code === "dependency-not-landed")).toEqual([]);
});

// ── Identity-per-task: the QA gate is per task (j-20260826-uv) ──

// CASE 1 (coordinator field evidence, j-20260826-fi): the audit grouped by UNIT
// and picked one top by RANK, so a QA `failed` (one piece of work) ranked above a
// dev `dispatched` (the re-worked delivery) on the same unit and reported
// failed-open — a false critical, since the unit WAS re-dispatched. A `failed`
// with an active re-dispatch on its task-group is not open work; it is being
// redone.
test("CASE 1: a QA failed does NOT report failed-open when the dev is re-dispatched on the same unit", () => {
  const ledger = ledgerOf(
    d({ repo: "agentistics", package: "tui", specialist: "Skyler", status: "dispatched" }),
    d({ repo: "agentistics", package: "tui", specialist: "Flynn", status: "failed", evidence: qaEv }),
  );
  expect(verifyJourney(ledger, []).filter((f) => f.code === "failed-open")).toEqual([]);
});

test("failed-open STILL fires when a task's failure was NOT re-dispatched", () => {
  // no sibling `dispatched` on the task-group → genuinely open, must fire.
  const findings = verifyJourney(ledgerOf(d({ status: "failed" })), []);
  expect(findings.filter((f) => f.code === "failed-open")).toHaveLength(1);
});

// Item 3 (the symmetric danger): a `verified` on one task must not clear another.
// Grouping by unit let task A's verified mask task B's un-verified delivery —
// reporting safety that is not there. Per-task grouping surfaces task B.
test("a verified on task A does not hide task B's delivered-not-verified on the same unit", () => {
  const ledger = ledgerOf(
    d({ repo: "aipe", specialist: "Mike", task: "gate-pr24", status: "verified", evidence: qaEv }),
    d({ repo: "aipe", specialist: "Mike", task: "gate-pr23", status: "delivered", evidence: qaEv }),
  );
  const findings = verifyJourney(ledger, []);
  expect(findings.filter((f) => f.code === "delivered-not-verified")).toHaveLength(1);
});

test("two tasks each cleanly verified on one unit yield no findings", () => {
  const ledger = ledgerOf(
    d({ repo: "aipe", specialist: "Mike", task: "gate-pr24", status: "verified", evidence: qaEv }),
    d({ repo: "aipe", specialist: "Mike", task: "gate-pr23", status: "verified", evidence: qaEv }),
  );
  expect(verifyJourney(ledger, [])).toEqual([]);
});

test("escalated-open (warning): waiting on the PE", () => {
  const findings = verifyJourney(ledgerOf(d({ status: "escalated" })), []);
  expect(findings).toHaveLength(1);
  expect(findings[0]).toMatchObject({ severity: "warning", code: "escalated-open" });
});

test("blocked-open (warning): a specialist waiting on the coordinator, with its reason", () => {
  const findings = verifyJourney(ledgerOf(d({ status: "blocked", blockedReason: "need the API key" })), []);
  expect(findings).toHaveLength(1);
  expect(findings[0]).toMatchObject({ severity: "warning", code: "blocked-open", unit: "embark" });
  expect(findings[0]!.detail).toContain("need the API key");
});

test("findings are ordered critical-first, then by unit", () => {
  const ledger = ledgerOf(
    d({ repo: "embark", package: "web", status: "escalated" }), // warning
    d({ repo: "embark", package: "api", status: "delivered" }), // critical (no-evidence) + warning (delivered-not-verified)
  );
  const findings = verifyJourney(ledger, []);
  expect(findings[0]!.severity).toBe("critical");
  // criticals come before warnings
  const firstWarning = findings.findIndex((f) => f.severity === "warning");
  expect(findings.slice(0, firstWarning).every((f) => f.severity === "critical")).toBe(true);
});

// ── the CLI (exit codes + real fs) ───────────────────────────────────────────

async function writeLedger(dir: string, ledger: JourneyLedger): Promise<void> {
  await mkdir(join(dir, ".aipe", "journeys"), { recursive: true });
  await writeFile(
    join(dir, ".aipe", "journeys", `${ledger.id}.yaml`),
    stringify({ id: ledger.id, dispatches: ledger.dispatches }),
    "utf8",
  );
}

async function writeGraph(dir: string): Promise<void> {
  await mkdir(join(dir, ".aipe", "relations"), { recursive: true });
  const graph = {
    nodes: [
      { fqid: "embark/worker", repo: "embark", package: "worker", stack: ["ts"] },
      { fqid: "embark/api", repo: "embark", package: "api", stack: ["ts"] },
    ],
    edges: [
      { from: "embark/worker", to: "embark/api", type: "consumes", perspectives: [{ detail: "calls the api", evidence: "import" }] },
    ],
  };
  await writeFile(join(dir, ".aipe", "relations", "graph.yaml"), stringify(graph), "utf8");
}

test("CLI: --journey required", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-verify-"));
  try {
    expect(await run(["verify", "--workspace", dir])).toBe(1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CLI: missing ledger → exit 1", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-verify-"));
  try {
    expect(await run(["verify", "--journey", "nope", "--workspace", dir])).toBe(1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CLI: a critical finding returns 1", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-verify-"));
  try {
    // worker shipped (verified) but its in-context producer api never landed
    await writeLedger(dir, ledgerOf(
      d({ repo: "embark", package: "worker", status: "verified", evidence: qaEv }),
      d({ repo: "embark", package: "api", status: "dispatched" }),
    ));
    await writeGraph(dir);
    expect(await run(["verify", "--journey", "j1", "--workspace", dir])).toBe(1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CLI: a clean journey returns 0", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-verify-"));
  try {
    await writeLedger(dir, ledgerOf(
      d({ repo: "embark", package: "worker", status: "verified", evidence: qaEv }),
      d({ repo: "embark", package: "api", status: "merged", pr: "http://pr/1" }),
      d({ repo: "embark", package: "api", status: "verified", evidence: qaEv }),
    ));
    await writeGraph(dir);
    expect(await run(["verify", "--journey", "j1", "--workspace", dir])).toBe(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
