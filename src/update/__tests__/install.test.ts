import { expect, test } from "bun:test";
import {
  BACKOFF_STEPS_MS,
  backupBinaryPath,
  checkBinaryVersionOutput,
  isInstalledBinary,
  isUpgradeLockActive,
  LOCK_TTL_MS,
  looksLikeExecutable,
  MIN_BINARY_BYTES,
  nextUpgradeFailure,
  parseUpgradeFailure,
  parseUpgradeLock,
  resolveUpgradeAsset,
  shouldAttemptUpgrade,
  tempBinaryPath,
  upgradeBackoffMs,
  verifyDownload,
} from "../install";

const BASE = "https://example.test/cli";
const NOW = 1_000_000_000_000;

test("resolveUpgradeAsset only names assets the release actually publishes", () => {
  expect(resolveUpgradeAsset("linux", "x64", BASE)).toEqual({
    asset: "aipe-linux-x64",
    url: `${BASE}/aipe-linux-x64`,
  });
  expect(resolveUpgradeAsset("linux", "arm64", BASE)?.asset).toBe("aipe-linux-arm64");
  expect(resolveUpgradeAsset("darwin", "arm64", BASE)?.asset).toBe("aipe-darwin-arm64");
  expect(resolveUpgradeAsset("win32", "x64", BASE)?.asset).toBe("aipe-windows-x64.exe");
});

test("resolveUpgradeAsset refuses combinations with no published binary", () => {
  // Downloading the x64 build onto one of these replaces a WORKING binary with
  // something the kernel cannot exec.
  expect(resolveUpgradeAsset("win32", "arm64", BASE)).toBeNull();
  expect(resolveUpgradeAsset("linux", "riscv64", BASE)).toBeNull();
  expect(resolveUpgradeAsset("freebsd", "x64", BASE)).toBeNull();
});

test("looksLikeExecutable matches the magic for each platform", () => {
  expect(looksLikeExecutable(new Uint8Array([0x7f, 0x45, 0x4c, 0x46]), "linux")).toBe(true);
  expect(looksLikeExecutable(new Uint8Array([0x4d, 0x5a, 0x90, 0x00]), "win32")).toBe(true);
  expect(looksLikeExecutable(new Uint8Array([0xcf, 0xfa, 0xed, 0xfe]), "darwin")).toBe(true);
  expect(looksLikeExecutable(new Uint8Array([0xca, 0xfe, 0xba, 0xbe]), "darwin")).toBe(true);
  // An HTML error page ("<!DO…") is the realistic wrong payload.
  expect(looksLikeExecutable(new Uint8Array([0x3c, 0x21, 0x44, 0x4f]), "linux")).toBe(false);
});

test("verifyDownload rejects a too-small payload before it can touch the disk", () => {
  const tiny = new Uint8Array([0x7f, 0x45, 0x4c, 0x46]);
  const r = verifyDownload(tiny, "linux");
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reason).toContain("4 bytes");
});

test("verifyDownload rejects a big payload that is not an executable", () => {
  const html = new Uint8Array(MIN_BINARY_BYTES + 1);
  html.set([0x3c, 0x21, 0x44, 0x4f]);
  const r = verifyDownload(html, "linux");
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reason).toContain("not an executable");
});

test("verifyDownload accepts a plausible binary", () => {
  const elf = new Uint8Array(MIN_BINARY_BYTES + 1);
  elf.set([0x7f, 0x45, 0x4c, 0x46]);
  expect(verifyDownload(elf, "linux")).toEqual({ ok: true });
});

test("checkBinaryVersionOutput accepts the expected version or newer, never older", () => {
  // The download URL points at `releases/latest`, which can legitimately be one
  // bump ahead of what the API listed a moment ago.
  expect(checkBinaryVersionOutput("1.2.0\n", "1.2.0")).toEqual({ ok: true, found: "1.2.0" });
  expect(checkBinaryVersionOutput("1.3.0\n", "1.2.0")).toEqual({ ok: true, found: "1.3.0" });
  expect(checkBinaryVersionOutput("1.1.0\n", "1.2.0")).toEqual({ ok: false, found: "1.1.0" });
  expect(checkBinaryVersionOutput("", "1.2.0")).toEqual({ ok: false, found: null });
  expect(checkBinaryVersionOutput("bash: aipe: not found", "1.2.0")).toEqual({ ok: false, found: null });
});

