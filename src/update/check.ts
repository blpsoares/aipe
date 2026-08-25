import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const GITHUB_REPO = "blpsoares/aipe";
export const INSTALL_CMD = "curl -fsSL https://aipe.openvibes.tech/cli | sh";
export const RELEASES_PAGE = `https://github.com/${GITHUB_REPO}/releases`;
const SEMVER_RE = /^\d+\.\d+\.\d+$/;

/**
 * How long a verdict stays authoritative.
 *
 * The two verdicts are NOT equally safe to cache, which is why there are two
 * numbers. A stale `hasUpdate: true` costs nothing — the release it names still
 * exists and the banner keeps saying the same true thing, and it clears itself
 * the moment the user upgrades. A stale `hasUpdate: false` is the opposite: the
 * machine actively telling someone they are current while a release sits there,
 * and it does it SILENTLY, so "checked, nothing new" and "never checked" look
 * identical. So a negative answer expires much sooner.
 */
export const CACHE_TTL_MS = 3 * 60 * 60 * 1000; // 3h — a known update
export const NEGATIVE_TTL_MS = 30 * 60 * 1000; // 30min — "you are up to date"
/** Minimum spacing between refresh ATTEMPTS: 20 shells opening at once (or an
 *  offline machine) must not become 20 GitHub calls. */
export const RETRY_MS = 15 * 60 * 1000;

/** A GitHub release tag → bare semver ("v1.2.3" → "1.2.3"), or null if not semver. */
export function toSemver(tag: string): string | null {
  const v = tag.replace(/^v/, "").trim();
  return SEMVER_RE.test(v) ? v : null;
}

/** Numeric semver compare: positive if a > b, negative if a < b, 0 if equal. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export interface Release {
  tag_name: string;
  body?: string | null;
  draft?: boolean;
  prerelease?: boolean;
}

/** Highest semver among non-draft, non-prerelease releases, or null. */
export function pickLatestSemver(releases: Release[]): string | null {
  return (
    releases
      .filter((r) => !r.draft && !r.prerelease)
      .map((r) => toSemver(r.tag_name))
      .filter((v): v is string => v !== null)
      .sort((a, b) => compareVersions(b, a))[0] ?? null
  );
}

// ---------------------------------------------------------------------------
// Critical releases
// ---------------------------------------------------------------------------

/** Opening/closing fence of a markdown code block (``` or ~~~, up to 3 spaces of indent). */
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
/** The marker owning its line. 4+ leading spaces is an INDENTED code block in
 *  markdown, i.e. documentation of the marker rather than the marker itself. */
const MARKER_RE = /^ {0,3}\[critical\][ \t]*$/i;

/**
 * A release is CRITICAL when its body carries a `[critical]` line of its own,
 * outside any code block.
 *
 * The marker lives in the release BODY, never in the tag — the tag has to stay
 * pure semver or `pickLatestSemver` stops recognising it. Requiring the marker
 * to own its line keeps prose like "fixes a critical bug" from escalating an
 * ordinary release; skipping fenced and indented regions keeps release notes
 * that DOCUMENT the mechanism from flagging themselves.
 */
export function isCriticalRelease(body: string | null | undefined): boolean {
  if (!body) return false;
  let openChar = "";
  let openLen = 0;
  for (const line of body.split(/\r?\n/)) {
    const fence = line.match(FENCE_RE);
    if (fence) {
      const ticks = fence[1]!;
      const rest = fence[2] ?? "";
      if (!openChar) {
        openChar = ticks[0]!;
        openLen = ticks.length;
        continue;
      }
      if (ticks[0] === openChar && ticks.length >= openLen && rest.trim() === "") {
        openChar = "";
        openLen = 0;
      }
      continue; // still inside the block
    }
    if (openChar) continue; // inside a fence — markers there are documentation
    if (MARKER_RE.test(line)) return true;
  }
  return false;
}

export interface UpdateInfo {
  current: string;
  latest: string;
  hasUpdate: boolean;
  /** True when at least one release newer than `current` is flagged critical. */
  critical: boolean;
}

/**
 * Pure: resolve a release list against the installed version. `critical` looks
 * at EVERY release newer than the installed one, not just the newest, so a
 * critical fix published before a later optional release still counts.
 */
