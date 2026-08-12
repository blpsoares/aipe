import { repoOf } from "../relationship/fqid";
import { readGraph } from "../relationship/read-graph";
import type { MergedEdge } from "../relationship/types";
import { readPersonas } from "../hire-specialists/read-personas";

export interface PersonaContext {
  personas: { name: string; role: "dev-fullstack" | "qa" }[];
  edges: MergedEdge[];
}

export async function readPersonaContext(root: string, repoName: string): Promise<PersonaContext> {
  const roster = await readPersonas(root);
  const personas = roster
    .filter((p): p is typeof p & { role: "dev-fullstack" | "qa" } => p.repo === repoName && p.role !== "coordinator")
    .map((p) => ({ name: p.name, role: p.role }));

  const graph = await readGraph(root);
  const edges = graph.edges.filter((e) => repoOf(e.from) === repoName || repoOf(e.to) === repoName);

  return { personas, edges };
}
