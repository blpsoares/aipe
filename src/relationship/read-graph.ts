import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import type { MergedEdge, RelationType } from "./types";

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

// Reads the existing .aipe/relations/graph.yaml edges. Missing/malformed → [].
export async function readGraph(workspaceDir: string): Promise<MergedEdge[]> {
  try {
    const raw = await readFile(join(workspaceDir, ".aipe", "relations", "graph.yaml"), "utf8");
    const parsed = parse(raw);
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.edges)) {
      return parsed.edges.filter(isEdge);
    }
  } catch {
    // missing or malformed
  }
  return [];
}
