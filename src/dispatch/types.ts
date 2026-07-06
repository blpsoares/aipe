import type { PersonaRegistryEntry } from "../hire-specialists/types";

export type { PersonaRegistryEntry };

// One proposed dispatch: a specialist to run against a repo. The coordinator
// assembles a *batch* of these (the set it wants to run at once) and asks the
// CLI to adjudicate the physical dispatch law before provisioning worktrees.
export interface DispatchEntry {
  repo: string;
  specialist: string;
  // Optional model tier the coordinator assigned by task complexity. Adjudicated
  // by the model-policy CLI (`aipe model`), then carried into the hiring brief.
  tier?: string;
}

export type Batch = DispatchEntry[];

export type Verdict = { ok: true } | { ok: false; rejects: string[] };

// The one law the coordinator cannot break (foundation spec §6): distinct repos
// run in parallel, the same repo serializes, and no more than this many run at
// once (the tool's real concurrency ceiling).
export const MAX_CONCURRENT = 16;
