#!/usr/bin/env bun
// `aipe serve` — the AIPe Web Console: a zero-dependency Bun HTTP server that
// renders the whole company (org chart, workers by state, pipeline stages, detail)
// as a responsive desktop+mobile web app, live over SSE, with an embedded shell
// terminal so the PE can drive the workspace from the browser.
//
//   aipe serve [--port <n>] [--host <addr>] [--workspace <dir>]
//              [--allow-remote-terminal]
//
// Binds 127.0.0.1 by default; nothing leaves the machine. The terminal is a
// persistent-shell command console (no PTY, per the zero-dependency rule): it
// runs aipe/git/tests fine; full-screen TUIs (vim, less) are out of scope.
import { isLoopback, startServer } from "./server";

function getFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const value = args[i + 1];
  if (value === undefined || value.startsWith("--")) return undefined;
  return value;
}

export async function run(args: string[]): Promise<number> {
  const workspace = getFlag(args, "--workspace") ?? process.cwd();
  const port = Math.max(0, Number(getFlag(args, "--port") ?? "4317") || 4317);
  const host = getFlag(args, "--host") ?? "127.0.0.1";
  const allowRemoteTerminal = args.includes("--allow-remote-terminal");

  const server = startServer({ workspace, port, host, allowRemoteTerminal });
  const shown = host === "0.0.0.0" ? "localhost" : host;
  console.log(`aipe serve — web console at http://${shown}:${server.port}`);
  console.log(`aipe serve — workspace ${workspace}`);
  if (!isLoopback(host) && !allowRemoteTerminal) {
    console.log("aipe serve — terminal disabled on a non-loopback host (pass --allow-remote-terminal to enable)");
  }
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
