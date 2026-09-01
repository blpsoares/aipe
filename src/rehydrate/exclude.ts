// Keep `rehydrate`'s footprint out of the PE's git status.
//
// `rehydrate` writes persona skills and agent types into `<repo>/.claude/`.
// `.claude/` is in nobody's committed `.gitignore`, so every repo it touches
// goes dirty — and a dirty repo blocks BOTH `migrate-layout` and
// `worktree prune`. The upgrade then prints "run migrate-layout" while, in the
// same command, manufacturing the very condition that makes it refuse.
//
// The fix is at the root (scope item 4): make `.claude/` locally ignored in
// every repo of the workspace. `.git/info/exclude` is untracked, idempotent,
// and — crucially — shared by all of a repo's worktrees, so a live session's
// worktree stops going dirty too. No committed `.gitignore` is touched.
import { resolve } from "node:path";
import { readBrain } from "../make-workspace/read";
import { ensureExcluded, run as git } from "../worktree/git";

/** The entries we exclude — a trailing slash so only the directory is matched. */
export const CLAUDE_EXCLUDE = ".claude/";
// `.specify/` is the real Spec Kit's vendored templates/scripts, re-materialized
// from the binary on every rehydrate (#118 — spec-kit is now auto-installed).
// Like `.claude/`, it is in nobody's committed `.gitignore`, so without this it
// would dirty every repo the moment spec-kit lands — the same trap that made the
// upgrade refuse its own migration. The specialist's actual artifacts live under
// `specs/` (committed, and what the delivery gate checks); `.specify/` is tooling.
export const SPECIFY_EXCLUDE = ".specify/";

async function isGitRepo(repoAbs: string): Promise<boolean> {
  const r = await git(["git", "-C", repoAbs, "rev-parse", "--is-inside-work-tree"]);
  return r.code === 0 && r.stdout.trim() === "true";
}

/**
 * Ensures `.claude/` is in `.git/info/exclude` for every repo of the workspace
 * that is a git checkout. Returns the repos actually excluded. Best-effort and
 * idempotent: a missing/unclonable repo is skipped, a second run is a no-op.
 */
export interface ExcludeFailure {
  repo: string;
  reason: string;
}

export interface ExcludeResult {
  excluded: string[];
  failed: ExcludeFailure[];
  /**
   * Repos where `.claude/` is ALREADY TRACKED by git. `.git/info/exclude` has no
   * power over a tracked path, so in these AIPe is writing into files under
   * version control — an independent QA watched hiring leave
   * ` M .claude/settings.json` in a target repo. Reported, never silently
   * "handled": whether that is acceptable is the repo owner's call, not ours.
   */
  tracked: string[];
}

export async function ensureReposExcludeClaude(workspaceDir: string): Promise<ExcludeResult> {
  const brain = await readBrain(workspaceDir).catch(() => null);
  if (!brain || !brain.ok) return { excluded: [], failed: [], tracked: [] };
  const excluded: string[] = [];
  const failed: ExcludeFailure[] = [];
  const tracked: string[] = [];
  for (const repo of brain.brain.repos) {
    const repoAbs = resolve(workspaceDir, repo.path);
    if (!(await isGitRepo(repoAbs))) continue;
    try {
      await ensureExcluded(repoAbs, CLAUDE_EXCLUDE);
      await ensureExcluded(repoAbs, SPECIFY_EXCLUDE);
      excluded.push(repoAbs);
    } catch (err) {
      // Best-effort for REHYDRATE — a single unwritable exclude file must not
      // fail an upgrade. But it is NOT best-effort for what it protects: an
      // independent QA made `.git/info` read-only, watched the write throw, and
      // saw hiring report `STATE specialists=done` over a repo left with an
      // untracked `.claude/` — the exact state the exclusion exists to prevent,
      // announced as success. The failure is now returned to the caller, which
      // decides whether it can proceed quietly.
      failed.push({ repo: repoAbs, reason: err instanceof Error ? err.message : String(err) });
    }
    // Does git already track anything under `.claude/`? Then the exclusion is
    // inert for those paths and AIPe is about to write into version control.
    const ls = await git(["git", "-C", repoAbs, "ls-files", "--", ".claude"]);
    if (ls.code === 0 && ls.stdout.trim() !== "") tracked.push(repoAbs);
  }
  return { excluded, failed, tracked };
}
