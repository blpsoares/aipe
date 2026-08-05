// Opt-in publishing of an AIPe workspace to a PRIVATE git remote.
//
// Only the workspace's own metadata travels: .aipe/, .claude/, .gitignore,
// README* — never the cloned repos or their worktrees (those stay ignored by
// the workspace .gitignore scaffolded in src/start/scaffold.ts). This is a
// deliberate side effect the caller must opt into; it is never invoked from
// the default `makeWorkspace()` flow.

export type Runner = (cmd: string[], cwd?: string) => Promise<{ code: number; stdout: string; stderr: string }>;
export type OriginInspector = (workspaceDir: string, run: Runner) => Promise<boolean>;

export interface PublishOpts {
  /** Slug used as the GitHub repo name — brain.yaml's context.name. */
  name: string;
}

export type PublishResult =
  | { status: "skipped"; message: string }
  | { status: "published" }
  | { status: "failed"; message: string };

const ALLOWLIST = [".aipe", ".claude", ".gitignore", "README.md"];

export async function realHasOrigin(workspaceDir: string, run: Runner): Promise<boolean> {
  const result = await run(["git", "remote", "get-url", "origin"], workspaceDir);
  return result.code === 0;
}

export async function publishWorkspace(
  workspaceDir: string,
  opts: PublishOpts,
  deps: { run: Runner; hasOrigin: OriginInspector },
): Promise<PublishResult> {
  if (await deps.hasOrigin(workspaceDir, deps.run)) {
    return { status: "skipped", message: "origin already configured" };
  }

  const init = await deps.run(["git", "init", "-b", "main"], workspaceDir);
  if (init.code !== 0) {
    return { status: "failed", message: init.stderr || `git init failed (code ${init.code})` };
  }

  const add = await deps.run(["git", "add", ...ALLOWLIST], workspaceDir);
  if (add.code !== 0) {
    return { status: "failed", message: add.stderr || `git add failed (code ${add.code})` };
  }

  const commit = await deps.run(
    ["git", "commit", "-m", "chore(workspace): publish AIPe workspace metadata"],
    workspaceDir,
  );
  if (commit.code !== 0) {
    return { status: "failed", message: commit.stderr || `git commit failed (code ${commit.code})` };
  }

  const create = await deps.run(
    ["gh", "repo", "create", opts.name, "--private", "--source=.", "--remote=origin"],
    workspaceDir,
  );
  if (create.code !== 0) {
    return { status: "failed", message: create.stderr || `gh repo create failed (code ${create.code})` };
  }

  const push = await deps.run(["git", "push", "-u", "origin", "main"], workspaceDir);
  if (push.code !== 0) {
    return { status: "failed", message: push.stderr || `git push failed (code ${push.code})` };
  }

  return { status: "published" };
}
