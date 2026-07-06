import { stringify } from "yaml";
import { makeFqid } from "../relationship/fqid";
import { personaSlug } from "./render";
import type { BrainFile, PersonaRegistryEntry, PersonaReport } from "./types";

export function buildRegistry(brain: BrainFile, reports: PersonaReport[]): PersonaRegistryEntry[] {
  const entries: PersonaRegistryEntry[] = [
    { name: brain.context.coordinator, role: "coordinator", repo: null, module: null, fqid: null, path: null },
  ];

  for (const report of reports) {
    const repo = brain.repos.find((r) => r.name === report.repo);
    const repoPath = repo?.path ?? `./${report.repo}`;
    const module = report.module ?? null;
    entries.push({
      name: report.name,
      role: report.role,
      repo: report.repo,
      module,
      fqid: makeFqid(report.repo, module),
      path: `${repoPath}/.claude/skills/${personaSlug(report.name)}`,
    });
  }

  return entries;
}

export function renderPersonasYaml(entries: PersonaRegistryEntry[]): string {
  return stringify({ personas: entries });
}

// Incremental merge for /aipe-add-repo: fold new reports into an existing
// roster without disturbing personas that aren't being (re)hired. Keeps every
// existing entry whose repo is still in the brain and whose (repo, role) a new
// report does not replace, then adds the new entries. The coordinator is always
// rebuilt fresh from the brain. Deduped by name (coordinator reserved).
export function mergeRegistry(
  brain: BrainFile,
  existing: PersonaRegistryEntry[],
  reports: PersonaReport[],
): PersonaRegistryEntry[] {
  const repoNames = new Set(brain.repos.map((r) => r.name));
  const replaced = new Set(reports.map((r) => `${makeFqid(r.repo, r.module)}|${r.role}`));

  const kept = existing.filter(
    (e) =>
      e.role !== "coordinator" &&
      e.repo !== null &&
      repoNames.has(e.repo) &&
      !replaced.has(`${e.fqid ?? e.repo}|${e.role}`),
  );

  const fresh = buildRegistry(brain, reports).filter((e) => e.role !== "coordinator");

  const merged: PersonaRegistryEntry[] = [
    { name: brain.context.coordinator, role: "coordinator", repo: null, module: null, fqid: null, path: null },
  ];
  const seen = new Set<string>([brain.context.coordinator.toLowerCase()]);
  for (const entry of [...kept, ...fresh]) {
    const key = entry.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(entry);
  }
  return merged;
}
