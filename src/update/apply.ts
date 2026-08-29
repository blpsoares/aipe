// What happens AFTER the new binary is in place.
//
// Upgrading aipe is not "the file changed". Three things on the machine keep
// running the old shape until something moves them, and none moves itself:
//
//   • every workspace's coordinator flow-skills, written FROM the binary by
//     `aipe rehydrate` — an upgraded binary with un-rehydrated workspaces is a
//     coordinator running last version's instructions;
//   • a workspace still on the LEGACY layout (repos at the root instead of under
//     `repos/`) — the new version expects `repos/`, so the upgrade MIGRATES it,
//     it no longer just prints "you should run migrate-layout";
//   • every `aipe serve` process, started from the old executable and happy to
//     keep serving it for days.
//
// So the upgrade puts the machine back the way it found it, on the new code, and
// does the work instead of recommending it. Every step's result is CHECKED and
// its subprocess output CAPTURED: a swallowed failure leaves the user on the old
// behaviour while the CLI claims success — the case that hides a bad upgrade,
// and the cause of today's opaque `exited 1`.
//
// Scope, deliberately: rehydrate is safe and idempotent, so it fans out over
// every known workspace. MIGRATION moves the PE's own checkouts, so by default
// it touches ONLY the workspace the upgrade was invoked from (`currentWorkspace`);
// other legacy workspaces are NAMED with the exact command unless `--migrate-all`
// (or an interactive consent) opts them in. The non-interactive default is the
// safe one.
import { isLegacyLayout } from "../context-brain/layout";
import { readBrain } from "../make-workspace/read";
import { runningServes, unregisterServe, type ServeEntry } from "../runtime/serve-registry";
import { TOKEN_ENV } from "../serve/auth";
import { knownWorkspaces } from "../runtime/workspaces";

export interface MigrationOutcome {
  workspace: string;
  repos: number;
}

export interface ApplyOutcome {
  ok: boolean;
  rehydrated: string[];
  restarted: number[];
  /** Workspaces actually migrated onto the new layout, with the repo count. */
  migrated: MigrationOutcome[];
  /**
   * Legacy workspaces NOT migrated this run (out of scope: not the current
   * workspace, and `--migrate-all` was not given). Named in the report with the
   * exact command — the justified exception, not the norm.
   */
  deferredLegacy: string[];
  failures: string[];
}

export interface ApplyOptions {
  /** The workspace the upgrade was invoked from — migrated autonomously. */
  currentWorkspace?: string;
  /** Migrate every known legacy workspace, not just the current one. */
  migrateAll?: boolean;
}

export interface MigrateResult {
  ok: boolean;
  /** How many repos were moved (0 when there was nothing to move). */
  repos: number;
  /** Captured subprocess output, surfaced verbatim when it failed. */
  output: string;
}

