#!/usr/bin/env bun
// AIPe unified CLI. Every onboarding step is a subcommand of a single binary,
// so a compiled standalone executable needs no Bun/Node/npm on the host.
//
//   aipe context-brain   [--input <file.json>] [--workspace <dir>]
//   aipe make-workspace   [--workspace <dir>]
//   aipe relationship     [--workspace <dir>]
//   aipe hire-specialists [--resolve-names --input <file.json>] [--workspace <dir>]
//   aipe read-state       [--workspace <dir>]
//   aipe --version | --help
import { run as contextBrain } from "./context-brain/cli";
import { run as makeWorkspace } from "./make-workspace/cli";
import { run as hireSpecialists } from "./hire-specialists/cli";
import { run as relationship } from "./relationship/cli";
import { run as readState, runSessionContext } from "./session-hook/read-state";
import { run as start } from "./start/cli";
import { run as worktree } from "./worktree/cli";
import { run as dispatchCmd } from "./dispatch/cli";
import { run as journey } from "./journey/cli";
import { run as rehydrate } from "./rehydrate/cli";

export const VERSION = "0.1.0";

type Subcommand = (args: string[]) => Promise<number>;

const SUBCOMMANDS: Record<string, Subcommand> = {
  start: start,
  "context-brain": contextBrain,
  "make-workspace": makeWorkspace,
  relationship: relationship,
  "hire-specialists": hireSpecialists,
  "read-state": readState,
  "session-context": runSessionContext,
  worktree: worktree,
  dispatch: dispatchCmd,
  journey: journey,
  rehydrate: rehydrate,
};

const HELP = [
  "aipe — AI Product Engineer onboarding CLI",
  "",
  "Usage: aipe <command> [options]",
  "",
  "Commands:",
  "  start              Set up an AIPe workspace in this folder (pick your harness)",
  "  context-brain      Declare the context's repos → .aipe/brain.yaml",
  "  make-workspace     Clone the declared repos on disk",
  "  relationship       Discover cross-repo relations + backfill stack",
  "  hire-specialists   Generate the per-repo persona skills + personas.yaml",
  "  worktree           Provision/list/remove per-specialist git worktrees",
  "  dispatch           Adjudicate the parallel-dispatch law for a batch",
  "  journey            Track a work session's dispatches (durable ledger)",
  "  rehydrate          Restore per-repo persona skills from .aipe/personas/",
  "  read-state         Print the coordinator awareness fields (used by hooks)",
  "  session-context    Emit the SessionStart hook JSON (coordinator awareness)",
  "",
  "Common options:",
  "  --workspace <dir>  Workspace directory (defaults to the current directory)",
  "  --version          Print the version",
  "  --help             Print this help",
].join("\n");

export async function dispatch(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;

  if (command === undefined || command === "--help" || command === "-h" || command === "help") {
    console.log(HELP);
    return 0;
  }
  if (command === "--version" || command === "-v" || command === "version") {
    console.log(VERSION);
    return 0;
  }

  const handler = SUBCOMMANDS[command];
  if (!handler) {
    console.log(`ERROR command: unknown command "${command}"`);
    console.log(HELP);
    return 1;
  }
  return handler(rest);
}

if (import.meta.main) {
  dispatch(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      console.log(`ERROR ${err}`);
      process.exit(1);
    });
}
