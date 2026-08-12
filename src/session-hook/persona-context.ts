// Placeholder — replaced by Task 6 with the real implementation (reads
// personas.yaml + relations/graph.yaml for a repo).
export interface PersonaContext {
  personas: { name: string; role: string }[];
  edges: unknown[];
}

export async function readPersonaContext(_root: string, _repoName: string): Promise<PersonaContext> {
  return { personas: [], edges: [] };
}
