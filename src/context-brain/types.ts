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

export interface RepoEntry {
  name: string;
  url: string;
  path: string;
  stack?: string[];
  packages?: PackageEntry[];
  kind?: string; // functional category of the repo: api | web | lib | service | …
}

/**
 * A repo as DECLARED by the PE (via `/context-brain` or `aipe add-repo`).
 *
 * `path` is optional here and required in `RepoEntry`: what the PE hands in may
 * omit it, what is written to brain.yaml never does. `normalizeRepoPaths()`
 * (src/context-brain/layout.ts) is the only thing that bridges the two.
 */
export type RepoInput = Omit<RepoEntry, "path"> & { path?: string };

export interface ContextMeta {
  name: string;
  coordinator: string;
  // The PE's own name (optional — a missing value degrades gracefully:
  // session-hook awareness just omits the "You work for <pe>" clause).
  pe?: string;
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
