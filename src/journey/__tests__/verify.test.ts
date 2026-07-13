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
  const contextUnits = new Set(["embark/worker", "embark/api"]);
  expect(verifyJourney(ledger, edges, contextUnits)).toEqual([]);
});

test("no-evidence (critical): a delivered record with no evidence", () => {
  const findings = verifyJourney(ledgerOf(d({ status: "delivered" })), [], new Set());
  // most-advanced is delivered → also warns delivered-not-verified; the critical is first
  expect(findings[0]).toMatchObject({ severity: "critical", code: "no-evidence", unit: "embark" });
  expect(findings.map((f) => f.code)).toContain("no-evidence");
});

test("no-evidence (critical): blank summary is not proof", () => {
  const bad = d({ status: "verified", evidence: { by: "qa", commands: ["bun test"], summary: "  " } });
  const findings = verifyJourney(ledgerOf(bad), [], new Set());
  expect(findings.map((f) => f.code)).toContain("no-evidence");
});

test("failed-open (critical): QA failed and never re-dispatched", () => {
  // the delivered record was upserted to failed (same specialist), so the unit's
  // most-advanced — and only — record is failed: QA rejected it, never redone
  const findings = verifyJourney(ledgerOf(d({ status: "failed" })), [], new Set());
  expect(findings).toHaveLength(1);
  expect(findings[0]).toMatchObject({ severity: "critical", code: "failed-open", unit: "embark" });
});

test("delivered-not-verified (warning): most-advanced is exactly delivered", () => {
  const findings = verifyJourney(ledgerOf(d({ status: "delivered", evidence: devEv })), [], new Set());
  expect(findings).toHaveLength(1);
  expect(findings[0]).toMatchObject({ severity: "warning", code: "delivered-not-verified" });
});

test("merged-skipped-qa (warning): merged with no verified record anywhere", () => {
  const ledger = ledgerOf(
    d({ status: "dispatched" }),
    d({ status: "delivered", evidence: devEv }),
    d({ status: "merged", pr: "http://pr/1" }),
  );
  const findings = verifyJourney(ledger, [], new Set());
  expect(findings.map((f) => f.code)).toContain("merged-skipped-qa");
});

test("merged WITH a verified record is not flagged", () => {
  const ledger = ledgerOf(
    d({ status: "verified", evidence: qaEv }),
    d({ status: "merged", pr: "http://pr/1" }),
  );
  expect(verifyJourney(ledger, [], new Set())).toEqual([]);
});

test("a REAL (collapsed) merged unit carrying QA evidence is not flagged merged-skipped-qa", () => {
  // `recordDispatch` upserts by (repo, package, specialist), so a unit that went
  // dispatched→delivered→verified→merged with ONE specialist collapses to a single
  // record: `merged`, carrying the QA evidence that reconcile inherited from the
  // verified record. There is NO surviving `verified` record — the QA signal lives
  // in `evidence.by`, which is what the check must key on.
  const ledger = ledgerOf(d({ status: "merged", evidence: qaEv, pr: "http://pr/1" }));
  expect(verifyJourney(ledger, [], new Set()).map((f) => f.code)).not.toContain("merged-skipped-qa");
});

test("dependency-not-landed (critical): shipped consumer, in-context producer never landed", () => {
  const ledger = ledgerOf(
    d({ repo: "embark", package: "worker", status: "verified", evidence: qaEv }),
    // producer is only dispatched — never landed
    d({ repo: "embark", package: "api", status: "dispatched" }),
  );
  const edges = [{ from: "embark/worker", to: "embark/api", type: "consumes" }];
  const contextUnits = new Set(["embark/worker", "embark/api"]);
  const findings = verifyJourney(ledger, edges, contextUnits);
  const dep = findings.filter((f) => f.code === "dependency-not-landed");
  expect(dep).toHaveLength(1);
  expect(dep[0]).toMatchObject({ severity: "critical", unit: "embark/worker" });
  expect(dep[0]!.detail).toContain("embark/api");
});

test("dependency on an EXTERNAL producer (not in context) is not gated", () => {
  const ledger = ledgerOf(d({ repo: "embark", package: "worker", status: "verified", evidence: qaEv }));
  const edges = [{ from: "embark/worker", to: "third-party/lib", type: "imports" }];
  const contextUnits = new Set(["embark/worker"]);
  expect(verifyJourney(ledger, edges, contextUnits)).toEqual([]);
});

test("escalated-open (warning): waiting on the PE", () => {
  const findings = verifyJourney(ledgerOf(d({ status: "escalated" })), [], new Set());
  expect(findings).toHaveLength(1);
  expect(findings[0]).toMatchObject({ severity: "warning", code: "escalated-open" });
});

test("findings are ordered critical-first, then by unit", () => {
  const ledger = ledgerOf(
    d({ repo: "embark", package: "web", status: "escalated" }), // warning
    d({ repo: "embark", package: "api", status: "delivered" }), // critical (no-evidence) + warning (delivered-not-verified)
  );
  const findings = verifyJourney(ledger, [], new Set());
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
