// "Atividade" — the configurable board the PE builds for themselves (SDD §7).
// Pure, testable: it takes the dispatches + live sessions + a BoardConfig and
// returns grouped columns. The view is a thin renderer over this. It reuses the
// canonical column/actor derivation from board.ts (consume, don't re-derive) and
// only ADDS the grouping/filter/persistence the "build your own board" needs.
//
// The philosophy (item 4): the simple that works over the generic that impresses.
// A small set of REAL fields the PE can group and filter by — state, repo,
// persona, journey, waits-on-you, alive-only — not a query builder.
import { signal, type Signal } from "@preact/signals";
import {
  boardActor,
  columnOf,
  isActive,
  ACTIVE_COLUMNS,
  BOARD_COLUMNS,
  type BoardCard,
  type BoardColumn,
} from "./board";
import { sessionFor } from "./floor";
import type { Dispatch } from "./store";
import type { SessionInfo } from "../../sessions";

// The field the columns are grouped by. "state" is the canonical kanban (the
// working→integrated pipeline); the others slice the same work a different way.
export type GroupField = "state" | "repo" | "persona" | "journey";
export const GROUP_FIELDS: GroupField[] = ["state", "repo", "persona", "journey"];

export interface BoardFilters {
  repos: string[]; // empty ⇒ all
  personas: string[];
  journeys: string[];
  states: BoardColumn[]; // filter by which pipeline column
  waitsOnPE: boolean; // only what needs the PE (the needs-you column)
}

export interface BoardConfig {
  groupBy: GroupField;
  // false = active only (the factory default, item 3): history is one toggle away.
  showCompleted: boolean;
  filters: BoardFilters;
}

// The factory default IS item (3): grouped by state, only the living work.
export const FACTORY_CONFIG: BoardConfig = {
  groupBy: "state",
  showCompleted: false,
  filters: { repos: [], personas: [], journeys: [], states: [], waitsOnPE: false },
};

export const BOARD_CONFIG_KEY = "aipe-activity-board";

// ── Persistence (localStorage — the repo's pattern for PE preferences; theme and
// language already use it). Every read is defensive: a corrupt/absent value falls
// back to the factory config, never throws (SDD §7). ─────────────────────────────
export function normalizeConfig(raw: unknown): BoardConfig {
  const r = (raw ?? {}) as Partial<BoardConfig>;
  const f = (r.filters ?? {}) as Partial<BoardFilters>;
  const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);
  return {
    groupBy: GROUP_FIELDS.includes(r.groupBy as GroupField) ? (r.groupBy as GroupField) : "state",
    showCompleted: r.showCompleted === true,
    filters: {
      repos: arr(f.repos),
      personas: arr(f.personas),
      journeys: arr(f.journeys),
      states: arr(f.states).filter((s): s is BoardColumn => (BOARD_COLUMNS as string[]).includes(s)),
      waitsOnPE: f.waitsOnPE === true,
    },
  };
}

export function readConfig(): BoardConfig {
  try {
    if (typeof localStorage === "undefined") return FACTORY_CONFIG;
    const v = localStorage.getItem(BOARD_CONFIG_KEY);
    if (v === null) return FACTORY_CONFIG;
    return normalizeConfig(JSON.parse(v));
  } catch {
    return FACTORY_CONFIG;
  }
}

export function writeConfig(c: BoardConfig): void {
  try {
    localStorage.setItem(BOARD_CONFIG_KEY, JSON.stringify(c));
  } catch {
    // localStorage unavailable (private mode) — the config still applies this session
  }
}

export function resetConfig(): void {
  try {
    localStorage.removeItem(BOARD_CONFIG_KEY);
  } catch {
    // nothing persisted to clear
  }
}

// The live board config — a module-level signal so it survives the view
// unmounting/remounting (SPA re-render) and is shared by the board and its
// controls, seeded from localStorage so a PE's board is there on reload (item 4).
export const boardConfig: Signal<BoardConfig> = signal(readConfig());

/** Set + persist in one call, so the control and the storage can never disagree. */
export function setBoardConfig(c: BoardConfig): void {
  boardConfig.value = c;
  writeConfig(c);
}

/** Back to the factory default (item 3): grouped by state, only the living work. */
export function resetBoardConfig(): void {
  resetConfig();
  boardConfig.value = FACTORY_CONFIG;
}

// ── Derivation ───────────────────────────────────────────────────────────────

/** The card fields the board groups/filters on. */
export function personaOf(d: Dispatch): string {
  return String(d.specialist ?? "—");
}
export function repoOf(d: Dispatch): string {
  return String(d.repo ?? "—");
}
export function journeyOf(d: Dispatch): string {
  return String(d.journey ?? "—");
}

/** Every dispatch that has a live-board column (off-board ones — removed — drop). */
export function boardCards(dispatches: Dispatch[], sessions: SessionInfo[]): BoardCard[] {
  const out: BoardCard[] = [];
  for (const d of dispatches) {
    const session = sessionFor(d, sessions);
    const column = columnOf(d, session);
    if (!column) continue;
    out.push({ dispatch: d, column, actor: boardActor(d, session), waitingApproval: false });
  }
  return out;
}

