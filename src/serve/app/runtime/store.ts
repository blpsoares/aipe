import { signal, computed, type Signal, type ReadonlySignal } from "@preact/signals";
import { dkey, fqidOf } from "./dom";

// ── Types ──────────────────────────────────────────────────────────────────
// These mirror the shapes produced/consumed by src/serve/app.html's setSnap
// (app.html:611-665). They are intentionally loose about extra fields coming
// from the raw snapshot API — this module only cares about the fields it reads.

export interface Dispatch {
  repo?: string | null;
  package?: string | null;
  specialist?: string | null;
  status: string;
  pr?: unknown;
  journey?: string;
  [key: string]: unknown;
}

export interface Worker {
  name: string;
  role?: string;
  repo?: string;
  package?: string | null;
  status?: string;
  journey?: string;
  pr?: unknown;
  [key: string]: unknown;
}

export interface RepoPackage {
  name: string;
  stack: string[];
  kind: string;
  group: string | undefined;
}

export interface Repo {
  name: string;
  stack: string[];
  kind: string;
  packages: RepoPackage[];
}

export interface Counts {
  hired: number;
  active: number;
  delivered: number;
  escalated: number;
  idle: number;
  journeys: number;
  repos: number;
}

export interface ActivityEvent {
  w?: string | null;
  status: string;
  m: string;
  at: number;
}

// Loose shape for the raw snapshot payload (GET /api/snapshot + SSE deltas).
export interface RawSnapshot {
  ok?: boolean;
  context?: { name?: string; coordinator?: string };
  workers?: Worker[];
  repos?: string[];
  repoInfos?: { name: string; stack?: string[]; kind?: string }[];
  packages?: { repo: string; package: string; implicit?: boolean; stack?: string[]; kind?: string; group?: string }[];
  relations?: unknown[];
  toolboxDetail?: {
    skills?: { name: string; whenToUse?: string; repos?: string[] }[];
    mcps?: { name: string; scope?: string }[];
  };
  worktreeRows?: unknown[];
  journeys?: { id: string; dispatches?: Dispatch[] }[];
  personaCVs?: unknown[];
  counts?: { hired?: number; active?: number; delivered?: number; escalated?: number; available?: number };
  [key: string]: unknown;
}

export interface Snapshot {
  ok: boolean;
  context: { name?: string; coordinator?: string };
  workers: Worker[];
  repos: Repo[];
  relations: unknown[];
  toolbox: { skills: { name: string; when?: string; repos: string[] }[]; mcps: { name: string; scope?: string }[] };
  packages: RawSnapshot["packages"];
  worktrees: unknown[];
  journeys: RawSnapshot["journeys"];
  cvs: unknown[];
}

type Translator = (k: string) => string;

// ── Pure derivations (app.html:615-629) ───────────────────────────────────

export function deriveRepos(s: Pick<RawSnapshot, "repos" | "repoInfos" | "packages">): Repo[] {
  return (s.repos || []).map((name) => {
    const info = (s.repoInfos || []).find((r) => r.name === name) || { stack: [], kind: "" };
    const mods = (s.packages || [])
      .filter((m) => m.repo === name && !m.implicit)
      .map((m) => ({
        name: m.package,
        stack: m.stack || [],
        kind: m.kind || "",
        group: m.group !== m.package ? m.group : undefined,
      }));
    return { name, stack: info.stack || [], kind: info.kind || "", packages: mods };
  });
}

export function deriveWorkers(s: Pick<RawSnapshot, "workers">): Worker[] {
  return (s.workers || [])
    .filter((w) => w.role !== "coordinator")
    .map((w) => ({ name: w.name, role: w.role, repo: w.repo, package: w.package || null, status: w.status, journey: w.journey, pr: w.pr }));
}

export function deriveToolbox(s: Pick<RawSnapshot, "toolboxDetail">): Snapshot["toolbox"] {
  return {
    skills: (s.toolboxDetail?.skills || []).map((k) => ({ name: k.name, when: k.whenToUse, repos: k.repos || [] })),
    mcps: (s.toolboxDetail?.mcps || []).map((m) => ({ name: m.name, scope: m.scope })),
  };
}

export function deriveCounts(s: { counts?: RawSnapshot["counts"]; journeys?: unknown[]; repos?: unknown[] }): Counts {
  return {
    hired: s.counts?.hired || 0,
    active: s.counts?.active || 0,
    delivered: s.counts?.delivered || 0,
    escalated: s.counts?.escalated || 0,
    idle: s.counts?.available || 0,
    journeys: (s.journeys || []).length,
    repos: (s.repos || []).length,
  };
}

function deriveDispatches(s: Pick<RawSnapshot, "journeys">): Dispatch[] {
  const out: Dispatch[] = [];
  (s.journeys || []).forEach((j) => (j.dispatches || []).forEach((d) => out.push({ ...d, journey: j.id })));
  return out;
}

