// The coordinator's REGISTERED IDENTITY (journey j-20260829-5q).
//
// Until now the coordinator existed only as prose injected at SessionStart:
// nothing on disk answered "who is the coordinator of this workspace now, and
// since when?". That gap has three consequences the PE hit — orphaned agentop
// watches when the session name changes, a processing queue that is invisible to
// a fresh session, and N silent coordinators racing over one ledger.
//
// This registers each coordination session as a small entry under
// `<workspace>/.aipe/runtime/coordinators/`, one file per session (mirroring
// serve-registry.ts). It REUSES the claim primitive's *idea* — an owner with a
// verifiable-liveness signal, plus orphan reconciliation — but NOT its whole
// semantics: a dispatch lock guards a repo write and blocks a rival; a
// coordinator is a human-in-loop session that may die without warning, and the
// PE opening five of them can be legitimate. So the policy here is WARN, NOT
// BLOCK (the same direction the path-claim already takes: it warns, exits
// non-zero, and routes to resolution rather than hard-blocking).
//
// The load-bearing rule, shared with the path-lock defect this journey also
// closes: an owner whose liveness we CANNOT verify (pid 0 — the very hole that
// makes the coordinator's own locks look orphaned) is treated as ALIVE, never
// silently dead. On doubt we keep the entry and warn; better a needless warning
// than a protection that evaporates.
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse, stringify } from "yaml";

export interface CoordinatorEntry {
  /** The coordinator persona's name (from brain.context.coordinator). */
  name: string;
  /**
   * The agentop session name the event-watches address (`--notify <sessionName>`).
   * The continuity key: a new session that does not carry this name leaves every
   * watch orphaned. "" when the session name is not known to AIPe (see the
   * agentop boundary in renderCoordinatorAwareness).
   */
  sessionName: string;
  /** Liveness signal. > 0 ⇒ verifiable via signal-0; 0 ⇒ UNVERIFIABLE ⇒ alive. */
  pid: number;
  /** ISO timestamp of the first claim — the "since when" the warning reports. */
  claimedAt: string;
}

export type Liveness = "alive" | "dead" | "unverifiable";

export function coordinatorsDir(workspaceDir: string): string {
  return join(workspaceDir, ".aipe", "runtime", "coordinators");
}

/** Strip control chars from any free text that ends up in the awareness block. */
function sanitize(v: string): string {
  return v.replace(/[\x00-\x1f]+/g, " ").trim();
}

/** signal 0 probes liveness without delivering anything. EPERM = alive, not ours. */
export function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    return (err as { code?: string })?.code === "EPERM";
  }
}

/** Pure: parse one entry file. A missing `name` (the one required field) → null;
 *  a missing/invalid pid degrades to 0 (unverifiable), not a throw. */
export function parseCoordinatorEntry(raw: string): CoordinatorEntry | null {
  let o: unknown;
  try {
    o = parse(raw);
  } catch {
    return null;
  }
  if (!o || typeof o !== "object") return null;
  const rec = o as Record<string, unknown>;
  const name = sanitize(String(rec.name ?? ""));
  if (!name) return null;
  const pidRaw = rec.pid;
  const pid = typeof pidRaw === "number" && Number.isInteger(pidRaw) && pidRaw > 0 ? pidRaw : 0;
  return {
    name,
    sessionName: sanitize(String(rec.sessionName ?? "")),
    pid,
    claimedAt: typeof rec.claimedAt === "string" ? rec.claimedAt : "",
  };
}

// A single session owns exactly one entry. Keyed by pid when we can verify it,
// else by the session name (or the persona name as a last resort) — so the same
// session re-claiming at every SessionStart (startup|resume|clear|compact)
// updates in place instead of littering the dir with duplicates.
export function entryKey(entry: { name: string; sessionName: string; pid: number; claimedAt?: string }): string {
  if (entry.pid > 0) return `pid-${entry.pid}`;
  const label = entry.sessionName || entry.name;
  return `name-${label.replace(/[^A-Za-z0-9._-]/g, "-")}`;
}

function entryPath(dir: string, entry: Pick<CoordinatorEntry, "name" | "sessionName" | "pid">): string {
  return join(dir, `${entryKey(entry)}.yaml`);
}

