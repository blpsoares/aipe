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

// D2 (j-20260830-w0) — a resolver may say only the verdict (every existing
// caller/test does exactly this, and stays valid unchanged) OR say the verdict
// PLUS a `detail` naming what was actually attempted and what came back. The
// real resolver below always supplies `detail`; the ledger gate surfaces it on
// an `unknown` verdict instead of a generic list of guesses (D2's second
// finding: the REJECT message named four possible causes, none of them real).
export type CheckResolution = CheckVerdict | { verdict: CheckVerdict; detail?: string };

export type PrChecksResolver = (prUrl: string) => Promise<CheckResolution>;

export function resolveVerdict(r: CheckResolution): { verdict: CheckVerdict; detail?: string } {
  return typeof r === "string" ? { verdict: r } : r;
}

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

// D2 (j-20260830-w0) — a merged PR's branch is routinely deleted; its NUMBER
// never is. Parses the owner/repo/number out of a github.com PR URL so the
// real resolver below can query `gh pr checks <number> --repo <owner/repo>`
// explicitly, instead of handing gh the URL and trusting its own resolution —
// the exact path that abstained "unresolvable" for a merged, branch-deleted
// PR that `gh pr checks <number>` answered instantly (2026-08-30, PR #257 in
// agentistics and PR #26 in openvibes-embark).
export function parsePrUrl(prUrl: string): { owner: string; repo: string; number: string } | null {
  const m = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(prUrl.trim());
  return m ? { owner: m[1]!, repo: m[2]!, number: m[3]! } : null;
}

// The gh args for `pr checks` (without the leading "gh"), BY NUMBER with an
// explicit `--repo`, never by branch. A non-URL input (a bare number, a test
// fixture) falls back to passing it straight through — still never a branch
// lookup, since the caller never had a branch to begin with.
export function buildGhChecksArgs(prUrl: string): string[] {
  const ref = parsePrUrl(prUrl);
  return ref
    ? ["pr", "checks", ref.number, "--repo", `${ref.owner}/${ref.repo}`, "--json", "bucket,state"]
    : ["pr", "checks", prUrl, "--json", "bucket,state"];
}

export type GhRunner = (args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>;

const realGhRunner: GhRunner = async (args) => {
  const proc = Bun.spawn(["gh", ...args], { stdout: "pipe", stderr: "pipe" });
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  return { code, stdout: out.trim(), stderr: err.trim() };
};

// The resolver factory — injectable so the "query by number, not by branch"
// fix is provable without a network call (tests below simulate gh failing on
// anything but the number+--repo form, the exact regression this closes).
// `detail` always names what was tried and, on `unknown`, what came back —
// the fix for D2's second finding (a REJECT message that named four possible
// causes, none of them the real one).
export function makeGhPrChecks(runGh: GhRunner = realGhRunner): PrChecksResolver {
  return async (prUrl: string) => {
    const args = buildGhChecksArgs(prUrl);
    const attempted = `gh ${args.join(" ")}`;
    try {
      const { code, stdout, stderr } = await runGh(args);
      const verdict = classifyGhChecks(code, stdout, stderr);
      if (verdict !== "unknown") return { verdict, detail: `${attempted} → exit ${code}` };
      const came =
        stderr ? `: ${stderr.split("\n")[0]}` : stdout ? `: ${stdout.slice(0, 200)}` : " (no output)";
      return { verdict, detail: `${attempted} → exit ${code}${came}` };
    } catch (e) {
      return { verdict: "unknown", detail: `${attempted} → could not spawn gh (${e instanceof Error ? e.message : String(e)})` };
    }
  };
}

// The real resolver over the gh CLI, wired for production use.
export const ghPrChecks: PrChecksResolver = makeGhPrChecks();
