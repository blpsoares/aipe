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

  return [...byKey.values()].sort((a, b) => {
    if (a.from !== b.from) return a.from.localeCompare(b.from);
    if (a.to !== b.to) return a.to.localeCompare(b.to);
    return a.type.localeCompare(b.type);
  });
}
