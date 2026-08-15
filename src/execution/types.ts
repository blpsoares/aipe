import type { ModelTier } from "../model/types";
// Reuse, never redefine: `src/session/types.ts` already owns these two unions
// and the ledger is written against them. A second copy here would diverge the
// first time one of them gains a member.
import type { Intensity, SessionMode } from "../session/types";

export type { Intensity, SessionMode };

// The limits the PE does not negotiate. Sibling of ModelPolicy: same shape,
// same conservative fallback, and gating is expressed here ONCE rather than in
// a second vocabulary.
export interface ExecutionPolicy {
  maxSessionsPerWave: number;
  gateAboveSessions: number;
  gatedIntensities: Intensity[];
  gatedTiers: ModelTier[];
  maxCostIndexPerWave: number;
}

// One concrete way to run one unit.
export interface Envelope {
  mode: SessionMode;
  harness: string;
  tier: ModelTier;
  intensity: Intensity;
}

export interface PricedEnvelope {
  envelope: Envelope;
  costIndex: number;
  gated: boolean;
  gateReasons: string[];
}

export interface UnitProposal {
  fqid: string;
  options: PricedEnvelope[];
  excluded: { harness: string; reason: string }[];
}

export interface Proposal {
  units: UnitProposal[];
  notes: string[];
}
