// The model-policy layer. Tiers are abstract (portable across harnesses); each
// HarnessAdapter maps a tier to a concrete model id. Gates are adjudicated by
// deterministic CLI (like the dispatch law); the coordinator's judgment (which
// tier a task needs) and the act of asking/telling the PE live in SKILL prose.

export type ModelTier = "fast" | "standard" | "reasoning" | "frontier";

export const TIERS: ModelTier[] = ["fast", "standard", "reasoning", "frontier"];

export function isTier(v: unknown): v is ModelTier {
  return typeof v === "string" && (TIERS as string[]).includes(v);
}

// A gate on a tier: "authorization" blocks a dispatch until the PE grants it;
// "notify" never blocks but raises a signal past a threshold.
export type GateKind = "authorization" | "notify";

export interface ModelPolicy {
  default: ModelTier;
  // tiers that require explicit PE authorization before a dispatch may use them.
  authorizationTiers: ModelTier[];
  // per-journey dispatch-count threshold for the "notify PE" volume gate on the
  // reasoning (Opus) tier.
  reasoningNotifyMaxDispatches: number;
}

export type DispatchGate = "ok" | "needs-authorization";
export type VolumeStatus = "ok" | "notify";
