// The single place the repo → unit expansion lives. Everything downstream
// (hiring, the dispatch law, worktrees, relations, the pipeline) is keyed on the
// *package*, not the repo. A repo with no declared packages resolves to exactly one
// implicit package (name = the repo name, path = the repo root), so a single-repo
// workspace is indistinguishable from before — the package layer collapses onto
// the repo layer when absent.
import { join } from "node:path";
import type { BrainFile } from "./types";

export interface ResolvedPackage {
  repo: string; // repo name (the git clone)
  package: string; // package name (= repo name when implicit)
  fqid: string; // "repo/package", or just "repo" when implicit — the serialization key
  repoPath: string; // repo.path (relative to the workspace)
  packagePath: string; // package.path relative to the repo ("." when implicit)
  path: string; // package dir relative to the workspace (repoPath + packagePath) — for confinement
  stack: string[];
  group: string; // hiring group (defaults to the package name) — packages sharing it share a pair
  implicit: boolean; // true when the repo declared no packages
}

// Normalize a repo-relative path ("." / "" → repo root).
function repoRel(p: string): string {
  const t = (p ?? "").trim();
  return t === "" || t === "." || t === "./" ? "." : t.replace(/^\.\//, "").replace(/\/+$/, "");
}

export function resolvePackages(brain: BrainFile): ResolvedPackage[] {
  const out: ResolvedPackage[] = [];
  for (const repo of brain.repos) {
    if (repo.packages && repo.packages.length > 0) {
      for (const m of repo.packages) {
        const mp = repoRel(m.path);
        out.push({
          repo: repo.name,
          package: m.name,
          fqid: `${repo.name}/${m.name}`,
          repoPath: repo.path,
          packagePath: mp,
          path: mp === "." ? repo.path : join(repo.path, mp),
          stack: m.stack ?? repo.stack ?? [],
          group: m.group ?? m.name,
          implicit: false,
        });
      }
    } else {
      out.push({
        repo: repo.name,
        package: repo.name,
        fqid: repo.name,
        repoPath: repo.path,
        packagePath: ".",
        path: repo.path,
        stack: repo.stack ?? [],
        group: repo.name,
        implicit: true,
      });
    }
  }
  return out;
}

// The fully-qualified id used as the dispatch serialization key and graph node.
// Implicit packages use the bare repo name (backward compatible with existing
// graphs/dispatches that referenced repos directly).
export function packageFqid(repo: string, pkg?: string | null): string {
  return pkg && pkg !== repo ? `${repo}/${pkg}` : repo;
}

export function findModule(brain: BrainFile, fqid: string): ResolvedPackage | undefined {
  return resolvePackages(brain).find((m) => m.fqid === fqid);
}

// Distinct hiring groups across the context (a "team" gets one specialist pair).
// Returns one representative package per (repo, group).
export function resolveGroups(brain: BrainFile): { repo: string; group: string; packages: ResolvedPackage[] }[] {
  const byKey = new Map<string, { repo: string; group: string; packages: ResolvedPackage[] }>();
  for (const m of resolvePackages(brain)) {
    const key = `${m.repo}/${m.group}`;
    const g = byKey.get(key) ?? { repo: m.repo, group: m.group, packages: [] };
    g.packages.push(m);
    byKey.set(key, g);
  }
  return [...byKey.values()];
}
