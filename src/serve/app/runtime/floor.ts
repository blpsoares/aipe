// The Floor's pure derivations — the client-side logic behind the wizard's
// phase-per-dispatch, the coordinator rail, the decision inbox, the cost-index,
// the same-package law, and the per-journey timeline. Everything here is a pure
// function over the snapshot the console already receives (dispatches, journeys,
// attention) plus the live `agentop` sessions folded in server-side (payload.ts)
// — so it is exhaustively testable without a DOM, and it never fabricates a
// signal AIPe does not have (the truthfulness gate).
import { dkey, fqidOf } from "./dom";
import { MODE_MULTIPLIER, TIER_MULTIPLIER, INTENSITY_MULTIPLIER } from "../../../execution/cost";
import type { Dispatch, AttentionItem } from "./store";
import type { SessionInfo } from "../../sessions";

// A phase is DERIVED from (status, evidence, live signal, elapsed) — never read
// off the ledger, which only carries `status`. The finer sub-phases the spec
// describes (spec-plan, red→green) are advisory and only fire on a live monitor
// signal; without one the phase honestly collapses to a coarse, true state.
export type Phase =
  | "dispatched" // booting / brief — the envelope, worktree, branch
  | "implementing" // live: files changing
  | "verifying" // gathering evidence, or delivered-without-evidence-yet
  | "delivered" // PR + evidence + ledger verdict
  | "verified" // QA cleared (green)
  | "qa-gate" // QA rejected / findings open
  | "escalated"
  | "redirected"
  | "blocked" // the specialist declared itself stuck — waiting on the coordinator
  | "dead-silent" // session ended / silent past timeout — the PE's call
  | "closed"; // merged / removed (green)

const GREEN: ReadonlySet<Phase> = new Set<Phase>(["verified", "closed"]);
export function isGreenPhase(p: Phase): boolean {
  return GREEN.has(p);
}

// Maps to the existing statusMeta tones (sky/accent/amber/rose/slate) so the
// Floor reuses tokens.css verbatim.
const TONE: Record<Phase, string> = {
  dispatched: "sky",
  implementing: "sky",
  verifying: "sky",
  delivered: "accent",
  verified: "accent",
  closed: "slate",
  "qa-gate": "rose",
  escalated: "amber",
  redirected: "amber",
  blocked: "amber",
  "dead-silent": "slate",
};
export function phaseTone(p: Phase): string {
  return TONE[p] ?? "slate";
}

const BOOT_GRACE_MS = 90_000;
const SILENCE_MS = 15 * 60_000;

/** A delivery carries proof only with at least one command and a non-blank summary (the ledger gate). */
export function hasEvidence(d: Dispatch): boolean {
  const ev = d.evidence as { commands?: unknown[]; summary?: string } | undefined;
  return !!ev && Array.isArray(ev.commands) && ev.commands.length > 0 && !!ev.summary?.trim();
}

/** The live agentop session for a dispatch, matched by worktree==cwd (the strongest join). Pure — no exec. */
export function sessionFor(d: Dispatch, sessions: SessionInfo[]): SessionInfo | undefined {
  if (!d.worktree) return undefined;
  return sessions.find((s) => s.cwd === d.worktree);
}

export interface PhaseInputs {
  /** The matched live agentop session (session mode), if any. */
  session?: SessionInfo;
  /** The matched monitor lane is active (subagent mode). */
  laneActive?: boolean;
  /** The monitor SSE is down — never claim dead-silent while blind. */
  monConnDown?: boolean;
  /** Coarse elapsed since first-seen / last ledger write. */
  elapsedMs?: number;
  bootGraceMs?: number;
  silenceMs?: number;
}

