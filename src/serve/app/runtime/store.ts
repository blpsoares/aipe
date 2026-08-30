import { signal, computed, type Signal, type ReadonlySignal } from "@preact/signals";
import { dkey, fqidOf } from "./dom";
import { openJourneyOf, buildDecisionInbox, type JourneyLike, type DecisionItem } from "./floor";
import type { SessionInfo } from "../../sessions";
import type { UnitPhase } from "../../../session/types";

// ── Types ──────────────────────────────────────────────────────────────────
// These mirror the shapes produced/consumed by src/serve/app.html's setSnap
// (app.html:611-665). They are intentionally loose about extra fields coming
// from the raw snapshot API — this module only cares about the fields it reads.

export interface Dispatch {
  repo?: string | null;
  package?: string | null;
  // The task this dispatch is on (identity-per-task, j-20260826-uv). Travels in
  // the raw snapshot payload; the console renders it so two concurrent runs of
  // one persona on one unit are distinguishable.
  task?: string | null;
  specialist?: string | null;
  status: string;
  pr?: unknown;
  journey?: string;
  // #9 — WHERE fields. They already travel in the raw snapshot payload
  // (JourneyDispatch carries branch/worktree; the snapshot spreads the full
  // dispatch) but were previously untyped and unused by the client.
  branch?: string;
  worktree?: string;
  mode?: "subagent" | "session";
  sessionId?: string;
  // The canonical liveness phase for a session-mode dispatch, computed
  // server-side by the SAME dispatchPhase `aipe status` runs (serve/payload.ts
  // annotateLiveness). Absent on subagent dispatches. The board consumes THIS
  // rather than re-deriving an optimistic reading of its own.
  liveness?: UnitPhase;
  // Model-policy envelope, carried whole from the ledger (JourneyDispatch) so the
  // card can show harness/model/effort WITHOUT re-deriving (SDD §8/§11). Absent on
  // legacy/subagent records — absence renders clean, never as an error.
  harness?: string;
  model?: string;
  tier?: string;
  intensity?: "normal" | "ultracode";
  // The MERGE TRUTH, computed server-side (serve/payload.ts annotateIntegrated) by
  // `git merge-base --is-ancestor <branch> origin/main` — independent of the
  // ledger status. `true` ⇒ the work is already in main, so it belongs in
  // Integrados even if the ledger still says `verified` (defect 2). Conservative:
  // absent/false on any uncertainty, never a false "integrated" (SDD §4).
  integrated?: boolean;
  // The squash merge-tell is not yet known (cold cache): shown as "verifying
  // integration", NOT asserted as confirmed-pending — a cold reading must not
  // claim what it hasn't established (re-gate B2 follow-up, SDD §4).
  integrationPending?: boolean;
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
  redirected: number;
  idle: number;
  journeys: number;
  repos: number;
}

export interface ActivityEvent {
  w?: string | null;
  status: string;
  m: string;
  at: number;
  // #9 — structured WHERE, so the feed shows who did what WHERE (repo/pkg,
  // branch, worktree) + journey/PR, not just a flat "dispatched to X" string.
  repo?: string | null;
  pkg?: string | null;
  branch?: string;
  worktree?: string;
  journey?: string;
  pr?: unknown;
}

// Loose shape for the raw snapshot payload (GET /api/snapshot + SSE deltas).
export interface RawSnapshot {
  ok?: boolean;
  context?: { name?: string; coordinator?: string };
  // Absolute workspace dir the console serves — the exact `--workspace <dir>` a
  // Floor command needs (see runtime/floor.ts decisionAction).
  workspaceDir?: string;
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
  journeys?: { id: string; updatedAt?: string; spec?: { path: string; version: number; approved: boolean }; authorizations?: { tier: string; grantedBy: string }[]; dispatches?: Dispatch[] }[];
  personaCVs?: unknown[];
  counts?: { hired?: number; active?: number; delivered?: number; escalated?: number; available?: number; redirected?: number };
  attention?: AttentionItem[];
  // Live agentop session activity, folded in server-side (serve/payload.ts).
  // Absent when no dispatch runs as a session, or when agentop is unavailable.
  sessions?: SessionInfo[];
  // The coordinator's own open sessions (rooted at the workspace) — a fact about
  // sessions, not multiple coordinators (5.5).
  coordinatorSessions?: SessionInfo[];
  [key: string]: unknown;
}

