#!/usr/bin/env bun
import { makeWorkspace } from "./run";
import { realClone, realInspect } from "./git";
import type { RepoResult, WorkspacePhase } from "./types";

function getFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const value = args[i + 1];
  if (value === undefined || value.startsWith("--")) return undefined;
  return value;
}

export function renderReport(results: RepoResult[], phase: WorkspacePhase): string[] {
  const lines: string[] = [];
  for (const r of results) {
    if (r.status === "cloned") lines.push(`OK cloned ${r.name}`);
    else if (r.status === "skipped") lines.push(`SKIP ${r.name} (${r.message ?? "already present"})`);
    else lines.push(`ERROR ${r.name}: ${r.message ?? "unknown error"}`);
  }
  const errors = results.filter((r) => r.status === "error").length;
  const suffix = errors > 0 ? ` (${errors} error(s) of ${results.length} repos)` : "";
  lines.push(`STATE workspace=${phase}${suffix}`);
  return lines;
}

export async function run(args: string[]): Promise<number> {
  const workspace = getFlag(args, "--workspace") ?? process.cwd();

  const result = await makeWorkspace(workspace, { inspect: realInspect, clone: realClone });
  if (!result.ok) {
    console.log(`ERROR brain: ${result.error}`);
    return 1;
  }

  for (const line of renderReport(result.results, result.phase)) {
    console.log(line);
  }
  return result.phase === "done" ? 0 : 1;
}

if (import.meta.main) {
  run(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      console.log(`ERROR ${err}`);
      process.exit(1);
    });
}
