// Thin git wrappers over Bun.spawn, mirroring src/make-workspace/git.ts. All
// operations here are local (worktree add/remove/list, config, status) — no
// network, so they are not subject to the remote-URL rewrite that makes the
// make-workspace remote test environment-sensitive.
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function run(
  cmd: string[],
  cwd?: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  return { code, stdout: stdout.trim(), stderr: stderr.trim() };
}

// The branch a fresh worktree should fork from: the remote's default branch if
// known, else the currently checked-out branch.
export async function defaultBase(repoAbs: string): Promise<string> {
  const head = await run(["git", "-C", repoAbs, "symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
  if (head.code === 0 && head.stdout) return head.stdout.replace(/^origin\//, "");
  const cur = await run(["git", "-C", repoAbs, "rev-parse", "--abbrev-ref", "HEAD"]);
  return cur.code === 0 && cur.stdout ? cur.stdout : "HEAD";
}

export async function gitDir(repoAbs: string): Promise<string> {
  const r = await run(["git", "-C", repoAbs, "rev-parse", "--absolute-git-dir"]);
  return r.stdout;
}

// Append an entry to <repo>/.git/info/exclude (local, untracked) if absent, so
// the nested .worktrees/ dir never shows up as untracked in the PE's repo and
// no committed .gitignore is touched.
export async function ensureExcluded(repoAbs: string, entry: string): Promise<void> {
  const dir = await gitDir(repoAbs);
  const excludePath = join(dir, "info", "exclude");
  let current = "";
  try {
    current = await readFile(excludePath, "utf8");
  } catch {
    // no exclude file yet: created below
  }
  const present = current.split("\n").map((l) => l.trim()).includes(entry);
  if (present) return;
  const prefix = current === "" || current.endsWith("\n") ? current : `${current}\n`;
  await writeFile(excludePath, `${prefix}${entry}\n`, "utf8");
}

export async function listPorcelain(repoAbs: string): Promise<{ path: string; branch: string }[]> {
  const r = await run(["git", "-C", repoAbs, "worktree", "list", "--porcelain"]);
  if (r.code !== 0) return [];
  const out: { path: string; branch: string }[] = [];
  let path = "";
  for (const line of r.stdout.split("\n")) {
    if (line.startsWith("worktree ")) {
      path = line.slice("worktree ".length);
    } else if (line.startsWith("branch ")) {
      out.push({ path, branch: line.slice("branch ".length).replace(/^refs\/heads\//, "") });
    }
  }
  return out;
}

export async function branchExists(repoAbs: string, branch: string): Promise<boolean> {
  const r = await run(["git", "-C", repoAbs, "rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]);
  return r.code === 0;
}

export async function worktreeAdd(
  repoAbs: string,
  wtAbs: string,
  branch: string,
  base: string,
): Promise<{ ok: boolean; message?: string }> {
  const args = (await branchExists(repoAbs, branch))
    ? ["git", "-C", repoAbs, "worktree", "add", wtAbs, branch]
    : ["git", "-C", repoAbs, "worktree", "add", "-b", branch, wtAbs, base];
  const r = await run(args);
  return r.code === 0 ? { ok: true } : { ok: false, message: r.stderr || `git worktree add failed (${r.code})` };
}

// Per-worktree identity: the persona is the git author *name* (namespaced with
// an `aipe/` prefix so it reads as framework-generated), while user.email is
// left inherited from the PE's real git identity so GitHub attributes commits
// to the real account. extensions.worktreeConfig scopes user.name to this
// worktree only, leaving the PE's main repo config untouched.
export async function setWorktreeIdentity(repoAbs: string, wtAbs: string, name: string): Promise<void> {
  await run(["git", "-C", repoAbs, "config", "extensions.worktreeConfig", "true"]);
  await run(["git", "-C", wtAbs, "config", "--worktree", "user.name", name]);
}

// "Not safe to auto-remove": uncommitted changes, or commits on this worktree's
// HEAD that are not reachable from any remote ref (unpushed work). The
// deliverable is the PR + pushed history, so removing either would lose work.
export async function isDirtyOrUnpushed(wtAbs: string): Promise<boolean> {
  const status = await run(["git", "-C", wtAbs, "status", "--porcelain"]);
  if (status.stdout.length > 0) return true;
  const unpushed = await run(["git", "-C", wtAbs, "rev-list", "--count", "HEAD", "--not", "--remotes"]);
  return unpushed.code === 0 && unpushed.stdout !== "" && unpushed.stdout !== "0";
}

export async function worktreeRemove(
  repoAbs: string,
  wtAbs: string,
  force: boolean,
): Promise<{ ok: boolean; message?: string }> {
  const args = ["git", "-C", repoAbs, "worktree", "remove", ...(force ? ["--force"] : []), wtAbs];
  const r = await run(args);
  return r.code === 0 ? { ok: true } : { ok: false, message: r.stderr || `git worktree remove failed (${r.code})` };
}
