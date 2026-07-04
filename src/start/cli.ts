import { createInterface } from "node:readline/promises";
import { findHarness, HARNESSES, renderHarnessList, renderIntro, renderNonInteractiveHelp } from "./start";
import { installClaudeCode } from "./install";

function getFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const value = args[i + 1];
  if (value === undefined || value.startsWith("--")) return undefined;
  return value;
}

function print(lines: string[]): void {
  for (const line of lines) console.log(line);
}

async function promptChoice(): Promise<string | undefined> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question("Enter a number: ")).trim();
    const idx = Number.parseInt(answer, 10) - 1;
    return HARNESSES[idx]?.id;
  } finally {
    rl.close();
  }
}

export async function run(args: string[]): Promise<number> {
  const workspace = getFlag(args, "--workspace") ?? process.cwd();
  const explicit = getFlag(args, "--harness");

  let harnessId = explicit;
  if (!harnessId) {
    if (!process.stdin.isTTY) {
      print(renderNonInteractiveHelp());
      return 0;
    }
    print(renderIntro());
    print(renderHarnessList());
    console.log("");
    harnessId = await promptChoice();
  }

  const harness = harnessId ? findHarness(harnessId) : undefined;
  if (!harness) {
    console.log(`ERROR harness: unknown harness "${harnessId ?? ""}". Known: ${HARNESSES.map((h) => h.id).join(", ")}`);
    return 1;
  }

  if (harness.status === "coming-soon") {
    console.log(`aipe: ${harness.label} setup is coming soon.`);
    console.log("For now, install the Claude Code integration with: aipe start --harness claude-code");
    return 1;
  }

  if (harness.id === "claude-code") {
    return installClaudeCode(workspace);
  }

  console.log(`ERROR harness: no installer wired for "${harness.id}"`);
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
