import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stringify } from "yaml";
import { readBrain } from "../make-workspace/read";
import { updateRelationshipPhase } from "../relationship/state";
import { updateSpecialistsPhase } from "../hire-specialists/state";
import type { RepoEntry } from "../context-brain/types";

export interface AddRepoInput {
  name: string;
  url: string;
  path: string;
  stack?: string[];
}

export type AddRepoResult =
  | { ok: true; repo: string }
  | { ok: false; error: string };

// Appends a repo to an existing brain.yaml (never rewritten by hand) and marks
// the derived cross-repo artifacts stale: relationship + specialists → pending,
// because the graph and roster no longer cover the whole context. The
// /aipe-add-repo skill then re-clones (make-workspace), re-discovers relations,
// and hires just the new repo's personas (hire-specialists --merge).
export async function addRepo(workspaceDir: string, input: AddRepoInput): Promise<AddRepoResult> {
  const name = input.name.trim();
  const url = input.url.trim();
  const path = input.path.trim();
  if (!name || !url || !path) return { ok: false, error: "name, url and path are required" };

  const brainResult = await readBrain(workspaceDir);
  if (!brainResult.ok) return { ok: false, error: brainResult.error };
  const brain = brainResult.brain;

  if (brain.repos.some((r) => r.name.toLowerCase() === name.toLowerCase())) {
    return { ok: false, error: `duplicate-name ${name}` };
  }
  const normalize = (p: string) => p.replace(/^\.\//, "").replace(/\/+$/, "");
  if (brain.repos.some((r) => normalize(r.path) === normalize(path))) {
    return { ok: false, error: `duplicate-path ${path}` };
  }

  const entry: RepoEntry = {
    name,
    url,
    path,
    ...(input.stack && input.stack.length > 0 ? { stack: input.stack } : {}),
  };
  brain.repos.push(entry);

  await mkdir(join(workspaceDir, ".aipe"), { recursive: true });
  await writeFile(join(workspaceDir, ".aipe", "brain.yaml"), stringify(brain), "utf8");

  await updateRelationshipPhase(workspaceDir, "pending");
  await updateSpecialistsPhase(workspaceDir, "pending");

  return { ok: true, repo: name };
}
