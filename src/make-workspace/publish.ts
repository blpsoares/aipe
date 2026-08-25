// Opt-in publishing of an AIPe workspace to a PRIVATE git remote.
//
// Only the workspace's own metadata travels: .aipe/, whatever directories the
// workspace's harness owns (.claude/, .gemini/ + .agents/, …), .gitignore and
// README* — never the cloned repos or their worktrees (those stay ignored by
// the workspace .gitignore scaffolded in src/start/scaffold.ts). This is a
// deliberate side effect the caller must opt into; it is never invoked from
// the default `makeWorkspace()` flow.

import { access } from "node:fs/promises";
import { join } from "node:path";
import { resolveAdapter } from "../harness/registry";
import type { HarnessAdapter } from "../harness/types";

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

/** Published regardless of harness: AIPe's own directory and the workspace's
 *  own files. The harness's paths are added on top, from its adapter. */
export const BASE_ALLOWLIST = [".aipe", ".gitignore", "README.md"];

/** Pure: everything this workspace may publish, for a given harness. */
export function allowlistFor(adapter: HarnessAdapter): string[] {
  return [...BASE_ALLOWLIST, ...adapter.integrationPaths()];
}

async function present(workspaceDir: string, rel: string): Promise<boolean> {
  try {
    await access(join(workspaceDir, rel));
    return true;
  } catch {
    return false;
  }
}

/**
 * The allowlist entries that actually exist. `git add` fails outright on a
 * missing pathspec, and with a per-harness list some entries legitimately are
 * not there (a Copilot workspace has no `.claude/`, a workspace published
 * before its README was written has no README.md) — filtering keeps a
 * publish from failing over a file that was never supposed to be there.
 */
export async function existingAllowlist(workspaceDir: string, adapter: HarnessAdapter): Promise<string[]> {
  const all = allowlistFor(adapter);
  const found: string[] = [];
  for (const rel of all) if (await present(workspaceDir, rel)) found.push(rel);
  return found;
}

export async function realHasOrigin(workspaceDir: string, run: Runner): Promise<boolean> {
  const result = await run(["git", "remote", "get-url", "origin"], workspaceDir);
  return result.code === 0;
}

/** Resolves what may be published. Injectable so the publish flow stays
 *  testable without a real workspace on disk. */
export type AllowlistResolver = (workspaceDir: string) => Promise<string[]>;

/** The real resolver: the workspace's declared harness decides its paths. */
export const realAllowlist: AllowlistResolver = async (workspaceDir) =>
  existingAllowlist(workspaceDir, await resolveAdapter(workspaceDir));

export async function publishWorkspace(
  workspaceDir: string,
  opts: PublishOpts,
  deps: { run: Runner; hasOrigin: OriginInspector; allowlist?: AllowlistResolver },
): Promise<PublishResult> {
  if (await deps.hasOrigin(workspaceDir, deps.run)) {
    return { status: "skipped", message: "origin already configured" };
  }

  const init = await deps.run(["git", "init", "-b", "main"], workspaceDir);
  if (init.code !== 0) {
    return { status: "failed", message: init.stderr || `git init failed (code ${init.code})` };
  }

  const allowlist = await (deps.allowlist ?? realAllowlist)(workspaceDir);
  if (allowlist.length === 0) {
    return { status: "failed", message: "nothing to publish — no AIPe or harness files found" };
  }

  const add = await deps.run(["git", "add", ...allowlist], workspaceDir);
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
