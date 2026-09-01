// The registry of AIPe workspaces seen on this machine.
//
// `aipe rehydrate` syncs a workspace's coordinator flow-skills FROM THE BINARY,
// so every upgrade leaves every workspace one version behind until someone
// remembers to run it by hand. Nobody does. The registry is what turns
// "run rehydrate everywhere" into something the upgrade can actually do: each
// command that resolves a workspace records it here, and `aipe upgrade` walks
// the list afterwards.
//
// Recording is best-effort and silent — a read-only HOME must never break a
// command, it just means the upgrade won't know about that workspace.
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, parse as parsePath, resolve } from "node:path";
import { aipeStateDir, statePath } from "./state";

/** Most recent N workspaces are kept; older entries fall off. */
export const MAX_WORKSPACES = 50;

export interface WorkspaceEntry {
  path: string;
  lastSeen: number;
}

export function registryPath(): string {
  return statePath("workspaces.json");
}

/** Pure: parse the registry file. Junk/truncated content reads as empty. */
export function parseWorkspaceRegistry(raw: string): WorkspaceEntry[] {
  try {
    const o = JSON.parse(raw) as { workspaces?: unknown };
    if (!o || !Array.isArray(o.workspaces)) return [];
    return o.workspaces
      .filter((e): e is WorkspaceEntry =>
        !!e && typeof (e as WorkspaceEntry).path === "string" && (e as WorkspaceEntry).path !== "" &&
        typeof (e as WorkspaceEntry).lastSeen === "number" && Number.isFinite((e as WorkspaceEntry).lastSeen))
      .map((e) => ({ path: e.path, lastSeen: e.lastSeen }));
  } catch {
    return [];
  }
}

/**
 * Pure: the list after seeing `path` at `now` — deduped by path, newest first,
 * capped at MAX_WORKSPACES. Re-seeing a workspace moves it up rather than
 * appending a second entry.
 */
export function mergeWorkspace(list: WorkspaceEntry[], path: string, now: number): WorkspaceEntry[] {
  return [{ path, lastSeen: now }, ...list.filter((e) => e.path !== path)]
    .sort((a, b) => b.lastSeen - a.lastSeen)
    .slice(0, MAX_WORKSPACES);
}

/** How long a just-recorded workspace stays "already recorded". */
export const RECORD_THROTTLE_MS = 60 * 60 * 1000;

/** Pure: is there anything new to write? Re-recording the same workspace that
 *  is already at the head of the list within the throttle window is a no-op. */
export function needsRecord(
  list: WorkspaceEntry[],
  path: string,
  now: number,
  throttleMs: number = RECORD_THROTTLE_MS,
): boolean {
  const head = list[0];
  if (!head || head.path !== path) return true;
  return now - head.lastSeen >= throttleMs;
}

/**
 * Files only a REAL workspace has inside `.aipe/`: `harness` is written by
 * `aipe start`, `brain.yaml` by `/context-brain`. One of them is always there
 * by the time a workspace is worth rehydrating.
 */
export const WORKSPACE_MARKERS = ["harness", "brain.yaml"];

/**
 * Pure: is this directory an AIPe workspace?
 *
 * Checking only that `<dir>/.aipe` EXISTS was wrong in the one place it hurts:
 * the machine state dir is itself `~/.aipe`, so running any `aipe` command
 * from `$HOME` registered `$HOME` as a workspace — and the next upgrade
 * rehydrated it, writing AIPe's coordinator flow-skills into `~/.claude/skills/`.
 * That is the user's GLOBAL harness config, loaded by every session on the
 * machine, and it breaks the product's own promise that nothing is ever
 * installed globally.
 *
 * So a workspace has to prove it is one, and the state dir is excluded outright
 * — belt and braces, because the cost of getting this wrong is silent and
 * machine-wide.
 */
export function looksLikeWorkspace(
  dir: string,
  exists: (p: string) => boolean = existsSync,
  stateDir: string = aipeStateDir(),
): boolean {
  const aipe = resolve(dir, ".aipe");
  if (aipe === resolve(stateDir)) return false;
  return WORKSPACE_MARKERS.some((marker) => exists(join(aipe, marker)));
}

/**
 * The AIPe workspace that ENCLOSES `dir` — `dir` itself or its nearest
 * ancestor that is a workspace — or undefined if none. This is the safe default
 * scope for the migration half of `aipe upgrade`: the workspace the PE is
 * actually in, never "every workspace the machine has ever seen".
 */
