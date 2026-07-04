import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  findHarness,
  HARNESSES,
  renderIntro,
  renderNextSteps,
  renderNonInteractiveHelp,
  slugify,
  type Harness,
} from "./start";
import { installClaudeCode } from "./install";
import { askLine, selectInteractive } from "./prompt";

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

async function pickHarness(explicit: string | undefined): Promise<Harness | null | "help"> {
  if (explicit) return findHarness(explicit) ?? null;
  if (!process.stdin.isTTY) return "help";

  print(renderIntro());
  const index = await selectInteractive(
    "Choose your agent harness:",
    HARNESSES.map((h) => ({ label: h.label, disabled: h.status === "coming-soon" })),
  );
  if (index === null) return null;
  return HARNESSES[index] ?? null;
}

export async function run(args: string[]): Promise<number> {
  const parent = getFlag(args, "--dir") ?? process.cwd();
  const explicitName = getFlag(args, "--name");
  const explicitHarness = getFlag(args, "--harness");

  const harness = await pickHarness(explicitHarness);
  if (harness === "help") {
    print(renderNonInteractiveHelp());
    return 0;
  }
  if (harness === null) {
    console.log(`ERROR harness: unknown or cancelled. Known: ${HARNESSES.map((h) => h.id).join(", ")}`);
    return 1;
  }
  if (harness.status === "coming-soon") {
    console.log(`aipe: ${harness.label} setup is coming soon.`);
    console.log("For now, use: aipe start --harness claude-code");
    return 1;
  }

  // workspace name → aipe-<slug> folder
  let name = explicitName;
  if (!name) {
    if (!process.stdin.isTTY) {
      console.log("ERROR name: --name <workspace> is required in a non-interactive shell");
      return 1;
    }
    name = await askLine("Workspace name: ");
  }
  const slug = slugify(name ?? "");
  if (!slug) {
    console.log("ERROR name: workspace name is empty after slugifying");
    return 1;
  }

  const folder = `aipe-${slug}`;
  const workspaceDir = join(parent, folder);
  await mkdir(workspaceDir, { recursive: true });

  if (harness.id === "claude-code") {
    const code = await installClaudeCode(workspaceDir);
    if (code !== 0) return code;
    print(renderNextSteps(folder));
    return 0;
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
