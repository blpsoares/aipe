import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  findHarness,
  harnessTag,
  realIsContainable,
  HARNESSES,
  renderIntro,
  renderNextSteps,
  renderNonInteractiveHelp,
  slugify,
  type Harness,
} from "./start";
import { probeCommand } from "../capabilities/cli";
import { realProbeRunner } from "../capabilities/probe";
import type { ProbeRunner } from "../capabilities/types";
import { getAdapter, hasAdapter, writeHarness } from "../harness/registry";
import { scaffoldWorkspace } from "./scaffold";
import { askLine, selectInteractive } from "./prompt";
import { suggestInstallLine } from "../shell-hook/cli";

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
    HARNESSES.map((h) => ({
      label: `${h.label}${harnessTag(h, realIsContainable(h.id))}`,
      disabled: h.status === "coming-soon",
    })),
  );
  if (index === null) return null;
  return HARNESSES[index] ?? null;
}

export interface StartCommandOptions {
  parentDir: string;
  harness: Harness;
  name: string;
  // Injectable so tests never shell out to a real harness binary — follows
  // the same pattern as execution/cli.ts's proposeCommand. Defaults to the
  // real subprocess runner outside tests.
  runner?: ProbeRunner;
  now?: string;
  // The user's home, for the one-line shell-hook OFFER printed after the next
  // steps. Injectable so tests drive a disposable HOME; `run()` passes the real
  // `homedir()`. When absent, no offer is evaluated (there is no rc to suggest
  // against) — this keeps `startCommand`'s deterministic tests home-independent.
  home?: string;
}

// The workspace-creation half of `aipe start`, split out from `run()` so it
// is testable without a TTY: `run()` handles interactive harness/name
// selection, then hands off here for everything deterministic.
//
// Probing is the LAST step, after the workspace fully exists, and it can
// never fail `start`: the whole point of this subsystem is that the
// coordinator arrives with a filled envelope instead of a blank one, but a
// workspace that exists without a capabilities record is still a perfectly
// usable workspace (`aipe execution propose` self-heals the same way), while
// a `start` that dies half-way because a probe subprocess misbehaved is not.
export async function startCommand(
  opts: StartCommandOptions,
): Promise<{ code: number; lines: string[] }> {
  const slug = slugify(opts.name);
  if (!slug) {
    return { code: 1, lines: ["ERROR name: workspace name is empty after slugifying"] };
  }

  const folder = `aipe-${slug}`;
  const workspaceDir = join(opts.parentDir, folder);
  await mkdir(workspaceDir, { recursive: true });

  // Make the workspace a publishable git repo. The allowlist (.gitignore, and
  // the README's file map) has to know which harness was chosen — a Gemini
  // workspace that ignores `.gemini/` and `.agents/` publishes without its
  // integration and rehydrates into nothing on the next machine.
  const adapter = getAdapter(opts.harness.id);
  await scaffoldWorkspace(workspaceDir, adapter);

  const report = await adapter.installIntegration(workspaceDir);
  await writeHarness(workspaceDir, opts.harness.id);

  const lines: string[] = [`aipe: installed the ${adapter.label} integration into ${folder}/`];
  for (const note of report.notes) lines.push(`aipe:  - ${note}`);

  const runner = opts.runner ?? realProbeRunner;
  const now = opts.now ?? new Date().toISOString();
  try {
    const probed = await probeCommand(workspaceDir, runner, now);
    lines.push("aipe: checked which harnesses are available on this machine:");
    for (const line of probed.lines) lines.push(`aipe:  - ${line}`);
  } catch (err) {
    // Never let a probe failure break workspace creation — a workspace
    // without a capabilities record is fine (`aipe execution propose`
    // self-heals), a `start` that dies half-way is not.
    lines.push(
      `aipe:  - could not check harness capabilities automatically (${err}) — run \`aipe capabilities probe\` later`,
    );
  }

  lines.push(...renderNextSteps(folder));

  // The discoverability line for `aipe shell-hook` (the whole reason the command
  // exists: a coordinator ran a day on a stale version with nothing warning
  // them). It only SUGGESTS — installing is the user's act — and `suggestInstallLine`
  // returns null once the hook is installed, so it never becomes per-run noise.
  if (opts.home !== undefined) {
    const offer = await suggestInstallLine(opts.home);
    if (offer) lines.push("", `aipe: ${offer}`);
  }

  return { code: 0, lines };
}

export async function run(args: string[], runner?: ProbeRunner): Promise<number> {
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
  // Defence in depth against the failure `harnessTag`'s comment describes: an
  // id listed as supported with no adapter would install Claude Code's files
  // under another harness's name, and nothing downstream would notice.
  if (harness.status === "supported" && !hasAdapter(harness.id)) {
    console.log(`ERROR harness: ${harness.id} has no adapter — this is a bug, please report it.`);
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

  const result = await startCommand({ parentDir: parent, harness, name: name ?? "", runner, home: homedir() });
  print(result.lines);
  return result.code;
}

if (import.meta.main) {
  run(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      console.log(`ERROR ${err}`);
      process.exit(1);
    });
}
