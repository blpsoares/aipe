import { mkdir, open, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { rehydrateFlowSkills } from "../rehydrate/flow-skills";
import { rehydratePersonas } from "../rehydrate/personas";
import { rehydrateToolbox } from "../rehydrate/toolbox";

export interface RehydrateDeps {
  rehydratePersonas: (root: string) => Promise<unknown>;
  rehydrateToolbox: (root: string) => Promise<unknown>;
  rehydrateFlowSkills: (root: string) => Promise<unknown>;
}

const DEFAULT_DEPS: RehydrateDeps = { rehydratePersonas, rehydrateToolbox, rehydrateFlowSkills };

// A rehydrate that crashed mid-way must not wedge every future session: any
// lock older than this is assumed abandoned and reaped. The whole rehydrate
// sequence is local filesystem I/O (no network), so it never legitimately
// takes anywhere near this long.
const LOCK_STALE_MS = 5 * 60 * 1000;

function stampPath(root: string): string {
  return join(root, ".aipe", "toolchain.yaml");
}

function lockPath(root: string): string {
  return join(root, ".aipe", ".rehydrate.lock");
}

async function readStampedVersion(root: string): Promise<string | undefined> {
  try {
    const raw = await readFile(stampPath(root), "utf8");
    const parsed = parse(raw);
    const version = (parsed as { aipeVersion?: unknown } | null)?.aipeVersion;
    return typeof version === "string" ? version : undefined;
  } catch {
    return undefined;
  }
}

async function writeStampedVersion(root: string, version: string): Promise<void> {
  await mkdir(join(root, ".aipe"), { recursive: true });
  await writeFile(stampPath(root), stringify({ aipeVersion: version }), "utf8");
}

// Best-effort exclusive lock. The same SessionStart hook fires from the
// workspace root AND from every specialist repo, all resolving to the same
// root — so several hook *processes* can see the same stale stamp and race on
// the very same `.claude/settings.json` / SKILL.md files. `open(…, "wx")` is
// an atomic create-exclusive: exactly one process wins, the losers back off
// and let the winner do the work.
async function acquireLock(root: string): Promise<boolean> {
  const path = lockPath(root);
  try {
    const info = await stat(path);
    if (Date.now() - info.mtimeMs > LOCK_STALE_MS) await unlink(path).catch(() => {});
  } catch {
    // No lock file at all — nothing to reap.
  }
  try {
    const handle = await open(path, "wx");
    await handle.close();
    return true;
  } catch {
    return false;
  }
}

// Re-syncs a workspace's installed skills (personas, toolbox, flow-skills)
// from the running binary whenever the binary is newer than whatever
// generated the skills currently on disk — so a SessionStart hook always
// sees up-to-date skills without the PE ever running `aipe rehydrate`
// themselves. Never throws: a rehydrate failure degrades to "skills stay a
// bit stale this session," never to a broken hook.
export async function ensureRehydrated(
  root: string,
  currentVersion: string,
  deps: RehydrateDeps = DEFAULT_DEPS,
): Promise<boolean> {
  const stamped = await readStampedVersion(root);
  if (stamped === currentVersion) return false;

  try {
    await mkdir(join(root, ".aipe"), { recursive: true });
    // Another process is already rehydrating this root (or just did): skip.
    // It writes the stamp when it finishes, so nothing is lost.
    if (!(await acquireLock(root))) return false;
    try {
      await deps.rehydratePersonas(root);
      await deps.rehydrateToolbox(root);
      await deps.rehydrateFlowSkills(root);
      await writeStampedVersion(root, currentVersion);
      return true;
    } finally {
      await unlink(lockPath(root)).catch(() => {});
    }
  } catch {
    return false;
  }
}
