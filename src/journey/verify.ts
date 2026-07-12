// `aipe journey verify` — a deterministic reliability lint of a journey ledger.
// It audits the durable ledger for broken reliability invariants BEFORE the
// coordinator reports back to the PE: a done-claim without proof, a QA rejection
// left open, a delivery that never passed its gate, a merge that skipped QA, a
// consumer shipped against a producer that never landed, or an escalation still
// waiting on the PE. Pure and offline — no LLM, no network, no fs (the CLI
// supplies the ledger, the graph edges and the in-context unit set).
import { packageFqid } from "../context-brain/packages";
import type { JourneyDispatch, JourneyLedger } from "./types";

export type VerifySeverity = "critical" | "warning";

export interface VerifyFinding {
  severity: VerifySeverity;
  code: string;
  unit: string;
  detail: string;
}

// Same ordering the ledger gate uses to judge a unit's "most advanced" state:
// removed < dispatched < (failed = escalated) < delivered < verified < merged.
const RANK: Record<string, number> = {
  removed: 0,
  dispatched: 1,
  failed: 2,
  escalated: 2,
  delivered: 3,
  verified: 4,
  merged: 5,
};

// The dependency edge types that mean "A depends on B's contract" (mirrors the
// dispatch law's landing gate).
const DEPENDENCY_EDGE_TYPES = new Set(["consumes", "imports"]);

// A delivered/verified record carries proof only when evidence is attached with
// at least one command and a non-blank summary (same test as the ledger gate).
function hasEvidence(d: JourneyDispatch): boolean {
  const ev = d.evidence;
  return !!ev && Array.isArray(ev.commands) && ev.commands.length > 0 && !!ev.summary?.trim();
}

export function verifyJourney(
  ledger: JourneyLedger,
  edges: { from: string; to: string; type: string }[],
  contextUnits: Set<string>,
): VerifyFinding[] {
  const findings: VerifyFinding[] = [];

  // Group every dispatch record by its unit (repo + package).
  const byUnit = new Map<string, JourneyDispatch[]>();
  for (const d of ledger.dispatches) {
    const unit = packageFqid(d.repo, d.package);
    const list = byUnit.get(unit) ?? [];
    list.push(d);
    byUnit.set(unit, list);
  }

  // 1 — no-evidence: a done-claim (delivered/verified) with no valid proof.
  for (const d of ledger.dispatches) {
    if ((d.status === "delivered" || d.status === "verified") && !hasEvidence(d)) {
      findings.push({
        severity: "critical",
        code: "no-evidence",
        unit: packageFqid(d.repo, d.package),
        detail: `"${d.status}" recorded with no evidence attached`,
      });
    }
  }

  for (const [unit, records] of byUnit) {
    const top = records.reduce((a, b) => ((RANK[b.status] ?? 0) > (RANK[a.status] ?? 0) ? b : a));
    const status = top.status;

    // 2 — failed-open: QA rejected the delivery and it was never re-dispatched.
    if (status === "failed") {
      findings.push({
        severity: "critical",
        code: "failed-open",
        unit,
        detail: "QA failed and the unit was not re-dispatched",
      });
    }

    // 3 — delivered-not-verified: shipped a delivery the QA gate never cleared.
    if (status === "delivered") {
      findings.push({
        severity: "warning",
        code: "delivered-not-verified",
        unit,
        detail: "delivered but never verified by QA",
      });
    }

    // 4 — merged-skipped-qa: merged without any verified record in its history.
    if (status === "merged" && !records.some((d) => d.status === "verified")) {
      findings.push({
        severity: "warning",
        code: "merged-skipped-qa",
        unit,
        detail: "merged without a verified QA record",
      });
    }

    // 6 — escalated-open: still waiting on the PE.
    if (status === "escalated") {
      findings.push({
        severity: "warning",
        code: "escalated-open",
        unit,
        detail: "escalated — waiting on the PE",
      });
    }
  }

  // Which units actually LANDED in this ledger (verified/merged, most-advanced).
  const landed = new Set<string>();
  for (const [unit, records] of byUnit) {
    const top = records.reduce((a, b) => ((RANK[b.status] ?? 0) > (RANK[a.status] ?? 0) ? b : a));
    if (top.status === "verified" || top.status === "merged") landed.add(unit);
  }

  // 5 — dependency-not-landed: a shipped consumer whose in-context producer
  // never landed. Report each (consumer→producer) once.
  const seen = new Set<string>();
  for (const [unit, records] of byUnit) {
    const top = records.reduce((a, b) => ((RANK[b.status] ?? 0) > (RANK[a.status] ?? 0) ? b : a));
    const shipped = top.status === "delivered" || top.status === "verified" || top.status === "merged";
    if (!shipped) continue;
    for (const edge of edges) {
      if (edge.from !== unit || !DEPENDENCY_EDGE_TYPES.has(edge.type)) continue;
      const producer = edge.to;
      if (!contextUnits.has(producer)) continue; // external dependency — not ours to gate
      if (landed.has(producer)) continue; // producer landed → the consumer is safe
      const key = `${unit}->${producer}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push({
        severity: "critical",
        code: "dependency-not-landed",
        unit,
        detail: `shipped against ${producer}, which never landed (verified/merged)`,
      });
    }
  }

  // Critical findings first, then by unit (stable within a bucket).
  const sevRank = (s: VerifySeverity): number => (s === "critical" ? 0 : 1);
  return findings.sort((a, b) => sevRank(a.severity) - sevRank(b.severity) || a.unit.localeCompare(b.unit));
}
