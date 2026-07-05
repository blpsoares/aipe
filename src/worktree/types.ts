import type { BrainFile, RepoEntry } from "../context-brain/types";

export type { BrainFile, RepoEntry };

// A dispatched specialist's isolated working tree, derived deterministically
// from (repo, journey, specialist). Convention (foundation spec §6):
//   path:   <repo>/.worktrees/<journey-id>-<slug>/
//   branch: aipe/<journey-id>/<slug>
export interface WorktreeSpec {
  repo: string; // repo name (from brain.yaml)
  specialist: string; // persona display name
  module?: string; // module name/slug (absent ⇒ implicit whole-repo module)
  journey: string; // journey id
  slug: string; // personaSlug(specialist)
  moduleSlug: string | null; // personaSlug(module) when a real module, else null
  branch: string; // aipe/<journey>/<combined>
  relPath: string; // .worktrees/<journey>-<combined> (relative to the repo dir)
}

// A live worktree discovered by `git worktree list`, filtered to AIPe branches.
export interface WorktreeRow {
  repo: string;
  slug: string;
  module?: string; // module slug recovered from the branch (absent ⇒ implicit)
  journey: string;
  branch: string;
  path: string; // absolute
}

export type CreateResult =
  | { ok: true; path: string; branch: string; created: boolean }
  | { ok: false; error: string };

export type RemoveResult =
  | { ok: true; path: string }
  | { ok: false; blocked: boolean; error: string };
