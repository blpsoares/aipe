#!/usr/bin/env bun
// `aipe skill <add|list>` and `aipe mcp <add|list>` — manage the context
// toolbox: extra skill-packages/frameworks and MCP servers. `add` takes a JSON
// payload (rich metadata is awkward as flags); everything is recorded in
// .aipe/toolbox.yaml (published) so the coordinator can see what exists and
// when to use it.
import { readFile } from "node:fs/promises";
import { readToolbox } from "./catalog";
import { installMcp, type InstallMcpInput } from "./mcp";
import { matchSkills } from "./routing";
import { installSkill, type InstallSkillInput } from "./skills";
import type { TaskSize } from "./types";

function getFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const value = args[i + 1];
  if (value === undefined || value.startsWith("--")) return undefined;
  return value;
}

async function readInput<T>(args: string[]): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  const inputPath = getFlag(args, "--input");
  if (!inputPath) return { ok: false, error: "--input <file.json> is required" };
  try {
    return { ok: true, value: JSON.parse(await readFile(inputPath, "utf8")) as T };
  } catch {
    return { ok: false, error: `could not read/parse ${inputPath}` };
  }
}

// ---- aipe skill ----

async function skillAdd(workspace: string, args: string[]): Promise<number> {
  const input = await readInput<InstallSkillInput>(args);
  if (!input.ok) {
    console.log(`ERROR input: ${input.error}`);
    return 1;
  }
  const i = input.value;
  if (!i.name || !i.source || !Array.isArray(i.repos)) {
    console.log("ERROR input: name, source and repos[] are required");
    return 1;
  }
  const result = await installSkill(workspace, i);
  if (!result.ok) {
    console.log(`ERROR ${result.error}`);
    return 1;
  }
  for (const r of result.rows) console.log(`${r.status.toUpperCase()} ${r.repo}`);
  console.log(`OK skill=${i.name}`);
  return 0;
}

async function skillList(workspace: string): Promise<number> {
  const tb = await readToolbox(workspace);
  for (const s of tb.skills) console.log(`SKILL ${s.name} [${s.repos.join(",")}] ${s.whenToUse}`);
  console.log(`STATE skills=${tb.skills.length}`);
  return 0;
}

// Deterministic routing: which toolbox skills apply to a task of this
// type/size? The coordinator calls this before deciding whether to invoke a
// framework, instead of interpreting the free-text hint.
async function skillMatch(workspace: string, args: string[]): Promise<number> {
  const tb = await readToolbox(workspace);
  const taskType = getFlag(args, "--task-type");
  const size = getFlag(args, "--size") as TaskSize | undefined;
  const matched = matchSkills(tb, { taskType, size });
  for (const s of matched) console.log(`MATCH ${s.name} [${s.repos.join(",")}]`);
  console.log(`STATE matched=${matched.length} of ${tb.skills.length}`);
  return 0;
}

export async function runSkill(args: string[]): Promise<number> {
  const workspace = getFlag(args, "--workspace") ?? process.cwd();
  const [sub, ...rest] = args;
  if (sub === "add") return skillAdd(workspace, rest);
  if (sub === "list") return skillList(workspace);
  if (sub === "match") return skillMatch(workspace, rest);
  console.log(`ERROR command: unknown skill command "${sub ?? ""}"`);
  console.log("Usage: aipe skill <add --input <json> | list | match --task-type <t> [--size <s>]> [--workspace <dir>]");
  return 1;
}

// ---- aipe mcp ----

async function mcpAdd(workspace: string, args: string[]): Promise<number> {
  const input = await readInput<InstallMcpInput>(args);
  if (!input.ok) {
    console.log(`ERROR input: ${input.error}`);
    return 1;
  }
  const i = input.value;
  if (!i.name || (i.scope !== "workspace" && i.scope !== "repo")) {
    console.log("ERROR input: name and scope (workspace|repo) are required");
    return 1;
  }
  const allowSecrets = args.includes("--allow-secrets");
  const result = await installMcp(workspace, { ...i, repos: i.repos ?? [], allowSecrets });
  if (!result.ok) {
    console.log(`ERROR ${result.error}`);
    return 1;
  }
  for (const r of result.rows) console.log(`${r.status.toUpperCase()} ${r.target}`);
  console.log(`OK mcp=${i.name} scope=${i.scope}`);
  return 0;
}

async function mcpList(workspace: string): Promise<number> {
  const tb = await readToolbox(workspace);
  for (const m of tb.mcps) {
    const where = m.scope === "workspace" ? "workspace" : m.repos.join(",");
    console.log(`MCP ${m.name} ${m.scope} [${where}] ${m.description}`);
  }
  console.log(`STATE mcps=${tb.mcps.length}`);
  return 0;
}

export async function runMcp(args: string[]): Promise<number> {
  const workspace = getFlag(args, "--workspace") ?? process.cwd();
  const [sub, ...rest] = args;
  if (sub === "add") return mcpAdd(workspace, rest);
  if (sub === "list") return mcpList(workspace);
  console.log(`ERROR command: unknown mcp command "${sub ?? ""}"`);
  console.log("Usage: aipe mcp <add --input <json> | list> [--workspace <dir>]");
  return 1;
}
