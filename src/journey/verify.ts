// `aipe journey verify` — a deterministic reliability lint of a journey ledger.
// It audits the durable ledger for broken reliability invariants BEFORE the
// coordinator reports back to the PE: a done-claim without proof, a QA rejection
// left open, a delivery that never passed its gate, a merge that skipped QA, a
// consumer shipped against a producer that never landed, or an escalation still
// waiting on the PE. Pure and offline — no LLM, no network, no fs (the CLI
// supplies the ledger, the graph edges and the in-context unit set).
import { packageFqid } from "../context-brain/packages";
import type { RepoReleaseState } from "../release/types";
import type { PrChecksResolver } from "./checks";
import type { JourneyDispatch, JourneyLedger } from "./types";

export type VerifySeverity = "critical" | "warning";

export interface VerifyFinding {
  severity: VerifySeverity;
  code: string;
  unit: string;
  detail: string;
}

// Same ordering the ledger gate uses to judge a unit's "most advanced" state:
// removed < dispatched < (failed = escalated = redirected) < delivered < verified < merged.
// `redirected` sits with `failed`/`escalated` — none of the three represent
// forward progress toward a delivery, they are all "something non-nominal
// happened before this unit shipped" — so a `redirected` record correctly
// outranks a stale `dispatched` one when judging a multi-specialist unit's
// most-advanced state (a live redirect must never be shadowed by an older
// plain-`dispatched` record from another specialist on the same unit).
const RANK: Record<string, number> = {
  removed: 0,
  dispatched: 1,
  failed: 2,
  escalated: 2,
  redirected: 2,
  blocked: 2,
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

  // D5-twin — the journey's OWN units are exactly the units present in this
  // ledger. The dependency-landing gate below fires only for a producer that is
  // one of them, mirroring what PR #18 did in `dispatch validate`: an edge to a
  // repo outside the demand (a context-wide graph node the demand merely
  // consumes, e.g. the agentop binary from `agentistics`) is NOT an unmet
  // dependency — it can never reach verified/merged in this journey, so gating
  // on graph-node membership made it a permanent false critical.
  const journeyUnits = new Set(byUnit.keys());

  // Identity-per-task (j-20260826-uv): the QA-gate audits below are per TASK, not
  // per unit. Grouping by unit made a `verified`/`failed` on one task pair with
  // another task's delivery the moment two tasks shared a unit — a mis-paired gate
  // that reports safety (or danger) that is not there. Group by `(repo, package,
  // task)`; the finding still names the display unit. Task absent ⇒ gate key ==
  // unit, so a single-task journey is grouped exactly as before.
  const byGate = new Map<string, JourneyDispatch[]>();
  for (const d of ledger.dispatches) {
    const gateKey = `${packageFqid(d.repo, d.package)}\0${d.task ?? ""}`;
    (byGate.get(gateKey) ?? byGate.set(gateKey, []).get(gateKey)!).push(d);
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

  for (const [, records] of byGate) {
    const top = records.reduce((a, b) => ((RANK[b.status] ?? 0) > (RANK[a.status] ?? 0) ? b : a));
    const status = top.status;
    const unit = packageFqid(top.repo, top.package);

    // 2 — failed-open: QA rejected the delivery and it was never re-dispatched.
    // A sibling `dispatched` on the SAME task-group means the delivery IS being
    // re-worked (fail → re-dispatch) — not open, abandoned work. Only a task that
    // failed with no active re-dispatch is failed-open. This closes the false
    // positive where a QA `failed` and a dev `dispatched` on one unit (separate
    // specialist rows) were read as still-failed even though the dev was back on it.
    if (status === "failed" && !records.some((d) => d.status === "dispatched")) {
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

    // 4 — merged-skipped-qa: merged without ever clearing QA. The QA signal can
    // live in two shapes: a surviving `verified` record (multi-specialist units,
    // where history isn't collapsed) OR — the common case — the QA evidence that
    // `reconcile` inherits onto the merged record itself, since `recordDispatch`
    // upserts by (repo, package, specialist) and collapses a single specialist's
    // dispatched→delivered→verified→merged history into one `merged` record.
    if (status === "merged") {
      const qaCleared = records.some((d) => d.status === "verified") || top.evidence?.by === "qa";
      if (!qaCleared) {
        findings.push({
          severity: "warning",
          code: "merged-skipped-qa",
          unit,
          detail: "merged without a verified QA record",
        });
      }
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

    // 7 — blocked-open: the specialist declared itself stuck and is still
    // waiting on the coordinator. A warning, not a critical: it is unfinished
    // work needing an answer, not a broken invariant — but a journey is not
    // done while a unit sits blocked.
    if (status === "blocked") {
      findings.push({
        severity: "warning",
        code: "blocked-open",
        unit,
        detail: `blocked — waiting on the coordinator${top.blockedReason ? ` (${top.blockedReason})` : ""}`,
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
      if (!journeyUnits.has(producer)) continue; // outside this journey's demand — not ours to gate
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

// The release half of verify (j-20260830-zd). Verified-and-merged work that was
// never published is exactly the invariant this lint exists to expose — but it is
// a WARNING, never a critical: the code is correct and merged; what is missing is
// a promotion/release, a PE/coordinator action, not a defect. Blocking the journey
// (exit 1) on it would be wrong; leaving it invisible is worse. So it reads like
// escalated-open/blocked-open — surfaced, unfinished, but not broken.
//
// Pure: the CLI resolves the per-repo release state from local git and passes the
// map in, so this stays offline and testable. It fires once per repo that has
// merged work IN THIS JOURNEY — a repo's release backlog is only this journey's
// concern insofar as this journey contributed merged units to it. `unknown` is
// reported too (a distinct code): the house rule is to say "could not establish".
export function auditReleaseState(
  ledger: JourneyLedger,
  releaseStates: Map<string, RepoReleaseState>,
): VerifyFinding[] {
  // Repos with a unit whose most-advanced status is `merged` in this ledger.
  const byUnit = new Map<string, JourneyDispatch[]>();
  for (const d of ledger.dispatches) {
    const list = byUnit.get(d.repo) ?? [];
    list.push(d);
    byUnit.set(d.repo, list);
  }
  const findings: VerifyFinding[] = [];
  for (const [repo, records] of byUnit) {
    const top = records.reduce((a, b) => ((RANK[b.status] ?? 0) > (RANK[a.status] ?? 0) ? b : a));
    if (top.status !== "merged") continue;
    const rel = releaseStates.get(repo);
    if (!rel) continue; // resolution unavailable — abstain, never a guessed finding
    if (rel.state === "merged-unpublished") {
      findings.push({ severity: "warning", code: "merged-unpublished", unit: repo, detail: `merged but not yet published — ${rel.reason}` });
    } else if (rel.state === "unknown") {
      findings.push({ severity: "warning", code: "release-unverifiable", unit: repo, detail: `merged, publication state could not be established — ${rel.reason}` });
    }
  }
  return findings.sort((a, b) => a.unit.localeCompare(b.unit));
}

// The CI half of verify — kept separate from verifyJourney because it is the one
// audit that must talk to the forge (verifyJourney stays pure and offline). A
// delivered/verified unit (top status; `merged` is terminal, reconcile's domain)
// that names a PR and was NOT deliberately bypassed (`ciBypass`) has its checks
// re-resolved live: `red`/`pending` is a CRITICAL finding — the exact situation
// that let a green ledger sit atop a red workflow on PR #22. `green` is clean;
// `none`/`unknown` ABSTAIN (no finding) so a repo with no checks configured, or
// a forge we cannot reach, never becomes a false critical. The resolver is
// injected (the CLI wires the real gh); an offline caller gets an empty result.
export async function auditPrChecks(
  ledger: JourneyLedger,
  resolve: PrChecksResolver,
): Promise<VerifyFinding[]> {
  const byUnit = new Map<string, JourneyDispatch[]>();
  for (const d of ledger.dispatches) {
    const unit = packageFqid(d.repo, d.package);
    (byUnit.get(unit) ?? byUnit.set(unit, []).get(unit)!).push(d);
  }

  const findings: VerifyFinding[] = [];
  for (const [unit, records] of byUnit) {
    const top = records.reduce((a, b) => ((RANK[b.status] ?? 0) > (RANK[a.status] ?? 0) ? b : a));
    if (top.status !== "delivered" && top.status !== "verified") continue;
    if (!top.pr) continue;
    if (records.some((d) => d.ciBypass)) continue; // deliberate no-checks bypass — respected
    const verdict = await resolve(top.pr);
    if (verdict === "red") {
      findings.push({ severity: "critical", code: "ci-red", unit, detail: `"${top.status}" but PR checks are failing (red) — a green ledger over a red workflow` });
    } else if (verdict === "pending") {
      findings.push({ severity: "critical", code: "ci-pending", unit, detail: `"${top.status}" but PR checks have not concluded (still running)` });
    }
    // green → clean; none/unknown → abstain (never a guessed critical).
  }

  return findings.sort((a, b) => a.unit.localeCompare(b.unit));
}
