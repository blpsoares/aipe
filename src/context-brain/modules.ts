// The single place the repo → unit expansion lives. Everything downstream
// (hiring, the dispatch law, worktrees, relations, the pipeline) is keyed on the
// *module*, not the repo. A repo with no declared modules resolves to exactly one
// implicit module (name = the repo name, path = the repo root), so a single-repo
// workspace is indistinguishable from before — the module layer collapses onto
// the repo layer when absent.
import { join } from "node:path";
import type { BrainFile } from "./types";

export interface ResolvedModule {
  repo: string; // repo name (the git clone)
  module: string; // module name (= repo name when implicit)
  fqid: string; // "repo/module", or just "repo" when implicit — the serialization key
  repoPath: string; // repo.path (relative to the workspace)
  modulePath: string; // module.path relative to the repo ("." when implicit)
  path: string; // module dir relative to the workspace (repoPath + modulePath) — for confinement
  stack: string[];
  group: string; // hiring group (defaults to the module name) — modules sharing it share a pair
  implicit: boolean; // true when the repo declared no modules
}

// Normalize a repo-relative path ("." / "" → repo root).
function repoRel(p: string): string {
  const t = (p ?? "").trim();
  return t === "" || t === "." || t === "./" ? "." : t.replace(/^\.\//, "").replace(/\/+$/, "");
}

export function resolveModules(brain: BrainFile): ResolvedModule[] {
  const out: ResolvedModule[] = [];
  for (const repo of brain.repos) {
    if (repo.modules && repo.modules.length > 0) {
      for (const m of repo.modules) {
        const mp = repoRel(m.path);
        out.push({
          repo: repo.name,
          module: m.name,
          fqid: `${repo.name}/${m.name}`,
          repoPath: repo.path,
          modulePath: mp,
          path: mp === "." ? repo.path : join(repo.path, mp),
          stack: m.stack ?? repo.stack ?? [],
          group: m.group ?? m.name,
          implicit: false,
        });
      }
    } else {
      out.push({
        repo: repo.name,
        module: repo.name,
        fqid: repo.name,
        repoPath: repo.path,
        modulePath: ".",
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
// Implicit modules use the bare repo name (backward compatible with existing
// graphs/dispatches that referenced repos directly).
export function moduleFqid(repo: string, module?: string | null): string {
  return module && module !== repo ? `${repo}/${module}` : repo;
}

export function findModule(brain: BrainFile, fqid: string): ResolvedModule | undefined {
  return resolveModules(brain).find((m) => m.fqid === fqid);
}

// Distinct hiring groups across the context (a "team" gets one specialist pair).
// Returns one representative module per (repo, group).
export function resolveGroups(brain: BrainFile): { repo: string; group: string; modules: ResolvedModule[] }[] {
  const byKey = new Map<string, { repo: string; group: string; modules: ResolvedModule[] }>();
  for (const m of resolveModules(brain)) {
    const key = `${m.repo}/${m.group}`;
    const g = byKey.get(key) ?? { repo: m.repo, group: m.group, modules: [] };
    g.modules.push(m);
    byKey.set(key, g);
  }
  return [...byKey.values()];
}
