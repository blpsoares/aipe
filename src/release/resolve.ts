// Resolve the release state for a set of repos, keyed by repo name — the one
// place that turns "a brain repo + the workspace" into a resolved state, shared
// by `aipe status`, `journey show` and `journey verify` so no surface re-derives.
// A resolver that throws (a torn-down clone, a git that hung) degrades to a
// single `unknown` state for that repo — never a crash, never a guessed verdict.
import { join } from "node:path";
import type { RepoEntry } from "../context-brain/types";
import type { ReleaseResolver, RepoReleaseState } from "./types";

export async function resolveReleaseStates(
  workspace: string,
  repos: RepoEntry[],
  resolver: ReleaseResolver,
): Promise<Map<string, RepoReleaseState>> {
  const entries = await Promise.all(
    repos.map(async (repo): Promise<[string, RepoReleaseState]> => {
      const repoAbs = join(workspace, repo.path);
      try {
        return [repo.name, await resolver(repo, repoAbs)];
      } catch (err) {
        return [
          repo.name,
          {
            repo: repo.name,
            flow: repo.publish?.flow ?? "dev-then-main",
            state: "unknown",
            latestReleaseTag: null,
            unreleasedOnMain: null,
            unpromotedOnDev: null,
            reason: `publication state could not be established — ${err instanceof Error ? err.message : String(err)}`,
          },
        ];
      }
    }),
  );
  return new Map(entries);
}
