// A journey is one work session between the PE and the coordinator on a demand.
// Its ledger is the durable, human-inspectable record of what was dispatched —
// bookkeeping and audit, NOT the hiring brief (the brief is never persisted).
//
// Status lifecycle of a unit within a journey:
//   dispatched → delivered → verified → merged      (happy path)
//   delivered  → failed → (re)dispatched → …        (QA rejected the delivery)
//   dispatched → escalated                          (cross-repo need, PE decides)
//   dispatched → blocked                             (stuck, waiting on the coordinator)
//   dispatched → abandoned                          (session ended, no verdict ever recorded)
//   * → redirected                                 (PE redirected it live via attach)
//   * → removed                                     (worktree torn down)
// `verified` = a dev delivery that PASSED its QA gate (the only "cleared for PE"
// non-merged state). `failed` = QA rejected it, WITH evidence of what was
// checked (D4, j-20260830-w0: `failed` now requires evidence exactly like
// `delivered`/`verified` — a real QA verdict always names what it ran). `blocked`
// = the specialist declared itself stuck and is waiting on the coordinator —
// distinct from `escalated` (a cross-repo scope decision the PE owns) and from
// `delivered` (work done). It is the first-class "I cannot proceed, I need an
// answer" signal the coordinator can discover without reading a terminal
// (surfaced by `session collect` and `journey verify`). `abandoned` is the
// honest name for what used to masquerade as a reasonless `failed`: a session
// that ended (died, was killed, ran out) without ever producing a QA verdict.
// It is NOT a rejection — the unit is simply unfinished and needs a fresh
// dispatch — and `aipe status` must never render it the way it renders a real
// QA `failed`.
// The unit's difficulty vocabulary is the toolbox router's, not a second one:
// `aipe skill match --size` and the ledger's recorded size must be the SAME
// three values, or the gate would route on a scale the router does not speak.
import type { TaskSize } from "../toolbox/types";

export type DispatchStatus =
  | "dispatched"
  | "delivered"
  | "verified"
  | "failed"
  | "escalated"
  | "blocked"
  | "abandoned"
  | "merged"
  | "removed"
  | "redirected";

export const DISPATCH_STATUSES: DispatchStatus[] = [
  "dispatched",
  "delivered",
  "verified",
  "failed",
  "escalated",
  "blocked",
  "abandoned",
  "merged",
  "removed",
  "redirected",
];

// Statuses that assert a unit of work reached a real, checked VERDICT and
// therefore MUST carry evidence (Pilar 1 — verify-before-done): a dev
// delivery, a passed QA verdict, and (D4, j-20260830-w0) a QA REJECTION —
// `failed` with no evidence is indistinguishable from a session that died
// before ever forming an opinion, which is exactly the incident this closes
// (a dead QA session's ledger row read as "reprovado" to the coordinator, who
// only discovered otherwise by opening the YAML by hand). The ledger CLI
// refuses to record any of these without attached evidence.
export const EVIDENCE_REQUIRED_STATUSES: DispatchStatus[] = ["delivered", "verified", "failed"];

// The narrower set the CI gate (recordDispatchGuarded) actually re-resolves
// checks for: a done-CLAIM (delivered/verified) that names a PR must have
// green CI. `failed` is deliberately EXCLUDED even though it now requires
// evidence too — a QA rejection is routinely filed BECAUSE the checks are red,
// so gating it on green CI would make the common case unrecordable.
export const CI_GATED_STATUSES: DispatchStatus[] = ["delivered", "verified"];

// A unit whose PR has merged is immutable within the journey — never re-dispatched.
export const IMMUTABLE_STATUSES: DispatchStatus[] = ["merged"];

// Proof that a claimed "done" actually holds — attached to the ledger, never a
// bare assertion. `by` is which side produced it (the dev's own checks, or the
// QA gate exercising the change). Commands + a summary of what the output showed.
export interface DispatchEvidence {
  by: "dev" | "qa";
  commands: string[];
  summary: string;
  artifact?: string; // optional: a PR url, a log path, a screenshot ref
  // R5 — per-criterion coverage, one entry per acceptance criterion in the
  // unit's approved Task Spec. A single blanket summary is what let a QA "pass"
  // a feature by proving a proxy (the stream connects) while the criterion the
  // PE cared about (you can type into it) went untested. Answering criterion by
  // criterion is what makes an untested one visible as a hole instead of
  // vanishing into an average.
  items?: { label: string; commands: string[]; summary: string }[];
}

