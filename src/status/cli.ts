#!/usr/bin/env bun
// `aipe status` — the status/progress report the coordinator prints into the chat
// on demand (item 3). Default is an aligned human table; `--json` is the same data
// structured. Scoping: default (open work + recent closed), `--journey <id>`,
// `--all`. Format: `--compact`/`--detailed` override the saved preference for this
// one render (item 10, invariant 3) without touching the brain.
import { realRunner } from "../session/runner";
import { looksLikeWorkspace } from "../runtime/workspaces";
import type { AgentopRunner } from "../session/types";
import { configCommand } from "./config";
import { loadReport } from "./load";
import { renderJson, renderTable, supportsColor } from "./render";
import type { StatusFormat, StatusScope } from "./types";

export interface StatusDeps {
  runner?: AgentopRunner;
  stdout?: { isTTY?: boolean };
  env?: Record<string, string | undefined>;
}

function getFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  if (v === undefined || v.startsWith("--")) return undefined;
  return v;
}

const HELP = [
  "aipe status — who is doing what, in which repo, at what status",
  "",
  "Usage: aipe status [--journey <id>] [--all] [--json] [--compact|--detailed] [--workspace <dir>]",
  "",
  "Scope:",
  "  (default)          journeys with open work, plus the most recently closed ones",
  "  --journey <id>     just that one journey",
  "  --all              the full history (can be long)",
  "",
  "Output:",
  "  (default)          an aligned human table in the terminal",
  "  --json             the same data as structured JSON (for rendering as a chat table)",
  "  --compact          fewer columns (overrides the saved preference for this render)",
  "  --detailed         all columns (overrides the saved preference for this render)",
  "",
  "  --workspace <dir>  workspace directory (defaults to the current directory)",
  "  --help, -h         show this help",
  "",
  "Change the saved auto-update preference (no need to redo onboarding):",
  "  aipe status config                       show the current setting",
  "  aipe status config --auto true|false     turn the auto-push on/off",
  "  aipe status config --format detailed|compact   set the pushed format",
].join("\n");

export async function run(args: string[], deps: StatusDeps = {}): Promise<number> {
  if (args[0] === "config") {
    return configCommand(args.slice(1));
  }
  if (args.includes("--help") || args.includes("-h")) {
    console.log(HELP);
    return 0;
  }
  const workspace = getFlag(args, "--workspace") ?? process.cwd();

  // Refuse to report on a directory that is not an AIPe workspace. Without this
  // guard, `loadReport` on a non-workspace returns an empty report and status
  // prints `(none)` / `{journeys:[],units:[],waiting:[]}` and exits 0 —
  // indistinguishable from a real, empty workspace. The coordinator runs
  // `aipe status` in chat to report to the PE; from the wrong directory it would
  // read "nothing to do" as truth. Fail loud instead, for the table AND `--json`
  // (both lied the same way before) — same shape as `migrate-layout`/`rehydrate`.
  // This is deliberately NOT the same as the SessionStart hook's `safeStateBlock`,
  // which must degrade silently — see the note there.
  if (!looksLikeWorkspace(workspace)) {
    console.log(`ERROR workspace: no AIPe workspace at ${workspace} (no .aipe/harness or .aipe/brain.yaml)`);
    console.log("cd into your workspace, or pass --workspace <dir>.");
    return 1;
  }

  const journeyId = getFlag(args, "--journey");
  const scope: StatusScope = journeyId ? "journey" : args.includes("--all") ? "all" : "default";

  const report = await loadReport(workspace, { scope, journeyId, runner: deps.runner ?? realRunner });

  // On-the-spot format overrides the saved preference for this render only.
  const override: StatusFormat | undefined = args.includes("--compact")
    ? "compact"
    : args.includes("--detailed")
      ? "detailed"
      : undefined;
  const format = override ?? report.pref.format;

  if (args.includes("--json")) {
    console.log(renderJson(report));
    return 0;
  }

  if (scope === "journey" && report.journeys.length === 0) {
    console.log(`No journey "${journeyId}" in ${workspace}.`);
    return 0;
  }

  const color = supportsColor(deps.stdout ?? process.stdout, deps.env ?? process.env);
  for (const line of renderTable(report, format, color)) console.log(line);
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
