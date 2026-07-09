#!/usr/bin/env bun
// `aipe serve` — the AIPe Web Console: a zero-dependency Bun HTTP server that
// renders the whole company (org chart, workers by state, pipeline stages, detail)
// as a responsive desktop+mobile web app, live over SSE.
//
//   aipe serve [--port <n>] [--host <addr>] [--workspace <dir>]
//              [--background|-d|--detached]
//
// Binds 127.0.0.1 by default; nothing leaves the machine.
//
// --background/-d/--detached spawns the server as a detached child, prints its
// PID + how to stop it, and returns immediately so it outlives the shell.
import { startServer } from "./server";

function getFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const value = args[i + 1];
  if (value === undefined || value.startsWith("--")) return undefined;
  return value;
}

const BACKGROUND_FLAGS = new Set(["--background", "--detached", "-d"]);

export function wantsBackground(args: string[]): boolean {
  return args.some((a) => BACKGROUND_FLAGS.has(a));
}

// The argv to hand the detached child: the same args with the background flags
// stripped (so the child runs a normal foreground server) and its value flags
// (which never take the background tokens as values) preserved.
export function foregroundArgs(args: string[]): string[] {
  return args.filter((a) => !BACKGROUND_FLAGS.has(a));
}

// True when running inside a Bun single-file executable (`bun build --compile`).
// Such a binary exposes its embedded entrypoint under a virtual filesystem root
// (posix: "/$bunfs/…", windows: "B:\\~BUN\\…"), so process.argv is
// ["bun", "/$bunfs/root/<exe>", "serve", …] rather than ["<bun>", "<script>", …].
export function isCompiled(): boolean {
  const main = Bun.main || process.argv[1] || "";
  return main.startsWith("/$bunfs/") || main.includes("~BUN") || main.startsWith("B:\\");
}

// Reconstruct the argv for the detached child: re-invoke `aipe serve` in the
// foreground with the background flags stripped. `args` are serve's own args
// (dispatch already consumed the "serve" token), so we re-add the subcommand.
//
//   - compiled binary: [<exe>, "serve", …] — running the binary re-injects its
//     own embedded entry, so passing a script path (or the virtual /$bunfs entry)
//     would shift argv and be parsed as the subcommand → "unknown command".
//   - dev (`bun src/cli.ts serve …`): [<bun>, <script-entry>, "serve", …] — the
//     runtime needs the script path to know what to run.
export function childCommand(args: string[], compiled: boolean = isCompiled()): string[] {
  const serveArgs = ["serve", ...foregroundArgs(args)];
  if (compiled) return [process.execPath, ...serveArgs];
  const entry = process.argv[1] ?? "";
  return [process.execPath, entry, ...serveArgs];
}

// Spawn a detached copy of `aipe serve` (foreground) and report its PID. Returns
// the child PID (or null if it could not be determined). Injectable spawn for tests.
export function spawnDetached(
  args: string[],
  log: (line: string) => void = console.log,
  spawn: (cmd: string[]) => { pid: number; unref?: () => void } = (cmd) =>
    // detached: new session (survives the terminal's SIGHUP); stdio ignored (no
    // stdin/TTY coupling — EOF of stdin is never seen, so it can't trigger a
    // shutdown); unref lets the parent exit immediately.
    Bun.spawn(cmd, { stdin: "ignore", stdout: "ignore", stderr: "ignore", detached: true }),
): number | null {
  const child = spawn(childCommand(args));
  child.unref?.();
  const pid = typeof child.pid === "number" ? child.pid : null;
  if (pid) {
    log(`aipe serve — started in the background (PID ${pid})`);
    log(`aipe serve — stop it with:  kill ${pid}`);
  } else {
    log("aipe serve — started in the background");
  }
  return pid;
}

export async function run(args: string[]): Promise<number> {
  const workspace = getFlag(args, "--workspace") ?? process.cwd();
  const port = Math.max(0, Number(getFlag(args, "--port") ?? "4317") || 4317);
  const host = getFlag(args, "--host") ?? "127.0.0.1";

  if (wantsBackground(args)) {
    spawnDetached(args);
    return 0;
  }

  const server = startServer({ workspace, port, host });
  const shown = host === "0.0.0.0" ? "localhost" : host;
  console.log(`aipe serve — web console at http://${shown}:${server.port}`);
  console.log(`aipe serve — workspace ${workspace}`);
  console.log("aipe serve — Ctrl-C to stop");

  const stop = () => {
    server.stop(true);
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  // Keep the process alive; the server runs until interrupted.
  await new Promise<void>(() => {});
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