/** The safe-inverse liveness read: verifiable pid decides; pid 0 is unverifiable. */
export function livenessOf(entry: CoordinatorEntry, isAlive: (pid: number) => boolean = pidAlive): Liveness {
  if (entry.pid > 0) return isAlive(entry.pid) ? "alive" : "dead";
  return "unverifiable";
}

/** Live means alive OR unverifiable — an owner we cannot prove dead is kept. */
export function isEntryLive(entry: CoordinatorEntry, isAlive: (pid: number) => boolean = pidAlive): boolean {
  return livenessOf(entry, isAlive) !== "dead";
}

export async function readAll(dir: string): Promise<{ file: string; entry: CoordinatorEntry }[]> {
  let files: string[];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith(".yaml"));
  } catch {
    return []; // absent dir → no coordinators, degrade quietly
  }
  const out: { file: string; entry: CoordinatorEntry }[] = [];
  for (const file of files) {
    let entry: CoordinatorEntry | null = null;
    try {
      entry = parseCoordinatorEntry(await readFile(join(dir, file), "utf8"));
    } catch {
      entry = null;
    }
    if (entry) out.push({ file, entry });
  }
  return out;
}

/**
 * The coordinators considered live, oldest first. Entries whose owner is
 * VERIFIABLY dead (a real pid that is gone) are reconciled away as they are
 * found — that is the orphan cleanup the spec keeps. An UNVERIFIABLE entry (pid
 * 0) is never pruned here: we cannot prove it dead, so we keep it and let the
 * caller warn. This is the whole point — silence-on-doubt is the failure mode
 * this journey exists to remove.
 */
export async function liveCoordinators(
  workspaceDir: string,
  isAlive: (pid: number) => boolean = pidAlive,
): Promise<CoordinatorEntry[]> {
  const dir = coordinatorsDir(workspaceDir);
  const all = await readAll(dir);
  const live: CoordinatorEntry[] = [];
  for (const { file, entry } of all) {
    if (livenessOf(entry, isAlive) === "dead") {
      await rm(join(dir, file), { force: true }).catch(() => {}); // orphan → reconcile
      continue;
    }
    live.push(entry);
  }
  return live.sort((a, b) => a.claimedAt.localeCompare(b.claimedAt));
}

export interface ClaimInput {
  name: string;
  sessionName: string;
  pid: number;
  now?: () => string;
  isAlive?: (pid: number) => boolean;
}

export interface ClaimResult {
  /** This session's registered entry. */
  mine: CoordinatorEntry;
  /** Every OTHER coordinator still considered live — the detection signal. */
  others: CoordinatorEntry[];
  /**
   * True when this claim adopted a registered identity left behind by a prior
   * session (same sessionName, now gone): a reconnect, not a fresh start — the
   * caller then explains the orphaned-watch limit.
   */
  reconnected: boolean;
  /**
   * Whether the entry was actually written to disk. False when the workspace is
   * unwritable/broken — the caller must NOT claim an identity it could not
   * persist (that would be a fresh lie, the opposite of the honesty this journey
   * is about). `others` is still trustworthy: it comes from reading, not writing.
   */
  persisted: boolean;
}

/**
 * Register this coordination session and report who else is live.
 *
 * Never throws for the SessionStart path: a workspace mid-onboarding or a broken
 * ledger must not stop this — every failure degrades to a best-effort claim.
 * The write is last-writer-wins on THIS session's own key (a session only ever
 * races itself here); cross-session detection is by reading, not locking, so two
 * new coordinators both see and warn about each other rather than one silently
 * winning.
 */
