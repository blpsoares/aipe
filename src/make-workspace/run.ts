import { readBrain } from "./read";
import { materializeRepo, type Cloner, type Inspector } from "./clone";
import { rehydratePersonas } from "../rehydrate/personas";
import { updateWorkspacePhase } from "./state";
import type { RepoResult, WorkspacePhase } from "./types";

export type RunResult =
  | { ok: true; results: RepoResult[]; phase: WorkspacePhase }
  | { ok: false; error: string };

export async function makeWorkspace(
  workspaceDir: string,
  deps: { inspect: Inspector; clone: Cloner },
): Promise<RunResult> {
  const brainResult = await readBrain(workspaceDir);
  if (!brainResult.ok) return { ok: false, error: brainResult.error };

  const results: RepoResult[] = [];
  for (const repo of brainResult.brain.repos) {
    try {
      results.push(await materializeRepo(repo, workspaceDir, deps.inspect, deps.clone));
    } catch (err) {
      results.push({ name: repo.name, status: "error", message: String(err) });
    }
  }

  const phase: WorkspacePhase = results.every((r) => r.status !== "error") ? "done" : "pending";
  await updateWorkspacePhase(workspaceDir, phase);

  // If this is a re-clone of a published workspace, restore each repo's persona
  // skills from the committed .aipe/personas/ (no-op on first onboarding, when
  // personas haven't been hired yet).
  await rehydratePersonas(workspaceDir);

  return { ok: true, results, phase };
}
