#!/usr/bin/env bun
import { readFile } from "node:fs/promises";
import { resolvePersonaNames, runGenerator, type PersonaStatus } from "./run";
import type { GeneratorPhase, ProvidedNames } from "./types";

function getFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const value = args[i + 1];
  if (value === undefined || value.startsWith("--")) return undefined;
  return value;
}

export function renderReport(results: PersonaStatus[], phase: GeneratorPhase): string[] {
  const lines: string[] = [];
  for (const r of results) {
    lines.push(r.status === "ok" ? `OK ${r.repo} ${r.role}` : `MISSING ${r.repo} ${r.role}`);
  }
  const missing = results.filter((r) => r.status === "missing").length;
  const suffix = missing > 0 ? ` (${missing} missing of ${results.length} personas)` : "";
  lines.push(`STATE generator=${phase}${suffix}`);
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
  const result = await runGenerator(workspace);
  if (!result.ok) {
    console.log(`ERROR brain: ${result.error}`);
    return 1;
  }

  for (const line of renderReport(result.results, result.phase)) {
    console.log(line);
  }
  return result.phase === "done" ? 0 : 1;
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  if (args.includes("--resolve-names")) return resolveNamesCommand(args);
  return materializeCommand(args);
}

if (import.meta.main) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.log(`ERROR ${err}`);
      process.exit(1);
    });
}
