import type { HiringGroup, NamingResult, PersonaAssignment, PersonaReport, ProvidedNames } from "./types";

const NAME_POOL = [
  "Alice", "Bruno", "Carla", "Diego", "Elena", "Felipe", "Gabriela", "Hugo",
  "Isabela", "Joaquim", "Karen", "Lucas", "Marina", "Nicolas", "Olivia", "Pedro",
  "Quintino", "Rafaela", "Samuel", "Tania", "Ursula", "Victor", "Wanda", "Xavier",
  "Yasmin", "Zeca",
];

function pickUnused(used: Set<string>): string {
  for (const candidate of NAME_POOL) {
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
  let i = 1;
  while (used.has(`persona-${i}`)) i++;
  return `persona-${i}`;
}

// Resolves a final, context-unique name for every (hiring group, role). Names
// are keyed by fqid in `provided`, so a monorepo can be hired per module.
export function resolveNames(groups: HiringGroup[], coordinator: string, provided: ProvidedNames): NamingResult {
  const used = new Set<string>([coordinator.toLowerCase()]);
  const personas: PersonaAssignment[] = [];

  for (const group of groups) {
    for (const role of ["dev-fullstack", "qa"] as const) {
      const key = role === "dev-fullstack" ? "devFullstack" : "qa";
      const suggested = provided[group.fqid]?.[key];
      let name = suggested && suggested.trim().length > 0 ? suggested.trim() : undefined;

      if (!name || used.has(name.toLowerCase())) {
        name = pickUnused(used);
      }

      used.add(name.toLowerCase());
      personas.push({ fqid: group.fqid, repo: group.repo, module: group.module, role, name });
    }
  }

  return { coordinator, personas };
}

export function dedupeReportsByName(reports: PersonaReport[], coordinatorName: string): PersonaReport[] {
  const seen = new Set<string>([coordinatorName.toLowerCase()]);
  const kept: PersonaReport[] = [];
  for (const report of reports) {
    const key = report.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(report);
  }
  return kept;
}
