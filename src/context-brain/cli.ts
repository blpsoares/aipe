#!/usr/bin/env bun
import { initContextBrain } from "./init";
import type { ContextInput } from "./types";

function getFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const inputPath = getFlag(args, "--input");
  const workspace = getFlag(args, "--workspace") ?? process.cwd();

  const raw = inputPath ? await Bun.file(inputPath).text() : await Bun.stdin.text();
  const input = JSON.parse(raw) as ContextInput;

  const result = await initContextBrain(input, workspace);
  if (!result.ok) {
    for (const e of result.errors) {
      console.log(`ERRO ${e.field}: ${e.message}`);
    }
    return 1;
  }
  console.log(`OK brain=${result.brainPath}`);
  console.log(`OK state=${result.statePath}`);
  return 0;
}

main().then((code) => process.exit(code));
