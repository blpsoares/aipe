#!/usr/bin/env bun
// `aipe serve` — the AIPe Web Console: a zero-dependency Bun HTTP server that
// renders the whole company (org chart, workers by state, pipeline stages, detail)
// as a responsive desktop+mobile web app, live over SSE.
//
//   aipe serve [--port <n>] [--host <addr>] [--workspace <dir>]
//              [--background|-d|--detached] [--insecure]
//
// Binds 127.0.0.1 by default; nothing leaves the machine. Any other host makes
// the console reachable from the network, and it serves the whole workspace
// plus the code specialists are writing — so off loopback it requires a token,
// printed once in the URL. `--insecure` opts out deliberately.
//
// --background/-d/--detached spawns the server as a detached child, prints its
// PID + how to stop it, and returns immediately so it outlives the shell.
import { isLoopback, requiresAuth, resolveToken, TOKEN_ENV } from "./auth";
import { startServer } from "./server";
import { registerServe, runningServes, unregisterServe } from "../runtime/serve-registry";
import {
  isHelpRequest,
  serveSubcommand,
  selectForWorkspace,
  statusExitCode,
  stopPlan,
  portHolder,
} from "./lifecycle";
import { renderBanner, renderHelp, renderStatus, renderStop, liveLine, supportsColor } from "./present";
import { VERSION } from "../cli";

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

/**
 * Pure: what to tell the operator about who can reach this console.
 *
 * Silence on loopback (nothing to say), the token rule off loopback, and a
 * blunt warning for `--insecure` — an open console exposes the workspace and
 * the code specialists are writing, so that choice should never be quiet.
 */
export function accessNotice(host: string, insecure: boolean, tokenEnv: string): string[] {
  if (isLoopback(host)) return [];
  if (insecure) {
    return [
      `aipe serve — WARNING: --insecure on ${host}: anyone who can reach this port can read`,
      "aipe serve —          your workspace and the code your specialists are writing.",
    ];
  }
  return [
    `aipe serve — bound to ${host} (reachable from the network), so a token is required.`,
    `aipe serve — open the URL above; set ${tokenEnv} to pin your own token.`,
  ];
}

function print(lines: string[]): void {
  for (const line of lines) console.log(line);
}

// `aipe serve status` — is a console running for THIS workspace? Reports port,
// PID, host, uptime; exit 0 when running, NOT_RUNNING_CODE (3) when not.
export async function statusCommand(workspace: string, out: (l: string[]) => void = print): Promise<number> {
  const color = supportsColor(process.stdout, process.env);
  const matched = selectForWorkspace(await runningServes(), workspace);
  out(renderStatus(matched, workspace, Date.now(), color));
  return statusExitCode(matched);
}

// `aipe serve stop` — stop the detached console(s) for this workspace. Idempotent
// (exit 0 even when nothing was running) and explicit about a no-op.
export async function stopCommand(
  workspace: string,
  out: (l: string[]) => void = print,
  kill: (pid: number) => void = (pid) => process.kill(pid, "SIGTERM"),
): Promise<number> {
  const color = supportsColor(process.stdout, process.env);
  const pids = stopPlan(await runningServes(), workspace);
  const stopped: number[] = [];
  for (const pid of pids) {
    try {
      kill(pid);
      // The console removes its own registry entry on SIGTERM, but a slow or
      // already-gone process could leave a stale file — clear it either way so
      // `stop` is idempotent and `status` is immediately correct.
      unregisterServe(pid);
      stopped.push(pid);
    } catch {
      // ESRCH (already gone) or EPERM (not ours) — drop its stale entry anyway.
      unregisterServe(pid);
    }
  }
  out(renderStop(stopped, workspace, color));
  return 0;
}

export async function run(args: string[]): Promise<number> {
  const workspace = getFlag(args, "--workspace") ?? process.cwd();

  // `--help` prints help and exits WITHOUT binding the port — the whole reason
  // it was broken before was that binding happened first and threw on a busy
  // port. Help must never touch the network.
  if (isHelpRequest(args)) {
    print(renderHelp(supportsColor(process.stdout, process.env)));
    return 0;
  }

  const sub = serveSubcommand(args);
  if (sub === "status") return statusCommand(workspace);
  if (sub === "stop") return stopCommand(workspace);

  const port = Math.max(0, Number(getFlag(args, "--port") ?? "4317") || 4317);
  const host = getFlag(args, "--host") ?? "127.0.0.1";
  const insecure = args.includes("--insecure");

  if (wantsBackground(args)) {
    spawnDetached(args);
    return 0;
  }

  const guarded = requiresAuth(host, insecure);
  // Reused from the environment when present, so an upgrade can restart this
  // console without invalidating the cookie every open browser is holding.
  const token = guarded ? resolveToken() : "";

  const color = supportsColor(process.stdout, process.env);

  let server: ReturnType<typeof startServer>;
  try {
    server = startServer({ workspace, port, host, token, insecure, onClients: updateLiveLine });
  } catch (err) {
    // Bun throws EADDRINUSE synchronously. Name who holds the port instead of
    // re-throwing a bare "is port in use?".
    const holder = portHolder(await runningServes(), port, host);
    if (holder) {
      console.log(`ERROR aipe serve — port ${port} is already held by an aipe console (PID ${holder.pid}, workspace ${holder.workspace}).`);
      console.log(`ERROR aipe serve — stop it with:  aipe serve stop   (from that workspace)  or  kill ${holder.pid}`);
    } else {
      console.log(`ERROR aipe serve — could not bind ${host}:${port} — ${(err as Error).message}. Is another process using it? Pick another with --port.`);
    }
    return 1;
  }
  // Announce this server on the machine registry so `aipe upgrade` can bounce
  // it onto the new binary — a detached console otherwise serves the old code
  // until someone notices and kills it by hand.
  await registerServe({
    pid: process.pid,
    port: server.port ?? port,
    host,
    workspace,
    version: VERSION,
    startedAt: Date.now(),
    ...(token !== "" ? { token } : {}),
    ...(insecure ? { insecure: true } : {}),
  });
  const shown = host === "0.0.0.0" ? "localhost" : host;
  const suffix = guarded ? `/?token=${token}` : "";
  const url = `http://${shown}:${server.port}${suffix}`;
  print(renderBanner({ url, workspace, notice: accessNotice(host, insecure, TOKEN_ENV) }, color));
  // The live line is the last thing printed, so it can be rewritten in place as
  // SSE clients connect/disconnect (TTY only; when piped we print it once).
  liveLinePrinted = true;
  process.stdout.write(liveLine(0, color) + "\n");

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

// ── Live line (attached, TTY) ────────────────────────────────────────────────
// A single line at the bottom of the banner, rewritten in place as SSE clients
// come and go. Only rewrites on a TTY (where cursor control works); when piped
// the initial line stands and updates are suppressed to avoid log spam.
let liveLinePrinted = false;
function updateLiveLine(count: number): void {
  if (!liveLinePrinted) return;
  const color = supportsColor(process.stdout, process.env);
  if (process.stdout.isTTY) {
    // Move to line start, clear it, rewrite. Safe because the live line is the
    // last thing written and nothing else prints after the banner.
    process.stdout.write("\r\x1b[2K" + liveLine(count, color));
  }
}

if (import.meta.main) {
  run(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      console.log(`ERROR ${err}`);
      process.exit(1);
    });
}
