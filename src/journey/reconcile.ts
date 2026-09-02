// Auto-detect merges: poll `gh pr view <url> --json state` for every delivered
// dispatch that carries a PR, and mark the ones GitHub reports as MERGED. Kept
// pure — the PR-state fetcher is injected so tests can run without gh/network;
// the CLI wires in the real `gh` via ghPrState.
import { listJourneys, readLedger, writeLedger } from "./ledger";
import type { JourneyDispatch } from "./types";
import { applyLandingCloses } from "./land";
import { dedupeLedger } from "./dedupe";
import { parsePrUrl } from "../forge/slug";
import { readPersonas } from "../hire-specialists/read-personas";
import type { PersonaRegistryEntry } from "../hire-specialists/types";

export type PrState = "MERGED" | "OPEN" | "CLOSED" | null;

export type PrStateFetcher = (prUrl: string) => Promise<PrState>;

export interface ReconcileResult {
  journey: string;
  checked: number; // delivered dispatches with a PR that we polled
  merged: string[]; // PR urls newly marked merged
  collapsed: number; // duplicate/phantom rows dropped by the pre-merge cleanup (#97/#83)
}

// Reconcile one journey: any open-but-shipped dispatch whose PR is MERGED becomes
// merged on the ledger. Both "delivered" and "verified" are polled — a unit that
// passed QA is `verified`, and its PR still merges later, so it must reconcile too
// (dispatched work isn't up for merge yet; escalated/failed/merged/removed are
// terminal here).
const RECONCILABLE = new Set(["delivered", "verified"]);

// #97 — mesclar fecha a UNIDADE inteira, não só a linha do dev. A merge is
// detected here; closing it must also drop the phantoms the unit accumulated —
// a QA `verified`/re-gate row sharing the PR, a case-variant (`mike` after
// `Mike`), the coordinator's package/bare-repo split of one branch, and a stale
// `redirected` sibling that never landed anything of its own. `dedupeLedger`
// (branch-keyed, roster-canonical) already collapses each of these onto the
// unit's most-advanced survivor; running it BEFORE marking merged is the order
// the immutability rule demands (a `merged` survivor is kept byte-for-byte and
// its stuck duplicates are reconciled away, never rewritten — #83's note that
// "a limpeza tem que acontecer ANTES do merge"). Then every reconcilable
// survivor whose PR is MERGED lands `merged`, and the whole ledger is written
// once — so nothing is left `verified`/`delivered`/`redirected` to keep lying in
// the "precisa de você" queue after the work has already landed.
export async function reconcileJourney(
  workspaceDir: string,
  id: string,
  fetchState: PrStateFetcher,
  roster?: PersonaRegistryEntry[],
): Promise<ReconcileResult> {
  const ledger = await readLedger(workspaceDir, id);
  const merged: string[] = [];
  let checked = 0;
  if (!ledger) return { journey: id, checked, merged, collapsed: 0 };

  // Cleanup BEFORE the merge: collapse the duplicate/phantom rows so a re-gate or
  // a case/package variant can never linger behind the merged unit.
  const rs = roster ?? (await readPersonas(workspaceDir));
  const dd = dedupeLedger(ledger, rs);
  const collapsed = dd.merges.reduce((n, m) => n + m.dropped, 0);

  // Mark merges on the (cleaned) rows in memory, then write the whole ledger once.
  const dispatches = dd.ledger.dispatches.map((d) => ({ ...d }));

  // A unit's QA standing, by unit rather than by row: the dev delivers on its
  // own row and the QA records its verdict on a separate one, so both the round
  // reached and the round passed are a MAX across the unit's rows.
  // Keyed by (repo, package, TASK) — the same identity the write gate scopes to.
  // Unit scope here reopened, on the forge path, exactly the leak this stamp was
  // written to close: task t1's QA pass covered task t2's merge, and t2 was never
  // verified by anyone. The write gate refused it; reconcile stamped nothing.
  const unitKey = (d: JourneyDispatch): string => `${d.repo}\u0000${d.package ?? ""}\u0000${d.task ?? ""}`;
  const roundBy = new Map<string, number>();
  const passedBy = new Map<string, number>();
  for (const d of dispatches) {
    const k = unitKey(d);
    roundBy.set(k, Math.max(roundBy.get(k) ?? 1, d.round ?? 1));
    // A `closed` pass still counts — see verify.ts: closing is what a landing
    // does to a moot record, not a retraction. Only `failed` takes it back.
    if (d.status === "verified" || d.status === "closed") passedBy.set(k, Math.max(passedBy.get(k) ?? 0, d.verifiedRound ?? 0));
    else passedBy.set(k, passedBy.get(k) ?? 0);
  }

  // #97 — the landings this pass produced, so the unit-closing cascade runs on
  // the FORGE path too. It lives in `recordDispatch` for the guarded path, and
  // this function writes with `writeLedger` directly — so putting it in one and
  // not the other would have left the rule holding only where a human types it,
  // which is the shape that has cost this repo a whole day. Verified by driving
  // the real `journey reconcile`, not by trusting the unit tests.
  const landedIndexes: number[] = [];

  for (const d of dispatches) {
    if (!RECONCILABLE.has(d.status) || !d.pr) continue;
    checked++;
    const state = await fetchState(d.pr);
    if (state === "MERGED") {
      d.status = "merged";
      // The forge merged it; that is a fact and it is recorded as one. But a
      // merge with no current-round QA pass is the exact thing the write gate
      // refuses, and reconcile is the path that bypasses that gate — so the gap
      // is STAMPED rather than absorbed. `journey verify` fails on it, which is
      // what keeps "every finished task is tested" from being quietly true only
      // on the paths that happen to go through the CLI.
      const k = unitKey(d);
      if ((passedBy.get(k) ?? 0) < (roundBy.get(k) ?? 1)) d.qaGap = true;
      merged.push(d.pr);
      landedIndexes.push(dispatches.indexOf(d));
    }
  }

  let finalDispatches = dispatches;
  for (const i of landedIndexes) {
    finalDispatches = applyLandingCloses(finalDispatches, i).dispatches;
  }

  if (dd.changed || merged.length > 0) {
    await writeLedger(workspaceDir, { ...dd.ledger, dispatches: finalDispatches });
  }
  return { journey: id, checked, merged, collapsed };
}

