// Verifiable path detection (j-20260826-xj). AIPe is physical: it does not trust
// a promise. A path set DECLARED at dispatch time AGES — field evidence: one dev's
// scope grew from 2 to 16 files mid-task for a legitimate reason; another's `bun
// install` nudged submodule pointers he never meant to touch. So the lock is
// reconciled against what the branch ACTUALLY moved, read from git, not against
// the initial declaration alone. This module is that reader.

export interface GitRunner {
  (args: string[], cwd: string): Promise<{ stdout: string; code: number }>;
}

export const realGit: GitRunner = async (args, cwd) => {
  const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const stdout = await new Response(proc.stdout).text();
  const code = await proc.exited;
  return { stdout, code };
};

// The sorted, unique set of repo-relative paths the branch has actually touched:
// everything committed since it diverged from `base` (three-dot diff) PLUS every
// uncommitted change in the working tree (so an in-flight, not-yet-committed edit
// still counts — that is exactly the drift the lock must see). A rename records
// BOTH endpoints. A git failure yields whatever the other command produced rather
// than throwing, so a missing base ref degrades to "the working tree" instead of
// crashing the reconcile.
export async function detectTouchedPaths(
  worktreeDir: string,
  opts: { base?: string; git?: GitRunner } = {},
): Promise<string[]> {
  const git = opts.git ?? realGit;
  const base = opts.base ?? "origin/main";
  const paths = new Set<string>();

  const diff = await git(["diff", "--name-only", `${base}...HEAD`], worktreeDir);
  if (diff.code === 0) {
    for (const line of diff.stdout.split("\n")) {
      const t = line.trim();
      if (t) paths.add(t);
    }
  }

  const status = await git(["status", "--porcelain"], worktreeDir);
  if (status.code === 0) {
    for (const line of status.stdout.split("\n")) {
      if (!line.trim()) continue;
      // porcelain v1: "XY <path>" (two status columns + space). A rename is
      // "R  old -> new".
      const entry = line.slice(3).trim();
      if (!entry) continue;
      const arrow = entry.indexOf(" -> ");
      if (arrow >= 0) {
        const from = entry.slice(0, arrow).trim();
        const to = entry.slice(arrow + 4).trim();
        if (from) paths.add(from);
        if (to) paths.add(to);
      } else {
        paths.add(entry);
      }
    }
  }

  return [...paths].sort();
}
