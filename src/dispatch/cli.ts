#!/usr/bin/env bun
// `aipe dispatch validate --input <batch.json>` — adjudicates the
// parallel-dispatch law for one proposed batch. Prints OK or one REJECT line
// per problem; the coordinator only provisions worktrees for a batch that
// validates. Deterministic; no LLM.
import { readFile } from "node:fs/promises";
import { readBrain } from "../make-workspace/read";
import { validateBatch } from "./law";
import { readPersonas } from "./personas";
import type { Batch, DispatchEntry } from "./types";

function getFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const value = args[i + 1];
  if (value === undefined || value.startsWith("--")) return undefined;
  return value;
}

function parseBatch(value: unknown): Batch | null {
  if (!Array.isArray(value)) return null;
  const batch: DispatchEntry[] = [];
  for (const e of value) {
    if (typeof e !== "object" || e === null) return null;
    const r = e as Record<string, unknown>;
    if (typeof r.repo !== "string" || typeof r.specialist !== "string") return null;
    batch.push({ repo: r.repo, specialist: r.specialist });
  }
  return batch;
}

async function validateCommand(args: string[]): Promise<number> {
  const workspace = getFlag(args, "--workspace") ?? process.cwd();
  const inputPath = getFlag(args, "--input");
  if (!inputPath) {
    console.log("ERROR input: --input <batch.json> is required");
    return 1;
  }

  let batch: Batch | null;
  try {
    batch = parseBatch(JSON.parse(await readFile(inputPath, "utf8")));
  } catch {
    console.log(`ERROR input: could not read/parse ${inputPath}`);
    return 1;
  }
  if (!batch) {
    console.log("ERROR input: expected a JSON array of {repo, specialist}");
    return 1;
  }

  const brainResult = await readBrain(workspace);
  if (!brainResult.ok) {
    console.log(`ERROR brain: ${brainResult.error}`);
    return 1;
  }
  const roster = await readPersonas(workspace);

  const verdict = validateBatch(
    batch,
    brainResult.brain.repos.map((r) => r.name),
    roster,
  );
  if (verdict.ok) {
    console.log(`OK batch=${batch.length}`);
    return 0;
  }
  for (const reject of verdict.rejects) console.log(`REJECT ${reject}`);
  return 1;
}

export async function run(args: string[]): Promise<number> {
  const [sub, ...rest] = args;
  if (sub === "validate") return validateCommand(rest);
  console.log(`ERROR command: unknown dispatch command "${sub ?? ""}"`);
  console.log("Usage: aipe dispatch validate --input <batch.json> [--workspace <dir>]");
  return 1;
}

if (import.meta.main) {
  run(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      console.log(`ERROR ${err}`);
      process.exit(1);
    });
}