export function resolveLatestRelease(releases: Release[], current: string): UpdateInfo {
  const published = releases
    .filter((r) => !r.draft && !r.prerelease)
    .map((r) => ({ version: toSemver(r.tag_name), body: r.body ?? null }))
    .filter((r): r is { version: string; body: string | null } => r.version !== null);

  const latest = published.map((r) => r.version).sort((a, b) => compareVersions(b, a))[0] ?? current;
  const hasUpdate = compareVersions(latest, current) > 0;
  const critical =
    hasUpdate && published.some((r) => compareVersions(r.version, current) > 0 && isCriticalRelease(r.body));
  return { current, latest, hasUpdate, critical };
}

/** Renders the one-line "update available" notice, or null when up to date. */
export function updateNotice(info: Pick<UpdateInfo, "current" | "latest" | "hasUpdate">): string | null {
  return info.hasUpdate
    ? `A newer aipe is available: ${info.latest} (you have ${info.current}). Update: aipe upgrade`
    : null;
}

/** Interprets a Y/n answer. Empty (Enter) defaults to yes. */
export function parseYesNo(answer: string): boolean {
  const a = answer.trim().toLowerCase();
  return a === "" || a === "y" || a === "yes" || a === "s" || a === "sim";
}

/**
 * Whether a critical release may install itself with no consent.
 *
 * STILL OPT-IN. The install path is hardened (platform gate, verified download,
 * backup + rollback, lock, backoff) but flipping this default does not
 * inconvenience one user — it reaches every install that opens a terminal.
 */
export function autoUpgradeAllowed(env: Record<string, string | undefined> = process.env): boolean {
  return env.AIPE_AUTO_UPGRADE === "1";
}

// ---------------------------------------------------------------------------
// Shared on-disk cache
// ---------------------------------------------------------------------------

export interface Cache {
  /** The installed version this verdict was computed against. */
  current?: string;
  latest?: string;
  hasUpdate?: boolean;
  critical?: boolean;
  /** Last SUCCESSFUL fetch (0/absent = never succeeded). */
  checkedAt?: number;
  /** Last attempt, successful or not — drives the retry spacing. */
  attemptedAt?: number;
  /** Set when the user declines the prompt, so we don't nag every command. */
  snoozedUntil?: number;
}

export function cachePath(): string {
  const base = process.env.XDG_CACHE_HOME || join(homedir(), ".cache");
  return join(base, "aipe", "update-check.json");
}

/** Pure: parse the cache file. Junk/truncated content reads as empty. */
export function parseCache(raw: string): Cache {
  try {
    const c = JSON.parse(raw);
    return c && typeof c === "object" ? (c as Cache) : {};
  } catch {
    return {};
  }
}

async function readCache(): Promise<Cache> {
  try {
    return parseCache(await readFile(cachePath(), "utf8"));
  } catch {
    return {};
  }
}

/** Merges a patch into the cache, preserving other fields (e.g. snoozedUntil). */
async function writeCache(patch: Partial<Cache>): Promise<void> {
  try {
    const p = cachePath();
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, JSON.stringify({ ...(await readCache()), ...patch }), "utf8");
  } catch {
    // A read-only HOME must never break the check.
  }
}

/** Records a decline: don't prompt again until now + hours. */
export async function snoozeUpdate(hours: number): Promise<void> {
  await writeCache({ snoozedUntil: Date.now() + hours * 60 * 60 * 1000 });
}

/**
 * Pure: the TTL that applies to THIS entry. One function so the read path and
 * the refresh path can never disagree about how long an answer lasts.
 */
export function ttlFor(entry: Cache, ttlMs: number = CACHE_TTL_MS, negativeTtlMs: number = NEGATIVE_TTL_MS): number {
  return entry.hasUpdate ? ttlMs : Math.min(ttlMs, negativeTtlMs);
}

/**
 * Pure: the last verdict we can still stand behind, or null when there is none.
 * Deliberately age-tolerant — a stale-but-real answer is what the terminal hook
 * prints while a background refresh runs. A verdict computed for a DIFFERENT
 * installed version is never reused.
 */
export function cachedInfo(entry: Cache, current: string): UpdateInfo | null {
  if (!entry.latest || !entry.checkedAt || entry.checkedAt <= 0) return null;
  if (entry.current !== undefined && entry.current !== current) return null;
  return {
    current,
    latest: entry.latest,
    hasUpdate: compareVersions(entry.latest, current) > 0,
    critical: entry.critical === true,
  };
}