// The single definition of "which of these evidence commands was actually run".
// A command that is empty or whitespace is not a command run, so it is not proof.
// Both gates that judge evidence — the ledger WRITE gate (recordDispatchGuarded)
// and the verify READ gate (hasEvidence) — MUST derive proof from this one helper.
// Keeping the test in two places is exactly what let the write gate be fixed while
// the read gate kept clearing empty evidence.
export function realEvidenceCommands(ev: DispatchEvidence | undefined): string[] {
  return Array.isArray(ev?.commands) ? ev.commands.filter((c) => !!c?.trim()) : [];
}

// Evidence is proof only with at least one NON-EMPTY command (not merely a
// non-empty array) plus a non-blank summary; otherwise `--evidence-cmd ""` dresses
// a bare self-report as evidence and clears the gate.
export function hasRealEvidence(ev: DispatchEvidence | undefined): ev is DispatchEvidence {
  if (!ev) return false;
  // Per-criterion coverage IS proof, and better proof than the blanket kind: a
  // QA that answered each criterion with what it ran and what it saw has done
  // strictly more than one that wrote a single confident sentence. Requiring a
  // top-level summary on top of that would push the QA back toward the blanket
  // claim this design exists to replace.
  if (realVerifiedItems(ev).length > 0) return true;
  return realEvidenceCommands(ev).length > 0 && !!ev.summary?.trim();
}

// The evidence items that actually prove something: a criterion whose entry has
// no real command, or no summary of what the output showed, is a label — not a
// test that was run. Shared by the write gate and any reader, for the same
// reason realEvidenceCommands is: two definitions of "proof" would drift.
export function realVerifiedItems(ev: DispatchEvidence | undefined): NonNullable<DispatchEvidence["items"]> {
  return (ev?.items ?? []).filter(
    (i) => i.commands.some((c) => !!c?.trim()) && !!i.summary?.trim(),
  );
}

