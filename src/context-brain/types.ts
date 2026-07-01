export interface RepoEntry {
  name: string;
  url: string;
  path: string;
  stack?: string[];
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
    generator: Phase;
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