/** Pure: is the entry a still-authoritative answer for `current`? */
export function isCacheFresh(
  entry: Cache,
  now: number,
  current: string,
  ttlMs: number = CACHE_TTL_MS,
  negativeTtlMs: number = NEGATIVE_TTL_MS,
): boolean {
  if (!entry.latest || !entry.checkedAt || entry.checkedAt <= 0) return false;
  if (entry.current !== undefined && entry.current !== current) return false;
  return now - entry.checkedAt < ttlFor(entry, ttlMs, negativeTtlMs);
}

/**
 * Pure: should a refresh run now? Never more often than `retryMs` (which also
 * throttles an offline machine), and only once the entry is past its TTL.
 */
export function shouldRefreshCache(
  entry: Cache,
  now: number,
  current: string,
  ttlMs: number = CACHE_TTL_MS,
  retryMs: number = RETRY_MS,
  negativeTtlMs: number = NEGATIVE_TTL_MS,
): boolean {
  if (!entry.latest || entry.current !== current) return true;
  const attempted = entry.attemptedAt ?? entry.checkedAt ?? 0;
  if (now - attempted < retryMs) return false;
  return now - (entry.checkedAt ?? 0) >= ttlFor(entry, ttlMs, negativeTtlMs);
}

/** Reads the shared cache file. Never throws. */
export async function readUpdateCache(): Promise<Cache> {
  return readCache();
}

// ---------------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------------

/** Fetches the published releases. null on any failure (offline, rate-limit). */
export async function fetchReleases(current: string, timeoutMs = 6000): Promise<Release[] | null> {
  try {
    const resp = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=30`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": `aipe/${current}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!resp.ok) return null;
    return (await resp.json()) as Release[];
  } catch {
    return null;
  }
}

/** Fetches the newest semver release. null on any failure. */
export async function fetchLatestVersion(current: string, timeoutMs = 6000): Promise<string | null> {
  const releases = await fetchReleases(current, timeoutMs);
  return releases ? pickLatestSemver(releases) : null;
}

/**
 * Network check: fetch, refresh the shared cache, return the verdict.
 *
 * On failure the last verdict for THIS version is returned when we have one
 * (better than pretending there is no update); the attempt is still recorded so
 * the retry spacing holds. Never throws.
 */
export async function checkForUpdate(current: string, opts: { force?: boolean } = {}): Promise<UpdateInfo> {
  const now = Date.now();
  if (!opts.force) {
    const disk = await readCache();
    if (isCacheFresh(disk, now, current)) return cachedInfo(disk, current)!;
  }

  const releases = await fetchReleases(current);
  if (releases) {
    const info = resolveLatestRelease(releases, current);
    await writeCache({
      current,
      latest: info.latest,
      hasUpdate: info.hasUpdate,
      critical: info.critical,
      checkedAt: now,
      attemptedAt: now,
    });
    return info;
  }

  const prev = await readCache();
  await writeCache({ attemptedAt: now });
  return cachedInfo(prev, current) ?? { current, latest: current, hasUpdate: false, critical: false };
}

/**
 * Cache-only check for the hot path: reads the last cached verdict with no
 * network call. Returns null when there is no usable answer yet.
 */
export async function cachedUpdateInfo(current: string): Promise<UpdateInfo | null> {
  return cachedInfo(await readCache(), current);
}

/**
 * Resolver for the interactive "offer an update" flow: honours the decline
 * snooze, uses the cache when fresh, otherwise does a short-timeout refresh.
 * Returns UpdateInfo only when there is genuinely a newer version to offer;
 * null when snoozed, up to date, or undeterminable (offline). Never throws.
 */
export async function resolveUpdateForPrompt(current: string, now: number = Date.now()): Promise<UpdateInfo | null> {
  const cache = await readCache();
  if (cache.snoozedUntil && now < cache.snoozedUntil) return null; // declined recently

  if (!isCacheFresh(cache, now, current)) {
    const releases = await fetchReleases(current, 2500); // short timeout on the hot path
    if (releases) {
      const info = resolveLatestRelease(releases, current);
      await writeCache({
        current,
        latest: info.latest,
        hasUpdate: info.hasUpdate,
        critical: info.critical,
        checkedAt: now,
        attemptedAt: now,
      });
      return info.hasUpdate ? info : null;
    }
  }
  const info = cachedInfo(cache, current);
  return info?.hasUpdate ? info : null;
}
