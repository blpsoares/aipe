// A module is the unit of work below a repo (a package/service/app inside a
// monorepo). A repo with no declared modules is exactly one implicit module
// spanning the whole repo — so single-repo workspaces behave unchanged.
export interface ModuleEntry {
  name: string; // unique within its repo
  path: string; // relative to the repo root (e.g. "packages/core")
  stack?: string[];
  group?: string; // optional "area": modules sharing a group share one specialist pair
}

export interface RepoEntry {
  name: string;
  url: string;
  path: string;
  stack?: string[];
  modules?: ModuleEntry[];
}

export interface ContextMeta {
  name: string;
  coordinator: string;
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
  repos: RepoEntry[];
}

export interface ValidationError {
  field: string;
  message: string;
}

export type ValidationResult =
  | { ok: true }
  | { ok: false; errors: ValidationError[] };
