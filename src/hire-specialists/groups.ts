import { readGraph } from "../relationship/read-graph";
import type { BrainFile, HiringGroup } from "./types";

// One hiring group per repo — the backward-compatible default when the
// relationship graph has no module nodes (or no graph at all).
export function repoGroups(brain: BrainFile): HiringGroup[] {
  return brain.repos.map((r) => ({ fqid: r.name, repo: r.name, module: null, stack: r.stack ?? [] }));
}

// The hiring groups for a context: the relationship graph's nodes (a repo or a
// module, each keyed by fqid), falling back to one group per repo when the
// graph has no nodes. Groups are restricted to repos still present in the brain.
export async function readHiringGroups(workspaceDir: string, brain: BrainFile): Promise<HiringGroup[]> {
  const { nodes } = await readGraph(workspaceDir);
  const repoNames = new Set(brain.repos.map((r) => r.name));
  const fromNodes = nodes
    .filter((n) => repoNames.has(n.repo))
    .map((n) => ({ fqid: n.fqid, repo: n.repo, module: n.module, stack: n.stack }));
  return fromNodes.length > 0 ? fromNodes : repoGroups(brain);
}
