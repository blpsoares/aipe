import { access, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readBrain } from "../make-workspace/read";
import { readToolbox, removeSkillEntry, upsertSkill, writeToolbox } from "./catalog";
import type { SkillEntry, SkillRouting } from "./types";

export interface InstallSkillInput {
  name: string; // skill slug (directory + skill name)
  description: string;
  objective: string;
  whenToUse: string;
  repos: string[]; // repo names to install into
  source: string; // path to a SKILL.md file, or a dir containing SKILL.md
  routing?: SkillRouting; // optional structured routing signals
}

export interface InstallSkillRow {
  repo: string;
  status: "installed" | "repo-missing" | "unknown-repo";
}

export type InstallSkillResult =
  | { ok: true; rows: InstallSkillRow[] }
  | { ok: false; error: string };

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readSource(source: string): Promise<string | null> {
  try {
    const s = await stat(source);
    const file = s.isDirectory() ? join(source, "SKILL.md") : source;
    return await readFile(file, "utf8");
  } catch {
    return null;
  }
}

// Skill metadata without a `source` — used by the curated kit registry, which
// supplies the SKILL.md content directly instead of a file path.
export interface InstallSkillContent {
  name: string;
  description: string;
  objective: string;
  whenToUse: string;
  repos: string[];
  content: string;
  routing?: SkillRouting;
}

// Installs a skill package into the chosen repos and records it in the catalog.
// The skill content is kept in .aipe/skills/<name>/ (published, source of truth
// for rehydrate + the coordinator's workspace-root view) and copied into each
// repo's .claude/skills/<name>/ (so a session there loads it).
export async function installSkill(
  workspaceDir: string,
  input: InstallSkillInput,
): Promise<InstallSkillResult> {
  const content = await readSource(input.source);
  if (content === null) return { ok: false, error: `source: cannot read ${input.source}` };
  return installSkillContent(workspaceDir, { ...input, content });
}

// The core install: given ready SKILL.md content (from a file or the curated
// registry), write the source of truth + each repo copy + the catalog entry.
export async function installSkillContent(
  workspaceDir: string,
  input: InstallSkillContent,
): Promise<InstallSkillResult> {
  const brain = await readBrain(workspaceDir);
  if (!brain.ok) return { ok: false, error: brain.error };

  const content = input.content;
  const pathByRepo = new Map(brain.brain.repos.map((r) => [r.name, r.path]));

  // (1) source of truth
  const sourceDir = join(workspaceDir, ".aipe", "skills", input.name);
  await mkdir(sourceDir, { recursive: true });
  await writeFile(join(sourceDir, "SKILL.md"), content, "utf8");

  // (2) install into each chosen repo
  const rows: InstallSkillRow[] = [];
  const installedRepos: string[] = [];
  for (const repoName of input.repos) {
    const repoPath = pathByRepo.get(repoName);
    if (!repoPath) {
      rows.push({ repo: repoName, status: "unknown-repo" });
      continue;
    }
    const repoAbs = join(workspaceDir, repoPath);
    if (!(await exists(repoAbs))) {
      rows.push({ repo: repoName, status: "repo-missing" });
      installedRepos.push(repoName); // still recorded in the catalog; rehydrate later
      continue;
    }
    const destDir = join(repoAbs, ".claude", "skills", input.name);
    await mkdir(destDir, { recursive: true });
    await writeFile(join(destDir, "SKILL.md"), content, "utf8");
    rows.push({ repo: repoName, status: "installed" });
    installedRepos.push(repoName);
  }

  // (3) catalog entry
  const entry: SkillEntry = {
    name: input.name,
    description: input.description,
    objective: input.objective,
    whenToUse: input.whenToUse,
    repos: installedRepos,
    ...(input.routing ? { routing: input.routing } : {}),
  };
  await writeToolbox(workspaceDir, upsertSkill(await readToolbox(workspaceDir), entry));

  return { ok: true, rows };
}

export interface RemoveSkillRow {
  repo: string;
  status: "removed" | "not-present" | "unknown-repo";
}

export type RemoveSkillResult =
  | { ok: true; name: string; rows: RemoveSkillRow[] }
  | { ok: false; error: string };

// Uninstalls a skill: drops it from the catalog, deletes the published source
// (.aipe/skills/<name>/) and each repo's installed copy (.claude/skills/<name>/).
// Refuses with not-found if the skill isn't in the catalog.
export async function removeSkill(workspaceDir: string, name: string): Promise<RemoveSkillResult> {
  const toolbox = await readToolbox(workspaceDir);
  const entry = toolbox.skills.find((s) => s.name.toLowerCase() === name.toLowerCase());
  if (!entry) return { ok: false, error: `not-found skill "${name}"` };

  const brain = await readBrain(workspaceDir);
  const pathByRepo = new Map(brain.ok ? brain.brain.repos.map((r) => [r.name, r.path]) : []);

  // (1) published source of truth
  await rm(join(workspaceDir, ".aipe", "skills", entry.name), { recursive: true, force: true });

  // (2) each repo's installed copy
  const rows: RemoveSkillRow[] = [];
  for (const repoName of entry.repos) {
    const repoPath = pathByRepo.get(repoName);
    if (!repoPath) {
      rows.push({ repo: repoName, status: "unknown-repo" });
      continue;
    }
    const dir = join(workspaceDir, repoPath, ".claude", "skills", entry.name);
    const existed = await exists(dir);
    await rm(dir, { recursive: true, force: true });
    rows.push({ repo: repoName, status: existed ? "removed" : "not-present" });
  }

  // (3) catalog
  await writeToolbox(workspaceDir, removeSkillEntry(toolbox, entry.name).toolbox);
  return { ok: true, name: entry.name, rows };
}