// Things the PE should look at, computed server-side (see dashboard/snapshot.ts):
// a `journey verify` finding code (critical, or an open escalation) with context.
export interface AttentionItem {
  kind: string;
  severity: "critical" | "warning";
  unit: string;
  specialist: string;
  journey: string;
  detail: string;
}

export interface Snapshot {
  ok: boolean;
  context: { name?: string; coordinator?: string };
  workspaceDir: string;
  workers: Worker[];
  repos: Repo[];
  relations: unknown[];
  toolbox: { skills: { name: string; when?: string; repos: string[] }[]; mcps: { name: string; scope?: string }[] };
  packages: RawSnapshot["packages"];
  worktrees: unknown[];
  journeys: RawSnapshot["journeys"];
  cvs: unknown[];
  attention: AttentionItem[];
  sessions: SessionInfo[];
  coordinatorSessions: SessionInfo[];
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
    redirected: s.counts?.redirected || 0,
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
  if (d.status === "redirected") return `redirected — direction changed, spec needs reconciling${j}`;
  if (d.status === "delivered") return `delivered${d.pr ? " · PR" : ""}${j}`;
  if (d.status === "verified") return `verified by QA${j}`;
  if (d.status === "failed") return `QA failed — sent back${j}`;
  if (d.status === "escalated") return `escalated${j}`;
  if (d.status === "merged") return `merged${j}`;
  if (d.status === "removed") return `worktree removed${j}`;
  return `${d.status}${j}`;
}

export interface DiffActivityResult {
  activity: ActivityEvent[];
  changed: Dispatch[];
}

// #9 — the structured WHERE for an activity event, extracted from a dispatch.
// worktree is shown as its last path segment (matching worktreeOf's display).
function whereOf(d: Dispatch): Pick<ActivityEvent, "repo" | "pkg" | "branch" | "worktree" | "journey" | "pr"> {
  const worktree = typeof d.worktree === "string" && d.worktree ? d.worktree.split("/").pop() || undefined : undefined;
  return { repo: d.repo, pkg: d.package, branch: d.branch, worktree, journey: d.journey, pr: d.pr };
}

