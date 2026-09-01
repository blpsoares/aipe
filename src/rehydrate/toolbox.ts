// Restores the context toolbox after re-cloning on another machine: re-installs
// each catalogued skill-package into its repos (from .aipe/skills/) and
// regenerates every .mcp.json (workspace + per-repo) from .aipe/toolbox.yaml.
// The catalog is published; the per-repo installs and .mcp.json files are not,
// so they must be rebuilt. Reuses the (idempotent) install paths.
import { access } from "node:fs/promises";
import { join } from "node:path";
import { readBrain } from "../make-workspace/read";
import { readToolbox } from "../toolbox/catalog";
import { installMcp } from "../toolbox/mcp";
import { resolveKit } from "../toolbox/registry";
import { installSkill, installSkillContent } from "../toolbox/skills";
import { materializeSpecKit } from "../toolbox/spec-kit";
import { RELIABILITY_FLOOR } from "../toolbox/reliability-floor";

async function dirExists(p: string): Promise<boolean> {
  return access(p).then(() => true).catch(() => false);
}

// Re-materialize the real Spec Kit (.specify/ + /speckit.* commands) into each
// named repo that exists on disk. These files are NOT published (like every
// per-repo install), so a re-cloned or pre-#118 workspace has the SKILL.md but
// not the flow it points to until this runs.
async function materializeSpecKitRepos(workspaceDir: string, repos: string[]): Promise<void> {
  const brain = await readBrain(workspaceDir);
  if (!brain.ok) return;
  const pathByRepo = new Map(brain.brain.repos.map((r) => [r.name, r.path]));
  for (const name of repos) {
    const rel = pathByRepo.get(name);
    if (!rel) continue;
    const abs = join(workspaceDir, rel);
    if (!(await dirExists(abs))) continue;
    await materializeSpecKit(abs);
  }
}

export interface ToolboxRehydrateRow {
  kind: "skill" | "mcp";
  name: string;
  status: "restored" | "error";
}

export async function rehydrateToolbox(workspaceDir: string): Promise<ToolboxRehydrateRow[]> {
  const tb = await readToolbox(workspaceDir);
  const rows: ToolboxRehydrateRow[] = [];

  for (const skill of tb.skills) {
    // Reliability-floor skills track the binary (like the coordinator flow-skills,
    // #13): refresh their content from the embedded version so an upgraded binary
    // never leaves a stale verify-before-done/review-delivery behind. Every other
    // skill is restored from its published .aipe/skills/ source, as before.
    const floor = RELIABILITY_FLOOR.find((f) => f.name === skill.name);
    // spec-kit tracks the binary the same way the floor does (#118): its content
    // AND its routing contract come from the registry, never from the published
    // catalog entry — a pre-#118 `skill add spec-kit` wrote that entry with NO
    // routing block, and restoring it from the published source would preserve
    // that shallow, un-routable shape forever. Re-installing from the registry
    // CURES it by shape (writes the routing back), which is what makes `--size`
    // route on an aged workspace, not just a fresh one.
    const specKit = skill.name === "spec-kit" ? resolveKit("spec-kit") : undefined;
    const kit = floor ?? specKit;
    const result = kit
      ? await installSkillContent(workspaceDir, {
          name: kit.name,
          description: kit.description,
          objective: kit.objective,
          whenToUse: kit.whenToUse,
          repos: skill.repos,
          content: kit.content,
          ...(specKit?.routing ? { routing: specKit.routing } : {}),
        })
      : await installSkill(workspaceDir, {
          name: skill.name,
          description: skill.description,
          objective: skill.objective,
          whenToUse: skill.whenToUse,
          repos: skill.repos,
          source: join(workspaceDir, ".aipe", "skills", skill.name),
        });
    rows.push({ kind: "skill", name: skill.name, status: result.ok ? "restored" : "error" });
    // spec-kit is more than a SKILL.md — its .specify/ + /speckit.* are unpublished,
    // so restoring the catalogued skill must also re-materialize the real kit (#118).
    if (skill.name === "spec-kit" && result.ok) await materializeSpecKitRepos(workspaceDir, skill.repos);
  }

  // #118 repair: a workspace onboarded before spec-kit was mandatory has no
  // spec-kit in its catalog at all — the full SDD flow is unreachable and
  // `--size` has nothing to route on. Rehydrate installs it into every repo, so
  // an existing workspace is brought up to the same floor a fresh one is born
  // with. Idempotent: a workspace that already has it took the loop above.
  if (!tb.skills.some((s) => s.name === "spec-kit")) {
    const kit = resolveKit("spec-kit");
    const brain = await readBrain(workspaceDir);
    if (kit && brain.ok) {
      const repos = brain.brain.repos.map((r) => r.name);
      const result = await installSkillContent(workspaceDir, {
        name: kit.name,
        description: kit.description,
        objective: kit.objective,
        whenToUse: kit.whenToUse,
        repos,
        content: kit.content,
        ...(kit.routing ? { routing: kit.routing } : {}),
      });
      if (result.ok) await materializeSpecKitRepos(workspaceDir, repos);
      rows.push({ kind: "skill", name: "spec-kit", status: result.ok ? "restored" : "error" });
    }
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
