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

  // A genuinely empty `caps.harnesses` — zero entries, not "every entry
  // present: false" — means there was nothing to enumerate in the first
  // place: no probe ever ran, or `readCapabilities` dropped every entry as
  // malformed. That calls for a different human action (re-probe this
  // machine) than "recorded but none usable" does (install/authorize a
  // harness), so it gets its own excluded entry instead of silently falling
  // out of a loop that never runs. Without this, the proposal would come
  // back completely empty and unexplained — indistinguishable from a bug.
  if (caps.harnesses.length === 0) {
    excluded.push({
      harness: "(none)",
      reason: "no harnesses recorded for this machine — capabilities were never probed, or every recorded entry was dropped as invalid; re-probe before proposing",
    });
  }

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
