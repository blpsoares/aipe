import type { BrainFile, Phase, RepoEntry, StateFile } from "../context-brain/types";

export type { BrainFile, Phase, RepoEntry, StateFile };

export type PersonaRole = "dev-fullstack" | "qa";

export interface PersonaAssignment {
  repo: string;
  role: PersonaRole;
  name: string;
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
}

export interface PersonaRegistryEntry {
  name: string;
  role: PersonaRole | "coordinator";
  repo: string | null;
  path: string | null;
}

export type SpecialistsPhase = "pending" | "done";
