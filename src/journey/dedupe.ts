// Migration/reconciliation for the jane/Jane duplicates already on disk
// (j-20260829-dp, item 5). Write-time normalization (normalize.ts) stops NEW
// duplicates; this reaches the ones already recorded across ~30 journeys. It
// canonicalizes each dispatch's identity and collapses rows that then share the
// same unit of work into one.
//
// TWO LOCKS the coordinator made non-negotiable:
//   1. A `merged` unit is IMMUTABLE. When a group's survivor is `merged`, the
//      merged record is kept BYTE-FOR-BYTE (its fields are never rewritten, not
//      even to normalize casing) and the duplicates STUCK behind it — the ones
//      the ledger gate could never close, left in `delivered` forever — are
//      dropped. Removing a stale duplicate OF a merged unit is reconciliation,
//      not a rewrite of the merged unit, so the guarantee holds.
//   2. Every existing ledger must still load intact. This is pure and total:
//      unknown fields ride through untouched, a legacy record with no envelope is
//      preserved, and a ledger with nothing to fix round-trips unchanged.
import { canonicalizeDispatch, normalizeRepo, normalizeSpecialist } from "./normalize";
import type { PersonaRegistryEntry } from "../hire-specialists/types";
import type { JourneyDispatch, JourneyLedger } from "./types";

// The same status precedence the ledger gate uses to judge "most advanced".
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
const rankOf = (s: string): number => RANK[s] ?? 0;

// The dedup identity is (normalized repo, normalized specialist, BRANCH). Branch
// is the reliable join: the coordinator's `Jane` + `--package` + bare-repo row and
// the specialist's `jane` + org-repo + NO-package row carry the SAME branch (the
// print the PE sent stressed "a mesma branch"), so keying on the package — the
// very field the self-registration omits — would fail to collapse them. Task can
// likewise be absent on one side; branch is present on every row.
function canonKey(d: JourneyDispatch, roster: PersonaRegistryEntry[]): string {
  const repo = normalizeRepo(d.repo);
  const spec = normalizeSpecialist(d.specialist, roster);
  return [repo, spec, d.branch ?? ""].join("\u0000");
}

// Non-identity (and dup-omitted identity) fields worth recovering onto the
// survivor from a dropped duplicate when the survivor lacks them: the
// `package`/`task` the self-registered row omitted (so the surviving unit ends up
// with the fuller identity), plus a PR/evidence/envelope that lived on the other row.
const RECOVERABLE: (keyof JourneyDispatch)[] = [
  "package", "task", "pr", "evidence", "harness", "model", "tier", "intensity", "mode",
  "sessionId", "worktree", "redirectReason", "blockedReason", "redispatchReason", "ciBypass",
];

export interface LedgerDedupe {
  ledger: JourneyLedger;
  changed: boolean;
  merges: { unit: string; kept: string; dropped: number }[];
  normalized: number; // non-merged records whose identity casing/prefix was fixed
}

export function dedupeLedger(ledger: JourneyLedger, roster: PersonaRegistryEntry[]): LedgerDedupe {
  const order: string[] = [];
  const groups = new Map<string, JourneyDispatch[]>();
  for (const d of ledger.dispatches) {
    const k = canonKey(d, roster);
    if (!groups.has(k)) {
      groups.set(k, []);
      order.push(k);
    }
    groups.get(k)!.push(d);
  }

  const out: JourneyDispatch[] = [];
  const merges: LedgerDedupe["merges"] = [];
  let normalized = 0;

  for (const k of order) {
    const g = groups.get(k)!;
    const survivor = g.reduce((best, d) => (rankOf(d.status) > rankOf(best.status) ? d : best), g[0]!);

    let record: JourneyDispatch;
    if (survivor.status === "merged") {
      // Lock 1 — a merged unit is final: keep it exactly, drop only the dups.
      record = survivor;
    } else {
      const canon = canonicalizeDispatch(survivor, roster);
      if (canon.repo !== survivor.repo || canon.specialist !== survivor.specialist) normalized++;
      record = canon;
      for (const d of g) {
        if (d === survivor) continue;
        for (const f of RECOVERABLE) {
          if (record[f] === undefined && d[f] !== undefined) (record as unknown as Record<string, unknown>)[f] = d[f];
        }
      }
    }
    out.push(record);
    if (g.length > 1) {
      const label = `${normalizeRepo(survivor.repo)}/${normalizeSpecialist(survivor.specialist, roster)}`;
      merges.push({ unit: label, kept: survivor.status, dropped: g.length - 1 });
    }
  }

  const changed = merges.length > 0 || normalized > 0;
  return { ledger: { ...ledger, dispatches: out }, changed, merges, normalized };
}
