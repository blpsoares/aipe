#!/usr/bin/env bun
// `aipe detect-packages --repo <name> [--workspace <dir>]` — proposes a monorepo's
// packages from its own workspace manifests (pnpm/npm/yarn workspaces, go.work,
// Cargo). Prints one `MODULE <name> <path> [stack]` line per unit plus a machine
// `STATE packages=<n>`; `--json` emits the array the coordinator folds into
// brain.yaml (after the PE confirms).
import { join } from "node:path";
import { readBrain } from "../make-workspace/read";
import { detectPackages } from "./detect";

function getFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const value = args[i + 1];
  if (value === undefined || value.startsWith("--")) return undefined;
  return value;
}

export async function run(args: string[]): Promise<number> {
  const workspace = getFlag(args, "--workspace") ?? process.cwd();
  const repoName = getFlag(args, "--repo");
  if (!repoName) {
    console.log("ERROR args: --repo <name> is required");
    return 1;
  }
  const brain = await readBrain(workspace);
  if (!brain.ok) {
    console.log(`ERROR ${brain.error}`);
    return 1;
  }
  const repo = brain.brain.repos.find((r) => r.name === repoName);
  if (!repo) {
    console.log(`ERROR repo: unknown repo "${repoName}"`);
    return 1;
  }

  const packages = await detectPackages(join(workspace, repo.path));
  if (args.includes("--json")) {
    console.log(JSON.stringify(packages, null, 2));
    return 0;
  }
  for (const m of packages) console.log(`MODULE ${m.name} ${m.path}${m.stack?.length ? ` [${m.stack.join(",")}]` : ""}`);
  console.log(`STATE packages=${packages.length}`);
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
