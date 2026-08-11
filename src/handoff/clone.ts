import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Cloner, Inspector } from "../make-workspace/clone";
import type { ManifestEntry, ManifestFile, RepoInput } from "./types";

export async function materializeHandoffRepo(
  repo: RepoInput,
  outDir: string,
  inspect: Inspector,
  clone: Cloner,
): Promise<ManifestEntry> {
  if (repo.localPath) {
    const info = await inspect(repo.localPath);
    if (!info.exists || !info.isGitRepo) {
      return { name: repo.name, status: "error", message: `not a git repo: ${repo.localPath} (repo: ${repo.name})` };
    }
    const entry: ManifestEntry = { name: repo.name, status: "ok", path: repo.localPath };
    if (info.remote) entry.url = info.remote;
    return entry;
  }

  if (!repo.url) {
    return { name: repo.name, status: "error", message: "no URL or local path given" };
  }

  const absPath = join(outDir, repo.name);
  const info = await inspect(absPath);
  if (info.exists) {
    return { name: repo.name, status: "ok", path: absPath, url: repo.url };
  }

  const result = await clone(repo.url, absPath);
  if (result.ok) return { name: repo.name, status: "ok", path: absPath, url: repo.url };
  return { name: repo.name, status: "error", message: result.message };
}

function manifestPath(outDir: string): string {
  return join(outDir, ".aipe-handoff", "repos.json");
}

export async function writeManifest(outDir: string, entries: ManifestEntry[]): Promise<void> {
  await mkdir(join(outDir, ".aipe-handoff"), { recursive: true });
  const file: ManifestFile = { repos: entries };
  await writeFile(manifestPath(outDir), JSON.stringify(file, null, 2), "utf8");
}

export async function readManifest(outDir: string): Promise<ManifestEntry[]> {
  try {
    const raw = await readFile(manifestPath(outDir), "utf8");
    const parsed = JSON.parse(raw) as ManifestFile;
    return Array.isArray(parsed.repos) ? parsed.repos : [];
  } catch {
    return [];
  }
}
