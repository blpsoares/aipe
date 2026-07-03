#!/usr/bin/env bun
import { initContextBrain } from "./init";
import type { ContextInput } from "./types";

function getFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const value = args[i + 1];
  if (value === undefined || value.startsWith("--")) return undefined;
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const inputPath = getFlag(args, "--input");
  const workspace = getFlag(args, "--workspace") ?? process.cwd();

  let parsed: unknown;
  try {
    const raw = inputPath ? await Bun.file(inputPath).text() : await Bun.stdin.text();
    parsed = JSON.parse(raw);
  } catch {
    console.log("ERROR input: invalid JSON");
    return 1;
  }

  if (!isPlainObject(parsed)) {
    console.log("ERROR input: expected a ContextInput object");
    return 1;
  }

  const input = parsed as unknown as ContextInput;

  const result = await initContextBrain(input, workspace);
  if (!result.ok) {
    for (const e of result.errors) {
      console.log(`ERROR ${e.field}: ${e.message}`);
    }
    return 1;
  }
  console.log(`OK brain=${result.brainPath}`);
  console.log(`OK state=${result.statePath}`);
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.log(`ERROR ${err}`);
    process.exit(1);
  });
