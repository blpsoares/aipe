// Restores the context toolbox after re-cloning on another machine: re-installs
// each catalogued skill-package into its repos (from .aipe/skills/) and
// regenerates every .mcp.json (workspace + per-repo) from .aipe/toolbox.yaml.
// The catalog is published; the per-repo installs and .mcp.json files are not,
// so they must be rebuilt. Reuses the (idempotent) install paths.
import { join } from "node:path";
import { readToolbox } from "../toolbox/catalog";
import { installMcp } from "../toolbox/mcp";
import { installSkill } from "../toolbox/skills";

export interface ToolboxRehydrateRow {
  kind: "skill" | "mcp";
  name: string;
  status: "restored" | "error";
}

export async function rehydrateToolbox(workspaceDir: string): Promise<ToolboxRehydrateRow[]> {
  const tb = await readToolbox(workspaceDir);
  const rows: ToolboxRehydrateRow[] = [];

  for (const skill of tb.skills) {
    const result = await installSkill(workspaceDir, {
      name: skill.name,
      description: skill.description,
      objective: skill.objective,
      whenToUse: skill.whenToUse,
      repos: skill.repos,
      source: join(workspaceDir, ".aipe", "skills", skill.name),
    });
    rows.push({ kind: "skill", name: skill.name, status: result.ok ? "restored" : "error" });
  }

  for (const mcp of tb.mcps) {
    const result = await installMcp(workspaceDir, {
      name: mcp.name,
      scope: mcp.scope,
      repos: mcp.repos,
      description: mcp.description,
      config: mcp.config,
    });
    rows.push({ kind: "mcp", name: mcp.name, status: result.ok ? "restored" : "error" });
  }

  return rows;
}
