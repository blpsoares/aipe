import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import type { JourneyAuthorization, JourneyDispatch, JourneyLedger } from "./types";

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
      return { id, dispatches: parsed.dispatches as JourneyDispatch[], authorizations };
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
    stringify({ id: ledger.id, dispatches: ledger.dispatches, authorizations: ledger.authorizations ?? [] }),
    "utf8",
  );
  return path;
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
    (d) => d.repo === dispatch.repo && d.specialist === dispatch.specialist,
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
