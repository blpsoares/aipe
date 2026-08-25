// Restores each repo's persona skills from the committed source of truth in
// .aipe/personas/<repo>/<slug>/SKILL.md into <repo>/.claude/skills/<slug>/, and
// (re)generates the persona **agent type** at <repo>/.claude/agents/<slug>.md so
// dispatched subagents show the real persona name instead of "claude".
// Needed because the cloned repos are never published, so after re-cloning on a
// new machine their in-repo personas are gone — this rebuilds them without
// re-running /hire-specialists (no LLM cost). Also the backfill path for personas
// hired before agent types existed.
import { access, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { installPersonaIntoRepo } from "../harness/persona-install";
import { resolveAdapter } from "../harness/registry";
import type { HarnessAdapter } from "../harness/types";
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
/**
 * The persona's agent-type body: the stored one when `/hire-specialists` saved
 * it, else re-rendered from the stored SKILL.md. Returns null when there is
 * nothing to render from — the caller then installs the skill alone.
 *
 * It RETURNS the body rather than writing it: only harnesses with an agent
 * concept get a file, and that decision belongs to the adapter, not here.
 */
async function agentBody(
  personasRoot: string,
  roster: PersonaRegistryEntry[],
  stack: string[],
  repo: string,
  slug: string,
): Promise<string | undefined> {
  const storedAgent = join(personasRoot, repo, slug, "agent.md");
  if (await exists(storedAgent)) {
    try {
      return await readFile(storedAgent, "utf8");
    } catch {
      return undefined;
    }
  }
  let skillMd = "";
  try {
    skillMd = await readFile(join(personasRoot, repo, slug, "SKILL.md"), "utf8");
  } catch {
    return undefined;
  }
  const { name, role } = personaMeta(roster, repo, slug, skillMd);
  return renderAgentMd({ name, role, repo, stack, body: extractBody(skillMd) });
}

export async function rehydratePersonas(workspaceDir: string): Promise<RehydrateRow[]> {
  const brain = await readBrain(workspaceDir);
  if (!brain.ok) return [];

  const pathByRepo = new Map(brain.brain.repos.map((r) => [r.name, r.path]));
  const stackByRepo = new Map(brain.brain.repos.map((r) => [r.name, r.stack ?? []]));
  const roster = await readPersonas(workspaceDir);
  const personasRoot = join(workspaceDir, ".aipe", "personas");
  const adapter: HarnessAdapter = await resolveAdapter(workspaceDir);
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
      // Through the adapter, so a workspace on Gemini/Codex/Copilot gets its
      // personas where that harness actually loads them.
      const skill = await readFile(src, "utf8");
      const agent = await agentBody(personasRoot, roster, stackByRepo.get(repoName) ?? [], repoName, slug);
      await installPersonaIntoRepo(adapter, repoAbs, slug, { skill, ...(agent === undefined ? {} : { agent }) });
      rows.push({ repo: repoName, slug, status: "restored" });
    }
  }

  return rows;
}
