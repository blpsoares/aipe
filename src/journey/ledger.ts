import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import type { PrChecksResolver } from "./checks";
import {
  EVIDENCE_REQUIRED_STATUSES,
  IMMUTABLE_STATUSES,
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
      };
    }
  } catch {
    // missing or malformed → treated as absent
  }
  return null;
}

async function writeLedger(workspaceDir: string, ledger: JourneyLedger): Promise<string> {
  const path = ledgerPath(workspaceDir, ledger.id);
  await mkdir(join(workspaceDir, ".aipe", "journeys"), { recursive: true });
  await writeFile(
    path,
    stringify({
      id: ledger.id,
      dispatches: ledger.dispatches,
      authorizations: ledger.authorizations ?? [],
      ...(ledger.spec ? { spec: ledger.spec } : {}),
    }),
    "utf8",
  );
  return path;
}

// Sets/updates the journey's Orientation Spec metadata, preserving dispatches.
export async function setJourneySpec(workspaceDir: string, id: string, spec: JourneySpec): Promise<string> {
  const ledger = (await readLedger(workspaceDir, id)) ?? { id, dispatches: [] };
  return writeLedger(workspaceDir, { ...ledger, spec });
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
const STICKY_DISPATCH_FIELDS = ["tier", "model", "mode", "intensity", "harness", "sessionId"] as const;

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
    (d) => d.repo === dispatch.repo && (d.package ?? null) === (dispatch.package ?? null) && d.specialist === dispatch.specialist,
  );
  if (idx >= 0) ledger.dispatches[idx] = mergeDispatch(ledger.dispatches[idx], dispatch);
  else ledger.dispatches.push(dispatch);
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
  if (!ledger.authorizations.some((a) => a.tier === auth.tier)) {
    ledger.authorizations.push(auth);
  }
  return writeLedger(workspaceDir, ledger);
}

export function grantedTiers(ledger: JourneyLedger | null): Set<string> {
  return new Set((ledger?.authorizations ?? []).map((a) => a.tier));
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
export type LedgerGateCode =
  | "evidence-required"
  | "unit-immutable"
  | "redispatch-needs-reason"
  | "redirect-needs-reason"
  | "blocked-needs-reason"
  | "ci-red"
  | "ci-pending"
  | "ci-none"
  | "ci-unresolvable";

export interface GuardedRecordResult {
  ok: boolean;
  code?: LedgerGateCode;
  message?: string;
  path?: string;
}

function unitStatus(ledger: JourneyLedger, repo: string, pkg: string | null): JourneyDispatch | undefined {
  // The most advanced record for this unit (any specialist), to judge transitions.
  // Kept in lockstep with the identical table in journey/verify.ts (see its
  // comment): `redirected` ranks with `failed`/`escalated` — a live redirect
  // must outrank a stale `dispatched` record from another specialist on the
  // same unit when judging the unit's most-advanced state.
  const rank: Record<string, number> = { removed: 0, dispatched: 1, failed: 2, escalated: 2, redirected: 2, blocked: 2, delivered: 3, verified: 4, merged: 5 };
  return ledger.dispatches
    .filter((d) => d.repo === repo && (d.package ?? null) === pkg)
    .sort((a, b) => (rank[b.status] ?? 0) - (rank[a.status] ?? 0))[0];
}

export async function recordDispatchGuarded(
  workspaceDir: string,
  id: string,
  dispatch: JourneyDispatch,
  opts: { reason?: string; resolveChecks?: PrChecksResolver; ciNone?: boolean } = {},
): Promise<GuardedRecordResult> {
  const ledger = (await readLedger(workspaceDir, id)) ?? { id, dispatches: [] };
  const pkg = dispatch.package ?? null;
  const current = unitStatus(ledger, dispatch.repo, pkg);
  const unitName = `${dispatch.repo}${pkg ? `/${pkg}` : ""}`;

  // 1 — verify-before-done: claiming done requires attached evidence.
  if (EVIDENCE_REQUIRED_STATUSES.includes(dispatch.status)) {
    const ev = dispatch.evidence;
    const hasProof = !!ev && Array.isArray(ev.commands) && ev.commands.length > 0 && !!ev.summary?.trim();
    if (!hasProof) {
      return {
        ok: false,
        code: "evidence-required",
        message: `status "${dispatch.status}" requires evidence — attach the command(s) run and a summary of what the output showed (never a bare self-report).`,
      };
    }
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
  const reopening = dispatch.status === "dispatched" && current && (current.status === "delivered" || current.status === "verified");
  if (reopening && !opts.reason?.trim()) {
    return {
      ok: false,
      code: "redispatch-needs-reason",
      message: `unit ${dispatch.repo}${pkg ? `/${pkg}` : ""} was already "${current!.status}" — re-dispatching it needs --reason (a fix loop or a deliberate redo), so finished work is never silently redone.`,
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

  // 5 — CI gate: a done-claim (delivered/verified) that names a PR must have a
  // GREEN workflow. Prose in a brief did not hold ("do not ship against red
  // CI"); this makes green CI part of what the ledger physically accepts. Runs
  // only when a resolver is injected AND the record names a PR — a resolver-less
  // caller (the reconciler, the other-gate unit tests) leaves this inert rather
  // than fabricating a pass, and a done-claim with no PR has nothing to resolve.
  // The resolution is five-way (see CheckVerdict) so "still running" is neither
  // "passed" nor "failed", and an unreachable forge abstains rather than guesses.
  let ciBypass: JourneyDispatch["ciBypass"];
  if (opts.resolveChecks && dispatch.pr && EVIDENCE_REQUIRED_STATUSES.includes(dispatch.status)) {
    const verdict = await opts.resolveChecks(dispatch.pr);
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
      return {
        ok: false,
        code: "ci-unresolvable",
        message: `unit ${unitName} — could not resolve PR checks (gh missing, unauthenticated, offline, or an unqueryable host). The gate abstains rather than guess green; make the checks resolvable and retry. (${dispatch.pr})`,
      };
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
  const toWrite: JourneyDispatch = reopening
    ? { ...dispatch, sessionId: undefined, redispatchReason: opts.reason!.trim() }
    : dispatch.status === "redirected"
      ? { ...dispatch, redirectReason: opts.reason!.trim() }
      : dispatch.status === "blocked"
        ? { ...dispatch, blockedReason: opts.reason!.trim() }
        : ciBypass
          ? { ...dispatch, ciBypass }
          : dispatch;

  const path = await recordDispatch(workspaceDir, id, toWrite);
  return { ok: true, path };
}
