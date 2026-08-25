// The registry of running `aipe serve` processes.
//
// `aipe serve --background` detaches and prints a PID; after that nothing knows
// the server exists. An upgrade that replaces the binary therefore leaves the
// web console running the OLD code — indefinitely, since it never restarts on
// its own. Each server writes an entry while it lives; `aipe upgrade` reads the
// entries, stops what is still alive and starts it again from the new binary
// with the same workspace/port/host.
//
// One file per pid (not one shared file) so two servers starting at once can
// never clobber each other's entry.
import { existsSync, readdirSync, unlinkSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { statePath } from "./state";

export interface ServeEntry {
  pid: number;
  port: number;
  host: string;
  workspace: string;
  version: string;
  startedAt: number;
  /**
   * The access token, when this console is bound off loopback.
   *
   * Persisted so `aipe upgrade` can restart it with the SAME token: a fresh
   * one would silently invalidate the cookie every open browser is holding,
   * and the restart happens unattended, with nobody watching to re-open the
   * printed URL. The file is written 0600 for this reason.
   */
  token?: string;
  /** Whether this console was started with --insecure, so a restart keeps it. */
  insecure?: boolean;
}

export function serveDir(): string {
  return statePath("serve");
}

export function serveEntryPath(pid: number): string {
  return join(serveDir(), `${pid}.json`);
}

/** Pure: parse one entry file. Junk or a missing required field → null. */
export function parseServeEntry(raw: string): ServeEntry | null {
  try {
    const o = JSON.parse(raw) as Partial<ServeEntry>;
    if (!o || typeof o.pid !== "number" || !Number.isFinite(o.pid) || o.pid <= 0) return null;
    if (typeof o.workspace !== "string" || o.workspace === "") return null;
    return {
      pid: o.pid,
      port: typeof o.port === "number" && Number.isFinite(o.port) ? o.port : 0,
      host: typeof o.host === "string" && o.host !== "" ? o.host : "127.0.0.1",
      workspace: o.workspace,
      version: typeof o.version === "string" ? o.version : "",
      startedAt: typeof o.startedAt === "number" && Number.isFinite(o.startedAt) ? o.startedAt : 0,
      ...(typeof o.token === "string" && o.token !== "" ? { token: o.token } : {}),
      ...(o.insecure === true ? { insecure: true } : {}),
    };
  } catch {
    return null;
  }
}

/** signal 0 probes liveness without delivering anything. EPERM = alive, not ours. */
export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    return (err as { code?: string })?.code === "EPERM";
  }
}

/** Records this server while it runs, and arms removal on every exit path. */
export async function registerServe(entry: ServeEntry): Promise<void> {
  try {
    await mkdir(serveDir(), { recursive: true, mode: 0o700 });
    // 0600: the entry can carry this console's access token.
    await writeFile(serveEntryPath(entry.pid), JSON.stringify(entry), { encoding: "utf8", mode: 0o600 });
    const drop = () => unregisterServe(entry.pid);
    process.on("exit", drop);
    // A killed server must not leave a ghost entry behind: the upgrade would
    // "restart" a pid that is gone and report a failure that never happened.
    for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
      process.on(sig, () => {
        drop();
        process.exit(0);
      });
    }
  } catch {
    // best-effort
  }
}

/** Removes this server's entry. Safe to call twice. */
export function unregisterServe(pid: number): void {
  try {
    unlinkSync(serveEntryPath(pid));
  } catch {
    // already gone
  }
}

/**
 * The servers that are actually up. Entries whose process is dead are deleted
 * as they are found — a crashed server otherwise keeps its file forever and
 * every future upgrade tries to "restart" it.
 */
export async function runningServes(isAlive: (pid: number) => boolean = pidAlive): Promise<ServeEntry[]> {
  const dir = serveDir();
  if (!existsSync(dir)) return [];
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const live: ServeEntry[] = [];
  for (const f of files) {
    const full = join(dir, f);
    let entry: ServeEntry | null = null;
    try {
      entry = parseServeEntry(await readFile(full, "utf8"));
    } catch {
      entry = null;
    }
    if (entry && isAlive(entry.pid)) live.push(entry);
    else {
      try {
        unlinkSync(full);
      } catch {
        // best-effort
      }
    }
  }
  return live.sort((a, b) => a.startedAt - b.startedAt);
}
