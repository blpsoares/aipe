import type { BrainFile, RepoEntry } from "../context-brain/types";

export type { BrainFile, RepoEntry };

export type RelationType = "imports" | "published-by" | "consumes" | "exposed-by" | "shares-infra";

export interface RawRelation {
  // Optional local package id inside the reporting repo. Absent = the whole repo.
  // The CLI qualifies it to an fqid (`repo` or `repo/package`).
  from?: string;
  // A fully-qualified target fqid: another repo (`embark`), a package in another
  // repo (`embark/worker`), or a sibling package in this repo (`repo/package`).
  to: string;
  type: RelationType;
  detail: string;
  evidence: string;
}

// A package discovered inside a (mono)repo. `id` is a path-like id local to the
// repo (`api`, `apps/web`). Optional stack/description enrich the graph node.
export interface ModuleEntry {
  id: string;
  stack?: string[];
  description?: string;
}

export interface RepoReport {
  repo: string;
  stack: string[];
  // Optional: the modules found in this repo. Absent/empty = single-package repo.
  modules?: ModuleEntry[];
  relations: RawRelation[];
}

// A node in the relationship graph, keyed by fqid. `package` is null for a
// whole-repo (single-package) node.
export interface GraphNode {
  fqid: string;
  repo: string;
  package: string | null;
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
