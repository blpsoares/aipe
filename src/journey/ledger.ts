import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse, stringify } from "yaml";
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

// Upserts a dispatch by (repo, specialist), preserving every other dispatch.
export async function recordDispatch(
  workspaceDir: string,
  id: string,
  dispatch: JourneyDispatch,
): Promise<string> {
  const ledger = (await readLedger(workspaceDir, id)) ?? { id, dispatches: [] };
  const idx = ledger.dispatches.findIndex(
    (d) => d.repo === dispatch.repo && (d.package ?? null) === (dispatch.package ?? null) && d.specialist === dispatch.specialist,
  );
  if (idx >= 0) ledger.dispatches[idx] = dispatch;
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
//
// The guard keys on the UNIT (repo + package), not the specialist — a fix can
// reuse or swap the specialist and the invariant still holds.
export type LedgerGateCode = "evidence-required" | "unit-immutable" | "redispatch-needs-reason";

export interface GuardedRecordResult {
  ok: boolean;
  code?: LedgerGateCode;
  message?: string;
  path?: string;
}

function unitStatus(ledger: JourneyLedger, repo: string, pkg: string | null): JourneyDispatch | undefined {
  // The most advanced record for this unit (any specialist), to judge transitions.
  const rank: Record<string, number> = { removed: 0, dispatched: 1, failed: 2, escalated: 2, delivered: 3, verified: 4, merged: 5 };
  return ledger.dispatches
    .filter((d) => d.repo === repo && (d.package ?? null) === pkg)
    .sort((a, b) => (rank[b.status] ?? 0) - (rank[a.status] ?? 0))[0];
}

export async function recordDispatchGuarded(
  workspaceDir: string,
  id: string,
  dispatch: JourneyDispatch,
  opts: { reason?: string } = {},
): Promise<GuardedRecordResult> {
  const ledger = (await readLedger(workspaceDir, id)) ?? { id, dispatches: [] };
  const pkg = dispatch.package ?? null;
  const current = unitStatus(ledger, dispatch.repo, pkg);

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
  const toWrite: JourneyDispatch = reopening ? { ...dispatch, redispatchReason: opts.reason!.trim() } : dispatch;

  const path = await recordDispatch(workspaceDir, id, toWrite);
  return { ok: true, path };
}
