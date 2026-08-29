import type { PersonaRegistryEntry } from "../hire-specialists/types";

export type { PersonaRegistryEntry };

// One proposed dispatch: a specialist to run against a repo. The coordinator
// assembles a *batch* of these (the set it wants to run at once) and asks the
// CLI to adjudicate the physical dispatch law before provisioning worktrees.
export interface DispatchEntry {
  repo: string;
  specialist: string;
  package?: string; // the unit within the repo; absent ⇒ the implicit whole-repo package
  // The specific task this persona is doing on the unit — the axis that makes a
  // dispatch addressable as `Persona · task`. Slug-safe (same shape as a journey
  // id). Absent ⇒ the implicit single task (today's persona-on-unit identity).
  // Two concurrent dispatches of ONE non-writing persona on distinct tasks are
  // lawful; the same task twice is not (see law.ts).
  task?: string;
  // The paths (globs/prefixes) this dispatch will touch (j-20260826-xj). Two
  // writing dispatches on one unit with DISJOINT path sets coexist; OVERLAPPING
  // sets serialize. Absent/empty ⇒ the WHOLE unit (overlaps everything), which
  // preserves the pre-path same-repo/same-package serialization exactly.
  paths?: string[];
  // Optional model tier the coordinator assigned by task complexity. Adjudicated
  // by the model-policy CLI (`aipe model`), then carried into the hiring brief.
  tier?: string;
  // How this unit is dispatched. `subagent` (default) is an in-process subagent
  // that returns evidence synchronously; `session` is a real, detached agentop
  // session that records into the ledger instead of returning.
  mode?: "subagent" | "session";
  intensity?: "normal" | "ultracode";
  harness?: string; // defaults to the workspace harness
}

export type Batch = DispatchEntry[];

export type Verdict = { ok: true } | { ok: false; rejects: string[] };

// The one law the coordinator cannot break (foundation spec §6): distinct repos
// run in parallel, the same repo serializes, and no more than this many run at
// once (the tool's real concurrency ceiling).
export const MAX_CONCURRENT = 16;

// Session mode's own, far lower ceiling. 16 was calibrated for subagents; 16
// real sessions — each with its own context window, some fanning out under
// ultracode — is a different order of cost entirely.
export const SESSION_MAX_CONCURRENT = 4;

export interface SessionContext {
  agentopOk: boolean;
  containableHarnesses: string[];
}
