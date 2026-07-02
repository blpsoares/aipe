import type { BrainFile, RepoEntry } from "../context-brain/types";

export type { BrainFile, RepoEntry };

export type RepoStatus = "cloned" | "skipped" | "error";

export interface RepoResult {
  name: string;
  status: RepoStatus;
  message?: string;
}

export type WorkspacePhase = "pending" | "done";
