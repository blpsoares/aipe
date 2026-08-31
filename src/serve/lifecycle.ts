// Pure lifecycle logic for `aipe serve` — the decisions behind `--help`,
// `serve status` and `serve stop`, kept free of I/O so they stay trivially
// testable. The CLI (cli.ts) supplies the running-server entries (read from the
// per-machine registry, ~/.aipe/serve/*.json) and does the actual kill/print.
import { resolve } from "node:path";
import type { ServeEntry } from "../runtime/serve-registry";

// Exit code for `serve status` when no console is running for this workspace.
// Deliberately NOT 1: "nothing is running" is a clean answer to the question,
// not an error (1 is what the top-level catch uses for a thrown failure). 3
// mirrors the systemd convention ("program is not running").
export const NOT_RUNNING_CODE = 3;

const HELP_FLAGS = new Set(["--help", "-h"]);

/** `--help`/`-h` anywhere ⇒ print help and exit, never bind the port. */
export function isHelpRequest(args: string[]): boolean {
  return args.some((a) => HELP_FLAGS.has(a));
}

const SUBCOMMANDS = new Set(["status", "stop", "tailscale"]);

/**
 * The lifecycle subcommand, if any. Only a LEADING positional counts
 * (`aipe serve status`), so the plain start form (`aipe serve --port 4317`)
 * and stray values are never mistaken for one.
 */
export function serveSubcommand(args: string[]): "status" | "stop" | "tailscale" | undefined {
  const head = args[0];
  return head && SUBCOMMANDS.has(head) ? (head as "status" | "stop" | "tailscale") : undefined;
}

/** The running consoles bound to this workspace (path-resolved on both sides). */
export function selectForWorkspace(entries: ServeEntry[], workspaceAbs: string): ServeEntry[] {
  const target = resolve(workspaceAbs);
  return entries.filter((e) => resolve(e.workspace) === target);
}

/** `serve status`: 0 when one is running for this workspace, NOT_RUNNING_CODE otherwise. */
export function statusExitCode(matched: ServeEntry[]): number {
  return matched.length > 0 ? 0 : NOT_RUNNING_CODE;
}

/**
 * The PIDs `serve stop` should signal, newest-first (a workspace normally has
 * one, but an accidental double-start leaves two — stop them all). Empty when
 * nothing matches, which the caller reports as an idempotent no-op.
 */
export function stopPlan(entries: ServeEntry[], workspaceAbs: string): number[] {
  return selectForWorkspace(entries, workspaceAbs)
    .slice()
    .sort((a, b) => b.startedAt - a.startedAt)
    .map((e) => e.pid);
}

/** The most-recently-started console for this workspace, to point Tailscale Serve at — or null when none runs. */
export function newestForWorkspace(entries: ServeEntry[], workspaceAbs: string): ServeEntry | null {
  const matched = selectForWorkspace(entries, workspaceAbs);
  if (matched.length === 0) return null;
  return matched.slice().sort((a, b) => b.startedAt - a.startedAt)[0]!;
}

/**
 * Who already holds a host:port, so a failed bind can name the offender instead
 * of the bare "is port in use?". Prefers an exact host+port match; falls back to
 * any entry on that port (a different bind host still explains the collision).
 */
export function portHolder(entries: ServeEntry[], port: number, host: string): ServeEntry | null {
  return entries.find((e) => e.port === port && e.host === host) ?? entries.find((e) => e.port === port) ?? null;
}