/** Whether a card passes the active filters (all conditions AND'd together). */
export function matchesFilters(card: BoardCard, config: BoardConfig, session?: SessionInfo): boolean {
  const d = card.dispatch;
  const f = config.filters;
  if (!config.showCompleted && !isActive(d, session)) return false;
  if (f.waitsOnPE && card.column !== "needs-you") return false;
  if (f.repos.length && !f.repos.includes(repoOf(d))) return false;
  if (f.personas.length && !f.personas.includes(personaOf(d))) return false;
  if (f.journeys.length && !f.journeys.includes(journeyOf(d))) return false;
  if (f.states.length && !f.states.includes(card.column)) return false;
  return true;
}

export interface BoardGroupCol {
  key: string;
  /** i18n key when grouping by state; the raw value otherwise. */
  label: string;
  /** true ⇒ `label` is an i18n key to translate; false ⇒ show it verbatim. */
  labelIsKey: boolean;
  column: BoardColumn | null; // the pipeline column, only when grouping by state
  cards: BoardCard[];
  total: number;
}

const STATE_LABEL: Record<BoardColumn, string> = {
  working: "board_col_working",
  "needs-you": "board_col_needs_you",
  "in-review": "board_col_in_review",
  ready: "board_col_ready",
  integrated: "board_col_integrated",
};

/**
 * Group the filtered cards into columns by the chosen field. Grouping by "state"
 * yields the canonical pipeline columns in order (dropping "integrated" unless
 * completed work is shown); the other fields yield one column per distinct value,
 * sorted, so the PE can pivot the same work by repo / persona / journey.
 */
export function groupBoard(dispatches: Dispatch[], sessions: SessionInfo[], config: BoardConfig): BoardGroupCol[] {
  const cards = boardCards(dispatches, sessions).filter((c) => matchesFilters(c, config, sessionFor(c.dispatch, sessions)));

  if (config.groupBy === "state") {
    const cols = config.showCompleted ? BOARD_COLUMNS : ACTIVE_COLUMNS;
    return cols.map((column) => {
      const inCol = cards.filter((c) => c.column === column);
      return { key: column, label: STATE_LABEL[column], labelIsKey: true, column, cards: inCol, total: inCol.length };
    });
  }

  const keyOf = config.groupBy === "repo" ? repoOf : config.groupBy === "persona" ? personaOf : journeyOf;
  const buckets = new Map<string, BoardCard[]>();
  for (const c of cards) {
    const k = keyOf(c.dispatch);
    (buckets.get(k) ?? buckets.set(k, []).get(k)!).push(c);
  }
  return [...buckets.keys()]
    .sort((a, b) => a.localeCompare(b))
    .map((k) => ({ key: k, label: k, labelIsKey: false, column: null, cards: buckets.get(k)!, total: buckets.get(k)!.length }));
}

// ── The card fields (SDD §8) ─────────────────────────────────────────────────

/** A short, human-readable task title. Derived — never an invented field nobody
 *  fills (SDD §8): the task slug is the identity-per-task axis and is what people
 *  actually set; we de-slugify it for reading, falling back to the branch tail,
 *  then to a dash. */
export function taskTitle(d: Dispatch): string {
  const deslug = (s: string) => s.replace(/[-_]+/g, " ").trim();
  if (d.task) return deslug(d.task);
  const tail = typeof d.branch === "string" && d.branch ? d.branch.split("/").pop() ?? "" : "";
  return tail ? deslug(tail) : "—";
}

export interface Envelope {
  harness?: string;
  model?: string;
  intensity?: string;
}

function mode(values: (string | undefined)[]): string | undefined {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | undefined;
  let bestN = 0;
  for (const [v, n] of counts) if (n > bestN) ((best = v), (bestN = n));
  return best;
}

/** The COMMON envelope across the visible dispatches — the norm a card measures
 *  its own envelope against, so it can shout the exception and mute the common
 *  (SDD §8: "de 11 dispatches, todos eram claude-code+opus+reasoning"). */
export function envelopeNorm(dispatches: Dispatch[]): Envelope {
  return {
    harness: mode(dispatches.map((d) => d.harness)),
    model: mode(dispatches.map((d) => d.model)),
    intensity: mode(dispatches.map((d) => d.intensity)),
  };
}

/** Whether a dispatch's envelope FIELD deviates from the board norm. A present
 *  value that differs from the (present) norm is the exception; absence is never
 *  an exception — a legacy record with no envelope is not "different", it is just
 *  quiet (SDD §8: ausência não é erro). */
export function isEnvException(value: string | undefined, norm: string | undefined): boolean {
  return value !== undefined && norm !== undefined && value !== norm;
}

/** The copyable next-step command for a card, or null when there is none. The
 *  console is read-only (SDD §3): it SHOWS the command, never runs it. Inspecting
 *  a live session is the common next step; otherwise, go to the worktree. */
export function copyCommandFor(d: Dispatch): string | null {
  if (typeof d.sessionId === "string" && d.sessionId) return `agentop session attach ${d.sessionId}`;
  if (typeof d.worktree === "string" && d.worktree) return `cd ${d.worktree}`;
  return null;
}

/** The distinct values available for a filter field, for building the filter UI. */
export function distinctValues(dispatches: Dispatch[], sessions: SessionInfo[], field: GroupField): string[] {
  if (field === "state") return [...ACTIVE_COLUMNS, "integrated"];
  const keyOf = field === "repo" ? repoOf : field === "persona" ? personaOf : journeyOf;
  const set = new Set<string>();
  for (const c of boardCards(dispatches, sessions)) set.add(keyOf(c.dispatch));
  return [...set].sort((a, b) => a.localeCompare(b));
}
