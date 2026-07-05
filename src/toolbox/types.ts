// The context "toolbox": the extra skill-packages/frameworks (e.g. an SDD kit)
// and MCP servers available to the coordinator and its specialists. The catalog
// lives at .aipe/toolbox.yaml (published with the workspace) so the coordinator
// can read, in one place, what exists and — crucially — WHEN to reach for each
// (so it doesn't spawn a heavy SDD flow to change a button colour).

export type TaskSize = "small" | "medium" | "large";

// Optional structured signals so the coordinator can route mechanically instead
// of interpreting prose: only surface this skill for these task types, never for
// these, and only at/above this size.
export interface SkillRouting {
  taskTypes?: string[]; // e.g. ["feature", "refactor"]
  skipFor?: string[]; // e.g. ["styling", "copy", "one-liner"]
  minSize?: TaskSize; // e.g. "large" → skip small/medium tasks
}

export interface SkillEntry {
  name: string;
  description: string; // what the skill/framework is
  objective: string; // what it's for
  whenToUse: string; // free-text routing hint (human summary)
  repos: string[]; // repos it is installed into
  routing?: SkillRouting; // optional structured routing signals
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
