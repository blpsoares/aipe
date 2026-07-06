#!/usr/bin/env bun
import { checkPersonaReadiness, type ReadinessResult } from "./check";
import { liveValidationSteps } from "./steps";

function getFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const value = args[i + 1];
  if (value === undefined || value.startsWith("--")) return undefined;
  return value;
}

export function renderReport(result: ReadinessResult): string[] {
  const lines: string[] = [];
  for (const r of result.results) {
    const where = r.repo ?? "?";
    if (r.ok) {
      lines.push(`OK      ${r.name}  ${where}  ${r.path}/SKILL.md`);
    } else {
      lines.push(`PROBLEM ${r.name}  ${where}  ${r.issues.join("; ")}`);
    }
  }
  const problems = result.total - result.ready;
  const suffix = problems > 0 ? ` (${problems} problem(s))` : "";
  lines.push(`STATE personas-ready=${result.ready}/${result.total}${suffix}`);
  return lines;
}

export async function run(args: string[]): Promise<number> {
  const workspace = getFlag(args, "--workspace") ?? process.cwd();
  const result = await checkPersonaReadiness(workspace);

  for (const line of renderReport(result)) console.log(line);

  const allReady = result.total > 0 && result.ready === result.total;
  // Print the live-validation protocol when preconditions are green (or forced).
  // Suppress with --no-live-steps.
  if (!args.includes("--no-live-steps") && (allReady || args.includes("--print-live-steps"))) {
    console.log("");
    console.log(liveValidationSteps());
  }

  return allReady ? 0 : 1;
}

if (import.meta.main) {
  run(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      console.log(`ERROR ${err}`);
      process.exit(1);
    });
}