export function enclosingWorkspace(
  dir: string,
  isWorkspace: (p: string) => boolean = (p) => looksLikeWorkspace(p),
): string | undefined {
  let cur = resolve(dir);
  // Walk up to the filesystem root; parsePath(cur).root === cur at the top.
  for (;;) {
    if (isWorkspace(cur)) return cur;
    const parent = dirname(cur);
    if (parent === cur || cur === parsePath(cur).root) return undefined;
    cur = parent;
  }
}

async function readRegistry(): Promise<WorkspaceEntry[]> {
  try {
    return parseWorkspaceRegistry(await readFile(registryPath(), "utf8"));
  } catch {
    return [];
  }
}


/**
 * Is this path a THROWAWAY workspace — a test fixture, an e2e scratch dir, an
 * assistant's scratchpad — rather than somewhere real work lives?
 *
 * The registry drives `aipe upgrade`, which rehydrates every workspace it knows.
 * It only ever forgot an entry whose `.aipe/` had disappeared, and a `/tmp`
 * fixture survives until reboot — so every test run, every e2e case and every
 * assistant session that built a scratch workspace was recorded FOREVER, and
 * each one added a line to every future upgrade.
 *
 * Measured on the PE's machine: 50 entries, 49 of them throwaway, one real. His
 * `aipe upgrade` rehydrated six scratch directories before touching his actual
 * workspace, and then reported a migration blocked partly because of them.
 *
 * Deliberately a PATH rule and not a heuristic about content: a workspace under
 * `/tmp` or inside a `scratchpad/` is ephemeral by construction, and a rule that
 * tried to guess "is this one real?" from what is inside it would be the kind of
 * signal that asserts without establishing.
 */
export function isEphemeralWorkspace(path: string): boolean {
  // The system temp directory is NOT always `/tmp`. An independent QA found the
  // rule was a literal `/tmp/` prefix, so on macOS — where `os.tmpdir()` returns
  // `/var/folders/…/T/`, and `/tmp` is itself a symlink to `/private/tmp` — the
  // measured "49 of 50 entries were throwaway" problem would recur unchanged.
  // AIPe's own `mkdtemp` fixtures live exactly there.
  //
  // Listed explicitly rather than asked of the OS: `tmpdir()` answers for THIS
  // machine, and the registry is read on machines other than the one that wrote
  // it. A path that is temp anywhere is temp everywhere, for this purpose.
  const TEMP_ROOTS = ["/tmp/", "/var/tmp/", "/private/tmp/", "/private/var/tmp/", "/var/folders/"];
  if (TEMP_ROOTS.some((root) => path.startsWith(root))) return true;
  return path.includes("/scratchpad/") || path.endsWith("/scratchpad");
}

/**
 * Records `dir` as a workspace this machine knows about. No-op when the
 * directory is not a workspace, or is a throwaway one. Never throws.
 */
export async function recordWorkspace(dir: string, now: number = Date.now()): Promise<void> {
  try {
    const path = resolve(dir);
    if (!looksLikeWorkspace(path)) return;
    // A fixture is not a workspace anyone upgrades. Recording it costs nothing
    // today and costs a rehydrate on every future upgrade, forever.
    if (isEphemeralWorkspace(path)) return;
    const list = await readRegistry();
    // Hooks fire this on every session event; rewriting the file each time
    // would be a disk write per keystroke-scale event for no new information.
    if (!needsRecord(list, path, now)) return;
    const next = mergeWorkspace(list, path, now);
    const p = registryPath();
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, JSON.stringify({ workspaces: next }, null, 2), "utf8");
  } catch {
    // best-effort — never fail a command over bookkeeping
  }
}

/**
 * The workspaces that still exist on disk, newest first. Entries whose `.aipe/`
 * is gone (deleted, moved, an external drive) are dropped from the answer —
 * rehydrating a path that no longer exists would only manufacture failures.
 */
export async function knownWorkspaces(): Promise<string[]> {
  // Ephemeral entries are filtered on the way OUT too, so a registry that
  // already accumulated them heals itself on the next read — nobody has to edit
  // JSON by hand to stop their upgrade rehydrating other people's test fixtures.
  return (await readRegistry())
    .filter((e) => !isEphemeralWorkspace(e.path) && looksLikeWorkspace(e.path))
    .map((e) => e.path);
}
