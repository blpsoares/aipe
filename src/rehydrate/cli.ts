#!/usr/bin/env bun
// `aipe rehydrate` — restore installed artifacts from their published sources /
// the binary: per-repo persona skills from .aipe/personas/, the toolbox from
// .aipe/toolbox.yaml, and the coordinator flow-skills from THIS binary's embedded
// versions. So a workspace opened on a new machine (or one whose binary was just
// upgraded) has its specialists back and its coordinator skills up to date,
// without re-running onboarding.
import { rehydrateFlowSkills } from "./flow-skills";
import { rehydratePersonas } from "./personas";
import { rebuildRegistryFromSources } from "./registry";
import { rehydrateToolbox } from "./toolbox";

function getFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const value = args[i + 1];
  if (value === undefined || value.startsWith("--")) return undefined;
  return value;
}

export async function run(args: string[]): Promise<number> {
  const workspace = getFlag(args, "--workspace") ?? process.cwd();
  const personas = await rehydratePersonas(workspace);
  for (const r of personas) console.log(`${r.status.toUpperCase()} persona ${r.repo} ${r.slug}`);
  // Rebuild the durable roster (.aipe/personas.yaml) from the same sources —
  // the recovery path for a personas.yaml that was lost/corrupted (D3). Unions
  // onto the existing roster: it re-registers personas whose entry was lost and
  // keeps the ones still present (with their richer package/group data). Never
  // removes an entry, so it is safe to run on every rehydrate.
  const registry = await rebuildRegistryFromSources(workspace);
  for (const r of registry.filter((x) => x.status === "registered")) {
    console.log(`REGISTERED persona ${r.repo} ${r.slug}`);
  }
  const toolbox = await rehydrateToolbox(workspace);
  for (const r of toolbox) console.log(`${r.status.toUpperCase()} ${r.kind} ${r.name}`);
  const flowSkills = await rehydrateFlowSkills(workspace);
  for (const r of flowSkills) console.log(`${r.status.toUpperCase()} flow-skill ${r.name}`);
  const restored = personas.filter((r) => r.status === "restored").length + toolbox.filter((r) => r.status === "restored").length;
  const synced = flowSkills.filter((r) => r.status !== "unchanged").length;
  console.log(`STATE rehydrated=${restored} flow-skills-synced=${synced}`);
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
