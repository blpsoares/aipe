import type { BrainFile, RepoEntry } from "../context-brain/types";

export type { BrainFile, RepoEntry };

// A dispatched specialist's isolated working tree, derived deterministically
// from (repo, journey, specialist). Convention (foundation spec §6):
//   path:   <repo>/.worktrees/<journey-id>-<slug>/
//   branch: aipe/<journey-id>/<slug>
export interface WorktreeSpec {
  repo: string; // repo name (from brain.yaml)
  specialist: string; // persona display name
  journey: string; // journey id
  slug: string; // personaSlug(specialist)
  branch: string; // aipe/<journey>/<slug>
  relPath: string; // .worktrees/<journey>-<slug> (relative to the repo dir)
}

// A live worktree discovered by `git worktree list`, filtered to AIPe branches.
export interface WorktreeRow {
  repo: string;
  slug: string;
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
