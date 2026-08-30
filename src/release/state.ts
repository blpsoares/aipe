// The ONE pure derivation of a repo's publication state from verifiable git
// facts (j-20260830-zd). No I/O, no network — the resolver supplies the facts,
// this turns them into a `merged-unpublished | published | unknown` verdict with
// a sentence explaining it. The honesty rule is enforced here: a null count is
// never silently read as zero, so a repo whose facts could not be established is
// `unknown`, never the comfortable `published`.
//
// Baselines (what counts as "published") — decided by the resolver and reflected
// in the facts it hands us:
//   • A repo that cuts release tags (`hasRelease`) is published up to its latest
//     tag; `unreleasedOnMain` counts what sits on the release branch beyond it.
//   • A repo with no release tags is published AT its release-branch head — the
//     openvibes-embark flow, where merging into main IS the release. The resolver
//     hands us `unreleasedOnMain = 0` there (main head is the baseline), so a
//     tag-less repo is never falsely "unpublished" for having commits on main.
import type { RepoReleaseFacts, RepoReleaseState } from "./types";

export function deriveReleaseState(repo: string, f: RepoReleaseFacts): RepoReleaseState {
  const base = {
    repo,
    flow: f.flow,
    latestReleaseTag: f.latestReleaseTag,
    unreleasedOnMain: f.unreleasedOnMain,
    unpromotedOnDev: f.unpromotedOnDev,
  };

  const mainNull = f.unreleasedOnMain === null;
  // The integration count only matters (and only exists) for the dev-then-main
  // flow; for main-direct there is no promotion step to be undeterminable about.
  const devNull = f.flow === "dev-then-main" && f.unpromotedOnDev === null;

  // Hard unknown: nothing we can stand on. main-direct needs the release-branch
  // count; dev-then-main is only fully blind when BOTH counts are unreadable.
  if (f.flow === "main-direct" && mainNull) {
    return { ...base, state: "unknown", reason: `publication state could not be established — ${f.releaseBranch} or its release tag was unreadable` };
  }
  if (f.flow === "dev-then-main" && mainNull && devNull) {
    return { ...base, state: "unknown", reason: `publication state could not be established — neither ${f.releaseBranch} nor ${f.integrationBranch} could be read` };
  }

  const unreleased = f.unreleasedOnMain ?? 0;
  const unpromoted = f.flow === "dev-then-main" ? f.unpromotedOnDev ?? 0 : 0;

  const parts: string[] = [];
  if (unpromoted > 0) {
    parts.push(`${unpromoted} commit(s) merged into ${f.integrationBranch} not yet in ${f.releaseBranch}`);
  }
  if (unreleased > 0) {
    parts.push(`${unreleased} commit(s) on ${f.releaseBranch} beyond ${f.latestReleaseTag}`);
  }

  if (parts.length > 0) {
    return { ...base, state: "merged-unpublished", reason: parts.join("; ") };
  }

  // No positive backlog found — but if a relevant count was undeterminable we
  // cannot claim "published" (the comfortable assumption the house rule forbids):
  // the missing number could hide backlog. Say we could not be sure.
  if (mainNull || devNull) {
    const which = mainNull ? f.releaseBranch : f.integrationBranch;
    return { ...base, state: "unknown", reason: `no backlog found, but publication could not be fully verified — ${which} was unreadable` };
  }

  return {
    ...base,
    state: "published",
    reason: f.hasRelease
      ? `${f.releaseBranch} is at ${f.latestReleaseTag} with nothing merged beyond it`
      : `no release tags — ${f.releaseBranch} head is the published state`,
  };
}
