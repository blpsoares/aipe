import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readBrain } from "../make-workspace/read";
import { renderAgentMd } from "./agent";
import { dedupeReportsByName, resolveNames } from "./naming";
import { personaSlug, renderSkillMd } from "./render";
import { readPersonas } from "./read-personas";
import { readReports } from "./reports";
import { buildRegistry, mergeRegistry, renderPersonasYaml } from "./registry";
import { updateSpecialistsPhase } from "./state";
import type { BrainFile, NamingResult, PersonaReport, PersonaRegistryEntry, PersonaRole, ProvidedNames, SpecialistsPhase } from "./types";

// Writes each report's persona SKILL.md into (1) the repo and (2) the published
// .aipe/personas/ source of truth. Shared by the full and incremental paths.
async function writePersonaFiles(
  workspaceDir: string,
  brain: BrainFile,
  reports: PersonaReport[],
): Promise<void> {
  for (const report of reports) {
    const repo = brain.repos.find((r) => r.name === report.repo);
    if (!repo) continue;
    const slug = personaSlug(report.name);
    const stack = repo.stack ?? [];
    const content = renderSkillMd(report, stack);
    // The persona agent type: its frontmatter `name` is the real display name so
    // dispatched subagents show as the persona, not "claude".
    const agent = renderAgentMd({ name: report.name, role: report.role, repo: report.repo, stack, body: report.body });
    const skillDir = join(workspaceDir, repo.path, ".claude", "skills", slug);
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), content, "utf8");
    const agentDir = join(workspaceDir, repo.path, ".claude", "agents");
    await mkdir(agentDir, { recursive: true });
    await writeFile(join(agentDir, `${slug}.md`), agent, "utf8");
    // Source of truth (published, re-hydratable): keep both next to each other.
    const sourceDir = join(workspaceDir, ".aipe", "personas", report.repo, slug);
    await mkdir(sourceDir, { recursive: true });
    await writeFile(join(sourceDir, "SKILL.md"), content, "utf8");
    await writeFile(join(sourceDir, "agent.md"), agent, "utf8");
  }
}

function rosterCoversAllRepos(brain: BrainFile, roster: PersonaRegistryEntry[]): boolean {
  return brain.repos.every((repo) =>
    (["dev-fullstack", "qa"] as const).every((role) =>
      roster.some((e) => e.repo === repo.name && e.role === role),
    ),
  );
}

export type ResolveNamesResult =
  | { ok: true; result: NamingResult }
  | { ok: false; error: string };

export async function resolvePersonaNames(
  workspaceDir: string,
  provided: ProvidedNames,
): Promise<ResolveNamesResult> {
  const brainResult = await readBrain(workspaceDir);
  if (!brainResult.ok) return { ok: false, error: brainResult.error };
  return { ok: true, result: resolveNames(brainResult.brain, provided) };
}

export interface PersonaStatus {
  repo: string;
  role: PersonaRole;
  status: "ok" | "missing";
}

export type RunResult =
  | { ok: true; results: PersonaStatus[]; phase: SpecialistsPhase }
  | { ok: false; error: string };

export async function runHireSpecialists(workspaceDir: string): Promise<RunResult> {
  const brainResult = await readBrain(workspaceDir);
  if (!brainResult.ok) return { ok: false, error: brainResult.error };
  const brain = brainResult.brain;

  const reportsDir = join(workspaceDir, ".aipe", "specialists", ".reports");
  const rawReports = await readReports(reportsDir);
  const reports = dedupeReportsByName(rawReports, brain.context.coordinator);
  const byKey = new Map(reports.map((r) => [`${r.repo}|${r.role}`, r]));

  const results: PersonaStatus[] = [];
  for (const repo of brain.repos) {
    for (const role of ["dev-fullstack", "qa"] as const) {
      results.push({
        repo: repo.name,
        role,
        status: byKey.has(`${repo.name}|${role}`) ? "ok" : "missing",
      });
    }
  }
  const phase: SpecialistsPhase = results.every((r) => r.status === "ok") ? "done" : "pending";

  await writePersonaFiles(workspaceDir, brain, reports);

  const registry = buildRegistry(brain, reports);
  await mkdir(join(workspaceDir, ".aipe"), { recursive: true });
  await writeFile(join(workspaceDir, ".aipe", "personas.yaml"), renderPersonasYaml(registry), "utf8");

  await updateSpecialistsPhase(workspaceDir, phase);

  if (phase === "done") {
    await rm(reportsDir, { recursive: true, force: true });
  }

  return { ok: true, results, phase };
}

// Incremental hire for /aipe-add-repo: fold the staged reports (typically for a
// single newly-added repo) into the EXISTING personas.yaml without disturbing
// personas already hired. Phase is `done` once the merged roster covers every
// repo in the brain with both roles.
export async function runHireSpecialistsMerge(workspaceDir: string): Promise<RunResult> {
  const brainResult = await readBrain(workspaceDir);
  if (!brainResult.ok) return { ok: false, error: brainResult.error };
  const brain = brainResult.brain;

  const existing = await readPersonas(workspaceDir);
  const reportsDir = join(workspaceDir, ".aipe", "specialists", ".reports");
  const usedNames = existing.map((e) => e.name).filter((n) => n !== brain.context.coordinator);
  const rawReports = await readReports(reportsDir);
  // reserve both the coordinator and every already-hired name against collisions
  const reports = dedupeReportsByName(rawReports, brain.context.coordinator).filter(
    (r) => !usedNames.some((n) => n.toLowerCase() === r.name.toLowerCase()),
  );

  await writePersonaFiles(workspaceDir, brain, reports);

  const merged = mergeRegistry(brain, existing, reports);
  await mkdir(join(workspaceDir, ".aipe"), { recursive: true });
  await writeFile(join(workspaceDir, ".aipe", "personas.yaml"), renderPersonasYaml(merged), "utf8");

  const phase: SpecialistsPhase = rosterCoversAllRepos(brain, merged) ? "done" : "pending";
  await updateSpecialistsPhase(workspaceDir, phase);
  if (phase === "done") await rm(reportsDir, { recursive: true, force: true });

  const results: PersonaStatus[] = [];
  for (const repo of brain.repos) {
    for (const role of ["dev-fullstack", "qa"] as const) {
      results.push({
        repo: repo.name,
        role,
        status: merged.some((e) => e.repo === repo.name && e.role === role) ? "ok" : "missing",
      });
    }
  }
  return { ok: true, results, phase };
}
