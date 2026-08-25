import { normalizeRepoPaths } from "./layout";
import type { ContextInput, RepoEntry, RepoInput, ValidationError } from "./types";
import { validateContext } from "./validate";
import { writeBrainFiles } from "./write";

export type InitResult =
  | { ok: true; brainPath: string; statePath: string }
  | { ok: false; errors: ValidationError[] };

/**
 * Narrow declared repos to written ones. Safe only after `validateContext`,
 * which rejects an empty path — the fallback exists to keep the function total,
 * not because it can fire.
 */
function asRepoEntries(repos: RepoInput[]): RepoEntry[] {
  return repos.map((repo) => ({ ...repo, path: repo.path ?? "" }));
}

export async function initContextBrain(
  input: ContextInput,
  workspaceDir: string,
): Promise<InitResult> {
  // Defaults first: a repo declared without a path gets `./repos/<name>`, and
  // validation then judges the same brain that will be written to disk.
  const normalized = normalizeRepoPaths(input);
  const validation = validateContext(normalized);
  if (!validation.ok) {
    return { ok: false, errors: validation.errors };
  }
  const { brainPath, statePath } = await writeBrainFiles(workspaceDir, {
    context: normalized.context,
    repos: asRepoEntries(normalized.repos),
  });
  return { ok: true, brainPath, statePath };
}
