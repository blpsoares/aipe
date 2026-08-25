// What happens AFTER the new binary is in place.
//
// Upgrading aipe is not "the file changed". Two things on the machine keep
// running the old version until something bounces them, and neither of them
// bounces itself:
//
//   • every workspace's coordinator flow-skills, which are written FROM the
//     binary by `aipe rehydrate` — an upgraded binary with un-rehydrated
//     workspaces is a coordinator running last version's instructions;
//   • every `aipe serve` process, which was started from the old executable and
//     will happily keep serving it for days.
//
// So the upgrade walks both registries and puts the machine back the way it
// found it, on the new code. Every step's result is CHECKED and collected: a
// swallowed failure leaves the user on the old behaviour while the CLI claims
// success, which is precisely the case that hides a bad upgrade.
import { isLegacyLayout } from "../context-brain/layout";
import { readBrain } from "../make-workspace/read";
import { runningServes, unregisterServe, type ServeEntry } from "../runtime/serve-registry";
import { TOKEN_ENV } from "../serve/auth";
import { knownWorkspaces } from "../runtime/workspaces";

export interface ApplyOutcome {
  ok: boolean;
  /**
   * Workspaces still on the legacy layout (repos as direct children of the
   * workspace instead of under `repos/`).
   *
   * DETECTED, never acted on. Migrating means moving the PE's own checkouts,
   * and this code path is the worst possible place to do that: it runs
   * unattended after a self-upgrade, fans out over every workspace this machine
   * has ever seen, and its `run` discards stdout and stderr. A silent `mv` here
   * would be unrecoverable and unlogged. `aipe workspace migrate-layout` exists
   * for that, deliberately, and refuses when a dispatch is in flight.
   */
  legacyLayout: string[];
  rehydrated: string[];
  restarted: number[];
  failures: string[];
}

export interface ApplyDeps {
  workspaces: () => Promise<string[]>;
  serves: () => Promise<ServeEntry[]>;
  /** Runs a command to completion, returning its exit code. */
  run: (cmd: string[]) => Promise<number>;
  /** Spawns a detached command; returns its pid, or null. `env` carries the
   *  restarted console's access token, which must never reach an argv (it
   *  would be visible in `ps` to every user on the machine). */
  spawnDetached: (cmd: string[], env?: Record<string, string>) => number | null;
  /** Stops a running server. Returns false when the signal could not be sent. */
  stop: (pid: number) => boolean;
  log: (line: string) => void;
  /** Is this workspace still on the legacy root layout? */
  isLegacy: (workspace: string) => Promise<boolean>;
  /** Waits between the stop and the restart so the port is free again. */
  wait: (ms: number) => Promise<void>;
}

const defaults: ApplyDeps = {
  workspaces: knownWorkspaces,
  serves: () => runningServes(),
  run: async (cmd) => {
    try {
      const p = Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" });
      return await p.exited;
    } catch {
      return 1;
    }
  },
  spawnDetached: (cmd, env) => {
    try {
      const child = Bun.spawn(cmd, {
        stdin: "ignore",
        stdout: "ignore",
        stderr: "ignore",
        detached: true,
        ...(env ? { env: { ...process.env, ...env } } : {}),
      });
      child.unref();
      return typeof child.pid === "number" ? child.pid : null;
    } catch {
      return null;
    }
  },
  stop: (pid) => {
    try {
      process.kill(pid, "SIGTERM");
      return true;
    } catch {
      return false;
    }
  },
  log: (line) => process.stdout.write(`${line}\n`),
  isLegacy: async (workspace) => {
    const result = await readBrain(workspace).catch(() => null);
    return result !== null && result.ok ? isLegacyLayout(result.brain.repos) : false;
  },
  wait: (ms) => new Promise((r) => setTimeout(r, ms)),
};

/** Pure: the argv that restarts a server from `bin` with the same shape it had.
 *  The token is deliberately absent — it travels in the environment. */
export function serveRestartCommand(bin: string, entry: ServeEntry): string[] {
  const argv = [bin, "serve", "--workspace", entry.workspace, "--port", String(entry.port), "--host", entry.host];
  if (entry.insecure) argv.push("--insecure");
  return argv;
}

/**
 * Pure: the environment a restarted console needs.
 *
 * Reusing the same token is the point: minting a fresh one would silently
 * invalidate the cookie every open browser holds, and this restart happens
 * unattended — nobody is watching to re-open the printed URL.
 */
export function serveRestartEnv(entry: ServeEntry): Record<string, string> | undefined {
  return entry.token ? { [TOKEN_ENV]: entry.token } : undefined;
}

/** Pure: the argv that rehydrates one workspace with `bin`. */
export function rehydrateCommand(bin: string, workspace: string): string[] {
  return [bin, "rehydrate", "--workspace", workspace];
}

/**
 * Applies the just-installed version to everything on this machine that is
 * still carrying the old one.
 *
 * @param bin path to the installed binary — the work is driven THROUGH it, not
 *   through this process, so what runs is unambiguously the new version.
 */
export async function applyUpgrade(bin: string, deps: Partial<ApplyDeps> = {}): Promise<ApplyOutcome> {
  const d = { ...defaults, ...deps };
  const failures: string[] = [];
  const rehydrated: string[] = [];
  const restarted: number[] = [];
  const legacyLayout: string[] = [];

  const workspaces = await d.workspaces().catch(() => [] as string[]);
  for (const ws of workspaces) {
    d.log(`  Rehydrating ${ws}…`);
    const code = await d.run(rehydrateCommand(bin, ws));
    if (code === 0) rehydrated.push(ws);
    else failures.push(`rehydrate ${ws}: exited ${code}`);
    // Reported at the end, not here: one line about a layout the PE chose is
    // context, and burying it between per-workspace progress lines is how it
    // gets scrolled past.
    if (await d.isLegacy(ws).catch(() => false)) legacyLayout.push(ws);
  }

  const serves = await d.serves().catch(() => [] as ServeEntry[]);
  for (const s of serves) {
    d.log(`  Restarting the web console on :${s.port} (${s.workspace})…`);
    if (!d.stop(s.pid)) {
      failures.push(`web console (pid ${s.pid}): could not stop it — it still runs the old version`);
      continue;
    }
    // The old process owns the port until it actually exits; restarting into a
    // still-bound port is how a "successful" upgrade ends with no server at all.
    unregisterServe(s.pid);
    await d.wait(500);
    const pid = d.spawnDetached(serveRestartCommand(bin, s), serveRestartEnv(s));
    if (pid === null) failures.push(`web console on :${s.port}: could not be restarted`);
    else restarted.push(pid);
  }

  if (workspaces.length === 0 && serves.length === 0) {
    d.log("  Nothing to apply — no known workspaces and no running web console.");
  }

  if (legacyLayout.length > 0) {
    const which = legacyLayout.length === 1 ? legacyLayout[0] : `${legacyLayout.length} workspaces`;
    d.log(`  ${which} still keeps its repos at the workspace root.`);
    d.log("  To move them under repos/: aipe workspace migrate-layout (--apply to commit to it).");
  }

  return { ok: failures.length === 0, rehydrated, restarted, failures, legacyLayout };
}
