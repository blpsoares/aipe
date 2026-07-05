#!/usr/bin/env bun
// `aipe journey <start|record|show>` — the durable journey ledger under
// .aipe/journeys/<id>.yaml. Audit bookkeeping for a work session's dispatches
// (repo, specialist, branch, worktree, PR, status); it is NOT the hiring brief.
import { readLedger, recordDispatch, startJourney } from "./ledger";
import { DISPATCH_STATUSES } from "./types";
import type { DispatchStatus } from "./types";

function getFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const value = args[i + 1];
  if (value === undefined || value.startsWith("--")) return undefined;
  return value;
}

// The one place a timestamp is read; overridable with --id for reproducibility.
function mintId(): string {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const rand = Math.random().toString(36).slice(2, 4).padEnd(2, "0");
  return `j-${ymd}-${rand}`;
}

async function startCommand(args: string[]): Promise<number> {
  const workspace = getFlag(args, "--workspace") ?? process.cwd();
  const id = getFlag(args, "--id") ?? mintId();
  const started = await startJourney(workspace, id);
  console.log(`JOURNEY ${started}`);
  return 0;
}

async function recordCommand(args: string[]): Promise<number> {
  const workspace = getFlag(args, "--workspace") ?? process.cwd();
  const id = getFlag(args, "--journey");
  const repo = getFlag(args, "--repo");
  const specialist = getFlag(args, "--specialist");
  const branch = getFlag(args, "--branch");
  const worktree = getFlag(args, "--worktree");
  if (!id || !repo || !specialist || !branch || !worktree) {
    console.log("ERROR args: --journey, --repo, --specialist, --branch and --worktree are required");
    return 1;
  }
  const pr = getFlag(args, "--pr");
  const statusFlag = getFlag(args, "--status");
  const status: DispatchStatus = DISPATCH_STATUSES.includes(statusFlag as DispatchStatus)
    ? (statusFlag as DispatchStatus)
    : "dispatched";
  await recordDispatch(workspace, id, { repo, specialist, branch, worktree, ...(pr ? { pr } : {}), status });
  console.log(`OK ${repo} ${specialist} ${status}`);
  return 0;
}

async function showCommand(args: string[]): Promise<number> {
  const workspace = getFlag(args, "--workspace") ?? process.cwd();
  const id = getFlag(args, "--journey");
  if (!id) {
    console.log("ERROR args: --journey <id> is required");
    return 1;
  }
  const ledger = await readLedger(workspace, id);
  if (!ledger) {
    console.log(`ERROR journey: no ledger for ${id}`);
    return 1;
  }
  for (const d of ledger.dispatches) {
    console.log(`DISPATCH ${d.repo} ${d.specialist} ${d.status} ${d.branch} ${d.pr ?? "-"}`);
  }
  console.log(`STATE journey=${id} dispatches=${ledger.dispatches.length}`);
  return 0;
}

export async function run(args: string[]): Promise<number> {
  const [sub, ...rest] = args;
  switch (sub) {
    case "start":
      return startCommand(rest);
    case "record":
      return recordCommand(rest);
    case "show":
      return showCommand(rest);
    default:
      console.log(`ERROR command: unknown journey command "${sub ?? ""}"`);
      console.log("Usage: aipe journey <start|record|show> [options]");
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
