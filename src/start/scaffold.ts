// Makes the workspace a publishable git repo: `git init` + an allowlist
// .gitignore that publishes only the AIPe "brain" (.aipe/ + .claude/) and never
// the cloned repos, their worktrees, or any credentials. This is what lets the
// PE push the workspace and continue on another machine (re-clone the repos via
// /make-workspace, rehydrate personas) without redoing onboarding.
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const GITIGNORE = `# AIPe workspace — publish the brain, never the cloned repos or secrets.
# Everything at the top level is ignored (all cloned repos, whatever their
# path, and their nested .worktrees/) ...
/*
# ... except the AIPe working files that make the workspace portable:
!/.aipe/
!/.claude/
!/.gitignore
!/README.md
# Transient staging inside .aipe is never published.
.aipe/**/.reports/
`;

const README = `# AIPe workspace

This folder is an AIPe workspace: the portable "brain" of a context. It is safe
to publish (push to a private git remote) — only the AIPe working files travel:

- \`.aipe/\` — brain (repo URLs/paths/stacks), relations, personas, journeys.
- \`.claude/\` — the AIPe skills + SessionStart hook.

The cloned repositories are **not** committed — they are referenced by URL in
\`.aipe/brain.yaml\` and re-cloned on demand. To continue on another machine:
clone this workspace, open it in your harness, and run \`/make-workspace\` — it
re-clones the repos and rehydrates each repo's personas from \`.aipe/personas/\`.
`;

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function run(cmd: string[], cwd: string): Promise<number> {
  const proc = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  return proc.exited;
}

// Idempotent: never clobbers a PE-customized .gitignore/README, never re-inits.
export async function scaffoldWorkspace(workspaceDir: string): Promise<void> {
  await mkdir(workspaceDir, { recursive: true });

  const gitignorePath = join(workspaceDir, ".gitignore");
  if (!(await exists(gitignorePath))) await writeFile(gitignorePath, GITIGNORE, "utf8");

  const readmePath = join(workspaceDir, "README.md");
  if (!(await exists(readmePath))) await writeFile(readmePath, README, "utf8");

  if (!(await exists(join(workspaceDir, ".git")))) {
    await run(["git", "init", "-b", "main"], workspaceDir);
  }
}
