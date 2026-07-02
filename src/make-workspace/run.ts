import { readBrain } from "./read";
import { materializeRepo, type Cloner, type Inspector } from "./clone";
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
    results.push(await materializeRepo(repo, workspaceDir, deps.inspect, deps.clone));
  }

  const phase: WorkspacePhase = results.every((r) => r.status !== "error") ? "done" : "pending";
  await updateWorkspacePhase(workspaceDir, phase);

  return { ok: true, results, phase };
}
