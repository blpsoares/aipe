import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import type { JourneyDispatch, JourneyLedger } from "./types";

function ledgerPath(workspaceDir: string, id: string): string {
  return join(workspaceDir, ".aipe", "journeys", `${id}.yaml`);
}

export async function readLedger(workspaceDir: string, id: string): Promise<JourneyLedger | null> {
  try {
    const raw = await readFile(ledgerPath(workspaceDir, id), "utf8");
    const parsed = parse(raw);
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.dispatches)) {
      return { id, dispatches: parsed.dispatches as JourneyDispatch[] };
    }
  } catch {
    // missing or malformed → treated as absent
  }
  return null;
}

async function writeLedger(workspaceDir: string, ledger: JourneyLedger): Promise<string> {
  const path = ledgerPath(workspaceDir, ledger.id);
  await mkdir(join(workspaceDir, ".aipe", "journeys"), { recursive: true });
  await writeFile(path, stringify({ id: ledger.id, dispatches: ledger.dispatches }), "utf8");
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
