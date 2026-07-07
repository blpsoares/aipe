import { resolveGroups } from "../context-brain/packages";
import type { BrainFile, NamingResult, PersonaAssignment, PersonaReport, ProvidedNames } from "./types";

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

export function resolveNames(brain: BrainFile, provided: ProvidedNames): NamingResult {
  const used = new Set<string>([brain.context.coordinator.toLowerCase()]);
  const personas: PersonaAssignment[] = [];

  // One dev+QA pair per hiring *group* (a group is a repo's implicit whole-repo
  // package, a single package, or several packages sharing a `group`). Provided
  // names may be keyed by the group id ("repo/group") or, for a flat repo, the
  // bare repo name.
  for (const g of resolveGroups(brain)) {
    const flat = g.group === g.repo;
    const unitKey = flat ? g.repo : `${g.repo}/${g.group}`;
    const rep = g.packages[0];
    for (const role of ["dev-fullstack", "qa"] as const) {
      const key = role === "dev-fullstack" ? "devFullstack" : "qa";
      const suggested = provided[unitKey]?.[key] ?? provided[g.repo]?.[key];
      let name = suggested && suggested.trim().length > 0 ? suggested.trim() : undefined;

      if (!name || used.has(name.toLowerCase())) {
        name = pickUnused(used);
      }

      used.add(name.toLowerCase());
      personas.push({
        repo: g.repo,
        role,
        name,
        ...(flat ? {} : { package: rep?.package, group: g.group }),
      });
    }
  }

  return { coordinator: brain.context.coordinator, personas };
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
