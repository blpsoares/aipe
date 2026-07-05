import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readBrain } from "../make-workspace/read";
import { readToolbox, upsertSkill, writeToolbox } from "./catalog";
import type { SkillEntry } from "./types";

export interface InstallSkillInput {
  name: string; // skill slug (directory + skill name)
  description: string;
  objective: string;
  whenToUse: string;
  repos: string[]; // repo names to install into
  source: string; // path to a SKILL.md file, or a dir containing SKILL.md
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

// Installs a skill package into the chosen repos and records it in the catalog.
// The skill content is kept in .aipe/skills/<name>/ (published, source of truth
// for rehydrate + the coordinator's workspace-root view) and copied into each
// repo's .claude/skills/<name>/ (so a session there loads it).
export async function installSkill(
  workspaceDir: string,
  input: InstallSkillInput,
): Promise<InstallSkillResult> {
  const brain = await readBrain(workspaceDir);
  if (!brain.ok) return { ok: false, error: brain.error };

  const content = await readSource(input.source);
  if (content === null) return { ok: false, error: `source: cannot read ${input.source}` };

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
  };
  await writeToolbox(workspaceDir, upsertSkill(await readToolbox(workspaceDir), entry));

  return { ok: true, rows };
}
