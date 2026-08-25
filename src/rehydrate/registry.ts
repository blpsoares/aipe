// Rebuilds `.aipe/personas.yaml` (the durable persona roster) from the
// published sources under `.aipe/personas/<repo>/<slug>/`. This is the recovery
// path for D3: `hire-specialists --merge` could destroy the registry, and while
// `aipe rehydrate` re-installs the persona *files* from those same sources, it
// never rebuilt the *roster* — so a destroyed personas.yaml had no CLI recovery
// path at all. This unions the reconstructed entries onto whatever roster still
// exists: an entry already in personas.yaml is KEPT verbatim (it carries richer
// data — its `package`/`group` — that the flat source layout cannot encode), and
// any persona whose source survived but whose roster entry was lost is
// RE-REGISTERED from the source. It never removes an entry, so running it is
// always safe. The coordinator is always rebuilt fresh from the brain.
import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { frontmatterName } from "../hire-specialists/agent";
import { readPersonas } from "../hire-specialists/read-personas";
import { personaSlug } from "../hire-specialists/render";
import { renderPersonasYaml } from "../hire-specialists/registry";
import type { PersonaRegistryEntry, PersonaRole } from "../hire-specialists/types";
import { readBrain } from "../make-workspace/read";

export interface RegistryRebuildRow {
  repo: string;
  slug: string;
  status: "kept" | "registered" | "unknown-repo";
}

async function subdirs(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

// Recover a persona's role from its stored SKILL.md / agent.md. Both embed the
// role label verbatim in their `description` ("Fullstack specialist" /
// "QA specialist" — see render.ts / agent.ts). Structured role is not stored
// anywhere else in the source, so this label is the signal; default to
// dev-fullstack when neither label is present (the same default rehydrate's
// agent restore already assumes).
function roleFromSources(...texts: (string | null)[]): PersonaRole {
  for (const t of texts) {
    if (!t) continue;
    if (/QA specialist/.test(t)) return "qa";
    if (/Fullstack specialist/.test(t)) return "dev-fullstack";
  }
  return "dev-fullstack";
}

async function readMaybe(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

export async function rebuildRegistryFromSources(workspaceDir: string): Promise<RegistryRebuildRow[]> {
  const brain = await readBrain(workspaceDir);
  if (!brain.ok) return [];

  const pathByRepo = new Map(brain.brain.repos.map((r) => [r.name, r.path]));
  const existing = await readPersonas(workspaceDir);
  // Keep every existing non-coordinator entry, indexed by (repo, slug) so a
  // surviving entry (with its package/group) wins over a reconstructed one.
  const keptByKey = new Map<string, PersonaRegistryEntry>();
  for (const e of existing) {
    if (e.role === "coordinator" || e.repo === null) continue;
    keptByKey.set(`${e.repo}|${personaSlug(e.name)}`, e);
  }

  const personasRoot = join(workspaceDir, ".aipe", "personas");
  const rows: RegistryRebuildRow[] = [];
  const reconstructed: PersonaRegistryEntry[] = [];

  for (const repo of await subdirs(personasRoot)) {
    const repoPath = pathByRepo.get(repo);
    if (repoPath === undefined) {
      rows.push({ repo, slug: "*", status: "unknown-repo" });
      continue;
    }
    for (const slug of await subdirs(join(personasRoot, repo))) {
      if (keptByKey.has(`${repo}|${slug}`)) {
        rows.push({ repo, slug, status: "kept" });
        continue;
      }
      const agentMd = await readMaybe(join(personasRoot, repo, slug, "agent.md"));
      const skillMd = await readMaybe(join(personasRoot, repo, slug, "SKILL.md"));
      if (agentMd === null && skillMd === null) continue; // no source to base an entry on
      // agent.md's frontmatter `name` is the real display name ("Lawson");
      // SKILL.md's is the slug. Prefer the display name, fall back to a
      // capitalised slug so the roster never shows a bare lowercase id.
      const displayName = frontmatterName(agentMd ?? "") ?? slug.charAt(0).toUpperCase() + slug.slice(1);
      reconstructed.push({
        name: displayName,
        role: roleFromSources(agentMd, skillMd),
        repo,
        // package/group cannot be recovered from the flat source layout — a
        // reconstructed entry omits them; a surviving roster entry (kept above)
        // keeps whatever it had.
        path: `${repoPath}/.claude/skills/${slug}`,
      });
      rows.push({ repo, slug, status: "registered" });
    }
  }

  // coordinator (fresh from the brain) + kept existing + reconstructed, in a
  // deterministic order (kept ones in their original roster order; new ones
  // sorted by repo then slug).
  reconstructed.sort((a, b) => (a.repo ?? "").localeCompare(b.repo ?? "") || personaSlug(a.name).localeCompare(personaSlug(b.name)));
  const merged: PersonaRegistryEntry[] = [
    { name: brain.brain.context.coordinator, role: "coordinator", repo: null, path: null },
    ...keptByKey.values(),
    ...reconstructed,
  ];

  await mkdir(join(workspaceDir, ".aipe"), { recursive: true });
  await writeFile(join(workspaceDir, ".aipe", "personas.yaml"), renderPersonasYaml(merged), "utf8");
  return rows;
}
