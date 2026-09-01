import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { resolveVerdict, type PrChecksResolver } from "./checks";
import type { TaskSize } from "../toolbox/types";
import {
  CI_GATED_STATUSES,
  EVIDENCE_REQUIRED_STATUSES,
  hasRealEvidence,
  IMMUTABLE_STATUSES,
  realEvidenceCommands,
  realVerifiedItems,
  type JourneyAuthorization,
  type JourneyDispatch,
  type JourneyLedger,
  type JourneySpec,
} from "./types";

function ledgerPath(workspaceDir: string, id: string): string {
  return join(workspaceDir, ".aipe", "journeys", `${id}.yaml`);
}

// Reads every journey ledger in the workspace (sorted by id). Missing dir → [].
export async function listJourneys(workspaceDir: string): Promise<JourneyLedger[]> {
  const dir = join(workspaceDir, ".aipe", "journeys");
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return [];
  }
  const ids = files.filter((f) => f.endsWith(".yaml")).map((f) => f.replace(/\.yaml$/, "")).sort();
  const ledgers: JourneyLedger[] = [];
  for (const id of ids) {
    const ledger = await readLedger(workspaceDir, id);
    if (ledger) ledgers.push(ledger);
  }
  return ledgers;
}

export async function readLedger(workspaceDir: string, id: string): Promise<JourneyLedger | null> {
  try {
    const raw = await readFile(ledgerPath(workspaceDir, id), "utf8");
    const parsed = parse(raw);
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.dispatches)) {
      const authorizations = Array.isArray(parsed.authorizations)
        ? (parsed.authorizations as JourneyAuthorization[])
        : [];
      return {
        id,
        dispatches: parsed.dispatches as JourneyDispatch[],
        authorizations,
        ...(parsed.spec && typeof parsed.spec === "object" ? { spec: parsed.spec as JourneySpec } : {}),
        // The reader is an allowlist too, and both ends drop silently: a field
        // added to the writer alone round-trips to nothing, with every write
        // still reporting success. Keep this list and writeLedger's in step.
        ...(parsed.taskSpecs && typeof parsed.taskSpecs === "object"
          ? { taskSpecs: parsed.taskSpecs as Record<string, JourneySpec> }
          : {}),
      };
    }
  } catch {
    // missing or malformed → treated as absent
  }
  return null;
}

export async function writeLedger(workspaceDir: string, ledger: JourneyLedger): Promise<string> {
  const path = ledgerPath(workspaceDir, ledger.id);
  await mkdir(join(workspaceDir, ".aipe", "journeys"), { recursive: true });
  await writeFile(
    path,
    stringify({
      id: ledger.id,
      dispatches: ledger.dispatches,
      authorizations: ledger.authorizations ?? [],
      ...(ledger.spec ? { spec: ledger.spec } : {}),
      // The writer is an ALLOWLIST: a field absent here is silently dropped on
      // every write, however well-typed it is upstream. `taskSpecs` was, and the
      // scaffold still printed OK — the write reported success for a value that
      // never reached the file. Any new ledger field must be added here too.
      ...(ledger.taskSpecs && Object.keys(ledger.taskSpecs).length > 0 ? { taskSpecs: ledger.taskSpecs } : {}),
    }),
    "utf8",
  );
  return path;
}

// Statuses whose recorded `worktree` path is never rewritten by a layout move:
// a merged/removed unit is immutable and needs no live path.
const TERMINAL_FOR_REPAIR = new Set<string>(["merged", "removed"]);

/**
 * Repairs the absolute `worktree` paths recorded in every journey ledger after
 * repos were moved (e.g. root → `repos/`), so a still-live dispatch's row keeps
 * pointing at where its worktree actually is.
 *
 * Purely mechanical: a prefix rewrite of the `worktree` field ONLY, and ONLY on
 * NON-terminal dispatches. Status, evidence and every other field are left
 * untouched, so this is bookkeeping — never a re-dispatch, and it never mutates
 * a `merged` unit (the immutability invariant holds). Best-effort per journey.
 *
 * @param moves absolute repo roots, `from` (old) → `to` (new).
 * @returns the rewrites made, for audit.
 */
export async function repairWorktreePaths(
  workspaceDir: string,
  moves: { from: string; to: string }[],
): Promise<{ journey: string; specialist: string; from: string; to: string }[]> {
  const rewrites: { journey: string; specialist: string; from: string; to: string }[] = [];
  if (moves.length === 0) return rewrites;
  for (const ledger of await listJourneys(workspaceDir)) {
    let changed = false;
    const dispatches = ledger.dispatches.map((d) => {
      if (TERMINAL_FOR_REPAIR.has(d.status) || !d.worktree) return d;
      const move = moves.find((m) => d.worktree === m.from || d.worktree!.startsWith(`${m.from}/`));
      if (!move) return d;
      const to = `${move.to}${d.worktree.slice(move.from.length)}`;
      rewrites.push({ journey: ledger.id, specialist: d.specialist, from: d.worktree, to });
      changed = true;
      return { ...d, worktree: to };
    });
    if (changed) await writeLedger(workspaceDir, { ...ledger, dispatches });
  }
  return rewrites;
}

// Sets/updates the journey's Orientation Spec metadata, preserving dispatches.
export async function setJourneySpec(workspaceDir: string, id: string, spec: JourneySpec): Promise<string> {
  const ledger = (await readLedger(workspaceDir, id)) ?? { id, dispatches: [] };
  return writeLedger(workspaceDir, { ...ledger, spec });
}

