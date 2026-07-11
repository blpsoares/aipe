// Re-syncs the coordinator flow-skills (operate, context-brain, relationship,
// hire-specialists, toolbox, aipe-add-repo, make-workspace) installed in a
// workspace against the versions embedded in THIS `aipe` binary.
//
// Why it exists (#13): `installIntegration` writes the flow-skills into the
// workspace once, at `aipe start`. When the binary is later upgraded — carrying
// reinforced skill text (e.g. the #12 rule-authoring pass) — the installed copies
// go stale, so the coordinator can run an old skill (fewer gates, weaker rules)
// than the repo ships. This restores/refreshes them so the workspace never runs a
// stale skill. Idempotent: unchanged skills are left untouched (no rewrite).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { FLOW_SKILLS } from "../harness/skills";
import { resolveAdapter } from "../harness/registry";

export interface FlowSkillRow {
  name: string;
  status: "installed" | "updated" | "unchanged";
}

async function readIfPresent(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

export async function rehydrateFlowSkills(workspaceDir: string): Promise<FlowSkillRow[]> {
  const adapter = await resolveAdapter(workspaceDir);
  const rows: FlowSkillRow[] = [];

  for (const [name, body] of Object.entries(FLOW_SKILLS)) {
    const { relDir, filename } = adapter.flowSkillTarget(name);
    const dir = join(workspaceDir, relDir);
    const path = join(dir, filename);

    const current = await readIfPresent(path);
    if (current === body) {
      rows.push({ name, status: "unchanged" });
      continue;
    }

    await mkdir(dir, { recursive: true });
    await writeFile(path, body, "utf8");
    rows.push({ name, status: current === null ? "installed" : "updated" });
  }

  return rows;
}
