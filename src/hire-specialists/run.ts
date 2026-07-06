import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { makeFqid } from "../relationship/fqid";
import { resolveAdapter } from "../harness/registry";
import { readBrain } from "../make-workspace/read";
import { readHiringGroups } from "./groups";
import { dedupeReportsByName, resolveNames } from "./naming";
import { personaSlug, renderSkillMd } from "./render";
import { readPersonas } from "./read-personas";
import { readReports } from "./reports";
import { buildRegistry, mergeRegistry, renderPersonasYaml } from "./registry";
import { updateSpecialistsPhase } from "./state";
import type { BrainFile, HiringGroup, NamingResult, PersonaReport, PersonaRegistryEntry, PersonaRole, ProvidedNames, SpecialistsPhase } from "./types";

// Writes each report's persona SKILL.md into (1) the repo and (2) the published
// .aipe/personas/ source of truth. Shared by the full and incremental paths.
// The persona's stack is the hiring group's stack (a module's own stack in a
// monorepo), falling back to the repo stack.
async function writePersonaFiles(
  workspaceDir: string,
  brain: BrainFile,
  reports: PersonaReport[],
  groups: HiringGroup[],
): Promise<void> {
  const stackByFqid = new Map(groups.map((g) => [g.fqid, g.stack]));
  const adapter = await resolveAdapter(workspaceDir);
  for (const report of reports) {
    const repo = brain.repos.find((r) => r.name === report.repo);
    if (!repo) continue;
    const fqid = makeFqid(report.repo, report.module);
    const stack = stackByFqid.get(fqid) ?? repo.stack ?? [];
    const slug = personaSlug(report.name);

    // (1) the repo copy, in the recorded harness's persona format + location.
    const target = adapter.personaTarget(slug);
    const content = adapter.wrapPersona(report.body, {
      slug,
      role: report.role,
      repo: report.repo,
      module: report.module ?? null,
      stack,
    });
    const skillDir = join(workspaceDir, repo.path, target.relDir);
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, target.filename), content, "utf8");

    // (2) the published source-of-truth copy under .aipe/personas/, kept in the
    // canonical Claude Code SKILL.md format for `aipe rehydrate`.
    const sourceDir = join(workspaceDir, ".aipe", "personas", report.repo, slug);
    await mkdir(sourceDir, { recursive: true });
    await writeFile(join(sourceDir, "SKILL.md"), renderSkillMd(report, stack), "utf8");
  }
}

// True when the roster covers every hiring group with both roles.
function rosterCoversAllGroups(groups: HiringGroup[], roster: PersonaRegistryEntry[]): boolean {
  return groups.every((group) =>
    (["dev-fullstack", "qa"] as const).every((role) =>
      roster.some((e) => (e.fqid ?? e.repo) === group.fqid && e.role === role),
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
  const groups = await readHiringGroups(workspaceDir, brainResult.brain);
  return { ok: true, result: resolveNames(groups, brainResult.brain.context.coordinator, provided) };
}

export interface PersonaStatus {
  repo: string;
  module: string | null;
  fqid: string;
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
  const groups = await readHiringGroups(workspaceDir, brain);

  const reportsDir = join(workspaceDir, ".aipe", "specialists", ".reports");
  const rawReports = await readReports(reportsDir);
  const reports = dedupeReportsByName(rawReports, brain.context.coordinator);
  const byKey = new Map(reports.map((r) => [`${makeFqid(r.repo, r.module)}|${r.role}`, r]));

  const results: PersonaStatus[] = [];
  for (const group of groups) {
    for (const role of ["dev-fullstack", "qa"] as const) {
      results.push({
        repo: group.repo,
        module: group.module,
        fqid: group.fqid,
        role,
        status: byKey.has(`${group.fqid}|${role}`) ? "ok" : "missing",
      });
    }
  }
  const phase: SpecialistsPhase = results.every((r) => r.status === "ok") ? "done" : "pending";

  await writePersonaFiles(workspaceDir, brain, reports, groups);

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
  const groups = await readHiringGroups(workspaceDir, brain);

  const existing = await readPersonas(workspaceDir);
  const reportsDir = join(workspaceDir, ".aipe", "specialists", ".reports");
  const usedNames = existing.map((e) => e.name).filter((n) => n !== brain.context.coordinator);
  const rawReports = await readReports(reportsDir);
  // reserve both the coordinator and every already-hired name against collisions
  const reports = dedupeReportsByName(rawReports, brain.context.coordinator).filter(
    (r) => !usedNames.some((n) => n.toLowerCase() === r.name.toLowerCase()),
  );

  await writePersonaFiles(workspaceDir, brain, reports, groups);

  const merged = mergeRegistry(brain, existing, reports);
  await mkdir(join(workspaceDir, ".aipe"), { recursive: true });
  await writeFile(join(workspaceDir, ".aipe", "personas.yaml"), renderPersonasYaml(merged), "utf8");

  const phase: SpecialistsPhase = rosterCoversAllGroups(groups, merged) ? "done" : "pending";
  await updateSpecialistsPhase(workspaceDir, phase);
  if (phase === "done") await rm(reportsDir, { recursive: true, force: true });

  const results: PersonaStatus[] = [];
  for (const group of groups) {
    for (const role of ["dev-fullstack", "qa"] as const) {
      results.push({
        repo: group.repo,
        module: group.module,
        fqid: group.fqid,
        role,
        status: merged.some((e) => (e.fqid ?? e.repo) === group.fqid && e.role === role) ? "ok" : "missing",
      });
    }
  }
  return { ok: true, results, phase };
}
