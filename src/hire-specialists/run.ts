import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readBrain } from "../make-workspace/read";
import { dedupeReportsByName, resolveNames } from "./naming";
import { personaSlug, renderSkillMd } from "./render";
import { readReports } from "./reports";
import { buildRegistry, renderPersonasYaml } from "./registry";
import { updateSpecialistsPhase } from "./state";
import type { NamingResult, PersonaRole, ProvidedNames, SpecialistsPhase } from "./types";

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

  for (const report of reports) {
    const repo = brain.repos.find((r) => r.name === report.repo);
    if (!repo) continue;
    const skillDir = join(workspaceDir, repo.path, ".claude", "skills", personaSlug(report.name));
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), renderSkillMd(report, repo.stack ?? []), "utf8");
  }

  const registry = buildRegistry(brain, reports);
  await mkdir(join(workspaceDir, ".aipe"), { recursive: true });
  await writeFile(join(workspaceDir, ".aipe", "personas.yaml"), renderPersonasYaml(registry), "utf8");

  await updateSpecialistsPhase(workspaceDir, phase);

  if (phase === "done") {
    await rm(reportsDir, { recursive: true, force: true });
  }

  return { ok: true, results, phase };
}
