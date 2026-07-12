// Auto-detect merges: poll `gh pr view <url> --json state` for every delivered
// dispatch that carries a PR, and mark the ones GitHub reports as MERGED. Kept
// pure — the PR-state fetcher is injected so tests can run without gh/network;
// the CLI wires in the real `gh` via ghPrState.
import { listJourneys, readLedger, recordDispatch } from "./ledger";
import type { JourneyDispatch } from "./types";

export type PrState = "MERGED" | "OPEN" | "CLOSED" | null;

export type PrStateFetcher = (prUrl: string) => Promise<PrState>;

export interface ReconcileResult {
  journey: string;
  checked: number; // delivered dispatches with a PR that we polled
  merged: string[]; // PR urls newly marked merged
}

// Reconcile one journey: any open-but-shipped dispatch whose PR is MERGED becomes
// merged on the ledger. Both "delivered" and "verified" are polled — a unit that
// passed QA is `verified`, and its PR still merges later, so it must reconcile too
// (dispatched work isn't up for merge yet; escalated/failed/merged/removed are
// terminal here).
const RECONCILABLE = new Set(["delivered", "verified"]);

export async function reconcileJourney(
  workspaceDir: string,
  id: string,
  fetchState: PrStateFetcher,
): Promise<ReconcileResult> {
  const ledger = await readLedger(workspaceDir, id);
  const merged: string[] = [];
  let checked = 0;
  if (!ledger) return { journey: id, checked, merged };

  for (const d of ledger.dispatches) {
    if (!RECONCILABLE.has(d.status) || !d.pr) continue;
    checked++;
    const state = await fetchState(d.pr);
    if (state === "MERGED") {
      const next: JourneyDispatch = { ...d, status: "merged" };
      await recordDispatch(workspaceDir, id, next);
      merged.push(d.pr);
    }
  }
  return { journey: id, checked, merged };
}

// Reconcile every journey in the workspace.
export async function reconcileAll(
  workspaceDir: string,
  fetchState: PrStateFetcher,
): Promise<ReconcileResult[]> {
  const journeys = await listJourneys(workspaceDir);
  const out: ReconcileResult[] = [];
  for (const j of journeys) out.push(await reconcileJourney(workspaceDir, j.id, fetchState));
  return out;
}

// Real PR-state fetcher over the gh CLI. Returns null when gh fails (not
// installed, unauthenticated, unknown PR) so reconcile treats it as "unknown"
// and leaves the dispatch untouched rather than guessing.
export const ghPrState: PrStateFetcher = async (prUrl: string): Promise<PrState> => {
  try {
    const proc = Bun.spawn(["gh", "pr", "view", prUrl, "--json", "state"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    const code = await proc.exited;
    if (code !== 0) return null;
    const parsed = JSON.parse(out) as { state?: string };
    const state = (parsed.state ?? "").toUpperCase();
    if (state === "MERGED" || state === "OPEN" || state === "CLOSED") return state;
    return null;
  } catch {
    return null;
  }
};