export function derivePhase(d: Dispatch, inputs: PhaseInputs = {}): Phase {
  const status = d.status;
  // `closed` is terminal: the unit it belonged to landed, or another journey
  // took the work over. Falling through to the live band below made the console
  // render a finished record as somebody working right now.
  if (status === "merged" || status === "removed" || status === "closed") return "closed";
  if (status === "verified") return "verified";
  if (status === "escalated") return "escalated";
  if (status === "redirected") return "redirected";
  // `blocked` is a real ledger status now (the j-20260825-84 signal): the
  // specialist declared itself stuck. It must render as blocked, never inferred
  // as "building it" the way a plain `dispatched` record is (defect D7).
  if (status === "blocked") return "blocked";
  if (status === "failed") return "qa-gate";
  if (status === "delivered") return hasEvidence(d) ? "delivered" : "verifying";

  // status === "dispatched" — the live band.
  const boot = inputs.bootGraceMs ?? BOOT_GRACE_MS;
  const silence = inputs.silenceMs ?? SILENCE_MS;

  const sessionMode = d.mode === "session" || !!d.sessionId;

  // Session mode: agentop tells us running/exited + working/waiting (the only
  // truthful signal for a detached session — no per-line transcript).
  if (sessionMode) {
    const s = inputs.session;
    // No matched session ⇒ we are BLIND (agentop absent, or the session hasn't
    // registered yet). Never claim dead-silent from elapsed alone — that would
    // ask the PE to kill a unit that may be fine. Stay booting; the UI shows the
    // telemetry as pending. Dead-silent is claimed ONLY on a matched exited
    // session (positive evidence it ended without recording).
    if (!s) return "dispatched";
    if (s.status === "exited") return "dead-silent";
    if (s.activity === "working") return "implementing";
    return hasEvidence(d) ? "verifying" : "dispatched";
  }

  // Subagent mode: monitor-lane liveness is the signal.
  if (inputs.laneActive) return hasEvidence(d) ? "verifying" : "implementing";

  // No live signal: booting within the grace, or genuinely silent — but never
  // dead-silent while the monitor is offline (we'd be blind, not certain).
  const elapsed = inputs.elapsedMs ?? 0;
  if (inputs.monConnDown) return "dispatched";
  if (elapsed > silence) return "dead-silent";
  return "dispatched";
}

// ── cost-index ──────────────────────────────────────────────────────────────

export interface CostIndex {
  /** null when an envelope field is present but not a known value. */
  value: number | null;
  /** true when any multiplier fell back to a default because a field was absent. */
  defaulted: boolean;
}

/**
 * The dispatch's cost-index = MODE × TIER × INTENSITY, a COARSE RELATIVE INDEX
 * (never currency). Reuses the exact multipliers from execution/cost.ts. Absent
 * fields default (marked `defaulted`); a present-but-unknown value → null.
 */
export function costIndexOf(d: Dispatch): CostIndex {
  let defaulted = false;
  const pick = <T extends string>(v: string | undefined, table: Record<string, number>, fallback: T): number | null => {
    if (v === undefined) {
      defaulted = true;
      return table[fallback]!;
    }
    const m = table[v];
    return m === undefined ? null : m;
  };
  const mode = pick(d.mode as string | undefined, MODE_MULTIPLIER as Record<string, number>, "subagent");
  const tier = pick(d.tier as string | undefined, TIER_MULTIPLIER as Record<string, number>, "fast");
  const intensity = pick(d.intensity as string | undefined, INTENSITY_MULTIPLIER as Record<string, number>, "normal");
  if (mode === null || tier === null || intensity === null) return { value: null, defaulted };
  return { value: mode * tier * intensity, defaulted };
}

// ── journeys, waves, the law ─────────────────────────────────────────────────

// A dispatch whose status is not a terminal end-state (still in the wave).
const TERMINAL: ReadonlySet<string> = new Set(["merged", "removed", "verified"]);
function isOpen(d: Dispatch): boolean {
  return !TERMINAL.has(d.status);
}

export interface JourneyLike {
  id: string;
  updatedAt?: string;
  spec?: { path: string; version: number; approved: boolean };
  authorizations?: { tier: string; grantedBy: string }[];
  dispatches?: Dispatch[];
}

/** The journey the Floor pins: most-recently-updated with open work, else the newest. */
export function openJourneyOf(journeys: JourneyLike[]): JourneyLike | null {
  if (journeys.length === 0) return null;
  const ts = (j: JourneyLike): number => (j.updatedAt ? Date.parse(j.updatedAt) || 0 : 0);
  const withOpen = journeys.filter((j) => (j.dispatches ?? []).some(isOpen));
  const pool = withOpen.length > 0 ? withOpen : journeys;
  return pool.reduce((a, b) => (ts(b) >= ts(a) ? b : a));
}