export interface JourneyDispatch {
  repo: string;
  package?: string; // the unit within the repo (absent ⇒ implicit whole-repo package)
  // The specific task this persona is doing on the unit — the axis that makes a
  // dispatch addressable as `Persona · task` (j-20260826-uv). Two concurrent
  // dispatches of one persona on distinct tasks are SEPARATE ledger rows with
  // independent QA gates; the fix-loop protection (re-dispatch needs a reason, a
  // merged task is immutable) is keyed on this task, not the bare unit. Absent ⇒
  // the implicit single task (legacy rows and subagent dispatches round-trip
  // untouched, identical to pre-task behavior).
  task?: string;
  specialist: string;
  branch: string;
  worktree: string;
  pr?: string;
  status: DispatchStatus;
  // Proof attached when the unit is claimed done (delivered/verified). Required
  // by the ledger gate for those statuses; absent on in-flight/legacy records.
  evidence?: DispatchEvidence;
  // Why a unit that was already delivered/verified was re-dispatched (a fix loop
  // or an intentional redo). Recorded so a re-dispatch is never silent.
  redispatchReason?: string;
  // What the PE asked for, live, when they redirected this unit's direction
  // via `agentop session attach` (status `redirected`). Deliberately a
  // separate field from `redispatchReason` above, not a reuse of it: that
  // field means "why finished work was reopened" (a fix loop / redo on a
  // delivered|verified→dispatched transition) — a reader who saw it non-empty
  // on a `redirected` record would misread this as a reopened redo instead of
  // a live scope change the approved spec no longer describes. Required by
  // the ledger gate whenever `status: "redirected"` is recorded (see
  // recordDispatchGuarded in ledger.ts); absent on legacy ledgers written
  // before this field existed.
  redirectReason?: string;
  // WHO changed the direction. `redirected` exists for the case where the PE
  // steered a specialist outside its brief, so the coordinator must reconcile
  // the Orientation Spec against it. When the COORDINATOR is the one who
  // redirected, it is the origin of the change and there is nothing for anyone
  // to reconcile — but both cases used the same word and produced the same
  // "waiting on you" line, handing the coordinator its own decision back as a
  // pending item (#106). Absent ⇒ origin not established, which SURFACES: an
  // unrecorded origin must not buy a way out of the queue.
  redirectOrigin?: "pe" | "coordinator";
  // Why a specialist declared itself `blocked` — what it is stuck on and what it
  // needs from the coordinator. Required by the ledger gate whenever
  // `status: "blocked"` is recorded (recordDispatchGuarded), so a blocked record
  // always says what would unblock it; absent on every other status. A
  // per-transition annotation, NOT sticky — it never leaks onto a later write.
  blockedReason?: string;
  // Why a unit was recorded `abandoned` (D4, j-20260830-w0) — what established
  // that the session ended with no verdict (e.g. "agentop reports the session
  // gone; no ledger record was ever written"). Required by the ledger gate
  // whenever `status: "abandoned"` is recorded, same discipline as
  // `blockedReason`/`redirectReason`: the whole value of the status is saying
  // WHY it is not a verdict, so a reasonless one is refused.
  abandonedReason?: string;
  // The fix-loop round this unit is on, starting at 1 and incremented by the
  // ledger itself every time finished work is reopened (delivered/verified/
  // failed → dispatched). It exists so a QA pass can be tied to the DELIVERY it
  // actually examined: without it, a `verified` recorded in round 1 still looks
  // like a pass after round 2 rewrote the code, which is precisely how "QA
  // approved it" survives a change nobody re-tested.
  round?: number;
  // The round whose delivery the last accepted `verified` examined. Equal to
  // `round` ⇒ the current work has been QA-tested. Less than `round` ⇒ the unit
  // was reworked after its last pass and owes a RE-TEST. Absent ⇒ never verified.
  verifiedRound?: number;
  // When this row was last written, ISO-8601 UTC. Stamped by the ledger on every
  // accepted write; no flag sets it.
  //
  // It exists because a table said `~1h`, then `~1h30` for the same item minutes
  // later, and the real answer was 23 minutes. Both numbers were estimates from
  // memory, in the one column whose whole job is to expose a stale request — so
  // it read as precision over something nobody had measured, and it grew on its
  // own. `status` now renders an ABSOLUTE time from this field, or the words
  // "não registrado". It never estimates: either it knows, or it says it does
  // not. Absent ⇒ the row predates this field, which is "not recorded", never
  // "just now".
  at?: string;
  // The DESTINATION branch — the base of the PR, `dev` or `main`. Distinct from
  // `branch`, which is where the specialist commits. This is the one that answers
  // "does this reach me?", and conflating the two is the origin of #94: work
  // merged into `dev` read as done when it was not published. Recorded, never
  // guessed — absent ⇒ unknown, and the table says so.
  base?: string;
  // A human title and one-line description of what this task is, in the language
  // of someone who did not build it. The `task` field is a slug
  // (`onda5-mostradores-que-mentem`) and a slug is not a description. Absent ⇒
  // the renderer falls back to the unit's section in the Orientation Spec, and
  // failing that says nothing rather than dressing the slug up as prose.
  title?: string;
  description?: string;
  // Stamped when a unit reached `merged` WITHOUT a QA pass for its current round.
  // The forge is the authority on whether a PR merged, so `aipe journey
  // reconcile` must record that truth even when the QA never signed off —
  // rewriting the status to something friendlier would make the ledger lie about
  // the world. What it must NOT do is let the gap pass unremarked, so it is
  // marked here and `journey verify` fails on it. The gate on the WRITE path
  // (merge-needs-qa) prevents the gap; this records the ones that got in through
  // the forge anyway.
  // This specialist filed a QA verdict on this task at some point. STICKY and
  // write-once: it is a fact about a person, and a fact cannot be un-happened by
  // a later write.
  //
  // The gate used to read the row's CURRENT status and evidence, which a
  // re-dispatch overwrites — so the documented fix loop (`--status dispatched
  // --reason …`) erased the verdict and the reviewer could then deliver its own
  // fix. An independent QA walked that route through the real CLI: the final
  // ledger showed the reviewer as `delivered` with `by: dev`, carrying no trace
  // it had ever judged the work.
  filedQaVerdict?: true;
  qaGap?: true;
  // Model-policy audit (optional; absent on legacy ledgers): the tier the
  // coordinator assigned and the concrete model the specialist ran on.
  tier?: string;
  model?: string;
  // The SDD tier this unit was routed to at dispatch (#118), from
  // `aipe skill match`'s ROUTE decision — `"spec-kit"` (the full flow) or
  // `"sdd-lite"` (the light floor). Sticky like tier/model: recorded once at
  // dispatch and preserved through the plain delivered/verified writes that omit
  // it. When it is `"spec-kit"`, the ledger's delivery gate refuses a
  // `delivered` claim whose worktree has no committed spec+plan. Absent ⇒ the
  // unit was never routed to an SDD kit (legacy rows and non-SDD units
  // round-trip untouched).
  sddKit?: string;
  // The `aipe skill match` INPUTS, recorded as ledger facts (#118). The route
  // used to depend on someone remembering `--sdd` at delivery time, so in the
  // real dispatch path nobody ever typed it and the gate never fired. Recording
  // the unit's difficulty at DISPATCH instead lets the gate derive the route
  // itself, from the same router `aipe skill match` prints. Sticky like the
  // rest: declared once, honoured by every later plain write. Absent `size` is
  // NOT read as trivial — see routeSddForGate.
  size?: TaskSize;
  taskType?: string;
  // Session-mode dispatch (absent on subagent dispatches and legacy ledgers).
  // `sessionId` is what `aipe session collect` cross-references against
  // `agentop session list --json` to tell "still working" from "died silently".
  mode?: "subagent" | "session";
  intensity?: "normal" | "ultracode";
  harness?: string;
  sessionId?: string;
  // Recorded when a delivered/verified record was accepted via the explicit
  // `--ci-none` bypass — the PR's forge reported no CI checks configured and the
  // specialist deliberately claimed that. Present ⇒ the CI gate was consciously
  // waived for this record (an audit can see the claim was made on purpose);
  // absent ⇒ the record either passed a green CI gate or predates it.
  // "no-checks" — the PR genuinely reports no CI configured (`--ci-none`).
  // "verified-pre-merge" (D2, j-20260830-w0) — checks were seen green before
  // the PR merged but gh can no longer resolve them (branch deleted); a
  // distinct, honest claim from "no-checks", never a substitute for it.
  ciBypass?: "no-checks" | "verified-pre-merge";
}

