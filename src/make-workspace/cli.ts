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
    else if (r.status === "skipped") lines.push(`SKIP ${r.name} (${r.message ?? "já presente"})`);
    else lines.push(`ERRO ${r.name}: ${r.message ?? "erro desconhecido"}`);
  }
  const errors = results.filter((r) => r.status === "error").length;
  const suffix = errors > 0 ? ` (${errors} erro(s) de ${results.length} repos)` : "";
  lines.push(`STATE workspace=${phase}${suffix}`);
  return lines;
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const workspace = getFlag(args, "--workspace") ?? process.cwd();

  const result = await makeWorkspace(workspace, { inspect: realInspect, clone: realClone });
  if (!result.ok) {
    console.log(`ERRO brain: ${result.error}`);
    return 1;
  }

  for (const line of renderReport(result.results, result.phase)) {
    console.log(line);
  }
  return result.phase === "done" ? 0 : 1;
}

if (import.meta.main) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.log(`ERRO ${err}`);
      process.exit(1);
    });
}