export type JourneyPhase = "framing" | "awaiting-spec-approval" | "planning" | "wave-running" | "needs-decision" | "qa" | "closing";

export function deriveJourneyPhase(j: JourneyLike): JourneyPhase {
  if (!j.spec) return "framing";
  if (!j.spec.approved) return "awaiting-spec-approval";
  const ds = j.dispatches ?? [];
  const open = ds.filter(isOpen);
  if (open.length === 0) return ds.length > 0 ? "closing" : "planning";
  if (open.some((d) => d.status === "escalated" || d.status === "redirected")) return "needs-decision";
  if (open.some((d) => d.status === "failed" || d.status === "delivered")) return "qa";
  return "wave-running";
}

export interface WaveInfo {
  units: Dispatch[];
  committedIndex: number;
  anyDefaulted: boolean;
}

/** The open wave: the live dispatches and their summed committed cost-index. */
export function openWaveOf(j: JourneyLike): WaveInfo {
  const units = (j.dispatches ?? []).filter((d) => d.status === "dispatched" || d.status === "failed");
  let committedIndex = 0;
  let anyDefaulted = false;
  for (const d of units) {
    const c = costIndexOf(d);
    if (c.value !== null) committedIndex += c.value;
    if (c.defaulted) anyDefaulted = true;
  }
  return { units, committedIndex, anyDefaulted };
}

export type StatusCounts = Record<string, number>;
export function countsByStatus(dispatches: Dispatch[]): StatusCounts {
  const out: StatusCounts = {};
  for (const d of dispatches) out[d.status] = (out[d.status] ?? 0) + 1;
  return out;
}

/**
 * The same-package law made visible: if another live dispatch on the SAME
 * repo+package appears before this one in ledger order, this one is serialized
 * behind that specialist. Returns the blocking specialist, or null.
 */
export function serializedBehind(d: Dispatch, all: Dispatch[]): string | null {
  if (!isOpen(d)) return null;
  const fq = fqidOf(d);
  const siblings = all.filter((x) => isOpen(x) && fqidOf(x) === fq);
  const idx = siblings.indexOf(d);
  if (idx <= 0) return null;
  const holder = siblings[0];
  return holder?.specialist ?? null;
}

// ── gate class + decision inbox ──────────────────────────────────────────────

const GATED_TIERS: ReadonlySet<string> = new Set(["reasoning", "frontier"]);

/**
 * Whether an envelope needs the PE's authorization and no grant covers it. The
 * exact policy thresholds are execute-time (execution/policy.ts) and absent from
 * the snapshot, so this is an INFERENCE — the UI labels it as such, never as the
 * ledger's own verdict.
 */
export function isGateClass(d: Dispatch, j: JourneyLike): boolean {
  const needs = d.intensity === "ultracode" || (typeof d.tier === "string" && GATED_TIERS.has(d.tier));
  if (!needs) return false;
  const grants = j.authorizations ?? [];
  return !grants.some((a) => a.tier === d.tier);
}

export type DecisionKind =
  | "no-evidence"
  | "failed-open"
  | "dependency-not-landed"
  | "dead-silent"
  | "gated"
  | "escalation"
  | "redirected"
  | "blocked"
  | "qa-gap";

// Two kinds of row on the Floor, and the split is the answer to the PE's
// question "what actually needs ME?":
//  - "decision"    — only the PE can unblock it (authorize, approve, decide to
//                    kill). These are what "N need you" counts.
//  - "observation" — a real finding, but the coordinator / dev / QA resolves it;
//                    the PE cannot fix it with a click. Per the spec, these do
//                    not belong in a *decision* inbox — they are shown apart and
//                    say who is handling them, so the PE is informed without
//                    being nagged to act on something they can't act on.
export type DecisionSection = "decision" | "observation";

