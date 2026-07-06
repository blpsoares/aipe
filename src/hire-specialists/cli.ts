#!/usr/bin/env bun
import { readFile } from "node:fs/promises";
import { resolvePersonaNames, runHireSpecialists, runHireSpecialistsMerge, type PersonaStatus } from "./run";
import type { ProvidedNames, SpecialistsPhase } from "./types";

function getFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const value = args[i + 1];
  if (value === undefined || value.startsWith("--")) return undefined;
  return value;
}

export function renderReport(results: PersonaStatus[], phase: SpecialistsPhase): string[] {
  const lines: string[] = [];
  for (const r of results) {
    lines.push(r.status === "ok" ? `OK ${r.fqid} ${r.role}` : `MISSING ${r.fqid} ${r.role}`);
  }
  const missing = results.filter((r) => r.status === "missing").length;
  const suffix = missing > 0 ? ` (${missing} missing of ${results.length} personas)` : "";
  lines.push(`STATE specialists=${phase}${suffix}`);
  return lines;
}

async function resolveNamesCommand(args: string[]): Promise<number> {
  const workspace = getFlag(args, "--workspace") ?? process.cwd();
  const inputPath = getFlag(args, "--input");
  if (!inputPath) {
    console.log("ERROR input: --input <file.json> is required with --resolve-names");
    return 1;
  }

  let provided: ProvidedNames;
  try {
    provided = JSON.parse(await readFile(inputPath, "utf8"));
  } catch {
    console.log(`ERROR input: could not read/parse ${inputPath}`);
    return 1;
  }

  const result = await resolvePersonaNames(workspace, provided);
  if (!result.ok) {
    console.log(`ERROR brain: ${result.error}`);
    return 1;
  }

  console.log(JSON.stringify(result.result));
  return 0;
}

async function materializeCommand(args: string[]): Promise<number> {
  const workspace = getFlag(args, "--workspace") ?? process.cwd();
  // --merge folds staged reports into an existing personas.yaml (used by
  // /aipe-add-repo); the default overwrites the roster from scratch (onboarding).
  const merge = args.includes("--merge");
  const result = merge ? await runHireSpecialistsMerge(workspace) : await runHireSpecialists(workspace);
  if (!result.ok) {
    console.log(`ERROR brain: ${result.error}`);
    return 1;
  }

  for (const line of renderReport(result.results, result.phase)) {
    console.log(line);
  }
  return result.phase === "done" ? 0 : 1;
}

export async function run(args: string[]): Promise<number> {
  if (args.includes("--resolve-names")) return resolveNamesCommand(args);
  return materializeCommand(args);
}

if (import.meta.main) {
  run(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      console.log(`ERROR ${err}`);
      process.exit(1);
    });
}
