import { stringify } from "yaml";
import { claudeCodeAdapter } from "../harness/claude-code";
import { personaSkillDir } from "../harness/persona-install";
import type { HarnessAdapter } from "../harness/types";
import { personaSlug } from "./render";
import type { BrainFile, PersonaRegistryEntry, PersonaReport } from "./types";

// `personas.yaml` records where each persona's skill lives so the coordinator
// (and a human) can find it. That path is harness-specific, so the adapter
// decides it — a hardcoded `.claude/skills/` pointed a Gemini workspace's
// roster at files that were never written there.
export function buildRegistry(
  brain: BrainFile,
  reports: PersonaReport[],
  adapter: HarnessAdapter = claudeCodeAdapter,
): PersonaRegistryEntry[] {
  const entries: PersonaRegistryEntry[] = [
    { name: brain.context.coordinator, role: "coordinator", repo: null, path: null },
  ];

  for (const report of reports) {
    const repo = brain.repos.find((r) => r.name === report.repo);
    const repoPath = repo?.path ?? `./${report.repo}`;
    entries.push({
      name: report.name,
      role: report.role,
      repo: report.repo,
      path: `${repoPath}/${personaSkillDir(adapter, personaSlug(report.name))}`,
      // package/group are carried only for monorepo packages — a flat repo omits
      // them so existing single-repo rosters (and their tests) are unchanged.
      ...(report.package ? { package: report.package } : {}),
      ...(report.group ? { group: report.group } : {}),
    });
  }

  return entries;
}

export function renderPersonasYaml(entries: PersonaRegistryEntry[]): string {
  return stringify({ personas: entries });
}

// The unit a persona occupies in the roster: (repo, role, package). The
// package is PART of the key — in a monorepo one (repo, role) has many
// personas, one per package, and they must not evict one another. A package-
// less entry (flat repo, or the implicit whole-repo unit) keys on the empty
// package, matching the pre-package behaviour exactly.
function slotKey(repo: string, role: string, pkg?: string): string {
  return `${repo}|${role}|${pkg ?? ""}`;
}

// Incremental merge for /aipe-add-repo: fold new reports into an existing
// roster without disturbing personas that aren't being (re)hired. Keeps every
// existing entry whose repo is still in the brain and whose EXACT slot
// (repo, role, package) a new report does not replace, then adds the new
// entries. The coordinator is always rebuilt fresh from the brain. Deduped by
// name (coordinator reserved).
//
// D3 (data loss): this key used to be `${repo}|${role}`, blind to the package.
// In a monorepo that made a single new package's report for a (repo, role)
// evict EVERY existing persona of that (repo, role) across all OTHER packages —
// on a 64-persona context, two new reports collapsed the roster to three. The
// package is now part of the slot key, so a new package's persona replaces only
// its own slot and every other package's persona survives.
export function mergeRegistry(
  brain: BrainFile,
  existing: PersonaRegistryEntry[],
  reports: PersonaReport[],
  adapter: HarnessAdapter = claudeCodeAdapter,
): PersonaRegistryEntry[] {
  const repoNames = new Set(brain.repos.map((r) => r.name));
  const replaced = new Set(reports.map((r) => slotKey(r.repo, r.role, r.package)));

  const kept = existing.filter(
    (e) =>
      e.role !== "coordinator" &&
      e.repo !== null &&
      repoNames.has(e.repo) &&
      !replaced.has(slotKey(e.repo, e.role, e.package)),
  );

  const fresh = buildRegistry(brain, reports, adapter).filter((e) => e.role !== "coordinator");

  const merged: PersonaRegistryEntry[] = [
    { name: brain.context.coordinator, role: "coordinator", repo: null, path: null },
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