const SECTION: Record<DecisionKind, DecisionSection> = {
  escalation: "decision",
  gated: "decision",
  "dead-silent": "decision",
  "no-evidence": "observation",
  "failed-open": "observation",
  "dependency-not-landed": "observation",
  "qa-gap": "observation",
  redirected: "observation",
  blocked: "observation",
};

/** Who acts next on a kind — an i18n key (rendered by the component). */
const ACTOR: Record<DecisionKind, string> = {
  escalation: "fa_actor_you",
  gated: "fa_actor_you",
  "dead-silent": "fa_actor_you",
  "no-evidence": "fa_actor_dev",
  "failed-open": "fa_actor_coord",
  "dependency-not-landed": "fa_actor_coord",
  "qa-gap": "fa_actor_coord",
  redirected: "fa_actor_coord",
  blocked: "fa_actor_coord",
};

export function decisionSection(kind: DecisionKind): DecisionSection {
  return SECTION[kind] ?? "observation";
}

export interface DecisionItem {
  kind: DecisionKind;
  section: DecisionSection;
  severity: "critical" | "warning";
  unit: string;
  specialist: string;
  journey: string;
  detail: string;
  /** true when this is a client-side inference, not a ledger finding. */
  inferred?: boolean;
  rank: number;
}

const RANK: Record<DecisionKind, number> = {
  "no-evidence": 0,
  "failed-open": 0,
  "dependency-not-landed": 0,
  "dead-silent": 1,
  gated: 2,
  escalation: 3,
  blocked: 4,
  redirected: 5,
  "qa-gap": 6,
};

const CRITICAL_ATTENTION: ReadonlySet<string> = new Set(["no-evidence", "failed-open", "dependency-not-landed"]);

export interface InboxInputs {
  attention: AttentionItem[];
  journeys: JourneyLike[];
  sessions: SessionInfo[];
  now: number;
}

/**
 * Everything waiting on the PE, ranked and (unit,journey,kind)-deduped: the
 * critical ledger invariants that reached the client, plus client-derived
 * dead-silent, gated (inferred), escalations, redirects and QA gaps.
 */
export function buildDecisionInbox(inp: InboxInputs): DecisionItem[] {
  const items: DecisionItem[] = [];
  const push = (it: Omit<DecisionItem, "rank" | "section">): void => {
    items.push({ ...it, section: decisionSection(it.kind), rank: RANK[it.kind] });
  };

  // 1 — ledger findings already computed server-side (the SAME verifyJourney
  // engine the `journey verify` CLI runs — one source, so the Floor and the CLI
  // never disagree). Criticals map to their kind; the warning-level findings that
  // still need a human map to their row too, as observations.
  for (const a of inp.attention) {
    if (CRITICAL_ATTENTION.has(a.kind)) {
      push({ kind: a.kind as DecisionKind, severity: "critical", unit: a.unit, specialist: a.specialist, journey: a.journey, detail: a.detail });
    } else if (a.kind === "escalated-open") {
      push({ kind: "escalation", severity: "warning", unit: a.unit, specialist: a.specialist, journey: a.journey, detail: a.detail });
    } else if (a.kind === "blocked-open") {
      // The j-20260825-84 blocked signal, surfaced: the specialist is stuck and
      // the coordinator owes it an answer. An observation, not the PE's click.
      push({ kind: "blocked", severity: "warning", unit: a.unit, specialist: a.specialist, journey: a.journey, detail: a.detail });
    } else if (a.kind === "merged-skipped-qa") {
      push({ kind: "qa-gap", severity: "warning", unit: a.unit, specialist: a.specialist, journey: a.journey, detail: a.detail });
    }
  }

  for (const j of inp.journeys) {
    for (const d of j.dispatches ?? []) {
      const unit = fqidOf(d);
      const specialist = (d.specialist as string) ?? "—";
      // 2 — dead-silent: an exited session on a still-dispatched record.
      if (d.status === "dispatched") {
        const session = inp.sessions.find((s) => s.cwd === d.worktree);
        if (session && session.status === "exited") {
          push({ kind: "dead-silent", severity: "critical", unit, specialist, journey: j.id, detail: "session ended without recording — inspect the branch read-only; killing/re-dispatching is your call", inferred: true });
        }
      }
      // 3 — gated (inferred).
      if (isGateClass(d, j) && (d.status === "dispatched" || d.status === "failed")) {
        push({ kind: "gated", severity: "warning", unit, specialist, journey: j.id, detail: `${d.intensity ?? d.tier} envelope needs your authorization — inferred, not the ledger's verdict`, inferred: true });
      }
      // 5 — redirected.
      if (d.status === "redirected") {
        push({ kind: "redirected", severity: "warning", unit, specialist, journey: j.id, detail: (d.redirectReason as string) || "direction changed — the spec needs reconciling" });
      }
      // 6 — blocked: the specialist declared itself stuck. Derived from the
      // ledger status directly (the server's attention array carries only
      // criticals + escalations, so a warning-level block would never reach the
      // client otherwise). This is what makes the coordinator panel honest —
      // a blocked unit renders as blocked, never as "building it" (defect D7).
      if (d.status === "blocked") {
        push({ kind: "blocked", severity: "warning", unit, specialist, journey: j.id, detail: (d.blockedReason as string) || "blocked — waiting on the coordinator" });
      }
    }
  }

  // Dedupe on (kind, unit, journey); keep the highest-severity instance.
  const seen = new Map<string, DecisionItem>();
  for (const it of items) {
    const key = `${it.kind}|${it.unit}|${it.journey}`;
    const prev = seen.get(key);
    if (!prev || (prev.severity !== "critical" && it.severity === "critical")) seen.set(key, it);
  }
  const sevRank = (s: DecisionItem["severity"]): number => (s === "critical" ? 0 : 1);
  return [...seen.values()].sort((a, b) => sevRank(a.severity) - sevRank(b.severity) || a.rank - b.rank || a.unit.localeCompare(b.unit));
}

