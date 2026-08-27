// Makes the workspace a publishable git repo: `git init` + an allowlist
// .gitignore that publishes only the AIPe "brain" (.aipe/ + whatever the chosen
// harness owns: .claude/, .gemini/ + .agents/, AGENTS.md, …) and never
// the cloned repos, their worktrees, or any credentials. This is what lets the
// PE push the workspace and continue on another machine (re-clone the repos via
// /make-workspace, rehydrate personas) without redoing onboarding.
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { HarnessAdapter } from "../harness/types";

/** Extensions that make an allowlist entry a FILE rather than a directory —
 *  a directory entry needs the trailing slash to un-ignore its contents. */
const FILE_EXT_RE = /\.(md|json|jsonc|toml|ya?ml|txt)$/i;

/**
 * Pure: the top-level `.gitignore` un-ignore lines for a harness.
 *
 * The template ignores `/*` and then re-admits an allowlist, so anything the
 * harness owns that is NOT listed here is silently left out of a published
 * workspace. Only the FIRST path segment matters: git cannot un-ignore
 * `.github/hooks/` while `/.github` itself is excluded.
 */
export function unignoreLines(paths: string[]): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const p of paths) {
    const seg = p.split("/")[0];
    if (!seg || seen.has(seg)) continue;
    seen.add(seg);
    lines.push(FILE_EXT_RE.test(seg) ? `!/${seg}` : `!/${seg}/`);
  }
  return lines;
}

function gitignoreFor(adapter: HarnessAdapter | null): string {
  // No adapter (a bare scaffold) → admit nothing harness-specific; the harness
  // install that follows is what knows its own paths.
  const harness = adapter ? unignoreLines(adapter.integrationPaths()) : [];
  return `# AIPe workspace — publish the brain, never the cloned repos or secrets.
#
# This is an ALLOWLIST, and it must stay one. The \`/*\` line makes "ignored" the
# default for everything at the top level, so a file that shows up in the
# workspace root without anyone planning for it (a .env, a scratch note, an
# editor folder) cannot ride along into a \`git add -A\`. Listing what to ignore
# instead of what to publish would invert that, and the workspace is a thing the
# PE commits by hand.
#
# Everything at the top level is ignored (all cloned repos, whatever their
# path, and their nested .worktrees/) ...
/*
# ... the clones explicitly, so the intent survives someone relaxing the rule
# above (redundant while \`/*\` stands — deliberately so):
/repos/
# ... except the AIPe working files that make the workspace portable:
!/.aipe/
${harness.join("\n")}${harness.length > 0 ? "\n" : ""}!/.gitignore
!/README.md
# Transient staging inside .aipe is never published.
.aipe/**/.reports/
# Per-machine artifacts of the SessionStart auto-rehydrate: the stamp records
# which binary version last rehydrated THIS machine's copy (publishing it would
# make a fresh clone think it is already up to date), and the lock is transient.
/.aipe/toolchain.yaml
/.aipe/.rehydrate.lock
# Per-machine dispatch claim locks: physical mutual exclusion over THIS machine's
# clones, keyed by local pids. Publishing them would wedge a fresh clone against
# holders that don't exist there. Same rule as toolchain.yaml / .rehydrate.lock.
/.aipe/locks/
`;
}

function readmeFor(adapter: HarnessAdapter | null): string {
  const harnessLine = adapter
    ? adapter.integrationPaths().map((p) => `- \`${p}\` — the ${adapter.label} integration (AIPe skills + session hook).`).join("\n")
    : "- the harness integration (AIPe skills + session hook).";
  return README_TEMPLATE.replace("__HARNESS_PATHS__", harnessLine);
}

const README_TEMPLATE = `# AIPe workspace

This folder is an AIPe workspace: the portable "brain" of a context. It is safe
to publish (push to a private git remote) — only the AIPe working files travel:

- \`.aipe/\` — brain (repo URLs/paths/stacks), relations, personas, journeys.
__HARNESS_PATHS__

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
export async function scaffoldWorkspace(workspaceDir: string, adapter: HarnessAdapter | null = null): Promise<void> {
  await mkdir(workspaceDir, { recursive: true });

  const gitignorePath = join(workspaceDir, ".gitignore");
  if (!(await exists(gitignorePath))) await writeFile(gitignorePath, gitignoreFor(adapter), "utf8");

  const readmePath = join(workspaceDir, "README.md");
  if (!(await exists(readmePath))) await writeFile(readmePath, readmeFor(adapter), "utf8");

  if (!(await exists(join(workspaceDir, ".git")))) {
    await run(["git", "init", "-b", "main"], workspaceDir);
  }
}
