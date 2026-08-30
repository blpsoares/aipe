// The publication position of one repo — the fact that distinguishes a unit
// merged into an integration branch from one that is actually published in a
// release (j-20260830-zd). Everything here is DERIVED from verifiable local git
// (semver tags + branch relationships), never from convention and never from the
// GitHub API. When a fact cannot be read from the clone, the state is `unknown`
// and says so — the house rule is to refuse the comfortable assumption.
import type { PublishFlow, RepoEntry } from "../context-brain/types";

export type { PublishFlow };

// Verifiable git facts about one repo's release position. Every count is
// nullable: `null` means "could not be established from this clone" (no tag, a
// missing ref, a git failure) and MUST NOT be read as zero — that is the honesty
// seam the derivation leans on.
export interface RepoReleaseFacts {
  flow: PublishFlow;
  // A semver release tag exists at all. false ⇒ the repo has never published.
  hasRelease: boolean;
  // The highest semver release tag (e.g. "v1.11.0"), or null when none exists.
  latestReleaseTag: string | null;
  // Commits on the release branch beyond the PUBLISHED baseline — the "main is
  // ahead of the last release" backlog. Baseline = the latest release tag when
  // one exists; otherwise the release-branch head itself (a tag-less repo
  // publishes AT main, so the resolver reports 0 here rather than "all of main").
  // null ⇒ undeterminable (release branch unreadable).
  unreleasedOnMain: number | null;
  // dev-then-main only: commits on the integration branch beyond the release
  // branch — the "merged into dev, not yet promoted" backlog. null ⇒
  // undeterminable; always null for main-direct (no integration step to measure).
  unpromotedOnDev: number | null;
  releaseBranch: string;
  integrationBranch: string;
}

// The three-way answer. `merged-unpublished` and `unknown` are BOTH surfaced
// (represado in status, a warning in verify); only `published` is silent.
export type PublishState = "published" | "merged-unpublished" | "unknown";

export interface RepoReleaseState {
  repo: string;
  flow: PublishFlow;
  state: PublishState;
  latestReleaseTag: string | null;
  // The backlog counts carried through so a reader (and the status counter that
  // "must not count wrong") sees the actual numbers, not a re-derivation.
  unreleasedOnMain: number | null;
  unpromotedOnDev: number | null;
  reason: string; // a plain sentence: why this state, with the numbers in it
}

// The injected git-facts resolver. The CLI wires the real local-git one; tests
// pass a fake. Mirrors how reconcile/verify inject their forge resolvers so the
// pure derivation and the surfaces stay testable offline.
export type ReleaseResolver = (repo: RepoEntry, repoAbs: string) => Promise<RepoReleaseState>;
