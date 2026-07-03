import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stringify } from "yaml";
import { readBrain } from "../make-workspace/read";
import { backfillStack } from "./backfill";
import { mergeEdges } from "./merge";
import { readReports } from "./reports";
import { renderGraphYaml, renderReadme } from "./render";
import { updateRelationshipPhase } from "./state";
import type { RelationshipPhase } from "./types";

export interface RepoRelationshipStatus {
  name: string;
  status: "ok" | "missing";
}

export type RunResult =
  | { ok: true; results: RepoRelationshipStatus[]; phase: RelationshipPhase }
  | { ok: false; error: string };

export async function runRelationship(workspaceDir: string): Promise<RunResult> {
  const brainResult = await readBrain(workspaceDir);
  if (!brainResult.ok) return { ok: false, error: brainResult.error };
  const brain = brainResult.brain;

  const relationsDir = join(workspaceDir, ".aipe", "relations");
  const reportsDir = join(relationsDir, ".reports");
  const reports = await readReports(reportsDir);
  const reportedNames = new Set(reports.map((r) => r.repo));

  const results: RepoRelationshipStatus[] = brain.repos.map((repo) => ({
    name: repo.name,
    status: reportedNames.has(repo.name) ? "ok" : "missing",
  }));
  const phase: RelationshipPhase = results.every((r) => r.status === "ok") ? "done" : "pending";

  const edges = mergeEdges(reports);
  await mkdir(relationsDir, { recursive: true });
  await writeFile(join(relationsDir, "graph.yaml"), renderGraphYaml(edges), "utf8");
  await writeFile(
    join(relationsDir, "README.md"),
    renderReadme(edges, brain.repos.map((r) => r.name)),
    "utf8",
  );

  const backfilledBrain = backfillStack(brain, reports);
  await writeFile(join(workspaceDir, ".aipe", "brain.yaml"), stringify(backfilledBrain), "utf8");

  await updateRelationshipPhase(workspaceDir, phase);

  if (phase === "done") {
    await rm(reportsDir, { recursive: true, force: true });
  }

  return { ok: true, results, phase };
}
