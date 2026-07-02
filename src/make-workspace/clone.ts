import { join } from "node:path";
import type { RepoEntry, RepoResult } from "./types";

export interface RepoInspection {
  exists: boolean;
  isGitRepo: boolean;
  remote?: string;
}

export type Inspector = (absPath: string) => Promise<RepoInspection>;
export type Cloner = (
  url: string,
  absPath: string,
) => Promise<{ ok: true } | { ok: false; message: string }>;

function canonicalizeRemote(url: string): string {
  let s = url.trim();
  if (s.endsWith(".git")) s = s.slice(0, -4);
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//i, ""); // remove protocol (https://, ssh://)
  s = s.replace(/^[^@/]+@/, ""); // remove user@ (git@host)
  s = s.replace(":", "/"); // host:org/repo → host/org/repo (ssh scp-like)
  s = s.replace(/\/+$/, "");
  return s.toLowerCase();
}

export function remotesMatch(a: string, b: string): boolean {
  return canonicalizeRemote(a) === canonicalizeRemote(b);
}

export async function materializeRepo(
  repo: RepoEntry,
  workspaceDir: string,
  inspect: Inspector,
  clone: Cloner,
): Promise<RepoResult> {
  const absPath = join(workspaceDir, repo.path);
  const info = await inspect(absPath);

  if (!info.exists) {
    const result = await clone(repo.url, absPath);
    if (result.ok) return { name: repo.name, status: "cloned" };
    return { name: repo.name, status: "error", message: result.message };
  }

  if (info.isGitRepo && info.remote && remotesMatch(info.remote, repo.url)) {
    return { name: repo.name, status: "skipped", message: "already present" };
  }

  return {
    name: repo.name,
    status: "error",
    message: `path occupied by different content (${repo.path})`,
  };
}