test("the staged file lands next to the target and keeps the extension", () => {
  // Same directory → same filesystem → the rename is atomic.
  expect(tempBinaryPath("/home/u/.local/bin/aipe", "abc")).toBe("/home/u/.local/bin/.aipe.new-abc");
  expect(tempBinaryPath("/c/aipe.exe", "abc")).toBe("/c/.aipe.new-abc.exe");
  expect(tempBinaryPath("/home/u/.local/bin/aipe", "a")).not.toBe(tempBinaryPath("/home/u/.local/bin/aipe", "b"));
  expect(backupBinaryPath("/home/u/.local/bin/aipe")).toBe("/home/u/.local/bin/aipe.bak");
});

test("isInstalledBinary refuses to self-install over a source checkout's runtime", () => {
  // From a checkout process.execPath IS bun — installing over it clobbers the
  // user's bun, not aipe.
  expect(isInstalledBinary("/home/u/.bun/bin/bun", "/home/u/aipe/src/cli.ts")).toBe(false);
  expect(isInstalledBinary("/home/u/.bun/bin/bun", undefined)).toBe(false);
  expect(isInstalledBinary("/usr/bin/node", undefined)).toBe(false);
  expect(isInstalledBinary("/home/u/.local/bin/aipe", "/$bunfs/root/aipe")).toBe(true);
  expect(isInstalledBinary("C:\\bin\\aipe.exe", undefined)).toBe(true);
});

test("failure backoff widens, and a new target version gets a fresh chance", () => {
  expect(upgradeBackoffMs(1)).toBe(BACKOFF_STEPS_MS[0]!);
  expect(upgradeBackoffMs(4)).toBe(BACKOFF_STEPS_MS[3]!);
  expect(upgradeBackoffMs(99)).toBe(BACKOFF_STEPS_MS[3]!); // capped
  expect(upgradeBackoffMs(0)).toBe(BACKOFF_STEPS_MS[0]!);

  const failed = { version: "1.2.0", failedAt: NOW, attempts: 1, reason: "boom" };
  expect(shouldAttemptUpgrade(failed, "1.2.0", NOW + 1)).toBe(false);
  expect(shouldAttemptUpgrade(failed, "1.2.0", NOW + BACKOFF_STEPS_MS[0]!)).toBe(true);
  // A newer release may well fix whatever failed.
  expect(shouldAttemptUpgrade(failed, "1.3.0", NOW + 1)).toBe(true);
  expect(shouldAttemptUpgrade(null, "1.2.0", NOW)).toBe(true);
});

test("consecutive failures only accumulate for the same target", () => {
  const first = nextUpgradeFailure(null, "1.2.0", NOW, "a");
  expect(first.attempts).toBe(1);
  expect(nextUpgradeFailure(first, "1.2.0", NOW, "b").attempts).toBe(2);
  expect(nextUpgradeFailure(first, "1.3.0", NOW, "b").attempts).toBe(1);
});

test("parseUpgradeFailure and parseUpgradeLock read junk as absent", () => {
  expect(parseUpgradeFailure("nope")).toBeNull();
  expect(parseUpgradeFailure('{"version":""}')).toBeNull();
  expect(parseUpgradeFailure('{"version":"1.2.0","failedAt":1}')).toEqual({
    version: "1.2.0",
    failedAt: 1,
    attempts: 1,
    reason: "",
  });
  expect(parseUpgradeLock("{")).toBeNull();
  expect(parseUpgradeLock('{"pid":0}')).toBeNull();
  expect(parseUpgradeLock('{"pid":42}')).toEqual({ pid: 42, version: "", startedAt: 0 });
});

test("a lock is held only while its process lives AND it is younger than the TTL", () => {
  const alive = () => true;
  const dead = () => false;
  const lock = { pid: 42, version: "1.2.0", startedAt: NOW };
  expect(isUpgradeLockActive(lock, NOW + 1, alive)).toBe(true);
  expect(isUpgradeLockActive(lock, NOW + 1, dead)).toBe(false); // crashed
  // A reused pid must not keep a forgotten lock alive forever.
  expect(isUpgradeLockActive(lock, NOW + LOCK_TTL_MS, alive)).toBe(false);
  expect(isUpgradeLockActive(null, NOW, alive)).toBe(false);
});
