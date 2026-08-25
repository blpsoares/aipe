// Self-install: replace the running `aipe` binary with the newest release.
//
// The old path was `curl -fsSL .../cli | sh`, and install.sh writes with
// `curl -o $HOME/.local/bin/aipe` — i.e. it truncates the very file the kernel
// is executing. That is exactly the `curl: (23) Failure writing output to
// destination` an upgrade reported: ETXTBSY, with the binary left half-written.
//
// The shape that works is stage → verify → back up → rename. A rename over a
// running executable is fine (the old inode stays mapped until the process
// exits) and it is atomic, so there is no window where `aipe` is a partial
// file. The binary is only ever replaced by one we have already RUN
// successfully, and the file it replaces is kept so any failure — including one
// that only shows up after the swap — can be undone.
import { randomBytes } from "node:crypto";
import { appendFileSync, closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { chmod, rename, rm, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { aipeStateDir, statePath } from "../runtime/state";
import { compareVersions } from "./check";

/** Where release binaries are fetched from (a Cloudflare redirect to the
 *  GitHub release assets). Override for a mirror or a local server. */
export function downloadBase(env: Record<string, string | undefined> = process.env): string {
  return env.AIPE_DOWNLOAD_BASE || "https://aipe.openvibes.tech/cli";
}

export interface UpgradeTarget {
  /** Release asset name, as published by scripts/build.ts. */
  asset: string;
  url: string;
}

/**
 * Pure: the asset for a platform/arch pair, or null when self-install is not
 * supported here. An allowlist of what the release workflow actually publishes
 * — downloading the linux-x64 ELF onto an arm64 box would replace a WORKING
 * binary with one the kernel cannot exec.
 */
export function resolveUpgradeAsset(platformId: string, arch: string, base: string = downloadBase()): UpgradeTarget | null {
  const os = platformId === "darwin" ? "darwin" : platformId === "win32" ? "windows" : platformId === "linux" ? "linux" : null;
  const cpu = arch === "arm64" ? "arm64" : arch === "x64" ? "x64" : null;
  if (!os || !cpu) return null;
  if (os === "windows" && cpu !== "x64") return null; // only windows-x64 is built
  const asset = `aipe-${os}-${cpu}${os === "windows" ? ".exe" : ""}`;
  return { asset, url: `${base}/${asset}` };
}

// ---------------------------------------------------------------------------
// Download verification
// ---------------------------------------------------------------------------

/** A compiled Bun binary is tens of MB; anything this small is an error page,
 *  a truncated transfer or a redirect stub — never a usable aipe. */
export const MIN_BINARY_BYTES = 4 * 1024 * 1024;

/** Pure: does the payload start with the executable magic for this platform? */
export function looksLikeExecutable(head: Uint8Array, platformId: string): boolean {
  if (platformId === "win32") return head[0] === 0x4d && head[1] === 0x5a; // "MZ"
  if (platformId === "darwin") {
    // Mach-O (0xfeedfacf / 0xcffaedfe) or a universal binary (0xcafebabe).
    const be = (head[0]! << 24) | (head[1]! << 16) | (head[2]! << 8) | head[3]!;
    const u = be >>> 0;
    return u === 0xfeedfacf || u === 0xcffaedfe || u === 0xfeedface || u === 0xcefaedfe || u === 0xcafebabe;
  }
  return head[0] === 0x7f && head[1] === 0x45 && head[2] === 0x4c && head[3] === 0x46; // 0x7F ELF
}

/** Pure: gate on the bytes BEFORE they can ever replace a working binary. */
export function verifyDownload(
  bytes: Uint8Array,
  platformId: string,
  minBytes: number = MIN_BINARY_BYTES,
): { ok: true } | { ok: false; reason: string } {
  if (bytes.length < minBytes) {
    return { ok: false, reason: `downloaded file is only ${bytes.length} bytes (expected > ${minBytes})` };
  }
  if (!looksLikeExecutable(bytes.subarray(0, 4), platformId)) {
    return { ok: false, reason: `downloaded file is not an executable for ${platformId}` };
  }
  return { ok: true };
}

/**
 * Pure: does `aipe --version` output prove this binary is the release we expect?
 *
 * `>=` rather than `===`: the download URL points at `releases/latest`, which
 * can legitimately be one bump ahead of the newest version the releases API
 * listed a moment ago. An OLDER (or unparseable) version means we downloaded
 * the wrong thing and must not install it.
 */
export function checkBinaryVersionOutput(out: string, expected: string): { ok: boolean; found: string | null } {
  const m = out.match(/(\d+\.\d+\.\d+)/);
  const found = m?.[1] ?? null;
  return { ok: !!found && compareVersions(found, expected) >= 0, found };
}

/**
 * Pure: unique temp path NEXT TO the target — same filesystem, so the rename is
 * atomic — keeping the extension so Windows can still exec it. Unique per
 * attempt so a hand-run upgrade and a background one can never share a file.
 */
export function tempBinaryPath(currentBin: string, unique: string): string {
  const dir = dirname(currentBin);
  const base = basename(currentBin);
  const dot = base.lastIndexOf(".");
  const ext = dot > 0 ? base.slice(dot) : "";
  const stem = dot > 0 ? base.slice(0, dot) : base;
  return join(dir, `.${stem}.new-${unique}${ext}`);
}

/** Pure: where the replaced binary is kept so a failed install can be rolled back. */
export function backupBinaryPath(currentBin: string): string {
  return `${currentBin}.bak`;
}

/**
 * Pure: is this process the installed `aipe` binary (as opposed to
 * `bun src/cli.ts` in a checkout)? The install replaces process.execPath — from
 * a checkout that path is the BUN RUNTIME, and installing over it would clobber
 * the user's bun.
 */
export function isInstalledBinary(execPath: string, scriptPath: string | undefined): boolean {
  if (scriptPath && (scriptPath.endsWith(".ts") || scriptPath.endsWith(".js"))) return false;
  const base = (execPath.split(/[\\/]/).pop() ?? "").replace(/\.exe$/i, "");
  return base !== "bun" && base !== "node";
}

// ---------------------------------------------------------------------------
// Failure memory + backoff
//
// An upgrade that can never succeed here (no write permission, a 404 asset, a
// full disk) would otherwise re-download the whole binary on every shell that
// opens, forever. Failures are persisted with a counter and retried on a
// widening schedule; a success — or a NEW target version — clears the state.
// ---------------------------------------------------------------------------

export function failurePath(): string {
  return statePath("upgrade-failure.json");
}

/** Backoff per consecutive failure: 30min → 2h → 8h → 24h (capped). */
export const BACKOFF_STEPS_MS = [30 * 60_000, 2 * 60 * 60_000, 8 * 60 * 60_000, 24 * 60 * 60_000];

export interface UpgradeFailure {
  version: string;
  failedAt: number;
  attempts: number;
  reason: string;
}

/** Pure: how long to wait after `attempts` consecutive failures. */
export function upgradeBackoffMs(attempts: number): number {
  const idx = Math.min(Math.max(attempts, 1), BACKOFF_STEPS_MS.length) - 1;
  return BACKOFF_STEPS_MS[idx]!;
}

/** Pure: parse the persisted failure state. Junk → null ("no failures"). */
export function parseUpgradeFailure(raw: string): UpgradeFailure | null {
  try {
    const o = JSON.parse(raw) as Partial<UpgradeFailure>;
    if (!o || typeof o.version !== "string" || !o.version) return null;
    if (typeof o.failedAt !== "number" || !Number.isFinite(o.failedAt)) return null;
    const attempts =
      typeof o.attempts === "number" && Number.isFinite(o.attempts) && o.attempts > 0 ? Math.floor(o.attempts) : 1;
    return { version: o.version, failedAt: o.failedAt, attempts, reason: typeof o.reason === "string" ? o.reason : "" };
  } catch {
    return null;
  }
}

/** Pure: next state after a failure — consecutive only while the target is the same. */
export function nextUpgradeFailure(
  prev: UpgradeFailure | null,
  version: string,
  now: number,
  reason: string,
): UpgradeFailure {
  const attempts = prev && prev.version === version ? prev.attempts + 1 : 1;
  return { version, failedAt: now, attempts, reason };
}

/**
 * Pure: may an UNATTENDED upgrade to `version` run now? A different target
 * always gets a fresh chance (the new release may well fix what failed). A
 * hand-run `aipe upgrade` never consults this — the user asked explicitly.
 */
export function shouldAttemptUpgrade(state: UpgradeFailure | null, version: string, now: number): boolean {
  if (!state || state.version !== version) return true;
  return now - state.failedAt >= upgradeBackoffMs(state.attempts);
}

export function readUpgradeFailure(): UpgradeFailure | null {
  try {
    return parseUpgradeFailure(readFileSync(failurePath(), "utf8"));
  } catch {
    return null;
  }
}

export function recordUpgradeFailure(version: string, reason: string): void {
  try {
    mkdirSync(aipeStateDir(), { recursive: true });
    writeFileSync(failurePath(), JSON.stringify(nextUpgradeFailure(readUpgradeFailure(), version, Date.now(), reason)));
  } catch {
    // best-effort
  }
}

export function clearUpgradeFailure(): void {
  try {
    unlinkSync(failurePath());
  } catch {
    // nothing recorded
  }
}

// ---------------------------------------------------------------------------
// Concurrency lock
// ---------------------------------------------------------------------------

export function lockPath(): string {
  return statePath("upgrade.lock");
}

/** Where the detached (unattended) upgrade's output goes. */
export function autoUpgradeLogPath(): string {
  return statePath("auto-upgrade.log");
}

/** A lock older than this is treated as abandoned (crash, kill -9, pid reuse). */
export const LOCK_TTL_MS = 30 * 60 * 1000;
/** Set on the detached child so it ADOPTS the lock its spawner already took. */
export const LOCK_ENV = "AIPE_UPGRADE_LOCK";

export interface UpgradeLock {
  pid: number;
  version: string;
  startedAt: number;
}

/** Pure: parse a lock file. Junk/truncated → null. */
export function parseUpgradeLock(raw: string): UpgradeLock | null {
  try {
    const o = JSON.parse(raw) as Partial<UpgradeLock>;
    if (!o || typeof o.pid !== "number" || !Number.isFinite(o.pid) || o.pid <= 0) return null;
    return {
      pid: o.pid,
      version: typeof o.version === "string" ? o.version : "",
      startedAt: typeof o.startedAt === "number" && Number.isFinite(o.startedAt) ? o.startedAt : 0,
    };
  } catch {
    return null;
  }
}

/**
 * Pure: is an existing lock still held? Only while its process is alive AND it
 * is younger than the TTL — so a crashed upgrade can never wedge the mechanism
 * permanently, and a reused pid cannot keep it alive forever either.
 */
export function isUpgradeLockActive(
  lock: UpgradeLock | null,
  now: number,
  isPidAlive: (pid: number) => boolean,
  ttlMs: number = LOCK_TTL_MS,
): boolean {
  if (!lock) return false;
  if (now - lock.startedAt >= ttlMs) return false;
  return isPidAlive(lock.pid);
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    return (err as { code?: string })?.code === "EPERM";
  }
}

const lockPayload = (pid: number, version: string) => JSON.stringify({ pid, version, startedAt: Date.now() });

export type LockResult = { state: "acquired" | "adopted" | "unavailable" } | { state: "busy"; pid: number };

/**
 * Takes the upgrade lock for THIS process. Created with the exclusive `wx` flag
 * (atomic), so of two racing processes exactly one wins; a stale lock is taken
 * over. `unavailable` means the lock file itself could not be written (a
 * read-only HOME): the caller proceeds unlocked rather than never upgrading.
 */
export function acquireUpgradeLock(version: string, adopt: boolean): LockResult {
  try {
    mkdirSync(aipeStateDir(), { recursive: true });
    if (adopt) {
      writeFileSync(lockPath(), lockPayload(process.pid, version));
      return { state: "adopted" };
    }
    try {
      writeFileSync(lockPath(), lockPayload(process.pid, version), { flag: "wx" });
      return { state: "acquired" };
    } catch (err: unknown) {
      if ((err as { code?: string })?.code !== "EEXIST") return { state: "unavailable" };
      let existing: UpgradeLock | null = null;
      try {
        existing = parseUpgradeLock(readFileSync(lockPath(), "utf8"));
      } catch {
        existing = null; // unreadable → stale
      }
      if (isUpgradeLockActive(existing, Date.now(), pidAlive)) return { state: "busy", pid: existing!.pid };
      writeFileSync(lockPath(), lockPayload(process.pid, version));
      return { state: "acquired" };
    }
  } catch {
    return { state: "unavailable" };
  }
}

/** Re-stamps the held lock with the version we resolved (informational). */
export function stampUpgradeLock(version: string): void {
  try {
    writeFileSync(lockPath(), lockPayload(process.pid, version));
  } catch {
    // best-effort
  }
}

/** Releases the lock on exit when THIS process owns it. */
export function armUpgradeLockRelease(): void {
  process.on("exit", () => {
    try {
      const lock = parseUpgradeLock(readFileSync(lockPath(), "utf8"));
      if (lock?.pid === process.pid) unlinkSync(lockPath());
    } catch {
      // no lock, or already gone
    }
  });
}

// ---------------------------------------------------------------------------
// The install itself
// ---------------------------------------------------------------------------

/**
 * Runs `<bin> --version` and returns its stdout ("" when it can't run). Killed
 * after `timeoutMs` so a hung or incompatible binary cannot wedge the upgrade.
 * AIPE_NO_UPDATE_CHECK keeps the probe offline — `aipe --version` would
 * otherwise do a GitHub round-trip on the install's critical path.
 */
export async function probeBinaryVersion(bin: string, timeoutMs = 20_000): Promise<string> {
  try {
    const p = Bun.spawn([bin, "--version"], {
      stdout: "pipe",
      stderr: "ignore",
      env: { ...process.env, AIPE_NO_UPDATE_CHECK: "1" },
    });
    const timer = setTimeout(() => {
      try {
        p.kill();
      } catch {
        // already gone
      }
    }, timeoutMs);
    const out = await new Response(p.stdout).text();
    const code = await p.exited;
    clearTimeout(timer);
    return code === 0 ? out : "";
  } catch {
    return "";
  }
}

export interface InstallOutcome {
  ok: boolean;
  /** Machine-readable failure cause, recorded for the backoff state. */
  reason?: string;
  /** Set when the failure was a permission problem — the verified download is
   *  left here so the user can finish with a single `sudo mv`. */
  keptTmp?: string;
  /** Set when the previous binary was restored after a failed install. */
  rolledBack?: boolean;
  /** Where the replaced binary was kept on success. */
  backup?: string;
}

/** Verify → stage → back up → swap → re-verify. */
export async function installDownloadedBinary(
  bytes: Uint8Array,
  currentBin: string,
  expected: string,
  log: (line: string) => void = console.log,
): Promise<InstallOutcome> {
  // 1) The bytes must look like an executable for THIS platform before they
  //    ever touch the disk.
  const verified = verifyDownload(bytes, process.platform);
  if (!verified.ok) return { ok: false, reason: verified.reason };

  // 2) Stage next to the target, under a name nobody else can pick.
  const tmpPath = tempBinaryPath(currentBin, `${process.pid}-${randomBytes(6).toString("hex")}`);
  try {
    await Bun.write(tmpPath, bytes);
    if (process.platform !== "win32") await chmod(tmpPath, 0o755);
  } catch (err: unknown) {
    await unlink(tmpPath).catch(() => {});
    return { ok: false, reason: `could not write ${tmpPath}: ${(err as Error)?.message ?? String(err)}` };
  }

  // 3) The strongest cheap check there is: run it and make it identify itself.
  log("Verifying the downloaded binary…");
  const probe = checkBinaryVersionOutput(await probeBinaryVersion(tmpPath), expected);
  if (!probe.ok) {
    await unlink(tmpPath).catch(() => {});
    return {
      ok: false,
      reason: probe.found
        ? `downloaded binary reports ${probe.found}, expected ${expected}`
        : "downloaded binary did not run (`--version` produced nothing usable)",
    };
  }

  // 4) Move the working binary aside FIRST — that is the rollback copy, and on
  //    Windows it is also the only way to replace a running executable.
  const backup = backupBinaryPath(currentBin);
  try {
    await rm(backup, { force: true });
    await rename(currentBin, backup);
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code === "EACCES" || code === "EPERM") return { ok: false, reason: "permission denied", keptTmp: tmpPath };
    await unlink(tmpPath).catch(() => {});
    return { ok: false, reason: `could not back up the current binary: ${(err as Error)?.message ?? String(err)}` };
  }

  // 5) Swap in the verified file; anything going wrong here restores the backup.
  try {
    await rename(tmpPath, currentBin);
  } catch (err: unknown) {
    await rename(backup, currentBin).catch(() => {});
    await unlink(tmpPath).catch(() => {});
    return {
      ok: false,
      reason: `could not install the new binary: ${(err as Error)?.message ?? String(err)}`,
      rolledBack: true,
    };
  }

  // 6) Post-install check at the FINAL path — permissions, ACLs and `noexec`
  //    can all differ from the temp name.
  const after = checkBinaryVersionOutput(await probeBinaryVersion(currentBin), expected);
  if (!after.ok) {
    await rm(currentBin, { force: true }).catch(() => {});
    await rename(backup, currentBin).catch(() => {});
    return { ok: false, reason: "the installed binary failed its post-install check", rolledBack: true };
  }

  return { ok: true, backup };
}

