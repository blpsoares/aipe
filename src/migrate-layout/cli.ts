#!/usr/bin/env bun
// `aipe workspace migrate-layout [--apply] [--allow-dirty] [--workspace <dir>]`
import { migrateLayout } from "./run";
import { renderPlan } from "./plan";

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
  "Refuses while any repo has a registered git worktree or a journey has work",
  "in flight: a worktree records an absolute path, so moving the repo would",
  "break every dispatch running out of it.",
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