export async function claimCoordinator(workspaceDir: string, input: ClaimInput): Promise<ClaimResult> {
  const now = input.now ?? (() => new Date().toISOString());
  const isAlive = input.isAlive ?? pidAlive;
  const dir = coordinatorsDir(workspaceDir);
  const name = sanitize(input.name);
  const sessionName = sanitize(input.sessionName);
  const pid = Number.isInteger(input.pid) && input.pid > 0 ? input.pid : 0;

  const mineKey = entryKey({ name, sessionName, pid });
  // Read the raw field ONCE (dead entries still present), so reconnect detection
  // can see an orphan before liveCoordinators prunes it.
  const raw = await readAll(dir);
  // Reconnect = a PRIOR holder of our exact sessionName (a different entry) that
  // has verifiably died and left the identity behind — not a fresh solo claim on
  // an empty workspace, and not a foreign LIVE coordinator (that is a collision,
  // handled via `others`).
  const reconnected =
    sessionName.length > 0 &&
    raw.some(
      ({ entry }) =>
        entryKey(entry) !== mineKey &&
        sanitize(entry.sessionName) === sessionName &&
        livenessOf(entry, isAlive) === "dead",
    );
  // Prune verifiable orphans and keep the live ones, oldest first.
  const before = await liveCoordinators(workspaceDir, isAlive);
  // Preserve the original claimedAt when THIS session already has an entry, so
  // "since when" stays honest across resume/compact re-fires.
  const priorMine = before.find((e) => entryKey(e) === mineKey);
  const mine: CoordinatorEntry = {
    name,
    sessionName,
    pid,
    claimedAt: priorMine?.claimedAt || now(),
  };

  let persisted = false;
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(entryPath(dir, mine), stringify(mine), "utf8");
    persisted = true;
  } catch {
    // best-effort: even if we cannot persist, we still report what we saw
  }

  const others = before.filter((e) => entryKey(e) !== mineKey);
  return { mine, others, reconnected, persisted };
}

/** Remove this session's entry (idempotent). Called on a clean session close. */
export async function releaseCoordinator(
  workspaceDir: string,
  who: { pid: number; sessionName: string; name?: string },
): Promise<void> {
  const dir = coordinatorsDir(workspaceDir);
  const key = entryKey({ name: who.name ?? "", sessionName: who.sessionName, pid: who.pid });
  await rm(join(dir, `${key}.yaml`), { force: true }).catch(() => {});
}

// ── Actionable awareness (items 1 & 3) ───────────────────────────────────────
//
// The warning must be actionable: who else is active, since when, and what to
// do. Kept pure so the SessionStart caller only interpolates it.
export function renderCoordinatorAwareness(res: Pick<ClaimResult, "mine" | "others" | "reconnected">): string {
  const since = res.mine.claimedAt || "an unrecorded time";
  const nameTag = res.mine.sessionName ? `registered as "${res.mine.sessionName}"` : `"${res.mine.name}"`;

  if (res.others.length > 0) {
    const list = res.others
      .map((o) => {
        const sn = o.sessionName ? ` (agentop session "${o.sessionName}")` : "";
        const when = o.claimedAt || "an unrecorded time";
        return `${o.name}${sn}, coordinating since ${when}`;
      })
      .join("; ");
    return (
      `COORDINATOR COLLISION (not blocking): you are a SECOND coordinator on this workspace. ` +
      `Already active: ${list}. Two coordinators reading one ledger can write conflicting specs, ` +
      `re-activate the same specialist, or record duplicate verdicts — the atomic claim guards the ` +
      `dispatch, not the reasoning. If this is deliberate (a scoped test on one repo), continue — you ` +
      `are now aware. Otherwise attach to the existing session ` +
      `(\`agentop session attach\`) and let it coordinate, rather than dispatching in parallel from here.`
    );
  }

  if (res.reconnected) {
    return (
      `You reconnected to the coordinator identity ${nameTag}, registered since ${since}. ` +
      `agentop's event-watches address the coordinator by SESSION NAME, so if this session is not ` +
      `named "${res.mine.sessionName}" its notifications are orphaned — they still fire, but reach no one. ` +
      `To take over the orphaned watches, rename this session to "${res.mine.sessionName}" ` +
      `(\`agentop session rename\`). If re-addressing the watches turns out to need an agentop change ` +
      `AIPe cannot make from here, that is a cross-repo matter — escalate to the PE rather than improvise.`
    );
  }

  return (
    `You hold the coordinator identity of this workspace ${nameTag}, since ${since}. ` +
    `A future session can reconnect to this identity without anyone re-typing the name.`
  );
}