// Records (or replaces) ONE unit's Task Spec on the journey ledger, keyed by
// fqid. Layered exactly like setJourneySpec — the ledger is the record, the
// markdown file is the artifact, and every gate establishes the artifact before
// trusting the record.
export async function setJourneyTaskSpec(
  workspaceDir: string,
  id: string,
  fqid: string,
  spec: JourneySpec,
): Promise<string> {
  const ledger = (await readLedger(workspaceDir, id)) ?? { id, dispatches: [] };
  return writeLedger(workspaceDir, { ...ledger, taskSpecs: { ...ledger.taskSpecs, [fqid]: spec } });
}

// Creates the ledger file for a journey if it doesn't exist yet; returns its id.
export async function startJourney(workspaceDir: string, id: string): Promise<string> {
  const existing = await readLedger(workspaceDir, id);
  if (existing) return id;
  await writeLedger(workspaceDir, { id, dispatches: [] });
  return id;
}

// Fields that SURVIVE an update when this write doesn't repeat them — the
// session envelope (Pilar: a specialist that follows its own prompt must not
// erase its own dispatch record). `composePrompt`'s example commands (the
// ONLY commands a session-mode specialist is ever told to run) never carry
// `--mode`/`--intensity`/`--harness`/`--session-id` — `sessionId` in
// particular is not reliably knowable to a specialist reporting on itself in
// the general case, and the next field added to the envelope would silently
// regress the same way if this were solved per-flag instead of per-class. So
// a plain "record delivered" from inside the ordinary happy path (or the
// redirect path) must not wipe them.
//
// `tier`/`model` are the same class of thing (coordinator-assigned policy,
// not a per-call assertion) and get the same treatment.
//
// Everything else is intentionally NOT sticky — a normal REPLACE, exactly as
// before this fix, cleared the instant a write omits it:
//   - `pr`/`evidence` are proof/state of THIS specific call's claim, never
//     inherited from an earlier one. (This also does no work for the
//     evidence-required GATE below, which always reads the incoming record's
//     own `evidence`, before any merge — so evidence can never be satisfied
//     by a value left over from a previous record either way. This list only
//     controls what survives onto the ledger AFTER the gate already passed.)
//   - `redirectReason`/`redispatchReason` are per-transition annotations
//     (why THIS write happened) — letting one leak into an unrelated later
//     write would misattribute it (see "redirected does not collide with
//     redispatchReason" in ledger-gate.test.ts).
// `round`/`verifiedRound` are sticky for the same reason they exist: a plain
// write that omits them (every `delivered`, every `--status merged`) must
// PRESERVE the fix-loop history, not silently reset it. A cleared verifiedRound
// would read as "never verified"; a cleared round would let a stale pass look
// current — either way the merge gate would be judging invented state.
const STICKY_DISPATCH_FIELDS = ["tier", "model", "mode", "intensity", "harness", "sessionId", "sddKit", "size", "taskType", "round", "verifiedRound"] as const;

// Merges `incoming` onto `existing` field-by-field: a STICKY_DISPATCH_FIELDS
// key that `incoming` genuinely omits (no own property at all — never merely
// `undefined`-valued) is carried over from `existing`; every other key is
// exactly what `incoming` says, including absent (cleared). A key present on
// `incoming` with an explicit `undefined` value (used by the guarded
// redispatch path below to deliberately reset a stale `sessionId`) is treated
// as "clear it" — NOT as "inherit from existing" — and is dropped from the
// result rather than written as a literal null.
function mergeDispatch(existing: JourneyDispatch | undefined, incoming: JourneyDispatch): JourneyDispatch {
  if (!existing) return incoming;
  const merged: Record<string, unknown> = { ...incoming };
  for (const field of STICKY_DISPATCH_FIELDS) {
    if (!(field in merged) && existing[field] !== undefined) {
      merged[field] = existing[field];
    }
  }
  for (const key of Object.keys(merged)) {
    if (merged[key] === undefined) delete merged[key];
  }
  return merged as unknown as JourneyDispatch;
}

// Upserts a dispatch by (repo, package, specialist): a field ABSENT from this
// write is preserved from the existing record when it's one of
// STICKY_DISPATCH_FIELDS (see above); every other field is a plain replace
// (present in `dispatch` ⇒ written, absent ⇒ cleared), same as before. Every
// other dispatch in the ledger is untouched either way.
export async function recordDispatch(
  workspaceDir: string,
  id: string,
  dispatch: JourneyDispatch,
): Promise<string> {
  const ledger = (await readLedger(workspaceDir, id)) ?? { id, dispatches: [] };
  const idx = ledger.dispatches.findIndex(
    (d) =>
      d.repo === dispatch.repo &&
      (d.package ?? null) === (dispatch.package ?? null) &&
      (d.task ?? null) === (dispatch.task ?? null) &&
      // Case-insensitive on the specialist so a case-only difference (`mike`
      // after `Mike`) UPDATES the one record instead of forking a duplicate
      // row — the same jane/Jane split dedupeLedger cleans up after the fact,
      // refused here at write time before it can ever land.
      d.specialist.toLowerCase() === dispatch.specialist.toLowerCase(),
  );
  if (idx >= 0) {
    const existing = ledger.dispatches[idx]!;
    // Keep the FIRST record's spelling as canonical: an update must not rewrite
    // the specialist's name to the incoming caller's casing.
    ledger.dispatches[idx] = mergeDispatch(existing, { ...dispatch, specialist: existing.specialist });
  } else ledger.dispatches.push(dispatch);
  return writeLedger(workspaceDir, ledger);
}

// Records an explicit PE authorization for a gated tier on this journey. Written
// by the coordinator ONLY after the PE grants it in the live session. Idempotent
// per (tier) — re-granting the same tier does not duplicate.
export async function recordAuthorization(
  workspaceDir: string,
  id: string,
  auth: JourneyAuthorization,
): Promise<string> {
  const ledger = (await readLedger(workspaceDir, id)) ?? { id, dispatches: [], authorizations: [] };
  ledger.authorizations ??= [];
  // Idempotent per grant identity: a tier grant dedups on tier, a force-claim
  // grant dedups on its unit — so distinct force-claims don't collapse into one.
  const identity = (a: JourneyAuthorization): string => `${a.tier ?? ""}|${a.forceClaim ?? ""}`;
  if (!ledger.authorizations.some((a) => identity(a) === identity(auth))) {
    ledger.authorizations.push(auth);
  }
  return writeLedger(workspaceDir, ledger);
}