// Reconcile every journey in the workspace. Reads the roster once and threads it
// into each journey so the pre-merge cleanup canonicalizes names consistently.
export async function reconcileAll(
  workspaceDir: string,
  fetchState: PrStateFetcher,
): Promise<ReconcileResult[]> {
  const roster = await readPersonas(workspaceDir);
  const journeys = await listJourneys(workspaceDir);
  const out: ReconcileResult[] = [];
  for (const j of journeys) out.push(await reconcileJourney(workspaceDir, j.id, fetchState, roster));
  return out;
}

// The gh args for `pr view` (without the leading "gh"), BY NUMBER with an
// explicit `--repo`, never handing gh the URL and trusting its cwd resolution.
// #76: run inside `openvibes-embark/`, gh inferred the wrong slug and returned
// "Could not resolve to a Repository". This is the sibling of checks.ts's
// `buildGhChecksArgs` — the same shared-shape fix, applied to the whole family.
// A non-github input (a test fixture, a bare ref) passes straight through.
export function buildGhPrViewArgs(prUrl: string): string[] {
  const ref = parsePrUrl(prUrl);
  return ref
    ? ["pr", "view", ref.number, "--repo", `${ref.owner}/${ref.repo}`, "--json", "state"]
    : ["pr", "view", prUrl, "--json", "state"];
}

// Real PR-state fetcher over the gh CLI. Returns null when gh fails (not
// installed, unauthenticated, unknown PR) so reconcile treats it as "unknown"
// and leaves the dispatch untouched rather than guessing.
export const ghPrState: PrStateFetcher = async (prUrl: string): Promise<PrState> => {
  try {
    const proc = Bun.spawn(["gh", ...buildGhPrViewArgs(prUrl)], {
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
