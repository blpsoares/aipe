#!/usr/bin/env bun
// `aipe check-update` and `aipe upgrade`.
//
// check-update is the shell-hook shape: silent when up to date, answers from
// the shared on-disk cache and refreshes it in a DETACHED process, so it can
// never delay a prompt on a slow or dead network.
//
// upgrade is the whole job: download → verify → back up → swap → rehydrate every
// known workspace → restart every running web console. Its exit code is 0 only
// when all of that actually happened.
import { VERSION } from "../cli";
import { applyUpgrade } from "./apply";
import { AM, B, criticalInstallingBanner, criticalManualBanner, D, GR, R, RD, WH, Y, updateBanner } from "./banner";
import {
  autoUpgradeAllowed,
  cachedInfo,
  checkForUpdate,
  RELEASES_PAGE,
  readUpdateCache,
  shouldRefreshCache,
} from "./check";
import {
  acquireUpgradeLock,
  armUpgradeLockRelease,
  autoUpgradeLogPath,
  backupBinaryPath,
  clearUpgradeFailure,
  downloadAsset,
  installDownloadedBinary,
  isInstalledBinary,
  LOCK_ENV,
  recordUpgradeFailure,
  resolveUpgradeAsset,
  stampUpgradeLock,
  startBackgroundUpgrade,
} from "./install";
import { runInstall } from "./run";
import { enclosingWorkspace } from "../runtime/workspaces";

/** True when update checks are suppressed (hooks, CI, the install's own probe). */
export function updateChecksDisabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.AIPE_NO_UPDATE_CHECK === "1" || !!env.AIPE_NO_UPDATE_CHECK;
}

/**
 * Refreshes the shared cache in a DETACHED process and returns immediately.
 * This is what keeps the terminal hook off the network.
 */
export function spawnCacheRefresh(): void {
  try {
    const script = process.argv[1];
    const fromSource = !!script && (script.endsWith(".ts") || script.endsWith(".js"));
    const argv = fromSource ? [script, "check-update", "--refresh"] : ["check-update", "--refresh"];
    const child = Bun.spawn([process.execPath, ...argv], {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
      detached: true,
    });
    child.unref();
  } catch {
    // Can't spawn — the next shell simply tries again.
  }
}

export async function checkUpdate(args: string[]): Promise<number> {
  if (updateChecksDisabled() && !args.includes("--refresh")) return 0;
  try {
    // Hidden: the detached refresh. Does the blocking network call, writes the
    // shared cache, prints nothing. Never spawns anything itself.
    if (args.includes("--refresh")) {
      await checkForUpdate(VERSION, { force: true });
      return 0;
    }

    // --now is the explicit "check the network right now" the user can type.
    if (args.includes("--now")) {
      const fresh = await checkForUpdate(VERSION, { force: true });
      if (fresh.hasUpdate) process.stdout.write(updateBanner(fresh));
      else console.log(`aipe is up to date (${fresh.current}).`);
      return 0;
    }

    const cache = await readUpdateCache();
    if (shouldRefreshCache(cache, Date.now(), VERSION)) spawnCacheRefresh();

    const info = cachedInfo(cache, VERSION);
    // No usable answer yet (first run, or a cache that predates this version) →
    // stay silent; the refresh just spawned will have one for the next shell.
    if (!info || !info.hasUpdate) {
      if (args.includes("--verbose")) console.log(`aipe is up to date (${VERSION}).`);
      return 0;
    }

    if (info.critical && autoUpgradeAllowed()) {
      const started = await startBackgroundUpgrade(info.latest);
      if (started === "started") process.stdout.write(criticalInstallingBanner(info, autoUpgradeLogPath()));
      else if (started === "in-progress") process.stdout.write(`\n  ${D}An aipe upgrade is already running.${R}\n\n`);
      else if (started === "unsupported") {
        process.stdout.write(
          criticalManualBanner(
            info,
            `No release binary for ${process.platform}/${process.arch} — install it from ${RELEASES_PAGE}`,
          ),
        );
      } else if (started === "backoff") {
        process.stdout.write(`\n  ${D}The last upgrade to ${info.latest} failed; retrying later.${R}\n\n`);
      } else {
        // 'failed' (couldn't spawn) or 'not-installed' (a source checkout) →
        // fall back to asking the user.
        process.stdout.write(updateBanner(info));
      }
    } else if (info.critical) {
      process.stdout.write(criticalManualBanner(info, `Run ${AM}${B}aipe upgrade${R} now.`));
    } else {
      process.stdout.write(updateBanner(info));
    }
    return 0;
  } catch {
    return 0; // never fail a shell startup on a check
  }
}

/**
 * `aipe upgrade`. Returns a process exit code — 0 only when the new binary is
 * installed, verified AND everything on the machine was moved onto it.
 */