export interface ApplyDeps {
  workspaces: () => Promise<string[]>;
  serves: () => Promise<ServeEntry[]>;
  /** Runs a command to completion, capturing its combined output. */
  run: (cmd: string[]) => Promise<{ code: number; output: string }>;
  /** Migrates one workspace onto the new layout THROUGH the new binary. */
  migrate: (bin: string, workspace: string) => Promise<MigrateResult>;
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

/** Combined stdout+stderr, trimmed to the tail so a failure message stays short. */
async function captureRun(cmd: string[]): Promise<{ code: number; output: string }> {
  try {
    const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
    const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
    const code = await p.exited;
    const output = `${out}${err}`.trim();
    return { code, output };
  } catch (e) {
    return { code: 1, output: `could not run ${cmd[0]}: ${(e as Error)?.message ?? String(e)}` };
  }
}

/** Pure: parse the repo count from migrate-layout's `STATE` line. */
export function parseMigratedRepos(output: string): number {
  const m = /migrate-layout=(?:done|dry-run)\s*\((\d+)\s+repo/.exec(output);
  return m ? Number(m[1]) : 0;
}

const defaults: ApplyDeps = {
  workspaces: knownWorkspaces,
  serves: () => runningServes(),
  run: captureRun,
  migrate: async (bin, workspace) => {
    const { code, output } = await captureRun(migrateCommand(bin, workspace));
    return { ok: code === 0, repos: parseMigratedRepos(output), output };
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

/** Pure: the argv that migrates one workspace onto the new layout with `bin`. */
export function migrateCommand(bin: string, workspace: string): string[] {
  return [bin, "workspace", "migrate-layout", "--apply", "--workspace", workspace];
}

/**
 * Applies the just-installed version to everything on this machine that is
 * still carrying the old one.
 *
 * @param bin path to the installed binary — the work is driven THROUGH it, not
 *   through this process, so what runs is unambiguously the new version.
 */
export async function applyUpgrade(
  bin: string,
  opts: ApplyOptions = {},
  deps: Partial<ApplyDeps> = {},
): Promise<ApplyOutcome> {
  const d = { ...defaults, ...deps };
  const failures: string[] = [];
  const rehydrated: string[] = [];
  const restarted: number[] = [];
  const migrated: MigrationOutcome[] = [];

  const known = await d.workspaces().catch(() => [] as string[]);
  // The current workspace may not yet be in the registry (first run there), so
  // fold it in — it is the one we must not miss.
  const workspaces = [...known];
  if (opts.currentWorkspace && !workspaces.includes(opts.currentWorkspace)) {
    workspaces.unshift(opts.currentWorkspace);
  }

  // 1. Rehydrate every known workspace (safe, idempotent, and — since rehydrate
  //    now excludes `.claude/` — non-dirtying). Capture output so a failure says
  //    WHY, not just `exited 1`.
  const legacy: string[] = [];
  for (const ws of workspaces) {
    d.log(`  Rehydrating ${ws}…`);
    const { code, output } = await d.run(rehydrateCommand(bin, ws));
    if (code === 0) rehydrated.push(ws);
    else failures.push(`rehydrate ${ws}: exited ${code}${output ? ` — ${lastLine(output)}` : ""}`);
    if (await d.isLegacy(ws).catch(() => false)) legacy.push(ws);
  }

  // 2. Migrate the legacy workspaces in scope. Default: only the current one.
  //    The rest are deferred and named with the command — the justified
  //    exception, since migrating moves the PE's own checkouts.
  const targets = migrationTargets(legacy, opts);
  const deferredLegacy = legacy.filter((ws) => !targets.includes(ws));
  for (const ws of targets) {
    d.log(`  Migrating ${ws} onto the new layout…`);
    const result = await d.migrate(bin, ws);
    if (result.ok) {
      migrated.push({ workspace: ws, repos: result.repos });
    } else {
      failures.push(`migrate ${ws}: ${result.output ? lastLine(result.output) : "failed"}`);
    }
  }

  // 3. Restart the running consoles from the new binary.
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

  reportMigrations(d, migrated);
  reportDeferred(d, deferredLegacy);

  return { ok: failures.length === 0, rehydrated, restarted, migrated, deferredLegacy, failures };
}

/** Pure: which legacy workspaces this run migrates. */
export function migrationTargets(legacy: string[], opts: ApplyOptions): string[] {
  if (opts.migrateAll) return legacy;
  if (opts.currentWorkspace && legacy.includes(opts.currentWorkspace)) return [opts.currentWorkspace];
  return [];
}

/** The last non-empty line of captured output — the actionable part of a failure. */
function lastLine(output: string): string {
  const lines = output.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  return lines[lines.length - 1] ?? output.trim();
}

/** Say what was DONE — repos moved, layout migrated — not what is left. */
function reportMigrations(d: ApplyDeps, migrated: MigrationOutcome[]): void {
  for (const m of migrated) {
    const repos = m.repos === 1 ? "1 repo" : `${m.repos} repos`;
    d.log(
      m.repos > 0
        ? `  Migrated ${m.workspace} — ${repos} moved under repos/ and worktrees reconnected.`
        : `  ${m.workspace} was already on the new layout.`,
    );
  }
}

/** Name the legacy workspaces left out of scope, with the exact command. */
function reportDeferred(d: ApplyDeps, deferred: string[]): void {
  if (deferred.length === 0) return;
  const which = deferred.length === 1 ? deferred[0] : `${deferred.length} other workspaces`;
  d.log(`  ${which} still keeps its repos at the workspace root (not the one you upgraded from).`);
  for (const ws of deferred) {
    d.log(`    To migrate it: aipe workspace migrate-layout --apply --workspace ${ws}`);
  }
  d.log("    Or re-run the upgrade from inside it, or with --migrate-all.");
}
