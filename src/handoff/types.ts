import type { RepoReport } from "../relationship/types";

export interface RepoInput {
  name: string;
  url?: string;
  localPath?: string;
}

// A per-repo agent report for /handoff. Same shape as /relationship's
// RepoReport, plus `purpose`: /handoff has no brain.yaml to read a
// description from, so the agent must supply a one-sentence summary.
export interface HandoffRepoReport extends RepoReport {
  purpose: string;
}

export interface ManifestEntry {
  name: string;
  status: "ok" | "error";
  path?: string; // absolute local path, present when status is "ok"
  url?: string; // resolved remote (given or auto-detected), present when known
  message?: string; // present when status is "error"
}

export interface ManifestFile {
  repos: ManifestEntry[];
}
