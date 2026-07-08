// Restores each repo's persona skills from the committed source of truth in
// .aipe/personas/<repo>/<slug>/SKILL.md into <repo>/.claude/skills/<slug>/, and
// (re)generates the persona **agent type** at <repo>/.claude/agents/<slug>.md so
// dispatched subagents show the real persona name instead of "claude".
// Needed because the cloned repos are never published, so after re-cloning on a
// new machine their in-repo personas are gone — this rebuilds them without
// re-running /hire-specialists (no LLM cost). Also the backfill path for personas
// hired before agent types existed.
import { access, copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { extractBody, frontmatterName, renderAgentMd } from "../hire-specialists/agent";
import { readPersonas } from "../hire-specialists/read-personas";
import { personaSlug } from "../hire-specialists/render";
import type { PersonaRegistryEntry, PersonaRole } from "../hire-specialists/types";
import { readBrain } from "../make-workspace/read";

export interface RehydrateRow {
  repo: string;
  slug: string;
  status: "restored" | "repo-missing" | "unknown-repo";
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function subdirs(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

// Recover a persona's display name + role for an agent file: prefer the durable
// roster (personas.yaml), fall back to the SKILL frontmatter name / the slug.
function personaMeta(
  roster: PersonaRegistryEntry[],
  repo: string,
  slug: string,
  skillMd: string,
): { name: string; role: PersonaRole } {
  const entry = roster.find((e) => e.repo === repo && personaSlug(e.name) === slug);
  if (entry && entry.role !== "coordinator") return { name: entry.name, role: entry.role };
  const fmName = frontmatterName(skillMd);
  const name = fmName && fmName !== slug ? fmName : slug.charAt(0).toUpperCase() + slug.slice(1);
  return { name, role: "dev-fullstack" };
}

// Write <repo>/.claude/agents/<slug>.md. Prefers a stored agent.md (already has the
// right display name); otherwise generates one from the SKILL body + the roster.
async function restoreAgent(
  personasRoot: string,
  repoAbs: string,
  roster: PersonaRegistryEntry[],
  stack: string[],
  repo: string,
  slug: string,
): Promise<void> {
  const agentDir = join(repoAbs, ".claude", "agents");
  await mkdir(agentDir, { recursive: true });
  const dest = join(agentDir, `${slug}.md`);
  const storedAgent = join(personasRoot, repo, slug, "agent.md");
  if (await exists(storedAgent)) {
    await copyFile(storedAgent, dest);
    return;
  }
  let skillMd = "";
  try {
    skillMd = await readFile(join(personasRoot, repo, slug, "SKILL.md"), "utf8");
  } catch {
    // no SKILL.md — nothing to base an identity on; skip
    return;
  }
  const { name, role } = personaMeta(roster, repo, slug, skillMd);
  const md = renderAgentMd({ name, role, repo, stack, body: extractBody(skillMd) });
  await writeFile(dest, md, "utf8");
}

export async function rehydratePersonas(workspaceDir: string): Promise<RehydrateRow[]> {
  const brain = await readBrain(workspaceDir);
  if (!brain.ok) return [];

  const pathByRepo = new Map(brain.brain.repos.map((r) => [r.name, r.path]));
  const stackByRepo = new Map(brain.brain.repos.map((r) => [r.name, r.stack ?? []]));
  const roster = await readPersonas(workspaceDir);
  const personasRoot = join(workspaceDir, ".aipe", "personas");
  const rows: RehydrateRow[] = [];

  for (const repoName of await subdirs(personasRoot)) {
    const repoPath = pathByRepo.get(repoName);
    if (!repoPath) {
      rows.push({ repo: repoName, slug: "*", status: "unknown-repo" });
      continue;
    }
    const repoAbs = join(workspaceDir, repoPath);
    const repoPresent = await exists(repoAbs);

    for (const slug of await subdirs(join(personasRoot, repoName))) {
      const src = join(personasRoot, repoName, slug, "SKILL.md");
      if (!(await exists(src))) continue;
      if (!repoPresent) {
        rows.push({ repo: repoName, slug, status: "repo-missing" });
        continue;
      }
      const destDir = join(repoAbs, ".claude", "skills", slug);
      await mkdir(destDir, { recursive: true });
      await copyFile(src, join(destDir, "SKILL.md"));
      await restoreAgent(personasRoot, repoAbs, roster, stackByRepo.get(repoName) ?? [], repoName, slug);
      rows.push({ repo: repoName, slug, status: "restored" });
    }
  }

  return rows;
}