/** Downloads the asset. Returns the bytes, or a reason it could not. */
export async function downloadAsset(
  target: UpgradeTarget,
  current: string,
): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; reason: string }> {
  let resp: Response;
  try {
    resp = await fetch(target.url, {
      headers: { "User-Agent": `aipe/${current}` },
      signal: AbortSignal.timeout(180_000),
    });
  } catch (err: unknown) {
    return { ok: false, reason: `download failed: ${(err as Error)?.message ?? String(err)}` };
  }
  if (!resp.ok) return { ok: false, reason: `download failed: HTTP ${resp.status}` };
  // Reading the body is guarded too, not just the fetch: the transfer is tens of
  // MB, so a timeout firing mid-stream (or a reset connection) is the single
  // most likely failure of the whole command.
  try {
    return { ok: true, bytes: new Uint8Array(await resp.arrayBuffer()) };
  } catch (err: unknown) {
    return { ok: false, reason: `download interrupted: ${(err as Error)?.message ?? String(err)}` };
  }
}

export type BackgroundUpgradeResult = "started" | "in-progress" | "not-installed" | "unsupported" | "backoff" | "failed";

/**
 * Starts `aipe upgrade` DETACHED and returns immediately — the caller's
 * terminal is never held. Output is appended to the auto-upgrade log. Refuses,
 * without downloading anything, when self-install is unsupported here or when
 * the same version already failed recently.
 */
