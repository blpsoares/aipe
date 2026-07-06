import { makeFqid, parseFqid } from "./fqid";
import type { GraphNode, MergedEdge, Perspective, RelationType, RepoReport } from "./types";

interface RawEdge {
  from: string;
  to: string;
  type: RelationType;
  detail: string;
  evidence: string;
}

interface Canonical {
  from: string;
  to: string;
  type: RelationType;
}

function toRawEdges(reports: RepoReport[]): RawEdge[] {
  const edges: RawEdge[] = [];
  for (const report of reports) {
    for (const relation of report.relations) {
      // Qualify the local `from` to an fqid (`repo` or `repo/module`); `to` is
      // already fully qualified by the agent.
      const from = makeFqid(report.repo, relation.from);
      edges.push({ from, to: relation.to, type: relation.type, detail: relation.detail, evidence: relation.evidence });
    }
  }
  return edges;
}

function canonicalize(edge: RawEdge): Canonical {
  if (edge.type === "published-by") return { from: edge.to, to: edge.from, type: "imports" };
  if (edge.type === "exposed-by") return { from: edge.to, to: edge.from, type: "consumes" };
  if (edge.type === "shares-infra") {
    const [from, to] = [edge.from, edge.to].sort();
    return { from: from as string, to: to as string, type: "shares-infra" };
  }
  return { from: edge.from, to: edge.to, type: edge.type };
}

export function mergeEdges(reports: RepoReport[]): MergedEdge[] {
  const byKey = new Map<string, MergedEdge>();

  for (const edge of toRawEdges(reports)) {
    const canonical = canonicalize(edge);
    const key = `${canonical.from}|${canonical.to}|${canonical.type}`;
    const perspective: Perspective = { detail: edge.detail, evidence: edge.evidence };
    const existing = byKey.get(key);
    if (existing) {
      existing.perspectives.push(perspective);
    } else {
      byKey.set(key, { from: canonical.from, to: canonical.to, type: canonical.type, perspectives: [perspective] });
    }
  }

  return sortEdges([...byKey.values()]);
}

function sortEdges(edges: MergedEdge[]): MergedEdge[] {
  return edges.sort((a, b) => {
    if (a.from !== b.from) return a.from.localeCompare(b.from);
    if (a.to !== b.to) return a.to.localeCompare(b.to);
    return a.type.localeCompare(b.type);
  });
}

// Combines two already-merged edge lists (both canonicalized by mergeEdges),
// unioning perspectives for edges that share from|to|type and deduping
// identical perspectives. Used by incremental /relationship: fold a new repo's
// freshly-discovered edges into the existing graph without a full re-run.
export function combineMergedEdges(existing: MergedEdge[], incoming: MergedEdge[]): MergedEdge[] {
  const byKey = new Map<string, MergedEdge>();
  for (const edge of [...existing, ...incoming]) {
    const key = `${edge.from}|${edge.to}|${edge.type}`;
    const current = byKey.get(key);
    if (!current) {
      byKey.set(key, { ...edge, perspectives: [...edge.perspectives] });
      continue;
    }
    for (const p of edge.perspectives) {
      if (!current.perspectives.some((q) => q.detail === p.detail && q.evidence === p.evidence)) {
        current.perspectives.push(p);
      }
    }
  }
  return sortEdges([...byKey.values()]);
}

// Drops every edge that touches a repo no longer present in the context. Keeps
// an incremental merge from resurrecting stale edges if a repo was removed.
// Endpoints are fqids, so we compare their repo segment against the repo set.
export function pruneEdges(edges: MergedEdge[], repoNames: Set<string>): MergedEdge[] {
  return edges.filter((e) => repoNames.has(parseFqid(e.from).repo) && repoNames.has(parseFqid(e.to).repo));
}

function sortNodes(nodes: GraphNode[]): GraphNode[] {
  return nodes.sort((a, b) => a.fqid.localeCompare(b.fqid));
}

// Folds freshly-built nodes into the existing node set for the incremental path
// (/aipe-add-repo). An incoming node (re-scanned) wins over an existing one with
// the same fqid, so refreshed stack/description replace stale values.
export function combineNodes(existing: GraphNode[], incoming: GraphNode[]): GraphNode[] {
  const byFqid = new Map<string, GraphNode>();
  for (const node of existing) byFqid.set(node.fqid, node);
  for (const node of incoming) byFqid.set(node.fqid, node);
  return sortNodes([...byFqid.values()]);
}

// Drops nodes whose repo is no longer present in the context.
export function pruneNodes(nodes: GraphNode[], repoNames: Set<string>): GraphNode[] {
  return nodes.filter((n) => repoNames.has(n.repo));
}

// Builds the graph's nodes from the reports and the merged edges. A node exists
// for: (1) every declared module → `repo/module`; (2) every repo with no
// declared modules → the whole-repo fqid; (3) any edge endpoint that was never
// declared (e.g. a module in another repo the reporting agent named but whose
// owner didn't enumerate) → a synthesized minimal node, so no edge dangles.
export function buildNodes(reports: RepoReport[], edges: MergedEdge[]): GraphNode[] {
  const byFqid = new Map<string, GraphNode>();

  for (const report of reports) {
    const modules = report.modules ?? [];
    if (modules.length === 0) {
      const fqid = makeFqid(report.repo);
      byFqid.set(fqid, { fqid, repo: report.repo, module: null, stack: report.stack });
      continue;
    }
    for (const mod of modules) {
      const fqid = makeFqid(report.repo, mod.id);
      const node: GraphNode = { fqid, repo: report.repo, module: mod.id, stack: mod.stack ?? [] };
      if (mod.description !== undefined) node.description = mod.description;
      byFqid.set(fqid, node);
    }
  }

  // Synthesize minimal nodes for any endpoint not already declared.
  for (const edge of edges) {
    for (const fqid of [edge.from, edge.to]) {
      if (byFqid.has(fqid)) continue;
      const { repo, module } = parseFqid(fqid);
      byFqid.set(fqid, { fqid, repo, module, stack: [] });
    }
  }

  return sortNodes([...byFqid.values()]);
}
