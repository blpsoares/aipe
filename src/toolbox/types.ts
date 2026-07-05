// The context "toolbox": the extra skill-packages/frameworks (e.g. an SDD kit)
// and MCP servers available to the coordinator and its specialists. The catalog
// lives at .aipe/toolbox.yaml (published with the workspace) so the coordinator
// can read, in one place, what exists and — crucially — WHEN to reach for each
// (so it doesn't spawn a heavy SDD flow to change a button colour).

export interface SkillEntry {
  name: string;
  description: string; // what the skill/framework is
  objective: string; // what it's for
  whenToUse: string; // the routing hint the coordinator/specialists use
  repos: string[]; // repos it is installed into
}

export interface McpEntry {
  name: string;
  scope: "workspace" | "repo"; // workspace = shared by all specialists
  repos: string[]; // for scope=repo
  description: string;
  config: unknown; // the harness MCP server definition (secret-free; use env refs)
}

export interface Toolbox {
  skills: SkillEntry[];
  mcps: McpEntry[];
}

export function emptyToolbox(): Toolbox {
  return { skills: [], mcps: [] };
}