// ── a pending item's four answers + its resolving command ────────────────────
// The spec's core: every pending item must answer, in the PE's own framing,
// WHAT it is, WHY it appeared, WHAT TO DO (with the exact command, copyable in
// one click), and WHERE. This is a pure mapping from a DecisionItem (+ its
// dispatch, for the WHERE fields, + the workspace dir, for an exact command) to
// those four answers as i18n keys the component renders. The console is
// read-only: the command is shown to be copied and run by the PE in a terminal,
// never executed here.

export interface ActionWhere {
  repo: string;
  unit: string;
  journey: string;
  branch?: string;
  worktree?: string;
  pr?: string;
}

export interface ActionCard {
  section: DecisionSection;
  /** i18n keys — rendered (and interpolated with `vars`) by the component. */
  whatKey: string;
  whyKey: string;
  todoKey: string;
  actorKey: string;
  vars: Record<string, string>;
  /** The exact command to copy+run, or null when no shell command resolves it. */
  command: string | null;
  /** Shown in place of a command when `command` is null. */
  commandNoteKey?: string;
  where: ActionWhere;
}

const WHAT: Record<DecisionKind, string> = {
  escalation: "fa_what_escalation",
  gated: "fa_what_gated",
  "dead-silent": "fa_what_deadsilent",
  "no-evidence": "fa_what_noevidence",
  "failed-open": "fa_what_failedopen",
  "dependency-not-landed": "fa_what_dep",
  "qa-gap": "fa_what_qagap",
  redirected: "fa_what_redirected",
  blocked: "fa_what_blocked",
};
const WHY: Record<DecisionKind, string> = {
  escalation: "fa_why_escalation",
  gated: "fa_why_gated",
  "dead-silent": "fa_why_deadsilent",
  "no-evidence": "fa_why_noevidence",
  "failed-open": "fa_why_failedopen",
  "dependency-not-landed": "fa_why_dep",
  "qa-gap": "fa_why_qagap",
  redirected: "fa_why_redirected",
  blocked: "fa_why_blocked",
};
const TODO: Record<DecisionKind, string> = {
  escalation: "fa_todo_escalation",
  gated: "fa_todo_gated",
  "dead-silent": "fa_todo_deadsilent",
  "no-evidence": "fa_todo_noevidence",
  "failed-open": "fa_todo_failedopen",
  "dependency-not-landed": "fa_todo_dep",
  "qa-gap": "fa_todo_qagap",
  redirected: "fa_todo_redirected",
  blocked: "fa_todo_blocked",
};

