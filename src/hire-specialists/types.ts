import type { BrainFile, Phase, RepoEntry, StateFile } from "../context-brain/types";

export type { BrainFile, Phase, RepoEntry, StateFile };

export type PersonaRole = "dev-fullstack" | "qa";

export interface PersonaAssignment {
  repo: string;
  role: PersonaRole;
  name: string;
  package?: string; // representative package of the hiring group (absent ⇒ whole repo)
  group?: string; // hiring group/area; packages sharing it share this pair
}

export interface NamingResult {
  coordinator: string;
  personas: PersonaAssignment[];
}

export interface ProvidedNames {
  [repo: string]: { devFullstack?: string | null; qa?: string | null };
}

export interface PersonaReport {
  repo: string;
  role: PersonaRole;
  name: string;
  body: string;
  package?: string; // representative package of the hiring group (absent ⇒ whole repo)
  group?: string; // hiring group/area
}

export interface PersonaRegistryEntry {
  name: string;
  role: PersonaRole | "coordinator";
  repo: string | null;
  path: string | null;
  package?: string; // representative package (absent ⇒ implicit whole-repo package)
  group?: string; // hiring group this persona covers
}

export type SpecialistsPhase = "pending" | "done";
