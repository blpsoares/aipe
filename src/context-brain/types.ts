// A package is the unit of work below a repo (a package/service/app inside a
// monorepo). A repo with no declared packages is exactly one implicit package
// spanning the whole repo — so single-repo workspaces behave unchanged.
export interface PackageEntry {
  name: string; // unique within its repo
  path: string; // relative to the repo root (e.g. "packages/core")
  stack?: string[];
  group?: string; // optional "area": packages sharing a group share one specialist pair
  kind?: string; // functional category of the unit: api | web | lib | service | …
}

// How a repo's merged work reaches a published release — the axis that makes
// "merged" distinguishable from "published" (j-20260830-zd). Two real flows in
// this context:
//   • "dev-then-main": a PR lands in an integration branch (dev); publication
//     needs a further promotion to the release branch (main) AND a release.
//     Merged-into-dev is NOT yet published.
//   • "main-direct": a PR lands straight in the release branch (main); the unit
//     IS published once there (the openvibes-embark flow — the PE dispensed CI
//     on its PRs, and a merge into main is the release). Not marked "unpublished"
//     for lacking a dev step.
// Absent from a RepoEntry ⇒ auto-detected from git (presence of an integration
// branch), so a brain written before this feature needs no rewrite.
export type PublishFlow = "dev-then-main" | "main-direct";

// Optional, PE-declared override of the publish flow for a repo. It only PINS
// what git otherwise auto-detects (never invents a fact) — a repo whose `dev`
// branch exists for an unrelated reason, or one the PE wants explicit. The
// branch names default to main/dev when omitted.
export interface RepoPublish {
  flow?: PublishFlow;
  releaseBranch?: string; // default "main"
  integrationBranch?: string; // default "dev"
}

export interface RepoEntry {
  name: string;
  url: string;
  path: string;
  stack?: string[];
  packages?: PackageEntry[];
  kind?: string; // functional category of the repo: api | web | lib | service | …
  publish?: RepoPublish; // optional override of the auto-detected publish flow
}

/**
 * A repo as DECLARED by the PE (via `/context-brain` or `aipe add-repo`).
 *
 * `path` is optional here and required in `RepoEntry`: what the PE hands in may
 * omit it, what is written to brain.yaml never does. `normalizeRepoPaths()`
 * (src/context-brain/layout.ts) is the only thing that bridges the two.
 */
export type RepoInput = Omit<RepoEntry, "path"> & { path?: string };

export type StatusUpdatesFormat = "detailed" | "compact";

// The (10) follow-preference, chosen once at onboarding. `auto` is the switch for
// item 9 (push a status table after each change); `format` is which of the two
// renderings that push uses. ABSENT on every brain written before this feature —
// absence IS `auto:false` — so it is optional here and never injected by a
// re-write of a brain that does not carry it.
export interface StatusUpdatesConfig {
  auto: boolean;
  format: StatusUpdatesFormat;
}

export interface ContextMeta {
  name: string;
  coordinator: string;
  // The PE's own name (optional — a missing value degrades gracefully:
  // session-hook awareness just omits the "You work for <pe>" clause).
  pe?: string;
  statusUpdates?: StatusUpdatesConfig;
}

export interface BrainFile {
  context: ContextMeta;
  repos: RepoEntry[];
}

export type Phase = "pending" | "done";

export interface StateFile {
  phase: {
    brain: Phase;
    workspace: Phase;
    relationship: Phase;
    specialists: Phase;
  };
}

export interface ContextInput {
  context: ContextMeta;
  repos: RepoInput[];
}

export interface ValidationError {
  field: string;
  message: string;
}

export type ValidationResult =
  | { ok: true }
  | { ok: false; errors: ValidationError[] };