/** The in-context producer named in a dependency-not-landed detail, if present. */
export function producerOf(detail: string): string | null {
  const m = detail.match(/against\s+(\S+?),/);
  return m ? m[1]! : null;
}

const q = (s: string): string => (/\s/.test(s) ? `'${s}'` : s);

/** `aipe journey <verb> --workspace <ws> --journey <id>` — omits --workspace when unknown. All read-only. */
function journeyCmd(verb: "verify" | "show", ws: string, journey: string): string {
  const wsPart = ws ? ` --workspace ${q(ws)}` : "";
  return `aipe journey ${verb}${wsPart} --journey ${journey}`;
}

export function decisionAction(item: DecisionItem, dispatch: Dispatch | undefined, workspaceDir = ""): ActionCard {
  const kind = item.kind;
  const journey = item.journey;
  const repo = String(dispatch?.repo ?? item.unit.split("/")[0] ?? item.unit);
  const branch = typeof dispatch?.branch === "string" ? dispatch.branch : undefined;
  const worktree = typeof dispatch?.worktree === "string" ? dispatch.worktree : undefined;
  const pr = typeof dispatch?.pr === "string" ? dispatch.pr : undefined;
  const where: ActionWhere = { repo, unit: item.unit, journey, ...(branch ? { branch } : {}), ...(worktree ? { worktree } : {}), ...(pr ? { pr } : {}) };

  const producer = producerOf(item.detail) ?? "";
  const vars: Record<string, string> = { unit: item.unit, journey, who: item.specialist, producer };

  // The resolving command per kind. Every command is real (verified signatures)
  // and read-only-safe: it inspects or reconciles; the PE runs it themselves.
  let command: string | null = null;
  let commandNoteKey: string | undefined;
  switch (kind) {
    case "escalation":
      command = journeyCmd("show", workspaceDir, journey);
      break;
    case "gated":
      // No shell command authorizes an envelope — the PE does it in the
      // coordinator session. Being honest beats inventing a fake command.
      command = null;
      commandNoteKey = "fa_cmd_none_auth";
      break;
    case "dead-silent":
      command = worktree ? `git -C ${q(worktree)} log --oneline -20` : journeyCmd("show", workspaceDir, journey);
      break;
    case "no-evidence":
    case "dependency-not-landed":
    case "qa-gap":
      command = journeyCmd("verify", workspaceDir, journey);
      break;
    case "failed-open":
    case "blocked":
    case "redirected":
      // All read-only inspections. `redirected` in particular is NOT resolved by
      // `journey reconcile` (that command auto-detects merged PRs — a different
      // job); reconciling a spec after a live redirect is a coordinator judgment
      // with no single command, so we show the ledger state and name the actor.
      command = journeyCmd("show", workspaceDir, journey);
      break;
  }

  return {
    section: decisionSection(kind),
    whatKey: WHAT[kind],
    whyKey: WHY[kind],
    todoKey: TODO[kind],
    actorKey: ACTOR[kind],
    vars,
    command,
    ...(commandNoteKey ? { commandNoteKey } : {}),
    where,
  };
}

// ── per-journey timeline ─────────────────────────────────────────────────────

export interface TimelineEntry {
  unit: string;
  specialist: string;
  status: string;
  label: string;
  pr?: string;
}

/** A journey's dispatch history, for reconstructing how it unfolded. */
export function unitTimeline(j: JourneyLike): TimelineEntry[] {
  return (j.dispatches ?? []).map((d) => ({
    unit: fqidOf(d),
    specialist: (d.specialist as string) ?? "—",
    status: d.status,
    label: `${(d.specialist as string) ?? "—"} · ${fqidOf(d)} · ${d.status}`,
    ...(typeof d.pr === "string" ? { pr: d.pr } : {}),
  }));
}

export { dkey, fqidOf };