function activityEvent(d: Dispatch, at: number, t: Translator): ActivityEvent {
  return { w: d.specialist, status: d.status, m: evMsg(d, t), at, ...whereOf(d) };
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
      .map((d) => activityEvent(d, now, t));
    return { activity, changed: [] };
  }

  const activity: ActivityEvent[] = [];
  const changed: Dispatch[] = [];
  cur.forEach((d, k) => {
    const p = prevMap.get(k);
    if (!p || p.status !== d.status || p.pr !== d.pr) {
      activity.unshift(activityEvent(d, now, t));
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
  workspaceDir: "",
  workers: [],
  repos: [],
  relations: [],
  toolbox: { skills: [], mcps: [] },
  packages: [],
  worktrees: [],
  journeys: [],
  cvs: [],
  attention: [],
  sessions: [],
  coordinatorSessions: [],
};

export const snapshot: Signal<Snapshot> = signal(EMPTY_SNAPSHOT);
export const dispatches: Signal<Dispatch[]> = signal([]);
export const counts: Signal<Counts> = signal({ hired: 0, active: 0, delivered: 0, escalated: 0, redirected: 0, idle: 0, journeys: 0, repos: 0 });
export const activity: Signal<ActivityEvent[]> = signal([]);
export const conn: Signal<"wait" | "live" | "down"> = signal("wait");

// Shared seam between Task 9 (CommandPalette worker search) and Task 10
// (WorkerDrawer): setting this signal is how the palette "opens" a worker;
// the drawer renders off it (null = closed).
export const openWorkerName: Signal<string | null> = signal(null);

export const brandCtx: ReadonlySignal<string> = computed(() => snapshot.value.context.name || "—");

// Attention derivations (Pilar 4 surfacing) — drive the nav badge + the overview
// strip from one place so "how many things need me, and is any critical?" has a
// single answer.
export const attentionItems: ReadonlySignal<AttentionItem[]> = computed(() => snapshot.value.attention || []);
export const attentionCount: ReadonlySignal<number> = computed(() => attentionItems.value.length);
export const attentionHasCritical: ReadonlySignal<boolean> = computed(() =>
  attentionItems.value.some((a) => a.severity === "critical"),
);

// ── The Floor (activity-oriented landing) ────────────────────────────────────
// The dispatch pinned into the coordinator wizard's body (null ⇒ the wizard
// shows the journey's own resting body). Set by clicking a specialist accordion
// or a decision-inbox row; cleared by ESC / clicking the pinned row again.
export const pinnedDispatch: Signal<Dispatch | null> = signal(null);

// The journey the Floor pins its coordinator wizard to.
export const floorJourney: ReadonlySignal<JourneyLike | null> = computed(() =>
  openJourneyOf((snapshot.value.journeys ?? []) as JourneyLike[]),
);

// The live agentop sessions folded into the snapshot (empty when none / agentop
// absent). Used to derive a session-mode dispatch's true phase + activity.
export const sessions: ReadonlySignal<SessionInfo[]> = computed(() => snapshot.value.sessions ?? []);

// The coordinator's own open sessions — a fact about sessions, not multiple
// coordinators (5.5). There is one coordinator identity: snapshot.context.coordinator.
export const coordinatorSessionCount: ReadonlySignal<number> = computed(() => (snapshot.value.coordinatorSessions ?? []).length);

// Everything the Floor surfaces, ranked. The empty list IS the success state.
export const decisionInbox: ReadonlySignal<DecisionItem[]> = computed(() =>
  buildDecisionInbox({
    attention: snapshot.value.attention ?? [],
    journeys: (snapshot.value.journeys ?? []) as JourneyLike[],
    sessions: snapshot.value.sessions ?? [],
    now: Date.now(),
  }),
);

// The split that answers "what needs ME?": decisions only the PE can unblock,
// vs observations the coordinator/dev/QA handle. Because both derive from the
// snapshot, a resolved item disappears on its own on the next SSE frame — no
// manual dismiss, no stale card (the PE watches the list shrink).
export const decisions: ReadonlySignal<DecisionItem[]> = computed(() => decisionInbox.value.filter((i) => i.section === "decision"));
export const observations: ReadonlySignal<DecisionItem[]> = computed(() => decisionInbox.value.filter((i) => i.section === "observation"));

// THE single "N need you" count. The header, the inbox badge, the mobile FAB and
// the coordinator panel all read THIS — so no two numbers on the Floor can
// contradict each other (the "12 vs 9" divergence came from the header counting
// the raw attention array while everything else counted the decision list).
export const needsYouCount: ReadonlySignal<number> = computed(() => decisions.value.length);

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
    workspaceDir: raw.workspaceDir ?? snapshot.value.workspaceDir ?? "",
    workers: deriveWorkers(raw),
    repos: deriveRepos(raw),
    relations: raw.relations || [],
    toolbox: deriveToolbox(raw),
    packages: raw.packages || [],
    worktrees: raw.worktreeRows || [],
    journeys: raw.journeys || [],
    cvs: raw.personaCVs || [],
    attention: raw.attention || [],
    sessions: raw.sessions || [],
    coordinatorSessions: raw.coordinatorSessions || [],
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