// An explicit PE grant, recorded only after the PE says yes in the live session.
// Scope is per journey (PE-confirmed). Two kinds of grant share this shape:
//   • a gated-tier grant — `tier` set (the original use);
//   • a force-claim override — `forceClaim` set to the unit key (`repo` or
//     `repo/package`) whose ACTIVE dispatch lock this journey may override with
//     `dispatch claim --force`. Overriding a live lock is a human decision on the
//     record, never an agent's shortcut (orientation, 2026-07-08 PE decision).
export interface JourneyAuthorization {
  tier?: string;
  grantedBy: string;
  forceClaim?: string;
}

// The coordinator's Orientation Spec for this journey (path relative to the
// workspace), its version, and whether the PE has approved it (the dispatch gate).
export interface JourneySpec {
  path: string;
  version: number;
  approved: boolean;
  // The content hash (spec.ts hashOrientationContent) the version above was
  // last computed against (j-20260830-w0/D1). Absent on ledgers written before
  // this field existed — that absence means "no baseline to compare against
  // yet", not "unchanged", so the first read after upgrade backfills it
  // without bumping the version.
  contentHash?: string;
}

export interface JourneyLedger {
  id: string;
  dispatches: JourneyDispatch[];
  spec?: JourneySpec;
  // Layer 2 of the spec-writer design: one approved Task Spec PER UNIT, keyed by
  // the unit's fqid (`repo` or `repo/package`). Keyed on the ledger rather than
  // stored on each dispatch row because a unit outlives its rows — a redispatch,
  // a fix loop and the QA all work against the SAME approved spec, and copying
  // it per row is how two rows would end up disagreeing about what was approved.
  // Absent ⇒ no Task Spec was ever written for any unit (every journey before
  // this existed), which reads as "not required", never as "approved".
  taskSpecs?: Record<string, JourneySpec>;
  authorizations?: JourneyAuthorization[];
}
