import type { HarnessAdapter } from "../harness/types";
import type { DispatchGate, ModelPolicy, ModelTier } from "./types";

export interface ResolvedModel {
  tier: ModelTier;
  model: string | null; // concrete id, or null when the harness has no mapping
  label: string | null;
  requiresAuth: boolean;
}

// Resolves a tier to its concrete model (via the harness adapter) and whether
// the policy requires PE authorization for it. Pure — no journey state.
export function resolveModel(policy: ModelPolicy, adapter: HarnessAdapter, tier: ModelTier): ResolvedModel {
  const m = adapter.resolveModel(tier);
  return {
    tier,
    model: m?.id ?? null,
    label: m?.label ?? null,
    requiresAuth: policy.authorizationTiers.includes(tier),
  };
}

// The gate for actually dispatching this tier: "needs-authorization" when the
// tier requires auth AND no matching grant exists yet; otherwise "ok".
export function gateFor(policy: ModelPolicy, tier: ModelTier, grantedTiers: Set<string>): DispatchGate {
  if (policy.authorizationTiers.includes(tier) && !grantedTiers.has(tier)) {
    return "needs-authorization";
  }
  return "ok";
}
