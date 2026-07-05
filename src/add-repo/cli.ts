#!/usr/bin/env bun
// `aipe add-repo` — append a repo to an existing context and mark the derived
// cross-repo artifacts (relations, personas) stale so the /aipe-add-repo skill
// can refresh them incrementally. Deterministic; no LLM.
import { addRepo } from "./run";

function getFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const value = args[i + 1];
  if (value === undefined || value.startsWith("--")) return undefined;
  return value;
}

export async function run(args: string[]): Promise<number> {
  const workspace = getFlag(args, "--workspace") ?? process.cwd();
  const name = getFlag(args, "--name");
  const url = getFlag(args, "--url");
  const path = getFlag(args, "--path");
  if (!name || !url || !path) {
    console.log("ERROR args: --name, --url and --path are required");
    return 1;
  }
  const stackFlag = getFlag(args, "--stack");
  const stack = stackFlag ? stackFlag.split(",").map((s) => s.trim()).filter(Boolean) : undefined;

  const result = await addRepo(workspace, { name, url, path, stack });
  if (!result.ok) {
    console.log(`ERROR ${result.error}`);
    return 1;
  }
  console.log(`OK added ${result.repo}`);
  console.log("STATE relationship=pending specialists=pending");
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
