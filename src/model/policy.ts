import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import { isTier, type ModelPolicy, type ModelTier } from "./types";

// PE-confirmed defaults: standard=Sonnet (Opus is the deliberate `reasoning`
// escalation the volume gate watches); frontier requires authorization; the Opus
// volume gate notifies past 8 reasoning dispatches per journey.
export function defaultPolicy(): ModelPolicy {
  return {
    default: "standard",
    authorizationTiers: ["frontier"],
    reasoningNotifyMaxDispatches: 8,
  };
}

// Reads .aipe/model-policy.yaml and merges it over the defaults. The file is an
// override, not a requirement — absent/malformed → defaults.
export async function readPolicy(workspaceDir: string): Promise<ModelPolicy> {
  const base = defaultPolicy();
  let parsed: unknown;
  try {
    parsed = parse(await readFile(join(workspaceDir, ".aipe", "model-policy.yaml"), "utf8"));
  } catch {
    return base;
  }
  if (!parsed || typeof parsed !== "object") return base;
  const p = parsed as Record<string, unknown>;

  const merged: ModelPolicy = { ...base };
  if (isTier(p.default)) merged.default = p.default;

  // gates: { <tier>: "authorization" | "notify" } → collect the authorization tiers
  if (p.gates && typeof p.gates === "object") {
    const auth: ModelTier[] = [];
    for (const [tier, kind] of Object.entries(p.gates as Record<string, unknown>)) {
      if (isTier(tier) && kind === "authorization") auth.push(tier);
    }
    if (auth.length > 0) merged.authorizationTiers = auth;
  }

  // notify: { reasoning: { maxDispatches: N } }
  const notify = (p.notify as Record<string, unknown> | undefined)?.reasoning as
    | Record<string, unknown>
    | undefined;
  if (notify && typeof notify.maxDispatches === "number" && notify.maxDispatches >= 0) {
    merged.reasoningNotifyMaxDispatches = notify.maxDispatches;
  }

  return merged;
}