export function grantedTiers(ledger: JourneyLedger | null): Set<string> {
  return new Set(
    (ledger?.authorizations ?? [])
      .map((a) => a.tier)
      .filter((t): t is string => typeof t === "string"),
  );
}

// ── The ledger gate (the deterministic spine of reliability) ─────────────────
//
// `recordDispatch` above is the raw upsert — used by the reconciler and tests
// where the transition is already trusted. `recordDispatchGuarded` is what the
// COORDINATOR goes through (the `aipe journey record` CLI). It refuses any write
// that would break an invariant, so a drifting/compacted coordinator physically
// cannot mark work done without proof or clobber finished work:
//
//   • verify-before-done (Pilar 1): a `delivered`/`verified` write MUST carry
//     evidence (≥1 command + a non-empty summary). No self-report without proof.
//   • immutability (Pilar 3): a unit already `merged` is final — never rewritten.
//   • no-silent-redispatch (Pilar 3): moving a unit that was already
//     `delivered`/`verified` back to `dispatched` (a fix loop / redo) REQUIRES a
//     reason, so re-dispatching finished work is always deliberate and audited.
//   • no-reasonless-redirect: recording a unit `redirected` REQUIRES a reason
//     (what the PE asked for, live). A `redirected` status without its reason
//     tells the coordinator something changed but not what — exactly the gap
//     the status exists to close (the approved spec is what gets reconciled
//     against it next), so a redirect that carries no reason is rejected
//     rather than silently recorded as noise.
//
// The guard keys on the UNIT (repo + package), not the specialist — a fix can
// reuse or swap the specialist and the invariant still holds.
// Resolves whether an SDD-routed unit's spec-first artifacts are present and
// committed in its worktree (#118). Injected like PrChecksResolver so the gate
// is inert for a resolver-less caller (the reconciler, unit tests) — it never
// fabricates a pass OR a fail from nothing — and stays network-free (the real
// implementation is `git ls-files` in the worktree, no forge).
export type SddArtifactResolver = (worktree: string) => Promise<{ spec: boolean; plan: boolean }>;

// Derives WHICH SDD tier a unit falls under from its recorded difficulty, when
// no explicit `--sdd` was signed. Injected (like the two resolvers above) so the
// ledger layer stays free of the toolbox: the real binding is the workspace's
// own catalog + `routeSddForGate`. A resolver-less caller (the reconciler, unit
// tests) keeps the gate inert rather than guessing a route from nothing.
export type SddRouter = (task: { size?: TaskSize; taskType?: string }) => string | null;

// Resolves the acceptance-criterion LABELS of a unit's APPROVED Task Spec — the
// list the QA must answer one by one. `null` means the unit has no approved Task
// Spec, which is "nothing enumerated to cover", never "covered". Injected like
// the resolvers above so the ledger layer never reads the filesystem itself and
// a resolver-less caller keeps the gate inert rather than inventing a verdict.
export type AcceptanceCriteria =
  // No Task Spec was ever written for this unit: nothing is enumerated, so there
  // is nothing to cover. The only state that legitimately skips the item gate.
  | { kind: "none" }
  // The criteria a QA verdict must answer, from an APPROVED, unchanged Task Spec.
  | { kind: "criteria"; labels: string[] }
  // A Task Spec EXISTS but its criteria cannot be established right now — it was
  // edited after approval, deleted, or is unreadable. This must be its own state,
  // and it must REFUSE. Collapsing it into "none" is what an independent QA
  // exploited: deleting the approved Task Spec turned the item-by-item gate off
  // and the write reported success. The one artefact whose purpose is that a
  // human read it must not be disableable by removing it.
  | { kind: "unestablished"; why: string };

export type AcceptanceResolver = (unit: { repo: string; package?: string }) => Promise<AcceptanceCriteria>;

// The SDD kit whose delivery gate has teeth. Kept in lockstep with
// routing.ts FULL_SDD_KIT — only the full flow carries the committed-artifact
// contract; the light floor (sdd-lite) is covered by the evidence gate.
const GATED_SDD_KIT = "spec-kit";

export type LedgerGateCode =
  | "evidence-required"
  | "sdd-artifacts-required"
  | "reviewer-cannot-build"
  | "verify-needs-delivery"
  | "verify-needs-qa"
  | "verification-incomplete"
  | "merge-needs-qa"
  | "unit-immutable"
  | "redispatch-needs-reason"
  | "redirect-needs-reason"
  | "blocked-needs-reason"
  | "abandoned-needs-reason"
  | "ci-red"
  | "ci-pending"
  | "ci-none"
  | "ci-unresolvable"
  | "ci-verified-pre-merge-needs-reason";

// What each gate actually DID on this write. The root cause of 2026-08-31, in
// one line: you could not tell a pass from a no-op. `OK aipe Jesse delivered`
// was byte-identical whether the SDD gate had run and approved, or had never
// been on the path at all — so six approved gates could green-light three broken
// features while reporting, truthfully, that nothing had failed. A gate that
// cannot say "I ran" is indistinguishable from one that is not wired.
//
//   "ok"          — ran, applied, passed.
//   "n/a"         — ran, and correctly did not apply (wrong status, no PR, no
//                   Task Spec written). An established non-answer.
//   "not-checked" — could NOT run: its resolver was absent. THE state that used
//                   to be invisible. Never read this as a pass.
export type GateOutcome = "ok" | "n/a" | "not-checked";