export async function startBackgroundUpgrade(version: string): Promise<BackgroundUpgradeResult> {
  if (!isInstalledBinary(process.execPath, process.argv[1])) return "not-installed";
  if (!resolveUpgradeAsset(process.platform, process.arch)) return "unsupported";
  if (!shouldAttemptUpgrade(readUpgradeFailure(), version, Date.now())) return "backoff";

  const lock = acquireUpgradeLock(version, false);
  if (lock.state === "busy") return "in-progress";
  if (lock.state === "unavailable") return "failed";

  try {
    mkdirSync(aipeStateDir(), { recursive: true });
    const logFile = autoUpgradeLogPath();
    appendFileSync(logFile, `\n=== ${new Date().toISOString()} — auto-installing ${version} ===\n`);
    const fd = openSync(logFile, "a");
    const { spawn } = await import("node:child_process");
    const child = spawn(process.execPath, ["upgrade"], {
      detached: true,
      stdio: ["ignore", fd, fd],
      env: { ...process.env, [LOCK_ENV]: "1" },
    });
    child.unref();
    try {
      closeSync(fd);
    } catch {
      // the child kept its own dup
    }
    // Re-stamp the lock with the pid that actually does the work.
    if (child.pid) writeFileSync(lockPath(), lockPayload(child.pid, version));
    return "started";
  } catch {
    try {
      unlinkSync(lockPath());
    } catch {
      // nothing to release
    }
    return "failed";
  }
}
