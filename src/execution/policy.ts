import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import { SESSION_MAX_CONCURRENT } from "../dispatch/types";
import { isTier, type ModelTier } from "../model/types";
import type { ExecutionPolicy, Intensity } from "./types";

export function defaultExecutionPolicy(): ExecutionPolicy {
  return {
    maxSessionsPerWave: SESSION_MAX_CONCURRENT,
    gateAboveSessions: 2,
    gatedIntensities: ["ultracode"],
    gatedTiers: ["frontier"],
    maxCostIndexPerWave: 24,
  };
}

function positive(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
}

export async function readExecutionPolicy(workspaceDir: string): Promise<ExecutionPolicy> {
  const base = defaultExecutionPolicy();
  let parsed: unknown;
  try {
    parsed = parse(await readFile(join(workspaceDir, ".aipe", "execution-policy.yaml"), "utf8"));
  } catch {
    return base;
  }
  // Explicit, not accidental: a top-level array is `typeof === "object"` too,
  // so without this check every field below would fall through to the
  // default via property access on an array (e.g. `[].maxSessionsPerWave`
  // is `undefined`) — correct behaviour arrived at by luck, not by design.
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return base;
  const p = parsed as Record<string, unknown>;
  const merged: ExecutionPolicy = { ...base };

  // Clamped, never raised: the dispatch law's ceiling is the hard limit and a
  // policy file must not be able to talk past it.
  const maxSessions = positive(p.maxSessionsPerWave);
  if (maxSessions !== null) merged.maxSessionsPerWave = Math.min(maxSessions, SESSION_MAX_CONCURRENT);

  const gateAbove = positive(p.gateAboveSessions);
  if (gateAbove !== null) merged.gateAboveSessions = gateAbove;

  const maxCost = positive(p.maxCostIndexPerWave);
  if (maxCost !== null) merged.maxCostIndexPerWave = maxCost;

  if (Array.isArray(p.gatedTiers)) {
    const tiers = p.gatedTiers.filter(isTier) as ModelTier[];
    if (tiers.length > 0) merged.gatedTiers = tiers;
  }
  if (Array.isArray(p.gatedIntensities)) {
    const list = p.gatedIntensities.filter(
      (i): i is Intensity => i === "normal" || i === "ultracode",
    );
    if (list.length > 0) merged.gatedIntensities = list;
  }

  // A wave can never exceed maxSessionsPerWave, so a gate at or above that
  // ceiling can never fire -- it reads as a limit but permits every wave
  // through, the same "dead field" defect one level up. The safe direction
  // for a field whose job is "this needs a signature" is to gate MORE, never
  // less, so a nonsensical (too-high) value is clamped down, not ignored and
  // not left to silently disable the gate.
  if (merged.gateAboveSessions >= merged.maxSessionsPerWave) {
    merged.gateAboveSessions = Math.max(0, merged.maxSessionsPerWave - 1);
  }

  return merged;
}