export interface GateReport {
  sdd: GateOutcome; // spec+plan committed for a full-SDD delivery
  ci: GateOutcome; // the PR's checks
  qa: GateOutcome; // per-criterion coverage of the approved Task Spec
}

export interface GuardedRecordResult {
  ok: boolean;
  code?: LedgerGateCode;
  message?: string;
  path?: string;
  // Present on every ACCEPTED write. A refusal needs no report — the code and
  // message already say which gate spoke.
  gates?: GateReport;
}

// Renders a report for the operator: `[sdd:ok ci:green qa:—]`. An em dash is the
// not-checked marker, chosen so it cannot be misread as a verdict.
export function formatGates(g: GateReport, ciDetail?: string): string {
  const mark = (o: GateOutcome, okText = "ok"): string =>
    o === "ok" ? okText : o === "n/a" ? "n/a" : "—";
  return `[sdd:${mark(g.sdd)} ci:${mark(g.ci, ciDetail ?? "ok")} qa:${mark(g.qa)}]`;
}

function unitStatus(ledger: JourneyLedger, repo: string, pkg: string | null, task: string | null): JourneyDispatch | undefined {
  // The most advanced record for this TASK identity (repo + package + task, any
  // specialist), to judge transitions. Keyed on the task — not the bare unit —
  // so the fix-loop protection is per task: re-dispatching or immutability of one
  // task never blocks a DIFFERENT task that merely shares the unit (the new axis
  // is another task, not another try at the same one). A fix loop still reuses or
  // swaps the specialist on the SAME task and the invariant holds. Task absent ⇒
  // identity == unit, identical to pre-task behavior. Kept in lockstep with the
  // identical table in journey/verify.ts (see its comment): `redirected` ranks
  // with `failed`/`escalated` — a live redirect must outrank a stale
  // `dispatched` record from another specialist on the same task.
  const rank: Record<string, number> = { removed: 0, dispatched: 1, failed: 2, escalated: 2, redirected: 2, blocked: 2, abandoned: 2, delivered: 3, verified: 4, merged: 5 };
  return ledger.dispatches
    .filter((d) => d.repo === repo && (d.package ?? null) === pkg && (d.task ?? null) === task)
    .sort((a, b) => (rank[b.status] ?? 0) - (rank[a.status] ?? 0))[0];
}

