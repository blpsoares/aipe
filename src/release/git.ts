// The real, local-git facts resolver behind a repo's release state. Everything
// here reads the LOCAL clone (tags, branch relationships) — never the GitHub API
// — so the fact is offline, rate-limit-free, and immune to the "gh failed, so
// assume not-published" failure mode (j-20260830-zd). The low-level git runner is
// injectable so tests can drive it against a real temp repo (the strongest
// evidence) or a fake.
import type { RepoEntry } from "../context-brain/types";
import { compareVersions, toSemver } from "../update/check";
import { deriveReleaseState } from "./state";
import type { PublishFlow, ReleaseResolver, RepoReleaseFacts } from "./types";

export type GitRun = (cmd: string[]) => Promise<{ code: number; stdout: string; stderr: string }>;

const realRun: GitRun = async (cmd) => {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  return { code, stdout: stdout.trim(), stderr: stderr.trim() };
};

// A ref may live under origin/ (a fresh workspace clone) or locally (a checked-out
// repo). Prefer the remote-tracking ref — it is what the PE's branches are really
// measured against — then fall back to the local branch.
async function resolveRef(run: GitRun, repo: string, name: string): Promise<string | null> {
  for (const cand of [`origin/${name}`, name]) {
    const r = await run(["git", "-C", repo, "rev-parse", "--verify", "--quiet", cand]);
    if (r.code === 0 && r.stdout) return cand;
  }
  return null;
}

// `git rev-list --count <range>` → a number, or null when git could not answer
// (an unreadable range must never be read as zero — that is the honesty seam).
async function count(run: GitRun, repo: string, range: string): Promise<number | null> {
  const r = await run(["git", "-C", repo, "rev-list", "--count", range]);
  if (r.code !== 0) return null;
  const n = Number(r.stdout.trim());
  return Number.isFinite(n) ? n : null;
}

async function isAncestor(run: GitRun, repo: string, a: string, b: string): Promise<boolean> {
  const r = await run(["git", "-C", repo, "merge-base", "--is-ancestor", a, b]);
  return r.code === 0;
}

// The highest semver release tag REACHABLE FROM `ref`, or null. Two rules:
//   • Only pure semver tags count as releases (the same rule `update/check` uses),
//     so a stray annotated tag never poses as one.
//   • `git tag --merged <ref>` restricts to tags whose commit is an ancestor of
//     the release ref — i.e. tags actually on THIS repo's lineage. A tag sitting
//     only in the object pool (fetched from an `upstream` remote, never merged
//     into main) is invisible, so it can never be chosen as a baseline the repo's
//     own history does not contain (#75: the v1.5.0/v1.5.1 that came from
//     `upstream` and produced the phantom "156/157 commits beyond").
async function latestReachableTag(run: GitRun, repo: string, ref: string): Promise<string | null> {
  const r = await run(["git", "-C", repo, "tag", "--list", "--merged", ref]);
  if (r.code !== 0) return null;
  const semvers = r.stdout
    .split("\n")
    .map((t) => t.trim())
    .filter(Boolean)
    .map((raw) => ({ raw, v: toSemver(raw) }))
    .filter((x): x is { raw: string; v: string } => x.v !== null)
    .sort((a, b) => compareVersions(b.v, a.v));
  return semvers[0]?.raw ?? null;
}

