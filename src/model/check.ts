import type { JourneyLedger } from "../journey/types";
import type { ModelPolicy, VolumeStatus } from "./types";

export interface VolumeCheck {
  reasoningDispatches: number;
  threshold: number;
  status: VolumeStatus;
}

// The "exorbitant Opus" volume gate: counts reasoning-tier dispatches in one
// journey and compares to the policy threshold. `notify` means the coordinator
// must tell the PE before continuing (it never blocks). Pure — the ledger is
// the only input, so no usage/cost feed is needed.
export function checkVolume(policy: ModelPolicy, ledger: JourneyLedger | null): VolumeCheck {
  const reasoningDispatches = (ledger?.dispatches ?? []).filter((d) => d.tier === "reasoning").length;
  const threshold = policy.reasoningNotifyMaxDispatches;
  return {
    reasoningDispatches,
    threshold,
    status: reasoningDispatches > threshold ? "notify" : "ok",
  };
}
