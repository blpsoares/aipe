import type { MergedEdge, Perspective, RelationType, RepoReport } from "./types";

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
      edges.push({ from: report.repo, to: relation.to, type: relation.type, detail: relation.detail, evidence: relation.evidence });
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
export function pruneEdges(edges: MergedEdge[], repoNames: Set<string>): MergedEdge[] {
  return edges.filter((e) => repoNames.has(e.from) && repoNames.has(e.to));
}
