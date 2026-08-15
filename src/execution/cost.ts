// A COARSE RELATIVE INDEX, never currency. The CHEAPEST envelope — subagent +
// `fast` + `normal` — is 1, and every other combination is a whole multiple of
// it. The reference is the cheapest rather than a mid-tier one so that every
// tier stays a distinct integer: anchoring at `standard` and dividing collapses
// `fast` and `standard` onto the same value.
// AIPe cannot know a token price, a plan, or a rate limit, so any
// figure that looked like money would be fabricated. The index exists to make
// RELATIVE choices legible — that ultracode across four session units is an
// order of magnitude above one subagent — not to predict a bill.
import type { Envelope, Intensity } from "./types";
import type { ModelTier } from "../model/types";

// A detached session carries its own full context window, so it reads and
// re-reads more than a subagent sharing the coordinator's.
export const MODE_MULTIPLIER: Record<Envelope["mode"], number> = {
  subagent: 1,
  session: 2,
};

export const TIER_MULTIPLIER: Record<ModelTier, number> = {
  fast: 1,
  standard: 2,
  reasoning: 4,
  frontier: 6,
};

// ultracode makes the specialist orchestrate multi-agent workflows: it does not
// scale the unit, it multiplies the number of agents inside it.
export const INTENSITY_MULTIPLIER: Record<Intensity, number> = {
  normal: 1,
  ultracode: 8,
};

export function costIndex(envelope: Envelope): number {
  // No normalisation: every multiplier is a whole number and the cheapest
  // envelope already lands on 1, so the product is the index.
  return (
    MODE_MULTIPLIER[envelope.mode] *
    TIER_MULTIPLIER[envelope.tier] *
    INTENSITY_MULTIPLIER[envelope.intensity]
  );
}

export function waveCostIndex(envelopes: Envelope[]): number {
  return envelopes.reduce((sum, e) => sum + costIndex(e), 0);
}
