import { expect, test } from "bun:test";
import {
  CACHE_TTL_MS,
  cachedInfo,
  isCacheFresh,
  isCriticalRelease,
  NEGATIVE_TTL_MS,
  parseCache,
  resolveLatestRelease,
  RETRY_MS,
  shouldRefreshCache,
  ttlFor,
  autoUpgradeAllowed,
} from "../check";

const NOW = 1_000_000_000_000;

test("resolveLatestRelease ignores drafts, prereleases and non-semver tags", () => {
  const info = resolveLatestRelease(
    [
      { tag_name: "v1.0.0" },
      { tag_name: "latest" },
      { tag_name: "v2.0.0", prerelease: true },
      { tag_name: "v1.4.0" },
      { tag_name: "v1.9.9", draft: true },
    ],
    "1.0.0",
  );
  expect(info.latest).toBe("1.4.0");
  expect(info.hasUpdate).toBe(true);
  expect(info.critical).toBe(false);
});

test("resolveLatestRelease reports no update when the installed version is the newest", () => {
  const info = resolveLatestRelease([{ tag_name: "v1.4.0" }], "1.4.0");
  expect(info.hasUpdate).toBe(false);
  expect(info.latest).toBe("1.4.0");
});

test("critical is taken from EVERY newer release, not just the newest", () => {
  // 1.1.0 is the urgent one; 1.2.0 shipped after it and is ordinary. Looking at
  // the newest release alone would miss the fix the user actually needs.
  const info = resolveLatestRelease(
    [
      { tag_name: "v1.2.0", body: "routine" },
      { tag_name: "v1.1.0", body: "fixes a data loss\n\n[critical]\n" },
    ],
    "1.0.0",
  );
  expect(info.latest).toBe("1.2.0");
  expect(info.critical).toBe(true);
});

test("a critical release older than the installed version does not count", () => {
  const info = resolveLatestRelease(
    [{ tag_name: "v1.2.0", body: "routine" }, { tag_name: "v0.9.0", body: "[critical]" }],
    "1.0.0",
  );
  expect(info.critical).toBe(false);
});

test("isCriticalRelease needs the marker on its own line, outside code fences", () => {
  expect(isCriticalRelease("[critical]")).toBe(true);
  expect(isCriticalRelease("intro\n  [CRITICAL]  \nmore")).toBe(true);
  expect(isCriticalRelease("fixes a critical bug in the parser")).toBe(false);
  expect(isCriticalRelease("[critical] only when X is set")).toBe(false);
  // Release notes that DOCUMENT the mechanism must not flag themselves.
  expect(isCriticalRelease("mark it critical with:\n```\n[critical]\n```")).toBe(false);
  expect(isCriticalRelease("~~~\n[critical]\n~~~")).toBe(false);
  expect(isCriticalRelease("    [critical]")).toBe(false); // indented = code block
  expect(isCriticalRelease(null)).toBe(false);
});

test("a negative verdict expires far sooner than a positive one", () => {
  // The asymmetry is the point: a stale "up to date" is the machine silently
  // hiding a release, a stale "update available" is harmless.
  expect(ttlFor({ hasUpdate: true })).toBe(CACHE_TTL_MS);
  expect(ttlFor({ hasUpdate: false })).toBe(NEGATIVE_TTL_MS);
  expect(NEGATIVE_TTL_MS).toBeLessThan(CACHE_TTL_MS);

  const upToDate = { current: "1.0.0", latest: "1.0.0", hasUpdate: false, checkedAt: NOW };
  expect(isCacheFresh(upToDate, NOW + NEGATIVE_TTL_MS - 1, "1.0.0")).toBe(true);
  expect(isCacheFresh(upToDate, NOW + NEGATIVE_TTL_MS + 1, "1.0.0")).toBe(false);

  const stale = { current: "1.0.0", latest: "1.2.0", hasUpdate: true, checkedAt: NOW };
  expect(isCacheFresh(stale, NOW + NEGATIVE_TTL_MS + 1, "1.0.0")).toBe(true);
  expect(isCacheFresh(stale, NOW + CACHE_TTL_MS + 1, "1.0.0")).toBe(false);
});

test("a verdict computed for another installed version is never reused", () => {
  const entry = { current: "1.0.0", latest: "1.2.0", hasUpdate: true, checkedAt: NOW };
  expect(cachedInfo(entry, "1.2.0")).toBeNull();
  expect(isCacheFresh(entry, NOW + 1, "1.2.0")).toBe(false);
  expect(shouldRefreshCache(entry, NOW + 1, "1.2.0")).toBe(true);
});

test("cachedInfo recomputes hasUpdate against the version asked about", () => {
  const entry = { current: "1.0.0", latest: "1.2.0", hasUpdate: true, critical: true, checkedAt: NOW };
  expect(cachedInfo(entry, "1.0.0")).toEqual({ current: "1.0.0", latest: "1.2.0", hasUpdate: true, critical: true });
  expect(cachedInfo({}, "1.0.0")).toBeNull();
  expect(cachedInfo({ latest: "1.2.0", checkedAt: 0 }, "1.0.0")).toBeNull();
});

test("refresh attempts are spaced even when the entry is stale", () => {
  // 20 shells opening at once, or an offline machine, must not become 20 calls.
  const entry = { current: "1.0.0", latest: "1.0.0", hasUpdate: false, checkedAt: NOW, attemptedAt: NOW };
  const wayPastTtl = NOW + CACHE_TTL_MS * 2;
  expect(shouldRefreshCache(entry, NOW + RETRY_MS - 1, "1.0.0")).toBe(false);
  expect(shouldRefreshCache({ ...entry, attemptedAt: wayPastTtl - 1 }, wayPastTtl, "1.0.0")).toBe(false);
  expect(shouldRefreshCache(entry, wayPastTtl, "1.0.0")).toBe(true);
});

test("an empty cache always wants a refresh", () => {
  expect(shouldRefreshCache({}, NOW, "1.0.0")).toBe(true);
});

test("parseCache tolerates junk", () => {
  expect(parseCache("not json")).toEqual({});
  expect(parseCache("null")).toEqual({});
  expect(parseCache('{"latest":"1.2.0"}')).toEqual({ latest: "1.2.0" });
});

test("unattended install stays opt-in", () => {
  expect(autoUpgradeAllowed({})).toBe(false);
  expect(autoUpgradeAllowed({ AIPE_AUTO_UPGRADE: "0" })).toBe(false);
  expect(autoUpgradeAllowed({ AIPE_AUTO_UPGRADE: "1" })).toBe(true);
});
