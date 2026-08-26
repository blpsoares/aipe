// Resolve a PR's CI check status over `gh pr checks`, for the record gate and
// the verify audit. Kept in the same shape as reconcile's ghPrState: a pure,
// injectable resolver type so the gate/audit stay testable without gh/network,
// plus the real gh-backed implementation the CLI wires in. The classifier that
// turns a `gh` invocation's (code, stdout, stderr) into a verdict is pulled out
// as a pure function so the five-way decision — the hard part — is unit-tested
// directly, with the spawn itself the only untested boundary (as with ghPrState).

// Five outcomes, never two. `pending` (checks not concluded) must not read as
// failure, and `unknown` (the forge could not be queried) must not read as a
// pass — a gate that guesses green is worse than one that abstains loudly.
export type CheckVerdict = "green" | "red" | "pending" | "none" | "unknown";

export type PrChecksResolver = (prUrl: string) => Promise<CheckVerdict>;

// `gh pr checks <pr> --json bucket,state` returns an array of check rows, each
// with a `bucket` that categorises `state` into pass/fail/pending/skipping/cancel
// (see `gh pr checks --help`). We fold that array into one verdict:
//   • any fail/cancel        → red   (a single failing check fails the delivery)
//   • else any pending/queued → pending
//   • else (all pass/skipping, ≥1 row) → green
//   • empty array            → none  (PR genuinely reports no checks)
// When gh exits non-zero without parseable JSON we distinguish "no checks" (gh
// prints "no checks reported on the …" to stderr) from a real failure to query
// (missing/unauth/offline) → unknown. A thrown spawn (gh absent) is unknown too.
export function classifyGhChecks(code: number, stdout: string, stderr: string): CheckVerdict {
  let rows: unknown;
  try {
    rows = JSON.parse(stdout);
  } catch {
    // No JSON body. gh says so explicitly when a branch has no checks; anything
    // else on a non-zero exit is a query we could not trust.
    if (/no checks?\b/i.test(stderr) || /no checks?\b/i.test(stdout)) return "none";
    return "unknown";
  }
  if (!Array.isArray(rows)) return "unknown";
  if (rows.length === 0) return "none";

  let sawPending = false;
  let sawPass = false;
  for (const r of rows) {
    const bucket = String((r as { bucket?: unknown }).bucket ?? "").toLowerCase();
    const state = String((r as { state?: unknown }).state ?? "").toLowerCase();
    if (bucket === "fail" || bucket === "cancel") return "red";
    if (bucket === "pending" || state === "queued" || state === "in_progress" || state === "pending") {
      sawPending = true;
    } else if (bucket === "pass" || bucket === "skipping" || bucket === "" ) {
      sawPass = true;
    }
  }
  if (sawPending) return "pending";
  // `code` is a secondary signal: gh exits 8 while checks are pending and 1 on
  // failure. If the rows all looked terminal-pass but the exit says otherwise,
  // trust the exit rather than claim green — fail safe.
  if (code === 8) return "pending";
  if (code !== 0 && !sawPass) return "unknown";
  if (code !== 0) return "red";
  return "green";
}

// The real resolver over the gh CLI. Any spawn failure (gh not installed) is
// swallowed to `unknown` so the gate abstains rather than crashing.
export const ghPrChecks: PrChecksResolver = async (prUrl: string): Promise<CheckVerdict> => {
  try {
    const proc = Bun.spawn(["gh", "pr", "checks", prUrl, "--json", "bucket,state"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const code = await proc.exited;
    return classifyGhChecks(code, out.trim(), err.trim());
  } catch {
    return "unknown";
  }
};
