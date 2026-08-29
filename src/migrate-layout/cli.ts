#!/usr/bin/env bun
// `aipe workspace migrate-layout [--apply] [--allow-dirty] [--workspace <dir>]`
import { migrateLayout } from "./run";
import { renderPlan } from "./plan";
import { looksLikeWorkspace } from "../runtime/workspaces";

function getFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const value = args[i + 1];
  if (value === undefined || value.startsWith("--")) return undefined;
  return value;
}

const USAGE = [
  "aipe workspace migrate-layout — move repos from the workspace root into repos/",
  "",
  "  --apply          actually move (default: print the plan and change nothing)",
  "  --allow-dirty    migrate repos with uncommitted changes",
  "  --workspace DIR  the workspace (default: cwd)",
  "",
  "Registered worktrees move with the repo and are reconnected with",
  "`git worktree repair`, so an in-flight dispatch survives the move. Still",
  "refuses on a dirty working tree (unsaved work) or a journey whose worktree is",
  "still on disk; a dispatch whose worktree is gone is dead and does not block.",
];

export async function run(args: string[]): Promise<number> {
  const sub = args[0];
  if (sub !== "migrate-layout") {
    console.log(`ERROR usage: aipe workspace migrate-layout [--apply]`);
    return 1;
  }
  const rest = args.slice(1);
  if (rest.includes("--help") || rest.includes("-h")) {
    for (const line of USAGE) console.log(line);
    return 0;
  }

  const workspace = getFlag(rest, "--workspace") ?? process.cwd();

  // Don't send someone who ran this in the wrong directory off to create a
  // brand-new context. `brain.yaml not found → run /context-brain` (from
  // readBrain) is right during onboarding, but here it would seed an AIPe
  // workspace inside wherever they happen to be (e.g. $HOME). Name what actually
  // happened and end on the action that fixes it.
  if (!looksLikeWorkspace(workspace)) {
    console.log(`ERROR workspace: no AIPe workspace at ${workspace} (no .aipe/harness or .aipe/brain.yaml)`);
    console.log("cd into your workspace, or pass --workspace <dir>.");
    return 1;
  }

  const result = await migrateLayout(workspace, {
    apply: rest.includes("--apply"),
    allowDirty: rest.includes("--allow-dirty"),
  });

  if ("error" in result) {
    console.log(`ERROR brain: ${result.error}`);
    return 1;
  }
  if (!result.ok) {
    for (const b of result.blockers) console.log(`BLOCKED ${b}`);
    console.log(`STATE migrate-layout=blocked (${result.blockers.length} blocker(s))`);
    return 1;
  }
  for (const line of renderPlan(result.plan, result.applied, result.personaChanges)) console.log(line);
  return 0;
}

if (import.meta.main) {
  run(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      console.log(`ERROR ${err}`);
      process.exit(1);
    });
}
