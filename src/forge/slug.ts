// The ONE place the aipe resolves a GitHub forge target — so every `gh`
// invocation carries an EXPLICIT `--repo owner/name` and never falls back to
// gh's own cwd inference (onda5 #76). The bug this closes: run inside
// `openvibes-embark/`, whose `origin` is `opvibes/openvibes-embark`, gh resolved
// the wrong slug and returned "Could not resolve to a Repository". A slug read
// from the repo's own remote (or parsed from a PR URL) can never drift with cwd.
//
// Two sources, because the two `gh` seams have two different anchors:
//   • repo-dir commands (release promote) resolve from the repo's `origin` remote.
//   • PR-URL commands (journey reconcile / checks) parse the slug from the URL,
//     and query BY NUMBER — a merged PR's branch is deleted but its number is not.

export type SlugGitRun = (cmd: string[]) => Promise<{ code: number; stdout: string; stderr: string }>;

const realRun: SlugGitRun = async (cmd) => {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  return { code, stdout: stdout.trim(), stderr: stderr.trim() };
};

// Resolve `owner/name` from a repo's `origin` remote — ssh (`git@github.com:o/n.git`),
// https (`https://github.com/o/n`), with or without the `.git` suffix and a
// trailing slash. null when there is no origin or it is not a github remote.
export async function resolveSlugFromRemote(repoAbs: string, run: SlugGitRun = realRun): Promise<string | null> {
  const r = await run(["git", "-C", repoAbs, "remote", "get-url", "origin"]);
  if (r.code !== 0 || !r.stdout) return null;
  const m = r.stdout.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?\/?$/);
  return m ? m[1]! : null;
}

// Parse owner/repo/number out of a github.com PR URL, so a resolver can query
// `gh pr … <number> --repo <owner/repo>` explicitly instead of handing gh the
// URL and trusting its resolution. null for a non-github input (a bare number, a
// test fixture) — the caller then passes it straight through unchanged.
export function parsePrUrl(prUrl: string): { owner: string; repo: string; number: string } | null {
  const m = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(prUrl.trim());
  return m ? { owner: m[1]!, repo: m[2]!, number: m[3]! } : null;
}
