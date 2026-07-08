#!/usr/bin/env bun
// `aipe worktree <create|list|remove>` — provisions and tears down the
// per-specialist git worktrees that isolate parallel dispatches. Deterministic
// git plumbing; no LLM. Output convention mirrors the other subcommands
// (OK/WT/BLOCKED/ERROR), one machine-readable line per fact.
import { createWorktree, listWorktrees, pruneWorktrees, removeWorktree } from "./run";
import type { WorktreeRow } from "./types";

function getFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const value = args[i + 1];
  if (value === undefined || value.startsWith("--")) return undefined;
  return value;
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name);
}

export function renderRows(rows: WorktreeRow[]): string[] {
  return rows.map((r) => `WT ${r.repo} ${r.slug} ${r.journey} ${r.branch} ${r.path}${r.package ? ` package=${r.package}` : ""}`);
}

const USAGE = [
  "Usage: aipe worktree <command> [options]",
  "  create --repo <name> --specialist <persona> --journey <id> [--package <name>] [--base <branch>] [--workspace <dir>]",
  "  list   [--journey <id>] [--workspace <dir>]",
  "  remove --repo <name> --specialist <persona> --journey <id> [--package <name>] [--force] [--workspace <dir>]",
  "  prune  --journey <id> [--force] [--workspace <dir>]",
].join("\n");

async function createCommand(args: string[]): Promise<number> {
  const workspace = getFlag(args, "--workspace") ?? process.cwd();
  const repo = getFlag(args, "--repo");
  const specialist = getFlag(args, "--specialist");
  const journey = getFlag(args, "--journey");
  if (!repo || !specialist || !journey) {
    console.log("ERROR args: --repo, --specialist and --journey are required");
    return 1;
  }
  const base = getFlag(args, "--base");
  const pkg = getFlag(args, "--package");
  const result = await createWorktree(workspace, { repo, specialist, journey, package: pkg, base });
  if (!result.ok) {
    console.log(`ERROR ${result.error}`);
    return 1;
  }
  console.log(`${result.created ? "OK" : "EXISTS"} ${result.path} ${result.branch}`);
  return 0;
}

async function listCommand(args: string[]): Promise<number> {
  const workspace = getFlag(args, "--workspace") ?? process.cwd();
  const journey = getFlag(args, "--journey");
  const rows = await listWorktrees(workspace, journey);
  for (const line of renderRows(rows)) console.log(line);
  console.log(`STATE worktrees=${rows.length}`);
  return 0;
}

async function removeCommand(args: string[]): Promise<number> {
  const workspace = getFlag(args, "--workspace") ?? process.cwd();
  const repo = getFlag(args, "--repo");
  const specialist = getFlag(args, "--specialist");
  const journey = getFlag(args, "--journey");
  if (!repo || !specialist || !journey) {
    console.log("ERROR args: --repo, --specialist and --journey are required");
    return 1;
  }
  const force = hasFlag(args, "--force");
  const pkg = getFlag(args, "--package");
  const result = await removeWorktree(workspace, { repo, specialist, journey, package: pkg, force });
  if (result.ok) {
    console.log(`OK removed ${result.path}`);
    return 0;
  }
  console.log(`${result.blocked ? "BLOCKED" : "ERROR"} ${result.error}`);
  return 1;
}

async function pruneCommand(args: string[]): Promise<number> {
  const workspace = getFlag(args, "--workspace") ?? process.cwd();
  const journey = getFlag(args, "--journey");
  if (!journey) {
    console.log("ERROR args: --journey <id> is required");
    return 1;
  }
  const force = hasFlag(args, "--force");
  const rows = await pruneWorktrees(workspace, journey, force);
  for (const r of rows) {
    console.log(`${r.status.toUpperCase()} ${r.repo} ${r.slug}${r.detail ? ` ${r.detail}` : ""}`);
  }
  const removed = rows.filter((r) => r.status === "removed").length;
  const skipped = rows.filter((r) => r.status === "skipped").length;
  const kept = rows.filter((r) => r.status !== "removed").length;
  // Skipping a live dispatch is the safe, expected outcome — not a failure.
  // Only genuine trouble (dirty/unpushed → blocked, or git error) exits non-zero.
  const failed = rows.filter((r) => r.status === "blocked" || r.status === "error").length;
  console.log(`STATE pruned=${removed} kept=${kept} skipped=${skipped}`);
  return failed > 0 ? 1 : 0;
}

export async function run(args: string[]): Promise<number> {
  const [sub, ...rest] = args;
  switch (sub) {
    case "create":
      return createCommand(rest);
    case "list":
      return listCommand(rest);
    case "remove":
      return removeCommand(rest);
    case "prune":
      return pruneCommand(rest);
    default:
      console.log(`ERROR command: unknown worktree command "${sub ?? ""}"`);
      console.log(USAGE);
      return 1;
  }
}

if (import.meta.main) {
  run(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      console.log(`ERROR ${err}`);
      process.exit(1);
    });
}
