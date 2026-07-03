#!/usr/bin/env bun
import { runRelationship, type RepoRelationshipStatus } from "./run";
import type { RelationshipPhase } from "./types";

function getFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const value = args[i + 1];
  if (value === undefined || value.startsWith("--")) return undefined;
  return value;
}

export function renderReport(results: RepoRelationshipStatus[], phase: RelationshipPhase): string[] {
  const lines: string[] = [];
  for (const r of results) {
    lines.push(r.status === "ok" ? `OK ${r.name}` : `MISSING ${r.name}`);
  }
  const missing = results.filter((r) => r.status === "missing").length;
  const suffix = missing > 0 ? ` (${missing} missing report(s) of ${results.length} repos)` : "";
  lines.push(`STATE relationship=${phase}${suffix}`);
  return lines;
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const workspace = getFlag(args, "--workspace") ?? process.cwd();

  const result = await runRelationship(workspace);
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
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.log(`ERROR ${err}`);
      process.exit(1);
    });
}
