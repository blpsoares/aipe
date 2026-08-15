// Enumerates and PRICES the viable ways to run one unit. It never chooses —
// the choice, and the reasoning behind it, belong to the coordinator, which
// has context this code does not (that this bugfix touches auth, that this
// unit depends on a contract not yet landed).
import { getAdapter, hasAdapter } from "../harness/registry";
import { isContainable } from "../harness/types";
import { TIERS, type ModelTier } from "../model/types";
import type { Capabilities } from "../capabilities/types";
import { costIndex } from "./cost";
import type { Envelope, ExecutionPolicy, Intensity, PricedEnvelope, UnitProposal } from "./types";

const MODES: Envelope["mode"][] = ["subagent", "session"];
const INTENSITIES: Intensity[] = ["normal", "ultracode"];

function gateReasonsFor(env: Envelope, policy: ExecutionPolicy): string[] {
  const reasons: string[] = [];
  if (policy.gatedIntensities.includes(env.intensity)) {
    reasons.push(`intensity ${env.intensity} requires your authorization`);
  }
  if (policy.gatedTiers.includes(env.tier)) {
    reasons.push(`tier ${env.tier} requires your authorization`);
  }
  return reasons;
}

export interface ProposeOptions {
  // Restrict to these harness ids (e.g. the PE pinned one). Absent = all present.
  harnesses?: string[];
}

export function proposeForUnit(
  fqid: string,
  caps: Capabilities,
  policy: ExecutionPolicy,
  opts: ProposeOptions,
): UnitProposal {
  const options: PricedEnvelope[] = [];
  const excluded: { harness: string; reason: string }[] = [];

  for (const cap of caps.harnesses) {
    if (opts.harnesses && !opts.harnesses.includes(cap.id)) continue;

    if (!cap.present) {
      excluded.push({ harness: cap.id, reason: "not present on this machine" });
      continue;
    }

    // `getAdapter` falls back to the claude-code adapter for an id it does
    // not recognize, so `isContainable(getAdapter("nonsense"))` would return
    // `true` for a harness that isn't actually registered. Check the
    // registry directly, before ever asking about containment, so an
    // unrecognized id can never masquerade as the (containable) default.
    if (!hasAdapter(cap.id)) {
      excluded.push({ harness: cap.id, reason: "unknown harness — no adapter registered for this id" });
      continue;
    }

    // Consult the single authority; never keep a second opinion.
    const containable = isContainable(getAdapter(cap.id));
    if (!containable) {
      excluded.push({
        harness: cap.id,
        reason: "not containable — AIPe never starts a session it cannot govern",
      });
    }

    for (const mode of MODES) {
      // Containment only gates SESSION mode; subagent mode is always offered
      // for a present, recognized harness.
      if (mode === "session" && !containable) continue;
      for (const tier of TIERS as ModelTier[]) {
        for (const intensity of INTENSITIES) {
          const envelope: Envelope = { mode, harness: cap.id, tier, intensity };
          const reasons = gateReasonsFor(envelope, policy);
          options.push({
            envelope,
            costIndex: costIndex(envelope),
            gated: reasons.length > 0,
            gateReasons: reasons,
          });
        }
      }
    }
  }

  // Cheapest first: the default reading of this list should be the cheap one.
  options.sort((a, b) => a.costIndex - b.costIndex);
  return { fqid, options, excluded };
}
