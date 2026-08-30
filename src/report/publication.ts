// The bridge between src/release (j-20260830-zd) and the report engine. Resolves
// each repo's publication position from LOCAL GIT — the SAME resolver `aipe
// status` uses (resolveReleaseStates + realReleaseResolver), never a second
// derivation — and maps it to the pure engine's injectable RepoPublication shape.
// Kept OUT of compute.ts on purpose: compute stays pure (no node, no git) so the
// web view can run it; the git touch lives only here and in the CLI.
import { readBrain } from "../make-workspace/read";
import { realReleaseResolver } from "../release/git";
import { resolveReleaseStates } from "../release/resolve";
import type { ReleaseResolver } from "../release/types";
import type { RepoPublication } from "./compute";

export async function resolvePublication(
  workspace: string,
  resolver: ReleaseResolver = realReleaseResolver,
): Promise<Record<string, RepoPublication>> {
  const brain = await readBrain(workspace);
  if (!brain.ok) return {}; // no brain ⇒ nothing to resolve; repos stay `unknown`
  const states = await resolveReleaseStates(workspace, brain.brain.repos, resolver);
  const out: Record<string, RepoPublication> = {};
  for (const [repo, s] of states) {
    out[repo] = { state: s.state, latestReleaseTag: s.latestReleaseTag, reason: s.reason };
  }
  return out;
}
