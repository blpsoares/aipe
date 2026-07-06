import type { BrainFile, Phase, RepoEntry, StateFile } from "../context-brain/types";

export type { BrainFile, Phase, RepoEntry, StateFile };

export type PersonaRole = "dev-fullstack" | "qa";

// A unit that gets its own dev-fullstack + QA pair. Either a whole repo
// (single-module, fqid == repo, module == null) or a module in a monorepo
// (fqid == repo/module). Derived from the relationship graph nodes, falling
// back to one group per repo when no nodes exist.
export interface HiringGroup {
  fqid: string;
  repo: string;
  module: string | null;
  stack: string[];
}

export interface PersonaAssignment {
  fqid: string;
  repo: string;
  module: string | null;
  role: PersonaRole;
  name: string;
}

export interface NamingResult {
  coordinator: string;
  personas: PersonaAssignment[];
}

// Keyed by fqid (== repo for single-module repos, so PE input is unchanged
// there; `repo/module` for per-module hiring in a monorepo).
export interface ProvidedNames {
  [fqid: string]: { devFullstack?: string | null; qa?: string | null };
}

export interface PersonaReport {
  repo: string;
  // Optional local module id; absent = whole-repo persona (backward compatible).
  module?: string | null;
  role: PersonaRole;
  name: string;
  body: string;
}

export interface PersonaRegistryEntry {
  name: string;
  role: PersonaRole | "coordinator";
  repo: string | null;
  module: string | null;
  fqid: string | null;
  path: string | null;
}

export type SpecialistsPhase = "pending" | "done";
