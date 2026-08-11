import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Cloner, Inspector } from "../make-workspace/clone";
import { buildNodes, mergeEdges } from "../relationship/merge";
import { materializeHandoffRepo, readManifest, writeManifest } from "./clone";
import { readHandoffReports } from "./reports";
import { renderClaudeMd } from "./render";
import type { ManifestEntry, RepoInput } from "./types";

export async function runHandoffClone(
  repos: RepoInput[],
  outDir: string,
  deps: { inspect: Inspector; clone: Cloner },
): Promise<ManifestEntry[]> {
  const results: ManifestEntry[] = [];
  for (const repo of repos) {
    try {
      results.push(await materializeHandoffRepo(repo, outDir, deps.inspect, deps.clone));
    } catch (err) {
      results.push({ name: repo.name, status: "error", message: String(err) });
    }
  }
  await writeManifest(outDir, results);
  return results;
}

export interface HandoffRenderResult {
  manifest: ManifestEntry[];
  missing: string[];
  phase: "done" | "pending" | "no-manifest";
  outFile: string;
}

export async function runHandoffRender(
  outDir: string,
  outFile: string,
  contextName: string,
): Promise<HandoffRenderResult> {
  const manifest = await readManifest(outDir);
  // No manifest on disk (never cloned, or already consumed by a "done" render):
  // never write an empty shell over an existing, correct CLAUDE.md.
  if (manifest.length === 0) {
    return { manifest, missing: [], phase: "no-manifest", outFile };
  }
  const reportsDir = join(outDir, ".aipe-handoff", ".reports");
  const reports = await readHandoffReports(reportsDir);
  const reportedNames = new Set(reports.map((r) => r.repo));

  const okEntries = manifest.filter((m) => m.status === "ok");
  const missing = okEntries.filter((m) => !reportedNames.has(m.name)).map((m) => m.name);
  const phase: "done" | "pending" = missing.length === 0 && okEntries.length > 0 ? "done" : "pending";

  const edges = mergeEdges(reports);
  const nodes = buildNodes(reports, edges);
  const generatedAt = new Date().toISOString().slice(0, 10);

  const markdown = renderClaudeMd({ contextName, generatedAt, manifest, reports, nodes, edges });
  await mkdir(dirname(outFile), { recursive: true });
  await writeFile(outFile, markdown, "utf8");

  if (phase === "done") {
    await rm(join(outDir, ".aipe-handoff"), { recursive: true, force: true });
  }

  return { manifest, missing, phase, outFile };
}
