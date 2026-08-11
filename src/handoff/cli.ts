#!/usr/bin/env bun
import { join, resolve } from "node:path";
import { realClone, realInspect } from "../make-workspace/git";
import { resolveRepoInput } from "./resolve";
import { runHandoffClone, runHandoffRender } from "./run";
import type { ManifestEntry } from "./types";

function getFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const value = args[i + 1];
  if (value === undefined || value.startsWith("--")) return undefined;
  return value;
}

function getAllFlags(args: string[], name: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== name) continue;
    const value = args[i + 1];
    if (value !== undefined) out.push(value);
  }
  return out;
}

export function renderCloneReport(results: ManifestEntry[]): string[] {
  return results.map((r) => {
    if (r.status === "error") return `ERROR ${r.name}: ${r.message ?? "unknown error"}`;
    return r.url ? `OK ${r.name} (${r.url})` : `OK ${r.name}`;
  });
}

async function runClone(args: string[]): Promise<number> {
  const outDir = resolve(getFlag(args, "--out") ?? process.cwd());
  const repoValues = getAllFlags(args, "--repo");
  if (repoValues.length === 0) {
    console.log("ERROR: at least one --repo <url-or-path> is required");
    return 1;
  }
  const repos = repoValues.map(resolveRepoInput);
  const results = await runHandoffClone(repos, outDir, { inspect: realInspect, clone: realClone });
  for (const line of renderCloneReport(results)) console.log(line);
  return results.some((r) => r.status === "error") ? 1 : 0;
}

async function runRender(args: string[]): Promise<number> {
  const outDir = resolve(getFlag(args, "--out") ?? process.cwd());
  const contextName = getFlag(args, "--name") ?? "context";
  const outFile = resolve(getFlag(args, "--file") ?? join(outDir, "CLAUDE.md"));
  const result = await runHandoffRender(outDir, outFile, contextName);
  console.log(`WROTE ${result.outFile}`);
  for (const name of result.missing) console.log(`MISSING ${name}`);
  console.log(`STATE handoff=${result.phase}`);
  return result.phase === "done" ? 0 : 1;
}

export async function run(args: string[]): Promise<number> {
  const [sub, ...rest] = args;
  if (sub === "clone") return runClone(rest);
  if (sub === "render") return runRender(rest);
  console.log('ERROR: usage: aipe handoff <clone|render> [options] (run "aipe handoff clone --help" style flags: --repo, --out, --name, --file)');
  return 1;
}

if (import.meta.main) {
  run(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      console.log(`ERROR ${err}`);
      process.exit(1);
    });
}