export async function recordDispatchGuarded(
  workspaceDir: string,
  id: string,
  dispatch: JourneyDispatch,
  opts: { reason?: string; resolveChecks?: PrChecksResolver; ciNone?: boolean; ciVerifiedPreMerge?: boolean; resolveSddArtifacts?: SddArtifactResolver; routeSdd?: SddRouter; resolveAcceptance?: AcceptanceResolver } = {},
): Promise<GuardedRecordResult> {
  const ledger = (await readLedger(workspaceDir, id)) ?? { id, dispatches: [] };
  const pkg = dispatch.package ?? null;
  const current = unitStatus(ledger, dispatch.repo, pkg, dispatch.task ?? null);
  const unitName = `${dispatch.repo}${pkg ? `/${pkg}` : ""}`;

  // The unit's OTHER rows. A unit is worked by more than one row on purpose: the
  // dev delivers under its own task, and the QA records its verdict as a
  // SEPARATE row (its own specialist, its own task) on the same unit. So every
  // rule about "was this delivered / has the QA passed it" is scoped to the
  // UNIT, never to the row doing the writing — a row-scoped check would ask the
  // QA's own row whether it had delivered anything, which it never does.
  // Scoped by TASK (repo + package + task), the same key `journey verify` groups
  // its QA audit by. Unit scope was wrong and an independent QA proved it: with
  // two tasks on one unit, a pass recorded on task A cleared a merge on task B
  // that nobody had delivered or verified — this repo's own comment for the
  // identical bug calls it "a mis-paired gate that reports safety that is not
  // there". A dev and its QA share the task and differ by SPECIALIST, which is
  // exactly what the documented flow records.
  const gateRows = ledger.dispatches.filter(
    (d) => d.repo === dispatch.repo && (d.package ?? null) === pkg && (d.task ?? null) === (dispatch.task ?? null),
  );
  // The fix-loop round is the furthest any row in this task-group has got, and
  // the QA standing is the furthest round any of them has PASSED. Reading both
  // as a MAX is what lets the dev's redispatch invalidate the QA's older pass.
  const gateRound = Math.max(1, ...gateRows.map((d) => d.round ?? 1));
  // Only rows that are STILL `verified` count. `verifiedRound` is sticky by
  // design — a plain write must not erase the history — but that made a
  // RETRACTED pass keep clearing the merge gate: a QA that verified and then
  // recorded `failed` ("retracting: it is broken") left its verifiedRound behind,
  // and the merge landed on a task whose only standing verdict was a failure.
  const gateVerifiedRound = Math.max(
    0,
    ...gateRows.filter((d) => d.status === "verified").map((d) => d.verifiedRound ?? 0),
  );

  // The row this write will actually upsert onto — same identity recordDispatch
  // matches by. The round MUST be read from here and never from `current`:
  // `current` is the highest-RANKED row of the task group, so after a QA pass it
  // is the QA's `verified` row, and copying its round onto the dev's re-delivery
  // silently reset round 2 back to 1 — which made the whole "re-test after a fix"
  // rule vanish in the documented flow (where the QA records no separate task).
  const selfRow = gateRows.find(
    (d) => d.specialist.toLowerCase() === dispatch.specialist.toLowerCase(),
  );

  // 1 — verify-before-done: claiming done requires attached evidence. A command
  // that is empty or whitespace is not a command run — so proof needs at least
  // one NON-EMPTY command, not merely a non-empty array. Otherwise `--evidence-cmd
  // ""` dresses a bare self-report as evidence and clears the gate. Both this WRITE
  // gate and the verify READ gate judge proof through the SAME shared helper so the
  // two can never drift. The empties are dropped from what gets recorded, so the
  // audit artifact carries only the commands actually run.
  if (EVIDENCE_REQUIRED_STATUSES.includes(dispatch.status)) {
    const ev = dispatch.evidence;
    const realCommands = realEvidenceCommands(ev);
    if (!hasRealEvidence(ev)) {
      return {
        ok: false,
        code: "evidence-required",
        message: `status "${dispatch.status}" requires evidence — attach the command(s) run and a summary of what the output showed (never a bare self-report).`,
      };
    }
    dispatch = { ...dispatch, evidence: { ...ev, commands: realCommands } };
  }

  // 1b — SDD artifacts (#118): a unit routed to the FULL spec-kit flow cannot be
  // claimed `delivered` without its spec AND plan committed in the worktree.
  // Only `delivered` (the dev's done-claim, where 7/7 skipped the artifacts) is
  // gated — a fix loop (`dispatched`/`blocked`/`failed`/`redirected`) and the QA
  // `verified` are not, so the legitimate loop is never broken. Inert without an
  // injected resolver, exactly like the CI gate.
  //
  // How the route is decided, in order — and the ORDER is the fix. Deriving it
  // was the missing link: while the route came only from an explicit `--sdd`,
  // the gate was real code that never ran, because the dispatch prompt never
  // told anyone to type that flag. A gate you must opt into being bitten by is a
  // suggestion wearing a gate's clothes — the same shape as `--size` being
  // accepted and ignored.
  //   1. an EXPLICIT `--sdd` on this write, or sticky from the dispatch — a
  //      decision someone signed; it wins, including `sdd-lite` to claim trivial.
  //   2. otherwise DERIVED by the injected router from the unit's recorded
  //      `size`/`taskType`, the same router `aipe skill match` prints, so the
  //      gate and the advice can never disagree.
  // An undeclared size does not buy the floor (see routeSddForGate).
  const declaredKit = dispatch.sddKit ?? current?.sddKit;
  const declaredSize = dispatch.size ?? current?.size;
  const declaredType = dispatch.taskType ?? current?.taskType;
  const routedKit =
    declaredKit ??
    opts.routeSdd?.({
      ...(declaredSize ? { size: declaredSize } : {}),
      ...(declaredType ? { taskType: declaredType } : {}),
    }) ??
    undefined;
  // Whether this gate APPLIES is decided before, and independently of, whether it
  // CAN run. Folding the two together is what made an unwired gate look like an
  // inapplicable one.
  const sddApplies = dispatch.status === "delivered" && routedKit === GATED_SDD_KIT;
  let sddOutcome: GateOutcome = sddApplies ? (opts.resolveSddArtifacts ? "ok" : "not-checked") : "n/a";
  if (sddApplies && opts.resolveSddArtifacts) {
    const art = await opts.resolveSddArtifacts(dispatch.worktree);
    const missing: string[] = [];
    if (!art.spec) missing.push("a spec (specs/**/spec.md)");
    if (!art.plan) missing.push("a plan (specs/**/plan.md)");
    if (missing.length > 0) {
      // Say WHICH of the three ways this unit reached the full flow — routed by
      // a signed `--sdd`, derived from a declared size, or defaulted from
      // silence — because only the third is escapable by declaring, and a gate
      // that blurred them would affirm something it had not established.
      const origin = declaredKit
        ? `was routed to the full ${GATED_SDD_KIT} flow at dispatch`
        : declaredSize
          ? `is size ${declaredSize}, which routes to the full ${GATED_SDD_KIT} flow`
          : `falls to the full ${GATED_SDD_KIT} flow — no size and no route were ever declared for it, and undeclared is not established as trivial`;
      const escape = declaredKit || declaredSize
        ? ""
        : " If this unit really is trivial, say so on the record instead — re-record with `--size small` (or `--sdd sdd-lite`) and the claim is kept.";
      return {
        ok: false,
        code: "sdd-artifacts-required",
        message: `unit ${unitName} ${origin} — a "delivered" claim requires ${missing.join(" and ")} committed in the worktree. The spec-first flow is the delivery contract, not a suggestion (7/7 deliveries skipped it once it was only prose); what is demanded is those two ARTEFACTS, not any one harness's way of writing them (the repo carries Spec Kit's templates under .specify/); commit them, then re-record.${escape} (worktree ${dispatch.worktree})`,
      };
    }
  }

  // 1b-bis — #72, THE OTHER HALF OF THE SAME RULE. Today's gate already refuses
  // a specialist VERIFYING a delivery it made. This refuses the mirror: a
  // specialist DELIVERING on a task where it already sat as the QA.
  //
  // Both are one rule — "the reviewer and the builder are different people" —
  // and shipping only one half is the exact defect this repo keeps paying for:
  // fix one member of a family, leave the siblings. The rule existed in prose in
  // the review-delivery skill and was VIOLATED THREE TIMES IN ONE DAY (Donald
  // #252, Chuck #4, Viola #25). Prose is not a gate.
  //
  // Why it matters, in one line from the issue: if the QA fixes what it
  // reviewed, nobody reviewed the fix — the gate stops being a gate.
  //
  // Scoped to the task group, like every other gate here, and judged on the
  // EVIDENCE's authorship (`by: "qa"`), not on a name or a roster role: the
  // ledger's own record of who filed a QA verdict is the fact, and it is the
  // same field the verify gate reads.
  if (dispatch.status === "delivered") {
    const ranTheGate = gateRows.some(
      (d) =>
        d.specialist.toLowerCase() === dispatch.specialist.toLowerCase() &&
        (d.status === "verified" || d.status === "failed") &&
        d.evidence?.by === "qa",
    );
    if (ranTheGate) {
      return {
        ok: false,
        code: "reviewer-cannot-build",
        message: `unit ${unitName} — ${dispatch.specialist} already recorded a QA verdict on this task and cannot now deliver it. If the reviewer fixes what it reviewed, nobody reviewed the fix. Dispatch the fix to a builder; the QA re-tests it afterwards.`,
      };
    }
  }

  // 1c — THE QA CLOSURE. Three rules that together make "every finished task is
  // tested by the QA, against the spec, and re-tested after a fix" true by
  // refusal rather than by anyone's diligence.
  //
  // (i) A verdict needs something to judge. `verified` on a unit that is not
  // currently `delivered` is a pass issued over nothing — the shape that lets a
  // journey show green without a delivery ever having been examined.
  if (dispatch.status === "verified" && !gateRows.some((d) => d.status === "delivered")) {
    return {
      ok: false,
      code: "verify-needs-delivery",
      message: `unit ${unitName}${dispatch.task ? ` (task ${dispatch.task})` : " (no --task)"} has nothing delivered to verify — a QA verdict judges a DELIVERY, and no row with THIS task identity is currently "delivered". A verdict is paired with the delivery by (repo, package, task), so record it with the SAME --task the delivery used${dispatch.task ? "" : " — if the delivery carries one, this write must carry it too"}. A pass recorded over nothing is not a pass.`,
    };
  }

  // (ii) The QA is not the author. The evidence must be filed as the QA's, which
  // is the same principle as "QA does not fix what it reviews": whoever built it
  // already believes it works, so their own word cannot be the independent check.
  if (dispatch.status === "verified") {
    if (dispatch.evidence?.by !== "qa") {
      return {
        ok: false,
        code: "verify-needs-qa",
        message: `unit ${unitName} recorded a "verified" whose evidence is filed by "${dispatch.evidence?.by ?? "nobody"}" — a verification is the QA's independent check, not the builder's own word. Record it with \`--evidence-by qa\`.`,
      };
    }
    // `--evidence-by qa` is only a label, and the CLI even defaults it to "qa"
    // for this status — so on its own it certifies nothing. The check with teeth
    // is IDENTITY: the delivery being verified must have been made by someone
    // else. Whoever built it already believes it works; their own re-reading is
    // not an independent test, which is the same reason a QA never fixes what it
    // reviews. Measured: a dev and a QA both read `disableStdin: true`, agreed it
    // was "pre-existing design, not a regression", and shipped — and that was
    // with two people. One person wearing both hats has no second look at all.
    // `some`, never `every`: an independent QA proved that `every` evaporated the
    // moment a SECOND specialist also delivered on the unit — the builder could
    // then sign off on their own delivery. If you delivered anything here, you
    // are a builder of it, and you do not get to be its independent check.
    const deliveredBy = gateRows
      .filter((d) => d.status === "delivered")
      .map((d) => d.specialist.toLowerCase());
    if (deliveredBy.some((who) => who === dispatch.specialist.toLowerCase())) {
      return {
        ok: false,
        code: "verify-needs-qa",
        message: `unit ${unitName} — ${dispatch.specialist} is verifying a delivery ${dispatch.specialist} made. A verification is an INDEPENDENT check: record it as the unit's QA persona, not as the specialist who built it.`,
      };
    }
  }

  // (iii) Item by item, against the approved Task Spec. This is the one that
  // answers the measured failure: the acceptance criteria existed as free prose,
  // so the QA invented a PROXY for them — it proved a stream connected, it proved
  // a header summary changed — and the criterion the PE actually cared about was
  // never anyone's test. A blanket summary hides an untested criterion inside an
  // average; answering each label makes the hole visible and REFUSES it.
  const qaApplies = dispatch.status === "verified";
  let qaOutcome: GateOutcome = qaApplies ? (opts.resolveAcceptance ? "ok" : "not-checked") : "n/a";
  if (qaApplies && opts.resolveAcceptance) {
    const criteria = await opts.resolveAcceptance({ repo: dispatch.repo, ...(pkg ? { package: pkg } : {}) });
    if (criteria.kind === "unestablished") {
      return {
        ok: false,
        code: "verification-incomplete",
        message: `unit ${unitName} has a Task Spec whose criteria cannot be established — ${criteria.why}. A verification is judged against the criteria the PE approved, so an approved spec that has since been edited or removed does not lower the bar to nothing: restore it, or have the PE re-approve the amendment, then record the verdict.`,
      };
    }
    const labels = criteria.kind === "criteria" ? criteria.labels : [];
    if (labels.length === 0) qaOutcome = "n/a";
    if (labels.length > 0) {
      const covered = new Set(realVerifiedItems(dispatch.evidence).map((i) => i.label));
      const missing = labels.filter((l) => !covered.has(l));
      if (missing.length > 0) {
        return {
          ok: false,
          code: "verification-incomplete",
          message: `unit ${unitName} was verified without covering every acceptance criterion in its approved Task Spec. ${missing.map((l) => `!NO-EVIDENCE ${l}`).join(" · ")} — each criterion carries the test the QA runs, agreed before the code; answer them one by one with \`--verify-item <label> --verify-cmd "<what you ran>" --verify-summary "<what it showed>"\`. A criterion with no evidence is untested, not passed.`,
        };
      }
    }
  }

  // (iv) A merge claims the work is finished, so it must carry a QA pass for THIS
  // round. `verifiedRound < round` means the unit was reworked after its last
  // pass — the fix loop ran and nobody re-tested it. That is exactly the
  // "specialist adjusts → QA re-tests" loop, enforced instead of hoped for.
  // No `gateRows.length > 0` guard: a `merged` recorded straight into a ledger
  // that carries no delivery and no verdict for this task is the emptiest case of
  // all, not an exempt one. It used to skip the gate entirely — an independent QA
  // landed a merge into a fresh ledger in one command.
  if (dispatch.status === "merged" && gateVerifiedRound < gateRound) {
    return {
      ok: false,
      code: "merge-needs-qa",
      message: gateVerifiedRound === 0
        ? `unit ${unitName} is being recorded "merged" but no QA has verified it — every finished task is tested before it lands. Have the QA record \`--status verified --evidence-by qa\` against this task first (same --task, a different specialist). If the work was tracked in another journey, record its delivery and verdict here too: a merge with no history is a merge nobody can show was tested.`
        : `unit ${unitName} is being recorded "merged" but its last QA pass was round ${gateVerifiedRound} and it is now on round ${gateRound} — it was reworked after that pass and owes a RE-TEST. A fix does not inherit the approval of the code it replaced.`,
    };
  }

  // 2 — immutability: a merged unit is final.
  if (current && IMMUTABLE_STATUSES.includes(current.status)) {
    return {
      ok: false,
      code: "unit-immutable",
      message: `unit ${dispatch.repo}${pkg ? `/${pkg}` : ""} is already "${current.status}" — a merged unit is intocável and never re-recorded.`,
    };
  }

  // 3 — no silent re-dispatch: reopening finished work needs a reason.
  // Reopening = FINISHED WORK BEING REDONE. Two shapes qualify, and one that
  // looks similar does not:
  //   • this specialist already has a row here → their own work is being redone;
  //   • the task already carries a QA verdict (`verified`) → anyone dispatched
  //     after a pass is redoing work that had been signed off.
  // But a specialist with NO row here arriving while the task sits at
  // `delivered` is not a redo — that is the QA showing up to review it. Treating
  // that as a re-dispatch refused the QA's own dispatch for want of a `--reason`,
  // which is why the gate previously "worked" only when the QA was filed under a
  // task of its own, where its verdict paired with nothing.
  const reopening =
    dispatch.status === "dispatched" && !!current && (current.status === "delivered" || current.status === "verified");
  if (reopening && !opts.reason?.trim()) {
    return {
      ok: false,
      code: "redispatch-needs-reason",
      message: `unit ${dispatch.repo}${pkg ? `/${pkg}` : ""} was already "${current!.status}" — dispatching onto it needs --reason, so finished work is never silently redone. A fix loop or a deliberate redo says which; the QA arriving to gate this delivery says so too (--reason "QA gate"). Keying this on "has no row yet" instead of a reason was tried and let a DIFFERENT specialist silently redo finished work.`,
    };
  }
  // 4 — no-reasonless-redirect: the whole value of a `redirected` record is
  // the reason — what the PE asked for, live — so the coordinator can
  // reconcile the Orientation Spec against it. A redirect that records
  // nothing useful is close to no record at all, so it is rejected the same
  // way an undocumented re-dispatch is, rather than accepted as silent noise.
  if (dispatch.status === "redirected" && !opts.reason?.trim()) {
    return {
      ok: false,
      code: "redirect-needs-reason",
      message: `unit ${dispatch.repo}${pkg ? `/${pkg}` : ""} is being recorded "redirected" — --reason is required (what the PE asked for, live), so the coordinator can reconcile the Orientation Spec instead of silently drifting from what is actually being built.`,
    };
  }
  // 4b — a blocked signal is worthless without what it needs. The whole point of
  // `blocked` is to tell the coordinator what to answer, so a blocked record
  // with no reason is refused exactly as a reasonless redirect is.
  if (dispatch.status === "blocked" && !opts.reason?.trim()) {
    return {
      ok: false,
      code: "blocked-needs-reason",
      message: `unit ${dispatch.repo}${pkg ? `/${pkg}` : ""} is being recorded "blocked" — --reason is required (what you are stuck on and what you need), so the coordinator can act on it without reading your terminal.`,
    };
  }
  // 4c — D4 (j-20260830-w0): `abandoned` exists ONLY to say "this session ended
  // with no verdict" — without a reason it is exactly the same silence it was
  // introduced to replace, so it is refused the same way a reasonless
  // redirect/blocked is.
  if (dispatch.status === "abandoned" && !opts.reason?.trim()) {
    return {
      ok: false,
      code: "abandoned-needs-reason",
      message: `unit ${dispatch.repo}${pkg ? `/${pkg}` : ""} is being recorded "abandoned" — --reason is required (what established there is no verdict, e.g. the session is gone with nothing recorded), so this never reads as a silent, unexplained non-answer.`,
    };
  }

  // 5 — CI gate: a done-claim (delivered/verified) that names a PR must have a
  // GREEN workflow. Prose in a brief did not hold ("do not ship against red
  // CI"); this makes green CI part of what the ledger physically accepts. Runs
  // only when a resolver is injected AND the record names a PR — a resolver-less
  // caller (the reconciler, the other-gate unit tests) leaves this inert rather
  // than fabricating a pass, and a done-claim with no PR has nothing to resolve.
  // The resolution is five-way (see CheckVerdict) so "still running" is neither
  // "passed" nor "failed", and an unreachable forge abstains rather than guesses.
  let ciBypass: JourneyDispatch["ciBypass"];
  const ciApplies = !!dispatch.pr && CI_GATED_STATUSES.includes(dispatch.status);
  let ciOutcome: GateOutcome = ciApplies ? (opts.resolveChecks ? "ok" : "not-checked") : "n/a";
  // `dispatch.pr` re-tested inline so TypeScript narrows it; `ciApplies` above
  // carries the same condition for the report.
  if (opts.resolveChecks && dispatch.pr && CI_GATED_STATUSES.includes(dispatch.status)) {
    const { verdict, detail } = resolveVerdict(await opts.resolveChecks(dispatch.pr));
    if (verdict === "red") {
      return {
        ok: false,
        code: "ci-red",
        message: `unit ${unitName} — PR checks are FAILING (red). A green workflow is part of the delivery contract; fix CI and re-record. (${dispatch.pr})`,
      };
    }
    if (verdict === "pending") {
      return {
        ok: false,
        code: "ci-pending",
        message: `unit ${unitName} — PR checks have not concluded (still running). Wait for the workflow to finish, then record — "still running" is not "passed". (${dispatch.pr})`,
      };
    }
    if (verdict === "none") {
      // A repo with no checks configured is legitimate — but never bypass CI
      // silently. Require the explicit, recorded --ci-none so an audit can see
      // the claim was made on purpose. The flag ONLY upgrades a resolved "none":
      // it never reaches the red/pending/unknown branches above and below, so it
      // can neither mask a failing/running workflow nor substitute for a verdict
      // the gate could not obtain.
      if (opts.ciNone) {
        ciBypass = "no-checks";
      } else {
        return {
          ok: false,
          code: "ci-none",
          message: `unit ${unitName} — the PR reports no CI checks. If this repo has none configured, record deliberately with --ci-none so the bypass lands on the ledger; CI is never bypassed silently. (${dispatch.pr})`,
        };
      }
    } else if (verdict === "unknown") {
      // D2 (j-20260830-w0) — an honest escape hatch for "checks were verified
      // green before this PR merged and are no longer queryable" that is NOT
      // `--ci-none`: that flag makes a specific, different claim ("this repo
      // has no CI configured"), which is false whenever CI genuinely exists —
      // the exact misuse the abstention used to push operators toward.
      if (opts.ciVerifiedPreMerge) {
        if (!opts.reason?.trim()) {
          return {
            ok: false,
            code: "ci-verified-pre-merge-needs-reason",
            message: `unit ${unitName} — --ci-verified-pre-merge requires --reason (when/how the checks were seen green before merge), so the claim lands on the ledger for audit, not as a bare assertion.`,
          };
        }
        ciBypass = "verified-pre-merge";
      } else {
        return {
          ok: false,
          code: "ci-unresolvable",
          message: `unit ${unitName} — could not resolve PR checks: ${detail ?? "no detail available"}. The gate abstains rather than guess green. If checks were verified green before this PR merged and gh can no longer resolve them (e.g. the branch was deleted), record with --ci-verified-pre-merge --reason "<when/how you saw them green>" instead of --ci-none. (${dispatch.pr})`,
        };
      }
    }
    // verdict === "green" → fall through and record.
  }

  // Reopening a finished unit is a genuine restart of its work, not an update
  // to it: `pr`/`evidence` are already dropped by mergeDispatch above (they
  // are not sticky, and this write's `dispatch` never carries them for a
  // plain `--status dispatched --reason "..."` redispatch). `sessionId` IS
  // sticky, though — and a stale one left in place here would silently break
  // the redispatch: `dispatchCommand`'s pending filter is
  // `mode === "session" && status === "dispatched" && !sessionId`, so a unit
  // still carrying its OLD session id would never be picked up for a NEW
  // `aipe session dispatch` call. Force it out explicitly (present-but-
  // `undefined` — mergeDispatch treats that as "clear", not "inherit").
  // Clearing the session id is for a STALE one: this specialist's previous
  // session, which `dispatchCommand`'s pending filter would otherwise skip
  // (`status === "dispatched" && !sessionId`). It must not fire when the row is
  // NEW — the QA arriving to gate a delivered task is a reopening write by the
  // reason rule, and blanking its id threw away the session it had just been
  // given, leaving `collect` and the close path blind to it.
  const toWrite: JourneyDispatch = reopening
    ? { ...dispatch, ...(selfRow ? { sessionId: undefined } : {}), redispatchReason: opts.reason!.trim() }
    : dispatch.status === "redirected"
      ? { ...dispatch, redirectReason: opts.reason!.trim() }
      : dispatch.status === "blocked"
        ? { ...dispatch, blockedReason: opts.reason!.trim() }
        : dispatch.status === "abandoned"
          ? { ...dispatch, abandonedReason: opts.reason!.trim() }
          : ciBypass
            ? { ...dispatch, ciBypass }
            : dispatch;

  // The fix-loop round, maintained by the ledger and by nobody else (no flag
  // sets it; see the Exclude list in session/cli.ts). Reopening finished work
  // starts a new round, and a `verified` stamps the round whose delivery it just
  // examined. Those two writes are what make "the QA re-tests after a fix" a
  // fact the merge gate can check, instead of a habit.
  //
  // `reopening` is the delivered/verified→dispatched transition the reason-gate
  // already names. A failed→dispatched fix loop counts too: the QA rejected it,
  // the code changes, and the old pass must not survive that.
  const restarting = reopening || (dispatch.status === "dispatched" && current?.status === "failed");

  // A round also opens when work is re-DELIVERED onto a task that already
  // carries a verdict for the current round. The round used to move only on the
  // `dispatched` transition, so a dev who simply recorded `delivered` again —
  // which operate/SKILL.md itself documents, to attach the PR url — kept round 1
  // and inherited the QA's round-1 pass for a rewrite nobody re-tested. The
  // verdict is what closes a round; delivering after one starts the next.
  const hasVerdictThisRound = gateRows.some(
    (d) => (d.status === "verified" || d.status === "failed") && (d.round ?? 1) >= gateRound,
  );
  const bumpsRound = restarting || (dispatch.status === "delivered" && hasVerdictThisRound);
  const withRound: JourneyDispatch = bumpsRound
    ? { ...toWrite, round: gateRound + 1 }
    : dispatch.status === "verified"
      ? { ...toWrite, round: gateRound, verifiedRound: gateRound }
      : { ...toWrite, round: selfRow?.round ?? gateRound };

  const path = await recordDispatch(workspaceDir, id, withRound);
  return { ok: true, path, gates: { sdd: sddOutcome, ci: ciOutcome, qa: qaOutcome } };
}
