import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import { parseFqid } from "./fqid";
import type { GraphNode, MergedEdge, RelationType } from "./types";

const TYPES = new Set<RelationType>(["imports", "published-by", "consumes", "exposed-by", "shares-infra"]);

function isEdge(value: unknown): value is MergedEdge {
  if (typeof value !== "object" || value === null) return false;
  const e = value as Record<string, unknown>;
  return (
    typeof e.from === "string" &&
    typeof e.to === "string" &&
    typeof e.type === "string" &&
    TYPES.has(e.type as RelationType) &&
    Array.isArray(e.perspectives)
  );
}

function isNode(value: unknown): value is GraphNode {
  if (typeof value !== "object" || value === null) return false;
  const n = value as Record<string, unknown>;
  return (
    typeof n.fqid === "string" &&
    typeof n.repo === "string" &&
    (n.module === null || typeof n.module === "string") &&
    Array.isArray(n.stack)
  );
}

export interface Graph {
  nodes: GraphNode[];
  edges: MergedEdge[];
}

// Reads the existing .aipe/relations/graph.yaml. Parses both the current shape
// (`nodes:` + `edges:`) and legacy graphs (edges only → nodes synthesized from
// the edge endpoints). Missing/malformed → empty graph.
export async function readGraph(workspaceDir: string): Promise<Graph> {
  try {
    const raw = await readFile(join(workspaceDir, ".aipe", "relations", "graph.yaml"), "utf8");
    const parsed = parse(raw);
    if (parsed && typeof parsed === "object") {
      const edges = Array.isArray(parsed.edges) ? parsed.edges.filter(isEdge) : [];
      let nodes = Array.isArray(parsed.nodes) ? parsed.nodes.filter(isNode) : [];
      if (nodes.length === 0 && edges.length > 0) {
        // Legacy graph: synthesize minimal nodes from the endpoints so the
        // incremental merge has a node set to union against.
        const byFqid = new Map<string, GraphNode>();
        for (const e of edges) {
          for (const fqid of [e.from, e.to]) {
            if (byFqid.has(fqid)) continue;
            const { repo, module } = parseFqid(fqid);
            byFqid.set(fqid, { fqid, repo, module, stack: [] });
          }
        }
        nodes = [...byFqid.values()];
      }
      return { nodes, edges };
    }
  } catch {
    // missing or malformed
  }
  return { nodes: [], edges: [] };
}
