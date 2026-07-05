// Restores each repo's persona skills from the committed source of truth in
// .aipe/personas/<repo>/<slug>/SKILL.md into <repo>/.claude/skills/<slug>/.
// Needed because the cloned repos are never published, so after re-cloning on a
// new machine their in-repo personas are gone — this rebuilds them without
// re-running /hire-specialists (no LLM cost).
import { access, copyFile, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
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

export async function rehydratePersonas(workspaceDir: string): Promise<RehydrateRow[]> {
  const brain = await readBrain(workspaceDir);
  if (!brain.ok) return [];

  const pathByRepo = new Map(brain.brain.repos.map((r) => [r.name, r.path]));
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
      rows.push({ repo: repoName, slug, status: "restored" });
    }
  }

  return rows;
}