async function gatherFacts(run: GitRun, repo: RepoEntry, repoAbs: string): Promise<RepoReleaseFacts> {
  const pub = repo.publish ?? {};
  const releaseBranch = pub.releaseBranch ?? "main";
  const integrationBranch = pub.integrationBranch ?? "dev";

  const [mainRef, devRef] = await Promise.all([
    resolveRef(run, repoAbs, releaseBranch),
    resolveRef(run, repoAbs, integrationBranch),
  ]);
  // The baseline tag is chosen from tags REACHABLE from the release ref, not the
  // object pool — so it needs mainRef. No release ref ⇒ no reachable-tag baseline.
  const tag = mainRef ? await latestReachableTag(run, repoAbs, mainRef) : null;
  const hasRelease = tag !== null;

  // unreleasedOnMain: commits on the release branch beyond the PUBLISHED baseline.
  //   • releaseVia "push": the branch head IS the published state → 0 (an old tag
  //     on the lineage is not a backlog). The openvibes-embark aipe-site flow.
  //   • no reachable tag: the repo has never tagged on this lineage → publishes at
  //     head → 0 (a tag-less repo is never "all of main").
  //   • main AT the tag (0 beyond): published.
  //   • main BEYOND the tag AND releaseVia "tag": an established tag-release
  //     backlog → the real count (REPRESADO).
  //   • main BEYOND the tag but method UNESTABLISHED: a tag-release backlog and a
  //     push-published repo are indistinguishable from git, so the count is NOT
  //     asserted (unreleasedOnMain stays null) and mainBaselineUnverified carries
  //     the honest detail → the derivation says "unknown", never a false REPRESADO
  //     (#74). Registering publish.releaseVia resolves it either way.
  const releaseVia = pub.releaseVia;
  let unreleasedOnMain: number | null;
  let mainBaselineUnverified: { tag: string; ahead: number } | undefined;
  if (!mainRef) unreleasedOnMain = null;
  else if (releaseVia === "push") unreleasedOnMain = 0;
  else if (!hasRelease) unreleasedOnMain = 0;
  else {
    const ahead = await count(run, repoAbs, `${tag}..${mainRef}`);
    if (ahead === null || ahead === 0) unreleasedOnMain = ahead;
    else if (releaseVia === "tag") unreleasedOnMain = ahead;
    else {
      unreleasedOnMain = null;
      mainBaselineUnverified = { tag: tag!, ahead };
    }
  }

  // Flow + the unpromoted (merged-into-dev-not-in-main) count. A brain override
  // pins the flow (the PE's explicit registration); otherwise it is auto-detected
  // from git — and the detection deliberately keys on dev being AHEAD of main, not
  // on a `dev` branch merely existing. An abandoned integration branch falls
  // behind main (0 ahead), so it reads as main-direct and never manufactures a
  // permanent false "represado" (the embark-me case the coordinator measured).
  let flow: PublishFlow;
  let unpromotedOnDev: number | null;

  if (pub.flow === "main-direct") {
    flow = "main-direct";
    unpromotedOnDev = null;
  } else if (pub.flow === "dev-then-main") {
    flow = "dev-then-main";
    unpromotedOnDev = devRef && mainRef ? await count(run, repoAbs, `${mainRef}..${devRef}`) : null;
  } else if (!devRef || !mainRef) {
    flow = "main-direct";
    unpromotedOnDev = null;
  } else {
    const devAhead = await count(run, repoAbs, `${mainRef}..${devRef}`);
    if (devAhead === null || devAhead === 0) {
      // Nothing on dev that main lacks → no integration in flight. Either an
      // abandoned/in-sync dev or a git we could not read; both mean "no dev
      // backlog", so main-direct is the honest, false-positive-free reading.
      flow = "main-direct";
      unpromotedOnDev = null;
    } else {
      // dev is ahead of main → it holds unpromoted work. Confirm it is on the
      // release lineage (a live integration branch, not a stale fork off an old
      // base): main is fully contained in dev, OR the latest release tag is an
      // ancestor of dev. Otherwise we cannot trust the ahead-count as promotion
      // backlog, so we leave it null and let the derivation say "unknown".
      const mainAhead = await count(run, repoAbs, `${devRef}..${mainRef}`);
      const cleanSuperset = mainAhead === 0;
      const anchored = hasRelease && (await isAncestor(run, repoAbs, tag!, devRef));
      flow = "dev-then-main";
      unpromotedOnDev = cleanSuperset || anchored ? devAhead : null;
    }
  }

  return {
    flow,
    hasRelease,
    latestReleaseTag: tag,
    unreleasedOnMain,
    unpromotedOnDev,
    releaseBranch,
    integrationBranch,
    ...(mainBaselineUnverified ? { mainBaselineUnverified } : {}),
  };
}

// Factory so the git runner can be injected; the default reads real local git.
export function makeReleaseResolver(run: GitRun = realRun): ReleaseResolver {
  return async (repo: RepoEntry, repoAbs: string) => deriveReleaseState(repo.name, await gatherFacts(run, repo, repoAbs));
}

export const realReleaseResolver: ReleaseResolver = makeReleaseResolver();
