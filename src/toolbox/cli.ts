#!/usr/bin/env bun
// `aipe skill <add|list>` and `aipe mcp <add|list>` — manage the context
// toolbox: extra skill-packages/frameworks and MCP servers. `add` takes a JSON
// payload (rich metadata is awkward as flags); everything is recorded in
// .aipe/toolbox.yaml (published) so the coordinator can see what exists and
// when to use it.
import { readFile } from "node:fs/promises";
import { readBrain } from "../make-workspace/read";
import { readToolbox } from "./catalog";
import { installMcp, removeMcp, type InstallMcpInput } from "./mcp";
import { kitNames, resolveKit } from "./registry";
import { matchSkills } from "./routing";
import { installSkill, installSkillContent, removeSkill, type InstallSkillInput } from "./skills";
import type { TaskSize } from "./types";

// The name for `remove`: the first positional (after the subcommand), falling
// back to --name. Ignores flag values so `remove foo --workspace /x` works.
function positionalName(args: string[]): string | undefined {
  const first = args[0];
  if (first !== undefined && !first.startsWith("--")) return first;
  return getFlag(args, "--name");
}

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

function collectFlags(args: string[], name: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const next = args[i + 1];
    if (args[i] === name && next !== undefined && !next.startsWith("--")) out.push(next);
  }
  return out;
}

// Repos for a curated-kit install: every repo with --all, else each --repo <name>.
async function resolveRepos(
  workspace: string,
  args: string[],
): Promise<{ ok: true; value: string[] } | { ok: false; error: string }> {
  if (args.includes("--all")) {
    const brain = await readBrain(workspace);
    if (!brain.ok) return { ok: false, error: brain.error };
    return { ok: true, value: brain.brain.repos.map((r) => r.name) };
  }
  const repos = collectFlags(args, "--repo");
  if (repos.length === 0) return { ok: false, error: "repos: pass --repo <name> (repeatable) or --all" };
  return { ok: true, value: repos };
}

// Curated path: `aipe skill add <kit> [--repo <r> ...] [--all]` — AIPe knows the
// kit's content + metadata, so no JSON payload is needed.
async function skillAddKit(workspace: string, name: string, args: string[]): Promise<number> {
  const kit = resolveKit(name);
  if (!kit) {
    console.log(`ERROR kit: unknown kit "${name}". Known: ${kitNames().join(", ")}. For a custom skill use --input.`);
    return 1;
  }
  const repos = await resolveRepos(workspace, args);
  if (!repos.ok) {
    console.log(`ERROR ${repos.error}`);
    return 1;
  }
  const result = await installSkillContent(workspace, {
    name: kit.name,
    description: kit.description,
    objective: kit.objective,
    whenToUse: kit.whenToUse,
    repos: repos.value,
    content: kit.content,
    ...(kit.routing ? { routing: kit.routing } : {}),
  });
  if (!result.ok) {
    console.log(`ERROR ${result.error}`);
    return 1;
  }
  for (const r of result.rows) console.log(`${r.status.toUpperCase()} ${r.repo}`);
  console.log(`OK skill=${kit.name}`);
  return 0;
}

async function skillAdd(workspace: string, args: string[]): Promise<number> {
  // A bare positional name (no --input) means a curated kit by name.
  const positional = args[0];
  if (positional !== undefined && !positional.startsWith("--") && !args.includes("--input")) {
    return skillAddKit(workspace, positional, args.slice(1));
  }

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

async function skillRemove(workspace: string, args: string[]): Promise<number> {
  const name = positionalName(args);
  if (!name) {
    console.log("ERROR input: skill name required (aipe skill remove <name>)");
    return 1;
  }
  const result = await removeSkill(workspace, name);
  if (!result.ok) {
    console.log(`ERROR ${result.error}`);
    return 1;
  }
  for (const r of result.rows) console.log(`${r.status.replace("-", "_").toUpperCase()} ${r.repo}`);
  console.log(`OK removed skill=${result.name}`);
  return 0;
}

export async function runSkill(args: string[]): Promise<number> {
  const workspace = getFlag(args, "--workspace") ?? process.cwd();
  const [sub, ...rest] = args;
  if (sub === "add") return skillAdd(workspace, rest);
  if (sub === "list") return skillList(workspace);
  if (sub === "match") return skillMatch(workspace, rest);
  if (sub === "remove") return skillRemove(workspace, rest);
  console.log(`ERROR command: unknown skill command "${sub ?? ""}"`);
  console.log(`Usage: aipe skill <add <kit> [--repo <r>...|--all] | add --input <json> | list | match --task-type <t> [--size <s>] | remove <name>> [--workspace <dir>]`);
  console.log(`Known kits: ${kitNames().join(", ")}`);
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

async function mcpRemove(workspace: string, args: string[]): Promise<number> {
  const name = positionalName(args);
  if (!name) {
    console.log("ERROR input: mcp name required (aipe mcp remove <name>)");
    return 1;
  }
  const result = await removeMcp(workspace, name);
  if (!result.ok) {
    console.log(`ERROR ${result.error}`);
    return 1;
  }
  for (const r of result.rows) console.log(`${r.status.replace("-", "_").toUpperCase()} ${r.target}`);
  console.log(`OK removed mcp=${result.name}`);
  return 0;
}

export async function runMcp(args: string[]): Promise<number> {
  const workspace = getFlag(args, "--workspace") ?? process.cwd();
  const [sub, ...rest] = args;
  if (sub === "add") return mcpAdd(workspace, rest);
  if (sub === "list") return mcpList(workspace);
  if (sub === "remove") return mcpRemove(workspace, rest);
  console.log(`ERROR command: unknown mcp command "${sub ?? ""}"`);
  console.log("Usage: aipe mcp <add --input <json> | list | remove <name>> [--workspace <dir>]");
  return 1;
}
