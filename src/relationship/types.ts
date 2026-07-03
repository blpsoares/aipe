import type { BrainFile, RepoEntry } from "../context-brain/types";

export type { BrainFile, RepoEntry };

export type RelationType = "imports" | "published-by" | "consumes" | "exposed-by" | "shares-infra";

export interface RawRelation {
  to: string;
  type: RelationType;
  detail: string;
  evidence: string;
}

export interface RepoReport {
  repo: string;
  stack: string[];
  relations: RawRelation[];
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
