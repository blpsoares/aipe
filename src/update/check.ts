// Update detection for the aipe CLI — compares the running version against the
// newest GitHub release and, when a newer one exists, points at the install
// command. Modeled on agentistics' version check: pick the highest *semver* tag
// (ignoring draft/prerelease and any non-semver rolling tag), cache the result,
// and stay silent on any network failure. The pure helpers are unit-tested; the
// fetch/cache is best-effort and never throws.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const GITHUB_REPO = "blpsoares/aipe";
export const INSTALL_CMD = "curl -fsSL https://aipe.openvibes.tech/cli | sh";
const CACHE_TTL_MS = 60 * 60 * 1000; // 1h: how long a cached latest is trusted
const SEMVER_RE = /^\d+\.\d+\.\d+$/;

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

interface Release {
  tag_name: string;
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

export interface UpdateInfo {
  current: string;
  latest: string;
  hasUpdate: boolean;
}

/** Renders the one-line "update available" notice, or null when up to date. */
export function updateNotice(info: UpdateInfo): string | null {
  return info.hasUpdate
    ? `A newer aipe is available: ${info.latest} (you have ${info.current}). Update: ${INSTALL_CMD}`
    : null;
}

/** Interprets a Y/n answer. Empty (Enter) defaults to yes. */
export function parseYesNo(answer: string): boolean {
  const a = answer.trim().toLowerCase();
  return a === "" || a === "y" || a === "yes" || a === "s" || a === "sim";
}

// ── cache (best-effort, with a decline "snooze") ─────────────────────────────

interface Cache {
  latest?: string;
  checkedAt?: number;
  snoozedUntil?: number; // set when the user declines, so we don't nag every command
}

function cachePath(): string {
  const base = process.env.XDG_CACHE_HOME || join(homedir(), ".cache");
  return join(base, "aipe", "update-check.json");
}

async function readCache(): Promise<Cache> {
  try {
    const c = JSON.parse(await readFile(cachePath(), "utf8"));
    if (c && typeof c === "object") return c as Cache;
  } catch {
    // no cache / unreadable
  }
  return {};
}

/** Merges a patch into the cache, preserving other fields (e.g. snoozedUntil). */
async function writeCache(patch: Partial<Cache>): Promise<void> {
  try {
    const p = cachePath();
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, JSON.stringify({ ...(await readCache()), ...patch }), "utf8");
  } catch {
    // best-effort — a missing cache just means we re-check next time
  }
}

/** Records a decline: don't prompt again until now + hours. */
export async function snoozeUpdate(hours: number): Promise<void> {
  await writeCache({ snoozedUntil: Date.now() + hours * 60 * 60 * 1000 });
}

// ── fetch ────────────────────────────────────────────────────────────────────

/** Fetches the newest semver release. null on any failure (offline, rate-limit). */
export async function fetchLatestVersion(current: string, timeoutMs = 6000): Promise<string | null> {
  try {
    const resp = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=30`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": `aipe/${current}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!resp.ok) return null;
    return pickLatestSemver((await resp.json()) as Release[]);
  } catch {
    return null;
  }
}

/** Network check: fetch latest, refresh the cache, return info. Never throws. */
export async function checkForUpdate(current: string): Promise<UpdateInfo> {
  const latest = await fetchLatestVersion(current);
  if (latest) await writeCache({ latest, checkedAt: Date.now() });
  const effective = latest ?? current;
  return { current, latest: effective, hasUpdate: compareVersions(effective, current) > 0 };
}

/**
 * Cache-only check for the hot path (`aipe --version`): reads the last cached
 * result with no network call. Returns null when there's no fresh cache or we're
 * already current. `check-update` (or a shell hook) refreshes the cache.
 */
export async function cachedUpdateInfo(current: string): Promise<UpdateInfo | null> {
  const cache = await readCache();
  if (!cache.latest || !cache.checkedAt) return null;
  if (Date.now() - cache.checkedAt > CACHE_TTL_MS) return null; // stale → don't nag on old data
  return { current, latest: cache.latest, hasUpdate: compareVersions(cache.latest, current) > 0 };
}

/**
 * Resolver for the interactive "offer an update" flow: honors the decline snooze,
 * uses the cache when fresh, and otherwise does a short-timeout network refresh.
 * Returns UpdateInfo only when there's genuinely a newer version to offer; null
 * when snoozed, up to date, or undeterminable (offline). Never throws.
 */
export async function resolveUpdateForPrompt(current: string, now: number = Date.now()): Promise<UpdateInfo | null> {
  const cache = await readCache();
  if (cache.snoozedUntil && now < cache.snoozedUntil) return null; // user declined recently

  let latest = cache.latest ?? null;
  const fresh = cache.checkedAt !== undefined && now - cache.checkedAt < CACHE_TTL_MS;
  if (!fresh) {
    const fetched = await fetchLatestVersion(current, 2500); // short timeout on the command hot path
    if (fetched) {
      latest = fetched;
      await writeCache({ latest: fetched, checkedAt: now });
    }
  }
  if (!latest) return null;
  const hasUpdate = compareVersions(latest, current) > 0;
  return hasUpdate ? { current, latest, hasUpdate } : null;
}