export async function upgrade(args: string[]): Promise<number> {
  const force = args.includes("--force");
  const skipApply = args.includes("--no-apply");

  // From a source checkout process.execPath is the BUN RUNTIME; installing over
  // it would clobber the user's bun. Fall back to the installer script, which
  // writes to ~/.local/bin and leaves the checkout alone.
  if (!isInstalledBinary(process.execPath, process.argv[1])) {
    console.log(`Running from a source checkout (${process.execPath}) — using the installer instead.`);
    return runInstall();
  }

  // The lock covers the WHOLE upgrade, not just the spawn: two installs writing
  // the binary at once is exactly the interleaving that corrupts it.
  const lock = acquireUpgradeLock("", process.env[LOCK_ENV] === "1");
  if (lock.state === "busy") {
    console.log(`An aipe upgrade is already running (pid ${lock.pid}).`);
    return 0;
  }
  if (lock.state === "unavailable") console.log(`${Y}Could not take the upgrade lock — continuing unlocked.${R}`);
  else armUpgradeLockRelease();

  console.log("Checking for updates…");
  const info = await checkForUpdate(VERSION, { force: true });

  if (!info.hasUpdate && !force) {
    console.log(`aipe is already up to date (${GR}${B}${info.current}${R}).`);
    clearUpgradeFailure();
    return 0;
  }
  const targetVersion = info.hasUpdate ? info.latest : info.current;
  stampUpgradeLock(targetVersion);

  // Platform/arch gate — refuse BEFORE downloading anything.
  const target = resolveUpgradeAsset(process.platform, process.arch);
  if (!target) {
    const id = `${process.platform}/${process.arch}`;
    console.log(`${Y}${B}No aipe release binary is published for ${id}.${R}`);
    console.log(`  Grab one manually from ${RELEASES_PAGE}`);
    recordUpgradeFailure(targetVersion, `unsupported platform ${id}`);
    return 1;
  }

  console.log(`  ${D}Current:${R} ${WH}${info.current}${R}`);
  console.log(`  ${D}Latest: ${R} ${GR}${B}${info.latest}${R}`);
  console.log(`Downloading ${target.asset}…`);

  const downloaded = await downloadAsset(target, VERSION);
  if (!downloaded.ok) {
    console.log(`${RD}${downloaded.reason}${R}`);
    recordUpgradeFailure(targetVersion, downloaded.reason);
    return 1;
  }

  const currentBin = process.execPath;
  const installed = await installDownloadedBinary(downloaded.bytes, currentBin, targetVersion);

  if (!installed.ok) {
    if (installed.keptTmp) {
      console.log(`\n${Y}Permission denied.${R} The binary was downloaded and verified at:`);
      console.log(`  ${installed.keptTmp}\n`);
      console.log("Finish the upgrade with:");
      console.log(`  ${WH}sudo mv ${installed.keptTmp} ${currentBin}${R}\n`);
    } else {
      console.log(`\n${RD}Upgrade failed: ${installed.reason ?? "unknown error"}${R}`);
      if (installed.rolledBack) console.log(`  The previous binary was restored from ${backupBinaryPath(currentBin)}.`);
      else console.log("  Your existing aipe was left untouched.");
    }
    recordUpgradeFailure(targetVersion, installed.reason ?? "install failed");
    return 1;
  }

  clearUpgradeFailure();
  console.log(`\n${GR}${B}Installed aipe ${targetVersion}.${R}`);
  console.log(`${D}The previous binary is kept at ${installed.backup ?? backupBinaryPath(currentBin)}.${R}\n`);

  if (skipApply) {
    console.log("Skipped applying it (--no-apply). Run `aipe rehydrate` in each workspace yourself.");
    return 0;
  }

  console.log("Applying the update…");
  // Default migration scope = the workspace this upgrade was invoked from (safe,
  // non-interactive). `--migrate-all` reaches every known legacy workspace.
  const currentWorkspace = enclosingWorkspace(process.cwd());
  const migrateAll = args.includes("--migrate-all");
  const applied = await applyUpgrade(currentBin, { currentWorkspace, migrateAll }).catch((err) => ({
    ok: false,
    rehydrated: [] as string[],
    restarted: [] as number[],
    migrated: [] as { workspace: string; repos: number }[],
    deferredLegacy: [] as string[],
    failures: [`unexpected error: ${err?.message ?? String(err)}`],
  }));

  if (!applied.ok) {
    // The binary IS installed — but claiming "done, now running X" while a
    // workspace or a server still carries the old version is the lie that hides
    // a half-applied upgrade.
    console.log(`\n${Y}${B}aipe ${targetVersion} is installed, but not everything was moved onto it:${R}`);
    for (const f of applied.failures) console.log(`    • ${f}`);
    console.log("  Fix the above, then re-run `aipe upgrade --force`.\n");
    return 1;
  }

  const reposMoved = applied.migrated.reduce((n, m) => n + m.repos, 0);
  const bits = [
    `${applied.rehydrated.length} workspace${applied.rehydrated.length === 1 ? "" : "s"} rehydrated`,
    ...(reposMoved > 0 ? [`${reposMoved} repo${reposMoved === 1 ? "" : "s"} migrated`] : []),
    `${applied.restarted.length} web console${applied.restarted.length === 1 ? "" : "s"} restarted`,
  ];
  console.log(`\n${GR}${B}Done — now running aipe ${targetVersion}.${R} ${D}(${bits.join(", ")})${R}\n`);
  return 0;
}

if (import.meta.main) {
  checkUpdate(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch(() => process.exit(0)); // never fail a shell startup on a check
}
