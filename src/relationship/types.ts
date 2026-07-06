import type { BrainFile, RepoEntry } from "../context-brain/types";

export type { BrainFile, RepoEntry };

export type RelationType = "imports" | "published-by" | "consumes" | "exposed-by" | "shares-infra";

export interface RawRelation {
  // Optional local module id inside the reporting repo. Absent = the whole repo.
  // The CLI qualifies it to an fqid (`repo` or `repo/module`).
  from?: string;
  // A fully-qualified target fqid: another repo (`embark`), a module in another
  // repo (`embark/worker`), or a sibling module in this repo (`repo/module`).
  to: string;
  type: RelationType;
  detail: string;
  evidence: string;
}

// A module discovered inside a (mono)repo. `id` is a path-like id local to the
// repo (`api`, `apps/web`). Optional stack/description enrich the graph node.
export interface ModuleEntry {
  id: string;
  stack?: string[];
  description?: string;
}

export interface RepoReport {
  repo: string;
  stack: string[];
  // Optional: the modules found in this repo. Absent/empty = single-module repo.
  modules?: ModuleEntry[];
  relations: RawRelation[];
}

// A node in the relationship graph, keyed by fqid. `module` is null for a
// whole-repo (single-module) node.
export interface GraphNode {
  fqid: string;
  repo: string;
  module: string | null;
  stack: string[];
  description?: string;
}

export interface Perspective {
  detail: string;
  evidence: string;
}

export interface MergedEdge {
  from: string;
  to: string;
  type: RelationType;
  perspectives: Perspective[];
}

export type RelationshipPhase = "pending" | "done";
