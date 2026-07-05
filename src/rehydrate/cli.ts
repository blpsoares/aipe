#!/usr/bin/env bun
// `aipe rehydrate` — restore per-repo persona skills from .aipe/personas/ into
// the (re-cloned) repos, so a workspace opened on a new machine has its
// specialists back without re-running /hire-specialists.
import { rehydratePersonas } from "./personas";

function getFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const value = args[i + 1];
  if (value === undefined || value.startsWith("--")) return undefined;
  return value;
}

export async function run(args: string[]): Promise<number> {
  const workspace = getFlag(args, "--workspace") ?? process.cwd();
  const rows = await rehydratePersonas(workspace);
  for (const r of rows) console.log(`${r.status.toUpperCase()} ${r.repo} ${r.slug}`);
  const restored = rows.filter((r) => r.status === "restored").length;
  console.log(`STATE rehydrated=${restored} of ${rows.length}`);
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
