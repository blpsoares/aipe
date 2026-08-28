// Where a workspace keeps the repos it clones.
//
// Repos live under `repos/` rather than at the workspace root so the "brain"
// (.aipe/ + .claude/) and the team's checked-out code never share a namespace:
// a repo called `docs` or `README.md` used to collide with a workspace file and
// fail onboarding with `path occupied by different content`.
//
// The LEGACY layout — repos as direct children of the workspace — stays valid
// forever. Nothing at runtime may assume the `repos/` prefix: every consumer
// resolves `join(workspaceDir, repo.path)`, and `repo.path` is the single
// source of truth. What lives here is the DEFAULT for repos declared without an
// explicit path, plus the detection used to tell a PE that a migration exists.
import type { ContextInput, RepoInput } from "./types";

/** The directory new workspaces clone into, relative to the workspace root. */
export const REPOS_DIR = "repos";

/** Pure: the path a repo gets when the PE did not choose one. */
export function defaultRepoPath(name: string): string {
  return `./${REPOS_DIR}/${name.trim()}`;
}

/** Pure: strip the leading `./` and any trailing slashes. */
export function normalizePath(path: string): string {
  return path.trim().replace(/^\.\//, "").replace(/\/+$/, "");
}

/**
 * Pure: is this repo on the legacy root layout?
 *
 * A single path segment means the repo sits directly under the workspace. Any
 * nested path (`repos/x`, or a PE-chosen `services/x`) counts as deliberate and
 * is left alone — this only flags what the old default produced.
 */
export function isLegacyRepoPath(path: string): boolean {
  const normalized = normalizePath(path);
  return normalized !== "" && !normalized.includes("/");
}

/** Pure: the repos of a brain that still sit at the workspace root. */
export function legacyRepos(repos: { name: string; path: string }[]): string[] {
  return repos.filter((r) => isLegacyRepoPath(r.path)).map((r) => r.name);
}

/**
 * Pure: the workspace-relative directory of a repo, resolved from the brain —
 * the single source of truth every path consumer must go through instead of
 * assuming a repo lives at `<workspace>/<name>`. That assumption is exactly what
 * broke `session dispatch` under the `repos/` layout: the persona sat at
 * `repos/<name>/…` while the code looked for it at `<name>/…`.
 *
 * Returns `undefined` when no repo carries that name, so the caller decides
 * whether that is fatal or a legacy fallback (a workspace with no brain on disk
 * predates the convention and keeps resolving by bare name). Normalized: no
 * leading `./`, no trailing slash — ready to hand straight to `join`.
 */
export function repoDir(repos: { name: string; path: string }[], name: string): string | undefined {
  const repo = repos.find((r) => r.name === name);
  return repo ? normalizePath(repo.path) : undefined;
}

/**
 * Pure: is the whole workspace on the legacy layout?
 *
 * Only true when EVERY repo is at the root — a workspace mid-migration, or one
 * whose PE deliberately mixes layouts, is not something to nag about.
 */
export function isLegacyLayout(repos: { name: string; path: string }[]): boolean {
  return repos.length > 0 && repos.every((r) => isLegacyRepoPath(r.path));
}

/**
 * Pure: fill in the path of every repo declared without one.
 *
 * This is what makes the convention deterministic. It used to live in the
 * `/context-brain` skill's prose (an example the model was expected to copy),
 * which put a layout decision on the wrong side of the agent-output boundary.
 * Repos that DO carry a path are returned untouched, legacy or not.
 */
export function normalizeRepoPaths(input: ContextInput): ContextInput {
  const repos = (input.repos ?? []).map((repo: RepoInput) => {
    const path = repo.path?.trim() ?? "";
    if (path !== "") return { ...repo, path };
    const name = repo.name?.trim() ?? "";
    if (name === "") return repo; // validation reports the missing name
    return { ...repo, path: defaultRepoPath(name) };
  });
  return { ...input, repos };
}
