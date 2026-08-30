// The IO wrapper around the pure dedupeLedger (dedupe.ts): read the roster + every
// ledger, dedupe each, and (unless dry-run) write back only the ones that changed.
// The migration for the jane/Jane duplicates already on disk (j-20260829-dp §10).
import { listJourneys, writeLedger } from "./ledger";
import { dedupeLedger, type LedgerDedupe } from "./dedupe";
import { readPersonas } from "../hire-specialists/read-personas";

export interface DedupeRunResult {
  journey: string;
  merges: LedgerDedupe["merges"];
  normalized: number;
  wrote: boolean;
}

/** Dedupe one journey → written back when it changed (unless dryRun). */
export async function dedupeAll(workspaceDir: string, opts: { dryRun?: boolean } = {}): Promise<DedupeRunResult[]> {
  const roster = await readPersonas(workspaceDir);
  const ledgers = await listJourneys(workspaceDir);
  const out: DedupeRunResult[] = [];
  for (const ledger of ledgers) {
    const res = dedupeLedger(ledger, roster);
    let wrote = false;
    if (res.changed && !opts.dryRun) {
      await writeLedger(workspaceDir, res.ledger);
      wrote = true;
    }
    if (res.changed) out.push({ journey: ledger.id, merges: res.merges, normalized: res.normalized, wrote });
  }
  return out;
}