// ── Activity (app.html:639-665), extracted pure ───────────────────────────

export function evMsg(d: Dispatch, t: Translator): string {
  const j = d.journey ? " · " + d.journey : "";
  if (d.status === "dispatched") return `dispatched to ${fqidOf(d)}${j}`;
  if (d.status === "delivered") return `delivered${d.pr ? " · PR" : ""}${j}`;
  if (d.status === "escalated") return `escalated${j}`;
  if (d.status === "merged") return `merged${j}`;
  if (d.status === "removed") return `worktree removed${j}`;
  return `${d.status}${j}`;
}

export interface DiffActivityResult {
  activity: ActivityEvent[];
  changed: Dispatch[];
}

/**
 * Pure extraction of diffActivity (app.html:648-665).
 * - prevMap === null: first snapshot, populates `activity` from dispatches
 *   reversed, no `changed`.
 * - prevMap !== null: diffs against it; entries whose status or pr changed
 *   (or are new) are prepended to a fresh activity list and reported in
 *   `changed` (caller decides whether to notify). The activity list is
 *   capped at 60 entries, same as the monolith.
 */
export function diffActivity(
  prevMap: Map<string, Pick<Dispatch, "status" | "pr">> | null,
  curDispatches: Dispatch[],
  now: number,
  t: Translator,
): DiffActivityResult {
  const cur = new Map<string, Dispatch>();
  curDispatches.forEach((d) => cur.set(dkey(d), d));

  if (prevMap === null) {
    const activity = curDispatches
      .slice()
      .reverse()
      .map((d) => ({ w: d.specialist, status: d.status, m: evMsg(d, t), at: now }));
    return { activity, changed: [] };
  }

  const activity: ActivityEvent[] = [];
  const changed: Dispatch[] = [];
  cur.forEach((d, k) => {
    const p = prevMap.get(k);
    if (!p || p.status !== d.status || p.pr !== d.pr) {
      activity.unshift({ w: d.specialist, status: d.status, m: evMsg(d, t), at: now });
      changed.push(d);
    }
  });
  if (activity.length > 60) activity.length = 60;
  return { activity, changed };
}

// ── Signals ────────────────────────────────────────────────────────────────

const EMPTY_SNAPSHOT: Snapshot = {
  ok: false,
  context: { name: "—", coordinator: "—" },
  workers: [],
  repos: [],
  relations: [],
  toolbox: { skills: [], mcps: [] },
  packages: [],
  worktrees: [],
  journeys: [],
  cvs: [],
};

export const snapshot: Signal<Snapshot> = signal(EMPTY_SNAPSHOT);
export const dispatches: Signal<Dispatch[]> = signal([]);
export const counts: Signal<Counts> = signal({ hired: 0, active: 0, delivered: 0, escalated: 0, idle: 0, journeys: 0, repos: 0 });
export const activity: Signal<ActivityEvent[]> = signal([]);
export const conn: Signal<"wait" | "live" | "down"> = signal("wait");

// Shared seam between Task 9 (CommandPalette worker search) and Task 10
// (WorkerDrawer): setting this signal is how the palette "opens" a worker;
// the drawer renders off it (null = closed).
export const openWorkerName: Signal<string | null> = signal(null);

export const brandCtx: ReadonlySignal<string> = computed(() => snapshot.value.context.name || "—");

// Module-level previous-dispatch map, equivalent to the monolith's `PREV`.
let prevMap: Map<string, Dispatch> | null = null;

/**
 * Applies a raw snapshot to the store's signals. Equivalent to setSnap
 * (app.html:611-632) minus its DOM/notification side effects — those are
 * wired by callers (Task 6) off the returned `changed` list.
 */
export function applySnapshot(raw: RawSnapshot, now: number, t: Translator = (k) => k): Dispatch[] {
  const next: Snapshot = {
    ok: !!raw.ok,
    context: raw.context ?? snapshot.value.context,
    workers: deriveWorkers(raw),
    repos: deriveRepos(raw),
    relations: raw.relations || [],
    toolbox: deriveToolbox(raw),
    packages: raw.packages || [],
    worktrees: raw.worktreeRows || [],
    journeys: raw.journeys || [],
    cvs: raw.personaCVs || [],
  };
  snapshot.value = next;

  const nextDispatches = deriveDispatches(raw);
  dispatches.value = nextDispatches;
  counts.value = deriveCounts(raw);

  const { activity: nextActivity, changed } = diffActivity(prevMap, nextDispatches, now, t);
  if (prevMap === null) {
    activity.value = nextActivity;
  } else {
    activity.value = [...nextActivity, ...activity.value].slice(0, 60);
  }
  prevMap = new Map(nextDispatches.map((d) => [dkey(d), d]));

  return changed;
}
